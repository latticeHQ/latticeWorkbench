import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import type { FrontendMinionMetadata, GitStatus } from "@/common/types/minion";
import {
  generateGitStatusScript,
  GIT_FETCH_SCRIPT,
  parseGitStatusScriptOutput,
} from "@/common/utils/git/gitStatus";
import { readPersistedState } from "@/browser/hooks/usePersistedState";
import { STORAGE_KEYS, MINION_DEFAULTS } from "@/constants/minionDefaults";
import { useSyncExternalStore } from "react";
import { MapStore } from "./MapStore";
import { isSSHRuntime } from "@/common/types/runtime";
import { RefreshController } from "@/browser/utils/RefreshController";

/**
 * External store for git status of all minions.
 *
 * Architecture:
 * - Lives outside React lifecycle (stable references)
 * - Event-driven updates (no polling):
 *   - Initial subscription triggers immediate fetch
 *   - File-modifying tools trigger debounced refresh (3s)
 *   - Window focus triggers refresh for visible minions
 *   - Explicit invalidation (branch switch, etc.)
 * - Manages git fetch with exponential backoff
 * - Notifies subscribers when status changes
 * - Components only re-render when their specific minion status changes
 *
 * Uses RefreshController for debouncing, focus handling, and in-flight guards.
 */

// Configuration
const MAX_CONCURRENT_GIT_OPS = 5;

// Fetch configuration - aggressive intervals for fresh data
const FETCH_BASE_INTERVAL_MS = 3 * 1000; // 3 seconds
const FETCH_MAX_INTERVAL_MS = 60 * 1000; // 60 seconds

interface FetchState {
  lastFetch: number;
  inProgress: boolean;
  consecutiveFailures: number;
}

export class GitStatusStore {
  private statuses = new MapStore<string, GitStatus | null>();
  private fetchCache = new Map<string, FetchState>();
  private client: RouterClient<AppRouter> | null = null;
  private immediateUpdateQueued = false;
  private minionMetadata = new Map<string, FrontendMinionMetadata>();
  private isActive = true;

  // File modification subscription
  private fileModifyUnsubscribe: (() => void) | null = null;

  // RefreshController handles debouncing, focus/visibility, and in-flight guards
  private readonly refreshController: RefreshController;

  // Per-minion refreshing state for UI shimmer effects
  private refreshingMinions = new MapStore<string, boolean>();

  setClient(client: RouterClient<AppRouter> | null): void {
    this.client = client;

    if (!client) {
      return;
    }

    if (this.minionMetadata.size > 0) {
      this.refreshController.requestImmediate();
    }
  }

  constructor() {
    // Create refresh controller with proactive focus refresh (catches external git changes)
    this.refreshController = new RefreshController({
      onRefresh: () => this.updateGitStatus(),
      debounceMs: 3000, // Same as TOOL_REFRESH_DEBOUNCE_MS in ReviewPanel
      refreshOnFocus: true, // Proactively refresh on focus to catch external changes
      focusDebounceMs: 500, // Prevent spam from rapid alt-tabbing
    });
  }

  /**
   * Subscribe to git status changes (any minion).
   * Delegates to MapStore's subscribeAny.
   */
  subscribe = this.statuses.subscribeAny;

  /**
   * Subscribe to git status changes for a specific minion.
   * Only notified when this minion's status changes.
   */
  subscribeKey = (minionId: string, listener: () => void) => {
    const unsubscribe = this.statuses.subscribeKey(minionId, listener);

    // If a component subscribes after initial load, kick an immediate update
    // so the UI doesn't wait. Uses microtask to batch multiple subscriptions.
    // Routes through RefreshController to respect in-flight guards.
    if (!this.immediateUpdateQueued && this.isActive && this.client) {
      this.immediateUpdateQueued = true;
      queueMicrotask(() => {
        this.immediateUpdateQueued = false;
        this.refreshController.requestImmediate();
      });
    }

    return unsubscribe;
  };

