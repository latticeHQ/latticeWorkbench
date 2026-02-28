import assert from "@/common/utils/assert";
import type { LatticeMessage, DisplayedMessage, QueuedMessage } from "@/common/types/message";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type {
  MinionActivitySnapshot,
  MinionChatMessage,
  MinionStatsSnapshot,
  OnChatMode,
  ProvidersConfigMap,
} from "@/common/orpc/types";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import type { TodoItem } from "@/common/types/tools";
import { applyMinionChatEventToAggregator } from "@/browser/utils/messages/applyMinionChatEventToAggregator";
import {
  StreamingMessageAggregator,
  type LoadedSkill,
  type SkillLoadError,
} from "@/browser/utils/messages/StreamingMessageAggregator";
import { isAbortError } from "@/browser/utils/isAbortError";
import { BASH_TRUNCATE_MAX_TOTAL_BYTES } from "@/common/constants/toolLimits";
import { CUSTOM_EVENTS, createCustomEvent } from "@/common/constants/events";
import { useCallback, useSyncExternalStore } from "react";
import {
  isCaughtUpMessage,
  isStreamError,
  isDeleteMessage,
  isBashOutputEvent,
  isTaskCreatedEvent,
  isLatticeMessage,
  isQueuedMessageChanged,
  isRestoreToInput,
} from "@/common/orpc/types";
import type {
  StreamAbortEvent,
  StreamAbortReasonSnapshot,
  StreamEndEvent,
  RuntimeStatusEvent,
} from "@/common/types/stream";
import { MapStore } from "./MapStore";
import { createDisplayUsage, recomputeUsageCosts } from "@/common/utils/tokens/displayUsage";
import { getModelStats } from "@/common/utils/tokens/modelStats";
import { resolveModelForMetadata } from "@/common/utils/providers/modelEntries";
import { computeProvidersConfigFingerprint } from "@/common/utils/providers/configFingerprint";
import { isDurableCompactionBoundaryMarker } from "@/common/utils/messages/compactionBoundary";
import { MinionConsumerManager } from "./MinionConsumerManager";
import type { ChatUsageDisplay } from "@/common/utils/tokens/usageAggregator";
import { sumUsageHistory } from "@/common/utils/tokens/usageAggregator";
import type { TokenConsumer } from "@/common/types/chatStats";
import type { z } from "zod";
import type { SessionUsageFileSchema } from "@/common/orpc/schemas/chatStats";
import type { LanguageModelV2Usage } from "@ai-sdk/provider";
import {
  appendLiveBashOutputChunk,
  type LiveBashOutputInternal,
  type LiveBashOutputView,
} from "@/browser/utils/messages/liveBashOutputBuffer";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { getAutoCompactionThresholdKey, getAutoRetryKey } from "@/common/constants/storage";
import { DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT } from "@/common/constants/ui";
import { trackStreamCompleted } from "@/common/telemetry";

export type AutoRetryStatus = Extract<
  MinionChatMessage,
  | { type: "auto-retry-scheduled" }
  | { type: "auto-retry-starting" }
  | { type: "auto-retry-abandoned" }
>;

export interface MinionState {
  name: string; // User-facing minion name (e.g., "feature-branch")
  messages: DisplayedMessage[];
  queuedMessage: QueuedMessage | null;
  canInterrupt: boolean;
  isCompacting: boolean;
  isStreamStarting: boolean;
  awaitingUserQuestion: boolean;
  loading: boolean;
  isHydratingTranscript: boolean;
  hasOlderHistory: boolean;
  loadingOlderHistory: boolean;
  latticeMessages: LatticeMessage[];
  currentModel: string | null;
  currentThinkingLevel: string | null;
  recencyTimestamp: number | null;
  todos: TodoItem[];
  loadedSkills: LoadedSkill[];
  skillLoadErrors: SkillLoadError[];
  agentStatus: { emoji: string; message: string; url?: string } | undefined;
  lastAbortReason: StreamAbortReasonSnapshot | null;
  pendingStreamStartTime: number | null;
  // Model used for the pending send (used during "starting" phase)
  pendingStreamModel: string | null;
  // Runtime status from ensureReady (for Lattice minion starting UX)
  runtimeStatus: RuntimeStatusEvent | null;
  autoRetryStatus: AutoRetryStatus | null;
  // Live streaming stats (updated on each stream-delta)
  streamingTokenCount: number | undefined;
  streamingTPS: number | undefined;
}

/**
 * Timing statistics for streaming sessions (active or completed).
 * When isActive=true, endTime is null and elapsed time should be computed live.
 * When isActive=false, endTime contains the completion timestamp.
 */
export interface StreamTimingStats {
  /** When the stream started (Date.now()) */
  startTime: number;
  /** When the stream ended, null if still active */
  endTime: number | null;
  /** When first content token arrived, null if still waiting */
  firstTokenTime: number | null;
  /** Accumulated tool execution time in ms */
  toolExecutionMs: number;
  /** Whether this is an active stream (true) or completed (false) */
  isActive: boolean;
  /** Model used for this stream */
  model: string;
  /** Output tokens (excludes reasoning/thinking tokens) - only available for completed streams */
  outputTokens?: number;
  /** Reasoning/thinking tokens - only available for completed streams */
  reasoningTokens?: number;
  /** Streaming duration in ms (first token to end) - only available for completed streams */
  streamingMs?: number;
  /** Live token count during streaming - only available for active streams */
  liveTokenCount?: number;
  /** Live tokens-per-second during streaming - only available for active streams */
  liveTPS?: number;
  /** Mode (plan/exec) in which this stream occurred */
  mode?: string;
}

/** Per-model timing statistics */
export interface ModelTimingStats {
  /** Total time spent in responses for this model */
  totalDurationMs: number;
  /** Total time spent executing tools for this model */
  totalToolExecutionMs: number;
  /** Total time spent streaming tokens (excludes TTFT) - for accurate tokens/sec */
  totalStreamingMs: number;
  /** Average time to first token for this model */
  averageTtftMs: number | null;
  /** Number of completed responses for this model */
  responseCount: number;
  /** Total output tokens generated by this model (excludes reasoning/thinking tokens) */
  totalOutputTokens: number;
  /** Total reasoning/thinking tokens generated by this model */
  totalReasoningTokens: number;
  /** Mode extracted from composite key (undefined for old data without mode) */
  mode?: string;
}

/**
 * Aggregate timing statistics across all completed streams in a session.
 */
export interface SessionTimingStats {
  /** Total time spent in all responses */
  totalDurationMs: number;
  /** Total time spent executing tools */
  totalToolExecutionMs: number;
  /** Total time spent streaming tokens (excludes TTFT) - for accurate tokens/sec */
  totalStreamingMs: number;
  /** Average time to first token (null if no responses had TTFT) */
  averageTtftMs: number | null;
  /** Number of completed responses */
  responseCount: number;
  /** Total output tokens generated across all models (excludes reasoning/thinking tokens) */
  totalOutputTokens: number;
  /** Total reasoning/thinking tokens generated across all models */
  totalReasoningTokens: number;
  /** Per-model timing breakdown */

  byModel: Record<string, ModelTimingStats>;
}

/**
 * Subset of MinionState needed for sidebar display.
 * Subscribing to only these fields prevents re-renders when messages update.
 *
 * Note: timingStats/sessionStats are intentionally excluded - they update on every
 * streaming token. Components needing timing should use useMinionStatsSnapshot().
 */
export interface MinionSidebarState {
  canInterrupt: boolean;
  isStarting: boolean;
  awaitingUserQuestion: boolean;
  currentModel: string | null;
  recencyTimestamp: number | null;
  loadedSkills: LoadedSkill[];
  skillLoadErrors: SkillLoadError[];
  agentStatus: { emoji: string; message: string; url?: string } | undefined;
  terminalActiveCount: number;
  terminalSessionCount: number;
}

/**
 * Derived state values stored in the derived MapStore.
 * Currently only recency timestamps for minion sorting.
 */
type DerivedState = Record<string, number>;

/**
 * Usage metadata extracted from API responses (no tokenization).
 * Updates instantly when usage metadata arrives.
 *
 * For multi-step tool calls, cost and context usage differ:
 * - sessionTotal: Pre-computed sum of all models from session-usage.json
 * - lastRequest: Last completed request (persisted for app restart)
 * - lastContextUsage: Last step's usage for context window display (inputTokens = actual context size)
 */
export interface MinionUsageState {
  /** Pre-computed session total (sum of all models) */
  sessionTotal?: ChatUsageDisplay;
  /** Last completed request (persisted) */
  lastRequest?: {
    model: string;
    usage: ChatUsageDisplay;
    timestamp: number;
  };
  /** Last message's context usage (last step only, for context window display) */
  lastContextUsage?: ChatUsageDisplay;
  totalTokens: number;
  /** Live context usage during streaming (last step's inputTokens = current context window) */
  liveUsage?: ChatUsageDisplay;
  /** Live cost usage during streaming (cumulative across all steps) */
  liveCostUsage?: ChatUsageDisplay;
}

/**
 * Consumer breakdown requiring tokenization (lazy calculation).
 * Updates after async Web Worker calculation completes.
 */
export interface MinionConsumersState {
  consumers: TokenConsumer[];
  tokenizerName: string;
  totalTokens: number; // Total from tokenization (may differ from usage totalTokens)
  isCalculating: boolean;
  topFilePaths?: Array<{ path: string; tokens: number }>; // Top 10 files aggregated across all file tools
}

interface MinionChatTransientState {
  caughtUp: boolean;
  isHydratingTranscript: boolean;
  historicalMessages: LatticeMessage[];
  pendingStreamEvents: MinionChatMessage[];
  replayingHistory: boolean;
  queuedMessage: QueuedMessage | null;
  liveBashOutput: Map<string, LiveBashOutputInternal>;
  liveTaskIds: Map<string, string>;
  autoRetryStatus: AutoRetryStatus | null;
}

interface HistoryPaginationCursor {
  beforeHistorySequence: number;
  beforeMessageId?: string | null;
}

interface MinionHistoryPaginationState {
  nextCursor: HistoryPaginationCursor | null;
  hasOlder: boolean;
  loading: boolean;
}

function areHistoryPaginationCursorsEqual(
  a: HistoryPaginationCursor | null,
  b: HistoryPaginationCursor | null
): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return (
    a.beforeHistorySequence === b.beforeHistorySequence &&
    (a.beforeMessageId ?? null) === (b.beforeMessageId ?? null)
  );
}

function createInitialHistoryPaginationState(): MinionHistoryPaginationState {
  return {
    nextCursor: null,
    hasOlder: false,
    loading: false,
  };
}

function createInitialChatTransientState(): MinionChatTransientState {
  return {
    caughtUp: false,
    isHydratingTranscript: false,
    historicalMessages: [],
    pendingStreamEvents: [],
    replayingHistory: false,
    queuedMessage: null,
    liveBashOutput: new Map(),
    liveTaskIds: new Map(),
    autoRetryStatus: null,
  };
}

const ON_CHAT_RETRY_BASE_MS = 250;
const ON_CHAT_RETRY_MAX_MS = 5000;

// Stall detection: server sends heartbeats every 5s, so if we don't receive any events
// (including heartbeats) for 10s, the connection is likely dead. This handles half-open
// WebSocket paths (e.g., some WSL localhost forwarding setups).
const ON_CHAT_STALL_TIMEOUT_MS = 10_000;
const ON_CHAT_STALL_CHECK_INTERVAL_MS = 2_000;

interface ValidationIssue {
  path?: Array<string | number>;
  message?: string;
}

type IteratorValidationFailedError = Error & {
  code: "EVENT_ITERATOR_VALIDATION_FAILED";
  cause?: {
    issues?: ValidationIssue[];
    data?: unknown;
  };
};

function isIteratorValidationFailed(error: unknown): error is IteratorValidationFailedError {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === "EVENT_ITERATOR_VALIDATION_FAILED"
  );
}

/**
 * Extract a human-readable summary from an iterator validation error.
 * ORPC wraps Zod issues in error.cause with { issues: [...], data: ... }
 */
function formatValidationError(error: IteratorValidationFailedError): string {
  const cause = error.cause;
  if (!cause) {
    return "Unknown validation error (no cause)";
  }

  const issues = cause.issues ?? [];
  if (issues.length === 0) {
    return `Unknown validation error (no issues). Data: ${JSON.stringify(cause.data)}`;
  }

  // Format issues like: "type: Invalid discriminator value" or "metadata.usage.inputTokens: Expected number"
  const issuesSummary = issues
    .slice(0, 3) // Limit to first 3 issues
    .map((issue) => {
      const path = issue.path?.join(".") ?? "(root)";
      const message = issue.message ?? "Unknown issue";
      return `${path}: ${message}`;
    })
    .join("; ");

  const moreCount = issues.length > 3 ? ` (+${issues.length - 3} more)` : "";

  // Include the event type if available
  const data = cause.data as { type?: string } | undefined;
  const eventType = data?.type ? ` [event: ${data.type}]` : "";

  return `${issuesSummary}${moreCount}${eventType}`;
}

