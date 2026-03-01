/**
 * Pixel HQ Floor Layout Generator
 *
 * Generates an open-plan floor layout based on the project's crew configuration.
 * Maps the Lattice hierarchy to a pixel-art office floor:
 *
 *   Building = Lattice server instance
 *   Floor    = One project
 *   Phase    = Pipeline phase (groups of 3 stages) — floor partition
 *   Section  = One crew/stage (open-plan workstation area, color-tinted)
 *   Worker   = One minion (pixel character at a desk)
 *
 * Layout structure (no walled rooms — open plan with subtle dividers):
 *
 *   ┌──────────┬───────────────────────────────┬────────────────────────────┬────────┐
 *   │ ELEVATOR │  ┌─ Phase 1 ─────────────────┐│ ┌─ Phase 2 ──────────────┐│ BREAK  │
 *   │ (spawn)  │  │ Crew A │ Crew B │ Crew C  ││ │ Crew D │ Crew E │ ...  ││ ROOM   │
 *   │          │  │ desks  │ desks  │ desks   ││ │ desks  │ desks  │      ││ ☕🛋   │
 *   │          │  │────────│────────│─────────││ │────────│────────│──────││        │
 *   │  plants  │  └────────┴────────┴─────────┘│ └────────┴────────┴──────┘│ 🪴     │
 *   │          │      (thin dividers)    ┃      │     (thin dividers)       │        │
 *   ├──────────┼─────────────────────────╂──────┼───────────────────────────┤ SERVER │
 *   │          │     COMMON AISLE        ┃      │        COMMON AISLE       │ CLOSET │
 *   │          │                    (thick partition)                        │ 🖥🖥   │
 *   └──────────┴─────────────────────────┴──────┴───────────────────────────┴────────┘
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

/** Minimum width of a crew section (tiles) */
const MIN_SECTION_WIDTH = 6;

/** Desk spacing within a section (tiles between desk centers) */
const DESK_SPACING = 2;

/** Padding inside each section (tiles) */
const SECTION_PADDING = 1;

/** Elevator area width (tiles) */
const ELEVATOR_WIDTH = 4;

/** Break room + server closet width (tiles) */
const UTILITY_WIDTH = 5;

/** Common aisle height (tiles) — walkable corridor at bottom */
const AISLE_HEIGHT = 2;

/** Main work area height (tiles) — above the aisle */
const WORK_AREA_HEIGHT = 10;

/** Total floor height */
const FLOOR_HEIGHT = WORK_AREA_HEIGHT + AISLE_HEIGHT;

/** Section divider width (1 tile — subtle within-phase divider) */
const DIVIDER_WIDTH = 1;

/** Phase partition width (2 tiles — thicker between-phase divider) */
const PHASE_PARTITION_WIDTH = 1;

/** Default desks per section when no minion count data available */
const DEFAULT_DESKS_PER_SECTION = 3;

/** Default number of stages per phase (matches pipeline view PHASE_SIZE) */
const DEFAULT_PHASE_SIZE = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Phase Colors — distinct hue for each phase partition band
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
 * Fill a single column as a subtle section divider (slightly lighter floor).
 */
function fillDivider(
  tiles: TileType[],
  tileColors: Array<TileColorConfig | null>,
  cols: number,
  col: number,
  startRow: number,
  height: number,
): void {
  const dividerColor: TileColorConfig = { h: 220, s: 8, b: 3 };
  for (let r = startRow; r < startRow + height; r++) {
    const idx = r * cols + col;
    if (idx >= 0 && idx < tiles.length) {
      tiles[idx] = TT.FLOOR_2;
      tileColors[idx] = dividerColor;
    }
  }
}

/**
 * Fill a phase partition — thicker (2-tile) band with distinct phase color.
 * Uses WALL tiles on top row and colored FLOOR on bottom row for a conveyor-belt feel.
 */
function fillPhasePartition(
  tiles: TileType[],
  tileColors: Array<TileColorConfig | null>,
  cols: number,
  col: number,
  startRow: number,
  height: number,
  phaseColor: TileColorConfig,
): void {
  for (let c = col; c < col + PHASE_PARTITION_WIDTH; c++) {
    for (let r = startRow; r < startRow + height; r++) {
      const idx = r * cols + c;
      if (idx >= 0 && idx < tiles.length) {
        tiles[idx] = TT.FLOOR_1;
        tileColors[idx] = { ...phaseColor, b: phaseColor.b + 3 };
      }
    }
  }
}