  /**
   * Get git status for a specific minion.
   * Returns cached status or null if never fetched.
   */
  getStatus(minionId: string): GitStatus | null {
    // If minion has never been checked, return null
    if (!this.statuses.has(minionId)) {
      return null;
    }

    // Return cached status (lazy computation)
    return this.statuses.get(minionId, () => {
      return this.statusCache.get(minionId) ?? null;
    });
  }

  /**
   * Invalidate status for a minion, triggering immediate refresh.
   * Call after operations that change git state (e.g., branch switch).
   *
   * Note: Old status is preserved during refresh to avoid UI flash.
   * Components can use isMinionRefreshing() to show a shimmer effect.
   */
  invalidateMinion(minionId: string): void {
    // Increment generation to mark any in-flight status checks as stale
    const currentGen = this.invalidationGeneration.get(minionId) ?? 0;
    this.invalidationGeneration.set(minionId, currentGen + 1);
    // Mark minion as refreshing (for shimmer effect)
    this.setMinionRefreshing(minionId, true);
    // Trigger immediate refresh (routes through RefreshController for in-flight guard)
    this.refreshController.requestImmediate();
  }

  /**
   * Set the refreshing state for a minion and notify subscribers.
   */
  private setMinionRefreshing(minionId: string, refreshing: boolean): void {
    this.refreshingMinions.bump(minionId);
    // Store the actual value in a simple map (MapStore is for notifications)
    this.refreshingMinionsCache.set(minionId, refreshing);
  }

  private refreshingMinionsCache = new Map<string, boolean>();

  /**
   * Check if a minion is currently refreshing.
   */
  isMinionRefreshing(minionId: string): boolean {
    return this.refreshingMinionsCache.get(minionId) ?? false;
  }

  /**
   * Check if any git status fetch is currently in-flight.
   * Use this to ensure no background fetch can race with operations that change git state.
   */
  isAnyRefreshInFlight(): boolean {
    return this.refreshController.isRefreshing;
  }

  /**
   * Subscribe to refreshing state changes for a specific minion.
   */
  subscribeRefreshingKey = (minionId: string, listener: () => void) => {
    return this.refreshingMinions.subscribeKey(minionId, listener);
  };

  private statusCache = new Map<string, GitStatus | null>();
  // Generation counter to detect and ignore stale status updates after invalidation.
  // Incremented on invalidate; status updates check generation to avoid race conditions.
  private invalidationGeneration = new Map<string, number>();

  /**
   * Sync minions with metadata.
   * Called when minion list changes.
   */
  syncMinions(metadata: Map<string, FrontendMinionMetadata>): void {
    // Reactivate if disposed by React Strict Mode (dev only)
    // In dev, Strict Mode unmounts/remounts, disposing the store but reusing the ref
    if (!this.isActive && metadata.size > 0) {
      this.isActive = true;
    }

    this.minionMetadata = metadata;

    // Remove statuses for deleted minions
    // Iterate plain map (statusCache) for membership, not reactive store
    for (const id of Array.from(this.statusCache.keys())) {
      if (!metadata.has(id)) {
        this.statusCache.delete(id);
        this.invalidationGeneration.delete(id);
        this.statuses.delete(id); // Also clean up reactive state
      }
    }

    // Bind focus/visibility listeners once (catches external git changes)
    this.refreshController.bindListeners();

    // Initial fetch for all minions (routes through RefreshController)
    this.refreshController.requestImmediate();
  }

