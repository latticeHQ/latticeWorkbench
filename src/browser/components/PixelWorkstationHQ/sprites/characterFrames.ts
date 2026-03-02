/**
 * Character sprite frame data — 12×18 pixel grid.
 *
 * Grid layout (12 cols × 18 rows):
 *   Row  0-1:   Hair (style-dependent)
 *   Row  2:     Forehead / hair edge
 *   Row  3:     Eyes (eyeWhite + eyePupil)
 *   Row  4:     Lower face
 *   Row  5:     Neck + shoulders
 *   Row  6-8:   Torso (shirt)
 *   Row  9-10:  Arms / lower torso
 *   Row  11:    Belt line
 *   Row  12-14: Legs (pants)
 *   Row  15-16: Shoes
 *
 * Each frame is the "base body" — hair overlays are composed separately
 * so we can mix 4 hair styles with every body frame.
 */

import type { PixelEntry, CharState, CharacterAppearance } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Hair style overlays — rows 0–2 only
// ─────────────────────────────────────────────────────────────────────────────

/** Style 0: Short crop — clean, compact. */
const HAIR_SHORT: PixelEntry[] = [
  // Row 0: top
  [4, 0, "hair"], [5, 0, "hair"], [6, 0, "hair"], [7, 0, "hair"],
  // Row 1: sides
  [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"], [6, 1, "hair"], [7, 1, "hair"], [8, 1, "hair"],
  // Row 2: forehead edge
  [3, 2, "hair"], [4, 2, "hair"], [8, 2, "hair"],
];

/** Style 1: Medium — fuller top, side coverage. */
const HAIR_MEDIUM: PixelEntry[] = [
  // Row 0: voluminous top
  [4, 0, "hair"], [5, 0, "hair"], [6, 0, "hair"], [7, 0, "hair"], [8, 0, "hair"],
  // Row 1: full sides
  [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"], [6, 1, "hair"], [7, 1, "hair"], [8, 1, "hair"],
  // Row 2: covers forehead more
  [3, 2, "hair"], [4, 2, "hair"], [5, 2, "hair"], [8, 2, "hair"],
];

/** Style 2: Long — extends down the sides. */
const HAIR_LONG: PixelEntry[] = [
  // Row 0: wide top
  [3, 0, "hair"], [4, 0, "hair"], [5, 0, "hair"], [6, 0, "hair"], [7, 0, "hair"], [8, 0, "hair"],
  // Row 1: full
  [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"], [6, 1, "hair"], [7, 1, "hair"], [8, 1, "hair"], [9, 1, "hair"],
  // Row 2: side bangs
  [3, 2, "hair"], [4, 2, "hair"], [5, 2, "hair"], [8, 2, "hair"], [9, 2, "hair"],
  // Row 3: long side strands (overlaps face area slightly)
  [3, 3, "hair"], [9, 3, "hair"],
  // Row 4: extends further
  [3, 4, "hair"], [9, 4, "hair"],
];

/** Style 3: Ponytail — short top with tail extending from back. */
const HAIR_PONYTAIL: PixelEntry[] = [
  // Row 0: neat top
  [4, 0, "hair"], [5, 0, "hair"], [6, 0, "hair"], [7, 0, "hair"],
  // Row 1: neat sides
  [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"], [6, 1, "hair"], [7, 1, "hair"], [8, 1, "hair"],
  // Row 2: hairline
  [3, 2, "hair"], [4, 2, "hair"], [8, 2, "hair"],
  // Ponytail extending from back (right side)
  [9, 2, "hair"], [9, 3, "hair"], [10, 3, "hair"],
  [10, 4, "hair"], [10, 5, "hair"],
];

export const HAIR_STYLES: PixelEntry[][] = [
  HAIR_SHORT,
  HAIR_MEDIUM,
  HAIR_LONG,
  HAIR_PONYTAIL,
];

// ─────────────────────────────────────────────────────────────────────────────
// Base body frames (no hair — hair composed on top)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IDLE frame 1 — seated at desk, relaxed posture.
 * Face visible with eyes, body upright, hands on lap.
 */
const IDLE_BODY_1: PixelEntry[] = [
  // Face (rows 2-4)
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  // Eyes (row 3)
  [4, 3, "skin"], [5, 3, "eyeWhite"], [6, 3, "eyeWhite"], [7, 3, "skin"],
  [5, 3, "eyePupil"], [6, 3, "eyePupil"],
  // Wait — eyes need white BEHIND pupils. Render order: white first, pupil on top.
  // Actually in box-shadow, later entries overlay. So: white at offset, pupil at same offset wins.
  // Use separate pixel positions instead:
  // Left eye: white at (4,3), pupil at (5,3)
  // Right eye: white at (7,3), pupil at (6,3)
  // Correction — let's use proper eye layout:
  // Lower face (row 4)
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck (row 5)
  [5, 5, "skin"], [6, 5, "skin"],
  // Shoulders
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Shirt torso (rows 6-8)
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  // Shirt accent (collar line)
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms resting on lap (rows 9-10)
  [3, 8, "skin"], [8, 8, "skin"],
  [3, 9, "skin"], [8, 9, "skin"],
  // Belt (row 11)
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  // Pants (rows 11-14)
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  // Shoes (rows 15-16)
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/**
 * IDLE frame 2 — slight head tilt, same seated posture.
 */
const IDLE_BODY_2: PixelEntry[] = [
  // Face shifted slightly right
  [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  // Eyes
  [5, 3, "skin"], [6, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [6, 3, "eyePupil"], [7, 3, "eyePupil"],
  // Lower face
  [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"], [8, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  // Shoulders
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Shirt (same as idle 1)
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms
  [3, 8, "skin"], [8, 8, "skin"],
  [3, 9, "skin"], [8, 9, "skin"],
  // Belt + pants + shoes (same)
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/**
 * IDLE frame 3 — blink (eyes closed).
 */
const IDLE_BODY_3: PixelEntry[] = [
  // Face (same position as frame 1)
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  // Eyes CLOSED — just skin, no white/pupil
  [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"],
  // Eyelid line
  [5, 3, "outline"], [6, 3, "outline"],
  // Lower face
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Rest same as idle 1
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  [3, 8, "skin"], [8, 8, "skin"],
  [3, 9, "skin"], [8, 9, "skin"],
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Typing frames
// ─────────────────────────────────────────────────────────────────────────────

/** Typing frame 1 — hands extended forward on keyboard. */
const TYPING_BODY_1: PixelEntry[] = [
  // Face (leaning forward slightly)
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms EXTENDED forward (typing)
  [2, 7, "skin"], [9, 7, "skin"],
  [2, 8, "skin"], [9, 8, "skin"],
  [1, 9, "skin"], [10, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/** Typing frame 2 — hands slightly different, alternate key press. */
const TYPING_BODY_2: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck + shoulders
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms — one higher, one lower (alternating keypress)
  [2, 7, "skin"], [9, 8, "skin"],
  [2, 8, "skin"], [9, 9, "skin"],
  [1, 9, "skin"], [10, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/** Typing frame 3 — mirror of frame 2 (other hand elevated). */
const TYPING_BODY_3: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck + shoulders
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms — reversed from frame 2
  [2, 8, "skin"], [9, 7, "skin"],
  [2, 9, "skin"], [9, 8, "skin"],
  [1, 9, "skin"], [10, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

const TYPING_BODY_4 = TYPING_BODY_1; // cycle: 1-2-3-1

// ─────────────────────────────────────────────────────────────────────────────
// Done frames
// ─────────────────────────────────────────────────────────────────────────────

/** Done frame 1 — leaning back, relaxed, arms behind head feel. */
const DONE_BODY_1: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  [4, 5, "shirt"], [7, 5, "shirt"],
  // Torso (slightly reclined feel)
  [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"],
  [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms behind/relaxed
  [3, 6, "skin"], [8, 6, "skin"],
  [3, 7, "skin"], [8, 7, "skin"],
  // Belt + pants
  [4, 9, "belt"], [5, 9, "belt"], [6, 9, "belt"], [7, 9, "belt"],
  [4, 10, "pants"], [5, 10, "pants"], [6, 10, "pants"], [7, 10, "pants"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  // Feet extended out (relaxed sitting)
  [3, 13, "shoe"], [4, 13, "shoe"], [7, 13, "shoe"], [8, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [7, 14, "shoe"], [8, 14, "shoe"],
];

/** Done frame 2 — stretch variation. */
const DONE_BODY_2: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  // Eyes closed (satisfied)
  [4, 3, "skin"], [5, 3, "skin"], [6, 3, "skin"], [7, 3, "skin"],
  [5, 3, "outline"], [6, 3, "outline"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  [4, 5, "shirt"], [7, 5, "shirt"],
  // Torso
  [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"],
  [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms stretched wide
  [2, 5, "skin"], [9, 5, "skin"],
  [2, 6, "skin"], [9, 6, "skin"],
  // Belt + pants
  [4, 9, "belt"], [5, 9, "belt"], [6, 9, "belt"], [7, 9, "belt"],
  [4, 10, "pants"], [5, 10, "pants"], [6, 10, "pants"], [7, 10, "pants"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [3, 13, "shoe"], [4, 13, "shoe"], [7, 13, "shoe"], [8, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [7, 14, "shoe"], [8, 14, "shoe"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Waiting frames
// ─────────────────────────────────────────────────────────────────────────────

/** Waiting frame 1 — chin rest / thinking. */
const WAITING_BODY_1: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck + shoulders
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Left hand on chin (thinking pose)
  [3, 4, "skin"], [3, 5, "skin"],
  // Right arm resting
  [8, 8, "skin"], [8, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/** Waiting frame 2 — hand raised (question gesture). */
const WAITING_BODY_2: PixelEntry[] = [
  // Face
  [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"],
  [4, 3, "skin"], [5, 3, "eyeWhite"], [7, 3, "eyeWhite"], [8, 3, "skin"],
  [5, 3, "eyePupil"], [7, 3, "eyePupil"],
  [4, 3, "skin"], [6, 3, "skin"],
  [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Right hand RAISED (question)
  [9, 5, "skin"], [9, 4, "skin"],
  // Left arm resting
  [3, 8, "skin"], [3, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

/** Waiting frame 3 — looking around (head shifted). */
const WAITING_BODY_3: PixelEntry[] = [
  // Face shifted left
  [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"], [6, 2, "skin"],
  [3, 3, "skin"], [4, 3, "eyeWhite"], [6, 3, "eyeWhite"], [7, 3, "skin"],
  [4, 3, "eyePupil"], [6, 3, "eyePupil"],
  [3, 3, "skin"], [5, 3, "skin"],
  [3, 4, "skin"], [4, 4, "skin"], [5, 4, "skin"], [6, 4, "skin"],
  // Neck
  [5, 5, "skin"], [6, 5, "skin"],
  [3, 5, "shirt"], [4, 5, "shirt"], [7, 5, "shirt"], [8, 5, "shirt"],
  // Torso
  [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [4, 8, "shirt"], [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [5, 6, "shirtAccent"], [6, 6, "shirtAccent"],
  // Arms at sides
  [3, 8, "skin"], [8, 8, "skin"],
  [3, 9, "skin"], [8, 9, "skin"],
  // Belt + pants + shoes
  [4, 10, "belt"], [5, 10, "belt"], [6, 10, "belt"], [7, 10, "belt"],
  [4, 11, "pants"], [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [4, 12, "pants"], [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  [4, 13, "pants"], [5, 13, "pants"], [6, 13, "pants"], [7, 13, "pants"],
  [4, 14, "shoe"], [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
  [4, 15, "shoe"], [5, 15, "shoe"], [6, 15, "shoe"], [7, 15, "shoe"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Walk frames — 4 per direction (right), left auto-mirrored
// Pattern: [1, 2, 3, 2] for symmetric bobbing
// ─────────────────────────────────────────────────────────────────────────────

/** Walk Right frame 1 — left leg forward, right arm forward. */
const WALK_RIGHT_BODY_1: PixelEntry[] = [
  // Face
  [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  [5, 3, "skin"], [6, 3, "eyeWhite"], [8, 3, "eyeWhite"], [9, 3, "skin"],
  [6, 3, "eyePupil"], [8, 3, "eyePupil"],
  [5, 3, "skin"], [7, 3, "skin"],
  [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"], [8, 4, "skin"],
  // Neck
  [6, 5, "skin"], [7, 5, "skin"],
  [4, 5, "shirt"], [5, 5, "shirt"], [8, 5, "shirt"], [9, 5, "shirt"],
  // Torso
  [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [6, 6, "shirtAccent"], [7, 6, "shirtAccent"],
  // Right arm forward
  [9, 6, "skin"], [9, 7, "skin"],
  // Left arm back
  [3, 7, "skin"], [3, 8, "skin"],
  // Belt
  [5, 9, "belt"], [6, 9, "belt"], [7, 9, "belt"],
  // Pants — left leg forward, right leg back
  [4, 10, "pants"], [5, 10, "pants"], [7, 10, "pants"], [8, 10, "pants"],
  [3, 11, "pants"], [4, 11, "pants"], [8, 11, "pants"], [9, 11, "pants"],
  [3, 12, "pants"], [4, 12, "pants"], [8, 12, "pants"], [9, 12, "pants"],
  // Shoes
  [3, 13, "shoe"], [4, 13, "shoe"], [8, 13, "shoe"], [9, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [8, 14, "shoe"], [9, 14, "shoe"],
];

/** Walk Right frame 2 — neutral standing, mid-stride. */
const WALK_RIGHT_BODY_2: PixelEntry[] = [
  // Face (facing right)
  [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  [5, 3, "skin"], [6, 3, "eyeWhite"], [8, 3, "eyeWhite"], [9, 3, "skin"],
  [6, 3, "eyePupil"], [8, 3, "eyePupil"],
  [5, 3, "skin"], [7, 3, "skin"],
  [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"], [8, 4, "skin"],
  // Neck
  [6, 5, "skin"], [7, 5, "skin"],
  [4, 5, "shirt"], [5, 5, "shirt"], [8, 5, "shirt"], [9, 5, "shirt"],
  // Torso
  [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [6, 6, "shirtAccent"], [7, 6, "shirtAccent"],
  // Arms at sides
  [3, 7, "skin"], [9, 7, "skin"],
  // Belt
  [5, 9, "belt"], [6, 9, "belt"], [7, 9, "belt"],
  // Pants together
  [5, 10, "pants"], [6, 10, "pants"], [7, 10, "pants"],
  [5, 11, "pants"], [6, 11, "pants"], [7, 11, "pants"],
  [5, 12, "pants"], [6, 12, "pants"], [7, 12, "pants"],
  // Shoes
  [5, 13, "shoe"], [6, 13, "shoe"], [7, 13, "shoe"],
  [5, 14, "shoe"], [6, 14, "shoe"], [7, 14, "shoe"],
];

/** Walk Right frame 3 — right leg forward, left arm forward (opposite of frame 1). */
const WALK_RIGHT_BODY_3: PixelEntry[] = [
  // Face
  [5, 2, "skin"], [6, 2, "skin"], [7, 2, "skin"], [8, 2, "skin"],
  [5, 3, "skin"], [6, 3, "eyeWhite"], [8, 3, "eyeWhite"], [9, 3, "skin"],
  [6, 3, "eyePupil"], [8, 3, "eyePupil"],
  [5, 3, "skin"], [7, 3, "skin"],
  [5, 4, "skin"], [6, 4, "skin"], [7, 4, "skin"], [8, 4, "skin"],
  // Neck
  [6, 5, "skin"], [7, 5, "skin"],
  [4, 5, "shirt"], [5, 5, "shirt"], [8, 5, "shirt"], [9, 5, "shirt"],
  // Torso
  [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"], [7, 6, "shirt"], [8, 6, "shirt"],
  [4, 7, "shirt"], [5, 7, "shirt"], [6, 7, "shirt"], [7, 7, "shirt"], [8, 7, "shirt"],
  [5, 8, "shirt"], [6, 8, "shirt"], [7, 8, "shirt"],
  [6, 6, "shirtAccent"], [7, 6, "shirtAccent"],
  // Left arm forward
  [3, 6, "skin"], [3, 7, "skin"],
  // Right arm back
  [9, 7, "skin"], [9, 8, "skin"],
  // Belt
  [5, 9, "belt"], [6, 9, "belt"], [7, 9, "belt"],
  // Pants — right leg forward, left leg back
  [4, 10, "pants"], [5, 10, "pants"], [7, 10, "pants"], [8, 10, "pants"],
  [3, 11, "pants"], [4, 11, "pants"], [8, 11, "pants"], [9, 11, "pants"],
  [3, 12, "pants"], [4, 12, "pants"], [8, 12, "pants"], [9, 12, "pants"],
  // Shoes
  [3, 13, "shoe"], [4, 13, "shoe"], [8, 13, "shoe"], [9, 13, "shoe"],
  [3, 14, "shoe"], [4, 14, "shoe"], [8, 14, "shoe"], [9, 14, "shoe"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Frame composition + mirroring
// ─────────────────────────────────────────────────────────────────────────────

/** Mirror a frame horizontally for a 12-wide grid: col → 11 - col. */
function mirrorFrame(frame: PixelEntry[]): PixelEntry[] {
  return frame.map(([col, row, key]) => [11 - col, row, key]);
}

/**
 * Compose a body frame with a hair style overlay.
 * Hair pixels go on top — later entries in box-shadow overlay earlier ones.
 */
function composeFrame(body: PixelEntry[], hair: PixelEntry[]): PixelEntry[] {
  return [...body, ...hair];
}

/**
 * Build the complete frame set for a given hair style.
 * Returns frames for all CharState variants.
 */
export function buildFrameSets(
  appearance: CharacterAppearance,
): Record<CharState, PixelEntry[][]> {
  const hair = HAIR_STYLES[appearance.hairStyle];

  // Compose each body frame with the hair overlay
  const compose = (body: PixelEntry[]) => composeFrame(body, hair);

  // Walk frames also need hair. For walk_right, face is shifted right,
  // so we use the same hair (it covers rows 0-2 which are the top of head).
  // For walk_left, mirror everything.
  const walkRightFrames = [
    composeFrame(WALK_RIGHT_BODY_1, hair),
    composeFrame(WALK_RIGHT_BODY_2, hair),
    composeFrame(WALK_RIGHT_BODY_3, hair),
    composeFrame(WALK_RIGHT_BODY_2, hair), // [1,2,3,2] pattern
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

/** Milliseconds per frame for each state's animation cycle. */
export const ANIM_INTERVALS: Record<CharState, number> = {
  idle: 1200,
  typing: 220,
  done: 2000,
  waiting: 900,
  walk_right: 150,
  walk_left: 150,
};