function areAgentStatusesEqual(
  a: MinionActivitySnapshot["agentStatus"] | undefined,
  b: MinionActivitySnapshot["agentStatus"] | undefined
): boolean {
  if (a === b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return a.emoji === b.emoji && a.message === b.message && (a.url ?? null) === (b.url ?? null);
}

function calculateOnChatBackoffMs(attempt: number): number {
  return Math.min(ON_CHAT_RETRY_BASE_MS * 2 ** attempt, ON_CHAT_RETRY_MAX_MS);
}

function getMaxHistorySequence(messages: LatticeMessage[]): number | undefined {
  let max: number | undefined;
  for (const message of messages) {
    const seq = message.metadata?.historySequence;
    if (typeof seq !== "number") {
      continue;
    }
    if (max === undefined || seq > max) {
      max = seq;
    }
  }
  return max;
}

/**
 * Detect costs-included usage entries.
 * `createDisplayUsage` sets `costsIncluded: true` when
 * `providerMetadata.lattice.costsIncluded` is true. These entries should
 * not be repriced when model mappings change because the provider
 * already handles billing.
 */
function isCostsIncludedEntry(
  usage: ChatUsageDisplay,
  runtimeModelId: string,
  providersConfig: ProvidersConfigMap
): boolean {
  if (usage.costsIncluded === true) {
    return true;
  }

  // Unknown-cost rows are not costs-included by definition; they indicate
  // missing pricing metadata and should be eligible for repricing when a
  // mapping is later configured.
  if (usage.hasUnknownCosts === true) {
    return false;
  }

  // Backward-compatibility: older session-usage.json entries may have been
  // billed with all costs explicitly zeroed before the costsIncluded
  // marker was persisted. Treat those all-zero entries as costs-included so
  // repricing doesn't inflate historical totals after upgrade.
  //
  // Guardrail: only apply this legacy heuristic for models that have non-zero
  // billable pricing in model stats. Use the resolved metadata model so mapped
  // custom IDs (e.g. ollama:custom -> anthropic:claude-*) are classified by the
  // effective pricing model, not the raw runtime string.
  const metadataModel = resolveModelForMetadata(runtimeModelId, providersConfig);
  const stats = getModelStats(metadataModel);
  const hasBillableRates =
    (stats?.input_cost_per_token ?? 0) > 0 ||
    (stats?.output_cost_per_token ?? 0) > 0 ||
    (stats?.cache_creation_input_token_cost ?? 0) > 0 ||
    (stats?.cache_read_input_token_cost ?? 0) > 0;
  if (!hasBillableRates) {
    return false;
  }

  const components = ["input", "cached", "cacheCreate", "output", "reasoning"] as const;
  let hasTokens = false;
  for (const key of components) {
    const component = usage[key];
    if (component.tokens > 0) {
      hasTokens = true;
    }
    if (component.cost_usd !== 0) {
      return false;
    }
  }

  return hasTokens;
}

/**
 * Recompute cost aggregates for a single session-usage entry so session totals
 * and last-request costs reflect the current model mapping.
 *
 * Skips non-model aggregate buckets (e.g. "historical" from legacy compaction
 * summaries) and costs-included entries (requests where cost_usd
 * was explicitly zeroed).
 */
function repriceSessionUsage(
  usage: z.infer<typeof SessionUsageFileSchema>,
  config: ProvidersConfigMap,
  providersConfigFingerprint: number
): void {
  if (usage.tokenStatsCache?.providersConfigVersion !== providersConfigFingerprint) {
    usage.tokenStatsCache = undefined;
  }
  for (const [model, entry] of Object.entries(usage.byModel)) {
    if (!model.includes(":") || isCostsIncludedEntry(entry, model, config)) continue;
    const resolved = resolveModelForMetadata(model, config);
    usage.byModel[model] = recomputeUsageCosts(entry, resolved);
  }
  if (
    usage.lastRequest &&
    !isCostsIncludedEntry(usage.lastRequest.usage, usage.lastRequest.model, config)
  ) {
    const resolved = resolveModelForMetadata(usage.lastRequest.model, config);
    usage.lastRequest.usage = recomputeUsageCosts(usage.lastRequest.usage, resolved);
  }
}

/**
 * External store for minion aggregators and streaming state.
 *
 * This store lives outside React's lifecycle and manages all minion
 * message aggregation and IPC subscriptions. Components subscribe to
 * specific minions via useSyncExternalStore, ensuring only relevant
 * components re-render when minion state changes.
 */
export class MinionStore {
  // Per-minion state (lazy computed on get)
  private states = new MapStore<string, MinionState>();

  // Derived aggregate state (computed from multiple minions)
  private derived = new MapStore<string, DerivedState>();

  // Usage and consumer stores (two-store approach for CostsTab optimization)
  private usageStore = new MapStore<string, MinionUsageState>();
  private client: RouterClient<AppRouter> | null = null;
  private clientChangeController = new AbortController();
  private providersConfig: ProvidersConfigMap | null = null;
  /** Stable fingerprint for cache freshness checks across reconnects/app restarts.
   * `null` until the first successful config fetch — prevents hydrating stale caches
   * and blocks tokenization until we know the real configuration. */
  private providersConfigFingerprint: number | null = null;
  /** Monotonic request counter for serializing provider config refreshes (latest wins). */
  private providersConfigVersion = 0;
  /** Version of the last successfully applied provider config (prevents stale overwrites). */
  private providersConfigAppliedVersion = 0;
  /** Consecutive provider-config subscription/refresh failures (used for exponential backoff). */
  private providersConfigFailureStreak = 0;
  // Minions that need a clean history replay once a new iterator is established.
  // We keep the existing UI visible until the replay can actually start.
  private pendingReplayReset = new Set<string>();
  // Last usage snapshot captured right before full replay clears the aggregator.
  // Used as a temporary fallback so context/cost indicators don't flash empty
  // during reconnect until replayed usage catches up.
  private preReplayUsageSnapshot = new Map<string, MinionUsageState>();
  private consumersStore = new MapStore<string, MinionConsumersState>();

  // Manager for consumer calculations (debouncing, caching, lazy loading)
  // Architecture: MinionStore orchestrates (decides when), manager executes (performs calculations)
  // Dual-cache: consumersStore (MapStore) handles subscriptions, manager owns data cache
  private readonly consumerManager: MinionConsumerManager;

  // Supporting data structures
  private aggregators = new Map<string, StreamingMessageAggregator>();
  // Active onChat subscription cleanup handlers (must stay size <= 1).
  private ipcUnsubscribers = new Map<string, () => void>();

  // Minion selected in the UI (set from MinionContext routing state).
  private activeMinionId: string | null = null;

  // Minion currently owning the live onChat subscription.
  private activeOnChatMinionId: string | null = null;

  // Lightweight activity snapshots from minion.activity.list/subscribe.
  private minionActivity = new Map<string, MinionActivitySnapshot>();
  // Recency timestamp observed when a minion transitions into streaming=true.
  // Used to distinguish true stream completion (recency bumps on stream-end) from
  // abort/error transitions (streaming=false without recency advance).
  private activityStreamingStartRecency = new Map<string, number>();
  private activityAbortController: AbortController | null = null;

  // Per-minion terminal activity aggregates (from terminal.activity.subscribe).
  private minionTerminalActivity = new Map<
    string,
    { activeCount: number; totalSessions: number }
  >();
  private terminalActivityAbortController: AbortController | null = null;

  // Per-minion ephemeral chat state (buffering, queued message, live bash output, etc.)
  private chatTransientState = new Map<string, MinionChatTransientState>();

  // Per-minion transcript pagination state for loading prior compaction epochs.
  private historyPagination = new Map<string, MinionHistoryPaginationState>();

  private minionMetadata = new Map<string, FrontendMinionMetadata>(); // Store metadata for name lookup

  // Minion timing stats snapshots (from minion.stats.subscribe)
  private statsEnabled = false;
  private minionStats = new Map<string, MinionStatsSnapshot>();
  private statsStore = new MapStore<string, MinionStatsSnapshot | null>();
  private statsUnsubscribers = new Map<string, () => void>();
  // Per-minion listener refcount for useMinionStatsSnapshot().
  // Used to only subscribe to backend stats when something in the UI is actually reading them.
  private statsListenerCounts = new Map<string, number>();
  // Cumulative session usage (from session-usage.json)

  private sessionUsage = new Map<string, z.infer<typeof SessionUsageFileSchema>>();
  private sessionUsageRequestVersion = new Map<string, number>();

  // Global callback for navigating to a minion (set by App, used for notification clicks)
  private navigateToMinionCallback: ((minionId: string) => void) | null = null;

  // Global callback when a response completes (for "notify on response" feature)
  // isFinal is true when no more active streams remain (assistant done with all work)
  // finalText is the text content after any tool calls (for notification body)
  // compaction is provided when this was a compaction stream (includes continue metadata)
  private responseCompleteCallback:
    | ((
        minionId: string,
        messageId: string,
        isFinal: boolean,
        finalText: string,
        compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
        completedAt?: number | null
      ) => void)
    | null = null;

  // Tracks when a file-modifying tool (file_edit_*, bash) last completed per minion.
  // ReviewPanel subscribes to trigger diff refresh. Two structures:
  // - timestamps: actual Date.now() values for cache invalidation checks
  // - subscriptions: MapStore for per-minion subscription support
  private fileModifyingToolMs = new Map<string, number>();
  private fileModifyingToolSubs = new MapStore<string, void>();

  // Idle callback handles for high-frequency delta events to reduce re-renders during streaming.
  // Data is always updated immediately in the aggregator; only UI notification is scheduled.
  // Using requestIdleCallback adapts to actual CPU availability rather than a fixed timer.
  private deltaIdleHandles = new Map<string, number>();

  /**
   * Map of event types to their handlers. This is the single source of truth for:
   * 1. Which events should be buffered during replay (the keys)
   * 2. How to process those events (the values)
   *
   * By keeping check and processing in one place, we make it structurally impossible
   * to buffer an event type without having a handler for it.
   */
  private readonly bufferedEventHandlers: Record<
    string,
    (
      minionId: string,
      aggregator: StreamingMessageAggregator,
      data: MinionChatMessage
    ) => void
  > = {
    "stream-start": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      if (this.onModelUsed) {
        this.onModelUsed((data as { model: string }).model);
      }

      // A new stream supersedes any prior retry banner state.
      const transient = this.assertChatTransientState(minionId);
      transient.autoRetryStatus = null;

      this.states.bump(minionId);
      // Bump usage store so liveUsage is recomputed with new activeStreamId
      this.usageStore.bump(minionId);
    },
    "stream-delta": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.scheduleIdleStateBump(minionId);
    },
    "stream-end": (minionId, aggregator, data) => {
      const streamEndData = data as StreamEndEvent;
      applyMinionChatEventToAggregator(aggregator, streamEndData);

      // Track stream completion telemetry
      this.trackStreamCompletedTelemetry(streamEndData, false);

      const transient = this.assertChatTransientState(minionId);
      transient.autoRetryStatus = null;

      // Update local session usage (mirrors backend's addUsage)
      const model = streamEndData.metadata?.model;
      const rawUsage = streamEndData.metadata?.usage;
      const providerMetadata = streamEndData.metadata?.providerMetadata;
      if (model && rawUsage) {
        const usage = createDisplayUsage(
          rawUsage,
          model,
          providerMetadata,
          this.resolveMetadataModel(model)
        );
        if (usage) {
          const normalizedModel = model;
          const current = this.sessionUsage.get(minionId) ?? {
            byModel: {},
            version: 1 as const,
          };
          const existing = current.byModel[normalizedModel];
          // CRITICAL: Accumulate, don't overwrite (same logic as backend)
          current.byModel[normalizedModel] = existing ? sumUsageHistory([existing, usage])! : usage;
          current.lastRequest = { model: normalizedModel, usage, timestamp: Date.now() };
          this.sessionUsage.set(minionId, current);
        }
      }

      // Flush any pending debounced bump before final bump to avoid double-bump
      this.cancelPendingIdleBump(minionId);
      this.states.bump(minionId);
      this.checkAndBumpRecencyIfChanged();
      this.finalizeUsageStats(minionId, streamEndData.metadata);
    },
    "stream-abort": (minionId, aggregator, data) => {
      const streamAbortData = data as StreamAbortEvent;
      applyMinionChatEventToAggregator(aggregator, streamAbortData);

      // Track stream interruption telemetry (get model from aggregator)
      const model = aggregator.getCurrentModel();
      if (model) {
        this.trackStreamCompletedTelemetry(
          {
            metadata: {
              model,
              usage: streamAbortData.metadata?.usage,
              duration: streamAbortData.metadata?.duration,
            },
          },
          true
        );
      }

      // Flush any pending debounced bump before final bump to avoid double-bump
      this.cancelPendingIdleBump(minionId);
      this.states.bump(minionId);
      this.finalizeUsageStats(minionId, streamAbortData.metadata);
    },
    "tool-call-start": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.states.bump(minionId);
    },
    "tool-call-delta": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.scheduleIdleStateBump(minionId);
    },
    "tool-call-end": (minionId, aggregator, data) => {
      const toolCallEnd = data as Extract<MinionChatMessage, { type: "tool-call-end" }>;

      // Cleanup live bash output once the real tool result contains output.
      // If output is missing (e.g. tmpfile overflow), keep the tail buffer so the UI still shows something.
      if (toolCallEnd.toolName === "bash") {
        const transient = this.chatTransientState.get(minionId);
        if (transient) {
          const output = (toolCallEnd.result as { output?: unknown } | undefined)?.output;
          if (typeof output === "string") {
            transient.liveBashOutput.delete(toolCallEnd.toolCallId);
          } else {
            // If we keep the tail buffer, ensure we don't get stuck in "filtering" UI state.
            const prev = transient.liveBashOutput.get(toolCallEnd.toolCallId);
            if (prev?.phase === "filtering") {
              const next = appendLiveBashOutputChunk(
                prev,
                { text: "", isError: false, phase: "output" },
                BASH_TRUNCATE_MAX_TOTAL_BYTES
              );
              if (next !== prev) {
                transient.liveBashOutput.set(toolCallEnd.toolCallId, next);
              }
            }
          }
        }
      }

      // Cleanup ephemeral taskId storage once the actual tool result is available.
      if (toolCallEnd.toolName === "task") {
        const transient = this.chatTransientState.get(minionId);
        transient?.liveTaskIds.delete(toolCallEnd.toolCallId);
      }
      applyMinionChatEventToAggregator(aggregator, data);

      this.states.bump(minionId);
      this.consumerManager.scheduleCalculation(minionId, aggregator);

      // Track file-modifying tools for ReviewPanel diff refresh.
      const shouldTriggerReviewPanelRefresh =
        toolCallEnd.toolName.startsWith("file_edit_") || toolCallEnd.toolName === "bash";

      if (shouldTriggerReviewPanelRefresh) {
        this.fileModifyingToolMs.set(minionId, Date.now());
        this.fileModifyingToolSubs.bump(minionId);
      }
    },
    "reasoning-delta": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.scheduleIdleStateBump(minionId);
    },
    "reasoning-end": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.states.bump(minionId);
    },
    "runtime-status": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.states.bump(minionId);
    },
    "auto-compaction-triggered": (minionId) => {
      // Informational event from backend auto-compaction monitor.
      // We bump minion state so warning/banner components can react immediately.
      this.states.bump(minionId);
    },
    "auto-compaction-completed": (minionId) => {
      // Compaction resets context usage; force both stores to recompute from compacted history.
      this.usageStore.bump(minionId);
      this.states.bump(minionId);
    },
    "auto-retry-scheduled": (minionId, _aggregator, data) => {
      const transient = this.assertChatTransientState(minionId);
      transient.autoRetryStatus = data as Extract<
        MinionChatMessage,
        { type: "auto-retry-scheduled" }
      >;
      this.states.bump(minionId);
    },
    "auto-retry-starting": (minionId, _aggregator, data) => {
      const transient = this.assertChatTransientState(minionId);
      transient.autoRetryStatus = data as Extract<
        MinionChatMessage,
        { type: "auto-retry-starting" }
      >;
      this.states.bump(minionId);
    },
    "auto-retry-abandoned": (minionId, _aggregator, data) => {
      const transient = this.assertChatTransientState(minionId);
      transient.autoRetryStatus = data as Extract<
        MinionChatMessage,
        { type: "auto-retry-abandoned" }
      >;
      this.states.bump(minionId);
    },
    "session-usage-delta": (minionId, _aggregator, data) => {
      const usageDelta = data as Extract<MinionChatMessage, { type: "session-usage-delta" }>;

      const current = this.sessionUsage.get(minionId) ?? {
        byModel: {},
        version: 1 as const,
      };

      for (const [model, usage] of Object.entries(usageDelta.byModelDelta)) {
        const existing = current.byModel[model];
        current.byModel[model] = existing ? sumUsageHistory([existing, usage])! : usage;
      }

      this.sessionUsage.set(minionId, current);
      this.usageStore.bump(minionId);
    },
    "usage-delta": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.usageStore.bump(minionId);
    },
    "init-start": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      this.states.bump(minionId);
    },
    "init-output": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      // Init output can be very high-frequency (e.g. installs, rsync). Like stream/tool deltas,
      // we update aggregator state immediately but coalesce UI bumps to keep the renderer responsive.
      this.scheduleIdleStateBump(minionId);
    },
    "init-end": (minionId, aggregator, data) => {
      applyMinionChatEventToAggregator(aggregator, data);
      // Avoid a double-bump if an init-output idle bump is pending.
      this.cancelPendingIdleBump(minionId);
      this.states.bump(minionId);
    },
    "queued-message-changed": (minionId, _aggregator, data) => {
      if (!isQueuedMessageChanged(data)) return;

      // Create QueuedMessage once here instead of on every render
      // Use displayText which handles slash commands (shows /compact instead of expanded prompt)
      // Show queued message if there's text OR attachments OR reviews (support review-only queued messages)
      const hasContent =
        data.queuedMessages.length > 0 ||
        (data.fileParts?.length ?? 0) > 0 ||
        (data.reviews?.length ?? 0) > 0;
      const queuedMessage: QueuedMessage | null = hasContent
        ? {
            id: `queued-${minionId}`,
            content: data.displayText,
            fileParts: data.fileParts,
            reviews: data.reviews,
            hasCompactionRequest: data.hasCompactionRequest,
          }
        : null;

      this.assertChatTransientState(minionId).queuedMessage = queuedMessage;
      this.states.bump(minionId);
    },
    "restore-to-input": (_minionId, _aggregator, data) => {
      if (!isRestoreToInput(data)) return;

      // Use UPDATE_CHAT_INPUT event with mode="replace"
      window.dispatchEvent(
        createCustomEvent(CUSTOM_EVENTS.UPDATE_CHAT_INPUT, {
          text: data.text,
          mode: "replace",
          fileParts: data.fileParts,
          reviews: data.reviews,
        })
      );
    },
  };

  // Cache of last known recency per minion (for change detection)
  private recencyCache = new Map<string, number | null>();

  // Store minion metadata for aggregator creation (ensures createdAt never lost)
  private minionCreatedAt = new Map<string, string>();

  // Track previous sidebar state per minion (to prevent unnecessary bumps)
  private previousSidebarValues = new Map<string, MinionSidebarState>();

  // Track model usage (optional integration point for model bookkeeping)
  private readonly onModelUsed?: (model: string) => void;

  constructor(onModelUsed?: (model: string) => void) {
    this.onModelUsed = onModelUsed;

    // Initialize consumer calculation manager
    this.consumerManager = new MinionConsumerManager(
      (minionId) => {
        this.consumersStore.bump(minionId);
      },
      () => this.providersConfigFingerprint
    );

    // Note: We DON'T auto-check recency on every state bump.
    // Instead, checkAndBumpRecencyIfChanged() is called explicitly after
    // message completion events (not on deltas) to prevent App.tsx re-renders.
  }

  private resolveMetadataModel(model: string): string {
    return resolveModelForMetadata(model, this.providersConfig);
  }

  private bumpAllUsageStoreEntries(): void {
    for (const minionId of this.aggregators.keys()) {
      this.usageStore.bump(minionId);
    }
  }

  /**
   * Fetch persisted session usage from backend and update in-memory cache.
   * Uses a per-minion request version guard so slower/older responses
   * cannot overwrite fresher state (e.g. rapid minion switches).
   */
  private refreshSessionUsage(minionId: string): void {
    const client = this.client;
    if (!client || !this.isMinionRegistered(minionId)) {
      return;
    }

    const requestVersion = (this.sessionUsageRequestVersion.get(minionId) ?? 0) + 1;
    this.sessionUsageRequestVersion.set(minionId, requestVersion);

    client.minion
      .getSessionUsage({ minionId })
      .then((data) => {
        if (!data) {
          return;
        }
        // Stale-response guard: a newer refresh was issued while this one was in-flight.
        if ((this.sessionUsageRequestVersion.get(minionId) ?? 0) !== requestVersion) {
          return;
        }
        // Minion may have been removed while the fetch was in-flight.
        if (!this.isMinionRegistered(minionId)) {
          return;
        }

        if (
          this.providersConfig &&
          this.providersConfigFingerprint != null &&
          data.tokenStatsCache?.providersConfigVersion !== this.providersConfigFingerprint
        ) {
          repriceSessionUsage(data, this.providersConfig, this.providersConfigFingerprint);
        }

        this.sessionUsage.set(minionId, data);
        this.usageStore.bump(minionId);
      })
      .catch((error) => {
        console.warn(`Failed to fetch session usage for ${minionId}:`, error);
      });
  }

  private async refreshProvidersConfig(client: RouterClient<AppRouter>): Promise<void> {
    // Version counter prevents an older, slower response from overwriting a newer one.
    // We bump eagerly so concurrent requests each get unique versions, then only apply
    // if no newer response has already been written (version >= lastApplied).
    const version = ++this.providersConfigVersion;
    try {
      const config = await client.providers.getConfig();
      if (
        this.client !== client ||
        this.clientChangeController.signal.aborted ||
        version < this.providersConfigAppliedVersion
      ) {
        return;
      }

      const previousFingerprint = this.providersConfigFingerprint;
      const nextFingerprint = computeProvidersConfigFingerprint(config);

      this.providersConfigAppliedVersion = version;
      this.providersConfigFailureStreak = 0;
      this.providersConfig = config;
      this.providersConfigFingerprint = nextFingerprint;

      if (previousFingerprint !== nextFingerprint) {
        // Invalidate consumer token stats — both in-memory and persisted —
        // so mapped-model changes take effect on next access.
        this.consumerManager.invalidateAll();

        for (const [, usage] of this.sessionUsage) {
          repriceSessionUsage(usage, config, nextFingerprint);
        }
      }

      // Bump usage-store subscribers AFTER repricing so observers see
      // updated cost totals. Must happen on every successful apply (not
      // just fingerprint changes) to unblock initial hydration.
      this.bumpAllUsageStoreEntries();
    } catch {
      // Existing providersConfig is preserved so metadata resolution
      // continues using the last successful snapshot. Retry with
      // exponential backoff to recover from transient errors — both
      // at startup (fingerprint still null, tokenization blocked) and
      // after onConfigChanged notifications where the fetch failed.
      if (this.client === client && !this.clientChangeController.signal.aborted) {
        this.providersConfigFailureStreak++;
        const retryDelay = Math.min(1000 * 2 ** (this.providersConfigFailureStreak - 1), 30_000);
        setTimeout(() => {
          if (this.client === client && !this.clientChangeController.signal.aborted) {
            void this.refreshProvidersConfig(client);
          }
        }, retryDelay);
      }
    }
  }

  private subscribeToProvidersConfig(client: RouterClient<AppRouter>): void {
    const { signal } = this.clientChangeController;

    (async () => {
      // Some oRPC iterators don't eagerly close on abort alone.
      // Ensure we `return()` them so backend subscriptions clean up EventEmitter listeners.
      let iterator: AsyncIterator<unknown> | null = null;

      try {
        const subscribedIterator = await client.providers.onConfigChanged(undefined, { signal });

        if (signal.aborted || this.client !== client) {
          void subscribedIterator.return?.();
          return;
        }

        iterator = subscribedIterator;

        for await (const _ of subscribedIterator) {
          if (signal.aborted || this.client !== client) {
            break;
          }

          this.providersConfigFailureStreak = 0;
          void this.refreshProvidersConfig(client);
        }
      } catch {
        // Subscription stream failed — fall through to retry below.
      } finally {
        void iterator?.return?.();
      }

      // Stream ended or errored. Re-subscribe after a delay unless the
      // client changed or the controller was aborted (intentional teardown).
      if (!signal.aborted && this.client === client) {
        this.providersConfigFailureStreak++;
        const resubDelay = Math.min(1000 * 2 ** (this.providersConfigFailureStreak - 1), 30_000);
        setTimeout(() => {
          if (!signal.aborted && this.client === client) {
            this.subscribeToProvidersConfig(client);
          }
        }, resubDelay);
      }
    })();
  }

  setStatsEnabled(enabled: boolean): void {
    if (this.statsEnabled === enabled) {
      return;
    }

    this.statsEnabled = enabled;

    if (!enabled) {
      for (const unsubscribe of this.statsUnsubscribers.values()) {
        unsubscribe();
      }
      this.statsUnsubscribers.clear();
      this.minionStats.clear();
      this.statsStore.clear();

      // Clear is a global notification only. Bump any subscribed minion IDs so
      // useSyncExternalStore subscribers re-render and drop stale snapshots.
      for (const minionId of this.statsListenerCounts.keys()) {
        this.statsStore.bump(minionId);
      }
      return;
    }

    // Enable subscriptions for any minions that already have UI consumers.
    for (const minionId of this.statsListenerCounts.keys()) {
      this.subscribeToStats(minionId);
    }
  }
  setClient(client: RouterClient<AppRouter> | null): void {
    if (this.client === client) {
      return;
    }

    // Drop stats subscriptions before swapping clients so reconnects resubscribe cleanly.
    for (const unsubscribe of this.statsUnsubscribers.values()) {
      unsubscribe();
    }
    this.statsUnsubscribers.clear();

    this.client = client;
    this.clientChangeController.abort();
    this.clientChangeController = new AbortController();

    this.bumpAllUsageStoreEntries();

    for (const minionId of this.minionMetadata.keys()) {
      this.pendingReplayReset.add(minionId);
    }

    if (client) {
      this.ensureActivitySubscription();
      this.ensureTerminalActivitySubscription();
    }

    if (!client) {
      return;
    }

    // If timing stats are enabled, re-subscribe any minions that already have UI consumers.
    if (this.statsEnabled) {
      for (const minionId of this.statsListenerCounts.keys()) {
        this.subscribeToStats(minionId);
      }
    }

    this.ensureActiveOnChatSubscription();
    void this.refreshProvidersConfig(client);
    this.subscribeToProvidersConfig(client);
  }

  setActiveMinionId(minionId: string | null): void {
    assert(
      minionId === null || (typeof minionId === "string" && minionId.length > 0),
      "setActiveMinionId requires a non-empty minionId or null"
    );

    if (this.activeMinionId === minionId) {
      return;
    }

    const previousActiveId = this.activeMinionId;
    this.activeMinionId = minionId;
    this.ensureActiveOnChatSubscription();

    // Re-hydrate persisted session usage so cost totals reflect any
    // session-usage-delta events that arrived while this minion was inactive.
    if (minionId) {
      this.refreshSessionUsage(minionId);
    }

    // Invalidate cached minion state for both the old and new active
    // minions. getMinionState() uses activeOnChatMinionId to decide
    // whether to trust aggregator data or activity snapshots, so a switch
    // requires recomputation even if no new events arrived.
    if (previousActiveId) {
      this.states.bump(previousActiveId);
    }
    if (minionId) {
      this.states.bump(minionId);
    }
  }

  isOnChatSubscriptionActive(minionId: string): boolean {
    assert(
      typeof minionId === "string" && minionId.length > 0,
      "isOnChatSubscriptionActive requires a non-empty minionId"
    );

    return this.activeOnChatMinionId === minionId;
  }

  private ensureActivitySubscription(): void {
    if (this.activityAbortController) {
      return;
    }

    const controller = new AbortController();
    this.activityAbortController = controller;
    void this.runActivitySubscription(controller.signal);
  }

  private ensureTerminalActivitySubscription(): void {
    if (this.terminalActivityAbortController) {
      return;
    }

    const controller = new AbortController();
    this.terminalActivityAbortController = controller;
    void this.runTerminalActivitySubscription(controller);
  }

  private releaseTerminalActivityController(controller: AbortController): void {
    if (this.terminalActivityAbortController === controller) {
      this.terminalActivityAbortController = null;
    }
  }

  private assertSingleActiveOnChatSubscription(): void {
    assert(
      this.ipcUnsubscribers.size <= 1,
      `[MinionStore] Expected at most one active onChat subscription, found ${this.ipcUnsubscribers.size}`
    );

    if (this.activeOnChatMinionId === null) {
      assert(
        this.ipcUnsubscribers.size === 0,
        "[MinionStore] onChat unsubscribe map must be empty when no active minion is subscribed"
      );
      return;
    }

    assert(
      this.ipcUnsubscribers.has(this.activeOnChatMinionId),
      `[MinionStore] Missing onChat unsubscribe handler for ${this.activeOnChatMinionId}`
    );
  }

  private clearReplayBuffers(minionId: string): void {
    const transient = this.chatTransientState.get(minionId);
    if (!transient) {
      return;
    }

    // Replay buffers are only valid for the in-flight subscription attempt that
    // populated them. Clear eagerly when deactivating/retrying so stale buffered
    // events cannot leak into a later caught-up cycle.
    transient.caughtUp = false;
    transient.replayingHistory = false;
    transient.historicalMessages.length = 0;
    transient.pendingStreamEvents.length = 0;
  }

  private ensureActiveOnChatSubscription(): void {
    const targetMinionId =
      this.activeMinionId && this.isMinionRegistered(this.activeMinionId)
        ? this.activeMinionId
        : null;

    if (this.activeOnChatMinionId === targetMinionId) {
      this.assertSingleActiveOnChatSubscription();
      return;
    }

    if (this.activeOnChatMinionId) {
      const previousActiveMinionId = this.activeOnChatMinionId;
      const previousTransient = this.chatTransientState.get(previousActiveMinionId);
      if (previousTransient) {
        previousTransient.isHydratingTranscript = false;
      }

      // Clear replay buffers before aborting so a fast minion switch/reopen
      // cannot replay stale buffered rows from the previous subscription attempt.
      this.clearReplayBuffers(previousActiveMinionId);

      const unsubscribe = this.ipcUnsubscribers.get(previousActiveMinionId);
      if (unsubscribe) {
        unsubscribe();
      }
      this.ipcUnsubscribers.delete(previousActiveMinionId);
      this.activeOnChatMinionId = null;
    }

    if (targetMinionId) {
      const transient = this.chatTransientState.get(targetMinionId);
      if (transient) {
        transient.caughtUp = false;
        // Only show transcript hydration once we can actually establish onChat.
        // When the ORPC client is unavailable, avoid pinning the pane in loading.
        transient.isHydratingTranscript = this.client !== null;
      }

      const controller = new AbortController();
      this.ipcUnsubscribers.set(targetMinionId, () => controller.abort());
      this.activeOnChatMinionId = targetMinionId;
      void this.runOnChatSubscription(targetMinionId, controller.signal);
    }

    this.assertSingleActiveOnChatSubscription();
  }

  /**
   * Set the callback for navigating to a minion (used for notification clicks)
   */
  setNavigateToMinion(callback: (minionId: string) => void): void {
    this.navigateToMinionCallback = callback;
    // Update existing aggregators with the callback
    for (const aggregator of this.aggregators.values()) {
      aggregator.onNavigateToMinion = callback;
    }
  }

  navigateToMinion(minionId: string): void {
    this.navigateToMinionCallback?.(minionId);
  }

  /**
   * Set the callback for when a response completes (used for "notify on response" feature).
   * isFinal is true when no more active streams remain (assistant done with all work).
   * finalText is the text content after any tool calls (for notification body).
   * compaction is provided when this was a compaction stream (includes continue metadata).
   */
  setOnResponseComplete(
    callback: (
      minionId: string,
      messageId: string,
      isFinal: boolean,
      finalText: string,
      compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
      completedAt?: number | null
    ) => void
  ): void {
    this.responseCompleteCallback = callback;
    // Update existing aggregators with the callback
    for (const aggregator of this.aggregators.values()) {
      this.bindAggregatorResponseCompleteCallback(aggregator);
    }
  }

  private maybeMarkCompactionContinueFromQueuedFollowUp(
    minionId: string,
    compaction: { hasContinueMessage: boolean; isIdle?: boolean } | undefined,
    includeQueuedFollowUpSignal: boolean
  ): { hasContinueMessage: boolean; isIdle?: boolean } | undefined {
    if (!compaction || compaction.hasContinueMessage || !includeQueuedFollowUpSignal) {
      return compaction;
    }

    const queuedMessage = this.chatTransientState.get(minionId)?.queuedMessage;
    if (!queuedMessage) {
      return compaction;
    }

    // A queued message will be auto-sent after stream-end. Suppress the intermediate
    // "Compaction complete" notification and only notify for the follow-up response.
    return {
      ...compaction,
      hasContinueMessage: true,
    };
  }

  private emitResponseComplete(
    minionId: string,
    messageId: string,
    isFinal: boolean,
    finalText: string,
    compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
    completedAt?: number | null,
    includeQueuedFollowUpSignal = true
  ): void {
    if (!this.responseCompleteCallback) {
      return;
    }

    this.responseCompleteCallback(
      minionId,
      messageId,
      isFinal,
      finalText,
      this.maybeMarkCompactionContinueFromQueuedFollowUp(
        minionId,
        compaction,
        includeQueuedFollowUpSignal
      ),
      completedAt
    );
  }

  private bindAggregatorResponseCompleteCallback(aggregator: StreamingMessageAggregator): void {
    aggregator.onResponseComplete = (
      minionId: string,
      messageId: string,
      isFinal: boolean,
      finalText: string,
      compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
      completedAt?: number | null
    ) => {
      this.emitResponseComplete(
        minionId,
        messageId,
        isFinal,
        finalText,
        compaction,
        completedAt
      );
    };
  }

  /**
   * Schedule a state bump during browser idle time.
   * Instead of updating UI on every delta, wait until the browser has spare capacity.
   * This adapts to actual CPU availability - fast machines update more frequently,
   * slow machines naturally throttle without dropping data.
   *
   * Data is always updated immediately in the aggregator - only UI notification is deferred.
   *
   * NOTE: This is the "ingestion clock" half of the two-clock streaming model.
   * The "presentation clock" (useSmoothStreamingText) handles visual cadence
   * independently — do not collapse them into a single mechanism.
   */
  private scheduleIdleStateBump(minionId: string): void {
    // Skip if already scheduled
    if (this.deltaIdleHandles.has(minionId)) {
      return;
    }

    // requestIdleCallback is not available in some environments (e.g. Node-based unit tests).
    // Fall back to a regular timeout so we still throttle bumps.
    if (typeof requestIdleCallback !== "function") {
      const handle = setTimeout(() => {
        this.deltaIdleHandles.delete(minionId);
        this.states.bump(minionId);
      }, 0);

      this.deltaIdleHandles.set(minionId, handle as unknown as number);
      return;
    }

    const handle = requestIdleCallback(
      () => {
        this.deltaIdleHandles.delete(minionId);
        this.states.bump(minionId);
      },
      { timeout: 100 } // Force update within 100ms even if browser stays busy
    );

    this.deltaIdleHandles.set(minionId, handle);
  }

  /**
   * Subscribe to backend timing stats snapshots for a minion.
   */

  private subscribeToStats(minionId: string): void {
    if (!this.client || !this.statsEnabled) {
      return;
    }

    // Only subscribe for registered minions when we have at least one UI consumer.
    if (!this.isMinionRegistered(minionId)) {
      return;
    }
    if ((this.statsListenerCounts.get(minionId) ?? 0) <= 0) {
      return;
    }

    // Skip if already subscribed
    if (this.statsUnsubscribers.has(minionId)) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    let iterator: AsyncIterator<MinionStatsSnapshot> | null = null;

    (async () => {
      try {
        const subscribedIterator = await this.client!.minion.stats.subscribe(
          { minionId },
          { signal }
        );
        iterator = subscribedIterator;

        for await (const snapshot of subscribedIterator) {
          if (signal.aborted) break;
          queueMicrotask(() => {
            if (signal.aborted) {
              return;
            }
            this.minionStats.set(minionId, snapshot);
            this.statsStore.bump(minionId);
          });
        }
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        console.warn(`[MinionStore] Error in stats subscription for ${minionId}:`, error);
      }
    })();

    this.statsUnsubscribers.set(minionId, () => {
      controller.abort();
      void iterator?.return?.();
    });
  }

  /**
   * Cancel any pending idle state bump for a minion.
   * Used when immediate state visibility is needed (e.g., stream-end).
   * Just cancels the callback - the caller will bump() immediately after.
   */
  private cancelPendingIdleBump(minionId: string): void {
    const handle = this.deltaIdleHandles.get(minionId);
    if (handle) {
      if (typeof cancelIdleCallback === "function") {
        cancelIdleCallback(handle);
      } else {
        clearTimeout(handle as unknown as number);
      }
      this.deltaIdleHandles.delete(minionId);
    }
  }

  /**
   * Track stream completion telemetry
   */
  private trackStreamCompletedTelemetry(
    data: {
      metadata: {
        model: string;
        usage?: { outputTokens?: number };
        duration?: number;
      };
    },
    wasInterrupted: boolean
  ): void {
    const { metadata } = data;
    const durationSecs = metadata.duration ? metadata.duration / 1000 : 0;
    const outputTokens = metadata.usage?.outputTokens ?? 0;

    // trackStreamCompleted handles rounding internally
    trackStreamCompleted(metadata.model, wasInterrupted, durationSecs, outputTokens);
  }

  /**
   * Check if any minion's recency changed and bump global recency if so.
   * Uses cached recency values from aggregators for O(1) comparison per minion.
   */
  private checkAndBumpRecencyIfChanged(): void {
    let recencyChanged = false;

    for (const minionId of this.aggregators.keys()) {
      const aggregator = this.aggregators.get(minionId)!;
      const currentRecency = aggregator.getRecencyTimestamp();
      const cachedRecency = this.recencyCache.get(minionId);

      if (currentRecency !== cachedRecency) {
        this.recencyCache.set(minionId, currentRecency);
        recencyChanged = true;
      }
    }

    if (recencyChanged) {
      this.derived.bump("recency");
    }
  }

  private cleanupStaleLiveBashOutput(
    minionId: string,
    aggregator: StreamingMessageAggregator
  ): void {
    const perMinion = this.chatTransientState.get(minionId)?.liveBashOutput;
    if (!perMinion || perMinion.size === 0) return;

    const activeToolCallIds = new Set<string>();
    for (const msg of aggregator.getDisplayedMessages()) {
      if (msg.type === "tool" && msg.toolName === "bash") {
        activeToolCallIds.add(msg.toolCallId);
      }
    }

    for (const toolCallId of Array.from(perMinion.keys())) {
      if (!activeToolCallIds.has(toolCallId)) {
        perMinion.delete(toolCallId);
      }
    }
  }

  /**
   * Subscribe to store changes (any minion).
   * Delegates to MapStore's subscribeAny.
   */
  subscribe = this.states.subscribeAny;

  /**
   * Subscribe to derived state changes (recency, etc.).
   * Use for hooks that depend on derived.bump() rather than states.bump().
   */
  subscribeDerived = this.derived.subscribeAny;

  /**
   * Subscribe to changes for a specific minion.
   * Only notified when this minion's state changes.
   */
  subscribeKey = (minionId: string, listener: () => void) => {
    return this.states.subscribeKey(minionId, listener);
  };

  getBashToolLiveOutput(minionId: string, toolCallId: string): LiveBashOutputView | null {
    const state = this.chatTransientState.get(minionId)?.liveBashOutput.get(toolCallId);

    // Important: return the stored object reference so useSyncExternalStore sees a stable snapshot.
    // (Returning a fresh object every call can trigger an infinite re-render loop.)
    return state ?? null;
  }

  getTaskToolLiveTaskId(minionId: string, toolCallId: string): string | null {
    const taskId = this.chatTransientState.get(minionId)?.liveTaskIds.get(toolCallId);
    return taskId ?? null;
  }

  /**
   * Assert that minion exists and return its aggregator.
   * Centralized assertion for all minion access methods.
   */
  private assertGet(minionId: string): StreamingMessageAggregator {
    const aggregator = this.aggregators.get(minionId);
    assert(aggregator, `Minion ${minionId} not found - must call addMinion() first`);
    return aggregator;
  }

  private assertChatTransientState(minionId: string): MinionChatTransientState {
    const state = this.chatTransientState.get(minionId);
    assert(state, `Minion ${minionId} not found - must call addMinion() first`);
    return state;
  }

  private deriveHistoryPaginationState(
    aggregator: StreamingMessageAggregator,
    hasOlderOverride?: boolean
  ): MinionHistoryPaginationState {
    for (const message of aggregator.getAllMessages()) {
      const historySequence = message.metadata?.historySequence;
      if (
        typeof historySequence !== "number" ||
        !Number.isInteger(historySequence) ||
        historySequence < 0
      ) {
        continue;
      }

      // The server's caught-up payload is authoritative for full replays because
      // display-only messages can skip early historySequence rows. When legacy
      // payloads omit hasOlderHistory, only infer older pages when the oldest
      // loaded message is a durable compaction boundary marker (a concrete signal
      // that this replay started mid-history), not merely historySequence > 0.
      const hasOlder =
        hasOlderOverride ?? (historySequence > 0 && isDurableCompactionBoundaryMarker(message));
      return {
        nextCursor: hasOlder
          ? {
              beforeHistorySequence: historySequence,
              beforeMessageId: message.id,
            }
          : null,
        hasOlder,
        loading: false,
      };
    }

    if (hasOlderOverride !== undefined) {
      return {
        nextCursor: null,
        hasOlder: hasOlderOverride,
        loading: false,
      };
    }

    return createInitialHistoryPaginationState();
  }

  /**
   * Get state for a specific minion.
   * Lazy computation - only runs when version changes.
   *
   * REQUIRES: Minion must have been added via addMinion() first.
   */
  getMinionState(minionId: string): MinionState {
    return this.states.get(minionId, () => {
      const aggregator = this.assertGet(minionId);

      const hasMessages = aggregator.hasMessages();
      const transient = this.assertChatTransientState(minionId);
      const historyPagination =
        this.historyPagination.get(minionId) ?? createInitialHistoryPaginationState();
      const activeStreams = aggregator.getActiveStreams();
      const activity = this.minionActivity.get(minionId);
      const isActiveMinion = this.activeOnChatMinionId === minionId;
      const messages = aggregator.getAllMessages();
      const metadata = this.minionMetadata.get(minionId);
      const pendingStreamStartTime = aggregator.getPendingStreamStartTime();
      // Trust the live aggregator only when it is both active AND has finished
      // replaying historical events (caughtUp). During the replay window after a
      // minion switch, the aggregator is cleared and re-hydrating; fall back to
      // the activity snapshot so the UI continues to reflect the last known state
      // (e.g., canInterrupt stays true for a minion that is still streaming).
      //
      // For non-active minions, the aggregator's activeStreams may be stale since
      // they don't receive stream-end events when unsubscribed from onChat. Prefer the
      // activity snapshot's streaming state, which is updated via the lightweight activity
      // subscription for all minions.
      const useAggregatorState = isActiveMinion && transient.caughtUp;
      const canInterrupt = useAggregatorState
        ? activeStreams.length > 0
        : (activity?.streaming ?? activeStreams.length > 0);
      const currentModel = useAggregatorState
        ? (aggregator.getCurrentModel() ?? null)
        : (activity?.lastModel ?? aggregator.getCurrentModel() ?? null);
      const currentThinkingLevel = useAggregatorState
        ? (aggregator.getCurrentThinkingLevel() ?? null)
        : (activity?.lastThinkingLevel ?? aggregator.getCurrentThinkingLevel() ?? null);
      const aggregatorRecency = aggregator.getRecencyTimestamp();
      const recencyTimestamp =
        aggregatorRecency === null
          ? (activity?.recency ?? null)
          : Math.max(aggregatorRecency, activity?.recency ?? aggregatorRecency);
      const isStreamStarting = pendingStreamStartTime !== null && !canInterrupt;
      const isHydratingTranscript =
        isActiveMinion && transient.isHydratingTranscript && !transient.caughtUp;
      const agentStatus = useAggregatorState
        ? aggregator.getAgentStatus()
        : activity
          ? (activity.agentStatus ?? undefined)
          : aggregator.getAgentStatus();

      // Live streaming stats
      const activeStreamMessageId = aggregator.getActiveStreamMessageId();
      const streamingTokenCount = activeStreamMessageId
        ? aggregator.getStreamingTokenCount(activeStreamMessageId)
        : undefined;
      const streamingTPS = activeStreamMessageId
        ? aggregator.getStreamingTPS(activeStreamMessageId)
        : undefined;

      return {
        name: metadata?.name ?? minionId, // Fall back to ID if metadata missing
        messages: aggregator.getDisplayedMessages(),
        queuedMessage: transient.queuedMessage,
        canInterrupt,
        isCompacting: aggregator.isCompacting(),
        isStreamStarting,
        awaitingUserQuestion: aggregator.hasAwaitingUserQuestion(),
        loading: !hasMessages && !transient.caughtUp,
        isHydratingTranscript,
        hasOlderHistory: historyPagination.hasOlder,
        loadingOlderHistory: historyPagination.loading,
        latticeMessages: messages,
        currentModel,
        currentThinkingLevel,
        recencyTimestamp,
        todos: aggregator.getCurrentTodos(),
        loadedSkills: aggregator.getLoadedSkills(),
        skillLoadErrors: aggregator.getSkillLoadErrors(),
        lastAbortReason: aggregator.getLastAbortReason(),
        agentStatus,
        pendingStreamStartTime,
        pendingStreamModel: aggregator.getPendingStreamModel(),
        autoRetryStatus: transient.autoRetryStatus,
        runtimeStatus: aggregator.getRuntimeStatus(),
        streamingTokenCount,
        streamingTPS,
      };
    });
  }

  // Cache sidebar state objects to return stable references
  private sidebarStateCache = new Map<string, MinionSidebarState>();
  // Map from minionId -> the MinionState reference used to compute sidebarStateCache.
  // React's useSyncExternalStore may call getSnapshot() multiple times per render; this
  // ensures getMinionSidebarState() returns a referentially stable snapshot for a given
  // MapStore version even when timingStats would otherwise change via Date.now().
  private sidebarStateSourceState = new Map<string, MinionState>();

  /**
   * Get sidebar state for a minion (subset of full state).
   * Returns cached reference if values haven't changed.
   * This is critical for useSyncExternalStore - must return stable references.
   */
  getMinionSidebarState(minionId: string): MinionSidebarState {
    const fullState = this.getMinionState(minionId);
    const isStarting = fullState.pendingStreamStartTime !== null && !fullState.canInterrupt;
    const terminalActivity = this.minionTerminalActivity.get(minionId);
    const terminalActiveCount = terminalActivity?.activeCount ?? 0;
    const terminalSessionCount = terminalActivity?.totalSessions ?? 0;

    const cached = this.sidebarStateCache.get(minionId);
    if (cached && this.sidebarStateSourceState.get(minionId) === fullState) {
      return cached;
    }

    // Return cached if values match.
    // Note: timingStats/sessionStats are intentionally excluded - they change on every
    // streaming token and sidebar items don't use them. Components needing timing should
    // use useMinionStatsSnapshot() which has its own subscription.
    if (
      cached?.canInterrupt === fullState.canInterrupt &&
      cached.isStarting === isStarting &&
      cached.awaitingUserQuestion === fullState.awaitingUserQuestion &&
      cached.currentModel === fullState.currentModel &&
      cached.recencyTimestamp === fullState.recencyTimestamp &&
      cached.loadedSkills === fullState.loadedSkills &&
      cached.skillLoadErrors === fullState.skillLoadErrors &&
      cached.agentStatus === fullState.agentStatus &&
      cached.terminalActiveCount === terminalActiveCount &&
      cached.terminalSessionCount === terminalSessionCount
    ) {
      // Even if we re-use the cached object, mark it as derived from the current
      // MinionState so repeated getSnapshot() reads during this render are stable.
      this.sidebarStateSourceState.set(minionId, fullState);
      return cached;
    }

    // Create and cache new state
    const newState: MinionSidebarState = {
      canInterrupt: fullState.canInterrupt,
      isStarting,
      awaitingUserQuestion: fullState.awaitingUserQuestion,
      currentModel: fullState.currentModel,
      recencyTimestamp: fullState.recencyTimestamp,
      loadedSkills: fullState.loadedSkills,
      skillLoadErrors: fullState.skillLoadErrors,
      agentStatus: fullState.agentStatus,
      terminalActiveCount,
      terminalSessionCount,
    };
    this.sidebarStateCache.set(minionId, newState);
    this.sidebarStateSourceState.set(minionId, fullState);
    return newState;
  }

  /**
   * Clear timing stats for a minion.
   *
   * - Clears backend-persisted timing file (session-timing.json) when available.
   * - Clears in-memory timing derived from StreamingMessageAggregator.
   */
  clearTimingStats(minionId: string): void {
    if (this.client && this.statsEnabled) {
      this.client.minion.stats
        .clear({ minionId })
        .then((result) => {
          if (!result.success) {
            console.warn(`Failed to clear timing stats for ${minionId}:`, result.error);
            return;
          }

          this.minionStats.delete(minionId);
          this.statsStore.bump(minionId);
        })
        .catch((error) => {
          console.warn(`Failed to clear timing stats for ${minionId}:`, error);
        });
    }

    const aggregator = this.aggregators.get(minionId);
    if (aggregator) {
      aggregator.clearSessionTimingStats();
      this.states.bump(minionId);
    }
  }

  /**
   * Get all minion states as a Map.
   * Returns a new Map on each call - not cached/reactive.
   * Used by imperative code, not for React subscriptions.
   */
  getAllStates(): Map<string, MinionState> {
    const allStates = new Map<string, MinionState>();
    for (const minionId of this.aggregators.keys()) {
      allStates.set(minionId, this.getMinionState(minionId));
    }
    return allStates;
  }

  /**
   * Get recency timestamps for all minions (for sorting in command palette).
   * Derived on-demand from individual minion states.
   */
  getMinionRecency(): Record<string, number> {
    return this.derived.get("recency", () => {
      const timestamps: Record<string, number> = {};
      for (const minionId of this.aggregators.keys()) {
        const state = this.getMinionState(minionId);
        if (state.recencyTimestamp !== null) {
          timestamps[minionId] = state.recencyTimestamp;
        }
      }
      return timestamps;
    }) as Record<string, number>;
  }

  /**
   * Get aggregator for a minion (used by components that need direct access).
   * Returns undefined if minion does not exist.
   */
  getAggregator(minionId: string): StreamingMessageAggregator | undefined {
    return this.aggregators.get(minionId);
  }

  /**
   * Clear stored abort reason so manual retries can re-enable auto-retry.
   */
  clearLastAbortReason(minionId: string): void {
    const aggregator = this.aggregators.get(minionId);
    if (!aggregator) {
      return;
    }
    aggregator.clearLastAbortReason();
    this.states.bump(minionId);
  }

  async loadOlderHistory(minionId: string): Promise<void> {
    assert(
      typeof minionId === "string" && minionId.length > 0,
      "loadOlderHistory requires a non-empty minionId"
    );

    const client = this.client;
    if (!client) {
      console.warn(`[MinionStore] Cannot load older history for ${minionId}: no ORPC client`);
      return;
    }

    const paginationState = this.historyPagination.get(minionId);
    if (!paginationState) {
      console.warn(
        `[MinionStore] Cannot load older history for ${minionId}: pagination state is not initialized`
      );
      return;
    }

    if (!paginationState.hasOlder || paginationState.loading) {
      return;
    }

    if (!this.aggregators.has(minionId)) {
      console.warn(
        `[MinionStore] Cannot load older history for ${minionId}: minion is not registered`
      );
      return;
    }

    const requestedCursor = paginationState.nextCursor
      ? {
          beforeHistorySequence: paginationState.nextCursor.beforeHistorySequence,
          beforeMessageId: paginationState.nextCursor.beforeMessageId,
        }
      : null;

    this.historyPagination.set(minionId, {
      nextCursor: requestedCursor,
      hasOlder: paginationState.hasOlder,
      loading: true,
    });
    this.states.bump(minionId);

    try {
      const result = await client.minion.history.loadMore({
        minionId,
        cursor: requestedCursor,
      });

      const aggregator = this.aggregators.get(minionId);
      const latestPagination = this.historyPagination.get(minionId);
      if (
        !aggregator ||
        !latestPagination ||
        !latestPagination.loading ||
        !areHistoryPaginationCursorsEqual(latestPagination.nextCursor, requestedCursor)
      ) {
        return;
      }

      if (result.hasOlder) {
        assert(
          result.nextCursor,
          `[MinionStore] loadMore for ${minionId} returned hasOlder=true without nextCursor`
        );
      }

      const historicalMessages = result.messages.filter(isLatticeMessage);
      const ignoredCount = result.messages.length - historicalMessages.length;
      if (ignoredCount > 0) {
        console.warn(
          `[MinionStore] Ignoring ${ignoredCount} non-message history rows for ${minionId}`
        );
      }

      if (historicalMessages.length > 0) {
        aggregator.loadHistoricalMessages(historicalMessages, false, {
          mode: "append",
          skipDerivedState: true,
        });
        this.consumerManager.scheduleCalculation(minionId, aggregator);
      }

      this.historyPagination.set(minionId, {
        nextCursor: result.nextCursor,
        hasOlder: result.hasOlder,
        loading: false,
      });
    } catch (error) {
      console.error(`[MinionStore] Failed to load older history for ${minionId}:`, error);

      const latestPagination = this.historyPagination.get(minionId);
      if (latestPagination) {
        this.historyPagination.set(minionId, {
          ...latestPagination,
          loading: false,
        });
      }
    } finally {
      if (this.isMinionRegistered(minionId)) {
        this.states.bump(minionId);
      }
    }
  }

  /**
   * Mark the current active stream as "interrupting" (transient state).
   * Call this before invoking interruptStream so the UI shows "interrupting..."
   * immediately, avoiding a visual flash when the backend confirmation arrives.
   */
  setInterrupting(minionId: string): void {
    const aggregator = this.aggregators.get(minionId);
    if (aggregator) {
      aggregator.setInterrupting();
      this.states.bump(minionId);
    }
  }

  getMinionStatsSnapshot(minionId: string): MinionStatsSnapshot | null {
    return this.statsStore.get(minionId, () => {
      return this.minionStats.get(minionId) ?? null;
    });
  }

  /**
   * Bump state for a minion to trigger React re-renders.
   * Used by addEphemeralMessage for frontend-only messages.
   */
  bumpState(minionId: string): void {
    this.states.bump(minionId);
  }

  /**
   * Get current TODO list for a minion.
   * Returns empty array if minion doesn't exist or has no TODOs.
   */
  getTodos(minionId: string): TodoItem[] {
    const aggregator = this.aggregators.get(minionId);
    return aggregator ? aggregator.getCurrentTodos() : [];
  }

  /**
   * Extract usage from session-usage.json (no tokenization or message iteration).
   *
   * Returns empty state if minion doesn't exist (e.g., creation mode).
   */
  getMinionUsage(minionId: string): MinionUsageState {
    return this.usageStore.get(minionId, () => {
      const aggregator = this.aggregators.get(minionId);
      if (!aggregator) {
        return { totalTokens: 0 };
      }

      const model = aggregator.getCurrentModel();
      const sessionData = this.sessionUsage.get(minionId);

      // Session total: sum all models from persisted data
      const sessionTotal =
        sessionData && Object.keys(sessionData.byModel).length > 0
          ? sumUsageHistory(Object.values(sessionData.byModel))
          : undefined;

      // Last request from persisted data
      const lastRequest = sessionData?.lastRequest;

      // Calculate total tokens from session total
      const totalTokens = sessionTotal
        ? sessionTotal.input.tokens +
          sessionTotal.cached.tokens +
          sessionTotal.cacheCreate.tokens +
          sessionTotal.output.tokens +
          sessionTotal.reasoning.tokens
        : 0;

      const messages = aggregator.getAllMessages();
      if (messages.length === 0) {
        const snapshot = this.preReplayUsageSnapshot.get(minionId);
        if (snapshot) {
          return snapshot;
        }
      }

      // Get last message's context usage — only search within the current
      // compaction epoch. Pre-boundary messages carry stale contextUsage from
      // before compaction; including them inflates the usage indicator and
      // triggers premature auto-compaction.
      const lastContextUsage = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (isDurableCompactionBoundaryMarker(msg)) {
            // Idle/manual compaction boundary messages can include a post-compaction
            // context estimate. Read it before breaking so context usage does not
            // disappear when switching back to a compacted minion.
            const rawUsage = msg.metadata?.contextUsage;
            if (rawUsage && msg.role === "assistant") {
              const msgModel = msg.metadata?.model ?? model ?? "unknown";
              return createDisplayUsage(rawUsage, msgModel, undefined);
            }
            break;
          }
          if (msg.role === "assistant") {
            if (msg.metadata?.compacted) continue;
            const rawUsage = msg.metadata?.contextUsage;
            const providerMeta =
              msg.metadata?.contextProviderMetadata ?? msg.metadata?.providerMetadata;
            if (rawUsage) {
              const msgModel = msg.metadata?.model ?? model ?? "unknown";
              return createDisplayUsage(
                rawUsage,
                msgModel,
                providerMeta,
                this.resolveMetadataModel(msgModel)
              );
            }
          }
        }
        return undefined;
      })();

      // Live streaming data (unchanged)
      const activeStreamId = aggregator.getActiveStreamMessageId();
      const rawContextUsage = activeStreamId
        ? aggregator.getActiveStreamUsage(activeStreamId)
        : undefined;
      const rawStepProviderMetadata = activeStreamId
        ? aggregator.getActiveStreamStepProviderMetadata(activeStreamId)
        : undefined;
      const liveUsage =
        rawContextUsage && model
          ? createDisplayUsage(
              rawContextUsage,
              model,
              rawStepProviderMetadata,
              this.resolveMetadataModel(model)
            )
          : undefined;

      const rawCumulativeUsage = activeStreamId
        ? aggregator.getActiveStreamCumulativeUsage(activeStreamId)
        : undefined;
      const rawCumulativeProviderMetadata = activeStreamId
        ? aggregator.getActiveStreamCumulativeProviderMetadata(activeStreamId)
        : undefined;
      const liveCostUsage =
        rawCumulativeUsage && model
          ? createDisplayUsage(
              rawCumulativeUsage,
              model,
              rawCumulativeProviderMetadata,
              this.resolveMetadataModel(model)
            )
          : undefined;

      return { sessionTotal, lastRequest, lastContextUsage, totalTokens, liveUsage, liveCostUsage };
    });
  }

  private tryHydrateConsumersFromSessionUsageCache(
    minionId: string,
    aggregator: StreamingMessageAggregator
  ): boolean {
    const usage = this.sessionUsage.get(minionId);
    const tokenStatsCache = usage?.tokenStatsCache;
    if (!tokenStatsCache) {
      return false;
    }

    const messages = aggregator.getAllMessages();
    if (messages.length === 0) {
      return false;
    }

    const model = aggregator.getCurrentModel() ?? "unknown";
    if (tokenStatsCache.model !== model) {
      return false;
    }

    // Reject hydration if provider config hasn't loaded yet (fingerprint is null)
    // or if the cached fingerprint doesn't match the current config. This prevents
    // stale caches from being served before we know the real configuration.
    if (
      this.providersConfigFingerprint == null ||
      tokenStatsCache.providersConfigVersion !== this.providersConfigFingerprint
    ) {
      return false;
    }

    if (tokenStatsCache.history.messageCount !== messages.length) {
      return false;
    }

    const cachedMaxSeq = tokenStatsCache.history.maxHistorySequence;
    const currentMaxSeq = getMaxHistorySequence(messages);

    // Fall back to messageCount matching if either side lacks historySequence metadata.
    if (
      cachedMaxSeq !== undefined &&
      currentMaxSeq !== undefined &&
      cachedMaxSeq !== currentMaxSeq
    ) {
      return false;
    }

    this.consumerManager.hydrateFromCache(minionId, {
      consumers: tokenStatsCache.consumers,
      tokenizerName: tokenStatsCache.tokenizerName,
      totalTokens: tokenStatsCache.totalTokens,
      topFilePaths: tokenStatsCache.topFilePaths,
    });

    return true;
  }

  private ensureConsumersCached(minionId: string, aggregator: StreamingMessageAggregator): void {
    if (aggregator.getAllMessages().length === 0) {
      return;
    }

    const cached = this.consumerManager.getCachedState(minionId);
    const isPending = this.consumerManager.isPending(minionId);
    if (cached || isPending) {
      return;
    }

    if (this.tryHydrateConsumersFromSessionUsageCache(minionId, aggregator)) {
      return;
    }

    this.consumerManager.scheduleCalculation(minionId, aggregator);
  }

  /**
   * Get consumer breakdown (may be calculating).
   * Triggers lazy calculation if minion is caught-up but no data exists.
   *
   * Architecture: Lazy trigger runs on EVERY access (outside MapStore.get())
   * so minion switches trigger calculation even if MapStore has cached result.
   */
  getMinionConsumers(minionId: string): MinionConsumersState {
    const aggregator = this.aggregators.get(minionId);
    const isCaughtUp = this.chatTransientState.get(minionId)?.caughtUp ?? false;

    // Lazy trigger check (runs on EVERY access, not just when MapStore recomputes)
    const cached = this.consumerManager.getCachedState(minionId);
    const isPending = this.consumerManager.isPending(minionId);

    if (!cached && !isPending && isCaughtUp) {
      if (aggregator && aggregator.getAllMessages().length > 0) {
        // Defer scheduling/hydration to avoid setState-during-render warning
        // queueMicrotask ensures this runs after current render completes
        queueMicrotask(() => {
          this.ensureConsumersCached(minionId, aggregator);
        });
      }
    }

    // Return state (MapStore handles subscriptions, delegates to manager for actual state)
    return this.consumersStore.get(minionId, () => {
      return this.consumerManager.getStateSync(minionId);
    });
  }

  /**
   * Subscribe to usage store changes for a specific minion.
   */
  subscribeUsage(minionId: string, listener: () => void): () => void {
    return this.usageStore.subscribeKey(minionId, listener);
  }

  /**
   * Subscribe to backend timing stats snapshots for a specific minion.
   */
  subscribeStats(minionId: string, listener: () => void): () => void {
    const unsubscribeFromStore = this.statsStore.subscribeKey(minionId, listener);

    const previousCount = this.statsListenerCounts.get(minionId) ?? 0;
    const nextCount = previousCount + 1;
    this.statsListenerCounts.set(minionId, nextCount);

    if (previousCount === 0) {
      // Start the backend subscription only once we have an actual UI consumer.
      this.subscribeToStats(minionId);
    }

    return () => {
      unsubscribeFromStore();

      const currentCount = this.statsListenerCounts.get(minionId);
      if (!currentCount) {
        console.warn(
          `[MinionStore] stats listener count underflow for ${minionId} (already 0)`
        );
        return;
      }

      if (currentCount === 1) {
        this.statsListenerCounts.delete(minionId);

        // No remaining listeners: stop the backend subscription and drop cached snapshot.
        const statsUnsubscribe = this.statsUnsubscribers.get(minionId);
        if (statsUnsubscribe) {
          statsUnsubscribe();
          this.statsUnsubscribers.delete(minionId);
        }
        this.minionStats.delete(minionId);

        // Clear MapStore caches for this minion.
        // MapStore.delete() is version-gated, so bump first to ensure we clear even
        // if the key was only ever read (get()) and never bumped.
        this.statsStore.bump(minionId);
        this.statsStore.delete(minionId);
        return;
      }

      this.statsListenerCounts.set(minionId, currentCount - 1);
    };
  }

  /**
   * Subscribe to consumer store changes for a specific minion.
   */
  subscribeConsumers(minionId: string, listener: () => void): () => void {
    return this.consumersStore.subscribeKey(minionId, listener);
  }

  /**
   * Update usage and schedule consumer calculation after stream completion.
   *
   * CRITICAL ORDERING: This must be called AFTER the aggregator updates its messages.
   * If called before, the UI will re-render and read stale data from the aggregator,
   * causing a race condition where usage appears empty until refresh.
   *
   * Handles both:
   * - Instant usage display (from API metadata) - only if usage present
   * - Async consumer breakdown (tokenization via Web Worker) - normally scheduled,
   *   but skipped during history replay to avoid O(N) scheduling overhead
   */
  private finalizeUsageStats(
    minionId: string,
    metadata?: { usage?: LanguageModelV2Usage }
  ): void {
    // During history replay: only bump usage, skip scheduling (caught-up schedules once at end)
    if (this.chatTransientState.get(minionId)?.replayingHistory) {
      if (metadata?.usage) {
        this.usageStore.bump(minionId);
      }
      return;
    }

    // Normal real-time path: always bump usage.
    //
    // Even if total usage is missing (e.g. provider doesn't return it or it timed out),
    // we still need to recompute usage snapshots to:
    // - Clear liveUsage once the active stream ends
    // - Pick up lastContextUsage changes from merged message metadata
    this.usageStore.bump(minionId);

    // Always schedule consumer calculation (tool calls, text, etc. need tokenization)
    // Even streams without usage metadata need token counts recalculated
    const aggregator = this.aggregators.get(minionId);
    if (aggregator) {
      this.consumerManager.scheduleCalculation(minionId, aggregator);
    }
  }

  private sleepWithAbort(timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }

      const onAbort = () => {
        cleanup();
        resolve();
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve();
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private isMinionRegistered(minionId: string): boolean {
    return this.minionMetadata.has(minionId);
  }

  private getBackgroundCompletionCompaction(
    minionId: string
  ): { hasContinueMessage: boolean } | undefined {
    const aggregator = this.aggregators.get(minionId);
    if (!aggregator) {
      return undefined;
    }

    const compactingStreams = aggregator
      .getActiveStreams()
      .filter((stream) => stream.isCompacting === true);

    if (compactingStreams.length === 0) {
      return undefined;
    }

    return {
      hasContinueMessage: compactingStreams.some((stream) => stream.hasCompactionContinue === true),
    };
  }

  private applyMinionActivitySnapshot(
    minionId: string,
    snapshot: MinionActivitySnapshot | null
  ): void {
    const previous = this.minionActivity.get(minionId) ?? null;

    if (snapshot) {
      this.minionActivity.set(minionId, snapshot);
    } else {
      this.minionActivity.delete(minionId);
    }

    const changed =
      previous?.streaming !== snapshot?.streaming ||
      previous?.lastModel !== snapshot?.lastModel ||
      previous?.lastThinkingLevel !== snapshot?.lastThinkingLevel ||
      previous?.recency !== snapshot?.recency ||
      !areAgentStatusesEqual(previous?.agentStatus, snapshot?.agentStatus);

    if (!changed) {
      return;
    }

    if (this.aggregators.has(minionId)) {
      this.states.bump(minionId);
    }

    const startedStreamingSnapshot =
      previous?.streaming !== true && snapshot?.streaming === true ? snapshot : null;
    if (startedStreamingSnapshot) {
      this.activityStreamingStartRecency.set(minionId, startedStreamingSnapshot.recency);
    }

    const stoppedStreamingSnapshot =
      previous?.streaming === true && snapshot?.streaming === false ? snapshot : null;
    const isBackgroundStreamingStop =
      stoppedStreamingSnapshot !== null && minionId !== this.activeMinionId;
    const streamStartRecency = this.activityStreamingStartRecency.get(minionId);
    const recencyAdvancedSinceStreamStart =
      stoppedStreamingSnapshot !== null &&
      streamStartRecency !== undefined &&
      stoppedStreamingSnapshot.recency > streamStartRecency;
    const backgroundCompaction = isBackgroundStreamingStop
      ? this.getBackgroundCompletionCompaction(minionId)
      : undefined;
    // The backend tags the streaming=false (stop) snapshot with isIdleCompaction.
    // The idle marker is added after sendMessage returns (to avoid races with
    // concurrent user streams), so only the stop snapshot carries the flag.
    // Check both previous and current as defense-in-depth.
    const wasIdleCompaction =
      previous?.isIdleCompaction === true || snapshot?.isIdleCompaction === true;

    // Trigger response completion notifications for background minions only when
    // activity indicates a true completion (streaming true -> false WITH recency advance).
    // stream-abort/error transitions also flip streaming to false, but recency stays
    // unchanged there, so suppress completion notifications in those cases.
    if (stoppedStreamingSnapshot && recencyAdvancedSinceStreamStart && isBackgroundStreamingStop) {
      // Activity snapshots don't include message/content metadata. Reuse any
      // still-active stream context captured before this minion was backgrounded
      // so compaction continue turns remain suppressible in App notifications.
      this.emitResponseComplete(
        minionId,
        "",
        true,
        "",
        wasIdleCompaction
          ? {
              hasContinueMessage: backgroundCompaction?.hasContinueMessage ?? false,
              isIdle: true,
            }
          : backgroundCompaction,
        stoppedStreamingSnapshot.recency,
        false
      );
    }

    if (isBackgroundStreamingStop) {
      // Inactive minions do not receive stream-end events via onChat. Once
      // activity confirms streaming stopped, clear stale stream contexts so they
      // cannot leak compaction metadata into future completion callbacks.
      this.aggregators.get(minionId)?.clearActiveStreams();
    }

    if (snapshot?.streaming !== true) {
      this.activityStreamingStartRecency.delete(minionId);
    }

    if (previous?.recency !== snapshot?.recency && this.aggregators.has(minionId)) {
      this.derived.bump("recency");
    }
  }

  private applyMinionActivityList(snapshots: Record<string, MinionActivitySnapshot>): void {
    const snapshotEntries = Object.entries(snapshots);

    // Defensive fallback: minion.activity.list returns {} on backend read failures.
    // Preserve last-known snapshots instead of wiping sidebar activity state for all
    // minions during a transient metadata read error.
    if (snapshotEntries.length === 0) {
      return;
    }

    const seenMinionIds = new Set<string>();

    for (const [minionId, snapshot] of snapshotEntries) {
      seenMinionIds.add(minionId);
      this.applyMinionActivitySnapshot(minionId, snapshot);
    }

    for (const minionId of Array.from(this.minionActivity.keys())) {
      if (seenMinionIds.has(minionId)) {
        continue;
      }
      this.applyMinionActivitySnapshot(minionId, null);
    }
  }

  private applyTerminalActivity(
    minionId: string,
    next: { activeCount: number; totalSessions: number }
  ): void {
    const prev = this.minionTerminalActivity.get(minionId);
    if (
      prev &&
      prev.activeCount === next.activeCount &&
      prev.totalSessions === next.totalSessions
    ) {
      return;
    }

    if (next.totalSessions === 0) {
      this.minionTerminalActivity.delete(minionId);
    } else {
      this.minionTerminalActivity.set(minionId, next);
    }

    // Bump sidebar snapshots so consumers see updated terminal activity counts.
    if (this.aggregators.has(minionId)) {
      this.states.bump(minionId);
    }
  }

  /**
   * Safely resolve terminal.activity.subscribe from a client that may be
   * a partial mock or an older server that doesn't expose this endpoint.
   * Returns null when the capability is absent — callers must treat this
   * as "terminal activity unsupported" rather than an error.
   */
  private resolveTerminalActivitySubscribe(
    client: RouterClient<AppRouter>
  ): typeof client.terminal.activity.subscribe | null {
    try {
      const subscribe = client.terminal?.activity?.subscribe;
      return typeof subscribe === "function" ? subscribe : null;
    } catch {
      return null;
    }
  }

  private clearAllTerminalActivitySnapshots(): void {
    if (this.minionTerminalActivity.size === 0) {
      return;
    }

    const minionIds = Array.from(this.minionTerminalActivity.keys());
    this.minionTerminalActivity.clear();

    for (const minionId of minionIds) {
      if (this.aggregators.has(minionId)) {
        this.states.bump(minionId);
      }
    }
  }

  private async runTerminalActivitySubscription(controller: AbortController): Promise<void> {
    const signal = controller.signal;
    let attempt = 0;

    try {
      while (!signal.aborted) {
        const client = this.client ?? (await this.waitForClient(signal));
        if (!client || signal.aborted) {
          return;
        }

        const subscribe = this.resolveTerminalActivitySubscribe(client);
        if (!subscribe) {
          // Client doesn't support terminal activity — clear stale state and exit
          // without entering the retry loop (this is not an error condition).
          this.clearAllTerminalActivitySnapshots();
          return;
        }

        const attemptController = new AbortController();
        const onAbort = () => attemptController.abort();
        signal.addEventListener("abort", onAbort);

        const clientChangeSignal = this.clientChangeController.signal;
        const onClientChange = () => attemptController.abort();
        clientChangeSignal.addEventListener("abort", onClientChange, { once: true });

        try {
          const iterator = await subscribe(undefined, {
            signal: attemptController.signal,
          });

          for await (const event of iterator) {
            if (signal.aborted) {
              return;
            }

            // Connection is alive again - don't carry old backoff into the next failure.
            attempt = 0;

            queueMicrotask(() => {
              if (signal.aborted || attemptController.signal.aborted) {
                return;
              }

              if (event.type === "snapshot") {
                const seenMinionIds = new Set<string>();
                for (const [minionId, activity] of Object.entries(event.minions)) {
                  seenMinionIds.add(minionId);
                  this.applyTerminalActivity(minionId, activity);
                }

                for (const minionId of Array.from(this.minionTerminalActivity.keys())) {
                  if (seenMinionIds.has(minionId)) {
                    continue;
                  }
                  this.applyTerminalActivity(minionId, { activeCount: 0, totalSessions: 0 });
                }

                return;
              }

              this.applyTerminalActivity(event.minionId, event.activity);
            });
          }

          if (signal.aborted) {
            return;
          }

          if (!attemptController.signal.aborted) {
            console.warn(
              "[MinionStore] terminal activity subscription ended unexpectedly; retrying..."
            );
          }
        } catch (error) {
          if (signal.aborted) {
            return;
          }

          const abortError = isAbortError(error);
          if (attemptController.signal.aborted) {
            if (!abortError) {
              console.warn("[MinionStore] terminal activity subscription aborted; retrying...");
            }
          } else if (!abortError) {
            console.warn("[MinionStore] Error in terminal activity subscription:", error);
          }
        } finally {
          signal.removeEventListener("abort", onAbort);
          clientChangeSignal.removeEventListener("abort", onClientChange);
        }

        if (!signal.aborted && !attemptController.signal.aborted) {
          const delayMs = calculateOnChatBackoffMs(attempt);
          attempt++;

          await this.sleepWithAbort(delayMs, signal);
        }
      }
    } finally {
      this.releaseTerminalActivityController(controller);
    }
  }

  private async runActivitySubscription(signal: AbortSignal): Promise<void> {
    let attempt = 0;

    while (!signal.aborted) {
      const client = this.client ?? (await this.waitForClient(signal));
      if (!client || signal.aborted) {
        return;
      }

      const attemptController = new AbortController();
      const onAbort = () => attemptController.abort();
      signal.addEventListener("abort", onAbort);

      const clientChangeSignal = this.clientChangeController.signal;
      const onClientChange = () => attemptController.abort();
      clientChangeSignal.addEventListener("abort", onClientChange, { once: true });

      try {
        // Open the live delta stream first so no state transition can be lost
        // between the list snapshot fetch and subscribe registration.
        const iterator = await client.minion.activity.subscribe(undefined, {
          signal: attemptController.signal,
        });

        const snapshots = await client.minion.activity.list();
        if (signal.aborted) {
          return;
        }
        // Client changed while list() was in flight — retry with the new client
        // instead of exiting permanently. The outer while loop will pick up the
        // replacement client on the next iteration.
        if (attemptController.signal.aborted) {
          continue;
        }

        queueMicrotask(() => {
          if (signal.aborted || attemptController.signal.aborted) {
            return;
          }
          this.applyMinionActivityList(snapshots);
        });

        for await (const event of iterator) {
          if (signal.aborted) {
            return;
          }

          // Connection is alive again - don't carry old backoff into the next failure.
          attempt = 0;

          queueMicrotask(() => {
            if (signal.aborted || attemptController.signal.aborted) {
              return;
            }
            this.applyMinionActivitySnapshot(event.minionId, event.activity);
          });
        }

        if (signal.aborted) {
          return;
        }

        if (!attemptController.signal.aborted) {
          console.warn("[MinionStore] activity subscription ended unexpectedly; retrying...");
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        const abortError = isAbortError(error);
        if (attemptController.signal.aborted) {
          if (!abortError) {
            console.warn("[MinionStore] activity subscription aborted; retrying...");
          }
        } else if (!abortError) {
          console.warn("[MinionStore] Error in activity subscription:", error);
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        clientChangeSignal.removeEventListener("abort", onClientChange);
      }

      const delayMs = calculateOnChatBackoffMs(attempt);
      attempt++;

      await this.sleepWithAbort(delayMs, signal);
      if (signal.aborted) {
        return;
      }
    }
  }

  private async waitForClient(signal: AbortSignal): Promise<RouterClient<AppRouter> | null> {
    while (!signal.aborted) {
      if (this.client) {
        return this.client;
      }

      // Wait for a client to be attached (e.g., initial connect or reconnect).
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }

        const clientChangeSignal = this.clientChangeController.signal;
        const onAbort = () => {
          cleanup();
          resolve();
        };

        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, ON_CHAT_RETRY_BASE_MS);

        const cleanup = () => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          clientChangeSignal.removeEventListener("abort", onAbort);
        };

        signal.addEventListener("abort", onAbort, { once: true });
        clientChangeSignal.addEventListener("abort", onAbort, { once: true });
      });
    }

    return null;
  }

  /**
   * Reset derived UI state for a minion so a fresh onChat replay can rebuild it.
   *
   * This is used when an onChat subscription ends unexpectedly (MessagePort/WebSocket hiccup).
   * Without clearing, replayed history would be merged into stale state (loadHistoricalMessages
   * only adds/overwrites, it doesn't delete messages that disappeared due to compaction/truncation).
   */
  private resetChatStateForReplay(minionId: string): void {
    const aggregator = this.aggregators.get(minionId);
    if (!aggregator) {
      return;
    }

    // Clear any pending UI bumps from deltas - we're about to rebuild the message list.
    this.cancelPendingIdleBump(minionId);

    // Preserve last-known usage while replay rebuilds the aggregator.
    // Without this, getMinionUsage() can briefly return an empty state and hide
    // context/cost indicators until replayed usage catches up.
    const currentUsage = this.getMinionUsage(minionId);
    const hasUsageSnapshot =
      currentUsage.totalTokens > 0 ||
      currentUsage.lastContextUsage !== undefined ||
      currentUsage.liveUsage !== undefined ||
      currentUsage.liveCostUsage !== undefined;
    if (hasUsageSnapshot) {
      this.preReplayUsageSnapshot.set(minionId, currentUsage);
    } else {
      this.preReplayUsageSnapshot.delete(minionId);
    }

    aggregator.clear();

    // Reset per-minion transient state so the next replay rebuilds from the backend source of truth.
    const previousTransient = this.chatTransientState.get(minionId);
    const nextTransient = createInitialChatTransientState();

    // Preserve active hydration across full replay resets so minion-switch catch-up
    // remains in loading state until we receive an authoritative caught-up marker.
    if (previousTransient?.isHydratingTranscript) {
      nextTransient.isHydratingTranscript = true;
    }

    this.chatTransientState.set(minionId, nextTransient);

    this.historyPagination.set(minionId, createInitialHistoryPaginationState());

    this.states.bump(minionId);
    this.checkAndBumpRecencyIfChanged();
  }

  private getStartupAutoCompactionThreshold(
    minionId: string,
    retryModelHint?: string | null
  ): number {
    const metadata = this.minionMetadata.get(minionId);
    const modelFromActiveAgent = metadata?.agentId
      ? metadata.aiSettingsByAgent?.[metadata.agentId]?.model
      : undefined;
    const pendingModel =
      retryModelHint ??
      modelFromActiveAgent ??
      metadata?.aiSettingsByAgent?.exec?.model ??
      metadata?.aiSettings?.model;
    const thresholdKey = getAutoCompactionThresholdKey(pendingModel ?? "default");
    const persistedThreshold = readPersistedState<unknown>(
      thresholdKey,
      DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT
    );
    const thresholdPercent =
      typeof persistedThreshold === "number" && Number.isFinite(persistedThreshold)
        ? persistedThreshold
        : DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT;

    if (thresholdPercent !== persistedThreshold) {
      // Self-heal malformed localStorage so future startup syncs remain valid.
      updatePersistedState<number>(thresholdKey, DEFAULT_AUTO_COMPACTION_THRESHOLD_PERCENT);
    }

    return Math.max(0.1, Math.min(1, thresholdPercent / 100));
  }

  /**
   * Best-effort startup threshold sync so backend recovery uses the user's persisted
   * per-model threshold before AgentSession startup recovery kicks in.
   */
  private async syncAutoCompactionThresholdAtStartup(
    client: RouterClient<AppRouter>,
    minionId: string
  ): Promise<void> {
    try {
      // Startup auto-retry can resume a turn with a model different from the current
      // minion selector. Ask backend for that retry-turn model first so threshold
      // sync uses the matching per-model localStorage key.
      const startupRetryModelResult = await client.minion.getStartupAutoRetryModel?.({
        minionId,
      });
      const startupRetryModel = startupRetryModelResult?.success
        ? startupRetryModelResult.data
        : null;

      await client.minion.setAutoCompactionThreshold({
        minionId,
        threshold: this.getStartupAutoCompactionThreshold(minionId, startupRetryModel),
      });
    } catch (error) {
      console.warn(
        `[MinionStore] Failed to sync startup auto-compaction threshold for ${minionId}:`,
        error
      );
    }
  }

  /**
   * Subscribe to minion chat events (history replay + live streaming).
   * Retries on unexpected iterator termination to avoid requiring a full app restart.
   */
  private async runOnChatSubscription(minionId: string, signal: AbortSignal): Promise<void> {
    let attempt = 0;

    while (!signal.aborted) {
      const hadClientAtLoopStart = this.client !== null;
      const client = this.client ?? (await this.waitForClient(signal));
      if (!client || signal.aborted) {
        return;
      }

      // If activation happened while the client was offline, begin hydration now
      // that we can actually start the subscription loop.
      const initialTransient = this.chatTransientState.get(minionId);
      if (
        !hadClientAtLoopStart &&
        initialTransient &&
        !initialTransient.caughtUp &&
        !initialTransient.isHydratingTranscript
      ) {
        initialTransient.isHydratingTranscript = true;
        this.states.bump(minionId);
      }

      // Allow us to abort only this subscription attempt (without unsubscribing the minion).
      const attemptController = new AbortController();
      const onAbort = () => attemptController.abort();
      signal.addEventListener("abort", onAbort);

      const clientChangeSignal = this.clientChangeController.signal;
      const onClientChange = () => attemptController.abort();
      clientChangeSignal.addEventListener("abort", onClientChange, { once: true });

      let stallInterval: ReturnType<typeof setInterval> | null = null;
      let lastChatEventAt = Date.now();

      try {
        // Always reset caughtUp at subscription start so historical events are
        // buffered until the caught-up marker arrives, regardless of replay mode.
        const transient = this.chatTransientState.get(minionId);
        if (transient) {
          transient.caughtUp = false;
        }

        // Reconnect incrementally whenever we can build a valid cursor.
        // Do not gate on transient.caughtUp here: retry paths may optimistically
        // set caughtUp=false to re-enable buffering, but the cursor can still
        // represent the latest rendered state for an incremental reconnect.
        const aggregator = this.aggregators.get(minionId);
        let mode: OnChatMode | undefined;

        if (aggregator) {
          const cursor = aggregator.getOnChatCursor();
          if (cursor?.history) {
            mode = {
              type: "since",
              cursor: {
                history: cursor.history,
                stream: cursor.stream,
              },
            };
          }
        }

        await this.syncAutoCompactionThresholdAtStartup(client, minionId);

        const autoRetryKey = getAutoRetryKey(minionId);
        const legacyAutoRetryEnabledRaw = readPersistedState<unknown>(autoRetryKey, undefined);
        const legacyAutoRetryEnabled =
          typeof legacyAutoRetryEnabledRaw === "boolean" ? legacyAutoRetryEnabledRaw : undefined;

        if (legacyAutoRetryEnabledRaw !== undefined && legacyAutoRetryEnabled === undefined) {
          // Self-heal malformed legacy values so onChat subscription retries do not
          // keep failing schema validation on every reconnect attempt.
          updatePersistedState<boolean | undefined>(autoRetryKey, undefined);
        }

        const onChatInput =
          legacyAutoRetryEnabled === undefined
            ? { minionId, mode }
            : { minionId, mode, legacyAutoRetryEnabled };

        const iterator = await client.minion.onChat(onChatInput, {
          signal: attemptController.signal,
        });

        if (legacyAutoRetryEnabled !== undefined) {
          // One-way migration: once we have successfully forwarded the legacy value
          // to the backend, clear the renderer key so future sessions rely solely
          // on backend persistence.
          updatePersistedState<boolean | undefined>(autoRetryKey, undefined);
        }

        // Full replay: clear stale derived/transient state now that the subscription
        // is active. Deferred to after the iterator is established so the UI continues
        // displaying previous state until replay data actually starts arriving.
        if (!mode || mode.type === "full") {
          this.resetChatStateForReplay(minionId);
        }

        // Stall watchdog: server sends heartbeats every 5s, so if we don't receive ANY events
        // (including heartbeats) for 10s, the connection is likely dead.
        stallInterval = setInterval(() => {
          if (attemptController.signal.aborted) return;

          const elapsedMs = Date.now() - lastChatEventAt;
          if (elapsedMs < ON_CHAT_STALL_TIMEOUT_MS) return;

          console.warn(
            `[MinionStore] onChat appears stalled for ${minionId} (no events for ${elapsedMs}ms); retrying...`
          );
          attemptController.abort();
        }, ON_CHAT_STALL_CHECK_INTERVAL_MS);

        for await (const data of iterator) {
          if (signal.aborted) {
            return;
          }

          lastChatEventAt = Date.now();

          // Connection is alive again - don't carry old backoff into the next failure.
          attempt = 0;

          const attemptSignal = attemptController.signal;
          queueMicrotask(() => {
            // Minion switches abort the previous attempt before starting a new one.
            // Drop any already-queued chat events from that aborted attempt so stale
            // replay buffers cannot be repopulated after we synchronously cleared them.
            if (signal.aborted || attemptSignal.aborted) {
              return;
            }
            this.handleChatMessage(minionId, data);
          });
        }

        // Iterator ended without an abort - treat as unexpected and retry.
        if (signal.aborted) {
          return;
        }

        if (attemptController.signal.aborted) {
          // e.g., stall watchdog fired
          console.warn(
            `[MinionStore] onChat subscription aborted for ${minionId}; retrying...`
          );
        } else {
          console.warn(
            `[MinionStore] onChat subscription ended unexpectedly for ${minionId}; retrying...`
          );
        }
      } catch (error) {
        // Suppress errors when subscription was intentionally cleaned up
        if (signal.aborted) {
          return;
        }

        const abortError = isAbortError(error);

        if (attemptController.signal.aborted) {
          if (!abortError) {
            console.warn(
              `[MinionStore] onChat subscription aborted for ${minionId}; retrying...`
            );
          }
        } else if (isIteratorValidationFailed(error)) {
          // EVENT_ITERATOR_VALIDATION_FAILED can happen when:
          // 1. Schema validation fails (event doesn't match MinionChatMessageSchema)
          // 2. Minion was removed on server side (iterator ends with error)
          // 3. Connection dropped (WebSocket/MessagePort error)

          // Only suppress if minion no longer exists (was removed during the race)
          if (!this.isMinionRegistered(minionId)) {
            return;
          }
          // Log with detailed validation info for debugging schema mismatches
          console.error(
            `[MinionStore] Event validation failed for ${minionId}: ${formatValidationError(error)}`
          );
        } else if (!abortError) {
          console.error(`[MinionStore] Error in onChat subscription for ${minionId}:`, error);
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        clientChangeSignal.removeEventListener("abort", onClientChange);
        if (stallInterval) {
          clearInterval(stallInterval);
        }
      }

      if (this.isMinionRegistered(minionId)) {
        // Failed reconnect attempts may have buffered partial replay data.
        // Clear replay buffers before the next attempt so we don't append a
        // second replay copy and duplicate deltas/tool events on caught-up.
        this.clearReplayBuffers(minionId);

        // If catch-up fails before the authoritative marker arrives, fall back to
        // normal transcript/retry UI immediately so hydration cannot remain pinned
        // while we wait for client reconnects.
        const transient = this.chatTransientState.get(minionId);
        if (transient?.isHydratingTranscript && !transient.caughtUp) {
          transient.isHydratingTranscript = false;
          this.states.bump(minionId);
        }

        // Full replay resets can preserve the last usage snapshot until caught-up.
        // If reconnect fails before caught-up arrives, drop that snapshot so stale
        // live usage isn't shown indefinitely while retries continue.
        if (transient && !transient.caughtUp && this.preReplayUsageSnapshot.delete(minionId)) {
          this.usageStore.bump(minionId);
        }

        // Preserve pagination across transient reconnect retries. Incremental
        // caught-up payloads intentionally omit hasOlderHistory, so resetting
        // here would permanently hide "Load older messages" until a full replay.
        const existingPagination =
          this.historyPagination.get(minionId) ?? createInitialHistoryPaginationState();
        this.historyPagination.set(minionId, {
          ...existingPagination,
          loading: false,
        });
      }

      const delayMs = calculateOnChatBackoffMs(attempt);
      attempt++;

      await this.sleepWithAbort(delayMs, signal);
      if (signal.aborted) {
        return;
      }
    }
  }

  /**
   * Register a minion and initialize local state.
   */

  /**
   * Imperative metadata lookup — no React subscription. Safe to call from
   * event handlers / callbacks without causing re-renders.
   */
  getMinionMetadata(minionId: string): FrontendMinionMetadata | undefined {
    return this.minionMetadata.get(minionId);
  }

  addMinion(metadata: FrontendMinionMetadata): void {
    const minionId = metadata.id;

    // Skip if already registered
    if (this.minionMetadata.has(minionId)) {
      return;
    }

    // Store metadata for name lookup
    this.minionMetadata.set(minionId, metadata);

    // Backend guarantees createdAt via config.ts - this should never be undefined
    assert(
      metadata.createdAt,
      `Minion ${minionId} missing createdAt - backend contract violated`
    );

    const aggregator = this.getOrCreateAggregator(
      minionId,
      metadata.createdAt,
      metadata.unarchivedAt
    );

    // Initialize recency cache and bump derived store immediately
    // This ensures UI sees correct minion order before messages load
    const initialRecency = aggregator.getRecencyTimestamp();
    if (initialRecency !== null) {
      this.recencyCache.set(minionId, initialRecency);
      this.derived.bump("recency");
    }

    // Initialize transient chat state
    if (!this.chatTransientState.has(minionId)) {
      this.chatTransientState.set(minionId, createInitialChatTransientState());
    }

    if (!this.historyPagination.has(minionId)) {
      this.historyPagination.set(minionId, createInitialHistoryPaginationState());
    }

    // Clear stale streaming state
    aggregator.clearActiveStreams();

    // Fetch persisted session usage (fire-and-forget)
    this.refreshSessionUsage(minionId);

    // Stats snapshots are subscribed lazily via subscribeStats().
    if (this.statsEnabled) {
      this.subscribeToStats(minionId);
    }

    this.ensureActiveOnChatSubscription();

    if (!this.client) {
      console.warn(`[MinionStore] No ORPC client available for minion ${minionId}`);
    }
  }

  /**
   * Remove a minion and clean up subscriptions.
   */
  removeMinion(minionId: string): void {
    // Clean up consumer manager state
    this.consumerManager.removeMinion(minionId);

    // Clean up idle callback to prevent stale callbacks
    this.cancelPendingIdleBump(minionId);

    if (this.activeMinionId === minionId) {
      this.activeMinionId = null;
    }

    const statsUnsubscribe = this.statsUnsubscribers.get(minionId);
    if (statsUnsubscribe) {
      statsUnsubscribe();
      this.statsUnsubscribers.delete(minionId);
    }

    const unsubscribe = this.ipcUnsubscribers.get(minionId);
    if (unsubscribe) {
      unsubscribe();
      this.ipcUnsubscribers.delete(minionId);
    }
    if (this.activeOnChatMinionId === minionId) {
      this.activeOnChatMinionId = null;
    }

    this.pendingReplayReset.delete(minionId);

    // Clean up state
    this.states.delete(minionId);
    this.usageStore.delete(minionId);
    this.consumersStore.delete(minionId);
    this.aggregators.delete(minionId);
    this.chatTransientState.delete(minionId);
    this.minionMetadata.delete(minionId);
    this.minionActivity.delete(minionId);
    this.minionTerminalActivity.delete(minionId);
    this.activityStreamingStartRecency.delete(minionId);
    this.recencyCache.delete(minionId);
    this.previousSidebarValues.delete(minionId);
    this.sidebarStateCache.delete(minionId);
    this.sidebarStateSourceState.delete(minionId);
    this.minionCreatedAt.delete(minionId);
    this.minionStats.delete(minionId);
    this.statsStore.delete(minionId);
    this.statsListenerCounts.delete(minionId);
    this.historyPagination.delete(minionId);
    this.preReplayUsageSnapshot.delete(minionId);
    this.sessionUsage.delete(minionId);
    this.sessionUsageRequestVersion.delete(minionId);

    this.ensureActiveOnChatSubscription();
    this.derived.bump("recency");
  }

  /**
   * Sync minions with metadata - add new, remove deleted.
   */
  syncMinions(minionMetadata: Map<string, FrontendMinionMetadata>): void {
    const metadataIds = new Set(Array.from(minionMetadata.values()).map((m) => m.id));
    const currentIds = new Set(this.minionMetadata.keys());

    // Add new minions
    for (const metadata of minionMetadata.values()) {
      if (!currentIds.has(metadata.id)) {
        this.addMinion(metadata);
      }
    }

    // Remove deleted minions
    for (const minionId of currentIds) {
      if (!metadataIds.has(minionId)) {
        this.removeMinion(minionId);
      }
    }

    // Re-evaluate the active subscription after additions/removals.
    // removeMinion can null activeMinionId when the removed minion
    // was active (e.g., stale singleton state between integration tests),
    // leaving addMinion's ensureActiveOnChatSubscription targeting the
    // old minion. This final call reconciles the subscription with the
    // current activeMinionId + registration state.
    this.ensureActiveOnChatSubscription();
  }

  /**
   * Cleanup all subscriptions (call on unmount).
   */
  dispose(): void {
    // Clean up consumer manager
    this.consumerManager.dispose();

    for (const unsubscribe of this.statsUnsubscribers.values()) {
      unsubscribe();
    }
    this.statsUnsubscribers.clear();

    for (const unsubscribe of this.ipcUnsubscribers.values()) {
      unsubscribe();
    }
    this.ipcUnsubscribers.clear();

    if (this.activityAbortController) {
      this.activityAbortController.abort();
      this.activityAbortController = null;
    }

    if (this.terminalActivityAbortController) {
      this.terminalActivityAbortController.abort();
      this.terminalActivityAbortController = null;
    }

    // Abort client-scoped subscriptions (providers.onConfigChanged, stats, etc.)
    // so async iterators/timers cannot mutate cleared state after disposal.
    this.clientChangeController.abort();

    this.activeMinionId = null;
    this.activeOnChatMinionId = null;
    this.pendingReplayReset.clear();
    this.states.clear();
    this.derived.clear();
    this.usageStore.clear();
    this.consumersStore.clear();
    this.aggregators.clear();
    this.chatTransientState.clear();
    this.minionMetadata.clear();
    this.minionActivity.clear();
    this.minionTerminalActivity.clear();
    this.activityStreamingStartRecency.clear();
    this.minionStats.clear();
    this.statsStore.clear();
    this.statsListenerCounts.clear();
    this.historyPagination.clear();
    this.preReplayUsageSnapshot.clear();
    this.sessionUsage.clear();
    this.recencyCache.clear();
    this.previousSidebarValues.clear();
    this.sidebarStateCache.clear();
    this.minionCreatedAt.clear();
  }

  /**
   * Subscribe to file-modifying tool completions.
   * @param listener Called with minionId when a file-modifying tool completes
   * @param minionId If provided, only notify for this minion
   */
  subscribeFileModifyingTool(
    listener: (minionId: string) => void,
    minionId?: string
  ): () => void {
    if (minionId) {
      // Per-minion: wrap listener to match subscribeKey signature
      return this.fileModifyingToolSubs.subscribeKey(minionId, () => listener(minionId));
    }
    // All minions: subscribe to global notifications
    return this.fileModifyingToolSubs.subscribeAny(() => {
      // Notify for all minions that have pending changes
      for (const wsId of this.fileModifyingToolMs.keys()) {
        listener(wsId);
      }
    });
  }

  /**
   * Get when a file-modifying tool last completed for this minion.
   * Returns undefined if no tools have completed since last clear.
   */
  getFileModifyingToolMs(minionId: string): number | undefined {
    return this.fileModifyingToolMs.get(minionId);
  }

  /**
   * Clear the file-modifying tool timestamp after ReviewPanel has consumed it.
   */
  clearFileModifyingToolMs(minionId: string): void {
    this.fileModifyingToolMs.delete(minionId);
  }

  /**
   * Simulate a file-modifying tool completion for testing.
   * Triggers the same subscription as a real tool-call-end for file_edit_* or bash.
   */
  simulateFileModifyingToolEnd(minionId: string): void {
    this.fileModifyingToolMs.set(minionId, Date.now());
    this.fileModifyingToolSubs.bump(minionId);
  }

  // Private methods

  /**
   * Get or create aggregator for a minion.
   *
   * REQUIRES: createdAt must be provided for new aggregators.
   * Backend guarantees every minion has createdAt via config.ts.
   *
   * If aggregator already exists, createdAt is optional (it was already set during creation).
   */
  private getOrCreateAggregator(
    minionId: string,
    createdAt: string,
    unarchivedAt?: string
  ): StreamingMessageAggregator {
    if (!this.aggregators.has(minionId)) {
      // Create new aggregator with required createdAt and minionId for localStorage persistence
      const aggregator = new StreamingMessageAggregator(createdAt, minionId, unarchivedAt);
      // Wire up navigation callback for notification clicks
      if (this.navigateToMinionCallback) {
        aggregator.onNavigateToMinion = this.navigateToMinionCallback;
      }
      // Wire up response complete callback for "notify on response" feature
      if (this.responseCompleteCallback) {
        this.bindAggregatorResponseCompleteCallback(aggregator);
      }
      this.aggregators.set(minionId, aggregator);
      this.minionCreatedAt.set(minionId, createdAt);
    } else if (unarchivedAt) {
      // Update unarchivedAt on existing aggregator (e.g., after restore from archive)
      this.aggregators.get(minionId)!.setUnarchivedAt(unarchivedAt);
    }

    return this.aggregators.get(minionId)!;
  }

  /**
   * Check if data is a buffered event type by checking the handler map.
   * This ensures isStreamEvent() and processStreamEvent() can never fall out of sync.
   */
  private isBufferedEvent(data: MinionChatMessage): boolean {
    if (!("type" in data)) {
      return false;
    }

    // Buffer high-frequency stream events (including bash/task live updates) until
    // caught-up so full-replay reconnects can deterministically rebuild transient state.
    return (
      data.type in this.bufferedEventHandlers ||
      data.type === "bash-output" ||
      data.type === "task-created"
    );
  }

  private handleChatMessage(minionId: string, data: MinionChatMessage): void {
    // Aggregator must exist - minions are initialized in addMinion() before subscriptions run.
    const aggregator = this.assertGet(minionId);

    const transient = this.assertChatTransientState(minionId);

    if (isCaughtUpMessage(data)) {
      const replay = data.replay ?? "full";

      // Check if there's an active stream in buffered events (reconnection scenario)
      const pendingEvents = transient.pendingStreamEvents;
      const hasActiveStream = pendingEvents.some(
        (event) => "type" in event && event.type === "stream-start"
      );

      const serverActiveStreamMessageId = data.cursor?.stream?.messageId;
      const localActiveStreamMessageId = aggregator.getActiveStreamMessageId();
      const streamContextMismatched =
        serverActiveStreamMessageId !== undefined &&
        serverActiveStreamMessageId !== localActiveStreamMessageId;

      // Track the server's replay window start for accurate reconnect cursors.
      // This prevents loadOlderHistory-prepended pages from polluting the cursor.
      const serverOldestSeq = data.cursor?.history?.oldestHistorySequence;
      if (typeof serverOldestSeq === "number") {
        aggregator.setEstablishedOldestHistorySequence(serverOldestSeq);
      }

      // Defensive cleanup:
      // - full replay means backend rebuilt state from scratch, so stale local stream contexts
      //   must be cleared even if a stream cursor is present in caught-up metadata.
      // - no stream cursor means no active stream exists server-side.
      // - mismatched stream IDs means local context is stale (e.g., stream A ended while
      //   disconnected and stream B is now active), so clear before replaying pending events.
      if (
        replay === "full" ||
        serverActiveStreamMessageId === undefined ||
        streamContextMismatched
      ) {
        aggregator.clearActiveStreams();
      }

      if (replay === "full") {
        // Full replay replaces backend-derived history state. Reset transient UI-only
        // fields before replay hydration so stale values do not survive reconnect fallback.
        // queuedMessage is safe to clear because backend now replays a fresh
        // queued-message-changed snapshot before caught-up.
        transient.queuedMessage = null;

        // Auto-retry status is ephemeral and may have resolved while disconnected.
        // Clear stale banners so reconnect UI reflects replayed events only.
        transient.autoRetryStatus = null;

        // Server can downgrade a requested since reconnect to full replay.
        // Clear stale interruption suppression state so retry UI is derived solely
        // from the replayed transcript instead of a pre-disconnect abort reason.
        aggregator.clearLastAbortReason();
      }

      if (replay === "full" || !data.cursor?.stream || streamContextMismatched) {
        // Live tool-call UI is tied to the active stream context; clear it when replay
        // replaces history, reports no active stream, or reports a different stream ID.
        transient.liveBashOutput.clear();
        transient.liveTaskIds.clear();
      }

      if (transient.historicalMessages.length > 0) {
        const loadMode = replay === "full" ? "replace" : "append";
        aggregator.loadHistoricalMessages(transient.historicalMessages, hasActiveStream, {
          mode: loadMode,
        });
        transient.historicalMessages.length = 0;
      } else if (replay === "full") {
        // Full replay can legitimately contain zero messages (e.g. compacted to empty).
        aggregator.loadHistoricalMessages([], hasActiveStream, { mode: "replace" });
      }

      // Mark that we're replaying buffered history (prevents O(N) scheduling)
      transient.replayingHistory = true;

      // Process buffered stream events now that history is loaded
      for (const event of pendingEvents) {
        this.processStreamEvent(minionId, aggregator, event);
      }
      pendingEvents.length = 0;

      // Done replaying buffered events
      transient.replayingHistory = false;

      if (replay === "since" && data.hasOlderHistory === undefined) {
        // Since reconnects keep the pre-disconnect pagination state. The server
        // omits hasOlderHistory for this mode because the client already knows it.
        if (!this.historyPagination.has(minionId)) {
          this.historyPagination.set(minionId, createInitialHistoryPaginationState());
        }
      } else {
        this.historyPagination.set(
          minionId,
          this.deriveHistoryPaginationState(aggregator, data.hasOlderHistory)
        );
      }
      // Mark as caught up
      transient.caughtUp = true;
      transient.isHydratingTranscript = false;
      this.states.bump(minionId);
      this.checkAndBumpRecencyIfChanged(); // Messages loaded, update recency

      // Replay resets clear the aggregator before history is rebuilt. Drop the temporary
      // fallback snapshot and recompute usage immediately once catch-up is authoritative.
      this.preReplayUsageSnapshot.delete(minionId);
      this.usageStore.bump(minionId);

      // Hydrate consumer breakdown from persisted cache when possible.
      // Fall back to tokenization when no cache (or stale cache) exists.
      if (aggregator.getAllMessages().length > 0) {
        this.ensureConsumersCached(minionId, aggregator);
      }

      return;
    }

    // Heartbeat events are no-ops for UI state - they exist only for connection liveness detection
    if ("type" in data && data.type === "heartbeat") {
      return;
    }

    // OPTIMIZATION: Buffer stream events until caught-up to reduce excess re-renders
    // When first subscribing to a minion, we receive:
    // 1. Historical messages from chat.jsonl (potentially hundreds of messages)
    // 2. Partial stream state (if stream was interrupted)
    // 3. Active stream events (if currently streaming)
    //
    // Without buffering, each event would trigger a separate re-render as messages
    // arrive one-by-one over IPC. By buffering until "caught-up", we:
    // - Load all historical messages in one batch (O(1) render instead of O(N))
    // - Replay buffered stream events after history is loaded
    // - Provide correct context for stream continuation (history is complete)
    //
    // This is especially important for minions with long histories (100+ messages),
    // where unbuffered rendering would cause visible lag and UI stutter.
    if (!transient.caughtUp && this.isBufferedEvent(data)) {
      transient.pendingStreamEvents.push(data);
      return;
    }

    // Process event immediately (already caught up or not a stream event)
    this.processStreamEvent(minionId, aggregator, data);
  }

  private processStreamEvent(
    minionId: string,
    aggregator: StreamingMessageAggregator,
    data: MinionChatMessage
  ): void {
    // Handle non-buffered special events first
    if (isStreamError(data)) {
      const transient = this.assertChatTransientState(minionId);

      // Suppress side effects during buffered replay (we're just hydrating UI state), but allow
      // live errors to trigger session-expired handling even before we're "caught up".
      const allowSideEffects = !transient.replayingHistory;

      applyMinionChatEventToAggregator(aggregator, data, { allowSideEffects });

      this.states.bump(minionId);
      return;
    }

    if (isDeleteMessage(data)) {
      applyMinionChatEventToAggregator(aggregator, data);
      this.cleanupStaleLiveBashOutput(minionId, aggregator);
      this.states.bump(minionId);
      this.checkAndBumpRecencyIfChanged();
      this.usageStore.bump(minionId);
      this.consumerManager.scheduleCalculation(minionId, aggregator);
      return;
    }

    if (isBashOutputEvent(data)) {
      const hasText = data.text.length > 0;
      const hasPhase = data.phase !== undefined;
      if (!hasText && !hasPhase) return;

      const transient = this.assertChatTransientState(minionId);

      const prev = transient.liveBashOutput.get(data.toolCallId);
      const next = appendLiveBashOutputChunk(
        prev,
        { text: data.text, isError: data.isError, phase: data.phase },
        BASH_TRUNCATE_MAX_TOTAL_BYTES
      );

      // Avoid unnecessary re-renders if this event didn't change the stored state.
      if (next === prev) return;

      transient.liveBashOutput.set(data.toolCallId, next);

      // High-frequency: throttle UI updates like other delta-style events.
      this.scheduleIdleStateBump(minionId);
      return;
    }

    if (isTaskCreatedEvent(data)) {
      const transient = this.assertChatTransientState(minionId);

      // Avoid unnecessary re-renders if the taskId is unchanged.
      const prev = transient.liveTaskIds.get(data.toolCallId);
      if (prev === data.taskId) return;

      transient.liveTaskIds.set(data.toolCallId, data.taskId);

      // Low-frequency: bump immediately so the user can open the child minion quickly.
      this.states.bump(minionId);
      return;
    }
    // Try buffered event handlers (single source of truth)
    if ("type" in data && data.type in this.bufferedEventHandlers) {
      this.bufferedEventHandlers[data.type](minionId, aggregator, data);
      return;
    }

    // Regular messages (LatticeMessage without type field)
    if (isLatticeMessage(data)) {
      const transient = this.assertChatTransientState(minionId);

      if (!transient.caughtUp) {
        // Buffer historical LatticeMessages
        transient.historicalMessages.push(data);
      } else {
        // Process live events immediately (after history loaded)
        applyMinionChatEventToAggregator(aggregator, data);

        const latticeMeta = data.metadata?.latticeMetadata as { type?: string } | undefined;
        const isCompactionBoundarySummary =
          data.role === "assistant" &&
          (data.metadata?.compactionBoundary === true || latticeMeta?.type === "compaction-summary");

        if (isCompactionBoundarySummary) {
          // Live compaction prunes older messages inside the aggregator; refresh the
          // pagination cursor so "Load more" starts from the new oldest visible sequence.
          this.historyPagination.set(minionId, this.deriveHistoryPaginationState(aggregator));
        }

        this.states.bump(minionId);
        this.usageStore.bump(minionId);
        this.checkAndBumpRecencyIfChanged();
      }
      return;
    }

    // If we reach here, unknown message type - log for debugging
    if ("role" in data || "type" in data) {
      console.error("[MinionStore] Unknown message type - not processed", {
        minionId,
        hasRole: "role" in data,
        hasType: "type" in data,
        type: "type" in data ? (data as { type: string }).type : undefined,
        role: "role" in data ? (data as { role: string }).role : undefined,
      });
    }
    // Note: Messages without role/type are silently ignored (expected for some IPC events)
  }
}

