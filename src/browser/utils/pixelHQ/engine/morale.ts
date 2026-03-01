/**
 * Pixel HQ Morale System
 *
 * Computes a character's mood based on real Lattice minion metrics:
 *   - Error rate (lastAbortReason, repeated failures → FRUSTRATED)
 *   - Token throughput (high TPS → SWEATING)
 *   - Idle duration (no activity for 10+ min → SLEEPING)
 *   - Task completion (successful report → CELEBRATING)
 *   - Default → NEUTRAL or HAPPY
 *
 * The mood drives character animation variants:
 *   - CELEBRATING: sparkle effect, bounce animation
 *   - FRUSTRATED: slumped posture, rain cloud bubble
 *   - SWEATING: speed lines, sweat drops
 *   - SLEEPING: z-z-z bubble, slowed animation
 *   - HAPPY: normal with occasional smile blink
 *   - NEUTRAL: standard idle
 *
 * Data sources (from MinionStore / bridge):
 *   - MinionStore.getMinionState(id) → lastAbortReason, isStreamStarting
 *   - MinionStore.getMinionUsage(id) → streamingTPS
 *   - Bridge tracks: idleTimeSec, recentErrorCount, recentTaskCompletions
 */

import type { Character } from "./types";
import { MoraleMood } from "./types";
import {
  MORALE_SLEEP_THRESHOLD_SEC,
  MORALE_FRUSTRATION_THRESHOLD,
  MORALE_SWEAT_TPS_THRESHOLD,
  MORALE_CELEBRATE_DURATION_SEC,
} from "./constants";

// ─────────────────────────────────────────────────────────────────────────────
// Morale Metrics (fed from bridge)
// ─────────────────────────────────────────────────────────────────────────────

export interface MoraleMetrics {
  /** Seconds since this minion last had any stream activity */
  idleTimeSec: number;
  /** Number of errors/aborts in the recent window */
  recentErrorCount: number;
  /** Current tokens-per-second throughput */
  currentTPS: number;
  /** Whether the minion just completed a task successfully */
  justCompletedTask: boolean;
  /** Whether the minion is actively streaming */
  isActive: boolean;
  /** Whether the minion is archived (on the bench) */
  isArchived: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Morale Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the appropriate mood for a character given its current metrics.
 *
 * Priority order (highest to lowest):
 *   1. CELEBRATING — just completed a task (temporary, decays after CELEBRATE_DURATION)
 *   2. SLEEPING — idle for > SLEEP_THRESHOLD (and not active)
 *   3. FRUSTRATED — high error count
 *   4. SWEATING — high TPS (burning through tokens fast)
 *   5. HAPPY — active and working with no issues
 *   6. NEUTRAL — default idle state
 */
export function computeMorale(metrics: MoraleMetrics): MoraleMood {
  // Archived minions are always neutral (lounging on the bench)
  if (metrics.isArchived) {
    return MoraleMood.NEUTRAL;
  }

  // 1. Celebration takes highest priority (temporary)
  if (metrics.justCompletedTask) {
    return MoraleMood.CELEBRATING;
  }

  // 2. Sleeping — long idle period
  if (!metrics.isActive && metrics.idleTimeSec >= MORALE_SLEEP_THRESHOLD_SEC) {
    return MoraleMood.SLEEPING;
  }

  // 3. Frustrated — too many recent errors
  if (metrics.recentErrorCount >= MORALE_FRUSTRATION_THRESHOLD) {
    return MoraleMood.FRUSTRATED;
  }

  // 4. Sweating — high token throughput
  if (metrics.isActive && metrics.currentTPS >= MORALE_SWEAT_TPS_THRESHOLD) {
    return MoraleMood.SWEATING;
  }

  // 5. Happy — actively working with no issues
  if (metrics.isActive && metrics.recentErrorCount === 0) {
    return MoraleMood.HAPPY;
  }

  // 6. Default
  return MoraleMood.NEUTRAL;
}

// ─────────────────────────────────────────────────────────────────────────────
// Morale Tracker (per-character persistent state)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks morale metrics per character over time.
 * The bridge feeds events into this tracker, and the engine
 * reads computed moods each frame.
 */
export class MoraleTracker {
  /** Per-character metrics */
  private metrics: Map<string, MoraleMetrics> = new Map();

