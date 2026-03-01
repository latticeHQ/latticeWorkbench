/**
 * Pixel HQ Room Templates
 *
 * Pre-built room templates that users can stamp into their custom layouts
 * from the editor. Each template is a self-contained OfficeLayout fragment
 * with tiles, furniture, and room definitions that can be placed at
 * any position via EditorState.applyTemplate().
 */

import type {
  OfficeLayout,
  PlacedFurniture,
  RoomDefinition,
  TileColorConfig,
  TileType,
} from "../engine/types";
import { TileType as TT, RoomZone } from "../engine/types";

// ─────────────────────────────────────────────────────────────────────────────
// Room Template Type
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomTemplate {
  /** Unique template ID */
  id: string;
  /** Display name in the template browser */
  name: string;
  /** Short description */
  description: string;
  /** Category for grouping in the UI */
  category: "workspace" | "meeting" | "utility" | "lounge";
  /** Icon (emoji) for the template */
  icon: string;
  /** Width in tiles (including walls) */
  width: number;
  /** Height in tiles (including walls) */
  height: number;
  /** Factory that produces the layout fragment */
  createLayout: () => OfficeLayout;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let templateUidCounter = 50000;

function nextTemplateUid(): string {
  return `tmpl_${++templateUidCounter}`;
}

function createEmptyLayout(cols: number, rows: number): {
  tiles: TileType[];
  tileColors: Array<TileColorConfig | null>;
} {
  return {
    tiles: new Array(cols * rows).fill(TT.VOID),
    tileColors: new Array(cols * rows).fill(null),
  };
}

function fillFloor(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  width: number,
  height: number,
  floor: TileType = TT.FLOOR_3,
): void {
  for (let r = row; r < row + height; r++) {
    for (let c = col; c < col + width; c++) {
      const idx = r * cols + c;
      if (idx >= 0 && idx < tiles.length) tiles[idx] = floor;
    }
  }
}

function drawWalls(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  width: number,
  height: number,
): void {
  for (let c = col; c < col + width; c++) {
    tiles[row * cols + c] = TT.WALL;
    tiles[(row + height - 1) * cols + c] = TT.WALL;
  }
  for (let r = row; r < row + height; r++) {
    tiles[r * cols + col] = TT.WALL;
    tiles[r * cols + (col + width - 1)] = TT.WALL;
  }
}

function openDoor(
  tiles: TileType[],
  cols: number,
  col: number,
  row: number,
  size: number = 2,
): void {
  for (let c = col; c < col + size; c++) {
    const idx = row * cols + c;
    if (idx >= 0 && idx < tiles.length) tiles[idx] = TT.FLOOR_1;
  }
}

function fillColor(
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
      if (idx >= 0 && idx < tileColors.length) tileColors[idx] = color;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────

const devPod4: RoomTemplate = {
  id: "dev_pod_4",
  name: "Dev Pod (4 Desks)",
  description: "A compact workspace with 4 desks, a plant, and a whiteboard. Perfect for a small crew.",
  category: "workspace",
  icon: "💻",
  width: 10,
  height: 8,
  createLayout: () => {
    const cols = 10;
    const rows = 8;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    // Floor + walls
    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_4);
    drawWalls(tiles, cols, 0, 0, cols, rows);

    // Door at bottom center
    openDoor(tiles, cols, 4, rows - 1, 2);

    // 4 desks in 2x2 grid
    for (let dx = 0; dx < 2; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        furniture.push({
          uid: nextTemplateUid(),
          catalogId: "desk",
          col: 2 + dx * 4,
          row: 2 + dy * 2,
          roomId: "template_room",
        });
      }
    }

    // Whiteboard on the back wall
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "whiteboard",
      col: 4,
      row: 1,
      roomId: "template_room",
    });

    // Plant in corner
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: 1,
      row: 1,
      roomId: "template_room",
    });

    rooms.push({
      id: "template_room",
      zone: RoomZone.CREW_ROOM,
      label: "Dev Pod",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

const warRoom: RoomTemplate = {
  id: "war_room",
  name: "War Room",
  description: "A large meeting room with a conference table, whiteboard, and seating for 8. For planning and coordination.",
  category: "meeting",
  icon: "⚔️",
  width: 14,
  height: 10,
  createLayout: () => {
    const cols = 14;
    const rows = 10;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_3);
    drawWalls(tiles, cols, 0, 0, cols, rows);
    openDoor(tiles, cols, 6, rows - 1, 2);

    // Warm yellow tint
    fillColor(tileColors, cols, 1, 1, cols - 2, rows - 2, { h: 45, s: 15, b: 5 });

    // Conference table centered
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "conf_table",
      col: 5,
      row: 3,
      roomId: "template_war_room",
    });

    // Whiteboard on back wall
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "whiteboard",
      col: 2,
      row: 1,
      roomId: "template_war_room",
    });

    // Second whiteboard
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "whiteboard",
      col: 10,
      row: 1,
      roomId: "template_war_room",
    });

    // Plants in corners
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: 1,
      row: 1,
      roomId: "template_war_room",
    });
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: cols - 2,
      row: 1,
      roomId: "template_war_room",
    });

    rooms.push({
      id: "template_war_room",
      zone: RoomZone.WAR_ROOM,
      label: "War Room",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

const serverCloset: RoomTemplate = {
  id: "server_closet",
  name: "Server Closet",
  description: "A compact server room with 4 racks. Visualizes MCP server connections with animated LEDs.",
  category: "utility",
  icon: "🖥️",
  width: 8,
  height: 8,
  createLayout: () => {
    const cols = 8;
    const rows = 8;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_6);
    drawWalls(tiles, cols, 0, 0, cols, rows);
    openDoor(tiles, cols, 3, rows - 1, 2);

    // Cool blue tint
    fillColor(tileColors, cols, 1, 1, cols - 2, rows - 2, { h: 220, s: 25, b: 3 });

    // 4 server racks along back wall
    for (let i = 0; i < 3; i++) {
      furniture.push({
        uid: nextTemplateUid(),
        catalogId: "server_rack",
        col: 1 + i * 2,
        row: 1,
        roomId: "template_server",
      });
    }

    rooms.push({
      id: "template_server",
      zone: RoomZone.SERVER_ROOM,
      label: "Server Room",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

const lounge: RoomTemplate = {
  id: "lounge",
  name: "Lounge",
  description: "A cozy break area with couches, coffee machine, and bookshelf. Where benched minions relax.",
  category: "lounge",
  icon: "☕",
  width: 12,
  height: 8,
  createLayout: () => {
    const cols = 12;
    const rows = 8;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_7);
    drawWalls(tiles, cols, 0, 0, cols, rows);
    openDoor(tiles, cols, 5, rows - 1, 2);

    // Warm dim tint
    fillColor(tileColors, cols, 1, 1, cols - 2, rows - 2, { h: 30, s: 10, b: -5 });

    // 2 couches
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "couch",
      col: 2,
      row: 2,
      roomId: "template_lounge",
    });
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "couch",
      col: 6,
      row: 2,
      roomId: "template_lounge",
    });

    // Coffee machine
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "coffee",
      col: 1,
      row: 5,
      roomId: "template_lounge",
    });

    // Water cooler
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "water_cooler",
      col: 3,
      row: 5,
      roomId: "template_lounge",
    });

    // Bookshelf
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "bookshelf",
      col: cols - 2,
      row: 1,
      roomId: "template_lounge",
    });

    // Plant
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: 1,
      row: 1,
      roomId: "template_lounge",
    });

    rooms.push({
      id: "template_lounge",
      zone: RoomZone.BENCH_LOUNGE,
      label: "Lounge",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

const focusBooth: RoomTemplate = {
  id: "focus_booth",
  name: "Focus Booth",
  description: "A tiny single-desk room for deep work. Isolate a minion for maximum productivity.",
  category: "workspace",
  icon: "🎯",
  width: 5,
  height: 5,
  createLayout: () => {
    const cols = 5;
    const rows = 5;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_5);
    drawWalls(tiles, cols, 0, 0, cols, rows);
    openDoor(tiles, cols, 2, rows - 1, 1);

    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "desk",
      col: 1,
      row: 1,
      roomId: "template_focus",
    });

    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: 3,
      row: 1,
      roomId: "template_focus",
    });

    rooms.push({
      id: "template_focus",
      zone: RoomZone.CREW_ROOM,
      label: "Focus Booth",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

const openFloor: RoomTemplate = {
  id: "open_floor",
  name: "Open Floor (6 Desks)",
  description: "An open-plan workspace with 6 desks in rows. Fits larger crews with room to grow.",
  category: "workspace",
  icon: "🏢",
  width: 14,
  height: 10,
  createLayout: () => {
    const cols = 14;
    const rows = 10;
    const { tiles, tileColors } = createEmptyLayout(cols, rows);
    const furniture: PlacedFurniture[] = [];
    const rooms: RoomDefinition[] = [];

    fillFloor(tiles, cols, 0, 0, cols, rows, TT.FLOOR_4);
    drawWalls(tiles, cols, 0, 0, cols, rows);
    openDoor(tiles, cols, 6, rows - 1, 2);

    // 6 desks in 3x2 grid
    for (let dx = 0; dx < 3; dx++) {
      for (let dy = 0; dy < 2; dy++) {
        furniture.push({
          uid: nextTemplateUid(),
          catalogId: "desk",
          col: 2 + dx * 4,
          row: 2 + dy * 3,
          roomId: "template_open",
        });
      }
    }

    // Whiteboard
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "whiteboard",
      col: 6,
      row: 1,
      roomId: "template_open",
    });

    // Plants
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: 1,
      row: 1,
      roomId: "template_open",
    });
    furniture.push({
      uid: nextTemplateUid(),
      catalogId: "plant",
      col: cols - 2,
      row: 1,
      roomId: "template_open",
    });

    rooms.push({
      id: "template_open",
      zone: RoomZone.CREW_ROOM,
      label: "Open Floor",
      bounds: { col: 0, row: 0, width: cols, height: rows },
    });

    return { version: 1, cols, rows, tiles, furniture, tileColors, rooms };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

/** All available room templates */
export const ROOM_TEMPLATES: RoomTemplate[] = [
  devPod4,
  warRoom,
  serverCloset,
  lounge,
  focusBooth,
  openFloor,
];

/** Room templates indexed by ID */
export const ROOM_TEMPLATES_MAP = new Map(
  ROOM_TEMPLATES.map((t) => [t.id, t]),
);

/** Room templates grouped by category */
export function getTemplatesByCategory(): Map<string, RoomTemplate[]> {
  const map = new Map<string, RoomTemplate[]>();
  for (const template of ROOM_TEMPLATES) {
    const list = map.get(template.category) ?? [];
    list.push(template);
    map.set(template.category, list);
  }
  return map;
}
