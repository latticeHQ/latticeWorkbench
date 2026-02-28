import { describe, expect, it, beforeEach, afterEach, mock, type Mock } from "bun:test";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { StreamStartEvent, ToolCallStartEvent } from "@/common/types/stream";
import type { MinionActivitySnapshot, MinionChatMessage } from "@/common/orpc/types";
import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";
import { DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT } from "@/common/constants/ui";
import { getAutoCompactionThresholdKey, getAutoRetryKey } from "@/common/constants/storage";
import { MinionStore } from "./MinionStore";

interface LoadMoreResponse {
  messages: MinionChatMessage[];
  nextCursor: { beforeHistorySequence: number; beforeMessageId?: string | null } | null;
  hasOlder: boolean;
}

// Mock client
// eslint-disable-next-line require-yield
const mockOnChat = mock(async function* (
  _input?: { minionId: string; mode?: unknown },
  options?: { signal?: AbortSignal }
): AsyncGenerator<MinionChatMessage, void, unknown> {
  // Keep the iterator open until the store aborts it (prevents retry-loop noise in tests).
  await new Promise<void>((resolve) => {
    if (!options?.signal) {
      resolve();
      return;
    }
    options.signal.addEventListener("abort", () => resolve(), { once: true });
  });
});

const mockGetSessionUsage = mock((_input: { minionId: string }) =>
  Promise.resolve<unknown>(undefined)
);
const mockHistoryLoadMore = mock(
  (): Promise<LoadMoreResponse> =>
    Promise.resolve({
      messages: [],
      nextCursor: null,
      hasOlder: false,
    })
);
const mockActivityList = mock(() => Promise.resolve<Record<string, MinionActivitySnapshot>>({}));
// eslint-disable-next-line require-yield
const mockActivitySubscribe = mock(async function* (
  _input?: void,
  options?: { signal?: AbortSignal }
): AsyncGenerator<
  { minionId: string; activity: MinionActivitySnapshot | null },
  void,
  unknown
> {
  await new Promise<void>((resolve) => {
    if (!options?.signal) {
      resolve();
      return;
    }
    options.signal.addEventListener("abort", () => resolve(), { once: true });
  });
});

type TerminalActivityEvent =
  | {
      type: "snapshot";
      minions: Record<string, { activeCount: number; totalSessions: number }>;
    }
  | {
      type: "update";
      minionId: string;
      activity: { activeCount: number; totalSessions: number };
    };

// eslint-disable-next-line require-yield
const mockTerminalActivitySubscribe = mock(async function* (
  _input?: void,
  options?: { signal?: AbortSignal }
): AsyncGenerator<TerminalActivityEvent, void, unknown> {
  await waitForAbortSignal(options?.signal);
});

const mockSetAutoCompactionThreshold = mock(() =>
  Promise.resolve({ success: true, data: undefined })
);
const mockGetStartupAutoRetryModel = mock(() => Promise.resolve({ success: true, data: null }));

const mockClient = {
  minion: {
    onChat: mockOnChat,
    getSessionUsage: mockGetSessionUsage,
    history: {
      loadMore: mockHistoryLoadMore,
    },
    activity: {
      list: mockActivityList,
      subscribe: mockActivitySubscribe,
    },
    setAutoCompactionThreshold: mockSetAutoCompactionThreshold,
    getStartupAutoRetryModel: mockGetStartupAutoRetryModel,
  },
  terminal: {
    activity: {
      subscribe: mockTerminalActivitySubscribe,
    },
  },
};

const localStorageBacking = new Map<string, string>();
const mockLocalStorage: Storage = {
  get length() {
    return localStorageBacking.size;
  },
  clear() {
    localStorageBacking.clear();
  },
  getItem(key: string) {
    return localStorageBacking.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(localStorageBacking.keys())[index] ?? null;
  },
  removeItem(key: string) {
    localStorageBacking.delete(key);
  },
  setItem(key: string, value: string) {
    localStorageBacking.set(key, value);
  },
};

const mockWindow = {
  localStorage: mockLocalStorage,
  api: {
    minion: {
      onChat: mock((_minionId, _callback) => {
        return () => {
          // cleanup
        };
      }),
    },
  },
};

global.window = mockWindow as unknown as Window & typeof globalThis;
global.window.dispatchEvent = mock();

// Mock queueMicrotask
global.queueMicrotask = (fn) => fn();

// Helper to create and add a minion
function createAndAddMinion(
  store: MinionStore,
  minionId: string,
  options: Partial<FrontendMinionMetadata> = {},
  activate = true
): FrontendMinionMetadata {
  const metadata: FrontendMinionMetadata = {
    id: minionId,
    name: options.name ?? `test-branch-${minionId}`,
    projectName: options.projectName ?? "test-project",
    projectPath: options.projectPath ?? "/path/to/project",
    namedMinionPath: options.namedMinionPath ?? "/path/to/minion",
    createdAt: options.createdAt ?? new Date().toISOString(),
    runtimeConfig: options.runtimeConfig ?? DEFAULT_RUNTIME_CONFIG,
  };
  if (activate) {
    store.setActiveMinionId(minionId);
  }
  store.addMinion(metadata);
  return metadata;
}

function createHistoryMessageEvent(id: string, historySequence: number): MinionChatMessage {
  return {
    type: "message",
    id,
    role: "user",
    parts: [{ type: "text", text: `message-${historySequence}` }],
    metadata: { historySequence, timestamp: historySequence },
  };
}

