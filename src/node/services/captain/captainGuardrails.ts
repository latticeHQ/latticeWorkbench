/**
 * Captain Guardrails
 *
 * Cost control, error recovery, and safety mechanisms for the autonomous mind.
 * Prevents runaway token spending, handles worker failures gracefully,
 * and ensures the Captain doesn't become annoying with proactive messages.
 */

import { log } from "@/node/services/log";

// ---------------------------------------------------------------------------
// Cost Guardrails
// ---------------------------------------------------------------------------

export interface CostBudget {
  /** Max tokens per cognitive tick. */
  maxTokensPerTick: number;
  /** Max tokens per hour. */
  maxTokensPerHour: number;
  /** Max tokens per day. */
  maxTokensPerDay: number;
  /** Max concurrent workers. */
  maxConcurrentWorkers: number;
  /** Max worker spawns per hour. */
  maxWorkerSpawnsPerHour: number;
}

export const DEFAULT_COST_BUDGET: CostBudget = {
  maxTokensPerTick: 8_192,
  maxTokensPerHour: 200_000,
  maxTokensPerDay: 2_000_000,
  maxConcurrentWorkers: 20,
  maxWorkerSpawnsPerHour: 50,
};

export class CostGuardrail {
  private budget: CostBudget;
  private workerSpawnsPerHour: number[] = [];
  private currentConcurrentWorkers: number = 0;

  // Rolling window trackers
  private hourlyTokens: number = 0;
  private dailyTokens: number = 0;
  private lastHourReset: number = Date.now();
  private lastDayReset: number = Date.now();

  constructor(budget?: Partial<CostBudget>) {
    this.budget = { ...DEFAULT_COST_BUDGET, ...budget };
  }

  /** Check if a cognitive tick is allowed (token budget). */
  canTick(): { allowed: boolean; reason?: string } {
    this.maybeResetWindows();

    if (this.hourlyTokens >= this.budget.maxTokensPerHour) {
      return {
        allowed: false,
        reason: `Hourly token budget exceeded (${this.hourlyTokens}/${this.budget.maxTokensPerHour})`,
      };
    }

    if (this.dailyTokens >= this.budget.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Daily token budget exceeded (${this.dailyTokens}/${this.budget.maxTokensPerDay})`,
      };
    }

    return { allowed: true };
  }

  /** Check if spawning a worker is allowed. */
  canSpawnWorker(): { allowed: boolean; reason?: string } {
    this.maybeResetWindows();

    if (this.currentConcurrentWorkers >= this.budget.maxConcurrentWorkers) {
      return {
        allowed: false,
        reason: `Max concurrent workers reached (${this.currentConcurrentWorkers}/${this.budget.maxConcurrentWorkers})`,
      };
    }

    const recentSpawns = this.workerSpawnsPerHour.filter(
      (t) => Date.now() - t < 3_600_000,
    ).length;
    if (recentSpawns >= this.budget.maxWorkerSpawnsPerHour) {
      return {
        allowed: false,
        reason: `Hourly worker spawn limit reached (${recentSpawns}/${this.budget.maxWorkerSpawnsPerHour})`,
      };
    }

    return { allowed: true };
  }

  /** Record token usage from a cognitive tick. */
  recordTokenUsage(tokens: number): void {
    this.hourlyTokens += tokens;
    this.dailyTokens += tokens;
  }

  /** Record a worker spawn. */
  recordWorkerSpawn(): void {
    this.workerSpawnsPerHour.push(Date.now());
    this.currentConcurrentWorkers++;
  }

  /** Record a worker completion/cleanup. */
  recordWorkerComplete(): void {
    this.currentConcurrentWorkers = Math.max(0, this.currentConcurrentWorkers - 1);
  }

  /** Get current usage stats. */
  getStats(): {
    hourlyTokens: number;
    dailyTokens: number;
    concurrentWorkers: number;
    budget: CostBudget;
  } {
    return {
      hourlyTokens: this.hourlyTokens,
      dailyTokens: this.dailyTokens,
      concurrentWorkers: this.currentConcurrentWorkers,
      budget: this.budget,
    };
  }

  private maybeResetWindows(): void {
    const now = Date.now();
    if (now - this.lastHourReset > 3_600_000) {
      this.hourlyTokens = 0;
      this.lastHourReset = now;
      this.workerSpawnsPerHour = this.workerSpawnsPerHour.filter(
        (t) => now - t < 3_600_000,
      );
    }
    if (now - this.lastDayReset > 86_400_000) {
      this.dailyTokens = 0;
      this.lastDayReset = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Initiative Throttle
// ---------------------------------------------------------------------------

export class InitiativeThrottle {
  private lastProactiveMessage: number = 0;
  private proactiveMessageCount: number = 0;
  private lastCountReset: number = Date.now();

  /** Minimum time between proactive messages (ms). */
  private readonly minInterval: number;
  /** Max proactive messages per hour. */
  private readonly maxPerHour: number;

  constructor(minIntervalMs: number = 300_000, maxPerHour: number = 6) {
    this.minInterval = minIntervalMs;
    this.maxPerHour = maxPerHour;
  }

  /** Check if the Captain can send a proactive message. */
  canMessage(): boolean {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.lastCountReset > 3_600_000) {
      this.proactiveMessageCount = 0;
      this.lastCountReset = now;
    }

    // Check interval
    if (now - this.lastProactiveMessage < this.minInterval) {
      return false;
    }

    // Check hourly limit
    if (this.proactiveMessageCount >= this.maxPerHour) {
      return false;
    }

    return true;
  }

  /** Record that a proactive message was sent. */
  recordMessage(): void {
    this.lastProactiveMessage = Date.now();
    this.proactiveMessageCount++;
  }
}

// ---------------------------------------------------------------------------
// Error Recovery
// ---------------------------------------------------------------------------

export class ErrorRecovery {
  private consecutiveErrors: number = 0;
  private backoffMs: number = 1_000;

  /** Max consecutive errors before circuit-breaking. */
  private readonly maxErrors: number;
  /** Max backoff time (ms). */
  private readonly maxBackoff: number;

  constructor(maxErrors: number = 5, maxBackoffMs: number = 300_000) {
    this.maxErrors = maxErrors;
    this.maxBackoff = maxBackoffMs;
  }

  /** Record a successful operation. Resets error count. */
  recordSuccess(): void {
    this.consecutiveErrors = 0;
    this.backoffMs = 1_000;
  }

  /** Record an error. Returns whether the loop should continue. */
  recordError(error: Error): { shouldContinue: boolean; backoffMs: number } {
    this.consecutiveErrors++;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoff);

    log.error(
      `[Captain Recovery] Error #${this.consecutiveErrors}: ${error.message}`,
    );

    if (this.consecutiveErrors >= this.maxErrors) {
      log.error(
        `[Captain Recovery] Circuit breaker triggered after ${this.maxErrors} consecutive errors. Pausing cognitive loop.`,
      );
      return { shouldContinue: false, backoffMs: this.backoffMs };
    }

    return { shouldContinue: true, backoffMs: this.backoffMs };
  }

  /** Check if the system is in a healthy state. */
  isHealthy(): boolean {
    return this.consecutiveErrors < this.maxErrors;
  }

  /** Get recovery stats. */
  getStats(): { consecutiveErrors: number; backoffMs: number; healthy: boolean } {
    return {
      consecutiveErrors: this.consecutiveErrors,
      backoffMs: this.backoffMs,
      healthy: this.isHealthy(),
    };
  }
}