  /**
   * Update git status for all minions.
   */
  private async updateGitStatus(): Promise<void> {
    if (this.minionMetadata.size === 0 || !this.isActive) {
      return;
    }

    // Only poll minions that have active subscribers
    const minions = Array.from(this.minionMetadata.values()).filter((ws) =>
      this.statuses.hasKeySubscribers(ws.id)
    );

    if (minions.length === 0) {
      return;
    }

    // Capture current generation for each minion to detect stale results
    const generationSnapshot = new Map<string, number>();
    for (const ws of minions) {
      generationSnapshot.set(ws.id, this.invalidationGeneration.get(ws.id) ?? 0);
    }

    // Try to fetch minions that need it (background, non-blocking)
    const minionsMap = new Map(minions.map((ws) => [ws.id, ws]));
    this.tryFetchMinions(minionsMap);

    // Query git status for each minion
    // Rate limit: Process in batches to prevent bash process explosion
    const results: Array<[string, GitStatus | null]> = [];

    for (let i = 0; i < minions.length; i += MAX_CONCURRENT_GIT_OPS) {
      if (!this.isActive) break; // Stop if disposed

      const batch = minions.slice(i, i + MAX_CONCURRENT_GIT_OPS);
      const batchPromises = batch.map((metadata) => this.checkMinionStatus(metadata));

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    if (!this.isActive) return; // Don't update state if disposed

    // Update statuses - bump version if changed
    for (const [minionId, newStatus] of results) {
      // Skip stale results: if generation changed since we started, the result is outdated
      const snapshotGen = generationSnapshot.get(minionId) ?? 0;
      const currentGen = this.invalidationGeneration.get(minionId) ?? 0;
      if (snapshotGen !== currentGen) {
        // Status was invalidated during check - discard this stale result
        continue;
      }

      // Clear refreshing state now that we have a result
      if (this.refreshingMinionsCache.get(minionId)) {
        this.setMinionRefreshing(minionId, false);
      }

      const oldStatus = this.statusCache.get(minionId) ?? null;

      // Check if status actually changed (cheap for simple objects)
      if (!this.areStatusesEqual(oldStatus, newStatus)) {
        // Only update cache on successful status check (preserve old status on failure)
        // This prevents UI flicker when git operations timeout or fail transiently
        if (newStatus !== null) {
          this.statusCache.set(minionId, newStatus);
          this.statuses.bump(minionId); // Invalidate cache + notify
        }
        // On failure (newStatus === null): keep old status, don't bump (no re-render)
      }
    }
  }

  /**
   * Compare two git statuses for equality.
   * Returns true if they're effectively the same.
   */
  private areStatusesEqual(a: GitStatus | null, b: GitStatus | null): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;

    return (
      a.branch === b.branch &&
      a.ahead === b.ahead &&
      a.behind === b.behind &&
      a.dirty === b.dirty &&
      a.outgoingAdditions === b.outgoingAdditions &&
      a.outgoingDeletions === b.outgoingDeletions &&
      a.incomingAdditions === b.incomingAdditions &&
      a.incomingDeletions === b.incomingDeletions
    );
  }

  /**
   * Check git status for a single minion.
   */
  private async checkMinionStatus(
    metadata: FrontendMinionMetadata
  ): Promise<[string, GitStatus | null]> {
    // Defensive: Return null if client is unavailable
    if (!this.client) {
      return [metadata.id, null];
    }

    try {
      // Use the same diff base as the review panel (per-minion override,
      // falling back to the project default).
      const projectDefaultBase = readPersistedState<string>(
        STORAGE_KEYS.reviewDefaultBase(metadata.projectPath),
        MINION_DEFAULTS.reviewBase
      );
      const baseRef = readPersistedState<string>(
        STORAGE_KEYS.reviewDiffBase(metadata.id),
        projectDefaultBase
      );

      // Generate script with the configured base ref
      const script = generateGitStatusScript(baseRef);

      const result = await this.client.minion.executeBash({
        minionId: metadata.id,
        script,
        options: { timeout_secs: 5 },
      });

      if (!result.success) {
        console.debug(`[gitStatus] IPC failed for ${metadata.id}:`, result.error);
        return [metadata.id, null];
      }

      if (!result.data.success) {
        // Don't log output overflow errors at all (common in large repos, handled gracefully)
        if (
          !result.data.error?.includes("OUTPUT TRUNCATED") &&
          !result.data.error?.includes("OUTPUT OVERFLOW")
        ) {
          console.debug(`[gitStatus] Script failed for ${metadata.id}:`, result.data.error);
        }
        return [metadata.id, null];
      }

      if (result.data.note?.includes("OUTPUT OVERFLOW")) {
        return [metadata.id, null];
      }

      // Parse the output using centralized function
      const parsed = parseGitStatusScriptOutput(result.data.output);

      if (!parsed) {
        console.debug(`[gitStatus] Could not parse output for ${metadata.id}`);
        return [metadata.id, null];
      }

      const {
        headBranch,
        ahead,
        behind,
        dirtyCount,
        outgoingAdditions,
        outgoingDeletions,
        incomingAdditions,
        incomingDeletions,
      } = parsed;
      const dirty = dirtyCount > 0;

      return [
        metadata.id,
        {
          branch: headBranch,
          ahead,
          behind,
          dirty,
          outgoingAdditions,
          outgoingDeletions,
          incomingAdditions,
          incomingDeletions,
        },
      ];
    } catch (err) {
      // Silently fail - git status failures shouldn't crash the UI
      console.debug(`[gitStatus] Exception for ${metadata.id}:`, err);
      return [metadata.id, null];
    }
  }

