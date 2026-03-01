/**
 * Pixel HQ Day/Night Cycle
 *
 * Shifts office ambiance based on the user's local time:
 *
 *   Morning (6-12):   Bright, warm glow. Characters walk in from lobby.
 *   Afternoon (12-18): Peak brightness, neutral tone. Full activity.
 *   Evening (18-22):   Dimmer tiles, warm tint. Desk lamps start glowing.
 *   Night (22-6):      Very dim. Only active minion desk areas are lit.
 *
 * The cycle produces a brightness multiplier and color tint that the
 * renderer applies as a post-processing overlay on each frame.
 *
 * The system uses smooth interpolation between periods to avoid jarring
 * transitions. Each period blends into the next over ~30 minutes.
 */

import {
  DAY_MORNING_START,
  DAY_AFTERNOON_START,
  DAY_EVENING_START,
  DAY_NIGHT_START,
  DAY_BRIGHTNESS,
} from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DayNightState {
  /** Current time period name */
  period: "morning" | "afternoon" | "evening" | "night";
  /** Global brightness multiplier (0.0 - 1.0) */
  brightness: number;
  /** Ambient color tint for the overlay */
  tintColor: string;
  /** Opacity of the tint overlay (0.0 - 1.0) */
  tintAlpha: number;
  /** Whether desk lamps should be lit */
  lampsOn: boolean;
  /** Lamp glow intensity (0.0 - 1.0) */
  lampIntensity: number;
  /** Whether to show stars/moonlight in void tiles */
  showStars: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Period Colors
// ─────────────────────────────────────────────────────────────────────────────

/** RGB tint colors for each period */
const PERIOD_TINTS = {
  morning: { r: 255, g: 200, b: 120 },   // Warm sunrise gold
  afternoon: { r: 255, g: 255, b: 255 },  // Neutral white (no tint)
  evening: { r: 255, g: 160, b: 80 },     // Warm orange sunset
  night: { r: 80, g: 100, b: 180 },       // Cool blue moonlight
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the current fractional hour (0.0 - 24.0).
 * E.g., 14:30 → 14.5
 */
function getCurrentFractionalHour(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}

/**
 * Smoothly interpolate between two values using a cosine curve.
 * `t` ranges from 0 to 1.
 */
function smoothStep(a: number, b: number, t: number): number {
  const s = t * t * (3 - 2 * t); // Hermite interpolation
  return a + (b - a) * s;
}

/**
 * Get the interpolation factor between two time periods.
 * Transitions happen over `transitionDuration` hours.
 */
function getTransitionFactor(
  hour: number,
  periodStart: number,
  nextPeriodStart: number,
  transitionDuration: number = 0.5,
): number {
  // Handle wrap-around (night → morning crosses midnight)
  let effective = hour;
  let start = periodStart;
  let end = nextPeriodStart;

  if (end < start) {
    // Wrap-around case (e.g., night starts at 22, morning starts at 6)
    if (effective < start) effective += 24;
    end += 24;
  }

  const transitionStart = end - transitionDuration;

  if (effective < transitionStart) return 0; // Fully in current period
  if (effective >= end) return 1; // Fully in next period

  return (effective - transitionStart) / transitionDuration;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the current day/night state based on local time.
 *
 * Call this once per frame (or less frequently, e.g., every few seconds)
 * and pass the result to the renderer for ambient effects.
 */
export function computeDayNightState(overrideHour?: number): DayNightState {
  const hour = overrideHour ?? getCurrentFractionalHour();

  // Determine current period
  let period: DayNightState["period"];
  if (hour >= DAY_MORNING_START && hour < DAY_AFTERNOON_START) {
    period = "morning";
  } else if (hour >= DAY_AFTERNOON_START && hour < DAY_EVENING_START) {
    period = "afternoon";
  } else if (hour >= DAY_EVENING_START && hour < DAY_NIGHT_START) {
    period = "evening";
  } else {
    period = "night";
  }

  // Compute smooth brightness with transition blending
  let brightness: number;
  let tintR: number;
  let tintG: number;
  let tintB: number;

  switch (period) {
    case "morning": {
      const t = getTransitionFactor(hour, DAY_MORNING_START, DAY_AFTERNOON_START);
      brightness = smoothStep(DAY_BRIGHTNESS.morning, DAY_BRIGHTNESS.afternoon, t);
      tintR = smoothStep(PERIOD_TINTS.morning.r, PERIOD_TINTS.afternoon.r, t);
      tintG = smoothStep(PERIOD_TINTS.morning.g, PERIOD_TINTS.afternoon.g, t);
      tintB = smoothStep(PERIOD_TINTS.morning.b, PERIOD_TINTS.afternoon.b, t);
      break;
    }
    case "afternoon": {
      const t = getTransitionFactor(hour, DAY_AFTERNOON_START, DAY_EVENING_START);
      brightness = smoothStep(DAY_BRIGHTNESS.afternoon, DAY_BRIGHTNESS.evening, t);
      tintR = smoothStep(PERIOD_TINTS.afternoon.r, PERIOD_TINTS.evening.r, t);
      tintG = smoothStep(PERIOD_TINTS.afternoon.g, PERIOD_TINTS.evening.g, t);
      tintB = smoothStep(PERIOD_TINTS.afternoon.b, PERIOD_TINTS.evening.b, t);
      break;
    }
    case "evening": {
      const t = getTransitionFactor(hour, DAY_EVENING_START, DAY_NIGHT_START);
      brightness = smoothStep(DAY_BRIGHTNESS.evening, DAY_BRIGHTNESS.night, t);
      tintR = smoothStep(PERIOD_TINTS.evening.r, PERIOD_TINTS.night.r, t);
      tintG = smoothStep(PERIOD_TINTS.evening.g, PERIOD_TINTS.night.g, t);
      tintB = smoothStep(PERIOD_TINTS.evening.b, PERIOD_TINTS.night.b, t);
      break;
    }
    case "night": {
      const t = getTransitionFactor(hour, DAY_NIGHT_START, DAY_MORNING_START + 24);
      brightness = smoothStep(DAY_BRIGHTNESS.night, DAY_BRIGHTNESS.morning, t);
      tintR = smoothStep(PERIOD_TINTS.night.r, PERIOD_TINTS.morning.r, t);
      tintG = smoothStep(PERIOD_TINTS.night.g, PERIOD_TINTS.morning.g, t);
      tintB = smoothStep(PERIOD_TINTS.night.b, PERIOD_TINTS.morning.b, t);
      break;
    }
  }

  // Compute tint overlay alpha (stronger during night/evening, zero during afternoon)
  const tintAlpha =
    period === "afternoon"
      ? 0
      : period === "night"
        ? 0.15
        : period === "evening"
          ? 0.08
          : 0.05; // morning

  // Lamp state
  const lampsOn = period === "evening" || period === "night";
  const lampIntensity =
    period === "night" ? 1.0 : period === "evening" ? 0.6 : 0;

  // Stars
  const showStars = period === "night";

  return {
    period,
    brightness,
    tintColor: `rgb(${Math.round(tintR)}, ${Math.round(tintG)}, ${Math.round(tintB)})`,
    tintAlpha,
    lampsOn,
    lampIntensity,
    showStars,
  };
}

/**
 * Apply the day/night tint overlay to the canvas.
 *
 * Should be called as the last step of the main render pass,
 * after all game elements are drawn but before screen-space UI.
 *
 * @param ctx - Canvas 2D context
 * @param state - Current day/night state
 * @param canvasWidth - Logical canvas width
 * @param canvasHeight - Logical canvas height
 */
export function applyDayNightOverlay(
  ctx: CanvasRenderingContext2D,
  state: DayNightState,
  canvasWidth: number,
  canvasHeight: number,
): void {
  if (state.tintAlpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = state.tintAlpha;
  ctx.fillStyle = state.tintColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

/**
 * Draw a desk lamp glow effect at a specific world position.
 *
 * Called by the renderer for each active desk when lamps are on.
 * Creates a soft radial gradient glow centered on the desk.
 *
 * @param ctx - Canvas 2D context (in world-space coordinates)
 * @param x - Center X in world pixels
 * @param y - Center Y in world pixels
 * @param intensity - Glow intensity (0-1)
 */
export function drawDeskLampGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  intensity: number,
): void {
  if (intensity <= 0) return;

  const radius = 24; // Glow radius in world pixels

  ctx.save();
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(251, 191, 36, ${0.2 * intensity})`); // Warm yellow center
  gradient.addColorStop(0.4, `rgba(251, 191, 36, ${0.08 * intensity})`);
  gradient.addColorStop(1, "rgba(251, 191, 36, 0)"); // Fade to transparent

  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/**
 * Draw subtle twinkling star effects on void tiles during night.
 *
 * @param ctx - Canvas 2D context
 * @param x - Tile X position in world pixels
 * @param y - Tile Y position in world pixels
 * @param tileSize - Size of each tile
 * @param elapsedTime - Total elapsed time for twinkle animation
 */
export function drawStars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tileSize: number,
  elapsedTime: number,
): void {
  // Deterministic "random" based on position
  const seed = (x * 7919 + y * 104729) % 1000;
  if (seed > 50) return; // Only ~5% of void tiles get a star

  const starX = x + (seed % tileSize);
  const starY = y + ((seed * 3) % tileSize);

  // Twinkle using sine wave
  const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(elapsedTime * 0.5 + seed * 0.1));

  ctx.save();
  ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * twinkle})`;
  ctx.fillRect(starX, starY, 1, 1);
  ctx.restore();
}
