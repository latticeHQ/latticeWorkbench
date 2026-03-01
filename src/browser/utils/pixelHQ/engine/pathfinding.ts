/**
 * Pixel HQ Pathfinding
 *
 * BFS (Breadth-First Search) pathfinding on the tile grid.
 * Adapted from Pixel Agents' pathfinding implementation.
 */

import type { TileCoord } from "./types";

/** 4-directional neighbor offsets (no diagonals for pixel art grid movement) */
const NEIGHBORS: ReadonlyArray<TileCoord> = [
  { col: 0, row: -1 }, // UP
  { col: 0, row: 1 },  // DOWN
  { col: -1, row: 0 }, // LEFT
  { col: 1, row: 0 },  // RIGHT
];

/**
 * Find the shortest path between two tiles using BFS.
 *
 * @param startCol - Starting tile column
 * @param startRow - Starting tile row
 * @param endCol - Target tile column
 * @param endRow - Target tile row
 * @param walkable - 2D boolean array [row][col] indicating walkable tiles
 * @param cols - Grid width
 * @param rows - Grid height
 * @returns Array of tile coordinates from start (exclusive) to end (inclusive),
 *          or null if no path exists
 */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  walkable: boolean[][],
  cols: number,
  rows: number,
): TileCoord[] | null {
  // Same tile — no movement needed
  if (startCol === endCol && startRow === endRow) {
    return [];
  }

  // Bounds check
  if (
    startCol < 0 || startCol >= cols || startRow < 0 || startRow >= rows ||
    endCol < 0 || endCol >= cols || endRow < 0 || endRow >= rows
  ) {
    return null;
  }

  // Target must be walkable (or we won't find a path to it)
  if (!walkable[endRow]?.[endCol]) {
    return null;
  }

  // BFS
  const visited = new Set<number>();
  const parent = new Map<number, number>();
  const queue: number[] = [];

  const toKey = (c: number, r: number): number => r * cols + c;
  const fromKey = (key: number): TileCoord => ({
    col: key % cols,
    row: Math.floor(key / cols),
  });

  const startKey = toKey(startCol, startRow);
  const endKey = toKey(endCol, endRow);

  visited.add(startKey);
  queue.push(startKey);

  let found = false;
  let head = 0;

  while (head < queue.length) {
    const currentKey = queue[head++];

    if (currentKey === endKey) {
      found = true;
      break;
    }

    const current = fromKey(currentKey);

    for (const neighbor of NEIGHBORS) {
      const nc = current.col + neighbor.col;
      const nr = current.row + neighbor.row;

      // Bounds check
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const nKey = toKey(nc, nr);

      // Already visited
      if (visited.has(nKey)) continue;

      // Not walkable
      if (!walkable[nr]?.[nc]) continue;

      visited.add(nKey);
      parent.set(nKey, currentKey);
      queue.push(nKey);
    }
  }

  if (!found) return null;

  // Reconstruct path (end → start, then reverse)
  const path: TileCoord[] = [];
  let current = endKey;

  while (current !== startKey) {
    path.push(fromKey(current));
    const p = parent.get(current);
    if (p === undefined) break; // shouldn't happen if found === true
    current = p;
  }

  path.reverse();
  return path;
}

/**
 * Find the nearest walkable tile to a target, using BFS expansion.
 * Useful when the exact target is blocked (e.g., furniture on it).
 *
 * @param targetCol - Desired tile column
 * @param targetRow - Desired tile row
 * @param walkable - 2D boolean array [row][col]
 * @param cols - Grid width
 * @param rows - Grid height
 * @param maxRadius - Maximum search radius
 * @returns Nearest walkable TileCoord, or null if none found
 */
export function findNearestWalkable(
  targetCol: number,
  targetRow: number,
  walkable: boolean[][],
  cols: number,
  rows: number,
  maxRadius: number = 10,
): TileCoord | null {
  // Check target first
  if (
    targetCol >= 0 && targetCol < cols &&
    targetRow >= 0 && targetRow < rows &&
    walkable[targetRow]?.[targetCol]
  ) {
    return { col: targetCol, row: targetRow };
  }

  // BFS outward from target
  const visited = new Set<number>();
  const queue: TileCoord[] = [{ col: targetCol, row: targetRow }];
  const toKey = (c: number, r: number): number => r * cols + c;

  visited.add(toKey(targetCol, targetRow));

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];

    // Distance check
    const dist = Math.abs(current.col - targetCol) + Math.abs(current.row - targetRow);
    if (dist > maxRadius) continue;

    for (const neighbor of NEIGHBORS) {
      const nc = current.col + neighbor.col;
      const nr = current.row + neighbor.row;

      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;

      const nKey = toKey(nc, nr);
      if (visited.has(nKey)) continue;
      visited.add(nKey);

      if (walkable[nr]?.[nc]) {
        return { col: nc, row: nr };
      }

      queue.push({ col: nc, row: nr });
    }
  }

  return null;
}

/**
 * Get a random walkable tile within a radius of a center point.
 * Used for character wander behavior.
 *
 * @param centerCol - Center tile column
 * @param centerRow - Center tile row
 * @param radius - Maximum distance from center
 * @param walkable - 2D boolean array [row][col]
 * @param cols - Grid width
 * @param rows - Grid height
 * @returns Random walkable TileCoord within radius, or null if none found
 */
export function getRandomWalkableInRadius(
  centerCol: number,
  centerRow: number,
  radius: number,
  walkable: boolean[][],
  cols: number,
  rows: number,
): TileCoord | null {
  const candidates: TileCoord[] = [];

  const minCol = Math.max(0, centerCol - radius);
  const maxCol = Math.min(cols - 1, centerCol + radius);
  const minRow = Math.max(0, centerRow - radius);
  const maxRow = Math.min(rows - 1, centerRow + radius);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      // Manhattan distance check
      if (Math.abs(c - centerCol) + Math.abs(r - centerRow) > radius) continue;
      // Skip center
      if (c === centerCol && r === centerRow) continue;
      if (walkable[r]?.[c]) {
        candidates.push({ col: c, row: r });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
