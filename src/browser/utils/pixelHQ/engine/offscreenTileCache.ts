/**
 * Pixel HQ Offscreen Tile Cache
 *
 * Pre-renders the static tile layer (floors + walls) to an OffscreenCanvas.
 * This dramatically reduces per-frame work since tiles rarely change:
 *
 *   Without cache: ~4000 fillRect calls per frame (64x32 grid)
 *   With cache:     1 drawImage call per frame for the entire tile layer
 *
 * The cache is invalidated when:
 *   - The layout changes (tiles array modified)
 *   - The layout is resized
 *   - The day/night brightness changes significantly
 *   - The editor modifies tiles
 *
 * Works with both OffscreenCanvas (preferred, off-main-thread) and
 * fallback to regular HTMLCanvasElement for older browsers.
 */

import type { OfficeLayout, TileColorConfig } from "./types";
import { TileType as TT } from "./types";
import {
  TILE_SIZE,
  THEME_BG,
  THEME_FLOOR_COLORS,
  THEME_WALL,
  THEME_WALL_ACCENT,
} from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// OffscreenTileCache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages an offscreen canvas that holds a pre-rendered tile layer.
 *
 * Usage:
 * ```ts
 * const cache = new OffscreenTileCache();
 * cache.rebuild(layout);
 *
 * // In render loop:
 * if (cache.isDirty) cache.rebuild(layout);
 * cache.drawTo(ctx);
 * ```
 */
export class OffscreenTileCache {
  /** The offscreen canvas holding the rendered tiles */
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

  /** Layout dimensions at time of last build */
  private cachedCols: number = 0;
  private cachedRows: number = 0;

  /** Hash of the tiles array at time of last build (for change detection) */
  private cachedTileHash: number = 0;

  /** Brightness multiplier at time of last build */
  private cachedBrightness: number = 1.0;

  /** Whether the cache needs rebuilding */
  isDirty: boolean = true;

