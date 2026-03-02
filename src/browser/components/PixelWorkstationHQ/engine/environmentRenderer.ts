/**
 * Canvas 2D environment background renderers.
 *
 * Replaces CSS gradient backgrounds (graph-paper grid, dot grid, wood planks)
 * with Canvas 2D drawing operations.
 *
 * Supports light/dark themes:
 *   - Light theme → warm cream/beige/wood tones (day feel)
 *   - Dark theme  → deep navy/charcoal tones (night feel)
 *
 * Theme is detected from the DOM via `data-theme` attribute on `<html>`.
 */

import type { TimeOfDay } from "../sprites/types";

// ─────────────────────────────────────────────────────────────────────────────
// Theme detection
// ─────────────────────────────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark";

/**
 * Read the current theme from the DOM.
 * Falls back to "dark" if unset (app default).
 */
export function getThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function rgba(hex: string, alpha: number): string {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-of-day + theme palettes
// ─────────────────────────────────────────────────────────────────────────────

interface EnvColors {
  wallBg: string;
  wallGrid: string;
  floorBg: string;
  floorDot: string;
  contactLine: string;
}

// ── Dark theme palettes (deep navy tones matching --color-background: #0C0F1A) ──

const DARK_ENV_COLORS: Record<TimeOfDay, EnvColors> = {
  morning: {
    wallBg: "rgba(17,21,40,0.85)",
    wallGrid: "rgba(100,120,180,0.08)",
    floorBg: "rgba(12,15,26,0.80)",
    floorDot: "rgba(100,120,180,0.07)",
    contactLine: "rgba(100,120,180,0.18)",
  },
  afternoon: {
    wallBg: "rgba(17,21,40,0.80)",
    wallGrid: "rgba(100,115,148,0.08)",
    floorBg: "rgba(12,15,26,0.75)",
    floorDot: "rgba(100,115,148,0.06)",
    contactLine: "rgba(100,115,148,0.15)",
  },
  evening: {
    wallBg: "rgba(15,17,32,0.88)",
    wallGrid: "rgba(80,100,160,0.06)",
    floorBg: "rgba(10,12,22,0.85)",
    floorDot: "rgba(80,100,160,0.05)",
    contactLine: "rgba(80,100,160,0.12)",
  },
  night: {
    wallBg: "rgba(10,12,22,0.92)",
    wallGrid: "rgba(60,80,140,0.05)",
    floorBg: "rgba(8,10,18,0.90)",
    floorDot: "rgba(60,80,140,0.04)",
    contactLine: "rgba(60,80,140,0.10)",
  },
};

// ── Light theme palettes (warm cream/beige tones matching --color-background: #FFFCF0) ──

const LIGHT_ENV_COLORS: Record<TimeOfDay, EnvColors> = {
  morning: {
    wallBg: "#F5EDD8",                  // warm cream
    wallGrid: "rgba(180,160,120,0.18)",
    floorBg: "#EDE4CC",                 // warm beige
    floorDot: "rgba(170,150,110,0.20)",
    contactLine: "rgba(160,140,100,0.30)",
  },
  afternoon: {
    wallBg: "#F2E8D0",                  // golden cream
    wallGrid: "rgba(175,155,115,0.15)",
    floorBg: "#EAE0C5",
    floorDot: "rgba(165,145,105,0.18)",
    contactLine: "rgba(155,135,95,0.28)",
  },
  evening: {
    wallBg: "#E8DCC4",                  // dusky warm
    wallGrid: "rgba(160,130,90,0.14)",
    floorBg: "#E0D5B8",
    floorDot: "rgba(150,120,80,0.16)",
    contactLine: "rgba(150,125,85,0.25)",
  },
  night: {
    wallBg: "#DED3BA",                  // warm taupe
    wallGrid: "rgba(140,120,80,0.12)",
    floorBg: "#D6CBAE",
    floorDot: "rgba(130,110,70,0.14)",
    contactLine: "rgba(130,115,75,0.22)",
  },
};

// ── Wood floor palettes ──

interface WoodColors {
  plank1: string;
  plank2: string;
  grain: string;
}

const DARK_WOOD: Record<TimeOfDay, WoodColors> = {
  morning:   { plank1: "#1e2030", plank2: "#1a1c2c", grain: "rgba(255,255,255,0.03)" },
  afternoon: { plank1: "#1c1e2e", plank2: "#181a28", grain: "rgba(255,255,255,0.03)" },
  evening:   { plank1: "#171926", plank2: "#141622", grain: "rgba(255,255,255,0.025)" },
  night:     { plank1: "#12141e", plank2: "#0f111a", grain: "rgba(255,255,255,0.02)" },
};

const LIGHT_WOOD: Record<TimeOfDay, WoodColors> = {
  morning:   { plank1: "#D4B896", plank2: "#CCAE8A", grain: "rgba(0,0,0,0.06)" },
  afternoon: { plank1: "#CEAE88", plank2: "#C5A37C", grain: "rgba(0,0,0,0.06)" },
  evening:   { plank1: "#C09A74", plank2: "#B8906A", grain: "rgba(0,0,0,0.07)" },
  night:     { plank1: "#B08C66", plank2: "#A8825C", grain: "rgba(0,0,0,0.07)" },
};

function getEnvColors(timeOfDay: TimeOfDay, theme: ThemeMode): EnvColors {
  return theme === "light" ? LIGHT_ENV_COLORS[timeOfDay] : DARK_ENV_COLORS[timeOfDay];
}

function getWoodColors(timeOfDay: TimeOfDay, theme: ThemeMode): WoodColors {
  return theme === "light" ? LIGHT_WOOD[timeOfDay] : DARK_WOOD[timeOfDay];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public renderers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draw the wall panel background with graph-paper grid.
 * Occupies the top portion of the scene (above the desk).
 */
export function drawWallPattern(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  timeOfDay: TimeOfDay,
  theme: ThemeMode = "dark",
): void {
  const c = getEnvColors(timeOfDay, theme);

  // Background fill
  ctx.fillStyle = c.wallBg;
  ctx.fillRect(x, y, w, h);

  // Grid lines
  const gridSize = 16;
  ctx.strokeStyle = c.wallGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Vertical lines
  for (let gx = x + gridSize; gx < x + w; gx += gridSize) {
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
  }
  // Horizontal lines
  for (let gy = y + gridSize; gy < y + h; gy += gridSize) {
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
  }
  ctx.stroke();
}

/**
 * Draw the floor panel background with dot grid.
 */
export function drawFloorPattern(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  timeOfDay: TimeOfDay,
  theme: ThemeMode = "dark",
): void {
  const c = getEnvColors(timeOfDay, theme);

  // Background fill
  ctx.fillStyle = c.floorBg;
  ctx.fillRect(x, y, w, h);

  // Dot grid
  const dotSpacing = 12;
  const dotRadius = theme === "light" ? 0.7 : 0.5;
  ctx.fillStyle = c.floorDot;
  for (let dy = y + dotSpacing; dy < y + h; dy += dotSpacing) {
    for (let dx = x + dotSpacing; dx < x + w; dx += dotSpacing) {
      ctx.beginPath();
      ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draw a 1px contact/separator line (floor grounding).
 */
export function drawFloorLine(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number,
  timeOfDay: TimeOfDay,
  theme: ThemeMode = "dark",
): void {
  ctx.strokeStyle = getEnvColors(timeOfDay, theme).contactLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + 0.5);
  ctx.lineTo(x + w, y + 0.5);
  ctx.stroke();
}

/**
 * Draw an ambient glow effect for live minions (radial gradient).
 */
export function drawAmbientGlow(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, radius: number,
  accentHex: string,
  alpha: number = 0.15,
): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  grad.addColorStop(0, rgba(accentHex, alpha));
  grad.addColorStop(1, rgba(accentHex, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

/**
 * Draw a unified tile grid across the entire scene.
 *
 * Single background color + single grid pattern — no zone split.
 */
export function drawSceneGrid(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  _contactY: number,
  timeOfDay: TimeOfDay,
  theme: ThemeMode = "dark",
): void {
  const c = getEnvColors(timeOfDay, theme);

  // Single uniform background
  ctx.fillStyle = c.wallBg;
  ctx.fillRect(x, y, w, h);

  // Single uniform grid
  const gridSize = 16;
  ctx.strokeStyle = c.wallGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let gx = x + gridSize; gx < x + w; gx += gridSize) {
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
  }
  for (let gy = y + gridSize; gy < y + h; gy += gridSize) {
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
  }
  ctx.stroke();
}

/**
 * Draw wood plank floor pattern (for individual card scenes).
 */
export function drawWoodFloor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  timeOfDay: TimeOfDay = "afternoon",
  theme: ThemeMode = "dark",
): void {
  const wood = getWoodColors(timeOfDay, theme);
  const plankHeight = 8;
  const colors = [wood.plank1, wood.plank2];
  for (let py = y; py < y + h; py += plankHeight) {
    ctx.fillStyle = colors[Math.floor((py - y) / plankHeight) % 2];
    ctx.fillRect(x, py, w, Math.min(plankHeight, y + h - py));
  }
  // Subtle grain line between planks
  ctx.strokeStyle = wood.grain;
  ctx.lineWidth = 1;
  for (let py = y + plankHeight; py < y + h; py += plankHeight) {
    ctx.beginPath();
    ctx.moveTo(x, py + 0.5);
    ctx.lineTo(x + w, py + 0.5);
    ctx.stroke();
  }
}
