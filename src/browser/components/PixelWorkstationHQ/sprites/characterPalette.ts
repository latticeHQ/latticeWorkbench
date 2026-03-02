/**
 * Character appearance variety and palette builder.
 *
 * Each minion gets a unique look derived deterministically from its ID hash,
 * so the same minion always looks the same across sessions.
 */

import type { CharacterAppearance, CharPalette } from "./types";
import { darken } from "./colorUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Variety tables
// ─────────────────────────────────────────────────────────────────────────────

/** Skin tones — light to dark. */
export const SKIN_TONES = [
  "#f5d0b0", // light
  "#dbb99a", // medium
  "#c18e6b", // tan
  "#8d5e3c", // dark
] as const;

/** Hair colors — indexed by hairStyle for variety. */
export const HAIR_COLORS = [
  "#2a1f14", // very dark brown (short)
  "#6b5344", // medium brown (medium)
  "#d4a843", // golden blonde (long)
  "#c45c3e", // auburn/red (ponytail)
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

/** Build a full character palette from crew hex + appearance. */
export function buildPalette(
  crewHex: string,
  appearance: CharacterAppearance,
): CharPalette {
  const skinColor = SKIN_TONES[appearance.skinTone];
  const hairColor = HAIR_COLORS[appearance.hairStyle];
  return {
    hair: hairColor,
    skin: skinColor,
    eyeWhite: "#f0f0f0",
    eyePupil: "#1a1a2e",
    shirt: crewHex,
    shirtAccent: darken(crewHex, 22),
    pants: "#3b4252",
    belt: "#2e3440",
    shoe: "#222630",
    outline: "#1a1a2e",
    shadow: darken(skinColor, 25),
  };
}
