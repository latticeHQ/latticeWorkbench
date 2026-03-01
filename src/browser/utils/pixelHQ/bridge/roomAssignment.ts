/**
 * Room Assignment Logic
 *
 * Decides which room zone each minion belongs to based on its metadata:
 * archived state, agent type, crew membership, or fallback to lobby.
 */

import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { RoomZone, RoomDefinition } from "../engine/types";
import { isMinionArchived } from "@/common/utils/archive";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomAssignment {
  roomZone: RoomZone;
  roomId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// War Room Detection
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern matching planning/architecture/research agent IDs */
const WAR_ROOM_PATTERN = /plan|arch|research/i;

/**
 * Check whether a minion should be assigned to the war room.
 *
 * Returns true if the minion's agentId contains 'plan', 'arch', or 'research'
 * (case-insensitive). These are the strategic/planning agents that collaborate
 * in the war room rather than sitting with their crew.
 *
 * @param minion - The minion metadata to check
 * @returns true if the minion belongs in the war room
 */
export function shouldBeInWarRoom(minion: FrontendMinionMetadata): boolean {
  if (!minion.agentId) return false;
  return WAR_ROOM_PATTERN.test(minion.agentId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew Room Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the room definition assigned to a specific crew.
 *
 * Searches through the provided room list for a room with zone === 'crew_room'
 * whose crewId matches the given crew ID.
 *
 * @param crewId - The crew ID to match
 * @param rooms - Array of room definitions to search (from OfficeLayout.rooms)
 * @returns The matching RoomDefinition, or null if no crew room exists for that crew
 */
export function findRoomForCrew(
  crewId: string,
  rooms: RoomDefinition[],
): RoomDefinition | null {
  for (const room of rooms) {
    if (room.zone === "crew_room" && room.crewId === crewId) {
      return room;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room Assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which room a minion should be assigned to.
 *
 * Assignment priority:
 * 1. Archived minions (archivedAt set and newer than unarchivedAt) go to bench_lounge
 * 2. Planning agents (agentId contains plan/arch/research) go to war_room
 * 3. Minions with a crewId go to the crew_room matching that crew
 * 4. Minions without a crew go to lobby
 * 5. Fallback: lobby (if no matching room is found for any rule)
 *
 * @param minion - The minion metadata to assign
 * @param rooms - Array of room definitions from the office layout
 * @returns A RoomAssignment with the target zone and room ID
 */
export function assignRoom(
  minion: FrontendMinionMetadata,
  rooms: RoomDefinition[],
): RoomAssignment {
  // 1. Archived minions go to bench lounge
  if (isMinionArchived(minion.archivedAt, minion.unarchivedAt)) {
    const benchRoom = rooms.find((r) => r.zone === "bench_lounge");
    if (benchRoom) {
      return { roomZone: "bench_lounge", roomId: benchRoom.id };
    }
    // Fallback if no bench lounge exists
    return fallbackToLobby(rooms);
  }

  // 2. Planning/architecture/research agents go to war room
  if (shouldBeInWarRoom(minion)) {
    const warRoom = rooms.find((r) => r.zone === "war_room");
    if (warRoom) {
      return { roomZone: "war_room", roomId: warRoom.id };
    }
    // Fallback if no war room exists
    return fallbackToLobby(rooms);
  }

  // 3. Minions with a crew go to the matching crew room
  if (minion.crewId) {
    const crewRoom = findRoomForCrew(minion.crewId, rooms);
    if (crewRoom) {
      return { roomZone: "crew_room", roomId: crewRoom.id };
    }
    // Crew exists but no room for it yet -- fall through to lobby
  }

  // 4. No crew assignment -- lobby
  return fallbackToLobby(rooms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return a lobby room assignment, or the first available room as last resort.
 */
function fallbackToLobby(rooms: RoomDefinition[]): RoomAssignment {
  const lobby = rooms.find((r) => r.zone === "lobby");
  if (lobby) {
    return { roomZone: "lobby", roomId: lobby.id };
  }

  // Absolute fallback: use the first room if no lobby exists
  if (rooms.length > 0) {
    return { roomZone: rooms[0].zone, roomId: rooms[0].id };
  }

  // No rooms at all -- return a placeholder (should not happen in practice)
  return { roomZone: "lobby", roomId: "lobby_default" };
}