// ============================================================================
// React Integration with useSyncExternalStore
// ============================================================================

// Singleton store instance
let storeInstance: MinionStore | null = null;

/**
 * Get or create the singleton MinionStore instance.
 */
function getStoreInstance(): MinionStore {
  storeInstance ??= new MinionStore(() => {
    // Model tracking callback - can hook into other systems if needed
  });
  return storeInstance;
}

/**
 * Direct access to the singleton store instance.
 * Use this for non-hook subscriptions (e.g., in useEffect callbacks).
 */
export const minionStore = {
  subscribeFileModifyingTool: (listener: (minionId: string) => void, minionId?: string) =>
    getStoreInstance().subscribeFileModifyingTool(listener, minionId),
  getFileModifyingToolMs: (minionId: string) =>
    getStoreInstance().getFileModifyingToolMs(minionId),
  clearFileModifyingToolMs: (minionId: string) =>
    getStoreInstance().clearFileModifyingToolMs(minionId),
  /**
   * Simulate a file-modifying tool completion for testing.
   * Triggers the same subscription as a real tool-call-end for file_edit_* or bash.
   */
  simulateFileModifyingToolEnd: (minionId: string) =>
    getStoreInstance().simulateFileModifyingToolEnd(minionId),
  /**
   * Get sidebar-specific state for a minion.
   * Useful in tests for checking recencyTimestamp without hooks.
   */
  getMinionSidebarState: (minionId: string) =>
    getStoreInstance().getMinionSidebarState(minionId),
  /**
   * Register a minion in the store (idempotent).
   * Exposed for test helpers that need to ensure minion registration
   * before setting it as active.
   */
  addMinion: (metadata: FrontendMinionMetadata) => getStoreInstance().addMinion(metadata),
  /**
   * Set the active minion for onChat subscription management.
   * Exposed for test helpers that bypass React routing effects.
   */
  setActiveMinionId: (minionId: string | null) =>
    getStoreInstance().setActiveMinionId(minionId),
};

