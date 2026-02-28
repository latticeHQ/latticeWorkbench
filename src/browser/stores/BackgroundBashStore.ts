import { useSyncExternalStore } from "react";
import type { APIClient } from "@/browser/contexts/API";
import type { BackgroundProcessInfo } from "@/common/orpc/schemas/api";
import { isAbortError } from "@/browser/utils/isAbortError";
import { MapStore } from "./MapStore";

const EMPTY_SET = new Set<string>();
const EMPTY_PROCESSES: BackgroundProcessInfo[] = [];
const BASH_RETRY_BASE_MS = 250;
const BASH_RETRY_MAX_MS = 5_000;

function areProcessesEqual(a: BackgroundProcessInfo[], b: BackgroundProcessInfo[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((proc, index) => {
    const other = b[index];
    return (
      proc.id === other.id &&
      proc.pid === other.pid &&
      proc.script === other.script &&
      proc.displayName === other.displayName &&
      proc.startTime === other.startTime &&
      proc.status === other.status &&
      proc.exitCode === other.exitCode
    );
  });
}

function areSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export class BackgroundBashStore {
  private client: APIClient | null = null;
  private processesStore = new MapStore<string, BackgroundProcessInfo[]>();
  private foregroundIdsStore = new MapStore<string, Set<string>>();
  private terminatingIdsStore = new MapStore<string, Set<string>>();

  private processesCache = new Map<string, BackgroundProcessInfo[]>();
  private autoBackgroundFetches = new Map<string, Promise<void>>();
  private foregroundIdsCache = new Map<string, Set<string>>();
  private terminatingIdsCache = new Map<string, Set<string>>();

  private subscriptions = new Map<
    string,
    {
      controller: AbortController;
      iterator: AsyncIterator<{
        processes: BackgroundProcessInfo[];
        foregroundToolCallIds: string[];
      }> | null;
    }
  >();
  private subscriptionCounts = new Map<string, number>();
  private retryAttempts = new Map<string, number>();
  private retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  setClient(client: APIClient | null): void {
    this.client = client;

    if (!client) {
      for (const subscription of this.subscriptions.values()) {
        subscription.controller.abort();
        void subscription.iterator?.return?.();
      }
      this.subscriptions.clear();

      for (const timeout of this.retryTimeouts.values()) {
        clearTimeout(timeout);
      }
      this.retryTimeouts.clear();
      this.retryAttempts.clear();
      return;
    }

    for (const minionId of this.subscriptionCounts.keys()) {
      this.ensureSubscribed(minionId);
    }
  }

  subscribeProcesses = (minionId: string, listener: () => void): (() => void) => {
    this.trackSubscription(minionId);
    const unsubscribe = this.processesStore.subscribeKey(minionId, listener);
    return () => {
      unsubscribe();
      this.untrackSubscription(minionId);
    };
  };

  subscribeForegroundIds = (minionId: string, listener: () => void): (() => void) => {
    this.trackSubscription(minionId);
    const unsubscribe = this.foregroundIdsStore.subscribeKey(minionId, listener);
    return () => {
      unsubscribe();
      this.untrackSubscription(minionId);
    };
  };

  subscribeTerminatingIds = (minionId: string, listener: () => void): (() => void) => {
    this.trackSubscription(minionId);
    const unsubscribe = this.terminatingIdsStore.subscribeKey(minionId, listener);
    return () => {
      unsubscribe();
      this.untrackSubscription(minionId);
    };
  };

  getProcesses(minionId: string): BackgroundProcessInfo[] {
    return this.processesStore.get(
      minionId,
      () => this.processesCache.get(minionId) ?? EMPTY_PROCESSES
    );
  }

  getForegroundIds(minionId: string): Set<string> {
    return this.foregroundIdsStore.get(
      minionId,
      () => this.foregroundIdsCache.get(minionId) ?? EMPTY_SET
    );
  }

  getTerminatingIds(minionId: string): Set<string> {
    return this.terminatingIdsStore.get(
      minionId,
      () => this.terminatingIdsCache.get(minionId) ?? EMPTY_SET
    );
  }

  async terminate(minionId: string, processId: string): Promise<void> {
    if (!this.client) {
      throw new Error("API not available");
    }

    this.markTerminating(minionId, processId);

    try {
      const result = await this.client.minion.backgroundBashes.terminate({
        minionId,
        processId,
      });

      if (!result.success) {
        this.clearTerminating(minionId, processId);
        throw new Error(result.error);
      }
    } catch (error) {
      this.clearTerminating(minionId, processId);
      throw error;
    }
  }

  async sendToBackground(minionId: string, toolCallId: string): Promise<void> {
    if (!this.client) {
      throw new Error("API not available");
    }

    const result = await this.client.minion.backgroundBashes.sendToBackground({
      minionId,
      toolCallId,
    });

    if (!result.success) {
      throw new Error(result.error);
    }
  }

  autoBackgroundOnSend(minionId: string): void {
    const foregroundIds = this.foregroundIdsCache.get(minionId);
    if (foregroundIds && foregroundIds.size > 0) {
      for (const toolCallId of foregroundIds) {
        this.sendToBackground(minionId, toolCallId).catch(() => {
          // Ignore failures - bash may have completed before the request.
        });
      }
      return;
    }

    void this.fetchForegroundIdsForAutoBackground(minionId);
  }

  private fetchForegroundIdsForAutoBackground(minionId: string): Promise<void> {
    const existing = this.autoBackgroundFetches.get(minionId);
    if (existing) {
      return existing;
    }

    const client = this.client;
    if (!client) {
      return Promise.resolve();
    }

    const controller = new AbortController();
    const { signal } = controller;

    const task = (async () => {
      let iterator: AsyncIterator<{
        processes: BackgroundProcessInfo[];
        foregroundToolCallIds: string[];
      }> | null = null;

      try {
        const subscribedIterator = await client.minion.backgroundBashes.subscribe(
          { minionId },
          { signal }
        );
        iterator = subscribedIterator;

        for await (const state of subscribedIterator) {
          controller.abort();
          void subscribedIterator.return?.();

          const latestForegroundIds = new Set(state.foregroundToolCallIds);
          this.foregroundIdsCache.set(minionId, latestForegroundIds);

          if (latestForegroundIds.size === 0) {
            return;
          }

          for (const toolCallId of latestForegroundIds) {
            this.sendToBackground(minionId, toolCallId).catch(() => {
              // Ignore failures - bash may have completed before the request.
            });
          }
          return;
        }
      } catch (err) {
        if (!signal.aborted) {
          console.error("Failed to read foreground bash state:", err);
        }
      } finally {
        void iterator?.return?.();
        this.autoBackgroundFetches.delete(minionId);
      }
    })();

    this.autoBackgroundFetches.set(minionId, task);
    return task;
  }

  private trackSubscription(minionId: string): void {
    const next = (this.subscriptionCounts.get(minionId) ?? 0) + 1;
    this.subscriptionCounts.set(minionId, next);
    if (next === 1) {
      this.ensureSubscribed(minionId);
    }
  }

  private untrackSubscription(minionId: string): void {
    const next = (this.subscriptionCounts.get(minionId) ?? 1) - 1;
    if (next > 0) {
      this.subscriptionCounts.set(minionId, next);
      return;
    }

    this.subscriptionCounts.delete(minionId);
    this.stopSubscription(minionId);
  }

  private stopSubscription(minionId: string): void {
    const subscription = this.subscriptions.get(minionId);
    if (subscription) {
      subscription.controller.abort();
      void subscription.iterator?.return?.();
      this.subscriptions.delete(minionId);
    }

    this.clearRetry(minionId);

    this.processesCache.delete(minionId);
    this.foregroundIdsCache.delete(minionId);
    this.terminatingIdsCache.delete(minionId);
    this.processesStore.delete(minionId);
    this.foregroundIdsStore.delete(minionId);
    this.terminatingIdsStore.delete(minionId);
  }

  private clearRetry(minionId: string): void {
    const timeout = this.retryTimeouts.get(minionId);
    if (timeout) {
      clearTimeout(timeout);
    }
    this.retryTimeouts.delete(minionId);
    this.retryAttempts.delete(minionId);
  }

  private scheduleRetry(minionId: string): void {
    if (this.retryTimeouts.has(minionId)) {
      return;
    }

    const attempt = this.retryAttempts.get(minionId) ?? 0;
    const delay = Math.min(BASH_RETRY_BASE_MS * 2 ** attempt, BASH_RETRY_MAX_MS);
    this.retryAttempts.set(minionId, attempt + 1);

    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(minionId);
      this.ensureSubscribed(minionId);
    }, delay);

    this.retryTimeouts.set(minionId, timeout);
  }

  private ensureSubscribed(minionId: string): void {
    const client = this.client;
    if (!client || this.subscriptions.has(minionId)) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    const subscription: {
      controller: AbortController;
      iterator: AsyncIterator<{
        processes: BackgroundProcessInfo[];
        foregroundToolCallIds: string[];
      }> | null;
    } = {
      controller,
      iterator: null,
    };

    this.subscriptions.set(minionId, subscription);

    (async () => {
      try {
        const subscribedIterator = await client.minion.backgroundBashes.subscribe(
          { minionId },
          { signal }
        );

        // If we unsubscribed while subscribe() was in-flight, force-close the iterator so
        // the backend can drop its EventEmitter listener.
        if (signal.aborted || this.subscriptions.get(minionId) !== subscription) {
          void subscribedIterator.return?.();
          return;
        }

        subscription.iterator = subscribedIterator;

        for await (const state of subscribedIterator) {
          if (signal.aborted) break;

          const previousProcesses = this.processesCache.get(minionId) ?? EMPTY_PROCESSES;
          if (!areProcessesEqual(previousProcesses, state.processes)) {
            this.processesCache.set(minionId, state.processes);
            this.processesStore.bump(minionId);
          }

          const nextForeground = new Set(state.foregroundToolCallIds);
          const previousForeground = this.foregroundIdsCache.get(minionId) ?? EMPTY_SET;
          if (!areSetsEqual(previousForeground, nextForeground)) {
            this.foregroundIdsCache.set(minionId, nextForeground);
            this.foregroundIdsStore.bump(minionId);
          }

          const previousTerminating = this.terminatingIdsCache.get(minionId) ?? EMPTY_SET;
          if (previousTerminating.size > 0) {
            const runningIds = new Set(
              state.processes.filter((proc) => proc.status === "running").map((proc) => proc.id)
            );
            const nextTerminating = new Set(
              [...previousTerminating].filter((id) => runningIds.has(id))
            );
            if (!areSetsEqual(previousTerminating, nextTerminating)) {
              this.terminatingIdsCache.set(minionId, nextTerminating);
              this.terminatingIdsStore.bump(minionId);
            }
          }
        }
      } catch (err) {
        if (!signal.aborted && !isAbortError(err)) {
          console.error("Failed to subscribe to background bash state:", err);
        }
      } finally {
        void subscription.iterator?.return?.();
        subscription.iterator = null;

        if (this.subscriptions.get(minionId) === subscription) {
          this.subscriptions.delete(minionId);
        }

        if (!signal.aborted && this.client && this.subscriptionCounts.has(minionId)) {
          // Retry after unexpected disconnects so background bash status recovers without refresh.
          this.scheduleRetry(minionId);
        }
      }
    })();
  }

  private markTerminating(minionId: string, processId: string): void {
    const previous = this.terminatingIdsCache.get(minionId) ?? EMPTY_SET;
    if (previous.has(processId)) {
      return;
    }

    const next = new Set(previous);
    next.add(processId);
    this.terminatingIdsCache.set(minionId, next);
    this.terminatingIdsStore.bump(minionId);
  }

  private clearTerminating(minionId: string, processId: string): void {
    const previous = this.terminatingIdsCache.get(minionId);
    if (!previous?.has(processId)) {
      return;
    }

    const next = new Set(previous);
    next.delete(processId);
    this.terminatingIdsCache.set(minionId, next);
    this.terminatingIdsStore.bump(minionId);
  }
}

