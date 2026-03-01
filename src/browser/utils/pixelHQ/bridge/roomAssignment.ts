/**
 * Room Assignment Logic
 *
 * Decides which section/zone each minion belongs to based on its metadata:
 * archived state, crew membership, or fallback to elevator (unassigned).
 *
 * Building Metaphor:
 *   - Building = Lattice server instance
 *   - Floor = One project
 *   - Section = One crew (open-plan workstation area)
 *   - Worker = One minion (pixel character)
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
// Crew Section Lookup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the section definition assigned to a specific crew.
 *
 * Searches through the provided room list for a section with zone === 'crew_section'
 * whose crewId matches the given crew ID.
 *
 * @param crewId - The crew ID to match
 * @param rooms - Array of room definitions to search (from OfficeLayout.rooms)
 * @returns The matching RoomDefinition, or null if no crew section exists for that crew
 */
export function findSectionForCrew(
  crewId: string,
  rooms: RoomDefinition[],
): RoomDefinition | null {
  for (const room of rooms) {
    if (room.zone === "crew_section" && room.crewId === crewId) {
      return room;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room Assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine which section a minion should be assigned to.
 *
 * Assignment priority:
 * 1. Archived minions → break_room (couches, coffee)
 * 2. Minions with a crewId → crew_section matching that crew
 * 3. Minions without a crew → elevator (unassigned, waiting area)
 * 4. Fallback: elevator (if no matching section is found)
 *
 * @param minion - The minion metadata to assign
 * @param rooms - Array of room definitions from the office layout
 * @returns A RoomAssignment with the target zone and room ID
 */
export function assignRoom(
  minion: FrontendMinionMetadata,
  rooms: RoomDefinition[],
): RoomAssignment {
  // 1. Archived minions go to break room
  if (isMinionArchived(minion.archivedAt, minion.unarchivedAt)) {
    const breakRoom = rooms.find((r) => r.zone === "break_room");
    if (breakRoom) {
      return { roomZone: "break_room", roomId: breakRoom.id };
    }
    return fallbackToElevator(rooms);
  }

  // 2. Minions with a crew go to the matching crew section
  if (minion.crewId) {
    const crewSection = findSectionForCrew(minion.crewId, rooms);
    if (crewSection) {
      return { roomZone: "crew_section", roomId: crewSection.id };
    }
    // Crew exists but no section for it yet — fall through to elevator
  }

  // 3. No crew assignment — elevator (unassigned area)
  return fallbackToElevator(rooms);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return an elevator room assignment, or the first available room as last resort.
 */
function fallbackToElevator(rooms: RoomDefinition[]): RoomAssignment {
  const elevator = rooms.find((r) => r.zone === "elevator");
  if (elevator) {
    return { roomZone: "elevator", roomId: elevator.id };
  }

  // Absolute fallback: use the first room if no elevator exists
  if (rooms.length > 0) {
    return { roomZone: rooms[0].zone, roomId: rooms[0].id };
  }

  // No rooms at all — return a placeholder (should not happen in practice)
  return { roomZone: "elevator", roomId: "elevator_default" };
}