/**
 * Hook to get state for a specific minion.
 * Only re-renders when THIS minion's state changes.
 *
 * Uses per-key subscription for surgical updates - only notified when
 * this specific minion's state changes.
 */
export function useMinionState(minionId: string): MinionState {
  const store = getStoreInstance();

  return useSyncExternalStore(
    (listener) => store.subscribeKey(minionId, listener),
    () => store.getMinionState(minionId)
  );
}

/**
 * Hook to access the raw store for imperative operations.
 */
export function useMinionStoreRaw(): MinionStore {
  return getStoreInstance();
}

/**
 * Hook to get minion recency timestamps.
 * Subscribes to derived state since recency is updated via derived.bump("recency").
 */
export function useMinionRecency(): Record<string, number> {
  const store = getStoreInstance();

  return useSyncExternalStore(store.subscribeDerived, () => store.getMinionRecency());
}

/**
 * Hook to get sidebar-specific state for a minion.
 * Only re-renders when sidebar-relevant fields change (not on every message).
 *
 * getMinionSidebarState returns cached references, so this won't cause
 * unnecessary re-renders even when the subscription fires.
 */
export function useMinionSidebarState(minionId: string): MinionSidebarState {
  const store = getStoreInstance();

  return useSyncExternalStore(
    (listener) => store.subscribeKey(minionId, listener),
    () => store.getMinionSidebarState(minionId)
  );
}