let storeInstance: BackgroundBashStore | null = null;

function getStoreInstance(): BackgroundBashStore {
  storeInstance ??= new BackgroundBashStore();
  return storeInstance;
}

export function useBackgroundBashStoreRaw(): BackgroundBashStore {
  return getStoreInstance();
}

export function useBackgroundProcesses(minionId: string | undefined): BackgroundProcessInfo[] {
  const store = getStoreInstance();
  return useSyncExternalStore(
    (listener) => (minionId ? store.subscribeProcesses(minionId, listener) : () => undefined),
    () => (minionId ? store.getProcesses(minionId) : EMPTY_PROCESSES)
  );
}

export function useForegroundBashToolCallIds(minionId: string | undefined): Set<string> {
  const store = getStoreInstance();
  return useSyncExternalStore(
    (listener) =>
      minionId ? store.subscribeForegroundIds(minionId, listener) : () => undefined,
    () => (minionId ? store.getForegroundIds(minionId) : EMPTY_SET)
  );
}

export function useBackgroundBashTerminatingIds(minionId: string | undefined): Set<string> {
  const store = getStoreInstance();
  return useSyncExternalStore(
    (listener) =>
      minionId ? store.subscribeTerminatingIds(minionId, listener) : () => undefined,
    () => (minionId ? store.getTerminatingIds(minionId) : EMPTY_SET)
  );
}
