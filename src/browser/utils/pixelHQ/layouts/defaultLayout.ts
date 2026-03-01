/**
 * Pixel HQ Default Layout Generator
 *
 * Procedurally generates a multi-room office layout based on the
 * project's crew configuration. The layout includes:
 *
 *   Lobby | Hallway | War Room | Hallway | Crew Rooms... | Hallway | Server Room | Hallway | Bench Lounge
 *
 * Rooms are arranged horizontally with a central hallway corridor.
 * Each crew gets its own room with desks, and shared spaces
 * (war room, server room, lounge) are generated for the whole team.
 */

import type {
  OfficeLayout,
  PlacedFurniture,
  RoomDefinition,
  TileColorConfig,
  TileType,
} from "../engine/types";
import { TileType as TT, RoomZone } from "../engine/types";
import type { CrewConfig } from "@/common/types/project";
import { resolveCrewColor } from "@/common/constants/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Layout Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Total height of the layout in tiles */
const LAYOUT_HEIGHT = 20;

/** Hallway width between rooms */
const HALLWAY_WIDTH = 3;

/** Room height (top and bottom rooms) */
const ROOM_HEIGHT = 6;

/** Row where the top rooms start */
const TOP_ROOM_ROW = 1;

/** Row where the hallway corridor starts */
const HALLWAY_ROW = TOP_ROOM_ROW + ROOM_HEIGHT;

/** Row where the bottom rooms start */
const BOTTOM_ROOM_ROW = HALLWAY_ROW + HALLWAY_WIDTH;

/** Width of the lobby room */
const LOBBY_WIDTH = 8;

/** Width of the war room */
const WAR_ROOM_WIDTH = 12;

/** Width of each crew room */
const CREW_ROOM_WIDTH = 10;

/** Width of the server room */
const SERVER_ROOM_WIDTH = 6;

/** Width of the bench/lounge room */
const BENCH_WIDTH = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let furnitureUidCounter = 0;

function nextFurnitureUid(): string {
  return `furn_${++furnitureUidCounter}`;
}

/**
 * Parse a hex color string to an approximate HSB TileColorConfig for tinting.
 * This is a rough conversion for subtle room tinting -- not a full color model.
 */
function hexToTileColor(hex: string, saturation = 20, brightness = 5): TileColorConfig {
  // Strip # prefix
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta > 0) {
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else {
      hue = 60 * ((r - g) / delta + 4);
    }
  }
  if (hue < 0) hue += 360;

  return { h: Math.round(hue), s: saturation, b: brightness };
}

/**
 * Fill a rectangular region in the tiles array with a given tile type.
 */
function fillRect(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  width: number,
  height: number,
  tileType: TileType,
): void {
  for (let r = row; r < row + height; r++) {
    for (let c = col; c < col + width; c++) {
      const idx = r * cols + c;
      if (idx >= 0 && idx < tiles.length) {
        tiles[idx] = tileType;
      }
    }
  }
}

/**
 * Fill a rectangular region's tileColors with a given color config.
 */
function fillColorRect(
  tileColors: Array<TileColorConfig | null>,
  cols: number,
  col: number,
  row: number,
  width: number,
  height: number,
  color: TileColorConfig,
): void {
  for (let r = row; r < row + height; r++) {
    for (let c = col; c < col + width; c++) {
      const idx = r * cols + c;
      if (idx >= 0 && idx < tileColors.length) {
        tileColors[idx] = color;
      }
    }
  }
}

/**
 * Draw walls around the perimeter of a room (1-tile border).
 * The interior (inset by 1 tile on all sides) remains as floor.
 */
function drawRoomWalls(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  width: number,
  height: number,
): void {
  // Top and bottom walls
  for (let c = col; c < col + width; c++) {
    tiles[row * cols + c] = TT.WALL;
    tiles[(row + height - 1) * cols + c] = TT.WALL;
  }
  // Left and right walls
  for (let r = row; r < row + height; r++) {
    tiles[r * cols + col] = TT.WALL;
    tiles[r * cols + (col + width - 1)] = TT.WALL;
  }
}

/**
 * Create a door opening in a wall by replacing wall tiles with floor.
 * The door is placed at a specific column and row, spanning `size` tiles wide.
 */