  /**
   * Rebuild the offscreen tile cache from the current layout.
   *
   * This is an expensive operation (~1-3ms for large grids) but only
   * needs to happen when tiles change. The result is stored in an
   * offscreen canvas that can be drawn in a single drawImage call.
   *
   * @param layout - Current office layout
   * @param brightness - Day/night brightness multiplier (0-1)
   */
  rebuild(layout: OfficeLayout, brightness: number = 1.0): void {
    const { cols, rows, tiles, tileColors } = layout;
    const width = cols * TILE_SIZE;
    const height = rows * TILE_SIZE;

    // Allocate or resize canvas
    if (
      !this.canvas ||
      this.cachedCols !== cols ||
      this.cachedRows !== rows
    ) {
      this.canvas = this.createCanvas(width, height);
      this.ctx = this.canvas.getContext("2d") as
        | OffscreenCanvasRenderingContext2D
        | CanvasRenderingContext2D
        | null;
      if (this.ctx) {
        (this.ctx as CanvasRenderingContext2D).imageSmoothingEnabled = false;
      }
    }

    if (!this.ctx) return;

    const ctx = this.ctx;

    // Clear
    ctx.fillStyle = THEME_BG;
    ctx.fillRect(0, 0, width, height);

    // Draw tiles
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const tile = tiles[idx];
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;

        if (tile === TT.VOID) continue;

        if (tile === TT.WALL) {
          // Wall tiles
          ctx.fillStyle = this.adjustBrightness(THEME_WALL, brightness);
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

          // Wall top accent line
          ctx.fillStyle = this.adjustBrightness(THEME_WALL_ACCENT, brightness);
          ctx.fillRect(x, y, TILE_SIZE, 1);
        } else {
          // Floor tiles
          const floorIndex = tile - TT.FLOOR_1;
          const baseColor = THEME_FLOOR_COLORS[floorIndex] ?? THEME_FLOOR_COLORS[0];
          let color: string = baseColor;

          // Apply tile color tint if present
          const tileColor = tileColors?.[idx];
          if (tileColor) {
            color = this.applyTileColorTint(baseColor, tileColor);
          }

          ctx.fillStyle = this.adjustBrightness(color, brightness);
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

          // Subtle 1px grid line (very faint)
          ctx.fillStyle = `rgba(255, 255, 255, ${0.02 * brightness})`;
          ctx.fillRect(x, y, TILE_SIZE, 0.5);
          ctx.fillRect(x, y, 0.5, TILE_SIZE);
        }
      }
    }

    // Update cache metadata
    this.cachedCols = cols;
    this.cachedRows = rows;
    this.cachedTileHash = this.hashTiles(tiles);
    this.cachedBrightness = brightness;
    this.isDirty = false;
  }

  /**
   * Draw the cached tile layer onto the main rendering context.
   *
   * This is a single drawImage call, making it extremely fast
   * compared to iterating over all tiles each frame.
   *
   * @param ctx - Main canvas rendering context
   */
  drawTo(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;
    ctx.drawImage(this.canvas as CanvasImageSource, 0, 0);
  }

  /**
   * Check if the cache needs rebuilding by comparing layout state.
   *
   * @param layout - Current layout to compare against cached state
   * @param brightness - Current brightness to compare
   * @returns Whether the cache needs rebuilding
   */
  needsRebuild(layout: OfficeLayout, brightness: number = 1.0): boolean {
    if (this.isDirty) return true;
    if (layout.cols !== this.cachedCols || layout.rows !== this.cachedRows) return true;
    if (Math.abs(brightness - this.cachedBrightness) > 0.05) return true;

    const currentHash = this.hashTiles(layout.tiles);
    if (currentHash !== this.cachedTileHash) return true;

    return false;
  }

  /**
   * Mark the cache as needing a rebuild.
   * Call this when the layout is edited.
   */
  invalidate(): void {
    this.isDirty = true;
  }

  /**
   * Get the current cache dimensions.
   */
  getDimensions(): { width: number; height: number } {
    return {
      width: this.cachedCols * TILE_SIZE,
      height: this.cachedRows * TILE_SIZE,
    };
  }

  /**
   * Dispose the offscreen canvas and free memory.
   */
  dispose(): void {
    this.canvas = null;
    this.ctx = null;
    this.isDirty = true;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /**
   * Create the best available offscreen canvas.
   * Prefers OffscreenCanvas for potential off-main-thread rendering,
   * falls back to regular HTMLCanvasElement.
   */
  private createCanvas(
    width: number,
    height: number,
  ): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    // Fallback
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /**
   * Simple fast hash of the tiles array for change detection.
   * Uses FNV-1a variant.
   */
  private hashTiles(tiles: readonly number[]): number {
    let hash = 2166136261;
    for (let i = 0; i < tiles.length; i++) {
      hash ^= tiles[i];
      hash = (hash * 16777619) | 0;
    }
    return hash >>> 0;
  }

  /**
   * Adjust a hex color's brightness by a multiplier.
   *
   * @param hex - Hex color string (#RRGGBB)
   * @param brightness - Multiplier (0-1)
   * @returns Adjusted hex color string
   */
  private adjustBrightness(hex: string, brightness: number): string {
    if (brightness >= 0.99 && brightness <= 1.01) return hex;

    const clean = hex.replace("#", "");
    const r = Math.round(parseInt(clean.substring(0, 2), 16) * brightness);
    const g = Math.round(parseInt(clean.substring(2, 4), 16) * brightness);
    const b = Math.round(parseInt(clean.substring(4, 6), 16) * brightness);

    return `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`;
  }

  /**
   * Apply a TileColorConfig tint to a base hex color.
   * Blends the tint based on saturation and brightness offsets.
   */
  private applyTileColorTint(
    baseHex: string,
    config: TileColorConfig,
  ): string {
    const clean = baseHex.replace("#", "");
    let r = parseInt(clean.substring(0, 2), 16);
    let g = parseInt(clean.substring(2, 4), 16);
    let b = parseInt(clean.substring(4, 6), 16);

    // Convert hue to RGB direction
    const hRad = (config.h * Math.PI) / 180;
    const tintR = Math.cos(hRad) * config.s * 0.5;
    const tintG = Math.cos(hRad - 2.094) * config.s * 0.5; // 120° offset
    const tintB = Math.cos(hRad - 4.189) * config.s * 0.5; // 240° offset

    r = Math.max(0, Math.min(255, r + tintR + config.b));
    g = Math.max(0, Math.min(255, g + tintG + config.b));
    b = Math.max(0, Math.min(255, b + tintB + config.b));

    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  }
}
