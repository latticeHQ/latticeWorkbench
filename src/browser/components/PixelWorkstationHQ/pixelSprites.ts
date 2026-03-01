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
// Desk SVG data — full workstation scene 32×14 pixel grid
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  colorKey: "desk" | "monitor" | "screen" | "keyboard" | "leg" | "mug"
    | "plant" | "plantPot" | "shelf" | "book1" | "book2" | "book3"
    | "lamp" | "lampShade" | "mouse" | "screenLine" | "deskEdge"
    | "monitor2" | "screen2" | "stand";
}

/** Full workstation: dual monitor desk with plant, shelf, lamp, coffee. */
export const DESK_RECTS: DeskRect[] = [
  // ── Bookshelf on wall (background) ──
  { x: 24, y: 0, w: 7, h: 1, colorKey: "shelf" },
  { x: 24, y: 1, w: 1, h: 3, colorKey: "shelf" },
  { x: 30, y: 1, w: 1, h: 3, colorKey: "shelf" },
  { x: 24, y: 4, w: 7, h: 1, colorKey: "shelf" },
  // Books on shelf
  { x: 25, y: 1, w: 1, h: 3, colorKey: "book1" },
  { x: 26, y: 1, w: 1, h: 3, colorKey: "book2" },
  { x: 27, y: 2, w: 1, h: 2, colorKey: "book3" },
  { x: 28, y: 1, w: 1, h: 3, colorKey: "book1" },
  { x: 29, y: 1, w: 2, h: 3, colorKey: "book2" },

  // ── Desk lamp (far left) ──
  { x: 0, y: 4, w: 1, h: 1, colorKey: "lamp" },
  { x: 0, y: 3, w: 1, h: 1, colorKey: "lamp" },
  { x: -1, y: 2, w: 3, h: 1, colorKey: "lampShade" },

  // ── Main desk surface ──
  { x: 0, y: 8, w: 24, h: 1, colorKey: "deskEdge" },
  { x: 0, y: 9, w: 24, h: 2, colorKey: "desk" },
  // Desk legs
  { x: 1, y: 11, w: 1, h: 3, colorKey: "leg" },
  { x: 22, y: 11, w: 1, h: 3, colorKey: "leg" },
  // Mid support bar
  { x: 1, y: 12, w: 22, h: 1, colorKey: "leg" },

  // ── Primary monitor (large, centered-left) ──
  { x: 3, y: 1, w: 10, h: 1, colorKey: "monitor" },
  { x: 3, y: 7, w: 10, h: 1, colorKey: "monitor" },
  { x: 3, y: 1, w: 1, h: 7, colorKey: "monitor" },
  { x: 12, y: 1, w: 1, h: 7, colorKey: "monitor" },
  // Screen
  { x: 4, y: 2, w: 8, h: 5, colorKey: "screen" },
  // Screen scanlines / code lines (when active)
  { x: 5, y: 3, w: 5, h: 1, colorKey: "screenLine" },
  { x: 5, y: 5, w: 6, h: 1, colorKey: "screenLine" },
  // Monitor stand
  { x: 7, y: 8, w: 2, h: 1, colorKey: "stand" },

  // ── Secondary monitor (smaller, right side) ──
  { x: 15, y: 2, w: 7, h: 1, colorKey: "monitor2" },
  { x: 15, y: 7, w: 7, h: 1, colorKey: "monitor2" },
  { x: 15, y: 2, w: 1, h: 6, colorKey: "monitor2" },
  { x: 21, y: 2, w: 1, h: 6, colorKey: "monitor2" },
  // Screen 2
  { x: 16, y: 3, w: 5, h: 4, colorKey: "screen2" },
  // Stand 2
  { x: 18, y: 8, w: 1, h: 1, colorKey: "stand" },

  // ── Keyboard ──
  { x: 5, y: 9, w: 8, h: 1, colorKey: "keyboard" },
  // ── Mouse ──
  { x: 14, y: 9, w: 2, h: 1, colorKey: "mouse" },

  // ── Coffee mug ──
  { x: 20, y: 8, w: 2, h: 2, colorKey: "mug" },

  // ── Plant (far right on desk) ──
  // Pot
  { x: 26, y: 10, w: 3, h: 2, colorKey: "plantPot" },
  { x: 27, y: 12, w: 1, h: 1, colorKey: "plantPot" },
  // Leaves
  { x: 26, y: 7, w: 1, h: 1, colorKey: "plant" },
  { x: 27, y: 6, w: 2, h: 1, colorKey: "plant" },
  { x: 25, y: 8, w: 2, h: 1, colorKey: "plant" },
  { x: 28, y: 7, w: 2, h: 2, colorKey: "plant" },
  { x: 27, y: 8, w: 2, h: 1, colorKey: "plant" },
  // Stem
  { x: 27, y: 9, w: 1, h: 1, colorKey: "plant" },
];

export interface DeskPalette {
  desk: string;
  deskEdge: string;
  monitor: string;
  monitor2: string;
  screen: string;
  screen2: string;
  screenLine: string;
  keyboard: string;
  mouse: string;
  leg: string;
  stand: string;
  mug: string;
  plant: string;
  plantPot: string;
  shelf: string;
  book1: string;
  book2: string;
  book3: string;
  lamp: string;
  lampShade: string;
}

export function buildDeskPalette(crewHex: string, isLive: boolean): DeskPalette {
  const screenColor = isLive ? deriveScreenColor(crewHex) : "#1e2028";
  const lineColor = isLive ? deriveScreenColor(crewHex) + "80" : "#1e2028";
  return {
    desk:       "#3b3f4a",
    deskEdge:   "#4a4e5a",
    monitor:    "#2a2d35",
    monitor2:   "#2a2d35",
    screen:     screenColor,
    screen2:    isLive ? screenColor + "cc" : "#1a1c24",
    screenLine: lineColor,
    keyboard:   "#444851",
    mouse:      "#505560",
    leg:        "#2a2d35",
    stand:      "#353840",
    mug:        crewHex,
    plant:      "#4caf50",
    plantPot:   "#6b5b4f",
    shelf:      "#5a4a3f",
    book1:      "#cc4444",
    book2:      "#4488cc",
    book3:      "#ddaa33",
    lamp:       "#888888",
    lampShade:  isLive ? crewHex + "cc" : "#555555",
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