function openDoor(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  size: number,
): void {
  for (let c = col; c < col + size; c++) {
    const idx = row * cols + c;
    if (idx >= 0 && idx < tiles.length) {
      tiles[idx] = TT.FLOOR_1;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a default office layout based on the project's crew configuration.
 *
 * The layout is arranged horizontally:
 *   Lobby → War Room → Crew Rooms (one per crew) → Server Room → Bench Lounge
 *
 * Connected by a central hallway corridor. Each room gets walls, floors,
 * furniture, and optional color tinting based on crew colors.
 *
 * @param crews - Array of crew configurations from the project
 * @returns A complete OfficeLayout ready for OfficeState.rebuildFromLayout()
 */
export function generateDefaultLayout(crews: CrewConfig[]): OfficeLayout {
  // Reset furniture UID counter for deterministic layouts
  furnitureUidCounter = 0;

  const crewCount = Math.max(crews.length, 1);

  // Calculate total width
  const totalWidth =
    LOBBY_WIDTH +
    HALLWAY_WIDTH +
    WAR_ROOM_WIDTH +
    HALLWAY_WIDTH +
    crewCount * CREW_ROOM_WIDTH +
    HALLWAY_WIDTH +
    SERVER_ROOM_WIDTH +
    HALLWAY_WIDTH +
    BENCH_WIDTH;

  const totalCols = totalWidth;
  const totalRows = LAYOUT_HEIGHT;

  // Initialize tiles and colors
  const tiles: TileType[] = new Array(totalCols * totalRows).fill(TT.VOID);
  const tileColors: Array<TileColorConfig | null> = new Array(totalCols * totalRows).fill(null);
  const furniture: PlacedFurniture[] = [];
  const rooms: RoomDefinition[] = [];

  let cursor = 0;

  // ── Lobby ──────────────────────────────────────────────────────────────────
  const lobbyCol = cursor;
  fillRect(tiles, totalCols, lobbyCol, TOP_ROOM_ROW, LOBBY_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH, TT.FLOOR_2);
  drawRoomWalls(tiles, totalCols, lobbyCol, TOP_ROOM_ROW, LOBBY_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH);

  rooms.push({
    id: "lobby",
    zone: RoomZone.LOBBY,
    label: "Lobby",
    bounds: { col: lobbyCol, row: TOP_ROOM_ROW, width: LOBBY_WIDTH, height: ROOM_HEIGHT * 2 + HALLWAY_WIDTH },
  });

  // Lobby furniture: plants and water cooler
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "plant",
    col: lobbyCol + 2,
    row: TOP_ROOM_ROW + 2,
    roomId: "lobby",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "plant",
    col: lobbyCol + 5,
    row: TOP_ROOM_ROW + 2,
    roomId: "lobby",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "water_cooler",
    col: lobbyCol + 3,
    row: BOTTOM_ROOM_ROW + 2,
    roomId: "lobby",
  });

  cursor += LOBBY_WIDTH;

  // ── Hallway (Lobby → War Room) ────────────────────────────────────────────
  fillRect(tiles, totalCols, cursor, HALLWAY_ROW, HALLWAY_WIDTH, HALLWAY_WIDTH, TT.FLOOR_1);
  cursor += HALLWAY_WIDTH;

  // Open doors: lobby right wall and war room left wall
  openDoor(tiles, totalCols, lobbyCol + LOBBY_WIDTH - 1, HALLWAY_ROW + 1, 1);

  // ── War Room ──────────────────────────────────────────────────────────────
  const warRoomCol = cursor;
  fillRect(tiles, totalCols, warRoomCol, TOP_ROOM_ROW, WAR_ROOM_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH, TT.FLOOR_3);
  drawRoomWalls(tiles, totalCols, warRoomCol, TOP_ROOM_ROW, WAR_ROOM_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH);
  openDoor(tiles, totalCols, warRoomCol, HALLWAY_ROW + 1, 1);

  const warRoomColor: TileColorConfig = { h: 45, s: 15, b: 5 }; // Warm yellow tint
  fillColorRect(tileColors, totalCols, warRoomCol + 1, TOP_ROOM_ROW + 1, WAR_ROOM_WIDTH - 2, ROOM_HEIGHT * 2 + HALLWAY_WIDTH - 2, warRoomColor);

  rooms.push({
    id: "war_room",
    zone: RoomZone.WAR_ROOM,
    label: "War Room",
    bounds: { col: warRoomCol, row: TOP_ROOM_ROW, width: WAR_ROOM_WIDTH, height: ROOM_HEIGHT * 2 + HALLWAY_WIDTH },
  });

  // War Room furniture: conference table centered, whiteboard on top wall
  const confTableCol = warRoomCol + Math.floor((WAR_ROOM_WIDTH - 3) / 2);
  const confTableRow = TOP_ROOM_ROW + Math.floor((ROOM_HEIGHT * 2 + HALLWAY_WIDTH - 2) / 2);
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "conf_table",
    col: confTableCol,
    row: confTableRow,
    roomId: "war_room",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "whiteboard",
    col: warRoomCol + 2,
    row: TOP_ROOM_ROW + 1,
    roomId: "war_room",
  });

  cursor += WAR_ROOM_WIDTH;

  // ── Hallway (War Room → Crew Rooms) ───────────────────────────────────────
  fillRect(tiles, totalCols, cursor, HALLWAY_ROW, HALLWAY_WIDTH, HALLWAY_WIDTH, TT.FLOOR_1);
  openDoor(tiles, totalCols, warRoomCol + WAR_ROOM_WIDTH - 1, HALLWAY_ROW + 1, 1);
  cursor += HALLWAY_WIDTH;

  // ── Crew Rooms ────────────────────────────────────────────────────────────
  for (let i = 0; i < crewCount; i++) {
    const crew = crews[i];
    const crewRoomCol = cursor;
    const crewId = crew?.id ?? `default_crew_${i}`;
    const crewName = crew?.name ?? `Crew ${i + 1}`;
    const crewColor = resolveCrewColor(crew?.color);
    const roomId = `crew_${crewId}`;

    // Top room: crew workspace
    fillRect(tiles, totalCols, crewRoomCol, TOP_ROOM_ROW, CREW_ROOM_WIDTH, ROOM_HEIGHT, TT.FLOOR_4);
    drawRoomWalls(tiles, totalCols, crewRoomCol, TOP_ROOM_ROW, CREW_ROOM_WIDTH, ROOM_HEIGHT);

    // Bottom room: overflow/secondary space for same crew
    fillRect(tiles, totalCols, crewRoomCol, BOTTOM_ROOM_ROW, CREW_ROOM_WIDTH, ROOM_HEIGHT, TT.FLOOR_5);
    drawRoomWalls(tiles, totalCols, crewRoomCol, BOTTOM_ROOM_ROW, CREW_ROOM_WIDTH, ROOM_HEIGHT);

    // Hallway connection (between rooms)
    fillRect(tiles, totalCols, crewRoomCol, HALLWAY_ROW, CREW_ROOM_WIDTH, HALLWAY_WIDTH, TT.FLOOR_1);

    // Doors from hallway into each room
    openDoor(tiles, totalCols, crewRoomCol + Math.floor(CREW_ROOM_WIDTH / 2), TOP_ROOM_ROW + ROOM_HEIGHT - 1, 2);
    openDoor(tiles, totalCols, crewRoomCol + Math.floor(CREW_ROOM_WIDTH / 2), BOTTOM_ROOM_ROW, 2);

    // Hallway connections to left (previous section) and right (next section)
    if (i === 0) {
      // Connect to war room hallway
      openDoor(tiles, totalCols, crewRoomCol, HALLWAY_ROW + 1, 1);
    }

    // Apply crew color tint to room floors
    const tileColor = hexToTileColor(crewColor, 20, 5);
    fillColorRect(tileColors, totalCols, crewRoomCol + 1, TOP_ROOM_ROW + 1, CREW_ROOM_WIDTH - 2, ROOM_HEIGHT - 2, tileColor);
    fillColorRect(tileColors, totalCols, crewRoomCol + 1, BOTTOM_ROOM_ROW + 1, CREW_ROOM_WIDTH - 2, ROOM_HEIGHT - 2, tileColor);

    rooms.push({
      id: roomId,
      zone: RoomZone.CREW_ROOM,
      label: crewName,
      bounds: { col: crewRoomCol, row: TOP_ROOM_ROW, width: CREW_ROOM_WIDTH, height: ROOM_HEIGHT },
      crewId,
      crewColor,
    });

    // Also register bottom room for overflow seating
    rooms.push({
      id: `${roomId}_lower`,
      zone: RoomZone.CREW_ROOM,
      label: `${crewName} (B)`,
      bounds: { col: crewRoomCol, row: BOTTOM_ROOM_ROW, width: CREW_ROOM_WIDTH, height: ROOM_HEIGHT },
      crewId,
      crewColor,
    });

    // Crew room furniture: 3 desks in top room, 2 in bottom
    for (let d = 0; d < 3; d++) {
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "desk",
        col: crewRoomCol + 2 + d * 2,
        row: TOP_ROOM_ROW + 2,
        roomId,
      });
    }
    for (let d = 0; d < 2; d++) {
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "desk",
        col: crewRoomCol + 2 + d * 3,
        row: BOTTOM_ROOM_ROW + 2,
        roomId: `${roomId}_lower`,
      });
    }

    // Add a plant in each crew room for decoration
    furniture.push({
      uid: nextFurnitureUid(),
      catalogId: "plant",
      col: crewRoomCol + 1,
      row: TOP_ROOM_ROW + 1,
      roomId,
    });

    cursor += CREW_ROOM_WIDTH;

    // Hallway between crew rooms (if not the last one)
    if (i < crewCount - 1) {
      fillRect(tiles, totalCols, cursor - 1, HALLWAY_ROW, 2, HALLWAY_WIDTH, TT.FLOOR_1);
    }
  }

  // ── Hallway (Crew Rooms → Server Room) ────────────────────────────────────
  fillRect(tiles, totalCols, cursor, HALLWAY_ROW, HALLWAY_WIDTH, HALLWAY_WIDTH, TT.FLOOR_1);
  // Open door from last crew room's hallway into this hallway
  openDoor(tiles, totalCols, cursor, HALLWAY_ROW + 1, 1);
  cursor += HALLWAY_WIDTH;

  // ── Server Room ───────────────────────────────────────────────────────────
  const serverRoomCol = cursor;
  fillRect(tiles, totalCols, serverRoomCol, TOP_ROOM_ROW, SERVER_ROOM_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH, TT.FLOOR_6);
  drawRoomWalls(tiles, totalCols, serverRoomCol, TOP_ROOM_ROW, SERVER_ROOM_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH);
  openDoor(tiles, totalCols, serverRoomCol, HALLWAY_ROW + 1, 1);

  const serverColor: TileColorConfig = { h: 220, s: 25, b: 3 }; // Cool blue tint
  fillColorRect(tileColors, totalCols, serverRoomCol + 1, TOP_ROOM_ROW + 1, SERVER_ROOM_WIDTH - 2, ROOM_HEIGHT * 2 + HALLWAY_WIDTH - 2, serverColor);

  rooms.push({
    id: "server_room",
    zone: RoomZone.SERVER_ROOM,
    label: "Server Room",
    bounds: { col: serverRoomCol, row: TOP_ROOM_ROW, width: SERVER_ROOM_WIDTH, height: ROOM_HEIGHT * 2 + HALLWAY_WIDTH },
  });

  // Server room furniture: server racks along the back wall
  for (let i = 0; i < 3; i++) {
    furniture.push({
      uid: nextFurnitureUid(),
      catalogId: "server_rack",
      col: serverRoomCol + 1 + i * 2,
      row: TOP_ROOM_ROW + 1,
      roomId: "server_room",
    });
  }

  cursor += SERVER_ROOM_WIDTH;

  // ── Hallway (Server Room → Bench Lounge) ──────────────────────────────────
  fillRect(tiles, totalCols, cursor, HALLWAY_ROW, HALLWAY_WIDTH, HALLWAY_WIDTH, TT.FLOOR_1);
  openDoor(tiles, totalCols, serverRoomCol + SERVER_ROOM_WIDTH - 1, HALLWAY_ROW + 1, 1);
  cursor += HALLWAY_WIDTH;

  // ── Bench Lounge ──────────────────────────────────────────────────────────
  const benchCol = cursor;
  fillRect(tiles, totalCols, benchCol, TOP_ROOM_ROW, BENCH_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH, TT.FLOOR_7);
  drawRoomWalls(tiles, totalCols, benchCol, TOP_ROOM_ROW, BENCH_WIDTH, ROOM_HEIGHT * 2 + HALLWAY_WIDTH);
  openDoor(tiles, totalCols, benchCol, HALLWAY_ROW + 1, 1);

  const benchColor: TileColorConfig = { h: 30, s: 10, b: -5 }; // Dim warm tint
  fillColorRect(tileColors, totalCols, benchCol + 1, TOP_ROOM_ROW + 1, BENCH_WIDTH - 2, ROOM_HEIGHT * 2 + HALLWAY_WIDTH - 2, benchColor);

  rooms.push({
    id: "bench_lounge",
    zone: RoomZone.BENCH_LOUNGE,
    label: "Bench Lounge",
    bounds: { col: benchCol, row: TOP_ROOM_ROW, width: BENCH_WIDTH, height: ROOM_HEIGHT * 2 + HALLWAY_WIDTH },
  });

  // Bench lounge furniture: couches, coffee machine, bookshelf
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "couch",
    col: benchCol + 2,
    row: TOP_ROOM_ROW + 2,
    roomId: "bench_lounge",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "couch",
    col: benchCol + 5,
    row: TOP_ROOM_ROW + 2,
    roomId: "bench_lounge",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "couch",
    col: benchCol + 2,
    row: BOTTOM_ROOM_ROW + 2,
    roomId: "bench_lounge",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "coffee",
    col: benchCol + 1,
    row: BOTTOM_ROOM_ROW + 1,
    roomId: "bench_lounge",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "bookshelf",
    col: benchCol + BENCH_WIDTH - 2,
    row: TOP_ROOM_ROW + 1,
    roomId: "bench_lounge",
  });

  return {
    version: 1,
    cols: totalCols,
    rows: totalRows,
    tiles,
    furniture,
    tileColors,
    rooms,
  };
}
