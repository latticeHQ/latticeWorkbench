/**
 * Desk pre-renderer — draws all desk furniture rects to an offscreen canvas
 * for fast `drawImage()` blitting.
 *
 * Cached by desk palette hash.
 */

import type { DeskPalette } from "../sprites/types";
import { DESK_RECTS } from "../sprites/deskData";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskRenderCache {
  canvas: HTMLCanvasElement;
  /** Pixel-space width (viewbox extent). */
  width: number;
  /** Pixel-space height (viewbox extent). */
  height: number;
  /** X offset applied to rects (to handle viewbox starting at x=-2). */
  offsetX: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

const deskCache = new Map<string, DeskRenderCache>();

function deskPaletteHash(p: DeskPalette): string {
  return `${p.desk}-${p.screen}-${p.monitor}-${p.mug}-${p.lampShade}-${p.poster}-${p.chair}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

/** Viewbox: "-2 0 48 16" → width=48, height=16, offsetX=2 */
const VB_WIDTH = 48;
const VB_HEIGHT = 16;
const VB_OFFSET_X = 2; // shifts rects right because viewbox starts at x=-2

function buildDeskCanvas(palette: DeskPalette): DeskRenderCache {
  const canvas = document.createElement("canvas");
  canvas.width = VB_WIDTH;
  canvas.height = VB_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  for (const rect of DESK_RECTS) {
    ctx.fillStyle = palette[rect.colorKey];
    ctx.fillRect(rect.x + VB_OFFSET_X, rect.y, rect.w, rect.h);
  }

  return { canvas, width: VB_WIDTH, height: VB_HEIGHT, offsetX: VB_OFFSET_X };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Get or build a pre-rendered desk canvas for the given palette. */
export function getDeskCanvas(palette: DeskPalette): DeskRenderCache {
  const key = deskPaletteHash(palette);
  let cached = deskCache.get(key);
  if (!cached) {
    cached = buildDeskCanvas(palette);
    deskCache.set(key, cached);
  }
  return cached;
}

/** Invalidate all cached desk canvases. */
export function clearDeskCache(): void {
  deskCache.clear();
}
