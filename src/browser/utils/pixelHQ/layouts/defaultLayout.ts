/**
 * Pixel HQ Floor Layout Generator
 *
 * Generates an open-plan floor layout based on the project's crew configuration.
 * Maps the Lattice hierarchy to a pixel-art office floor:
 *
 *   Building = Lattice server instance
 *   Floor    = One project
 *   Phase    = Pipeline phase (groups of 3 stages) — floor partition row
 *   Section  = One crew/stage (open-plan workstation area, color-tinted)
 *   Worker   = One minion (pixel character at a desk)
 *
 * Layout structure — grid/matrix (matches Agent Network view):
 *
 *   ┌──────┬──────────┬──────────┬──────────┬───────┐
 *   │      │ Intake   │ Discovery│ Planning │       │
 *   │      ├──────────┼──────────┼──────────┤       │
 *   │Elev. │ Build    │ Test     │ Review   │Break  │
 *   │      ├──────────┼──────────┼──────────┤Room + │
 *   │      │ Docs     │ Deploy   │ Monitor  │Server │
 *   │      ├──────────┴──────────┴──────────┤       │
 *   │      │ Learning (partial row)         │       │
 *   ├──────┼────────────────────────────────┼───────┤
 *   │      │         COMMON AISLE           │       │
 *   └──────┴────────────────────────────────┴───────┘
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
// Layout Constants — Grid/Matrix
// ─────────────────────────────────────────────────────────────────────────────

/** Columns per row in the grid (matches Agent Network PHASE_SIZE) */
const GRID_COLS = 3;

/** Width of each crew cell in tiles */
const CELL_WIDTH = 10;

/** Height of each crew cell in tiles */
const CELL_HEIGHT = 8;

/** Gap between grid cells (1-tile walkable aisle) */
const CELL_GAP = 1;

/** Elevator area width (tiles) — left column */
const ELEVATOR_WIDTH = 4;

/** Break room + server closet width (tiles) — right column */
const UTILITY_WIDTH = 5;

/** Common aisle height (tiles) — walkable corridor at bottom */
const AISLE_HEIGHT = 2;

/** Default desks per section when no minion count data available */
const DEFAULT_DESKS_PER_SECTION = 3;

