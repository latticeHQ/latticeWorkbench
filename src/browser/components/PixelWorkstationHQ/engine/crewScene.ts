/**
 * CrewScene — Canvas 2D renderer for shared crew workstation scenes.
 *
 * Multiple minions share one desk scene. Characters are rendered as actual
 * pixel art sprites (replacing the vector MinionSvg cartoon).
 *
 * Render pipeline per frame:
 *   1. Clear canvas
 *   2. Draw wall pattern (top ~33%)
 *   3. Draw floor pattern (bottom ~67%)
 *   4. Draw contact line
 *   5. Draw ambient glow (if any live minion)
 *   6. Draw pre-rendered desk (scaled to WORKSTATION_SCALE)
 *   7. Z-sort characters by Y position
 *   8. Draw each character's sprite from atlas
 */

import type { SceneSubscriber } from "./gameLoop";
import type { CharacterAppearance, CharPalette, DeskPalette, TimeOfDay } from "../sprites/types";
import { CHAR_GRID_W, CHAR_GRID_H } from "../sprites/types";
import { getSpriteAtlas, type SpriteAtlas } from "./spriteCache";
import { getDeskCanvas, type DeskRenderCache } from "./deskRenderer";
import { WalkController } from "./walkController";
import {
  drawSceneGrid, drawAmbientGlow, getThemeMode,
} from "./environmentRenderer";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Scale for shared crew desk (smaller than individual card SCALE=3). */
const CREW_DESK_SCALE = 2;

/** Character render scale in crew scene. */
const CREW_CHAR_SCALE = 2;

/** Row in character grid where feet are. */
const CHAR_FEET_ROW = 16;

/** Wall/floor split ratio. */
const WALL_RATIO = 0.33;

// ─────────────────────────────────────────────────────────────────────────────
// Character entry
// ─────────────────────────────────────────────────────────────────────────────

interface CharEntry {
  walk: WalkController;
  atlas: SpriteAtlas;
  appearance: CharacterAppearance;
  palette: CharPalette;
  isLive: boolean;
  accentHex: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CrewScene
// ─────────────────────────────────────────────────────────────────────────────

export class CrewScene implements SceneSubscriber {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private characters = new Map<string, CharEntry>();
  private deskCache: DeskRenderCache;
  private _visible = true;
  private timeOfDay: TimeOfDay = "afternoon";
  private _width: number;
  private _height: number;

  constructor(
    canvas: HTMLCanvasElement,
    deskPalette: DeskPalette,
    timeOfDay: TimeOfDay,
    width: number,
    height: number,
  ) {
    this.canvas = canvas;
    this.timeOfDay = timeOfDay;
    this._width = width;
    this._height = height;

    // Setup canvas with DPR
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;

    this.deskCache = getDeskCanvas(deskPalette);
  }

  // ── Character management ──

  addCharacter(
    minionId: string,
    appearance: CharacterAppearance,
    palette: CharPalette,
    accentHex: string,
  ): void {
    if (this.characters.has(minionId)) return;
    const entry: CharEntry = {
      walk: new WalkController(),
      atlas: getSpriteAtlas(appearance, palette),
      appearance,
      palette,
      isLive: false,
      accentHex,
    };
    this.characters.set(minionId, entry);
  }

  removeCharacter(minionId: string): void {
    this.characters.delete(minionId);
  }

  updateCharacterState(
    minionId: string,
    isActive: boolean,
    isWaiting: boolean,
    isDone: boolean,
  ): void {
    const entry = this.characters.get(minionId);
    if (!entry) return;
    entry.walk.setActive(isActive);
    entry.walk.setWaiting(isWaiting);
    entry.walk.setDone(isDone);
    entry.isLive = isActive;
  }

  updateCharacterPalette(
    minionId: string,
    palette: CharPalette,
    accentHex: string,
  ): void {
    const entry = this.characters.get(minionId);
    if (!entry) return;
    entry.palette = palette;
    entry.accentHex = accentHex;
    entry.atlas = getSpriteAtlas(entry.appearance, palette);
  }

