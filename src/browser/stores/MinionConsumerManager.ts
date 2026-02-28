import type { MinionConsumersState } from "./MinionStore";
import type { StreamingMessageAggregator } from "@/browser/utils/messages/StreamingMessageAggregator";
import type { ChatStats } from "@/common/types/chatStats";
import type { LatticeMessage } from "@/common/types/message";
import { sliceMessagesFromLatestCompactionBoundary } from "@/common/utils/messages/compactionBoundary";

const TOKENIZER_CANCELLED_MESSAGE = "Cancelled by newer request";

let globalTokenStatsRequestId = 0;
const latestRequestByMinion = new Map<string, number>();

async function calculateTokenStatsLatest(
  minionId: string,
  messages: LatticeMessage[],
  model: string
): Promise<ChatStats> {
  const orpcClient = window.__ORPC_CLIENT__;
  if (!orpcClient) {
    throw new Error("ORPC client not initialized");
  }

  const requestId = ++globalTokenStatsRequestId;
  latestRequestByMinion.set(minionId, requestId);

  try {
    const stats = await orpcClient.tokenizer.calculateStats({
      minionId,
      messages,
      model,
    });
    const latestRequestId = latestRequestByMinion.get(minionId);
    if (latestRequestId !== requestId) {
      throw new Error(TOKENIZER_CANCELLED_MESSAGE);
    }
    return stats;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

// Timeout for Web Worker calculations (60 seconds - generous but responsive)
const CALCULATION_TIMEOUT_MS = 60_000;

/**
 * Manages consumer token calculations for minions.
 *
 * Responsibilities:
 * - Debounces rapid calculation requests (e.g., multiple tool-call-end events)
 * - Caches calculated results to avoid redundant work (source of truth)
 * - Tracks calculation state per minion
 * - Executes Web Worker tokenization calculations
 * - Handles cleanup and disposal
 *
 * Architecture:
 * - Single responsibility: consumer tokenization calculations
 * - Owns the source-of-truth cache (calculated consumer data)
 * - MinionStore orchestrates (decides when to calculate)
 * - This manager executes (performs calculations, manages cache)
 *
 * Dual-Cache Design:
 * - MinionConsumerManager.cache: Source of truth for calculated data
 * - MinionStore.consumersStore (MapStore): Subscription management only
 *   (components subscribe to minion changes, delegates to manager for state)
 */
export class MinionConsumerManager {
  // Track scheduled calculations (in debounce window, not yet executing)
  private scheduledCalcs = new Set<string>();

  // Track executing calculations (Web Worker running)
  private pendingCalcs = new Set<string>();

  // Track minions that need recalculation after current one completes
  private needsRecalc = new Map<string, StreamingMessageAggregator>();

  // Cache calculated consumer data (persists across bumps)
  private cache = new Map<string, MinionConsumersState>();

  // Debounce timers for consumer calculations (prevents rapid-fire during tool sequences)
  private debounceTimers = new Map<string, NodeJS.Timeout>();

  // Callback to bump the store when calculation completes
  private readonly onCalculationComplete: (minionId: string) => void;
  // Stable provider-config fingerprint to stamp persisted token stats cache entries.
  // Returns null before the first config fetch completes (blocks calculation).
  private readonly getProvidersConfigVersion: () => number | null;

  // Track pending store notifications to avoid duplicate bumps within the same tick
  private pendingNotifications = new Set<string>();

  constructor(
    onCalculationComplete: (minionId: string) => void,
    getProvidersConfigVersion: () => number | null
  ) {
    this.onCalculationComplete = onCalculationComplete;
    this.getProvidersConfigVersion = getProvidersConfigVersion;
  }

  /**
   * Get cached state without side effects.
   * Returns null if no cache exists.
   */
  getCachedState(minionId: string): MinionConsumersState | null {
    return this.cache.get(minionId) ?? null;
  }

  /**
   * Check if calculation is pending or scheduled for minion.
   */
  isPending(minionId: string): boolean {
    return this.scheduledCalcs.has(minionId) || this.pendingCalcs.has(minionId);
  }

  /**
   * Get current state synchronously without triggering calculations.
   * Returns cached result if available, otherwise returns default state.
   *
   * Note: This is called from MinionStore.getMinionConsumers(),
   * which handles the lazy trigger logic separately.
   */
  getStateSync(minionId: string): MinionConsumersState {
    const cached = this.cache.get(minionId);
    if (cached) {
      return cached;
    }

    // Default state while scheduled/calculating or before first calculation
    return {
      consumers: [],
      tokenizerName: "",
      totalTokens: 0,
      isCalculating: this.scheduledCalcs.has(minionId) || this.pendingCalcs.has(minionId),
    };
  }

  /**
   * Hydrate consumer breakdown from a persisted cache (session-usage.json).
   * Skips hydration if a calculation is already scheduled/running.
   */
  hydrateFromCache(
    minionId: string,
    state: Omit<MinionConsumersState, "isCalculating">
  ): void {
    if (this.pendingCalcs.has(minionId) || this.scheduledCalcs.has(minionId)) {
      return;
    }

    this.cache.set(minionId, { ...state, isCalculating: false });
    this.notifyStoreAsync(minionId);
  }

  /**
   * Schedule a consumer calculation (debounced).
   * Batches rapid events (e.g., multiple tool-call-end) into single calculation.
   * Marks as "calculating" immediately to prevent UI flash.
   *
   * If a calculation is already running, marks minion for recalculation
   * after the current one completes.
   */
  scheduleCalculation(minionId: string, aggregator: StreamingMessageAggregator): void {
    // Clear existing timer for this minion
    const existingTimer = this.debounceTimers.get(minionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // If already executing, queue a follow-up recalculation
    if (this.pendingCalcs.has(minionId)) {
      this.needsRecalc.set(minionId, aggregator);
      return;
    }

    // Mark as scheduled immediately (triggers "Calculating..." UI, prevents flash)
    const isNewSchedule = !this.scheduledCalcs.has(minionId);
    this.scheduledCalcs.add(minionId);

    // Notify store if newly scheduled (triggers UI update)
    if (isNewSchedule) {
      this.notifyStoreAsync(minionId);
    }

    // Set new timer (150ms - imperceptible to humans, batches rapid events)
    const timer = setTimeout(() => {
      this.debounceTimers.delete(minionId);
      this.scheduledCalcs.delete(minionId); // Move from scheduled to pending
      this.executeCalculation(minionId, aggregator);
    }, 150);

    this.debounceTimers.set(minionId, timer);
  }

  /**
   * Execute background consumer calculation.
   * Only one calculation per minion at a time.
   */
  private executeCalculation(minionId: string, aggregator: StreamingMessageAggregator): void {
    // Skip if already calculating
    if (this.pendingCalcs.has(minionId)) {
      return;
    }

    this.pendingCalcs.add(minionId);

    // Mark as calculating and notify store
    this.notifyStoreAsync(minionId);

    // Run in next tick to avoid blocking caller
    void (async () => {
      try {
        // Only count tokens for the current compaction epoch — pre-boundary
        // messages carry stale context and inflate the consumer breakdown.
        const messages = sliceMessagesFromLatestCompactionBoundary(aggregator.getAllMessages());
        const model = aggregator.getCurrentModel() ?? "unknown";

        const providersConfigFingerprint = this.getProvidersConfigVersion();
        // Skip calculation until provider config has loaded — we don't know
        // which tokenizer/pricing to use yet. When config arrives,
        // refreshProvidersConfig() calls invalidateAll() which clears the cache,
        // and the next component access will naturally re-schedule calculation.
        // Don't set needsRecalc or throw — that would create an infinite retry
        // loop since the finally block re-schedules from needsRecalc.
        if (providersConfigFingerprint == null) {
          // Config not ready yet. Cache a stable "blocked" state so repeated
          // getMinionConsumers() reads don't continuously requeue work while
          // fingerprint is null. MinionStore.invalidateAll() clears this
          // cache when config changes so tokenization retries naturally.
          this.cache.set(minionId, {
            consumers: [],
            tokenizerName: "",
            totalTokens: 0,
            isCalculating: false,
          });
          this.notifyStoreAsync(minionId);
          return;
        }

        // Calculate in piscina pool with timeout protection.
        // Store the timer ID so we can clear it on early exit to prevent
        // unhandled promise rejections from orphaned timeout callbacks.
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("Calculation timeout")),
            CALCULATION_TIMEOUT_MS
          );
        });

        const fullStats = await Promise.race([
          calculateTokenStatsLatest(minionId, messages, model),
          timeoutPromise,
        ]).finally(() => clearTimeout(timeoutId));

        // Provider mappings may change while tokenization is in flight.
        // Drop outdated results instead of repopulating cache with stale tokenizer metadata.
        if (this.getProvidersConfigVersion() !== providersConfigFingerprint) {
          this.needsRecalc.set(minionId, aggregator);
          throw new Error(TOKENIZER_CANCELLED_MESSAGE);
        }

        // Store result in cache
        this.cache.set(minionId, {
          consumers: fullStats.consumers,
          tokenizerName: fullStats.tokenizerName,
          totalTokens: fullStats.totalTokens,
          isCalculating: false,
          topFilePaths: fullStats.topFilePaths,
        });

        // Notify store to trigger re-render
        this.notifyStoreAsync(minionId);
      } catch (error) {
        // Cancellations are expected during rapid events - don't cache, don't log
        // This allows lazy trigger to retry on next access
        if (error instanceof Error && error.message === TOKENIZER_CANCELLED_MESSAGE) {
          return;
        }

        // Real errors (including timeout): log and cache empty result
        console.error(`[MinionConsumerManager] Calculation failed for ${minionId}:`, error);
        this.cache.set(minionId, {
          consumers: [],
          tokenizerName: "",
          totalTokens: 0,
          isCalculating: false,
        });
        this.notifyStoreAsync(minionId);
      } finally {
        this.pendingCalcs.delete(minionId);

        // If recalculation was requested while we were running, schedule it now
        const needsRecalcAggregator = this.needsRecalc.get(minionId);
        if (needsRecalcAggregator) {
          this.needsRecalc.delete(minionId);
          this.scheduleCalculation(minionId, needsRecalcAggregator);
        }
      }
    })();
  }

  private notifyStoreAsync(minionId: string): void {
    if (this.pendingNotifications.has(minionId)) {
      return;
    }

    this.pendingNotifications.add(minionId);

    const schedule =
      typeof queueMicrotask === "function"
        ? queueMicrotask
        : (callback: () => void) => {
            void Promise.resolve().then(callback);
          };

    schedule(() => {
      this.pendingNotifications.delete(minionId);
      this.onCalculationComplete(minionId);
    });
  }

  /**
   * Remove minion state and cleanup timers.
   */
  removeMinion(minionId: string): void {
    // Clear debounce timer
    const timer = this.debounceTimers.get(minionId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(minionId);
    }

    // Clean up state
    this.cache.delete(minionId);
    this.scheduledCalcs.delete(minionId);
    this.pendingCalcs.delete(minionId);
    this.needsRecalc.delete(minionId);
    this.pendingNotifications.delete(minionId);
  }

  /**
   * Invalidate cached consumer data for all minions.
   * Clears the in-memory cache so the next access triggers recalculation
   * (e.g., after provider config changes affect tokenizer/metadata resolution).
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Cleanup all resources.
   */
  dispose(): void {
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Clear state
    this.cache.clear();
    this.scheduledCalcs.clear();
    this.pendingCalcs.clear();
    this.needsRecalc.clear();
    this.pendingNotifications.clear();
  }
}
