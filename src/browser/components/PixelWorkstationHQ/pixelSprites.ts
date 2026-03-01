/**
 * Pixel art sprite data for workstation cards.
 *
 * Characters are defined as CSS box-shadow pixel grids (8×12).
 * Desks are defined as SVG rect coordinate arrays.
 *
 * Each "pixel" in a box-shadow sprite is a 1px offset shadow entry.
 * At 3× scale the rendered character is 24×36px — compact but recognizable.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Derive shirt/accent color from crew hex (slightly desaturated). */
export function deriveShirtColor(hex: string): string {
  return hex;
}

/** Derive skin tone — warm neutral that works on dark/light themes. */
export function deriveSkinColor(_hex: string): string {
  return "#dbb99a";
}

/** Derive hair color — darker than skin. */
export function deriveHairColor(_hex: string): string {
  return "#6b5344";
}

/** Derive monitor glow color from crew hex (brighter version). */
export function deriveScreenColor(hex: string): string {
  // Lighten the crew color for the screen glow
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.min(255, r + 80);
  const lg = Math.min(255, g + 80);
  const lb = Math.min(255, b + 80);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character pixel art frames — 8×12 grid as [col, row, colorKey] tuples
// ─────────────────────────────────────────────────────────────────────────────

type ColorKey = "shirt" | "skin" | "hair" | "pants" | "shoe" | "outline";

type PixelEntry = [number, number, ColorKey];

/**
 * Idle frame 1 — seated at desk, hands on lap.
 */
const IDLE_1: PixelEntry[] = [
  // Hair (top of head)
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt (torso)
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms resting
  [1, 7, "skin"], [6, 7, "skin"],
  // Pants (seated)
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

/**
 * Idle frame 2 — slight head tilt.
 */
const IDLE_2: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"], [5, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms
  [1, 7, "skin"], [6, 7, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

/**
 * Typing frame 1 — hands forward on keyboard.
 */
const TYPING_1: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face (leaning forward)
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms extended forward (typing)
  [0, 6, "skin"], [7, 6, "skin"],
  [0, 7, "skin"], [7, 7, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

/**
 * Typing frame 2 — arms slightly different position.
 */
const TYPING_2: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms extended forward (typing - alternate)
  [0, 7, "skin"], [7, 7, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

/**
 * Typing frame 3 — same as 1 but different hand position.
 */
const TYPING_3: PixelEntry[] = TYPING_1; // Reuse frame 1 for smooth cycle

/**
 * Done frame — leaning back, relaxed.
 */
const DONE_1: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt (leaning back)
  [2, 4, "shirt"], [5, 4, "shirt"],
  [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"],
  [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms behind (relaxed)
  [1, 5, "skin"], [6, 5, "skin"],
  [1, 6, "skin"], [6, 6, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [5, 10, "shoe"], [6, 10, "shoe"],
];

/**
 * Waiting frame 1 — looking around.
 */
const WAITING_1: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // One hand raised (waiting gesture)
  [0, 5, "skin"],
  [6, 7, "skin"], [7, 6, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

/**
 * Waiting frame 2 — other direction.
 */
const WAITING_2: PixelEntry[] = [
  // Hair
  [3, 0, "hair"], [4, 0, "hair"],
  [2, 1, "hair"], [3, 1, "hair"], [4, 1, "hair"], [5, 1, "hair"],
  // Face
  [2, 2, "skin"], [3, 2, "skin"], [4, 2, "skin"], [5, 2, "skin"],
  [2, 3, "skin"], [3, 3, "skin"], [4, 3, "skin"], [5, 3, "skin"],
  // Neck
  [3, 4, "skin"], [4, 4, "skin"],
  // Shirt
  [2, 4, "shirt"], [5, 4, "shirt"],
  [1, 5, "shirt"], [2, 5, "shirt"], [3, 5, "shirt"], [4, 5, "shirt"], [5, 5, "shirt"], [6, 5, "shirt"],
  [1, 6, "shirt"], [2, 6, "shirt"], [3, 6, "shirt"], [4, 6, "shirt"], [5, 6, "shirt"], [6, 6, "shirt"],
  [2, 7, "shirt"], [3, 7, "shirt"], [4, 7, "shirt"], [5, 7, "shirt"],
  // Arms on lap (waiting)
  [1, 7, "skin"], [6, 7, "skin"],
  // Pants
  [2, 8, "pants"], [3, 8, "pants"], [4, 8, "pants"], [5, 8, "pants"],
  [2, 9, "pants"], [3, 9, "pants"], [4, 9, "pants"], [5, 9, "pants"],
  // Shoes
  [2, 10, "shoe"], [3, 10, "shoe"], [4, 10, "shoe"], [5, 10, "shoe"],
];

// ─────────────────────────────────────────────────────────────────────────────
// Frame sets by state
// ─────────────────────────────────────────────────────────────────────────────

export type CharState = "idle" | "typing" | "done" | "waiting";

export const CHAR_FRAMES: Record<CharState, PixelEntry[][]> = {
  idle:    [IDLE_1, IDLE_2],
  typing:  [TYPING_1, TYPING_2, TYPING_3],
  done:    [DONE_1],
  waiting: [WAITING_1, WAITING_2],
};

// ─────────────────────────────────────────────────────────────────────────────
// Box-shadow generator
// ─────────────────────────────────────────────────────────────────────────────

const COLOR_MAP_DEFAULTS: Record<ColorKey, string> = {
  shirt:   "#5a9bd4",
  skin:    "#dbb99a",
  hair:    "#6b5344",
  pants:   "#3b4252",
  shoe:    "#2e3440",
  outline: "#1a1a2e",
};

export interface CharPalette {
  shirt: string;
  skin: string;
  hair: string;
  pants: string;
  shoe: string;
  outline: string;
}

export function buildPalette(crewHex: string): CharPalette {
  return {
    shirt:   deriveShirtColor(crewHex),
    skin:    deriveSkinColor(crewHex),
    hair:    deriveHairColor(crewHex),
    pants:   COLOR_MAP_DEFAULTS.pants,
    shoe:    COLOR_MAP_DEFAULTS.shoe,
    outline: COLOR_MAP_DEFAULTS.outline,
  };
}

/**
 * Build a CSS box-shadow string from a pixel frame + palette.
 * Each pixel becomes a `Xpx Ypx 0 color` entry.
 */
export function buildCharShadow(
  frame: PixelEntry[],
  palette: CharPalette,
): string {
  return frame
    .map(([col, row, key]) => `${col}px ${row}px 0 ${palette[key]}`)
    .join(", ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Desk SVG data — 16×10 pixel grid
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  colorKey: "desk" | "monitor" | "screen" | "keyboard" | "leg" | "mug";
}

/** Desk pixel art: monitor on desk surface with keyboard. */
export const DESK_RECTS: DeskRect[] = [
  // Desk surface
  { x: 0, y: 6, w: 16, h: 2, colorKey: "desk" },
  // Desk legs
  { x: 1, y: 8, w: 1, h: 2, colorKey: "leg" },
  { x: 14, y: 8, w: 1, h: 2, colorKey: "leg" },
  // Monitor frame
  { x: 4, y: 0, w: 8, h: 1, colorKey: "monitor" },
  { x: 4, y: 5, w: 8, h: 1, colorKey: "monitor" },
  { x: 4, y: 0, w: 1, h: 6, colorKey: "monitor" },
  { x: 11, y: 0, w: 1, h: 6, colorKey: "monitor" },
  // Screen (inner)
  { x: 5, y: 1, w: 6, h: 4, colorKey: "screen" },
  // Monitor stand
  { x: 7, y: 6, w: 2, h: 1, colorKey: "monitor" },
  // Keyboard
  { x: 3, y: 7, w: 6, h: 1, colorKey: "keyboard" },
  // Coffee mug
  { x: 13, y: 5, w: 2, h: 2, colorKey: "mug" },
];

export interface DeskPalette {
  desk: string;
  monitor: string;
  screen: string;
  keyboard: string;
  leg: string;
  mug: string;
}

export function buildDeskPalette(crewHex: string, isLive: boolean): DeskPalette {
  return {
    desk:     "#3b3f4a",
    monitor:  "#2a2d35",
    screen:   isLive ? deriveScreenColor(crewHex) : "#1e2028",
    keyboard: "#444851",
    leg:      "#2a2d35",
    mug:      crewHex,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation timing
// ─────────────────────────────────────────────────────────────────────────────

/** Milliseconds per frame for each state's animation cycle. */
export const ANIM_INTERVALS: Record<CharState, number> = {
  idle:    1200,
  typing:  250,
  done:    0,     // Static
  waiting: 800,
};
