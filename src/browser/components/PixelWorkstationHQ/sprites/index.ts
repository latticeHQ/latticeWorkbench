/**
 * Pixel office asset library — barrel exports.
 *
 * Usage:
 *   import { buildPalette, buildDeskPalette, ... } from "./sprites";
 */

// Types
export type {
  ColorKey,
  PixelEntry,
  CharState,
  CharacterAppearance,
  CharPalette,
  DeskColorKey,
  DeskRect,
  DeskPalette,
  TimeOfDay,
} from "./types";

export { CHAR_GRID_W, CHAR_GRID_H } from "./types";

// Color utilities
export { darken, lighten, tintWarm, deriveScreenColor } from "./colorUtils";

// Character palette + appearance
export {
  SKIN_TONES,
  HAIR_COLORS,
  deriveAppearance,
  buildPalette,
} from "./characterPalette";

// Character frame data
export {
  buildFrameSets,
  ANIM_INTERVALS,
} from "./characterFrames";

// Desk furniture
export {
  DESK_RECTS,
  DESK_VIEWBOX,
  DESK_RENDER_W,
  DESK_RENDER_H,
} from "./deskData";

// Desk palette
export { buildDeskPalette } from "./deskPalette";

// Shadow builder — deprecated, kept for reference
// export { buildCharShadow } from "./shadowBuilder";
