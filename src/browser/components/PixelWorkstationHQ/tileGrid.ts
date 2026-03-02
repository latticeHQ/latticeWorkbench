/**
 * Mini tile grid + BFS pathfinding for pixel workstation card scenes.
 *
 * The scene is 12 columns × 8 rows. Each tile is 3 pixel-space units
 * (rendered at 3× CSS scale → 9px on screen).
 *
 * The desk SVG occupies the top ~5 rows (monitors, desk surface, legs).
 * Rows 5–7 are the FLOOR area where characters walk.
 * Row 4 (desk legs) has walkable gaps to connect floor ↔ seat.
 *
 * Coordinate mapping to desk SVG (viewBox "-2 0 34 14"):
 *   Tile col 0 center → SVG x ≈ -0.5 (lamp)
 *   Tile col 11 center → SVG x ≈ 32.5 (shelf edge)
 *   Tile row 0–4 → SVG y 0–15 (desk area)
 *   Tile row 5–7 → SVG y 15–24 (floor, below desk)
 *
 * Grid layout (F=furniture/blocked, .=walkable, S=seat):
 *
 *    0  1  2  3  4  5  6  7  8  9  10  11
 *  ┌──────────────────────────────────────┐
 * 0│  F  F  F  F  F  F  F  F  F  F  F  F │  wall / monitors
 * 1│  F  F  F  F  F  F  F  F  F  F  F  F │  monitors / shelf
 * 2│  F  F  F  F  F  F  F  F  F  F  F  F │  desk edge / screens
 * 3│  F  F  F  F  F  F  F  F  F  F  F  F │  desk surface / keyboard
 * 4│  .  F  .  .  S  .  .  .  F  F  F  . │  desk legs (gaps = path to seat)
 * 5│  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 6│  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 7│  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 *  └──────────────────────────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────
// Grid constants
// ─────────────────────────────────────────────────────────────────────────────

export const SCENE_COLS = 12;
export const SCENE_ROWS = 8;

/** Pixel-space size per tile (before CSS 3× scale). */
export const MINI_TILE_PX = 3;

/** Total pixel-space scene dimensions. */
export const SCENE_PX_W = SCENE_COLS * MINI_TILE_PX; // 36
export const SCENE_PX_H = SCENE_ROWS * MINI_TILE_PX; // 24

/** Screen-space desk SVG dimensions (viewBox "-2 0 34 14" at 3× scale). */
export const DESK_SVG_W = 102;
export const DESK_SVG_H = 42;

/** The tile where a character sits to work (at desk legs level, front of keyboard). */
export const DESK_SEAT = { col: 4, row: 4 } as const;

/** First floor row (used for wander target filtering). */
const FLOOR_ROW_START = 5;

/** Walkable tiles — true = walkable, false = blocked by furniture. */
const WALKABLE_MAP: boolean[][] = [
  //  0     1     2     3     4     5     6     7     8     9    10    11
  [false,false,false,false,false,false,false,false,false,false,false,false], // row 0: wall/monitors
  [false,false,false,false,false,false,false,false,false,false,false,false], // row 1: monitors/shelf
  [false,false,false,false,false,false,false,false,false,false,false,false], // row 2: screens/desk edge
  [false,false,false,false,false,false,false,false,false,false,false,false], // row 3: desk surface/keyboard
  [ true,false, true, true, true, true, true, true,false,false,false, true], // row 4: desk legs (seat + gaps)
  [ true, true, true, true, true, true, true, true, true, true, true, true], // row 5: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true], // row 6: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true], // row 7: floor
];

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export function isWalkable(col: number, row: number): boolean {
  if (row < 0 || row >= SCENE_ROWS || col < 0 || col >= SCENE_COLS) return false;
  return WALKABLE_MAP[row][col];
}

// ─────────────────────────────────────────────────────────────────────────────
// BFS pathfinding
// ─────────────────────────────────────────────────────────────────────────────

interface Tile {
  col: number;
  row: number;
}

/** 4-connected neighbor offsets (up, right, down, left). */
const DIRS: [number, number][] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/**
 * BFS pathfind from start to end on the walkable grid.
 * Returns the path as an array of tiles **excluding** the start tile.
 * Returns empty array if no path or start === end.
 */
export function findPath(
  startCol: number, startRow: number,
  endCol: number, endRow: number,
): Tile[] {
  if (startCol === endCol && startRow === endRow) return [];
  if (!isWalkable(endCol, endRow)) return [];

  // BFS
  const key = (c: number, r: number) => r * SCENE_COLS + c;
  const visited = new Set<number>();
  const parent = new Map<number, number>();
  const queue: number[] = [];

  const startKey = key(startCol, startRow);
  const endKey = key(endCol, endRow);
  visited.add(startKey);
  queue.push(startKey);

  let found = false;
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === endKey) { found = true; break; }

    const cr = Math.floor(cur / SCENE_COLS);
    const cc = cur % SCENE_COLS;

    for (const [dc, dr] of DIRS) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (!isWalkable(nc, nr)) continue;
      const nk = key(nc, nr);
      if (visited.has(nk)) continue;
      visited.add(nk);
      parent.set(nk, cur);
      queue.push(nk);
    }
  }

  if (!found) return [];

  // Reconstruct path (end → start), then reverse, exclude start
  const path: Tile[] = [];
  let cur = endKey;
  while (cur !== startKey) {
    const r = Math.floor(cur / SCENE_COLS);
    const c = cur % SCENE_COLS;
    path.push({ col: c, row: r });
    cur = parent.get(cur)!;
  }
  path.reverse();
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinate conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert tile coordinates to pixel-space center point.
 * The pixel-space values are pre-scale (multiply by CSS scale for screen coords).
 */
export function tileToPixel(col: number, row: number): { x: number; y: number } {
  return {
    x: col * MINI_TILE_PX + Math.floor(MINI_TILE_PX / 2),
    y: row * MINI_TILE_PX + Math.floor(MINI_TILE_PX / 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Random tile picker
// ─────────────────────────────────────────────────────────────────────────────

/** All walkable tiles, pre-computed. */
const ALL_WALKABLE: Tile[] = [];
/** Floor-only walkable tiles (rows 5+), for wander targets. */
const FLOOR_WALKABLE: Tile[] = [];

for (let r = 0; r < SCENE_ROWS; r++) {
  for (let c = 0; c < SCENE_COLS; c++) {
    if (WALKABLE_MAP[r][c]) {
      ALL_WALKABLE.push({ col: c, row: r });
      if (r >= FLOOR_ROW_START) {
        FLOOR_WALKABLE.push({ col: c, row: r });
      }
    }
  }
}

/**
 * Pick a random FLOOR tile for wander targets.
 * Only returns tiles from the floor area (row 5+), never desk-area tiles.
 */
export function getRandomWalkableTile(
  excludeCol?: number,
  excludeRow?: number,
): Tile {
  let candidates = FLOOR_WALKABLE;
  if (excludeCol !== undefined && excludeRow !== undefined) {
    candidates = FLOOR_WALKABLE.filter(
      t => t.col !== excludeCol || t.row !== excludeRow
    );
  }
  if (candidates.length === 0) return { col: 4, row: 6 };
  return candidates[Math.floor(Math.random() * candidates.length)];
}
