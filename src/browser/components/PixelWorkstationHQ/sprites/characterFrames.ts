/**
 * Minion sprite frame data — 12×18 pixel grid.
 *
 * Despicable Me–style minions: yellow pill body, BIG goggles, overalls in crew color.
 *
 * Grid layout (12 cols × 18 rows):
 *   Row  0:      Hair wisps
 *   Row  1:      Top of pill (4 wide)
 *   Row  2:      Head (6 wide)
 *   Row  3:      Head widest (8 wide — pill shape)
 *   Row  4:      Goggle strap (10 wide — wider than head!)
 *   Row  5:      Goggles top (rim + white lens)
 *   Row  6:      Goggles bottom (rim + pupil)
 *   Row  7:      Face below goggles (8 wide)
 *   Row  8:      Chin / mouth (6 wide)
 *   Row  9:      Suspender straps + overalls bib
 *   Row  10:     Overalls body (8 wide)
 *   Row  11-12:  Arms (yellow) + overalls
 *   Row  13-14:  Overalls legs
 *   Row  15-16:  Shoes
 *
 * Feet anchor: row 16 (matches CHAR_FEET_ROW in scene renderers).
 *
 * Hair wisps composed separately for 4 style variants.
 */

import type { PixelEntry, CharState, CharacterAppearance } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Hair wisp overlays — row 0 only
// ─────────────────────────────────────────────────────────────────────────────

const HAIR_WISPS_A: PixelEntry[] = [[5, 0, "hair"], [6, 0, "hair"]];
const HAIR_WISPS_B: PixelEntry[] = [[5, 0, "hair"], [6, 0, "hair"], [7, 0, "hair"]];
const HAIR_WISPS_C: PixelEntry[] = [[6, 0, "hair"]];
const HAIR_WISPS_D: PixelEntry[] = []; // bald

export const HAIR_STYLES: PixelEntry[][] = [
  HAIR_WISPS_A, HAIR_WISPS_B, HAIR_WISPS_C, HAIR_WISPS_D,
];

// ─────────────────────────────────────────────────────────────────────────────
// Color key reference for minions:
//   skin        → yellow body (#FFD700)
//   belt        → goggle strap + gloves (#444)
//   outline     → goggle rim (#888)
//   eyeWhite    → goggle lens (white)
//   eyePupil    → brown pupil (#654321)
//   shirt       → overalls (crew color)
//   shirtAccent → suspender clasps
//   shoe        → shoes (#222)
// ─────────────────────────────────────────────────────────────────────────────

// ── Helper: common minion head (centered) ───────────────────────────────────