  /**
   * Get a unique fetch key for a minion.
   * For local minions: project name (shared git repo)
   * For SSH minions: minion ID (each has its own git repo)
   */
  private getFetchKey(metadata: FrontendMinionMetadata): string {
    const isSSH = isSSHRuntime(metadata.runtimeConfig);
    return isSSH ? metadata.id : metadata.projectName;
  }

  /**
   * Try to fetch minions that need it most urgently.
   * For SSH minions: each minion has its own repo, so fetch each one.
   * For local minions: minions share a repo, so fetch once per project.
   */
  private tryFetchMinions(minions: Map<string, FrontendMinionMetadata>): void {
    // Find the minion that needs fetching most urgently
    let targetFetchKey: string | null = null;
    let targetMinionId: string | null = null;
    let oldestTime = Date.now();

    for (const metadata of minions.values()) {
      const fetchKey = this.getFetchKey(metadata);

      if (this.shouldFetch(fetchKey)) {
        const cache = this.fetchCache.get(fetchKey);
        const lastFetch = cache?.lastFetch ?? 0;

        if (lastFetch < oldestTime) {
          oldestTime = lastFetch;
          targetFetchKey = fetchKey;
          targetMinionId = metadata.id;
        }
      }
    }

    if (targetFetchKey && targetMinionId) {
      // Fetch in background (don't await - don't block status checks)
      void this.fetchMinion(targetFetchKey, targetMinionId);
    }
  }

  /**
   * Check if a minion/project should be fetched.
   */
  private shouldFetch(fetchKey: string): boolean {
    const cached = this.fetchCache.get(fetchKey);
    if (!cached) return true;
    if (cached.inProgress) return false;

    // Calculate delay with exponential backoff: 3s, 6s, 12s, 24s, 48s, 60s (max)
    const delay = Math.min(
      FETCH_BASE_INTERVAL_MS * Math.pow(2, cached.consecutiveFailures),
      FETCH_MAX_INTERVAL_MS
    );
    return Date.now() - cached.lastFetch > delay;
  }

