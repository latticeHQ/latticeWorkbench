/**
 * Minion appearance variety and palette builder.
 *
 * All minions have the classic yellow pill body with goggles.
 * Crew color determines overalls. Hair wisp style provides minor variety.
 */

import type { CharacterAppearance, CharPalette } from "./types";
import { darken } from "./colorUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Minion constants
// ─────────────────────────────────────────────────────────────────────────────

/** Classic minion yellow. */
const MINION_YELLOW = "#FFD700";

/** Hair wisp colors — all dark, slight variety. */
export const HAIR_COLORS = [
  "#222222", // very dark
  "#333333", // dark gray
  "#1a1a1a", // near black
  "#2c2c2c", // charcoal
] as const;

// Kept for backward compat but unused — all minions are yellow.
export const SKIN_TONES = [
  MINION_YELLOW, MINION_YELLOW, MINION_YELLOW, MINION_YELLOW,
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Appearance derivation
// ─────────────────────────────────────────────────────────────────────────────

/** Derive a deterministic appearance from a minion ID string. */
export function deriveAppearance(minionId: string): CharacterAppearance {
  let hash = 0;
  for (let i = 0; i < minionId.length; i++) {
    hash = ((hash << 5) - hash + minionId.charCodeAt(i)) | 0;
  }
  const abs = Math.abs(hash);
  return {
    hairStyle: (abs % 4) as 0 | 1 | 2 | 3,
    skinTone: (Math.floor(abs / 4) % 4) as 0 | 1 | 2 | 3,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Palette builder
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minion palette from crew hex + appearance. */
export function buildPalette(
  crewHex: string,
  appearance: CharacterAppearance,
): CharPalette {
  const hairColor = HAIR_COLORS[appearance.hairStyle];
  return {
    hair: hairColor,
    skin: MINION_YELLOW,                // yellow body — all minions
    eyeWhite: "#ffffff",                // goggle lens
    eyePupil: "#654321",                // brown pupil
    shirt: crewHex,                     // overalls (crew color)
    shirtAccent: darken(crewHex, 18),   // suspender clasps
    pants: crewHex,                     // overalls lower (same as shirt)
    belt: "#333333",                    // goggle strap + gloves (darker for contrast)
    shoe: "#222222",                    // shoes
    outline: "#999999",                 // goggle rim — silver/metallic
    shadow: darken(MINION_YELLOW, 15),  // body edge shading (subtle)
  };
}
