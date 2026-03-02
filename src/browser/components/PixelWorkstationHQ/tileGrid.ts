/**
 * Mini tile grid + BFS pathfinding for pixel workstation card scenes.
 *
 * Each card's pixel scene is a 12×5 tile grid. Each tile is 3px in pixel-space
 * (rendered at 3× scale → 9px on screen). The grid defines walkable areas,
 * furniture obstacles, and utility functions for pathfinding.
 *
 * Grid layout:
 *    0  1  2  3  4  5  6  7  8  9  10  11
 *  ┌──────────────────────────────────────┐
 * 0│  .  .  .  M  M  M  m  m  .  .  B  B │  monitors/bookshelf
 * 1│  .  .  .  .  .  .  .  .  .  .  .  . │  walkable corridor
 * 2│  .  .  .  .  S  .  .  .  .  .  .  . │  walkable (S=seat)
 * 3│  D  D  K  K  K  K  K  K  .  .  P  P │  desk/keyboard/plant
 * 4│  D  D  .  .  .  .  .  .  .  .  P  . │  desk legs/plant
 *  └──────────────────────────────────────┘
 */

// ─────────────────────────────────────────────────────────────────────────────
// Grid constants
// ─────────────────────────────────────────────────────────────────────────────

export const SCENE_COLS = 12;
export const SCENE_ROWS = 5;

/** Pixel-space size per tile (before CSS 3× scale). */
export const MINI_TILE_PX = 3;

/** Total pixel-space scene dimensions. */
export const SCENE_PX_W = SCENE_COLS * MINI_TILE_PX; // 36
export const SCENE_PX_H = SCENE_ROWS * MINI_TILE_PX; // 15

/** The tile where a character sits to work (in front of the keyboard, facing monitors). */
export const DESK_SEAT = { col: 4, row: 2 } as const;

/** Walkable tiles — true = walkable, false = blocked by furniture. */
const WALKABLE_MAP: boolean[][] = [
  // Row 0: monitors + bookshelf on wall
  [true, true, true, false, false, false, false, false, true, true, false, false],
  // Row 1: open corridor behind desk
  [true, true, true, true, true, true, true, true, true, true, true, true],
  // Row 2: walkable area (desk seat at col 4)
  [true, true, true, true, true, true, true, true, true, true, true, true],
  // Row 3: desk surface + keyboard + plant
  [false, false, false, false, false, false, false, false, true, true, false, false],
  // Row 4: desk legs + plant pot (partially blocked)
  [false, false, true, true, true, true, true, true, true, true, false, true],
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

/** All walkable tiles, pre-computed for random selection. */
const ALL_WALKABLE: Tile[] = [];
for (let r = 0; r < SCENE_ROWS; r++) {
  for (let c = 0; c < SCENE_COLS; c++) {
    if (WALKABLE_MAP[r][c]) ALL_WALKABLE.push({ col: c, row: r });
  }
}

/**
 * Pick a random walkable tile. Optionally exclude a specific tile
 * (e.g. current position to avoid picking the same spot).
 */
export function getRandomWalkableTile(
  excludeCol?: number,
  excludeRow?: number,
): Tile {
  let candidates = ALL_WALKABLE;
  if (excludeCol !== undefined && excludeRow !== undefined) {
    candidates = ALL_WALKABLE.filter(
      t => t.col !== excludeCol || t.row !== excludeRow
    );
  }
  if (candidates.length === 0) return { col: 0, row: 0 };
  return candidates[Math.floor(Math.random() * candidates.length)];
}