  /**
   * Fetch updates for a minion.
   * For local minions: fetches the shared project repo.
   * For SSH minions: fetches the minion's individual repo.
   */
  private async fetchMinion(fetchKey: string, minionId: string): Promise<void> {
    // Defensive: Return early if client is unavailable
    if (!this.client) {
      return;
    }

    const cache = this.fetchCache.get(fetchKey) ?? {
      lastFetch: 0,
      inProgress: false,
      consecutiveFailures: 0,
    };

    if (cache.inProgress) return;

    // Mark as in progress
    this.fetchCache.set(fetchKey, { ...cache, inProgress: true });

    try {
      const result = await this.client.minion.executeBash({
        minionId,
        script: GIT_FETCH_SCRIPT,
        options: { timeout_secs: 30 },
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      if (!result.data.success) {
        throw new Error(result.data.error || "Unknown error");
      }

      // Success - reset failure counter
      console.debug(`[fetch] Success for ${fetchKey}`);
      this.fetchCache.set(fetchKey, {
        lastFetch: Date.now(),
        inProgress: false,
        consecutiveFailures: 0,
      });
    } catch (error) {
      // All errors logged to console, never shown to user
      console.debug(`[fetch] Failed for ${fetchKey}:`, error);

      const newFailures = cache.consecutiveFailures + 1;
      const nextDelay = Math.min(
        FETCH_BASE_INTERVAL_MS * Math.pow(2, newFailures),
        FETCH_MAX_INTERVAL_MS
      );

      console.debug(
        `[fetch] Will retry ${fetchKey} after ${Math.round(nextDelay / 1000)}s ` +
          `(failure #${newFailures})`
      );

      this.fetchCache.set(fetchKey, {
        lastFetch: Date.now(),
        inProgress: false,
        consecutiveFailures: newFailures,
      });
    }
  }

  /**
   * Cleanup resources.
   */
  dispose(): void {
    this.isActive = false;
    this.statuses.clear();
    this.refreshingMinions.clear();
    this.refreshingMinionsCache.clear();
    this.fetchCache.clear();
    this.fileModifyUnsubscribe?.();
    this.fileModifyUnsubscribe = null;
    this.refreshController.dispose();
  }

  /**
   * Subscribe to file-modifying tool completions from MinionStore.
   * Triggers debounced git status refresh when files change.
   * Idempotent: only subscribes once, subsequent calls are no-ops.
   */
  subscribeToFileModifications(
    subscribeAny: (listener: (minionId: string) => void) => () => void
  ): void {
    // Only subscribe once - subsequent calls are no-ops
    if (this.fileModifyUnsubscribe) {
      return;
    }

    this.fileModifyUnsubscribe = subscribeAny((minionId) => {
      // Only schedule if minion has subscribers (same optimization as before)
      if (!this.statuses.hasKeySubscribers(minionId)) {
        return;
      }

      // RefreshController handles debouncing, focus gating, and in-flight guards
      this.refreshController.schedule();
    });
  }
}

// ============================================================================
// React Integration with useSyncExternalStore
// ============================================================================

// Singleton store instance
let gitStoreInstance: GitStatusStore | null = null;

/**
 * Get or create the singleton GitStatusStore instance.
 */
function getGitStoreInstance(): GitStatusStore {
  gitStoreInstance ??= new GitStatusStore();
  return gitStoreInstance;
}

/**
 * Hook to get git status for a specific minion.
 * Only re-renders when THIS minion's status changes.
 *
 * Uses per-key subscription for surgical updates - only notified when
 * this specific minion's git status changes.
 */
export function useGitStatus(minionId: string): GitStatus | null {
  const store = getGitStoreInstance();

  return useSyncExternalStore(
    (listener) => store.subscribeKey(minionId, listener),
    () => store.getStatus(minionId)
  );
}

/**
 * Hook to check if a minion's git status is currently being refreshed.
 * Use this to show shimmer/loading effects while preserving old status.
 */
export function useGitStatusRefreshing(minionId: string): boolean {
  const store = getGitStoreInstance();

  return useSyncExternalStore(
    (listener) => store.subscribeRefreshingKey(minionId, listener),
    () => store.isMinionRefreshing(minionId)
  );
}

/**
 * Hook to access the raw store for imperative operations.
 */
export function useGitStatusStoreRaw(): GitStatusStore {
  return getGitStoreInstance();
}

/**
 * Invalidate git status for a minion, triggering an immediate refresh.
 * Call this after operations that change git state (e.g., branch switch).
 */
export function invalidateGitStatus(minionId: string): void {
  const store = getGitStoreInstance();
  store.invalidateMinion(minionId);
}
