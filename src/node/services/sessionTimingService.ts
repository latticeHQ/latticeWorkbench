import assert from "@/common/utils/assert";
import * as fs from "fs/promises";
import * as path from "path";
import { EventEmitter } from "events";
import writeFileAtomic from "write-file-atomic";
import type { Config } from "@/node/config";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";
import type { AgentMode } from "@/common/types/mode";
import {
  ActiveStreamStatsSchema,
  CompletedStreamStatsSchema,
  SessionTimingFileSchema,
} from "@/common/orpc/schemas/minionStats";
import type {
  ActiveStreamStats,
  CompletedStreamStats,
  SessionTimingFile,
  TimingAnomaly,
  MinionStatsSnapshot,
} from "@/common/orpc/schemas/minionStats";
import type {
  StreamStartEvent,
  StreamDeltaEvent,
  ReasoningDeltaEvent,
  ToolCallStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  StreamEndEvent,
  StreamAbortEvent,
} from "@/common/types/stream";
import { createDeltaStorage, type DeltaRecordStorage } from "@/common/utils/tokens/tps";
import { log } from "./log";
import type { TelemetryService } from "./telemetryService";
import { roundToBase2 } from "@/common/telemetry/utils";

const SESSION_TIMING_FILE = "session-timing.json";
const SESSION_TIMING_VERSION = 2 as const;

// Token/tool deltas can arrive very quickly; waking subscribers on every delta can create
// unnecessary pressure throughout the backend. We rate-limit delta-driven change events
// per-minion.
const DELTA_EMIT_THROTTLE_MS = 100;

export type StatsTabVariant = "control" | "stats";
export type StatsTabOverride = "default" | "on" | "off";

export interface StatsTabState {
  enabled: boolean;
  variant: StatsTabVariant;
  override: StatsTabOverride;
}

interface ActiveStreamState {
  minionId: string;
  messageId: string;
  model: string;
  mode?: AgentMode;
  agentId?: string;

  startTimeMs: number;
  firstTokenTimeMs: number | null;

  /**
   * Tool execution wall-clock time (union of overlapping tool calls) accumulated so far.
   *
   * Note: We intentionally do NOT sum per-tool durations, because tools can run concurrently.
   */
  toolWallMs: number;
  /** Start time of the current "≥1 tool running" segment, if any. */
  toolWallStartMs: number | null;
  pendingToolStarts: Map<string, number>;

  outputTokensByDelta: number;
  reasoningTokensByDelta: number;

  deltaStorage: DeltaRecordStorage;

  lastEventTimestampMs: number;
}

function getModelKey(model: string, mode: AgentMode | undefined, agentId?: string): string {
  if (agentId) return `${model}:${agentId}`;
  return mode ? `${model}:${mode}` : model;
}

