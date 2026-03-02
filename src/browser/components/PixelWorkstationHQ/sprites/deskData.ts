/**
 * Rich office workstation furniture layout.
 *
 * SVG rect array rendered at `viewBox="-2 0 48 16"` → 144×48px at 3× scale.
 * Includes: office chair, dual monitors, keyboard/mouse, headphones, papers,
 * coffee mug with coaster, wall shelf + books, desk lamp, potted plant,
 * wall poster, and baseboard detail.
 */

import type { DeskRect } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Full workstation rect array
// ─────────────────────────────────────────────────────────────────────────────

export const DESK_RECTS: DeskRect[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // WALL LAYER (background details)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Wall baseboard (bottom of wall area) ──
  { x: -2, y: 7, w: 50, h: 1, colorKey: "wallBaseboard" },

  // ── Wall poster / frame (between monitors, on wall) ──
  { x: 14, y: 0, w: 5, h: 1, colorKey: "posterFrame" },
  { x: 14, y: 4, w: 5, h: 1, colorKey: "posterFrame" },
  { x: 14, y: 0, w: 1, h: 5, colorKey: "posterFrame" },
  { x: 18, y: 0, w: 1, h: 5, colorKey: "posterFrame" },
  { x: 15, y: 1, w: 3, h: 3, colorKey: "poster" },

  // ── Bookshelf on wall (right side) ──
  { x: 30, y: 0, w: 9, h: 1, colorKey: "shelf" },
  { x: 30, y: 1, w: 1, h: 3, colorKey: "shelf" },
  { x: 38, y: 1, w: 1, h: 3, colorKey: "shelf" },
  { x: 30, y: 4, w: 9, h: 1, colorKey: "shelf" },
  // Books on shelf
  { x: 31, y: 1, w: 1, h: 3, colorKey: "book1" },
  { x: 32, y: 1, w: 1, h: 3, colorKey: "book2" },
  { x: 33, y: 2, w: 1, h: 2, colorKey: "book3" },
  { x: 34, y: 1, w: 1, h: 3, colorKey: "book1" },
  { x: 35, y: 1, w: 2, h: 3, colorKey: "book2" },
  { x: 37, y: 2, w: 1, h: 2, colorKey: "book3" },

  // ── Desk lamp (far left, on wall) ──
  { x: 0, y: 4, w: 1, h: 2, colorKey: "lamp" },
  { x: 0, y: 3, w: 1, h: 1, colorKey: "lamp" },
  { x: -1, y: 2, w: 3, h: 1, colorKey: "lampShade" },

  // ═══════════════════════════════════════════════════════════════════════════
  // DESK SURFACE + STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Main desk surface (wider for more workspace) ──
  { x: -1, y: 8, w: 32, h: 1, colorKey: "deskEdge" },
  { x: -1, y: 9, w: 32, h: 2, colorKey: "desk" },
  // Desk legs
  { x: 0, y: 11, w: 1, h: 3, colorKey: "leg" },
  { x: 29, y: 11, w: 1, h: 3, colorKey: "leg" },
  // Mid support bar
  { x: 0, y: 13, w: 30, h: 1, colorKey: "leg" },

  // ═══════════════════════════════════════════════════════════════════════════
  // MONITORS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Primary monitor (large, centered-left) ──
  // Bezel
  { x: 3, y: 1, w: 10, h: 1, colorKey: "monitor" },
  { x: 3, y: 7, w: 10, h: 1, colorKey: "monitor" },
  { x: 3, y: 1, w: 1, h: 7, colorKey: "monitor" },
  { x: 12, y: 1, w: 1, h: 7, colorKey: "monitor" },
  // Screen
  { x: 4, y: 2, w: 8, h: 5, colorKey: "screen" },
  // Screen content lines (code)
  { x: 5, y: 3, w: 5, h: 1, colorKey: "screenLine" },
  { x: 5, y: 5, w: 6, h: 1, colorKey: "screenLine" },
  { x: 5, y: 4, w: 3, h: 1, colorKey: "screenContent" },
  // Stand
  { x: 7, y: 8, w: 2, h: 1, colorKey: "stand" },

  // ── Secondary monitor (smaller, right side) ──
  // Bezel
  { x: 20, y: 2, w: 8, h: 1, colorKey: "monitor2" },
  { x: 20, y: 7, w: 8, h: 1, colorKey: "monitor2" },
  { x: 20, y: 2, w: 1, h: 6, colorKey: "monitor2" },
  { x: 27, y: 2, w: 1, h: 6, colorKey: "monitor2" },
  // Screen 2
  { x: 21, y: 3, w: 6, h: 4, colorKey: "screen2" },
  // Stand 2
  { x: 23, y: 8, w: 2, h: 1, colorKey: "stand" },

  // ═══════════════════════════════════════════════════════════════════════════
  // DESK ITEMS
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Headphones (left of keyboard) ──
  { x: 2, y: 9, w: 1, h: 2, colorKey: "headphones" },
  { x: 3, y: 8, w: 2, h: 1, colorKey: "headphones" },
  { x: 4, y: 9, w: 1, h: 1, colorKey: "headphones" },

  // ── Keyboard ──
  { x: 7, y: 9, w: 10, h: 1, colorKey: "keyboard" },
  // ── Mouse ──
  { x: 18, y: 9, w: 2, h: 1, colorKey: "mouse" },

  // ── Papers / notes (right of mouse) ──
  { x: 21, y: 9, w: 3, h: 2, colorKey: "paper" },
  { x: 22, y: 9, w: 2, h: 1, colorKey: "paperLine" },

  // ── Coffee mug + coaster ──
  { x: 25, y: 9, w: 3, h: 1, colorKey: "coaster" },
  { x: 25, y: 8, w: 2, h: 2, colorKey: "mug" },

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFICE CHAIR (in front of desk)
  // ═══════════════════════════════════════════════════════════════════════════

  // Chair back (tall, behind the seated character position)
  { x: 10, y: 9, w: 6, h: 1, colorKey: "chairBack" },
  { x: 10, y: 10, w: 1, h: 3, colorKey: "chairBack" },
  { x: 15, y: 10, w: 1, h: 3, colorKey: "chairBack" },
  // Seat
  { x: 9, y: 13, w: 8, h: 1, colorKey: "chair" },
  // Pedestal + base
  { x: 12, y: 14, w: 2, h: 1, colorKey: "chairLeg" },
  { x: 10, y: 15, w: 6, h: 1, colorKey: "chairLeg" },

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANT (far right, floor-standing)
  // ═══════════════════════════════════════════════════════════════════════════

  // Pot
  { x: 34, y: 12, w: 4, h: 2, colorKey: "plantPot" },
  { x: 35, y: 14, w: 2, h: 1, colorKey: "plantPot" },
  // Leaves
  { x: 33, y: 8, w: 2, h: 1, colorKey: "plant" },
  { x: 35, y: 7, w: 2, h: 1, colorKey: "plant" },
  { x: 34, y: 9, w: 3, h: 1, colorKey: "plant" },
  { x: 37, y: 8, w: 2, h: 2, colorKey: "plant" },
  { x: 35, y: 10, w: 2, h: 1, colorKey: "plant" },
  // Stem
  { x: 35, y: 11, w: 1, h: 1, colorKey: "plant" },
];

/** SVG viewBox for the desk scene. Wider for more environment. */
export const DESK_VIEWBOX = "-2 0 48 16";

/** Desk scene rendered dimensions at 3× scale. */
export const DESK_RENDER_W = 144;
export const DESK_RENDER_H = 48;
