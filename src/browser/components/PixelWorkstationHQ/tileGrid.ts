/**
 * Mini tile grid + BFS pathfinding for pixel workstation card scenes.
 *
 * The scene is 16 columns × 16 rows. Each tile is 3 pixel-space units
 * (rendered at 3× CSS scale → 9px on screen).
 *
 * The desk SVG occupies the top ~6 rows (wall, monitors, desk surface, legs).
 * Rows 6–15 are the FLOOR area where characters walk.
 * Row 5 (chair row) has walkable gaps to connect floor ↔ seat.
 *
 * Grid layout (F=furniture/blocked, .=walkable, S=seat):
 *
 *      0  1  2  3  4  5  6  7  8  9  10 11 12 13 14 15
 *    ┌──────────────────────────────────────────────────┐
 *  0 │  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F │  wall
 *  1 │  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F │  monitors
 *  2 │  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F │  screens
 *  3 │  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F │  desk surface
 *  4 │  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F  F │  desk edge
 *  5 │  .  F  .  .  .  S  .  .  .  .  F  F  .  .  .  . │  chair row
 *  6 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 *  7 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 *  8 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 *  9 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 10 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 11 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 12 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 13 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 14 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 * 15 │  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  . │  floor
 *    └──────────────────────────────────────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────
// Grid constants
// ─────────────────────────────────────────────────────────────────────────────

export const SCENE_COLS = 16;
export const SCENE_ROWS = 16;

/** Pixel-space size per tile (before CSS 3× scale). */
export const MINI_TILE_PX = 3;

/** Total pixel-space scene dimensions. */
export const SCENE_PX_W = SCENE_COLS * MINI_TILE_PX; // 48
export const SCENE_PX_H = SCENE_ROWS * MINI_TILE_PX; // 48

/** Screen-space scene dimensions at 3× scale. */
export const SCENE_SCREEN_W = SCENE_PX_W * 3; // 144
export const SCENE_SCREEN_H = SCENE_PX_H * 3; // 144

/** The tile where a character sits to work (chair position, front of keyboard). */
export const DESK_SEAT = { col: 5, row: 5 } as const;

/** First floor row (used for wander target filtering). */
const FLOOR_ROW_START = 6;

/** Walkable tiles — true = walkable, false = blocked by furniture. */
const WALKABLE_MAP: boolean[][] = [
  //  0     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15
  [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false], // row  0: wall
  [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false], // row  1: monitors
  [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false], // row  2: screens
  [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false], // row  3: desk surface
  [false,false,false,false,false,false,false,false,false,false,false,false,false,false,false,false], // row  4: desk edge
  [ true,false, true, true, true, true, true, true, true, true,false,false, true, true, true, true], // row  5: chair row (gaps)
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row  6: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row  7: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row  8: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row  9: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 10: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 11: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 12: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 13: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 14: floor
  [ true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true], // row 15: floor
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
/** Floor-only walkable tiles (rows 6+), for wander targets. */
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
 * Only returns tiles from the floor area (row 6+), never desk-area tiles.
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
  if (candidates.length === 0) return { col: 5, row: 7 };
  return candidates[Math.floor(Math.random() * candidates.length)];
}
