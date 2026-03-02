/**
 * Canvas 2D environment background renderers.
 *
 * Replaces CSS gradient backgrounds (graph-paper grid, dot grid, wood planks)
 * with Canvas 2D drawing operations.
 */

import type { TimeOfDay } from "../sprites/types";

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers (lightweight, no dependency on colorUtils)
// ─────────────────────────────────────────────────────────────────────────────

function rgba(hex: string, alpha: number): string {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-of-day palette
// ─────────────────────────────────────────────────────────────────────────────

interface EnvColors {
  wallBg: string;
  wallGrid: string;
  floorBg: string;
  floorDot: string;
  contactLine: string;
}

const ENV_COLORS: Record<TimeOfDay, EnvColors> = {
  morning: {
    wallBg: "#1c1e28",
    wallGrid: "rgba(100,120,160,0.08)",
    floorBg: "#16181f",
    floorDot: "rgba(100,120,160,0.06)",
    contactLine: "rgba(100,120,160,0.15)",
  },
  afternoon: {
    wallBg: "#1a1c24",
    wallGrid: "rgba(100,120,160,0.08)",
    floorBg: "#14161c",
    floorDot: "rgba(100,120,160,0.06)",
    contactLine: "rgba(100,120,160,0.15)",
  },
  evening: {
    wallBg: "#151720",
    wallGrid: "rgba(80,100,140,0.06)",
    floorBg: "#111318",
    floorDot: "rgba(80,100,140,0.05)",
    contactLine: "rgba(80,100,140,0.12)",
  },
  night: {
    wallBg: "#0e1016",
    wallGrid: "rgba(60,80,120,0.05)",
    floorBg: "#0a0c10",
    floorDot: "rgba(60,80,120,0.04)",
    contactLine: "rgba(60,80,120,0.10)",
  },
};

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
): void {
  const c = ENV_COLORS[timeOfDay];

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
): void {
  const c = ENV_COLORS[timeOfDay];

  // Background fill
  ctx.fillStyle = c.floorBg;
  ctx.fillRect(x, y, w, h);

  // Dot grid
  const dotSpacing = 12;
  const dotRadius = 0.5;
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
): void {
  ctx.strokeStyle = ENV_COLORS[timeOfDay].contactLine;
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
 * Draw wood plank floor pattern (for individual card scenes).
 */
export function drawWoodFloor(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  const plankHeight = 8;
  const colors = ["#1a1c22", "#1c1e24"];
  for (let py = y; py < y + h; py += plankHeight) {
    ctx.fillStyle = colors[Math.floor((py - y) / plankHeight) % 2];
    ctx.fillRect(x, py, w, Math.min(plankHeight, y + h - py));
  }
  // Subtle grain line between planks
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let py = y + plankHeight; py < y + h; py += plankHeight) {
    ctx.beginPath();
    ctx.moveTo(x, py + 0.5);
    ctx.lineTo(x + w, py + 0.5);
    ctx.stroke();
  }
}
