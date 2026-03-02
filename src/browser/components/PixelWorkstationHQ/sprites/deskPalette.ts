/**
 * Desk palette builder with warm wood tones and time-of-day ambient shifting.
 *
 * Warm palette: desk surfaces use rich brown/walnut instead of cold blue-gray.
 * Time-of-day: morning warm-shifts, evening dims, night darkens and cools.
 * Crew color: drives mug, lamp shade, screen accent, chair tint, poster.
 */

import type { DeskPalette, TimeOfDay } from "./types";
import { darken, lighten, tintWarm, deriveScreenColor } from "./colorUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Base palette (afternoon / neutral)
// ─────────────────────────────────────────────────────────────────────────────

interface BasePalette {
  desk: string;
  deskEdge: string;
  monitor: string;
  monitor2: string;
  keyboard: string;
  mouse: string;
  leg: string;
  stand: string;
  plant: string;
  plantPot: string;
  shelf: string;
  book1: string;
  book2: string;
  book3: string;
  lamp: string;
  chair: string;
  chairBack: string;
  chairLeg: string;
  paper: string;
  paperLine: string;
  wallBaseboard: string;
  headphones: string;
  coaster: string;
}

const BASE: BasePalette = {
  desk:          "#5a4a3f",   // warm walnut brown
  deskEdge:      "#6b5b50",   // lighter wood edge
  monitor:       "#404550",   // dark charcoal bezel
  monitor2:      "#404550",
  keyboard:      "#505560",   // medium gray
  mouse:         "#585e68",
  leg:           "#3a3530",   // dark wood
  stand:         "#4a4540",
  plant:         "#5cbf60",   // bright green
  plantPot:      "#7a6a5e",   // terracotta brown
  shelf:         "#6b5b4f",   // medium wood
  book1:         "#cc5544",   // red
  book2:         "#4488cc",   // blue
  book3:         "#ddaa33",   // yellow
  lamp:          "#8a8a8a",   // metal gray
  chair:         "#454a55",   // dark charcoal
  chairBack:     "#3a3f4a",   // darker back
  chairLeg:      "#606570",   // chrome-ish
  paper:         "#e8e4dd",   // off-white
  paperLine:     "#aaa8a0",   // subtle lines
  wallBaseboard: "#3a3428",   // dark strip
  headphones:    "#2a2d35",   // dark plastic
  coaster:       "#5a5040",   // cork/wood
};

// ─────────────────────────────────────────────────────────────────────────────
// Time-of-day modifiers
// ─────────────────────────────────────────────────────────────────────────────

type ColorTransform = (hex: string) => string;

const IDENTITY: ColorTransform = (h) => h;

const TIME_TRANSFORMS: Record<TimeOfDay, ColorTransform> = {
  morning:   (hex) => tintWarm(hex, 0.08),        // warm orange tint
  afternoon: IDENTITY,                              // neutral baseline
  evening:   (hex) => darken(hex, 12),              // dim everything
  night:     (hex) => darken(hex, 25),              // dark, cool shift
};

// ─────────────────────────────────────────────────────────────────────────────
// Public builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a complete desk palette.
 *
 * @param crewHex  — crew color hex (drives accent items)
 * @param isLive   — whether the minion is actively streaming
 * @param timeOfDay — ambient time setting (default: "afternoon")
 */
export function buildDeskPalette(
  crewHex: string,
  isLive: boolean,
  timeOfDay: TimeOfDay = "afternoon",
): DeskPalette {
  const tx = TIME_TRANSFORMS[timeOfDay];

  // Screen colors based on live state
  const screenColor = isLive ? deriveScreenColor(crewHex) : "#1e2028";
  const lineColor = isLive ? lighten(crewHex, 30) : "#1e2028";
  const contentColor = isLive ? "#a0e0a0" : "#1e2028"; // green code lines

  return {
    // Structure
    desk:          tx(BASE.desk),
    deskEdge:      tx(BASE.deskEdge),
    leg:           tx(BASE.leg),
    stand:         tx(BASE.stand),

    // Monitors
    monitor:       tx(BASE.monitor),
    monitor2:      tx(BASE.monitor2),
    screen:        isLive ? screenColor : tx("#1e2028"),
    screen2:       isLive ? darken(screenColor, 10) : tx("#1a1c24"),
    screenLine:    lineColor,
    screenContent: contentColor,

    // Input devices
    keyboard:      tx(BASE.keyboard),
    mouse:         tx(BASE.mouse),
    headphones:    tx(BASE.headphones),

    // Desk items
    paper:         tx(BASE.paper),
    paperLine:     tx(BASE.paperLine),
    coaster:       tx(BASE.coaster),
    mug:           crewHex,  // crew-colored mug

    // Props
    plant:         tx(BASE.plant),
    plantPot:      tx(BASE.plantPot),
    shelf:         tx(BASE.shelf),
    book1:         tx(BASE.book1),
    book2:         tx(BASE.book2),
    book3:         tx(BASE.book3),

    // Lamp — shade tinted with crew color when live
    lamp:          tx(BASE.lamp),
    lampShade:     isLive ? lighten(crewHex, 20) : tx("#555555"),

    // Chair — subtle crew tint when live
    chair:         isLive ? tintWarm(BASE.chair, 0.05) : tx(BASE.chair),
    chairBack:     tx(BASE.chairBack),
    chairLeg:      tx(BASE.chairLeg),

    // Wall details
    wallBaseboard: tx(BASE.wallBaseboard),
    poster:        isLive ? lighten(crewHex, 40) : tx("#888888"),
    posterFrame:   tx("#4a4540"),
  };
}