/**
 * Calculate width needed for a crew section based on desk count.
 */
function calcSectionWidth(deskCount: number): number {
  const desksNeeded = Math.max(deskCount, 2); // Minimum 2 desks per section
  return Math.max(MIN_SECTION_WIDTH, desksNeeded * DESK_SPACING + SECTION_PADDING * 2);
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
 * Generate an open-plan floor layout based on the project's crew configuration.
 *
 * Layout structure:
 *   Elevator | Phase Partitions [ Crew Sections (with dividers) ] | Break Room + Server Closet
 *   ─────────────── COMMON AISLE ────────────────────────────────────────────────────────────
 *
 * Crews are grouped into phases (default 3 per phase, matching the pipeline view).
 * Within a phase, sections have subtle 1-tile dividers. Between phases, a thicker
 * 2-tile partition band with distinct color provides visual separation — like
 * conveyor belt zones on a factory floor.
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
  const crewCount = effectiveCrews.length;

  // Group into phases
  const phases = groupIntoPhases(effectiveCrews, phaseSize);
  const phaseCount = phases.length;

  // Calculate section widths
  const sectionWidths: number[] = [];
  for (let i = 0; i < crewCount; i++) {
    const crew = effectiveCrews[i];
    const crewId = crew?.id ?? `default_crew_${i}`;
    const deskCount = minionCounts?.get(crewId) ?? DEFAULT_DESKS_PER_SECTION;
    sectionWidths.push(calcSectionWidth(deskCount));
  }

  // Total within-phase divider space (between sections in same phase)
  let withinPhaseDividers = 0;
  for (const phase of phases) {
    withinPhaseDividers += Math.max(0, phase.length - 1) * DIVIDER_WIDTH;
  }

  // Total between-phase partition space
  const betweenPhasePartitions = Math.max(0, phaseCount - 1) * PHASE_PARTITION_WIDTH;

  // Calculate total width
  const sectionsWidth = sectionWidths.reduce((sum, w) => sum + w, 0) + withinPhaseDividers + betweenPhasePartitions;
  const totalCols = ELEVATOR_WIDTH + sectionsWidth + UTILITY_WIDTH;
  const totalRows = FLOOR_HEIGHT;

  // Initialize tiles and colors
  const tiles: TileType[] = new Array(totalCols * totalRows).fill(TT.VOID);
  const tileColors: Array<TileColorConfig | null> = new Array(totalCols * totalRows).fill(null);
  const furniture: PlacedFurniture[] = [];
  const rooms: RoomDefinition[] = [];

  // ── Elevator (spawn area) ────────────────────────────────────────────────
  const elevatorCol = 0;
  fillRect(tiles, totalCols, elevatorCol, 0, ELEVATOR_WIDTH, WORK_AREA_HEIGHT, TT.FLOOR_2);

  rooms.push({
    id: "elevator",
    zone: RoomZone.ELEVATOR,
    label: "Elevator",
    bounds: { col: elevatorCol, row: 0, width: ELEVATOR_WIDTH, height: WORK_AREA_HEIGHT },
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
    row: WORK_AREA_HEIGHT - 2,
    roomId: "elevator",
  });

  // ── Common Aisle (walkable corridor at bottom) ───────────────────────────
  fillRect(tiles, totalCols, 0, WORK_AREA_HEIGHT, totalCols, AISLE_HEIGHT, TT.FLOOR_1);

  rooms.push({
    id: "common_aisle",
    zone: RoomZone.COMMON_AISLE,
    label: "Aisle",
    bounds: { col: 0, row: WORK_AREA_HEIGHT, width: totalCols, height: AISLE_HEIGHT },
  });

  // ── Phase Partitions + Crew Sections ──────────────────────────────────────
  let cursor = ELEVATOR_WIDTH;
  let globalCrewIdx = 0;

  for (let phaseIdx = 0; phaseIdx < phaseCount; phaseIdx++) {
    const phase = phases[phaseIdx];
    const phaseColor = PHASE_PARTITION_COLORS[phaseIdx % PHASE_PARTITION_COLORS.length];
    const phaseStartCol = cursor;

    // Render each crew section within this phase
    for (let localIdx = 0; localIdx < phase.length; localIdx++) {
      const crew = phase[localIdx];
      const crewId = crew.id;
      const crewName = crew.name;
      const crewColor = resolveCrewColor(crew.color);
      const sectionWidth = sectionWidths[globalCrewIdx];
      const sectionCol = cursor;
      const roomId = `section_${crewId}`;

      // Fill section floor (work area only — aisle is already filled)
      const floorVariant = (TT.FLOOR_3 + (globalCrewIdx % 5)) as TileType;
      fillRect(tiles, totalCols, sectionCol, 0, sectionWidth, WORK_AREA_HEIGHT, floorVariant);

      // Apply crew color tint
      const tileColor = hexToTileColor(crewColor, 18, 4);
      fillColorRect(tileColors, totalCols, sectionCol, 0, sectionWidth, WORK_AREA_HEIGHT, tileColor);

      rooms.push({
        id: roomId,
        zone: RoomZone.CREW_SECTION,
        label: crewName,
        bounds: { col: sectionCol, row: 0, width: sectionWidth, height: WORK_AREA_HEIGHT },
        crewId,
        crewColor,
      });

      // Place desks in the section (2 rows of desks)
      const deskCount = minionCounts?.get(crewId) ?? DEFAULT_DESKS_PER_SECTION;
      const maxDesksPerRow = Math.max(1, Math.floor((sectionWidth - SECTION_PADDING * 2) / DESK_SPACING));
      const desksPerRow = Math.min(Math.ceil(deskCount / 2), maxDesksPerRow);

      // Top row of desks (row 1-2)
      for (let d = 0; d < desksPerRow; d++) {
        const deskCol = sectionCol + SECTION_PADDING + d * DESK_SPACING;
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "desk",
          col: deskCol,
          row: 1,
          roomId,
        });
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "chair",
          col: deskCol,
          row: 2,
          roomId,
        });
      }

      // Bottom row of desks (row 4-5)
      const bottomRowDesks = Math.min(Math.max(0, deskCount - desksPerRow), maxDesksPerRow);
      for (let d = 0; d < bottomRowDesks; d++) {
        const deskCol = sectionCol + SECTION_PADDING + d * DESK_SPACING;
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "desk",
          col: deskCol,
          row: 4,
          roomId,
        });
        furniture.push({
          uid: nextFurnitureUid(),
          catalogId: "chair",
          col: deskCol,
          row: 5,
          roomId,
        });
      }

      // Whiteboard at the top of each section
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "whiteboard",
        col: sectionCol + Math.floor(sectionWidth / 2),
        row: 0,
        roomId,
      });

      // Plant decoration at bottom
      furniture.push({
        uid: nextFurnitureUid(),
        catalogId: "plant",
        col: sectionCol,
        row: WORK_AREA_HEIGHT - 2,
        roomId,
      });

      cursor += sectionWidth;
      globalCrewIdx++;

      // Add within-phase divider between sections (not after last in phase)
      if (localIdx < phase.length - 1) {
        fillDivider(tiles, tileColors, totalCols, cursor, 0, WORK_AREA_HEIGHT);
        cursor += DIVIDER_WIDTH;
      }
    }

    // Track the phase end column (for metadata)
    const phaseEndCol = cursor;
    const phaseWidth = phaseEndCol - phaseStartCol;

    // Add phase as a metadata room (for labels, jump-to-section, etc.)
    // Using COMMON_AISLE zone since we don't want characters assigned here
    rooms.push({
      id: `phase_${phaseIdx}`,
      zone: RoomZone.COMMON_AISLE,
      label: `Phase ${phaseIdx + 1}`,
      bounds: { col: phaseStartCol, row: 0, width: phaseWidth, height: WORK_AREA_HEIGHT },
    });

    // Add between-phase partition (not after the last phase)
    if (phaseIdx < phaseCount - 1) {
      fillPhasePartition(tiles, tileColors, totalCols, cursor, 0, FLOOR_HEIGHT, phaseColor);
      cursor += PHASE_PARTITION_WIDTH;
    }
  }

  // ── Break Room (top-right, archived minions) ─────────────────────────────
  const utilityCol = totalCols - UTILITY_WIDTH;
  const breakRoomHeight = Math.floor(WORK_AREA_HEIGHT * 0.6);
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

  // ── Server Closet (bottom-right, MCP servers) ───────────────────────────
  const serverClosetRow = breakRoomHeight;
  const serverClosetHeight = WORK_AREA_HEIGHT - breakRoomHeight;
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