/**
 * Hook to get UI-only live stdout/stderr for a running bash tool call.
 */
export function useBashToolLiveOutput(
  minionId: string | undefined,
  toolCallId: string | undefined
): LiveBashOutputView | null {
  const store = getStoreInstance();

  return useSyncExternalStore(
    (listener) => {
      if (!minionId) return () => undefined;
      return store.subscribeKey(minionId, listener);
    },
    () => {
      if (!minionId || !toolCallId) return null;
      return store.getBashToolLiveOutput(minionId, toolCallId);
    }
  );
}

/**
 * Hook to get UI-only taskId for a running task tool call.
 *
 * This exists because foreground tasks (run_in_background=false) won't return a tool result
 * until the child minion finishes, but we still want to expose the spawned taskId ASAP.
 */
export function useTaskToolLiveTaskId(
  minionId: string | undefined,
  toolCallId: string | undefined
): string | null {
  const store = getStoreInstance();

  return useSyncExternalStore(
    (listener) => {
      if (!minionId) return () => undefined;
      return store.subscribeKey(minionId, listener);
    },
    () => {
      if (!minionId || !toolCallId) return null;
      return store.getTaskToolLiveTaskId(minionId, toolCallId);
    }
  );
}

/**
 * Hook to get the toolCallId of the latest streaming (executing) bash.
 * Returns null if no bash is currently streaming.
 * Used by BashToolCall to auto-expand/collapse.
 */
