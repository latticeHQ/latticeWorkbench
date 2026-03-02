/**
 * CardScene — Canvas 2D renderer for individual minion workstation cards.
 *
 * Replaces PixelCharacter (box-shadow) + PixelDesk (SVG) with a single
 * canvas rendering pipeline.
 *
 * Render pipeline per frame:
 *   1. Clear canvas
 *   2. Draw wood floor background (themed)
 *   3. Draw ambient glow (if live)
 *   4. Draw pre-rendered desk
 *   5. Draw character sprite from atlas
 */

import type { SceneSubscriber } from "./gameLoop";
import type { CharacterAppearance, CharPalette, DeskPalette, TimeOfDay } from "../sprites/types";
import { CHAR_GRID_W } from "../sprites/types";
import { getSpriteAtlas, type SpriteAtlas } from "./spriteCache";
import { getDeskCanvas, type DeskRenderCache } from "./deskRenderer";
import { WalkController } from "./walkController";
import { drawWoodFloor, drawAmbientGlow, getThemeMode } from "./environmentRenderer";
import { SCENE_SCREEN_W, SCENE_SCREEN_H } from "../tileGrid";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Rendering scale (pixel-space → screen pixels). */
const SCALE = 3;

/** Row in the character grid where feet are (anchor point). */
const CHAR_FEET_ROW = 16;

/** Desk occupies roughly the top 33% of the scene. */
const DESK_Y_OFFSET = 0; // pixel-space Y where desk is drawn

// ─────────────────────────────────────────────────────────────────────────────
// CardScene
// ─────────────────────────────────────────────────────────────────────────────

export class CardScene implements SceneSubscriber {
  private ctx: CanvasRenderingContext2D;
  private walk: WalkController;
  private atlas: SpriteAtlas;
  private deskCache: DeskRenderCache;
  private _visible = true;

  // State
  private isLive = false;
  private accentHex = "#6366f1";
  private timeOfDay: TimeOfDay = "afternoon";

  constructor(
    canvas: HTMLCanvasElement,
    appearance: CharacterAppearance,
    charPalette: CharPalette,
    deskPalette: DeskPalette,
    timeOfDay: TimeOfDay,
    accentHex: string,
  ) {
    this.accentHex = accentHex;
    this.timeOfDay = timeOfDay;

    // Setup canvas
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SCENE_SCREEN_W * dpr;
    canvas.height = SCENE_SCREEN_H * dpr;
    canvas.style.width = `${SCENE_SCREEN_W}px`;
    canvas.style.height = `${SCENE_SCREEN_H}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    // Build resources
    this.atlas = getSpriteAtlas(appearance, charPalette);
    this.deskCache = getDeskCanvas(deskPalette);
    this.walk = new WalkController();
  }

  // ── React prop sync ──

  updateState(isActive: boolean, isWaiting: boolean, isDone: boolean): void {
    this.walk.setActive(isActive);
    this.walk.setWaiting(isWaiting);
    this.walk.setDone(isDone);
    this.isLive = isActive;
  }

  updatePalettes(
    appearance: CharacterAppearance,
    charPalette: CharPalette,
    deskPalette: DeskPalette,
    timeOfDay: TimeOfDay,
    accentHex: string,
  ): void {
    this.atlas = getSpriteAtlas(appearance, charPalette);
    this.deskCache = getDeskCanvas(deskPalette);
    this.timeOfDay = timeOfDay;
    this.accentHex = accentHex;
  }

  setVisible(v: boolean): void { this._visible = v; }

  // ── SceneSubscriber ──

  isActive(): boolean { return this._visible; }

  update(dt: number): void {
    this.walk.update(dt);
  }

  render(): void {
    const ctx = this.ctx;
    const W = SCENE_SCREEN_W;
    const H = SCENE_SCREEN_H;
    const theme = getThemeMode();

    // 1. Clear
    ctx.clearRect(0, 0, W, H);

    // 2. Wood floor background (themed)
    drawWoodFloor(ctx, 0, 0, W, H, this.timeOfDay, theme);

    // 3. Ambient glow when live
    if (this.isLive) {
      drawAmbientGlow(ctx, W / 2, H * 0.35, W * 0.6, this.accentHex, 0.12);
    }

    // 4. Draw desk (scaled 3× from 48×16 to 144×48)
    const dc = this.deskCache;
    ctx.drawImage(dc.canvas, 0, 0, dc.width, dc.height, 0, DESK_Y_OFFSET, W, dc.height * SCALE);

    // 5. Draw character sprite
    this.drawCharacter(ctx);
  }

  private drawCharacter(ctx: CanvasRenderingContext2D): void {
    const atlas = this.atlas;
    const state = this.walk.charState;
    const off = atlas.stateOffsets[state];
    const frameIdx = this.walk.frameIndex % off.count;
    const srcX = (off.start + frameIdx) * atlas.frameWidth;

    // Character position: feet-anchored
    const screenX = this.walk.x * SCALE - (CHAR_GRID_W * SCALE) / 2;
    const screenY = this.walk.y * SCALE - CHAR_FEET_ROW * SCALE;

    ctx.drawImage(
      atlas.canvas,
      srcX, 0, atlas.frameWidth, atlas.frameHeight,           // source rect
      Math.round(screenX), Math.round(screenY),                // dest position
      atlas.frameWidth * SCALE, atlas.frameHeight * SCALE,     // dest size
    );
  }

  dispose(): void {
    // Nothing to explicitly clean up — caches are shared
  }
}