  /** Per-character celebration countdown timers */
  private celebrationTimers: Map<string, number> = new Map();

  /** Per-character error sliding window (timestamps of recent errors) */
  private errorWindows: Map<string, number[]> = new Map();

  /** Error window duration in seconds */
  private readonly errorWindowSec: number = 120; // 2 minutes

  /** Get or create default metrics for a character. */
  getMetrics(charId: string): MoraleMetrics {
    let m = this.metrics.get(charId);
    if (!m) {
      m = {
        idleTimeSec: 0,
        recentErrorCount: 0,
        currentTPS: 0,
        justCompletedTask: false,
        isActive: false,
        isArchived: false,
      };
      this.metrics.set(charId, m);
    }
    return m;
  }

  /**
   * Update the morale tracker each frame.
   * Advances idle timers, decays celebrations, and prunes error windows.
   */
  update(dt: number, characters: Map<string, Character>): void {
    const now = performance.now() / 1000;

    for (const [charId, char] of characters) {
      const m = this.getMetrics(charId);

      // Update idle timer
      if (m.isActive) {
        m.idleTimeSec = 0;
      } else {
        m.idleTimeSec += dt;
      }

      // Decay celebration timer
      const celebTimer = this.celebrationTimers.get(charId);
      if (celebTimer !== undefined) {
        const remaining = celebTimer - dt;
        if (remaining <= 0) {
          this.celebrationTimers.delete(charId);
          m.justCompletedTask = false;
        } else {
          this.celebrationTimers.set(charId, remaining);
        }
      }

      // Prune old errors from sliding window
      const errors = this.errorWindows.get(charId);
      if (errors) {
        const cutoff = now - this.errorWindowSec;
        const pruned = errors.filter((t) => t > cutoff);
        this.errorWindows.set(charId, pruned);
        m.recentErrorCount = pruned.length;
      }

      // Apply computed mood to character
      char.mood = computeMorale(m);
    }
  }

  // ─── Bridge Events ──────────────────────────────────────────────────

  /** Called when a minion becomes active (stream starts). */
  onActive(charId: string): void {
    const m = this.getMetrics(charId);
    m.isActive = true;
    m.idleTimeSec = 0;
  }

  /** Called when a minion becomes inactive (stream ends). */
  onInactive(charId: string): void {
    const m = this.getMetrics(charId);
    m.isActive = false;
  }

  /** Called when a minion encounters an error/abort. */
  onError(charId: string): void {
    const now = performance.now() / 1000;
    const errors = this.errorWindows.get(charId) ?? [];
    errors.push(now);
    this.errorWindows.set(charId, errors);
    const m = this.getMetrics(charId);
    m.recentErrorCount = errors.length;
  }

  /** Called when a minion successfully completes a task. */
  onTaskCompleted(charId: string): void {
    const m = this.getMetrics(charId);
    m.justCompletedTask = true;
    this.celebrationTimers.set(charId, MORALE_CELEBRATE_DURATION_SEC);
  }

  /** Called when TPS data is updated from the bridge. */
  onTPSUpdate(charId: string, tps: number): void {
    const m = this.getMetrics(charId);
    m.currentTPS = tps;
  }

  /** Called when a minion is archived/benched. */
  onArchived(charId: string): void {
    const m = this.getMetrics(charId);
    m.isArchived = true;
    m.isActive = false;
  }

  /** Called when a minion is unarchived. */
  onUnarchived(charId: string): void {
    const m = this.getMetrics(charId);
    m.isArchived = false;
  }

  /** Remove all tracking for a character. */
  removeCharacter(charId: string): void {
    this.metrics.delete(charId);
    this.celebrationTimers.delete(charId);
    this.errorWindows.delete(charId);
  }

  /** Clear all tracking data. */
  clear(): void {
    this.metrics.clear();
    this.celebrationTimers.clear();
    this.errorWindows.clear();
  }
}