export function useLatestStreamingBashId(minionId: string | undefined): string | null {
  const store = getStoreInstance();

  return useSyncExternalStore(
    (listener) => {
      if (!minionId) return () => undefined;
      return store.subscribeKey(minionId, listener);
    },
    () => {
      if (!minionId) return null;
      const aggregator = store.getAggregator(minionId);
      if (!aggregator) return null;
      // Aggregator caches the result, so this is O(1) on subsequent calls
      return aggregator.getLatestStreamingBashToolCallId();
    }
  );
}

/**
 * Hook to get an aggregator for a minion.
 */
export function useMinionAggregator(
  minionId: string
): StreamingMessageAggregator | undefined {
  const store = useMinionStoreRaw();
  return store.getAggregator(minionId);
}

/**
 * Disable the displayed message cap for a minion and trigger a re-render.
 * Used by HistoryHiddenMessage “Load all”.
 */
export function showAllMessages(minionId: string): void {
  assert(
    typeof minionId === "string" && minionId.length > 0,
    "showAllMessages requires minionId"
  );

  const store = getStoreInstance();
  const aggregator = store.getAggregator(minionId);
  if (aggregator) {
    aggregator.setShowAllMessages(true);
    store.bumpState(minionId);
  }
}

/**
 * Add an ephemeral message to a minion and trigger a re-render.
 * Used for displaying frontend-only messages like /plan output.
 */