/** Standard centered minion head, rows 1-8. Eyes open, looking slightly inward. */
const HEAD_CENTER_OPEN: PixelEntry[] = [
  // Row 1: top of pill
  [4, 1, "skin"], [5, 1, "skin"], [6, 1, "skin"], [7, 1, "skin"],
  // Row 2: head (6 wide)
  [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  // Row 3: head widest (8 wide — pill shape)
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"], [8, 3, "skin"], [9, 3, "skin"],
  // Row 4: goggle strap (10 wide — wider than head)
  [1, 4, "belt"], [2, 4, "belt"], [3, 4, "belt"], [4, 4, "belt"], [5, 4, "belt"], [6, 4, "belt"], [7, 4, "belt"], [8, 4, "belt"], [9, 4, "belt"], [10, 4, "belt"],
  // Row 5: goggles top — rim, lens, lens, bridge, bridge, lens, lens, rim (with strap sides)
  [1, 5, "belt"], [2, 5, "outline"], [3, 5, "eyeWhite"], [4, 5, "eyeWhite"], [5, 5, "outline"], [6, 5, "outline"], [7, 5, "eyeWhite"], [8, 5, "eyeWhite"], [9, 5, "outline"], [10, 5, "belt"],
  // Row 6: goggles bottom — rim, lens, pupil, bridge, bridge, pupil, lens, rim
  [1, 6, "belt"], [2, 6, "outline"], [3, 6, "eyeWhite"], [4, 6, "eyePupil"], [5, 6, "outline"], [6, 6, "outline"], [7, 6, "eyePupil"], [8, 6, "eyeWhite"], [9, 6, "outline"], [10, 6, "belt"],
  // Row 7: face below goggles (8 wide)
  [2, 7, "skin"], [3, 7, "skin"], [4, 7, "skin"], [5, 7, "skin"], [6, 7, "skin"], [7, 7, "skin"], [8, 7, "skin"], [9, 7, "skin"],
  // Row 8: chin (6 wide)
  [3, 8, "skin"], [4, 8, "skin"], [5, 8, "skin"], [6, 8, "skin"], [7, 8, "skin"], [8, 8, "skin"],
];

/** Centered head with eyes closed (blink). */
const HEAD_CENTER_CLOSED: PixelEntry[] = [
  [4, 1, "skin"], [5, 1, "skin"], [6, 1, "skin"], [7, 1, "skin"],
  [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"], [8, 3, "skin"], [9, 3, "skin"],
  [1, 4, "belt"], [2, 4, "belt"], [3, 4, "belt"], [4, 4, "belt"], [5, 4, "belt"], [6, 4, "belt"], [7, 4, "belt"], [8, 4, "belt"], [9, 4, "belt"], [10, 4, "belt"],
  // Goggles top — same
  [1, 5, "belt"], [2, 5, "outline"], [3, 5, "eyeWhite"], [4, 5, "eyeWhite"], [5, 5, "outline"], [6, 5, "outline"], [7, 5, "eyeWhite"], [8, 5, "eyeWhite"], [9, 5, "outline"], [10, 5, "belt"],
  // Goggles bottom — CLOSED (outline line instead of pupil)
  [1, 6, "belt"], [2, 6, "outline"], [3, 6, "outline"], [4, 6, "outline"], [5, 6, "outline"], [6, 6, "outline"], [7, 6, "outline"], [8, 6, "outline"], [9, 6, "outline"], [10, 6, "belt"],
  // Face
  [2, 7, "skin"], [3, 7, "skin"], [4, 7, "skin"], [5, 7, "skin"], [6, 7, "skin"], [7, 7, "skin"], [8, 7, "skin"], [9, 7, "skin"],
  [3, 8, "skin"], [4, 8, "skin"], [5, 8, "skin"], [6, 8, "skin"], [7, 8, "skin"], [8, 8, "skin"],
];

/** Head shifted RIGHT (for walking right, tilting). */
const HEAD_RIGHT_OPEN: PixelEntry[] = [
  [5, 1, "skin"], [6, 1, "skin"], [7, 1, "skin"], [8, 1, "skin"],
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"], [9, 2, "skin"],
  [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"], [8, 3, "skin"], [9, 3, "skin"], [10, 3, "skin"],
  // Strap
  [2, 4, "belt"], [3, 4, "belt"], [4, 4, "belt"], [5, 4, "belt"], [6, 4, "belt"], [7, 4, "belt"], [8, 4, "belt"], [9, 4, "belt"], [10, 4, "belt"], [11, 4, "belt"],
  // Goggles
  [2, 5, "belt"], [3, 5, "outline"], [4, 5, "eyeWhite"], [5, 5, "eyeWhite"], [6, 5, "outline"], [7, 5, "outline"], [8, 5, "eyeWhite"], [9, 5, "eyeWhite"], [10, 5, "outline"], [11, 5, "belt"],
  [2, 6, "belt"], [3, 6, "outline"], [4, 6, "eyeWhite"], [5, 6, "eyePupil"], [6, 6, "outline"], [7, 6, "outline"], [8, 6, "eyePupil"], [9, 6, "eyeWhite"], [10, 6, "outline"], [11, 6, "belt"],
  // Face
  [3, 7, "skin"], [4, 7, "skin"], [5, 7, "skin"], [6, 7, "skin"], [7, 7, "skin"], [8, 7, "skin"], [9, 7, "skin"], [10, 7, "skin"],
  [4, 8, "skin"], [5, 8, "skin"], [6, 8, "skin"], [7, 8, "skin"], [8, 8, "skin"], [9, 8, "skin"],
];

/** Head shifted LEFT (for looking around). */
const HEAD_LEFT_OPEN: PixelEntry[] = [
  [3, 1, "skin"], [4, 1, "skin"], [5, 1, "skin"], [6, 1, "skin"],
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [1, 3, "skin"], [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"], [8, 3, "skin"],
  // Strap
  [0, 4, "belt"], [1, 4, "belt"], [2, 4, "belt"], [3, 4, "belt"], [4, 4, "belt"], [5, 4, "belt"], [6, 4, "belt"], [7, 4, "belt"], [8, 4, "belt"], [9, 4, "belt"],
  // Goggles
  [0, 5, "belt"], [1, 5, "outline"], [2, 5, "eyeWhite"], [3, 5, "eyeWhite"], [4, 5, "outline"], [5, 5, "outline"], [6, 5, "eyeWhite"], [7, 5, "eyeWhite"], [8, 5, "outline"], [9, 5, "belt"],
  [0, 6, "belt"], [1, 6, "outline"], [2, 6, "eyeWhite"], [3, 6, "eyePupil"], [4, 6, "outline"], [5, 6, "outline"], [6, 6, "eyePupil"], [7, 6, "eyeWhite"], [8, 6, "outline"], [9, 6, "belt"],
  // Face
  [1, 7, "skin"], [2, 7, "skin"], [3, 7, "skin"], [4, 7, "skin"], [5, 7, "skin"], [6, 7, "skin"], [7, 7, "skin"], [8, 7, "skin"],
  [2, 8, "skin"], [3, 8, "skin"], [4, 8, "skin"], [5, 8, "skin"], [6, 8, "skin"], [7, 8, "skin"],
];

// ── Helper: common seated body (rows 9-16) ──────────────────────────────────

/** Standard seated body: suspenders, overalls, arms at sides, legs together. */
const BODY_SEATED: PixelEntry[] = [
  // Row 9: suspender straps + bib
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  // Row 10: overalls body (8 wide)
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Row 11: arms (yellow) + overalls
  [1, 11, "skin"], [2, 11, "skin"], [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"], [9, 11, "skin"], [10, 11, "skin"],
  // Row 12: glove hands + overalls
  [1, 12, "belt"], [2, 12, "belt"], [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"], [9, 12, "belt"], [10, 12, "belt"],
  // Row 13-14: overalls legs
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  // Row 15-16: shoes
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

// ── Idle frames ─────────────────────────────────────────────────────────────

const IDLE_BODY_1: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_SEATED];

const IDLE_BODY_2: PixelEntry[] = [...HEAD_RIGHT_OPEN, ...BODY_SEATED];

const IDLE_BODY_3: PixelEntry[] = [...HEAD_CENTER_CLOSED, ...BODY_SEATED];

// ── Typing frames ───────────────────────────────────────────────────────────

/** Arms-forward body for typing. */
const BODY_TYPING_1: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Arms EXTENDED forward
  [0, 11, "skin"], [1, 11, "skin"], [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"], [10, 11, "skin"], [11, 11, "skin"],
  [0, 12, "belt"], [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"], [11, 12, "belt"],
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

/** Left arm up, right arm down. */
const BODY_TYPING_2: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Left arm higher, right arm lower
  [0, 10, "skin"], [1, 10, "skin"], [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"], [10, 11, "skin"], [11, 12, "skin"],
  [0, 11, "belt"], [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"], [11, 13, "belt"],
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

/** Right arm up, left arm down. */
const BODY_TYPING_3: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Left arm lower, right arm higher
  [0, 12, "skin"], [1, 11, "skin"], [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"], [10, 10, "skin"], [11, 11, "skin"],
  [0, 13, "belt"], [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"], [11, 11, "belt"],
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

const TYPING_BODY_1: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_TYPING_1];
const TYPING_BODY_2: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_TYPING_2];
const TYPING_BODY_3: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_TYPING_3];
const TYPING_BODY_4 = TYPING_BODY_1;

// ── Done frames ─────────────────────────────────────────────────────────────

/** Relaxed body — arms behind, feet extended. */
const BODY_DONE_RELAXED: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Arms relaxed behind
  [1, 10, "skin"], [2, 9, "skin"], [9, 9, "skin"], [10, 10, "skin"],
  [1, 11, "belt"], [10, 11, "belt"],
  // Overalls
  [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  // Feet extended out
  [3, 13, "shoe"], [4, 13, "shoe"], [7, 13, "shoe"], [8, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [7, 14, "shoe"], [8, 14, "shoe"],
];

/** Stretch body — arms wide. */
const BODY_DONE_STRETCH: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Arms stretched wide
  [0, 9, "skin"], [1, 9, "skin"], [10, 9, "skin"], [11, 9, "skin"],
  [0, 10, "belt"], [11, 10, "belt"],
  // Overalls
  [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  // Feet extended
  [3, 13, "shoe"], [4, 13, "shoe"], [7, 13, "shoe"], [8, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [7, 14, "shoe"], [8, 14, "shoe"],
];

const DONE_BODY_1: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_DONE_RELAXED];
const DONE_BODY_2: PixelEntry[] = [...HEAD_CENTER_CLOSED, ...BODY_DONE_STRETCH];

// ── Waiting frames ──────────────────────────────────────────────────────────

/** Hand on chin body. */
const BODY_WAITING_CHIN: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Left arm up to chin (glove at chin level = row 8)
  [2, 8, "belt"], [2, 9, "skin"], [2, 10, "skin"],
  // Right arm at side
  [9, 11, "skin"], [10, 11, "skin"], [9, 12, "belt"], [10, 12, "belt"],
  // Overalls
  [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

/** Hand raised body. */
const BODY_WAITING_RAISED: PixelEntry[] = [
  [3, 9, "shirtAccent"], [4, 9, "shirt"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [2, 10, "shirt"], [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"], [9, 10, "shirt"],
  // Left arm at side
  [1, 11, "skin"], [2, 11, "skin"], [1, 12, "belt"], [2, 12, "belt"],
  // Right arm RAISED (hand above head)
  [10, 7, "belt"], [10, 8, "skin"], [10, 9, "skin"],
  // Overalls
  [4, 11, "shirt"], [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [4, 12, "shirt"], [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  [4, 13, "shirt"], [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [4, 14, "shirt"], [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [4, 16, "shoe"], [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

const WAITING_BODY_1: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_WAITING_CHIN];
const WAITING_BODY_2: PixelEntry[] = [...HEAD_CENTER_OPEN, ...BODY_WAITING_RAISED];
const WAITING_BODY_3: PixelEntry[] = [...HEAD_LEFT_OPEN, ...BODY_SEATED];

// ── Walk frames ─────────────────────────────────────────────────────────────
// 3 unique walk_right frames, played [1,2,3,2]. walk_left is mirrored.

/** Walk body: legs split wide. */
const BODY_WALK_SPLIT: PixelEntry[] = [
  [4, 9, "shirtAccent"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"],
  // Arms swinging (right forward, left back)
  [10, 9, "skin"], [11, 10, "skin"], [11, 11, "belt"],
  [2, 10, "skin"], [1, 11, "skin"], [1, 12, "belt"],
  // Overalls
  [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  // Legs SPLIT
  [3, 13, "shirt"], [4, 13, "shirt"], [8, 13, "shirt"], [9, 13, "shirt"],
  [3, 14, "shirt"], [4, 14, "shirt"], [8, 14, "shirt"], [9, 14, "shirt"],
  // Shoes split
  [3, 15, "shoe"], [4, 15, "shoe"], [8, 15, "shoe"], [9, 15, "shoe"],
  [3, 16, "shoe"], [4, 16, "shoe"], [8, 16, "shoe"], [9, 16, "shoe"],
];

/** Walk body: legs together (mid-stride). */
const BODY_WALK_TOGETHER: PixelEntry[] = [
  [4, 9, "shirtAccent"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"],
  // Arms at sides
  [2, 10, "skin"], [9, 10, "skin"],
  // Overalls
  [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  // Legs together
  [5, 13, "shirt"], [6, 13, "shirt"], [7, 13, "shirt"],
  [5, 14, "shirt"], [6, 14, "shirt"], [7, 14, "shirt"],
  // Shoes
  [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
  [5, 16, "shoe"], [6, 16, "shoe"], [7, 16, "shoe"],
];

/** Walk body: legs split opposite direction. */
const BODY_WALK_SPLIT_ALT: PixelEntry[] = [
  [4, 9, "shirtAccent"], [5, 9, "shirt"], [6, 9, "shirt"], [7, 9, "shirt"], [8, 9, "shirtAccent"],
  [3, 10, "shirt"], [4, 10, "shirt"], [5, 10, "shirt"], [6, 10, "shirt"], [7, 10, "shirt"], [8, 10, "shirt"],
  // Arms swinging (left forward, right back)
  [2, 9, "skin"], [1, 10, "skin"], [1, 11, "belt"],
  [10, 10, "skin"], [11, 11, "skin"], [11, 12, "belt"],
  // Overalls
  [5, 11, "shirt"], [6, 11, "shirt"], [7, 11, "shirt"],
  [5, 12, "shirt"], [6, 12, "shirt"], [7, 12, "shirt"],
  // Legs SPLIT (opposite)
  [3, 13, "shirt"], [4, 13, "shirt"], [8, 13, "shirt"], [9, 13, "shirt"],
  [3, 14, "shirt"], [4, 14, "shirt"], [8, 14, "shirt"], [9, 14, "shirt"],
  // Shoes
  [3, 15, "shoe"], [4, 15, "shoe"], [8, 15, "shoe"], [9, 15, "shoe"],
  [3, 16, "shoe"], [4, 16, "shoe"], [8, 16, "shoe"], [9, 16, "shoe"],
];

const WALK_RIGHT_BODY_1: PixelEntry[] = [...HEAD_RIGHT_OPEN, ...BODY_WALK_SPLIT];
const WALK_RIGHT_BODY_2: PixelEntry[] = [...HEAD_RIGHT_OPEN, ...BODY_WALK_TOGETHER];
const WALK_RIGHT_BODY_3: PixelEntry[] = [...HEAD_RIGHT_OPEN, ...BODY_WALK_SPLIT_ALT];

// ─────────────────────────────────────────────────────────────────────────────
// Frame composition + mirroring
// ─────────────────────────────────────────────────────────────────────────────

function mirrorFrame(frame: PixelEntry[]): PixelEntry[] {
  return frame.map(([col, row, key]) => [11 - col, row, key]);
}

function composeFrame(body: PixelEntry[], hair: PixelEntry[]): PixelEntry[] {
  return [...body, ...hair];
}

export function buildFrameSets(
  appearance: CharacterAppearance,
): Record<CharState, PixelEntry[][]> {
  const hair = HAIR_STYLES[appearance.hairStyle];
  const compose = (body: PixelEntry[]) => composeFrame(body, hair);

  const walkRightFrames = [
    composeFrame(WALK_RIGHT_BODY_1, hair),
    composeFrame(WALK_RIGHT_BODY_2, hair),
    composeFrame(WALK_RIGHT_BODY_3, hair),
    composeFrame(WALK_RIGHT_BODY_2, hair),
  ];

  const mirroredHair = mirrorFrame(hair);
  const walkLeftFrames = [
    composeFrame(mirrorFrame(WALK_RIGHT_BODY_1), mirroredHair),
    composeFrame(mirrorFrame(WALK_RIGHT_BODY_2), mirroredHair),
    composeFrame(mirrorFrame(WALK_RIGHT_BODY_3), mirroredHair),
    composeFrame(mirrorFrame(WALK_RIGHT_BODY_2), mirroredHair),
  ];

  return {
    idle: [compose(IDLE_BODY_1), compose(IDLE_BODY_2), compose(IDLE_BODY_3)],
    typing: [compose(TYPING_BODY_1), compose(TYPING_BODY_2), compose(TYPING_BODY_3), compose(TYPING_BODY_4)],
    done: [compose(DONE_BODY_1), compose(DONE_BODY_2)],
    waiting: [compose(WAITING_BODY_1), compose(WAITING_BODY_2), compose(WAITING_BODY_3)],
    walk_right: walkRightFrames,
    walk_left: walkLeftFrames,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation timing
// ─────────────────────────────────────────────────────────────────────────────

export const ANIM_INTERVALS: Record<CharState, number> = {
  idle: 1200,
  typing: 220,
  done: 2000,
  waiting: 900,
  walk_right: 150,
  walk_left: 150,
};