async function waitForAbortSignal(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!signal) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("MinionStore", () => {
  let store: MinionStore;
  let mockOnModelUsed: Mock<(model: string) => void>;

  beforeEach(() => {
    mockOnChat.mockClear();
    mockGetSessionUsage.mockClear();
    mockHistoryLoadMore.mockClear();
    mockActivityList.mockClear();
    mockActivitySubscribe.mockClear();
    mockTerminalActivitySubscribe.mockClear();
    mockSetAutoCompactionThreshold.mockClear();
    mockGetStartupAutoRetryModel.mockClear();
    global.window.localStorage?.clear?.();
    mockHistoryLoadMore.mockResolvedValue({
      messages: [],
      nextCursor: null,
      hasOlder: false,
    });
    mockActivityList.mockResolvedValue({});
    mockOnModelUsed = mock(() => undefined);
    store = new MinionStore(mockOnModelUsed);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    store.setClient(mockClient as any);
  });

  afterEach(() => {
    store.dispose();
  });

  describe("recency calculation for new minions", () => {
    it("should calculate recency from createdAt when minion is added", () => {
      const minionId = "test-minion";
      const createdAt = new Date().toISOString();
      const metadata: FrontendMinionMetadata = {
        id: minionId,
        name: "test-branch",
        projectName: "test-project",
        projectPath: "/path/to/project",
        namedMinionPath: "/path/to/minion",
        createdAt,
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Add minion with createdAt
      store.addMinion(metadata);

      // Get state - should have recency based on createdAt
      const state = store.getMinionState(minionId);

      // Recency should be based on createdAt, not null or 0
      expect(state.recencyTimestamp).not.toBeNull();
      expect(state.recencyTimestamp).toBe(new Date(createdAt).getTime());

      // Check that minion appears in recency map with correct timestamp
      const recency = store.getMinionRecency();
      expect(recency[minionId]).toBe(new Date(createdAt).getTime());
    });

    it("should maintain createdAt-based recency after CAUGHT_UP with no messages", async () => {
      const minionId = "test-minion-2";
      const createdAt = new Date().toISOString();
      const metadata: FrontendMinionMetadata = {
        id: minionId,
        name: "test-branch-2",
        projectName: "test-project",
        projectPath: "/path/to/project",
        namedMinionPath: "/path/to/minion",
        createdAt,
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      // Add minion
      store.setActiveMinionId(minionId);
      store.addMinion(metadata);

      // Check initial recency
      const initialState = store.getMinionState(minionId);
      expect(initialState.recencyTimestamp).toBe(new Date(createdAt).getTime());

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Recency should still be based on createdAt
      const stateAfterCaughtUp = store.getMinionState(minionId);
      expect(stateAfterCaughtUp.recencyTimestamp).toBe(new Date(createdAt).getTime());
      expect(stateAfterCaughtUp.isHydratingTranscript).toBe(false);

      // Verify recency map
      const recency = store.getMinionRecency();
      expect(recency[minionId]).toBe(new Date(createdAt).getTime());
    });
  });

  describe("subscription", () => {
    it("should call listener when minion state changes", async () => {
      const listener = mock(() => undefined);
      const unsubscribe = store.subscribe(listener);

      // Create minion metadata
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        await Promise.resolve();
        yield { type: "caught-up" };
      });

      // Add minion (should trigger IPC subscription)
      store.setActiveMinionId(metadata.id);
      store.addMinion(metadata);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });

    it("should allow unsubscribe", async () => {
      const listener = mock(() => undefined);
      const unsubscribe = store.subscribe(listener);

      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        await Promise.resolve();
        yield { type: "caught-up" };
      });

      // Unsubscribe before adding minion (which triggers updates)
      unsubscribe();
      store.setActiveMinionId(metadata.id);
      store.addMinion(metadata);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("active minion subscriptions", () => {
    it("does not start onChat until minion becomes active", async () => {
      const minionId = "inactive-minion";
      createAndAddMinion(store, minionId, {}, false);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockOnChat).not.toHaveBeenCalled();

      store.setActiveMinionId(minionId);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockOnChat).toHaveBeenCalledWith(
        expect.objectContaining({ minionId }),
        expect.anything()
      );
    });

    it("does not pin hydration while waiting for the chat client", async () => {
      const minionId = "minion-awaiting-client";

      store.setClient(null);
      createAndAddMinion(store, minionId, {}, false);

      store.setActiveMinionId(minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getMinionState(minionId).isHydratingTranscript).toBe(false);
      expect(mockOnChat).not.toHaveBeenCalled();
    });

    it("clears hydration after first pre-caught-up failure when client disconnects", async () => {
      const minionId = "minion-hydration-first-failure-offline";
      let attempts = 0;
      let resolveFirstFailure!: () => void;
      const firstFailure = new Promise<void>((resolve) => {
        resolveFirstFailure = resolve;
      });

      // eslint-disable-next-line require-yield
      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        attempts += 1;
        if (attempts === 1) {
          resolveFirstFailure();
          throw new Error("first-retry-failure");
        }

        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId, {}, false);
      store.setActiveMinionId(minionId);
      await firstFailure;

      // Simulate transport/client loss before a second retry can catch up.
      store.setClient(null);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(store.getMinionState(minionId).isHydratingTranscript).toBe(false);
    });

    it("switches onChat subscriptions when active minion changes", async () => {
      // eslint-disable-next-line require-yield
      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        await new Promise<void>((resolve) => {
          if (!options?.signal) {
            resolve();
            return;
          }
          options.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      });

      createAndAddMinion(store, "minion-1", {}, false);
      createAndAddMinion(store, "minion-2", {}, false);

      store.setActiveMinionId("minion-1");
      await new Promise((resolve) => setTimeout(resolve, 0));

      store.setActiveMinionId("minion-2");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const subscribedMinionIds = mockOnChat.mock.calls.map((call) => {
        const input = call[0] as { minionId?: string };
        return input.minionId;
      });

      expect(subscribedMinionIds).toEqual(["minion-1", "minion-2"]);
    });

    it("clears replay buffers before aborting the previous active minion subscription", async () => {
      // eslint-disable-next-line require-yield
      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, "minion-1", {}, false);
      createAndAddMinion(store, "minion-2", {}, false);

      store.setActiveMinionId("minion-1");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const transientState = (
        store as unknown as {
          chatTransientState: Map<
            string,
            {
              caughtUp: boolean;
              isHydratingTranscript: boolean;
              replayingHistory: boolean;
              historicalMessages: MinionChatMessage[];
              pendingStreamEvents: MinionChatMessage[];
            }
          >;
        }
      ).chatTransientState.get("minion-1");
      expect(transientState).toBeDefined();

      transientState!.caughtUp = false;
      transientState!.isHydratingTranscript = true;
      transientState!.replayingHistory = true;
      transientState!.historicalMessages.push(
        createHistoryMessageEvent("stale-buffered-message", 9)
      );
      transientState!.pendingStreamEvents.push({
        type: "stream-start",
        minionId: "minion-1",
        messageId: "stale-buffered-stream",
        model: "claude-sonnet-4",
        historySequence: 10,
        startTime: Date.now(),
      });

      // Switching active minions should clear replay buffers synchronously
      // before aborting the previous subscription.
      store.setActiveMinionId("minion-2");

      expect(transientState!.caughtUp).toBe(false);
      expect(transientState!.isHydratingTranscript).toBe(false);
      expect(transientState!.replayingHistory).toBe(false);
      expect(transientState!.historicalMessages).toHaveLength(0);
      expect(transientState!.pendingStreamEvents).toHaveLength(0);
      expect(store.getMinionState("minion-2").isHydratingTranscript).toBe(true);
    });
    it("keeps transcript hydration active across full replay resets", async () => {
      const minionId = "minion-full-replay-hydration";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        // Full replay path emits history rows before the caught-up marker.
        yield createHistoryMessageEvent("history-before-caught-up", 11);
        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId, {}, false);
      store.setActiveMinionId(minionId);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Hydration should stay active until an authoritative caught-up marker arrives,
      // even if replay reset rebuilt transient state.
      expect(store.getMinionState(minionId).isHydratingTranscript).toBe(true);
    });

    it("clears transcript hydration after repeated catch-up retry failures", async () => {
      const minionId = "minion-hydration-retry-fallback";
      let attempts = 0;

      // eslint-disable-next-line require-yield
      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error(`retry-failure-${attempts}`);
        }

        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId, {}, false);
      store.setActiveMinionId(minionId);

      const startedAt = Date.now();
      while (mockOnChat.mock.calls.length < 3 && Date.now() - startedAt < 3_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(mockOnChat.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(store.getMinionState(minionId).isHydratingTranscript).toBe(false);
    });

    it("clears transcript hydration when retries keep replaying partial history without caught-up", async () => {
      const minionId = "minion-hydration-partial-replay-fallback";
      let attempts = 0;

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        attempts += 1;

        // Simulate flaky reconnects that emit some replay rows, then terminate
        // before caught-up can arrive.
        yield createHistoryMessageEvent(`partial-history-${attempts}`, attempts);
        if (attempts <= 2) {
          return;
        }

        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId, {}, false);
      store.setActiveMinionId(minionId);

      const startedAt = Date.now();
      while (mockOnChat.mock.calls.length < 3 && Date.now() - startedAt < 3_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(mockOnChat.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(store.getMinionState(minionId).isHydratingTranscript).toBe(false);
    });

    it("drops queued chat events from an aborted subscription attempt", async () => {
      const queuedMicrotasks: Array<() => void> = [];
      const originalQueueMicrotask = global.queueMicrotask;
      let resolveQueuedEvent!: () => void;
      const queuedEvent = new Promise<void>((resolve) => {
        resolveQueuedEvent = resolve;
      });

      global.queueMicrotask = (callback) => {
        queuedMicrotasks.push(callback);
        resolveQueuedEvent();
      };

      try {
        mockOnChat.mockImplementation(async function* (
          input?: { minionId: string; mode?: unknown },
          options?: { signal?: AbortSignal }
        ): AsyncGenerator<MinionChatMessage, void, unknown> {
          if (input?.minionId === "minion-1") {
            yield createHistoryMessageEvent("queued-after-switch", 11);
          }
          await waitForAbortSignal(options?.signal);
        });

        createAndAddMinion(store, "minion-1", {}, false);
        createAndAddMinion(store, "minion-2", {}, false);

        store.setActiveMinionId("minion-1");
        await queuedEvent;

        const transientState = (
          store as unknown as {
            chatTransientState: Map<
              string,
              {
                historicalMessages: MinionChatMessage[];
                pendingStreamEvents: MinionChatMessage[];
              }
            >;
          }
        ).chatTransientState.get("minion-1");
        expect(transientState).toBeDefined();

        // Abort minion-1 attempt by moving focus; the queued callback should now no-op.
        store.setActiveMinionId("minion-2");

        for (const callback of queuedMicrotasks) {
          callback();
        }

        expect(transientState!.historicalMessages).toHaveLength(0);
        expect(transientState!.pendingStreamEvents).toHaveLength(0);
      } finally {
        global.queueMicrotask = originalQueueMicrotask;
      }
    });
  });

  it("tracks which minion currently has the active onChat subscription", async () => {
    createAndAddMinion(store, "minion-1", {}, false);
    createAndAddMinion(store, "minion-2", {}, false);

    expect(store.isOnChatSubscriptionActive("minion-1")).toBe(false);
    expect(store.isOnChatSubscriptionActive("minion-2")).toBe(false);

    store.setActiveMinionId("minion-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.isOnChatSubscriptionActive("minion-1")).toBe(true);
    expect(store.isOnChatSubscriptionActive("minion-2")).toBe(false);

    store.setActiveMinionId("minion-2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.isOnChatSubscriptionActive("minion-1")).toBe(false);
    expect(store.isOnChatSubscriptionActive("minion-2")).toBe(true);

    store.setActiveMinionId(null);
    expect(store.isOnChatSubscriptionActive("minion-1")).toBe(false);
    expect(store.isOnChatSubscriptionActive("minion-2")).toBe(false);
  });

  describe("session usage refresh on activation", () => {
    it("re-fetches persisted session usage when switching to an inactive minion", async () => {
      const sessionUsageData = {
        byModel: {
          "claude-sonnet-4": {
            input: { tokens: 1000, cost_usd: 0.003 },
            cached: { tokens: 0, cost_usd: 0 },
            cacheCreate: { tokens: 0, cost_usd: 0 },
            output: { tokens: 100, cost_usd: 0.0015 },
            reasoning: { tokens: 0, cost_usd: 0 },
          },
        },
        version: 1 as const,
      };

      mockGetSessionUsage.mockImplementation(({ minionId }: { minionId: string }) => {
        if (minionId === "minion-2") {
          return Promise.resolve(sessionUsageData);
        }
        return Promise.resolve(undefined);
      });

      createAndAddMinion(store, "minion-1", {}, false);
      createAndAddMinion(store, "minion-2", {}, false);

      store.setActiveMinionId("minion-1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Clear call history to isolate the activation fetch.
      mockGetSessionUsage.mockClear();

      store.setActiveMinionId("minion-2");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Activation should trigger a fresh fetch for minion-2.
      expect(mockGetSessionUsage).toHaveBeenCalledWith({ minionId: "minion-2" });

      const usage = store.getMinionUsage("minion-2");
      expect(usage.sessionTotal).toBeDefined();
      expect(usage.sessionTotal!.input.tokens).toBe(1000);
    });

    it("ignores stale session-usage fetch when a newer refresh supersedes it", async () => {
      let resolveFirst!: (value: unknown) => void;
      const firstFetch = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      const freshData = {
        byModel: {
          "claude-sonnet-4": {
            input: { tokens: 9999, cost_usd: 0.03 },
            cached: { tokens: 0, cost_usd: 0 },
            cacheCreate: { tokens: 0, cost_usd: 0 },
            output: { tokens: 500, cost_usd: 0.0075 },
            reasoning: { tokens: 0, cost_usd: 0 },
          },
        },
        version: 1 as const,
      };

      const staleData = {
        byModel: {
          "claude-sonnet-4": {
            input: { tokens: 1, cost_usd: 0.000003 },
            cached: { tokens: 0, cost_usd: 0 },
            cacheCreate: { tokens: 0, cost_usd: 0 },
            output: { tokens: 1, cost_usd: 0.0000015 },
            reasoning: { tokens: 0, cost_usd: 0 },
          },
        },
        version: 1 as const,
      };

      let callCount = 0;
      mockGetSessionUsage.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // First two calls (addMinion + first activation) are slow responses.
          return firstFetch;
        }
        // Third call (second activation) resolves immediately with fresh data.
        return Promise.resolve(freshData);
      });

      createAndAddMinion(store, "minion-1", {}, false);
      store.setActiveMinionId("minion-1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Trigger a second activation (rapid switch away and back).
      store.setActiveMinionId(null);
      store.setActiveMinionId("minion-1");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now resolve the stale first fetch.
      resolveFirst(staleData);
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The stale response should be ignored; fresh data should win.
      const usage = store.getMinionUsage("minion-1");
      expect(usage.sessionTotal).toBeDefined();
      expect(usage.sessionTotal!.input.tokens).toBe(9999);
    });
  });

  describe("syncMinions", () => {
    it("should add new minions", async () => {
      const metadata1: FrontendMinionMetadata = {
        id: "minion-1",
        name: "minion-1",
        projectName: "project-1",
        projectPath: "/project-1",
        namedMinionPath: "/path/1",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      const minionMap = new Map([[metadata1.id, metadata1]]);
      store.setActiveMinionId(metadata1.id);
      store.syncMinions(minionMap);

      // addMinion triggers async onChat subscription setup; wait until the
      // subscription attempt runs so startup threshold sync RPCs do not race this assertion.
      const deadline = Date.now() + 1_000;
      while (mockOnChat.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(mockOnChat).toHaveBeenCalledWith({ minionId: "minion-1" }, expect.anything());
    });

    it("sanitizes malformed startup threshold values before backend sync", async () => {
      const minionId = "minion-threshold-sanitize";
      const thresholdKey = getAutoCompactionThresholdKey("default");
      global.window.localStorage.setItem(thresholdKey, JSON.stringify("not-a-number"));

      createAndAddMinion(store, minionId);

      const deadline = Date.now() + 1_000;
      while (mockSetAutoCompactionThreshold.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(mockSetAutoCompactionThreshold).toHaveBeenCalledWith({
        minionId,
        threshold: DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT / 100,
      });

      expect(global.window.localStorage.getItem(thresholdKey)).toBe(
        JSON.stringify(DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT)
      );
    });

    it("sanitizes malformed legacy auto-retry values before subscribing", async () => {
      const minionId = "minion-auto-retry-sanitize";
      const autoRetryKey = getAutoRetryKey(minionId);
      global.window.localStorage.setItem(autoRetryKey, JSON.stringify("invalid-legacy-value"));

      createAndAddMinion(store, minionId);

      const deadline = Date.now() + 1_000;
      while (mockOnChat.mock.calls.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(mockOnChat.mock.calls.length).toBeGreaterThan(0);
      const onChatInput = mockOnChat.mock.calls[0]?.[0] as {
        minionId?: string;
        legacyAutoRetryEnabled?: unknown;
      };

      expect(onChatInput.minionId).toBe(minionId);
      expect("legacyAutoRetryEnabled" in onChatInput).toBe(false);
      expect(global.window.localStorage.getItem(autoRetryKey)).toBeNull();
    });

    it("should remove deleted minions", () => {
      const metadata1: FrontendMinionMetadata = {
        id: "minion-1",
        name: "minion-1",
        projectName: "project-1",
        projectPath: "/project-1",
        namedMinionPath: "/path/1",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Add minion
      store.addMinion(metadata1);

      // Sync with empty map (removes all minions)
      store.syncMinions(new Map());

      // Should verify that the controller was aborted, but since we mock the implementation
      // we just check that the minion was removed from internal state
      expect(store.getAggregator("minion-1")).toBeUndefined();
    });
  });

  describe("getMinionState", () => {
    it("should return initial state for newly added minion", () => {
      createAndAddMinion(store, "new-minion");
      const state = store.getMinionState("new-minion");

      expect(state).toMatchObject({
        messages: [],
        canInterrupt: false,
        isCompacting: false,
        loading: true, // loading because not caught up
        isHydratingTranscript: true,
        latticeMessages: [],
        currentModel: null,
      });
      // Should have recency based on createdAt
      expect(state.recencyTimestamp).not.toBeNull();
    });

    it("should return cached state when values unchanged", () => {
      createAndAddMinion(store, "test-minion");
      const state1 = store.getMinionState("test-minion");
      const state2 = store.getMinionState("test-minion");

      // Note: Currently the cache doesn't work because aggregator.getDisplayedMessages()
      // creates new arrays. This is acceptable for Phase 1 - React will still do
      // Object.is() comparison and skip re-renders for primitive values.
      // TODO: Optimize aggregator caching in Phase 2
      expect(state1).toEqual(state2);
      expect(state1.canInterrupt).toBe(state2.canInterrupt);
      expect(state1.loading).toBe(state2.loading);
    });
  });

  describe("history pagination", () => {
    it("initializes pagination from the oldest loaded history sequence on caught-up", async () => {
      const minionId = "history-pagination-minion-1";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        yield createHistoryMessageEvent("msg-newer", 5);
        await Promise.resolve();
        yield { type: "caught-up", hasOlderHistory: true };
        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = store.getMinionState(minionId);
      expect(state.hasOlderHistory).toBe(true);
      expect(state.loadingOlderHistory).toBe(false);
    });

    it("does not infer older history from non-boundary sequences without server metadata", async () => {
      const minionId = "history-pagination-no-boundary";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        yield createHistoryMessageEvent("msg-non-boundary", 5);
        await Promise.resolve();
        yield { type: "caught-up" };
        await waitForAbortSignal(options?.signal);
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const state = store.getMinionState(minionId);
      expect(state.hasOlderHistory).toBe(false);
      expect(state.loadingOlderHistory).toBe(false);
    });

    it("loads older history and prepends it to the transcript", async () => {
      const minionId = "history-pagination-minion-2";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        yield createHistoryMessageEvent("msg-newer", 5);
        await Promise.resolve();
        yield { type: "caught-up", hasOlderHistory: true };
        await waitForAbortSignal(options?.signal);
      });

      mockHistoryLoadMore.mockResolvedValueOnce({
        messages: [createHistoryMessageEvent("msg-older", 3)],
        nextCursor: null,
        hasOlder: false,
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getMinionState(minionId).hasOlderHistory).toBe(true);

      await store.loadOlderHistory(minionId);

      expect(mockHistoryLoadMore).toHaveBeenCalledWith({
        minionId,
        cursor: {
          beforeHistorySequence: 5,
          beforeMessageId: "msg-newer",
        },
      });

      const state = store.getMinionState(minionId);
      expect(state.hasOlderHistory).toBe(false);
      expect(state.loadingOlderHistory).toBe(false);
      expect(state.latticeMessages.map((message) => message.id)).toEqual(["msg-older", "msg-newer"]);
    });

    it("exposes loadingOlderHistory while requests are in flight and ignores concurrent loads", async () => {
      const minionId = "history-pagination-minion-3";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        yield createHistoryMessageEvent("msg-newer", 5);
        await Promise.resolve();
        yield { type: "caught-up", hasOlderHistory: true };
        await waitForAbortSignal(options?.signal);
      });

      let resolveLoadMore: ((value: LoadMoreResponse) => void) | undefined;

      const loadMorePromise = new Promise<LoadMoreResponse>((resolve) => {
        resolveLoadMore = resolve;
      });
      mockHistoryLoadMore.mockReturnValueOnce(loadMorePromise);

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const firstLoad = store.loadOlderHistory(minionId);
      expect(store.getMinionState(minionId).loadingOlderHistory).toBe(true);

      const secondLoad = store.loadOlderHistory(minionId);
      expect(mockHistoryLoadMore).toHaveBeenCalledTimes(1);

      resolveLoadMore?.({
        messages: [],
        nextCursor: null,
        hasOlder: false,
      });

      await firstLoad;
      await secondLoad;

      const state = store.getMinionState(minionId);
      expect(state.loadingOlderHistory).toBe(false);
      expect(state.hasOlderHistory).toBe(false);
    });

    it("ignores stale load-more responses after pagination state changes", async () => {
      const minionId = "history-pagination-stale-response";

      mockOnChat.mockImplementation(async function* (
        _input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        yield createHistoryMessageEvent("msg-newer", 5);
        await Promise.resolve();
        yield { type: "caught-up", hasOlderHistory: true };
        await waitForAbortSignal(options?.signal);
      });

      let resolveLoadMore: ((value: LoadMoreResponse) => void) | undefined;
      const loadMorePromise = new Promise<LoadMoreResponse>((resolve) => {
        resolveLoadMore = resolve;
      });
      mockHistoryLoadMore.mockReturnValueOnce(loadMorePromise);

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const loadOlderPromise = store.loadOlderHistory(minionId);
      expect(store.getMinionState(minionId).loadingOlderHistory).toBe(true);

      const internalHistoryPagination = (
        store as unknown as {
          historyPagination: Map<
            string,
            {
              nextCursor: { beforeHistorySequence: number; beforeMessageId?: string | null } | null;
              hasOlder: boolean;
              loading: boolean;
            }
          >;
        }
      ).historyPagination;
      // Simulate a concurrent pagination reset (e.g., live compaction boundary arriving).
      internalHistoryPagination.set(minionId, {
        nextCursor: null,
        hasOlder: false,
        loading: false,
      });

      resolveLoadMore?.({
        messages: [createHistoryMessageEvent("msg-stale-older", 3)],
        nextCursor: {
          beforeHistorySequence: 3,
          beforeMessageId: "msg-stale-older",
        },
        hasOlder: true,
      });

      await loadOlderPromise;

      const state = store.getMinionState(minionId);
      expect(state.latticeMessages.map((message) => message.id)).toEqual(["msg-newer"]);
      expect(state.hasOlderHistory).toBe(false);
      expect(state.loadingOlderHistory).toBe(false);
    });
  });

  describe("activity fallbacks", () => {
    it("uses activity snapshots for non-active minion sidebar fields", async () => {
      const minionId = "activity-fallback-minion";
      const activityRecency = new Date("2024-01-03T12:00:00.000Z").getTime();
      const activitySnapshot: MinionActivitySnapshot = {
        recency: activityRecency,
        streaming: true,
        lastModel: "claude-sonnet-4",
        lastThinkingLevel: "high",
        agentStatus: { emoji: "🔧", message: "Running checks", url: "https://example.com" },
      };

      // Recreate the store so the first activity.list call uses this test snapshot.
      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      mockActivityList.mockResolvedValue({ [minionId]: activitySnapshot });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(mockClient as any);

      // Let the initial activity.list call resolve and queue its state updates.
      await new Promise((resolve) => setTimeout(resolve, 0));

      createAndAddMinion(
        store,
        minionId,
        {
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        false
      );

      const state = store.getMinionState(minionId);
      expect(state.canInterrupt).toBe(true);
      expect(state.currentModel).toBe(activitySnapshot.lastModel);
      expect(state.currentThinkingLevel).toBe(activitySnapshot.lastThinkingLevel);
      expect(state.agentStatus).toEqual(activitySnapshot.agentStatus ?? undefined);
      expect(state.recencyTimestamp).toBe(activitySnapshot.recency);
    });

    it("fires response-complete callback when a background minion stops streaming", async () => {
      const activeMinionId = "active-minion";
      const backgroundMinionId = "background-minion";
      const initialRecency = new Date("2024-01-05T00:00:00.000Z").getTime();

      const backgroundStreamingSnapshot: MinionActivitySnapshot = {
        recency: initialRecency,
        streaming: true,
        lastModel: "claude-sonnet-4",
        lastThinkingLevel: null,
      };

      let releaseBackgroundCompletion!: () => void;
      const backgroundCompletionReady = new Promise<void>((resolve) => {
        releaseBackgroundCompletion = resolve;
      });

      mockActivityList.mockResolvedValue({
        [backgroundMinionId]: backgroundStreamingSnapshot,
      });

      mockActivitySubscribe.mockImplementation(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<
        { minionId: string; activity: MinionActivitySnapshot | null },
        void,
        unknown
      > {
        await backgroundCompletionReady;
        if (options?.signal?.aborted) {
          return;
        }

        yield {
          minionId: backgroundMinionId,
          activity: {
            ...backgroundStreamingSnapshot,
            recency: initialRecency + 1,
            streaming: false,
          },
        };

        await waitForAbortSignal(options?.signal);
      });

      const onResponseComplete = mock(
        (
          _minionId: string,
          _messageId: string,
          _isFinal: boolean,
          _finalText: string,
          _compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
          _completedAt?: number | null
        ) => undefined
      );

      // Recreate the store so the first activity.list call uses this test snapshot.
      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.setOnResponseComplete(onResponseComplete);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(mockClient as any);

      createAndAddMinion(store, activeMinionId);
      createAndAddMinion(store, backgroundMinionId, {}, false);

      releaseBackgroundCompletion();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onResponseComplete).toHaveBeenCalledTimes(1);
      expect(onResponseComplete).toHaveBeenCalledWith(
        backgroundMinionId,
        "",
        true,
        "",
        undefined,
        initialRecency + 1
      );
    });

    it("preserves compaction continue metadata for background completion callbacks", async () => {
      const activeMinionId = "active-minion-continue";
      const backgroundMinionId = "background-minion-continue";
      const initialRecency = new Date("2024-01-08T00:00:00.000Z").getTime();

      const backgroundStreamingSnapshot: MinionActivitySnapshot = {
        recency: initialRecency,
        streaming: true,
        lastModel: "claude-sonnet-4",
        lastThinkingLevel: null,
      };

      let releaseBackgroundCompletion!: () => void;
      const backgroundCompletionReady = new Promise<void>((resolve) => {
        releaseBackgroundCompletion = resolve;
      });

      mockActivityList.mockResolvedValue({
        [backgroundMinionId]: backgroundStreamingSnapshot,
      });

      mockActivitySubscribe.mockImplementation(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<
        { minionId: string; activity: MinionActivitySnapshot | null },
        void,
        unknown
      > {
        await backgroundCompletionReady;
        if (options?.signal?.aborted) {
          return;
        }

        yield {
          minionId: backgroundMinionId,
          activity: {
            ...backgroundStreamingSnapshot,
            recency: initialRecency + 1,
            streaming: false,
          },
        };

        await waitForAbortSignal(options?.signal);
      });

      mockOnChat.mockImplementation(async function* (
        input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        if (input?.minionId !== backgroundMinionId) {
          await waitForAbortSignal(options?.signal);
          return;
        }

        yield {
          type: "message",
          id: "compaction-request-msg",
          role: "user",
          parts: [{ type: "text", text: "/compact" }],
          metadata: {
            historySequence: 1,
            timestamp: Date.now(),
            latticeMetadata: {
              type: "compaction-request",
              rawCommand: "/compact",
              parsed: {
                model: "claude-sonnet-4",
                followUpContent: {
                  text: "continue after compaction",
                  model: "claude-sonnet-4",
                  agentId: "exec",
                },
              },
            },
          },
        };

        yield {
          type: "stream-start",
          minionId: backgroundMinionId,
          messageId: "compaction-stream",
          historySequence: 2,
          model: "claude-sonnet-4",
          startTime: Date.now(),
          mode: "exec",
        };

        yield { type: "caught-up", hasOlderHistory: false };

        await waitForAbortSignal(options?.signal);
      });

      const onResponseComplete = mock(
        (
          _minionId: string,
          _messageId: string,
          _isFinal: boolean,
          _finalText: string,
          _compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
          _completedAt?: number | null
        ) => undefined
      );

      // Recreate the store so the first activity.list call uses this test snapshot.
      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.setOnResponseComplete(onResponseComplete);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(mockClient as any);

      createAndAddMinion(store, backgroundMinionId);

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      const sawCompactingStream = await waitUntil(
        () => store.getMinionState(backgroundMinionId).isCompacting
      );
      expect(sawCompactingStream).toBe(true);

      // Move focus to a different minion so the compaction minion is backgrounded.
      createAndAddMinion(store, activeMinionId);

      releaseBackgroundCompletion();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onResponseComplete).toHaveBeenCalledTimes(1);
      expect(onResponseComplete).toHaveBeenCalledWith(
        backgroundMinionId,
        "",
        true,
        "",
        { hasContinueMessage: true },
        initialRecency + 1
      );
    });

    it("marks compaction completions with queued follow-up as continue for active callbacks", async () => {
      const minionId = "active-minion-queued-follow-up";

      mockOnChat.mockImplementation(async function* (
        input?: { minionId: string; mode?: unknown },
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<MinionChatMessage, void, unknown> {
        if (input?.minionId !== minionId) {
          await waitForAbortSignal(options?.signal);
          return;
        }

        const timestamp = Date.now();

        yield { type: "caught-up", hasOlderHistory: false };

        yield {
          type: "message",
          id: "compaction-request-msg",
          role: "user",
          parts: [{ type: "text", text: "/compact" }],
          metadata: {
            historySequence: 1,
            timestamp,
            latticeMetadata: {
              type: "compaction-request",
              rawCommand: "/compact",
              parsed: {
                model: "claude-sonnet-4",
              },
            },
          },
        };

        yield {
          type: "stream-start",
          minionId,
          messageId: "compaction-stream",
          historySequence: 2,
          model: "claude-sonnet-4",
          startTime: timestamp + 1,
          mode: "compact",
        };

        // A queued message will be auto-sent by the backend when compaction stream ends.
        yield {
          type: "queued-message-changed",
          minionId,
          queuedMessages: ["follow-up after compaction"],
          displayText: "follow-up after compaction",
        };

        yield {
          type: "stream-end",
          minionId,
          messageId: "compaction-stream",
          metadata: {
            model: "claude-sonnet-4",
          },
          parts: [],
        };

        await waitForAbortSignal(options?.signal);
      });

      const onResponseComplete = mock(
        (
          _minionId: string,
          _messageId: string,
          _isFinal: boolean,
          _finalText: string,
          _compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
          _completedAt?: number | null
        ) => undefined
      );

      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.setOnResponseComplete(onResponseComplete);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(mockClient as any);

      createAndAddMinion(store, minionId);

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      const sawResponseComplete = await waitUntil(() => onResponseComplete.mock.calls.length > 0);
      expect(sawResponseComplete).toBe(true);

      expect(onResponseComplete).toHaveBeenCalledTimes(1);
      expect(onResponseComplete).toHaveBeenCalledWith(
        minionId,
        "compaction-stream",
        true,
        "",
        { hasContinueMessage: true },
        expect.any(Number)
      );
    });

    it("does not fire response-complete callback when background streaming stops without recency advance", async () => {
      const activeMinionId = "active-minion-no-replay";
      const backgroundMinionId = "background-minion-no-replay";
      const initialRecency = new Date("2024-01-06T00:00:00.000Z").getTime();

      const backgroundStreamingSnapshot: MinionActivitySnapshot = {
        recency: initialRecency,
        streaming: true,
        lastModel: "claude-sonnet-4",
        lastThinkingLevel: null,
      };

      let releaseBackgroundTransition!: () => void;
      const backgroundTransitionReady = new Promise<void>((resolve) => {
        releaseBackgroundTransition = resolve;
      });

      mockActivityList.mockResolvedValue({
        [backgroundMinionId]: backgroundStreamingSnapshot,
      });

      mockActivitySubscribe.mockImplementation(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<
        { minionId: string; activity: MinionActivitySnapshot | null },
        void,
        unknown
      > {
        await backgroundTransitionReady;
        if (options?.signal?.aborted) {
          return;
        }

        yield {
          minionId: backgroundMinionId,
          activity: {
            ...backgroundStreamingSnapshot,
            // Abort/error transitions can stop streaming without advancing recency.
            recency: initialRecency,
            streaming: false,
          },
        };

        await waitForAbortSignal(options?.signal);
      });

      const onResponseComplete = mock(
        (
          _minionId: string,
          _messageId: string,
          _isFinal: boolean,
          _finalText: string,
          _compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
          _completedAt?: number | null
        ) => undefined
      );

      // Recreate the store so the first activity.list call uses this test snapshot.
      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.setOnResponseComplete(onResponseComplete);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(mockClient as any);

      createAndAddMinion(store, activeMinionId);
      createAndAddMinion(store, backgroundMinionId, {}, false);

      releaseBackgroundTransition();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onResponseComplete).not.toHaveBeenCalled();
    });
    it("clears activity stream-start recency cache on dispose", () => {
      const minionId = "dispose-clears-activity-recency";
      const internalStore = store as unknown as {
        activityStreamingStartRecency: Map<string, number>;
      };

      internalStore.activityStreamingStartRecency.set(minionId, Date.now());
      expect(internalStore.activityStreamingStartRecency.has(minionId)).toBe(true);

      store.dispose();

      expect(internalStore.activityStreamingStartRecency.size).toBe(0);
    });

    it("opens activity subscription before listing snapshots", async () => {
      store.dispose();
      store = new MinionStore(mockOnModelUsed);

      const callOrder: string[] = [];

      mockActivitySubscribe.mockImplementation(
        (
          _input?: void,
          options?: { signal?: AbortSignal }
        ): AsyncGenerator<
          { minionId: string; activity: MinionActivitySnapshot | null },
          void,
          unknown
        > => {
          callOrder.push("subscribe");

          // eslint-disable-next-line require-yield
          return (async function* (): AsyncGenerator<
            { minionId: string; activity: MinionActivitySnapshot | null },
            void,
            unknown
          > {
            await waitForAbortSignal(options?.signal);
          })();
        }
      );

      mockActivityList.mockImplementation(() => {
        callOrder.push("list");
        return Promise.resolve({});
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient({ minion: mockClient.minion, terminal: mockClient.terminal } as any);

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      const sawBothCalls = await waitUntil(() => callOrder.length >= 2);
      expect(sawBothCalls).toBe(true);
      expect(callOrder.slice(0, 2)).toEqual(["subscribe", "list"]);
    });

    it("preserves cached activity snapshots when list returns an empty payload", async () => {
      const minionId = "activity-list-empty-payload";
      const initialRecency = new Date("2024-01-07T00:00:00.000Z").getTime();
      const snapshot: MinionActivitySnapshot = {
        recency: initialRecency,
        streaming: true,
        lastModel: "claude-sonnet-4",
        lastThinkingLevel: "high",
      };

      store.dispose();
      store = new MinionStore(mockOnModelUsed);

      let listCallCount = 0;
      mockActivityList.mockImplementation(
        (): Promise<Record<string, MinionActivitySnapshot>> => {
          listCallCount += 1;
          if (listCallCount === 1) {
            return Promise.resolve({ [minionId]: snapshot });
          }
          return Promise.resolve({});
        }
      );

      // eslint-disable-next-line require-yield
      mockActivitySubscribe.mockImplementation(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<
        { minionId: string; activity: MinionActivitySnapshot | null },
        void,
        unknown
      > {
        await waitForAbortSignal(options?.signal);
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient({ minion: mockClient.minion, terminal: mockClient.terminal } as any);
      createAndAddMinion(
        store,
        minionId,
        {
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        false
      );

      const seededSnapshot = await waitUntil(() => {
        const state = store.getMinionState(minionId);
        return state.recencyTimestamp === initialRecency && state.canInterrupt === true;
      });
      expect(seededSnapshot).toBe(true);

      // Swap to a new client object to force activity subscription restart and a fresh list() call.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient({ minion: mockClient.minion, terminal: mockClient.terminal } as any);

      const sawRetryListCall = await waitUntil(() => listCallCount >= 2);
      expect(sawRetryListCall).toBe(true);

      const stateAfterEmptyList = store.getMinionState(minionId);
      expect(stateAfterEmptyList.recencyTimestamp).toBe(initialRecency);
      expect(stateAfterEmptyList.canInterrupt).toBe(true);
      expect(stateAfterEmptyList.currentModel).toBe(snapshot.lastModel);
      expect(stateAfterEmptyList.currentThinkingLevel).toBe(snapshot.lastThinkingLevel);
    });
  });

  describe("terminal activity", () => {
    it("propagates terminal activity to sidebar state", async () => {
      const minionId = "terminal-activity-minion";
      const events: TerminalActivityEvent[] = [
        {
          type: "snapshot",
          minions: {
            [minionId]: { activeCount: 2, totalSessions: 3 },
          },
        },
      ];

      const terminalSubscribeMock = mock(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<TerminalActivityEvent, void, unknown> {
        for (const event of events) {
          yield event;
        }
        await waitForAbortSignal(options?.signal);
      });

      const testClient = {
        ...mockClient,
        terminal: {
          activity: {
            subscribe: terminalSubscribeMock,
          },
        },
      };

      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.syncMinions(
        new Map([
          [
            minionId,
            {
              id: minionId,
              name: "test-branch",
              projectName: "test-project",
              projectPath: "/test",
              namedMinionPath: "/test/test-branch",
              createdAt: "2024-01-01T00:00:00.000Z",
              runtimeConfig: DEFAULT_RUNTIME_CONFIG,
            } satisfies FrontendMinionMetadata,
          ],
        ])
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(testClient as any);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const sidebarState = store.getMinionSidebarState(minionId);
      expect(sidebarState.terminalActiveCount).toBe(2);
      expect(sidebarState.terminalSessionCount).toBe(3);
    });

    it("treats missing terminal.activity.subscribe as unsupported capability (no crash/retry)", async () => {
      const minionId = "partial-client-minion";

      store.dispose();
      store = new MinionStore(mockOnModelUsed);

      store.syncMinions(
        new Map([
          [
            minionId,
            {
              id: minionId,
              name: "partial-branch",
              projectName: "test-project",
              projectPath: "/test",
              namedMinionPath: "/test/partial-branch",
              createdAt: "2024-01-01T00:00:00.000Z",
              runtimeConfig: DEFAULT_RUNTIME_CONFIG,
            } satisfies FrontendMinionMetadata,
          ],
        ])
      );

      // Client with terminal namespace but no activity.subscribe — should not throw.
      const partialClient = {
        minion: mockClient.minion,
        terminal: {},
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(partialClient as any);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const sidebarState = store.getMinionSidebarState(minionId);
      expect(sidebarState.terminalActiveCount).toBe(0);
      expect(sidebarState.terminalSessionCount).toBe(0);
    });

    it("re-arms terminal activity after unsupported client is replaced with supported client", async () => {
      const minionId = "rearm-terminal-minion";

      store.dispose();
      store = new MinionStore(mockOnModelUsed);
      store.syncMinions(
        new Map([
          [
            minionId,
            {
              id: minionId,
              name: "rearm-branch",
              projectName: "test-project",
              projectPath: "/test",
              namedMinionPath: "/test/rearm-branch",
              createdAt: "2024-01-01T00:00:00.000Z",
              runtimeConfig: DEFAULT_RUNTIME_CONFIG,
            } satisfies FrontendMinionMetadata,
          ],
        ])
      );

      // First: set an unsupported client (no terminal.activity.subscribe)
      const partialClient = {
        minion: mockClient.minion,
        terminal: {},
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(partialClient as any);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Confirm terminal counts are zero after unsupported client.
      expect(store.getMinionSidebarState(minionId).terminalActiveCount).toBe(0);
      expect(store.getMinionSidebarState(minionId).terminalSessionCount).toBe(0);

      // Second: replace with a supported client that has terminal.activity.subscribe.
      const terminalSubscribeMock = mock(async function* (
        _input?: void,
        options?: { signal?: AbortSignal }
      ): AsyncGenerator<TerminalActivityEvent, void, unknown> {
        yield {
          type: "snapshot",
          minions: {
            [minionId]: { activeCount: 1, totalSessions: 2 },
          },
        };
        await waitForAbortSignal(options?.signal);
      });

      const fullClient = {
        ...mockClient,
        terminal: {
          activity: {
            subscribe: terminalSubscribeMock,
          },
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      store.setClient(fullClient as any);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The subscription should start after the supported client is set.
      expect(terminalSubscribeMock).toHaveBeenCalled();
      const sidebarState = store.getMinionSidebarState(minionId);
      expect(sidebarState.terminalActiveCount).toBe(1);
      expect(sidebarState.terminalSessionCount).toBe(2);
    });

    it("defaults terminal counts to zero when no activity", () => {
      const minionId = "no-terminal-minion";

      store.dispose();
      store = new MinionStore(mockOnModelUsed);

      store.syncMinions(
        new Map([
          [
            minionId,
            {
              id: minionId,
              name: "empty-branch",
              projectName: "test-project",
              projectPath: "/test",
              namedMinionPath: "/test/empty-branch",
              createdAt: "2024-01-01T00:00:00.000Z",
              runtimeConfig: DEFAULT_RUNTIME_CONFIG,
            } satisfies FrontendMinionMetadata,
          ],
        ])
      );

      const sidebarState = store.getMinionSidebarState(minionId);
      expect(sidebarState.terminalActiveCount).toBe(0);
      expect(sidebarState.terminalSessionCount).toBe(0);
    });
  });

  describe("getMinionRecency", () => {
    it("should return stable reference when values unchanged", () => {
      const recency1 = store.getMinionRecency();
      const recency2 = store.getMinionRecency();

      // Should be same reference (cached)
      expect(recency1).toBe(recency2);
    });
  });

  describe("model tracking", () => {
    it("should call onModelUsed when stream starts", async () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield {
          type: "stream-start",
          historySequence: 1,
          messageId: "msg1",
          model: "claude-opus-4",
          minionId: "test-minion",
          startTime: Date.now(),
        };
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      store.setActiveMinionId(metadata.id);
      store.addMinion(metadata);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockOnModelUsed).toHaveBeenCalledWith("claude-opus-4");
    });
  });

  describe("reference stability", () => {
    it("getAllStates() returns new Map on each call", () => {
      const states1 = store.getAllStates();
      const states2 = store.getAllStates();
      // Should return new Map each time (not cached/reactive)
      expect(states1).not.toBe(states2);
      expect(states1).toEqual(states2); // But contents are equal
    });

    it("getMinionState() returns same reference when state hasn't changed", () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      store.addMinion(metadata);

      const state1 = store.getMinionState("test-minion");
      const state2 = store.getMinionState("test-minion");
      expect(state1).toBe(state2);
    });

    it("getMinionSidebarState() returns same reference when MinionState hasn't changed", () => {
      const originalNow = Date.now;
      let now = 1000;
      Date.now = () => now;

      try {
        const minionId = "test-minion";
        createAndAddMinion(store, minionId);

        const aggregator = store.getAggregator(minionId);
        expect(aggregator).toBeDefined();
        if (!aggregator) {
          throw new Error("Expected aggregator to exist");
        }

        const streamStart: StreamStartEvent = {
          type: "stream-start",
          minionId,
          messageId: "msg1",
          model: "claude-opus-4",
          historySequence: 1,
          startTime: 500,
          mode: "exec",
        };
        aggregator.handleStreamStart(streamStart);

        const toolStart: ToolCallStartEvent = {
          type: "tool-call-start",
          minionId,
          messageId: "msg1",
          toolCallId: "tool1",
          toolName: "test_tool",
          args: {},
          tokens: 0,
          timestamp: 600,
        };
        aggregator.handleToolCallStart(toolStart);

        // Simulate store update (MapStore version bump) after handling events.
        store.bumpState(minionId);

        now = 1300;
        const sidebar1 = store.getMinionSidebarState(minionId);

        // Advance time without a store bump. Sidebar state should remain stable
        // because it doesn't include timing stats (those use a separate subscription).
        now = 1350;
        const sidebar2 = store.getMinionSidebarState(minionId);

        expect(sidebar2).toBe(sidebar1);
      } finally {
        Date.now = originalNow;
      }
    });

    it("syncMinions() does not emit when minions unchanged", () => {
      const listener = mock(() => undefined);
      store.subscribe(listener);

      const metadata = new Map<string, FrontendMinionMetadata>();
      store.syncMinions(metadata);
      expect(listener).not.toHaveBeenCalled();

      listener.mockClear();
      store.syncMinions(metadata);
      expect(listener).not.toHaveBeenCalled();
    });

    it("getAggregator does not emit when creating new aggregator (no render side effects)", () => {
      let emitCount = 0;
      const unsubscribe = store.subscribe(() => {
        emitCount++;
      });

      // Add minion first
      createAndAddMinion(store, "test-minion");

      // Ignore setup emissions so this test only validates getAggregator() side effects.
      emitCount = 0;

      // Simulate what happens during render - component calls getAggregator
      const aggregator1 = store.getAggregator("test-minion");
      expect(aggregator1).toBeDefined();

      // Should NOT have emitted (would cause "Cannot update component while rendering" error)
      expect(emitCount).toBe(0);

      // Subsequent calls should return same aggregator
      const aggregator2 = store.getAggregator("test-minion");
      expect(aggregator2).toBe(aggregator1);
      expect(emitCount).toBe(0);

      unsubscribe();
    });
  });

  describe("cache invalidation", () => {
    it("invalidates getMinionState() cache when minion changes", async () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await new Promise((resolve) => setTimeout(resolve, 30));
        yield {
          type: "stream-start",
          historySequence: 1,
          messageId: "msg1",
          model: "claude-sonnet-4",
          minionId: "test-minion",
          startTime: Date.now(),
        };
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      store.setActiveMinionId(metadata.id);
      store.addMinion(metadata);

      const state1 = store.getMinionState("test-minion");

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 70));

      const state2 = store.getMinionState("test-minion");
      expect(state1).not.toBe(state2); // Cache should be invalidated
      expect(state2.canInterrupt).toBe(true); // Stream started, so can interrupt
    });

    it("invalidates getAllStates() cache when minion changes", async () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Setup mock stream
      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await new Promise((resolve) => setTimeout(resolve, 0));
        yield {
          type: "stream-start",
          historySequence: 1,
          messageId: "msg1",
          model: "claude-sonnet-4",
          minionId: "test-minion",
          startTime: Date.now(),
        };
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      });

      store.setActiveMinionId(metadata.id);
      store.addMinion(metadata);

      const states1 = store.getAllStates();

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 20));

      const states2 = store.getAllStates();
      expect(states1).not.toBe(states2); // Cache should be invalidated
    });

    it("maintains recency based on createdAt for new minions", () => {
      const createdAt = new Date("2024-01-01T00:00:00Z").toISOString();
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt,
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      store.addMinion(metadata);

      const recency = store.getMinionRecency();

      // Recency should be based on createdAt
      expect(recency["test-minion"]).toBe(new Date(createdAt).getTime());
    });

    it("maintains cache when no changes occur", () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      store.addMinion(metadata);

      const state1 = store.getMinionState("test-minion");
      const state2 = store.getMinionState("test-minion");
      const recency1 = store.getMinionRecency();
      const recency2 = store.getMinionRecency();

      // Cached values should return same references
      expect(state1).toBe(state2);
      expect(recency1).toBe(recency2);

      // getAllStates returns new Map each time (not cached)
      const allStates1 = store.getAllStates();
      const allStates2 = store.getAllStates();
      expect(allStates1).not.toBe(allStates2);
      expect(allStates1).toEqual(allStates2);
    });
  });

  describe("race conditions", () => {
    it("properly cleans up minion on removal", () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      store.addMinion(metadata);

      // Verify minion exists
      let allStates = store.getAllStates();
      expect(allStates.size).toBe(1);

      // Remove minion (clears aggregator and unsubscribes IPC)
      store.removeMinion("test-minion");

      // Verify minion is completely removed
      allStates = store.getAllStates();
      expect(allStates.size).toBe(0);

      // Verify aggregator is gone
      expect(store.getAggregator("test-minion")).toBeUndefined();
    });

    it("handles concurrent minion additions", () => {
      const metadata1: FrontendMinionMetadata = {
        id: "minion-1",
        name: "minion-1",
        projectName: "project-1",
        projectPath: "/project-1",
        namedMinionPath: "/path/1",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      const metadata2: FrontendMinionMetadata = {
        id: "minion-2",
        name: "minion-2",
        projectName: "project-2",
        projectPath: "/project-2",
        namedMinionPath: "/path/2",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };

      // Add minions concurrently
      store.addMinion(metadata1);
      store.addMinion(metadata2);

      const allStates = store.getAllStates();
      expect(allStates.size).toBe(2);
      expect(allStates.has("minion-1")).toBe(true);
      expect(allStates.has("minion-2")).toBe(true);
    });

    it("handles minion removal during state access", () => {
      const metadata: FrontendMinionMetadata = {
        id: "test-minion",
        name: "test-minion",
        projectName: "test-project",
        projectPath: "/test/project",
        namedMinionPath: "/test/project/test-minion",
        createdAt: new Date().toISOString(),
        runtimeConfig: DEFAULT_RUNTIME_CONFIG,
      };
      store.addMinion(metadata);

      const state1 = store.getMinionState("test-minion");
      expect(state1).toBeDefined();

      // Remove minion
      store.removeMinion("test-minion");

      // Accessing state after removal should create new aggregator (lazy init)
      const state2 = store.getMinionState("test-minion");
      expect(state2).toBeDefined();
      expect(state2.loading).toBe(true); // Fresh minion, not caught up
    });
  });

  describe("bash-output events", () => {
    it("retains live output when bash tool result has no output", async () => {
      const minionId = "bash-output-minion-1";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await Promise.resolve();
        yield {
          type: "bash-output",
          minionId,
          toolCallId: "call-1",
          text: "out\n",
          isError: false,
          timestamp: 1,
        };
        yield {
          type: "bash-output",
          minionId,
          toolCallId: "call-1",
          text: "err\n",
          isError: true,
          timestamp: 2,
        };
        // Simulate tmpfile overflow: tool result has no output field.
        yield {
          type: "tool-call-end",
          minionId,
          messageId: "m1",
          toolCallId: "call-1",
          toolName: "bash",
          result: { success: false, error: "overflow", exitCode: -1, wall_duration_ms: 1 },
          timestamp: 3,
        };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const live = store.getBashToolLiveOutput(minionId, "call-1");
      expect(live).not.toBeNull();
      if (!live) throw new Error("Expected live output");

      // getSnapshot in useSyncExternalStore requires referential stability when unchanged.
      const liveAgain = store.getBashToolLiveOutput(minionId, "call-1");
      expect(liveAgain).toBe(live);

      expect(live.stdout).toContain("out");
      expect(live.stderr).toContain("err");
    });

    it("clears live output when bash tool result includes output", async () => {
      const minionId = "bash-output-minion-2";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await Promise.resolve();
        yield {
          type: "bash-output",
          minionId,
          toolCallId: "call-2",
          text: "out\n",
          isError: false,
          timestamp: 1,
        };
        yield {
          type: "tool-call-end",
          minionId,
          messageId: "m2",
          toolCallId: "call-2",
          toolName: "bash",
          result: { success: true, output: "done", exitCode: 0, wall_duration_ms: 1 },
          timestamp: 2,
        };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const live = store.getBashToolLiveOutput(minionId, "call-2");
      expect(live).toBeNull();
    });

    it("replays pre-caught-up bash output after full replay catches up", async () => {
      const minionId = "bash-output-minion-3";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield {
          type: "bash-output",
          minionId,
          toolCallId: "call-3",
          text: "buffered\n",
          isError: false,
          timestamp: 1,
        };
        await Promise.resolve();
        yield { type: "caught-up", replay: "full" };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const live = store.getBashToolLiveOutput(minionId, "call-3");
      expect(live).not.toBeNull();
      if (!live) throw new Error("Expected buffered live output after caught-up");
      expect(live.stdout).toContain("buffered");
    });
  });
  describe("task-created events", () => {
    it("exposes live taskId while the task tool is running", async () => {
      const minionId = "task-created-minion-1";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await Promise.resolve();
        yield {
          type: "task-created",
          minionId,
          toolCallId: "call-task-1",
          taskId: "child-minion-1",
          timestamp: 1,
        };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getTaskToolLiveTaskId(minionId, "call-task-1")).toBe("child-minion-1");
    });

    it("clears live taskId on task tool-call-end", async () => {
      const minionId = "task-created-minion-2";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield { type: "caught-up" };
        await Promise.resolve();
        yield {
          type: "task-created",
          minionId,
          toolCallId: "call-task-2",
          taskId: "child-minion-2",
          timestamp: 1,
        };
        yield {
          type: "tool-call-end",
          minionId,
          messageId: "m-task-2",
          toolCallId: "call-task-2",
          toolName: "task",
          result: { status: "queued", taskId: "child-minion-2" },
          timestamp: 2,
        };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getTaskToolLiveTaskId(minionId, "call-task-2")).toBeNull();
    });

    it("preserves pagination state across since reconnect retries", async () => {
      const minionId = "pagination-since-retry";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield createHistoryMessageEvent("history-5", 5);
          yield {
            type: "caught-up",
            replay: "full",
            hasOlderHistory: true,
            cursor: {
              history: {
                messageId: "history-5",
                historySequence: 5,
              },
            },
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "since",
          cursor: {
            history: {
              messageId: "history-5",
              historySequence: 5,
            },
          },
        };
      });

      createAndAddMinion(store, minionId);

      const seededPagination = await waitUntil(
        () => store.getMinionState(minionId).hasOlderHistory === true
      );
      expect(seededPagination).toBe(true);

      releaseFirstSubscription?.();

      const preservedPagination = await waitUntil(() => {
        return (
          subscriptionCount >= 2 && store.getMinionState(minionId).hasOlderHistory === true
        );
      });
      expect(preservedPagination).toBe(true);
    });

    it("clears stale live tool state when since replay reports no active stream", async () => {
      const minionId = "task-created-minion-4";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "bash-output",
            minionId,
            toolCallId: "call-bash-4",
            text: "stale-output\n",
            isError: false,
            timestamp: 1,
          };
          yield {
            type: "task-created",
            minionId,
            toolCallId: "call-task-4",
            taskId: "child-minion-4",
            timestamp: 2,
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "since",
          cursor: {
            history: {
              messageId: "history-1",
              historySequence: 1,
            },
          },
        };
      });

      createAndAddMinion(store, minionId);

      const seededLiveState = await waitUntil(() => {
        return (
          store.getBashToolLiveOutput(minionId, "call-bash-4") !== null &&
          store.getTaskToolLiveTaskId(minionId, "call-task-4") === "child-minion-4"
        );
      });
      expect(seededLiveState).toBe(true);

      releaseFirstSubscription?.();

      const clearedLiveState = await waitUntil(() => {
        return (
          subscriptionCount >= 2 &&
          store.getBashToolLiveOutput(minionId, "call-bash-4") === null &&
          store.getTaskToolLiveTaskId(minionId, "call-task-4") === null
        );
      });
      expect(clearedLiveState).toBe(true);
    });

    it("clears stale live tool state when server stream exists but local stream context is missing", async () => {
      const minionId = "task-created-minion-7";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-old-stream-missing-local",
            historySequence: 1,
            model: "claude-3-5-sonnet-20241022",
            startTime: 1_000,
          };
          yield {
            type: "bash-output",
            minionId,
            toolCallId: "call-bash-7",
            text: "stale-after-end\n",
            isError: false,
            timestamp: 1_001,
          };
          yield {
            type: "task-created",
            minionId,
            toolCallId: "call-task-7",
            taskId: "child-minion-7",
            timestamp: 1_002,
          };
          yield {
            type: "stream-end",
            minionId,
            messageId: "msg-old-stream-missing-local",
            metadata: {
              model: "claude-3-5-sonnet-20241022",
              historySequence: 1,
              timestamp: 1_003,
            },
            parts: [],
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "since",
          cursor: {
            history: {
              messageId: "history-1",
              historySequence: 1,
            },
            stream: {
              messageId: "msg-new-stream-missing-local",
              lastTimestamp: 2_000,
            },
          },
        };
      });

      createAndAddMinion(store, minionId);

      const seededStaleLiveState = await waitUntil(() => {
        return (
          store.getAggregator(minionId)?.getOnChatCursor()?.stream === undefined &&
          store.getBashToolLiveOutput(minionId, "call-bash-7") !== null &&
          store.getTaskToolLiveTaskId(minionId, "call-task-7") === "child-minion-7"
        );
      });
      expect(seededStaleLiveState).toBe(true);

      releaseFirstSubscription?.();

      const clearedStaleLiveState = await waitUntil(() => {
        return (
          subscriptionCount >= 2 &&
          store.getBashToolLiveOutput(minionId, "call-bash-7") === null &&
          store.getTaskToolLiveTaskId(minionId, "call-task-7") === null
        );
      });
      expect(clearedStaleLiveState).toBe(true);
    });

    it("clears stale active stream context when since replay reports a different stream", async () => {
      const minionId = "task-created-minion-5";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-old-stream",
            historySequence: 1,
            model: "claude-3-5-sonnet-20241022",
            startTime: 1_000,
          };
          yield {
            type: "bash-output",
            minionId,
            toolCallId: "call-bash-5",
            text: "old-stream-output\n",
            isError: false,
            timestamp: 1_001,
          };
          yield {
            type: "task-created",
            minionId,
            toolCallId: "call-task-5",
            taskId: "child-minion-5",
            timestamp: 1_002,
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "since",
          cursor: {
            history: {
              messageId: "history-1",
              historySequence: 1,
            },
            stream: {
              messageId: "msg-new-stream",
              lastTimestamp: 2_000,
            },
          },
        };
        await Promise.resolve();
        yield {
          type: "stream-start",
          minionId,
          messageId: "msg-new-stream",
          historySequence: 2,
          model: "claude-3-5-sonnet-20241022",
          startTime: 2_000,
        };
      });

      createAndAddMinion(store, minionId);

      const seededOldStream = await waitUntil(() => {
        return (
          store.getAggregator(minionId)?.getOnChatCursor()?.stream?.messageId ===
          "msg-old-stream"
        );
      });
      expect(seededOldStream).toBe(true);
      expect(store.getBashToolLiveOutput(minionId, "call-bash-5")?.stdout).toContain(
        "old-stream-output"
      );
      expect(store.getTaskToolLiveTaskId(minionId, "call-task-5")).toBe("child-minion-5");

      releaseFirstSubscription?.();

      const switchedToNewStream = await waitUntil(() => {
        return (
          subscriptionCount >= 2 &&
          store.getAggregator(minionId)?.getOnChatCursor()?.stream?.messageId ===
            "msg-new-stream" &&
          store.getBashToolLiveOutput(minionId, "call-bash-5") === null &&
          store.getTaskToolLiveTaskId(minionId, "call-task-5") === null
        );
      });
      expect(switchedToNewStream).toBe(true);
    });

    it("clears stale abort reason when since reconnect is downgraded to full replay", async () => {
      const minionId = "task-created-minion-6";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-abort-old-stream",
            historySequence: 1,
            model: "claude-3-5-sonnet-20241022",
            startTime: 1_000,
          };
          yield {
            type: "stream-abort",
            minionId,
            messageId: "msg-abort-old-stream",
            abortReason: "user",
            metadata: {},
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "full",
        };
      });

      createAndAddMinion(store, minionId);

      const seededAbortReason = await waitUntil(() => {
        return store.getMinionState(minionId).lastAbortReason?.reason === "user";
      });
      expect(seededAbortReason).toBe(true);

      releaseFirstSubscription?.();

      const clearedAbortReason = await waitUntil(() => {
        return (
          subscriptionCount >= 2 && store.getMinionState(minionId).lastAbortReason === null
        );
      });
      expect(clearedAbortReason).toBe(true);
    });

    it("clears stale auto-retry status when full replay reconnect replaces history", async () => {
      const minionId = "task-created-minion-auto-retry-reset";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "auto-retry-starting",
            attempt: 2,
          };

          await holdFirstSubscription;
          return;
        }

        yield {
          type: "caught-up",
          replay: "full",
        };
      });

      createAndAddMinion(store, minionId);

      const seededRetryStatus = await waitUntil(() => {
        return store.getMinionState(minionId).autoRetryStatus?.type === "auto-retry-starting";
      });
      expect(seededRetryStatus).toBe(true);

      releaseFirstSubscription?.();

      const clearedRetryStatus = await waitUntil(() => {
        return (
          subscriptionCount >= 2 && store.getMinionState(minionId).autoRetryStatus === null
        );
      });
      expect(clearedRetryStatus).toBe(true);
    });

    it("replays pre-caught-up task-created after full replay catches up", async () => {
      const minionId = "task-created-minion-3";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        yield {
          type: "task-created",
          minionId,
          toolCallId: "call-task-3",
          taskId: "child-minion-3",
          timestamp: 1,
        };
        await Promise.resolve();
        yield { type: "caught-up", replay: "full" };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(store.getTaskToolLiveTaskId(minionId, "call-task-3")).toBe("child-minion-3");
    });

    it("preserves usage state while full replay resets the aggregator", async () => {
      const minionId = "usage-reset-replay-minion";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      let releaseSecondCaughtUp: (() => void) | undefined;
      const holdSecondCaughtUp = new Promise<void>((resolve) => {
        releaseSecondCaughtUp = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-live-usage",
            historySequence: 1,
            model: "claude-3-5-sonnet-20241022",
            startTime: 1,
          };
          yield {
            type: "usage-delta",
            minionId,
            messageId: "msg-live-usage",
            usage: { inputTokens: 321, outputTokens: 9, totalTokens: 330 },
            cumulativeUsage: { inputTokens: 500, outputTokens: 15, totalTokens: 515 },
          };

          await holdFirstSubscription;
          return;
        }

        if (subscriptionCount === 2) {
          // Hold caught-up so the test can inspect usage after resetChatStateForReplay()
          // cleared the aggregator but before replay completion.
          await holdSecondCaughtUp;
          yield { type: "caught-up", replay: "full" };
          return;
        }

        await waitForAbortSignal();
      });

      createAndAddMinion(store, minionId);

      const seededUsage = await waitUntil(() => {
        const aggregator = store.getAggregator(minionId);
        return aggregator?.getActiveStreamUsage("msg-live-usage")?.inputTokens === 321;
      });
      expect(seededUsage).toBe(true);

      releaseFirstSubscription?.();

      const startedSecondSubscription = await waitUntil(() => subscriptionCount >= 2);
      expect(startedSecondSubscription).toBe(true);

      const usageDuringReplay = store.getMinionUsage(minionId);
      expect(usageDuringReplay.liveUsage?.input.tokens).toBe(321);
      expect(usageDuringReplay.liveCostUsage?.input.tokens).toBe(500);

      releaseSecondCaughtUp?.();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const usageAfterCaughtUp = store.getMinionUsage(minionId);
      expect(usageAfterCaughtUp.liveUsage).toBeUndefined();
    });

    it("clears replay usage snapshot when reconnect fails before caught-up", async () => {
      const minionId = "usage-reset-replay-failure-minion";
      let subscriptionCount = 0;
      let releaseFirstSubscription: (() => void) | undefined;
      const holdFirstSubscription = new Promise<void>((resolve) => {
        releaseFirstSubscription = resolve;
      });

      const waitUntil = async (condition: () => boolean, timeoutMs = 2000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (condition()) {
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return false;
      };

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        subscriptionCount += 1;

        if (subscriptionCount === 1) {
          yield { type: "caught-up" };
          await Promise.resolve();
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-live-usage-failure",
            historySequence: 1,
            model: "claude-3-5-sonnet-20241022",
            startTime: 1,
          };
          yield {
            type: "usage-delta",
            minionId,
            messageId: "msg-live-usage-failure",
            usage: { inputTokens: 111, outputTokens: 9, totalTokens: 120 },
            cumulativeUsage: { inputTokens: 300, outputTokens: 15, totalTokens: 315 },
          };
          // Keep two active streams so reconnect cannot build a safe incremental cursor.
          // This forces a full replay attempt, which executes resetChatStateForReplay().
          yield {
            type: "stream-start",
            minionId,
            messageId: "msg-live-usage-failure-2",
            historySequence: 2,
            model: "claude-3-5-sonnet-20241022",
            startTime: 2,
          };

          await holdFirstSubscription;
          return;
        }

        if (subscriptionCount === 2) {
          // Simulate reconnect failure before authoritative caught-up.
          await Promise.resolve();
          return;
        }

        await waitForAbortSignal();
      });

      createAndAddMinion(store, minionId);

      const seededUsage = await waitUntil(() => {
        const aggregator = store.getAggregator(minionId);
        return aggregator?.getActiveStreamUsage("msg-live-usage-failure")?.inputTokens === 111;
      });
      expect(seededUsage).toBe(true);

      releaseFirstSubscription?.();

      const startedSecondSubscription = await waitUntil(() => subscriptionCount >= 2);
      expect(startedSecondSubscription).toBe(true);

      const usageSnapshotCleared = await waitUntil(() => {
        const usage = store.getMinionUsage(minionId);
        return usage.liveUsage === undefined && usage.liveCostUsage === undefined;
      });
      expect(usageSnapshotCleared).toBe(true);
    });

    it("uses compaction boundary context usage when it is the newest usage in the active epoch", async () => {
      const minionId = "boundary-context-usage-minion";

      mockOnChat.mockImplementation(async function* (): AsyncGenerator<
        MinionChatMessage,
        void,
        unknown
      > {
        await Promise.resolve();
        yield {
          type: "message",
          id: "pre-boundary-assistant",
          role: "assistant",
          parts: [{ type: "text", text: "Older context usage" }],
          metadata: {
            historySequence: 1,
            timestamp: 1,
            model: "claude-3-5-sonnet-20241022",
            contextUsage: { inputTokens: 999, outputTokens: 10, totalTokens: undefined },
          },
        };

        yield {
          type: "message",
          id: "compaction-boundary-summary",
          role: "assistant",
          parts: [{ type: "text", text: "Compacted summary" }],
          metadata: {
            historySequence: 2,
            timestamp: 2,
            model: "claude-3-5-sonnet-20241022",
            compacted: "idle",
            compactionBoundary: true,
            compactionEpoch: 1,
            contextUsage: { inputTokens: 42, outputTokens: 0, totalTokens: undefined },
          },
        };

        yield { type: "caught-up" };
      });

      createAndAddMinion(store, minionId);
      await new Promise((resolve) => setTimeout(resolve, 10));

      const usage = store.getMinionUsage(minionId);
      expect(usage.lastContextUsage?.input.tokens).toBe(42);
      expect(usage.lastContextUsage?.output.tokens).toBe(0);
      expect(usage.lastContextUsage?.model).toBe("claude-3-5-sonnet-20241022");
    });
  });
});
