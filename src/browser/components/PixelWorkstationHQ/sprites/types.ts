/**
 * Core types for the pixel office asset library.
 *
 * Characters: 12×18 pixel grid, rendered via CSS box-shadow at 3× scale (36×54px).
 * Furniture: SVG rect arrays with colorKey-based palettes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Character pixel data
// ─────────────────────────────────────────────────────────────────────────────

/** Color slot for character sprite pixels. 11 keys for rich detail. */
export type ColorKey =
  | "hair"
  | "skin"
  | "eyeWhite"
  | "eyePupil"
  | "shirt"
  | "shirtAccent"
  | "pants"
  | "belt"
  | "shoe"
  | "outline"
  | "shadow";

/** A single pixel entry: [column, row, colorKey]. */
export type PixelEntry = [number, number, ColorKey];

/** Character animation state. */
export type CharState =
  | "idle"
  | "typing"
  | "done"
  | "waiting"
  | "walk_right"
  | "walk_left";

/** Character grid dimensions. */
export const CHAR_GRID_W = 12;
export const CHAR_GRID_H = 18;

// ─────────────────────────────────────────────────────────────────────────────
// Character appearance variety
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacterAppearance {
  /** Hair pixel pattern variant. */
  hairStyle: 0 | 1 | 2 | 3;
  /** Skin color variant. */
  skinTone: 0 | 1 | 2 | 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character palette
// ─────────────────────────────────────────────────────────────────────────────

export interface CharPalette {
  hair: string;
  skin: string;
  eyeWhite: string;
  eyePupil: string;
  shirt: string;
  shirtAccent: string;
  pants: string;
  belt: string;
  shoe: string;
  outline: string;
  shadow: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Desk / furniture data
// ─────────────────────────────────────────────────────────────────────────────

export type DeskColorKey =
  | "desk"
  | "deskEdge"
  | "monitor"
  | "monitor2"
  | "screen"
  | "screen2"
  | "screenLine"
  | "screenContent"
  | "keyboard"
  | "mouse"
  | "leg"
  | "stand"
  | "mug"
  | "coaster"
  | "plant"
  | "plantPot"
  | "shelf"
  | "book1"
  | "book2"
  | "book3"
  | "lamp"
  | "lampShade"
  | "chair"
  | "chairBack"
  | "chairLeg"
  | "headphones"
  | "paper"
  | "paperLine"
  | "wallBaseboard"
  | "poster"
  | "posterFrame";

export interface DeskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  colorKey: DeskColorKey;
}

export type DeskPalette = Record<DeskColorKey, string>;

// ─────────────────────────────────────────────────────────────────────────────
// Time of day (used by palette builders)
// ─────────────────────────────────────────────────────────────────────────────

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
