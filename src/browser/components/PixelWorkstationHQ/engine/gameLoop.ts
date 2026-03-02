/**
 * Global requestAnimationFrame loop manager.
 *
 * All canvas scenes register as subscribers. The loop auto-starts on first
 * subscriber and auto-stops when none remain.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface SceneSubscriber {
  /** Advance simulation by `dt` seconds. */
  update(dt: number): void;
  /** Draw current state to the subscriber's own canvas context. */
  render(): void;
  /** Return false to skip this frame (e.g. off-screen). */
  isActive(): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameLoop singleton
// ─────────────────────────────────────────────────────────────────────────────

class GameLoop {
  private subscribers = new Set<SceneSubscriber>();
  private lastTime = 0;
  private rafId = 0;
  private running = false;

  /** Register a scene subscriber. Returns an unregister function. */
  register(sub: SceneSubscriber): () => void {
    this.subscribers.add(sub);
    if (!this.running) this.start();
    return () => {
      this.subscribers.delete(sub);
      if (this.subscribers.size === 0) this.stop();
    };
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;

    // Delta time in seconds, clamped to avoid spiral-of-death on tab background
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    for (const sub of this.subscribers) {
      if (!sub.isActive()) continue;
      sub.update(dt);
      sub.render();
    }

    this.rafId = requestAnimationFrame(this.tick);
  };
}

/** Singleton game loop instance shared by all canvas scenes. */
export const gameLoop = new GameLoop();