/** Default number of stages per phase (matches pipeline view PHASE_SIZE) */
const DEFAULT_PHASE_SIZE = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Phase Colors — distinct hue for each phase row
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_PARTITION_COLORS: TileColorConfig[] = [
  { h: 200, s: 15, b: 6 },  // Phase 1: cool blue
  { h: 140, s: 15, b: 6 },  // Phase 2: green
  { h: 280, s: 15, b: 6 },  // Phase 3: purple
  { h: 30, s: 15, b: 6 },   // Phase 4: warm amber
  { h: 340, s: 15, b: 6 },  // Phase 5: rose
  { h: 60, s: 15, b: 6 },   // Phase 6: yellow
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

let furnitureUidCounter = 0;

function nextFurnitureUid(): string {
  return `furn_${++furnitureUidCounter}`;
}

/**
 * Parse a hex color string to an approximate HSB TileColorConfig for tinting.
 */
function hexToTileColor(hex: string, saturation = 20, brightness = 5): TileColorConfig {
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
 * Group crews into phases of `phaseSize`.
 */
function groupIntoPhases(crews: CrewConfig[], phaseSize: number): CrewConfig[][] {
  const phases: CrewConfig[][] = [];
  for (let i = 0; i < crews.length; i += phaseSize) {
    phases.push(crews.slice(i, i + phaseSize));
  }
  return phases;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a grid/matrix floor layout based on the project's crew configuration.
 *
 * Layout structure — matches Agent Network view:
 *
 *   Elevator │ Crew grid (3 cols x N rows) │ Break Room + Server Closet
 *            │ (1-tile gap aisles between)  │
 *   ─────────┼─────────────────────────────┼──────────────────────────
 *            │         COMMON AISLE         │
 *
 * Crews are arranged in a 3-column grid (matching pipeline PHASE_SIZE).
 * Each row of 3 represents a phase. Gap strips between cells act as
 * walkable aisles. Phase row gaps get a distinct color tint.
 *
 * @param crews - Array of crew configurations from the project (pre-sorted by linked list)
 * @param minionCounts - Optional map of crewId → active minion count for dynamic sizing
 * @param phaseSize - Number of stages per phase (default: 3, matching pipeline PHASE_SIZE)
 * @returns A complete OfficeLayout ready for OfficeState.rebuildFromLayout()
 */
export function generateFloorLayout(
  crews: CrewConfig[],
  minionCounts?: Map<string, number>,
  phaseSize: number = DEFAULT_PHASE_SIZE,
): OfficeLayout {
  // Reset furniture UID counter for deterministic layouts
  furnitureUidCounter = 0;

  // If no crews, create a single default section
  const effectiveCrews = crews.length > 0 ? crews : [{ id: "default_crew_0", name: "Crew 1", nextId: null } as CrewConfig];

  // Group into phases (each row of GRID_COLS is one phase)
  const phases = groupIntoPhases(effectiveCrews, phaseSize);
  const gridRowCount = phases.length;

  // ── Calculate total grid dimensions ──────────────────────────────────────
  const gridWidth = GRID_COLS * CELL_WIDTH + (GRID_COLS - 1) * CELL_GAP;
  const gridHeight = gridRowCount * CELL_HEIGHT + Math.max(0, gridRowCount - 1) * CELL_GAP;

  const totalCols = ELEVATOR_WIDTH + gridWidth + UTILITY_WIDTH;
  const totalRows = gridHeight + AISLE_HEIGHT;

  // ── Initialize tiles and colors ──────────────────────────────────────────
  const tiles: TileType[] = new Array(totalCols * totalRows).fill(TT.VOID);
  const tileColors: Array<TileColorConfig | null> = new Array(totalCols * totalRows).fill(null);
  const furniture: PlacedFurniture[] = [];
  const rooms: RoomDefinition[] = [];

  // ── Elevator (spawn area — full height of grid rows) ─────────────────────
  const elevatorCol = 0;
  fillRect(tiles, totalCols, elevatorCol, 0, ELEVATOR_WIDTH, gridHeight, TT.FLOOR_2);

  rooms.push({
    id: "elevator",
    zone: RoomZone.ELEVATOR,
    label: "Elevator",
    bounds: { col: elevatorCol, row: 0, width: ELEVATOR_WIDTH, height: gridHeight },
  });

  // Elevator furniture: plant + water cooler
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "plant",
    col: elevatorCol + 1,
    row: 1,
    roomId: "elevator",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "water_cooler",
    col: elevatorCol + 1,
    row: Math.max(3, gridHeight - 2),
    roomId: "elevator",
  });

  // ── Common Aisle (walkable corridor at bottom) ───────────────────────────
  const aisleRow = gridHeight;
  fillRect(tiles, totalCols, 0, aisleRow, totalCols, AISLE_HEIGHT, TT.FLOOR_1);

  rooms.push({
    id: "common_aisle",
    zone: RoomZone.COMMON_AISLE,
    label: "Aisle",
    bounds: { col: 0, row: aisleRow, width: totalCols, height: AISLE_HEIGHT },
  });

  // ── Grid Cells — Crew Sections ───────────────────────────────────────────
  let globalCrewIdx = 0;

  for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx++) {
    const phase = phases[phaseIdx];
    const phaseColor = PHASE_PARTITION_COLORS[phaseIdx % PHASE_PARTITION_COLORS.length];

    // Grid row origin
    const rowOrigin = phaseIdx * (CELL_HEIGHT + CELL_GAP);

    // Phase row metadata room (spans the full row of cells)
    const phaseWidth = phase.length * CELL_WIDTH + Math.max(0, phase.length - 1) * CELL_GAP;
    rooms.push({
      id: `phase_${phaseIdx}`,
      zone: RoomZone.COMMON_AISLE,
      label: `Phase ${phaseIdx + 1}`,
      bounds: { col: ELEVATOR_WIDTH, row: rowOrigin, width: phaseWidth, height: CELL_HEIGHT },
    });

    for (let localIdx = 0; localIdx < phase.length; localIdx++) {
      const crew = phase[localIdx];
      const crewId = crew.id;
      const crewName = crew.name;
      const crewColor = resolveCrewColor(crew.color);
      const roomId = `section_${crewId}`;

      // Grid position
      const gridCol = localIdx; // column within row
      const cellCol = ELEVATOR_WIDTH + gridCol * (CELL_WIDTH + CELL_GAP);
      const cellRow = rowOrigin;

      // Fill cell floor
      const floorVariant = (TT.FLOOR_3 + (globalCrewIdx % 5)) as TileType;
      fillRect(tiles, totalCols, cellCol, cellRow, CELL_WIDTH, CELL_HEIGHT, floorVariant);

      // Apply crew color tint
      const tileColor = hexToTileColor(crewColor, 18, 4);
      fillColorRect(tileColors, totalCols, cellCol, cellRow, CELL_WIDTH, CELL_HEIGHT, tileColor);

      // Register crew section room
      rooms.push({
        id: roomId,
        zone: RoomZone.CREW_SECTION,
        label: crewName,
        bounds: { col: cellCol, row: cellRow, width: CELL_WIDTH, height: CELL_HEIGHT },
        crewId,
        crewColor,
      });

      // ── Furniture within cell ──────────────────────────────────────────
      // Cell layout (10 wide x 8 tall):
      //   Row 0: whiteboard
      //   Row 1: desk desk desk desk  (top row, up to 4)
      //   Row 2: chair chair chair chair
      //   Row 3: (walkable)
      //   Row 4: desk desk desk desk  (overflow row)
      //   Row 5: chair chair chair chair
      //   Row 6: (walkable)
      //   Row 7: plant

      const deskCount = minionCounts?.get(crewId) ?? DEFAULT_DESKS_PER_SECTION;
      const deskSpacing = 2;
      const padding = 1;
      const maxDesksPerRow = Math.max(1, Math.floor((CELL_WIDTH - padding * 2) / deskSpacing));
      const topRowDesks = Math.min(Math.ceil(deskCount / 2), maxDesksPerRow);

      // Whiteboard at top of cell
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "whiteboard",
        col: cellCol + Math.floor(CELL_WIDTH / 2),
        row: cellRow,
        roomId,
      });

      // Top row of desks (rows 1-2 within cell)
      for (let d = 0; d < topRowDesks; d++) {
        const deskCol = cellCol + padding + d * deskSpacing;
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "desk",
          col: deskCol,
          row: cellRow + 1,
          roomId,
        });
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "chair",
          col: deskCol,
          row: cellRow + 2,
          roomId,
        });
      }

      // Bottom row of desks (rows 4-5 within cell)
      const bottomRowDesks = Math.min(Math.max(0, deskCount - topRowDesks), maxDesksPerRow);
      for (let d = 0; d < bottomRowDesks; d++) {
        const deskCol = cellCol + padding + d * deskSpacing;
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "desk",
          col: deskCol,
          row: cellRow + 4,
          roomId,
        });
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "chair",
          col: deskCol,
          row: cellRow + 5,
          roomId,
        });
      }

      // Plant at bottom of cell
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "plant",
        col: cellCol,
        row: cellRow + CELL_HEIGHT - 1,
        roomId,
      });

      globalCrewIdx++;
    }

    // ── Fill horizontal gap strip between phase rows ─────────────────────
    if (phaseIdx < phases.length - 1) {
      const gapRow = rowOrigin + CELL_HEIGHT;
      // Fill the gap strip as walkable floor with phase color tint
      fillRect(tiles, totalCols, ELEVATOR_WIDTH, gapRow, gridWidth, CELL_GAP, TT.FLOOR_1);
      fillColorRect(tileColors, totalCols, ELEVATOR_WIDTH, gapRow, gridWidth, CELL_GAP, {
        ...phaseColor,
        b: phaseColor.b + 3,
      });
    }

    // ── Fill vertical gap strips between cells within this row ───────────
    for (let gapIdx = 0; gapIdx < phase.length - 1; gapIdx++) {
      const gapCol = ELEVATOR_WIDTH + (gapIdx + 1) * CELL_WIDTH + gapIdx * CELL_GAP;
      fillRect(tiles, totalCols, gapCol, rowOrigin, CELL_GAP, CELL_HEIGHT, TT.FLOOR_1);
      // Subtle divider color
      const dividerColor: TileColorConfig = { h: 220, s: 8, b: 3 };
      fillColorRect(tileColors, totalCols, gapCol, rowOrigin, CELL_GAP, CELL_HEIGHT, dividerColor);
    }
  }

  // ── Break Room (top-right utility column) ────────────────────────────────
  const utilityCol = totalCols - UTILITY_WIDTH;
  const breakRoomHeight = Math.max(4, Math.floor(gridHeight * 0.6));
  fillRect(tiles, totalCols, utilityCol, 0, UTILITY_WIDTH, breakRoomHeight, TT.FLOOR_7);

  const breakColor: TileColorConfig = { h: 30, s: 10, b: -3 };
  fillColorRect(tileColors, totalCols, utilityCol, 0, UTILITY_WIDTH, breakRoomHeight, breakColor);

  rooms.push({
    id: "break_room",
    zone: RoomZone.BREAK_ROOM,
    label: "Break Room",
    bounds: { col: utilityCol, row: 0, width: UTILITY_WIDTH, height: breakRoomHeight },
  });

  // Break room furniture
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "couch",
    col: utilityCol + 1,
    row: 1,
    roomId: "break_room",
  });
  furniture.push({
    uid: nextFurnitureUid(),
    catalogId: "coffee",
    col: utilityCol + 3,
    row: 1,
    roomId: "break_room",
  });

  // ── Server Closet (bottom-right utility column) ──────────────────────────
  const serverClosetRow = breakRoomHeight;
  const serverClosetHeight = Math.max(2, gridHeight - breakRoomHeight);
  fillRect(tiles, totalCols, utilityCol, serverClosetRow, UTILITY_WIDTH, serverClosetHeight, TT.FLOOR_6);

  const serverColor: TileColorConfig = { h: 220, s: 25, b: 3 };
  fillColorRect(tileColors, totalCols, utilityCol, serverClosetRow, UTILITY_WIDTH, serverClosetHeight, serverColor);

  rooms.push({
    id: "server_closet",
    zone: RoomZone.SERVER_CLOSET,
    label: "Servers",
    bounds: { col: utilityCol, row: serverClosetRow, width: UTILITY_WIDTH, height: serverClosetHeight },
  });

  // Server closet furniture: server racks
  const rackCount = Math.min(2, Math.floor((UTILITY_WIDTH - 1) / 2));
  for (let i = 0; i < rackCount; i++) {
    furniture.push({
      uid: nextFurnitureUid(),
      catalogId: "server_rack",
      col: utilityCol + 1 + i * 2,
      row: serverClosetRow + 1,
      roomId: "server_closet",
    });
  }

  return {
    version: 2,
    cols: totalCols,
    rows: totalRows,
    tiles,
    furniture,
    tileColors,
    rooms,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Compat — keep the old name as an alias
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use generateFloorLayout instead */
export const generateDefaultLayout = generateFloorLayout;
