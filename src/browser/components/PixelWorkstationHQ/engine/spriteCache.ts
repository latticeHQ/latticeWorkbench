/**
 * Sprite atlas builder — pre-renders all character animation frames to
 * offscreen canvases for fast `drawImage()` blitting.
 *
 * One atlas per unique (appearance + palette) combination, cached by hash.
 */

import type { CharState, CharacterAppearance, CharPalette, PixelEntry } from "../sprites/types";
import { CHAR_GRID_W, CHAR_GRID_H } from "../sprites/types";
import { buildFrameSets, ANIM_INTERVALS } from "../sprites/characterFrames";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpriteAtlas {
  /** Offscreen canvas containing all frames in a horizontal strip. */
  canvas: HTMLCanvasElement;
  frameWidth: number;   // CHAR_GRID_W (12)
  frameHeight: number;  // CHAR_GRID_H (18)
  /** Lookup: state → { start frame index, frame count }. */
  stateOffsets: Record<CharState, { start: number; count: number }>;
  /** Animation interval per state (ms). */
  intervals: Record<CharState, number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

const atlasCache = new Map<string, SpriteAtlas>();

function paletteHash(palette: CharPalette, appearance: CharacterAppearance): string {
  return `${appearance.hairStyle}-${appearance.skinTone}-${palette.shirt}-${palette.shirtAccent}-${palette.skin}-${palette.hair}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────────────

function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  frame: PixelEntry[],
  palette: CharPalette,
  offsetX: number,
): void {
  for (const [col, row, colorKey] of frame) {
    ctx.fillStyle = palette[colorKey];
    ctx.fillRect(offsetX + col, row, 1, 1);
  }
}

function buildAtlas(
  appearance: CharacterAppearance,
  palette: CharPalette,
): SpriteAtlas {
  const frameSets = buildFrameSets(appearance);

  // Count total frames across all states
  const states: CharState[] = ["idle", "typing", "done", "waiting", "walk_right", "walk_left"];
  let totalFrames = 0;
  const offsets: Record<string, { start: number; count: number }> = {};

  for (const state of states) {
    const frames = frameSets[state];
    offsets[state] = { start: totalFrames, count: frames.length };
    totalFrames += frames.length;
  }

  // Create offscreen canvas strip
  const canvas = document.createElement("canvas");
  canvas.width = totalFrames * CHAR_GRID_W;
  canvas.height = CHAR_GRID_H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Render all frames
  let frameIdx = 0;
  for (const state of states) {
    for (const frame of frameSets[state]) {
      renderFrameToCanvas(ctx, frame, palette, frameIdx * CHAR_GRID_W);
      frameIdx++;
    }
  }

  return {
    canvas,
    frameWidth: CHAR_GRID_W,
    frameHeight: CHAR_GRID_H,
    stateOffsets: offsets as Record<CharState, { start: number; count: number }>,
    intervals: { ...ANIM_INTERVALS },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Get or build a sprite atlas for the given appearance + palette. */
export function getSpriteAtlas(
  appearance: CharacterAppearance,
  palette: CharPalette,
): SpriteAtlas {
  const key = paletteHash(palette, appearance);
  let atlas = atlasCache.get(key);
  if (!atlas) {
    atlas = buildAtlas(appearance, palette);
    atlasCache.set(key, atlas);
  }
  return atlas;
}

/** Invalidate all cached atlases (e.g. on theme change). */
export function clearSpriteCache(): void {
  atlasCache.clear();
}