export function addEphemeralMessage(minionId: string, message: LatticeMessage): void {
  const store = getStoreInstance();
  const aggregator = store.getAggregator(minionId);
  if (aggregator) {
    aggregator.addMessage(message);
    store.bumpState(minionId);
  }
}

/**
 * Remove an ephemeral message from a minion and trigger a re-render.
 * Used for dismissing frontend-only messages like /plan output.
 */
export function removeEphemeralMessage(minionId: string, messageId: string): void {
  const store = getStoreInstance();
  const aggregator = store.getAggregator(minionId);
  if (aggregator) {
    aggregator.removeMessage(messageId);
    store.bumpState(minionId);
  }
}

/**
 * Hook for usage metadata (instant, no tokenization).
 * Updates immediately when usage metadata arrives from API responses.
 */
export function useMinionUsage(minionId: string): MinionUsageState {
  const store = getStoreInstance();
  return useSyncExternalStore(
    (listener) => store.subscribeUsage(minionId, listener),
    () => store.getMinionUsage(minionId)
  );
}

/**
 * Hook for backend timing stats snapshots.
 */
export function useMinionStatsSnapshot(minionId: string): MinionStatsSnapshot | null {
  const store = getStoreInstance();

  // NOTE: subscribeStats() starts/stops a backend subscription; if React re-subscribes on every
  // render (because the subscribe callback is unstable), we can trigger an infinite loop.
  // This useCallback is for correctness, not performance.
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeStats(minionId, listener),
    [store, minionId]
  );
  const getSnapshot = useCallback(
    () => store.getMinionStatsSnapshot(minionId),
    [store, minionId]
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Hook for consumer breakdown (lazy, with tokenization).
 * Updates after async Web Worker calculation completes.
 */
export function useMinionConsumers(minionId: string): MinionConsumersState {
  const store = getStoreInstance();
  return useSyncExternalStore(
    (listener) => store.subscribeConsumers(minionId, listener),
    () => store.getMinionConsumers(minionId)
  );
}
