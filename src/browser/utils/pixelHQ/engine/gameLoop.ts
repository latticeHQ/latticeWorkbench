/**
 * Pixel HQ Game Loop
 *
 * RequestAnimationFrame-based game loop with delta time capping.
 * Adapted from Pixel Agents' game loop implementation.
 */

import { MAX_DELTA_TIME_SEC } from "./constants";

export interface GameLoopCallbacks {
  /** Called each frame with delta time in seconds */
  update: (dt: number) => void;
  /** Called each frame after update for rendering */
  render: (dt: number) => void;
}

/**
 * Start the game loop with requestAnimationFrame.
 *
 * - Delta time is capped at MAX_DELTA_TIME_SEC to prevent physics jumps
 *   when the tab regains focus after being backgrounded.
 * - Image smoothing is disabled for pixel-perfect rendering.
 * - Returns a cleanup function to stop the loop.
 *
 * @param canvas - The canvas element to render to
 * @param callbacks - Update and render functions
 * @returns Cleanup function that stops the loop
 */
export function startGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
  }

  let lastTime: number | null = null;
  let rafId: number = 0;
  let stopped = false;

  const frame = (now: number): void => {
    if (stopped) return;

    // Calculate delta time
    const last = lastTime ?? now;
    lastTime = now;
    const rawDt = (now - last) / 1000;
    const dt = Math.min(rawDt, MAX_DELTA_TIME_SEC);

    // Update game state
    callbacks.update(dt);

    // Ensure pixel-perfect rendering (re-disable smoothing each frame
    // as some browsers reset it after canvas resize)
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
    }

    // Render
    callbacks.render(dt);

    // Schedule next frame
    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  // Return cleanup function
  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}

/**
 * Create a visibility-aware game loop that pauses when the tab is hidden.
 * Resumes automatically when the tab becomes visible again.
 *
 * @param canvas - The canvas element
 * @param callbacks - Update and render functions
 * @returns Cleanup function
 */
export function startVisibilityAwareGameLoop(
  canvas: HTMLCanvasElement,
  callbacks: GameLoopCallbacks,
): () => void {
  let stopLoop: (() => void) | null = null;
  let isRunning = false;

  const start = () => {
    if (isRunning) return;
    isRunning = true;
    stopLoop = startGameLoop(canvas, callbacks);
  };

  const stop = () => {
    if (!isRunning) return;
    isRunning = false;
    stopLoop?.();
    stopLoop = null;
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      stop();
    } else {
      start();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Start immediately if visible
  if (!document.hidden) {
    start();
  }

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    stop();
  };
}