  updateDeskPalette(deskPalette: DeskPalette, timeOfDay: TimeOfDay): void {
    this.deskCache = getDeskCanvas(deskPalette);
    this.timeOfDay = timeOfDay;
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.scale(dpr, dpr);
    this.ctx.imageSmoothingEnabled = false;
  }

  setVisible(v: boolean): void { this._visible = v; }

  // ── SceneSubscriber ──

  isActive(): boolean { return this._visible; }

  update(dt: number): void {
    for (const entry of this.characters.values()) {
      entry.walk.update(dt);
    }
  }

  render(): void {
    const ctx = this.ctx;
    const W = this._width;
    const H = this._height;
    const wallH = Math.floor(H * WALL_RATIO);
    const theme = getThemeMode();

    // 1. Clear
    ctx.clearRect(0, 0, W, H);

    // 2–4. Unified scene grid (wall + floor + contact line)
    drawSceneGrid(ctx, 0, 0, W, H, wallH, this.timeOfDay, theme);

    // 5. Ambient glow for any live minion
    let anyLive = false;
    for (const entry of this.characters.values()) {
      if (entry.isLive) {
        anyLive = true;
        break;
      }
    }
    if (anyLive) {
      drawAmbientGlow(ctx, W / 2, wallH, Math.min(W, H) * 0.4, "#6366f1", 0.08);
    }

    // 6. Draw desk (centered, at CREW_DESK_SCALE)
    const dc = this.deskCache;
    const deskW = dc.width * CREW_DESK_SCALE;
    const deskH = dc.height * CREW_DESK_SCALE;
    const deskX = (W - deskW) / 2;
    const deskY = wallH - deskH * 0.5; // overlap wall/floor boundary
    ctx.drawImage(dc.canvas, 0, 0, dc.width, dc.height, deskX, deskY, deskW, deskH);

    // 7. Z-sort characters by Y and draw
    const sorted = [...this.characters.values()].sort(
      (a, b) => a.walk.y - b.walk.y
    );

    // Map pixel-space coords to screen coords within this scene
    // The scene represents a 48×48 pixel-space, mapped to W×H screen pixels
    const scaleX = W / 48;
    const scaleY = H / 48;

    for (const entry of sorted) {
      this.drawCharacter(ctx, entry, scaleX, scaleY);
    }
  }

  private drawCharacter(
    ctx: CanvasRenderingContext2D,
    entry: CharEntry,
    scaleX: number,
    scaleY: number,
  ): void {
    const atlas = entry.atlas;
    const state = entry.walk.charState;
    const off = atlas.stateOffsets[state];
    const frameIdx = entry.walk.frameIndex % off.count;
    const srcX = (off.start + frameIdx) * atlas.frameWidth;

    // Map pixel-space position to screen coords
    const screenCenterX = entry.walk.x * scaleX;
    const screenFeetY = entry.walk.y * scaleY;

    const charW = CHAR_GRID_W * CREW_CHAR_SCALE;
    const charH = CHAR_GRID_H * CREW_CHAR_SCALE;

    const drawX = screenCenterX - charW / 2;
    const drawY = screenFeetY - (CHAR_FEET_ROW * CREW_CHAR_SCALE);

    // Live glow effect
    if (entry.isLive) {
      ctx.save();
      ctx.shadowColor = entry.accentHex;
      ctx.shadowBlur = 8;
      ctx.drawImage(
        atlas.canvas,
        srcX, 0, atlas.frameWidth, atlas.frameHeight,
        Math.round(drawX), Math.round(drawY), charW, charH,
      );
      ctx.restore();
    } else {
      ctx.drawImage(
        atlas.canvas,
        srcX, 0, atlas.frameWidth, atlas.frameHeight,
        Math.round(drawX), Math.round(drawY), charW, charH,
      );
    }
  }

  dispose(): void {
    this.characters.clear();
  }
}