function createEmptyTimingFile(): SessionTimingFile {
  return {
    version: SESSION_TIMING_VERSION,
    session: {
      totalDurationMs: 0,
      totalToolExecutionMs: 0,
      totalStreamingMs: 0,
      totalTtftMs: 0,
      ttftCount: 0,
      responseCount: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
      byModel: {},
    },
  };
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function validateTiming(params: {
  totalDurationMs: number;
  toolExecutionMs: number;
  ttftMs: number | null;
  modelTimeMs: number;
  streamingMs: number;
}): { invalid: boolean; anomalies: TimingAnomaly[] } {
  const anomalies: TimingAnomaly[] = [];

  if (
    !isFiniteNumber(params.totalDurationMs) ||
    !isFiniteNumber(params.toolExecutionMs) ||
    !isFiniteNumber(params.modelTimeMs) ||
    !isFiniteNumber(params.streamingMs) ||
    (params.ttftMs !== null && !isFiniteNumber(params.ttftMs))
  ) {
    anomalies.push("nan");
  }

  if (
    params.totalDurationMs < 0 ||
    params.toolExecutionMs < 0 ||
    params.modelTimeMs < 0 ||
    params.streamingMs < 0 ||
    (params.ttftMs !== null && params.ttftMs < 0)
  ) {
    anomalies.push("negative_duration");
  }

  if (params.toolExecutionMs > params.totalDurationMs) {
    anomalies.push("tool_gt_total");
  }

  if (params.ttftMs !== null && params.ttftMs > params.totalDurationMs) {
    anomalies.push("ttft_gt_total");
  }

  if (params.totalDurationMs > 0) {
    const toolPercent = (params.toolExecutionMs / params.totalDurationMs) * 100;
    const modelPercent = (params.modelTimeMs / params.totalDurationMs) * 100;
    if (
      toolPercent < 0 ||
      toolPercent > 100 ||
      modelPercent < 0 ||
      modelPercent > 100 ||
      !Number.isFinite(toolPercent) ||
      !Number.isFinite(modelPercent)
    ) {
      anomalies.push("percent_out_of_range");
    }
  }

  return { invalid: anomalies.length > 0, anomalies };
}

/**
 * SessionTimingService
 *
 * Backend source-of-truth for timing stats.
 * - Keeps active stream timing in memory
 * - Persists cumulative session timing to ~/.lattice/sessions/{minionId}/session-timing.json
 * - Emits snapshots to oRPC subscribers
 */
export class SessionTimingService {
  private readonly config: Config;
  private readonly telemetryService: TelemetryService;
  private readonly fileLocks = minionFileLocks;

  private readonly activeStreams = new Map<string, ActiveStreamState>();
  private readonly timingFileCache = new Map<string, SessionTimingFile>();

  private readonly emitter = new EventEmitter();
  private readonly subscriberCounts = new Map<string, number>();

  // Serialize disk writes per minion; useful for tests and crash-safe ordering.
  private readonly pendingWrites = new Map<string, Promise<void>>();
  private readonly writeEpoch = new Map<string, number>();
  private readonly tickIntervals = new Map<string, ReturnType<typeof setInterval>>();

  private readonly deltaEmitState = new Map<
    string,
    { lastEmitTimeMs: number; timer?: ReturnType<typeof setTimeout> }
  >();

  private statsTabState: StatsTabState = {
    enabled: false,
    variant: "control",
    override: "default",
  };

  constructor(config: Config, telemetryService: TelemetryService) {
    this.config = config;
    this.telemetryService = telemetryService;
  }

  setStatsTabState(state: StatsTabState): void {
    this.statsTabState = state;
  }

  isEnabled(): boolean {
    return this.statsTabState.enabled;
  }

  addSubscriber(minionId: string): void {
    const next = (this.subscriberCounts.get(minionId) ?? 0) + 1;
    this.subscriberCounts.set(minionId, next);
    this.ensureTicking(minionId);
  }

  removeSubscriber(minionId: string): void {
    const current = this.subscriberCounts.get(minionId) ?? 0;
    const next = Math.max(0, current - 1);
    if (next === 0) {
      this.subscriberCounts.delete(minionId);

      const interval = this.tickIntervals.get(minionId);
      if (interval) {
        clearInterval(interval);
        this.tickIntervals.delete(minionId);
      }

      this.clearDeltaEmitState(minionId);
      return;
    }
    this.subscriberCounts.set(minionId, next);
  }

  onStatsChange(listener: (minionId: string) => void): void {
    this.emitter.on("change", listener);
  }

  offStatsChange(listener: (minionId: string) => void): void {
    this.emitter.off("change", listener);
  }

  private emitChange(minionId: string): void {
    // Only wake subscribers if anyone is listening for this minion.
    if ((this.subscriberCounts.get(minionId) ?? 0) === 0) {
      return;
    }
    this.emitter.emit("change", minionId);
  }

  private clearDeltaEmitState(minionId: string): void {
    const state = this.deltaEmitState.get(minionId);
    if (!state) {
      return;
    }

    if (state.timer) {
      clearTimeout(state.timer);
    }

    this.deltaEmitState.delete(minionId);
  }

  private emitDeltaChangeImmediate(minionId: string): void {
    // Avoid allocating timers/state when nothing is subscribed.
    if ((this.subscriberCounts.get(minionId) ?? 0) === 0) {
      return;
    }

    const state = this.deltaEmitState.get(minionId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }

    this.deltaEmitState.set(minionId, { lastEmitTimeMs: Date.now() });
    this.emitChange(minionId);
  }

  private emitDeltaChangeThrottled(minionId: string): void {
    // Avoid allocating timers/state when nothing is subscribed.
    if ((this.subscriberCounts.get(minionId) ?? 0) === 0) {
      return;
    }

    const now = Date.now();

    const state = this.deltaEmitState.get(minionId) ?? { lastEmitTimeMs: 0 };
    const timeSinceLastEmit = now - state.lastEmitTimeMs;

    // If enough time has passed, emit immediately.
    if (timeSinceLastEmit >= DELTA_EMIT_THROTTLE_MS) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = undefined;
      }

      state.lastEmitTimeMs = now;
      this.deltaEmitState.set(minionId, state);
      this.emitChange(minionId);
      return;
    }

    // Otherwise, schedule one trailing emit at the first allowed time.
    if (state.timer) {
      this.deltaEmitState.set(minionId, state);
      return;
    }

    const remainingTime = Math.max(0, DELTA_EMIT_THROTTLE_MS - timeSinceLastEmit);
    const timer = setTimeout(() => {
      // Timer may have been cleared/replaced by an immediate emit.
      const currentState = this.deltaEmitState.get(minionId);
      if (currentState?.timer !== timer) {
        return;
      }

      currentState.timer = undefined;

      // If there are no subscribers anymore, clean up.
      if ((this.subscriberCounts.get(minionId) ?? 0) === 0) {
        this.deltaEmitState.delete(minionId);
        return;
      }

      currentState.lastEmitTimeMs = Date.now();
      this.emitChange(minionId);
    }, remainingTime);

    // Avoid keeping Node (or Jest workers) alive due to a leaked throttle timer.
    timer.unref?.();

    state.timer = timer;
    this.deltaEmitState.set(minionId, state);
  }

  private ensureTicking(minionId: string): void {
    if (this.tickIntervals.has(minionId)) {
      return;
    }

    // Tick only while there is an active stream.
    const interval = setInterval(() => {
      if (!this.activeStreams.has(minionId)) {
        return;
      }
      this.emitChange(minionId);
    }, 1000);

    // Avoid keeping Node (or Jest workers) alive due to a leaked tick interval.
    interval.unref?.();

    this.tickIntervals.set(minionId, interval);
  }

  private getFilePath(minionId: string): string {
    return path.join(this.config.getSessionDir(minionId), SESSION_TIMING_FILE);
  }

  private async readTimingFile(minionId: string): Promise<SessionTimingFile> {
    try {
      const data = await fs.readFile(this.getFilePath(minionId), "utf-8");
      const parsed = JSON.parse(data) as unknown;

      // Stats semantics may change over time. If we can't safely interpret old versions,
      // reset without treating it as file corruption.
      if (parsed && typeof parsed === "object" && "version" in parsed) {
        const version = (parsed as { version?: unknown }).version;
        if (version !== SESSION_TIMING_VERSION) {
          return createEmptyTimingFile();
        }
      }

      return SessionTimingFileSchema.parse(parsed);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return createEmptyTimingFile();
      }
      log.warn(`session-timing.json corrupted for ${minionId}; resetting`, { error });
      return createEmptyTimingFile();
    }
  }

  private async writeTimingFile(minionId: string, data: SessionTimingFile): Promise<void> {
    const filePath = this.getFilePath(minionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
  }

  async waitForIdle(minionId: string): Promise<void> {
    await (this.pendingWrites.get(minionId) ?? Promise.resolve());
  }

  private applyCompletedStreamToFile(
    file: SessionTimingFile,
    completed: CompletedStreamStats
  ): void {
    file.lastRequest = completed;

    file.session.totalDurationMs += completed.totalDurationMs;
    file.session.totalToolExecutionMs += completed.toolExecutionMs;
    file.session.totalStreamingMs += completed.streamingMs;
    if (completed.ttftMs !== null) {
      file.session.totalTtftMs += completed.ttftMs;
      file.session.ttftCount += 1;
    }
    file.session.responseCount += 1;
    file.session.totalOutputTokens += completed.outputTokens;
    file.session.totalReasoningTokens += completed.reasoningTokens;

    const key = getModelKey(completed.model, completed.mode, completed.agentId);
    const existing = file.session.byModel[key];
    const base = existing ?? {
      model: completed.model,
      mode: completed.mode,
      agentId: completed.agentId,
      totalDurationMs: 0,
      totalToolExecutionMs: 0,
      totalStreamingMs: 0,
      totalTtftMs: 0,
      ttftCount: 0,
      responseCount: 0,
      totalOutputTokens: 0,
      totalReasoningTokens: 0,
    };

    // Upgrade legacy entries (mode-only) as we observe agent ids.
    base.mode ??= completed.mode;
    base.agentId ??= completed.agentId;

    base.totalDurationMs += completed.totalDurationMs;
    base.totalToolExecutionMs += completed.toolExecutionMs;
    base.totalStreamingMs += completed.streamingMs;
    if (completed.ttftMs !== null) {
      base.totalTtftMs += completed.ttftMs;
      base.ttftCount += 1;
    }
    base.responseCount += 1;
    base.totalOutputTokens += completed.outputTokens;
    base.totalReasoningTokens += completed.reasoningTokens;

    file.session.byModel[key] = base;
  }

  private queuePersistCompletedStream(minionId: string, completed: CompletedStreamStats): void {
    const epoch = this.writeEpoch.get(minionId) ?? 0;

    const previous = this.pendingWrites.get(minionId) ?? Promise.resolve();

    const next = previous
      .then(async () => {
        await this.fileLocks.withLock(minionId, async () => {
          // If a clear() happened after this persist was scheduled, skip.
          if ((this.writeEpoch.get(minionId) ?? 0) !== epoch) {
            return;
          }

          const current = await this.readTimingFile(minionId);
          this.applyCompletedStreamToFile(current, completed);

          await this.writeTimingFile(minionId, current);
          this.timingFileCache.set(minionId, current);
        });

        // Telemetry (only when feature enabled)
        const durationSecs = Math.max(0, completed.totalDurationMs / 1000);

        const toolPercentBucket =
          completed.totalDurationMs > 0
            ? Math.max(
                0,
                Math.min(
                  100,
                  Math.round(((completed.toolExecutionMs / completed.totalDurationMs) * 100) / 5) *
                    5
                )
              )
            : 0;

        const telemetryAgentId = completed.agentId ?? completed.mode ?? "exec";

        this.telemetryService.capture({
          event: "stream_timing_computed",
          properties: {
            model: completed.model,
            agentId: telemetryAgentId,
            duration_b2: roundToBase2(durationSecs),
            ttft_ms_b2: completed.ttftMs !== null ? roundToBase2(completed.ttftMs) : 0,
            tool_ms_b2: roundToBase2(completed.toolExecutionMs),
            streaming_ms_b2: roundToBase2(completed.streamingMs),
            tool_percent_bucket: toolPercentBucket,
            invalid: completed.invalid,
          },
        });

        if (completed.invalid) {
          const reason = completed.anomalies[0] ?? "unknown";
          this.telemetryService.capture({
            event: "stream_timing_invalid",
            properties: {
              reason,
            },
          });
        }
      })
      .catch((error) => {
        log.warn(`Failed to persist session-timing.json for ${minionId}`, error);
      });

    this.pendingWrites.set(minionId, next);
  }
  private async getCachedTimingFile(minionId: string): Promise<SessionTimingFile> {
    const cached = this.timingFileCache.get(minionId);
    if (cached) {
      return cached;
    }

    const loaded = await this.fileLocks.withLock(minionId, async () => {
      return this.readTimingFile(minionId);
    });
    this.timingFileCache.set(minionId, loaded);
    return loaded;
  }

  async clearTimingFile(minionId: string): Promise<void> {
    // Invalidate any pending writes.
    this.writeEpoch.set(minionId, (this.writeEpoch.get(minionId) ?? 0) + 1);

    await this.fileLocks.withLock(minionId, async () => {
      this.timingFileCache.delete(minionId);
      try {
        await fs.unlink(this.getFilePath(minionId));
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    });

    this.emitChange(minionId);
  }

  /**
   * Merge child timing into the parent minion.
   *
   * Used to preserve sidekick timing when the child minion is deleted.
   *
   * IMPORTANT:
   * - Does not update parent's lastRequest
   * - Uses an on-disk idempotency ledger (rolledUpFrom) to prevent double-counting
   */
  async rollUpTimingIntoParent(
    parentMinionId: string,
    childMinionId: string
  ): Promise<{ didRollUp: boolean }> {
    assert(parentMinionId.trim().length > 0, "rollUpTimingIntoParent: parentMinionId empty");
    assert(childMinionId.trim().length > 0, "rollUpTimingIntoParent: childMinionId empty");
    assert(
      parentMinionId !== childMinionId,
      "rollUpTimingIntoParent: parentMinionId must differ from childMinionId"
    );

    // Defensive: don't create new session dirs for already-deleted parents.
    if (!this.config.findMinion(parentMinionId)) {
      return { didRollUp: false };
    }

    // Read child timing before acquiring parent lock to avoid multi-minion lock ordering issues.
    const childTiming = await this.readTimingFile(childMinionId);
    if (childTiming.session.responseCount <= 0) {
      return { didRollUp: false };
    }

    return this.fileLocks.withLock(parentMinionId, async () => {
      const parentTiming = await this.readTimingFile(parentMinionId);

      if (parentTiming.rolledUpFrom?.[childMinionId]) {
        return { didRollUp: false };
      }

      parentTiming.session.totalDurationMs += childTiming.session.totalDurationMs;
      parentTiming.session.totalToolExecutionMs += childTiming.session.totalToolExecutionMs;
      parentTiming.session.totalStreamingMs += childTiming.session.totalStreamingMs;
      parentTiming.session.totalTtftMs += childTiming.session.totalTtftMs;
      parentTiming.session.ttftCount += childTiming.session.ttftCount;
      parentTiming.session.responseCount += childTiming.session.responseCount;
      parentTiming.session.totalOutputTokens += childTiming.session.totalOutputTokens;
      parentTiming.session.totalReasoningTokens += childTiming.session.totalReasoningTokens;

      for (const childEntry of Object.values(childTiming.session.byModel)) {
        const key = getModelKey(childEntry.model, childEntry.mode, childEntry.agentId);
        const existing = parentTiming.session.byModel[key];
        const base = existing ?? {
          model: childEntry.model,
          mode: childEntry.mode,
          agentId: childEntry.agentId,
          totalDurationMs: 0,
          totalToolExecutionMs: 0,
          totalStreamingMs: 0,
          totalTtftMs: 0,
          ttftCount: 0,
          responseCount: 0,
          totalOutputTokens: 0,
          totalReasoningTokens: 0,
        };

        // Upgrade legacy entries (mode-only) as we observe agent ids.
        base.mode ??= childEntry.mode;
        base.agentId ??= childEntry.agentId;

        // Defensive: key mismatches should not crash; prefer child data as source of truth.
        const existingSplit = existing?.agentId ?? existing?.mode;
        const incomingSplit = childEntry.agentId ?? childEntry.mode;
        if (existing && (existing.model !== childEntry.model || existingSplit !== incomingSplit)) {
          log.warn("Session timing byModel entry mismatch during roll-up", {
            parentMinionId,
            childMinionId,
            key,
            existing: { model: existing.model, mode: existing.mode, agentId: existing.agentId },
            incoming: {
              model: childEntry.model,
              mode: childEntry.mode,
              agentId: childEntry.agentId,
            },
          });
        }

        base.totalDurationMs += childEntry.totalDurationMs;
        base.totalToolExecutionMs += childEntry.totalToolExecutionMs;
        base.totalStreamingMs += childEntry.totalStreamingMs;
        base.totalTtftMs += childEntry.totalTtftMs;
        base.ttftCount += childEntry.ttftCount;
        base.responseCount += childEntry.responseCount;
        base.totalOutputTokens += childEntry.totalOutputTokens;
        base.totalReasoningTokens += childEntry.totalReasoningTokens;

        parentTiming.session.byModel[key] = base;
      }

      parentTiming.rolledUpFrom = {
        ...(parentTiming.rolledUpFrom ?? {}),
        [childMinionId]: true,
      };

      await this.writeTimingFile(parentMinionId, parentTiming);
      this.timingFileCache.set(parentMinionId, parentTiming);

      this.emitChange(parentMinionId);

      return { didRollUp: true };
    });
  }

  getActiveStreamStats(minionId: string): ActiveStreamStats | undefined {
    const state = this.activeStreams.get(minionId);
    if (!state) return undefined;

    const now = Date.now();
    const elapsedMs = Math.max(0, now - state.startTimeMs);

    let toolExecutionMs = state.toolWallMs;

    if (state.toolWallStartMs !== null) {
      toolExecutionMs += Math.max(0, now - state.toolWallStartMs);
    } else if (state.pendingToolStarts.size > 0) {
      // Defensive recovery: tools are running but we lost the current wall segment start.
      const minStart = Math.min(...Array.from(state.pendingToolStarts.values()));
      toolExecutionMs += Math.max(0, now - minStart);
    }

    const ttftMs =
      state.firstTokenTimeMs !== null
        ? Math.max(0, state.firstTokenTimeMs - state.startTimeMs)
        : null;

    const modelTimeMs = Math.max(0, elapsedMs - toolExecutionMs);
    const streamingMs = Math.max(0, elapsedMs - toolExecutionMs - (ttftMs ?? 0));

    const validation = validateTiming({
      totalDurationMs: elapsedMs,
      toolExecutionMs,
      ttftMs,
      modelTimeMs,
      streamingMs,
    });

    const stats: ActiveStreamStats = {
      messageId: state.messageId,
      model: state.model,
      mode: state.mode,
      agentId: state.agentId,
      elapsedMs,
      ttftMs,
      toolExecutionMs,
      modelTimeMs,
      streamingMs,
      outputTokens: state.outputTokensByDelta,
      reasoningTokens: state.reasoningTokensByDelta,
      liveTokenCount: state.deltaStorage.getTokenCount(),
      liveTPS: state.deltaStorage.calculateTPS(now),
      invalid: validation.invalid,
      anomalies: validation.anomalies,
    };

    return ActiveStreamStatsSchema.parse(stats);
  }

  async getSnapshot(minionId: string): Promise<MinionStatsSnapshot> {
    const file = await this.getCachedTimingFile(minionId);
    const active = this.getActiveStreamStats(minionId);

    return {
      minionId,
      generatedAt: Date.now(),
      active,
      lastRequest: file.lastRequest,
      session: file.session,
    };
  }

  // --- Stream event handlers (wired from AIService) ---

  handleStreamStart(data: StreamStartEvent): void {
    if (data.replay === true) return;
    if (!this.isEnabled()) return;

    assert(typeof data.minionId === "string" && data.minionId.length > 0);
    assert(typeof data.messageId === "string" && data.messageId.length > 0);

    const model = data.model;

    // Validate mode: stats schema only accepts "plan" | "exec" for now.
    // Custom modes will need schema updates when supported.
    const mode = data.mode === "plan" || data.mode === "exec" ? data.mode : undefined;
    const agentId =
      typeof data.agentId === "string" && data.agentId.trim().length > 0 ? data.agentId : undefined;

    const state: ActiveStreamState = {
      minionId: data.minionId,
      messageId: data.messageId,
      model,
      mode,
      agentId,
      startTimeMs: data.startTime,
      firstTokenTimeMs: null,
      toolWallMs: 0,
      toolWallStartMs: null,
      pendingToolStarts: new Map(),
      outputTokensByDelta: 0,
      reasoningTokensByDelta: 0,
      deltaStorage: createDeltaStorage(),
      lastEventTimestampMs: data.startTime,
    };

    this.activeStreams.set(data.minionId, state);
    this.emitChange(data.minionId);
  }

  handleStreamDelta(data: StreamDeltaEvent): void {
    if (data.replay === true) return;
    const state = this.activeStreams.get(data.minionId);
    if (!state) return;

    state.lastEventTimestampMs = Math.max(state.lastEventTimestampMs, data.timestamp);

    const isFirstToken = data.delta.length > 0 && state.firstTokenTimeMs === null;
    if (isFirstToken) {
      state.firstTokenTimeMs = data.timestamp;
    }

    state.outputTokensByDelta += data.tokens;
    state.deltaStorage.addDelta({ tokens: data.tokens, timestamp: data.timestamp, type: "text" });

    if (isFirstToken) {
      // TTFT is user-visible; emit immediately.
      this.emitDeltaChangeImmediate(data.minionId);
    } else {
      this.emitDeltaChangeThrottled(data.minionId);
    }
  }

  handleReasoningDelta(data: ReasoningDeltaEvent): void {
    if (data.replay === true) return;
    const state = this.activeStreams.get(data.minionId);
    if (!state) return;

    state.lastEventTimestampMs = Math.max(state.lastEventTimestampMs, data.timestamp);

    const isFirstToken = data.delta.length > 0 && state.firstTokenTimeMs === null;
    if (isFirstToken) {
      state.firstTokenTimeMs = data.timestamp;
    }

    state.reasoningTokensByDelta += data.tokens;
    state.deltaStorage.addDelta({
      tokens: data.tokens,
      timestamp: data.timestamp,
      type: "reasoning",
    });

    if (isFirstToken) {
      // TTFT is user-visible; emit immediately.
      this.emitDeltaChangeImmediate(data.minionId);
    } else {
      this.emitDeltaChangeThrottled(data.minionId);
    }
  }

  handleToolCallStart(data: ToolCallStartEvent): void {
    if (data.replay === true) return;
    const state = this.activeStreams.get(data.minionId);
    if (!state) return;

    state.lastEventTimestampMs = Math.max(state.lastEventTimestampMs, data.timestamp);

    // Defensive: ignore duplicate tool-call-start events.
    if (state.pendingToolStarts.has(data.toolCallId)) {
      return;
    }

    if (state.pendingToolStarts.size === 0) {
      state.toolWallStartMs = data.timestamp;
    } else if (state.toolWallStartMs !== null) {
      state.toolWallStartMs = Math.min(state.toolWallStartMs, data.timestamp);
    } else {
      // Should not happen: tools are running but we lost the current wall segment start.
      // Recover using the earliest start we still know about.
      state.toolWallStartMs = Math.min(
        data.timestamp,
        ...Array.from(state.pendingToolStarts.values())
      );
    }

    state.pendingToolStarts.set(data.toolCallId, data.timestamp);

    // Tool args contribute to the visible token count + TPS.
    state.deltaStorage.addDelta({
      tokens: data.tokens,
      timestamp: data.timestamp,
      type: "tool-args",
    });

    this.emitChange(data.minionId);
  }

  handleToolCallDelta(data: ToolCallDeltaEvent): void {
    if (data.replay === true) return;
    const state = this.activeStreams.get(data.minionId);
    if (!state) return;

    state.lastEventTimestampMs = Math.max(state.lastEventTimestampMs, data.timestamp);
    state.deltaStorage.addDelta({
      tokens: data.tokens,
      timestamp: data.timestamp,
      type: "tool-args",
    });

    this.emitDeltaChangeThrottled(data.minionId);
  }

  handleToolCallEnd(data: ToolCallEndEvent): void {
    if (data.replay === true) return;
    const state = this.activeStreams.get(data.minionId);
    if (!state) return;

    state.lastEventTimestampMs = Math.max(state.lastEventTimestampMs, data.timestamp);

    const start = state.pendingToolStarts.get(data.toolCallId);
    if (start === undefined) {
      this.emitChange(data.minionId);
      return;
    }

    state.pendingToolStarts.delete(data.toolCallId);

    // If this was the last in-flight tool, close the current "tool wall time" segment.
    if (state.pendingToolStarts.size === 0) {
      const segmentStart = state.toolWallStartMs ?? start;
      state.toolWallMs += Math.max(0, data.timestamp - segmentStart);
      state.toolWallStartMs = null;
    }

    this.emitChange(data.minionId);
  }

  private isEmptyAbortForTiming(state: ActiveStreamState, usage: unknown): boolean {
    const usageObj = usage as { outputTokens?: unknown; reasoningTokens?: unknown } | undefined;
    const outputTokens = typeof usageObj?.outputTokens === "number" ? usageObj.outputTokens : 0;
    const reasoningTokens =
      typeof usageObj?.reasoningTokens === "number" ? usageObj.reasoningTokens : 0;

    const hasUsageTokens = outputTokens > 0 || reasoningTokens > 0;

    const hasAnyToolActivity =
      state.toolWallMs > 0 || state.toolWallStartMs !== null || state.pendingToolStarts.size > 0;

    const hasAnyTokenActivity = state.deltaStorage.getTokenCount() > 0;

    return (
      state.firstTokenTimeMs === null &&
      !hasAnyToolActivity &&
      !hasAnyTokenActivity &&
      !hasUsageTokens
    );
  }

  private computeCompletedStreamStats(params: {
    state: ActiveStreamState;
    messageId: string;
    durationMs: number;
    usage: unknown;
  }): CompletedStreamStats {
    const state = params.state;

    const endTimestamp = Math.max(
      state.lastEventTimestampMs,
      state.startTimeMs + params.durationMs
    );

    let toolExecutionMs = state.toolWallMs;

    // Close any open tool segment at stream end (can happen on abort/error).
    if (state.toolWallStartMs !== null) {
      toolExecutionMs += Math.max(0, endTimestamp - state.toolWallStartMs);
    } else if (state.pendingToolStarts.size > 0) {
      // Defensive recovery: tools are running but we lost the current wall segment start.
      const minStart = Math.min(...Array.from(state.pendingToolStarts.values()));
      toolExecutionMs += Math.max(0, endTimestamp - minStart);
    }

    const ttftMs =
      state.firstTokenTimeMs !== null
        ? Math.max(0, state.firstTokenTimeMs - state.startTimeMs)
        : null;

    const modelTimeMs = Math.max(0, params.durationMs - toolExecutionMs);
    const streamingMs = Math.max(0, params.durationMs - toolExecutionMs - (ttftMs ?? 0));

    const usage = params.usage as { outputTokens?: unknown; reasoningTokens?: unknown } | undefined;
    const outputTokens =
      typeof usage?.outputTokens === "number" ? usage.outputTokens : state.outputTokensByDelta;
    const reasoningTokens =
      typeof usage?.reasoningTokens === "number"
        ? usage.reasoningTokens
        : state.reasoningTokensByDelta;

    const validation = validateTiming({
      totalDurationMs: params.durationMs,
      toolExecutionMs,
      ttftMs,
      modelTimeMs,
      streamingMs,
    });

    const completed = {
      messageId: params.messageId,
      model: state.model,
      mode: state.mode,
      agentId: state.agentId,
      totalDurationMs: params.durationMs,
      ttftMs,
      toolExecutionMs,
      modelTimeMs,
      streamingMs,
      outputTokens,
      reasoningTokens,
      invalid: validation.invalid,
      anomalies: validation.anomalies,
    };

    return CompletedStreamStatsSchema.parse(completed);
  }

  handleStreamAbort(data: StreamAbortEvent): void {
    const state = this.activeStreams.get(data.minionId);
    if (!state) {
      this.activeStreams.delete(data.minionId);
      this.emitChange(data.minionId);
      return;
    }

    // Stop tracking active stream state immediately.
    this.activeStreams.delete(data.minionId);

    const usage = data.metadata?.usage;

    // Ignore aborted streams with no meaningful output or tool activity.
    if (this.isEmptyAbortForTiming(state, usage)) {
      this.emitChange(data.minionId);
      return;
    }

    const durationFromMetadata = data.metadata?.duration;
    const durationMs =
      typeof durationFromMetadata === "number" && Number.isFinite(durationFromMetadata)
        ? durationFromMetadata
        : Math.max(0, Date.now() - state.startTimeMs);

    const completedValidated = this.computeCompletedStreamStats({
      state,
      messageId: data.messageId,
      durationMs,
      usage,
    });

    // Optimistically update cache so subscribers see the updated session immediately.
    const cached = this.timingFileCache.get(data.minionId);
    if (cached) {
      this.applyCompletedStreamToFile(cached, completedValidated);
    }

    this.queuePersistCompletedStream(data.minionId, completedValidated);

    this.emitChange(data.minionId);
  }

  handleStreamEnd(data: StreamEndEvent): void {
    const state = this.activeStreams.get(data.minionId);
    if (!state) {
      return;
    }

    // Stop tracking active stream state immediately.
    this.activeStreams.delete(data.minionId);

    const durationFromMetadata = data.metadata.duration;
    const durationMs =
      typeof durationFromMetadata === "number" && Number.isFinite(durationFromMetadata)
        ? durationFromMetadata
        : Math.max(0, Date.now() - state.startTimeMs);

    const completedValidated = this.computeCompletedStreamStats({
      state,
      messageId: data.messageId,
      durationMs,
      usage: data.metadata.usage,
    });

    // Optimistically update cache so subscribers see the updated session immediately.
    const cached = this.timingFileCache.get(data.minionId);
    if (cached) {
      this.applyCompletedStreamToFile(cached, completedValidated);
    }

    this.queuePersistCompletedStream(data.minionId, completedValidated);

    this.emitChange(data.minionId);
  }
}
