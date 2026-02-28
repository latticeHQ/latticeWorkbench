import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { Config } from "@/node/config";
import { SessionTimingService } from "./sessionTimingService";
import type { TelemetryService } from "./telemetryService";

function createMockTelemetryService(): Pick<TelemetryService, "capture" | "getFeatureFlag"> {
  return {
    capture: mock(() => undefined),
    getFeatureFlag: mock(() => Promise.resolve(undefined)),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SessionTimingService", () => {
  let tempDir: string;
  let config: Config;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `lattice-session-timing-test-${Date.now()}-${Math.random()}`);
    await fs.mkdir(tempDir, { recursive: true });
    config = new Config(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("persists aborted stream stats to session-timing.json", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 1_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      delta: "hi",
      tokens: 5,
      timestamp: startTime + 1000,
    });

    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "echo hi" },
      tokens: 3,
      timestamp: startTime + 2000,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 3000,
    });

    service.handleStreamAbort({
      type: "stream-abort",
      minionId,
      messageId,
      metadata: {
        duration: 5000,
        usage: {
          inputTokens: 1,
          outputTokens: 10,
          totalTokens: 11,
          reasoningTokens: 2,
        },
      },
      abortReason: "system",
      abandonPartial: true,
    });

    await service.waitForIdle(minionId);

    const snapshot = await service.getSnapshot(minionId);
    expect(snapshot.lastRequest?.messageId).toBe(messageId);
    expect(snapshot.lastRequest?.totalDurationMs).toBe(5000);
    expect(snapshot.lastRequest?.toolExecutionMs).toBe(1000);
    expect(snapshot.lastRequest?.ttftMs).toBe(1000);
    expect(snapshot.lastRequest?.streamingMs).toBe(3000);
    expect(snapshot.lastRequest?.invalid).toBe(false);

    expect(snapshot.session?.responseCount).toBe(1);
  });

  it("ignores empty aborted streams", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 1_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    service.handleStreamAbort({
      type: "stream-abort",
      minionId,
      messageId,
      metadata: { duration: 1000 },
      abortReason: "user",
      abandonPartial: true,
    });

    await service.waitForIdle(minionId);

    const snapshot = await service.getSnapshot(minionId);
    expect(snapshot.lastRequest).toBeUndefined();
    expect(snapshot.session?.responseCount).toBe(0);
  });

  describe("rollUpTimingIntoParent", () => {
    it("should roll up child timing into parent without changing parent's lastRequest", async () => {
      const telemetry = createMockTelemetryService();
      const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
      service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

      const projectPath = "/tmp/lattice-session-timing-rollup-test-project";
      const model = "openai:gpt-4o";

      const parentMinionId = "parent-minion";
      const childMinionId = "child-minion";

      await config.addMinion(projectPath, {
        id: parentMinionId,
        name: "parent-branch",
        projectName: "test-project",
        projectPath,
        runtimeConfig: { type: "local" },
      });
      await config.addMinion(projectPath, {
        id: childMinionId,
        name: "child-branch",
        projectName: "test-project",
        projectPath,
        runtimeConfig: { type: "local" },
        parentMinionId: parentMinionId,
      });

      // Parent stream.
      const parentMessageId = "p1";
      const startTimeParent = 1_000_000;

      service.handleStreamStart({
        type: "stream-start",
        minionId: parentMinionId,
        messageId: parentMessageId,
        model,
        historySequence: 1,
        startTime: startTimeParent,
        mode: "exec",
      });

      service.handleStreamDelta({
        type: "stream-delta",
        minionId: parentMinionId,
        messageId: parentMessageId,
        delta: "hi",
        tokens: 5,
        timestamp: startTimeParent + 1000,
      });

      service.handleToolCallStart({
        type: "tool-call-start",
        minionId: parentMinionId,
        messageId: parentMessageId,
        toolCallId: "t1",
        toolName: "bash",
        args: { cmd: "echo hi" },
        tokens: 3,
        timestamp: startTimeParent + 2000,
      });

      service.handleToolCallEnd({
        type: "tool-call-end",
        minionId: parentMinionId,
        messageId: parentMessageId,
        toolCallId: "t1",
        toolName: "bash",
        result: { ok: true },
        timestamp: startTimeParent + 3000,
      });

      service.handleStreamEnd({
        type: "stream-end",
        minionId: parentMinionId,
        messageId: parentMessageId,
        metadata: {
          model,
          duration: 5000,
          usage: {
            inputTokens: 1,
            outputTokens: 10,
            totalTokens: 11,
            reasoningTokens: 2,
          },
        },
        parts: [],
      });

      // Child stream.
      const childMessageId = "c1";
      const startTimeChild = 2_000_000;

      service.handleStreamStart({
        type: "stream-start",
        minionId: childMinionId,
        messageId: childMessageId,
        model,
        historySequence: 1,
        startTime: startTimeChild,
        mode: "exec",
      });

      service.handleStreamDelta({
        type: "stream-delta",
        minionId: childMinionId,
        messageId: childMessageId,
        delta: "hi",
        tokens: 5,
        timestamp: startTimeChild + 200,
      });

      service.handleStreamEnd({
        type: "stream-end",
        minionId: childMinionId,
        messageId: childMessageId,
        metadata: {
          model,
          duration: 1500,
          usage: {
            inputTokens: 1,
            outputTokens: 5,
            totalTokens: 6,
          },
        },
        parts: [],
      });

      await service.waitForIdle(parentMinionId);
      await service.waitForIdle(childMinionId);

      const before = await service.getSnapshot(parentMinionId);
      expect(before.lastRequest?.messageId).toBe(parentMessageId);

      const beforeLastRequest = before.lastRequest!;

      const rollupResult = await service.rollUpTimingIntoParent(
        parentMinionId,
        childMinionId
      );
      expect(rollupResult.didRollUp).toBe(true);

      const after = await service.getSnapshot(parentMinionId);

      // lastRequest is preserved
      expect(after.lastRequest).toEqual(beforeLastRequest);

      expect(after.session?.responseCount).toBe(2);
      expect(after.session?.totalDurationMs).toBe(6500);
      expect(after.session?.totalToolExecutionMs).toBe(1000);
      expect(after.session?.totalStreamingMs).toBe(4300);
      expect(after.session?.totalTtftMs).toBe(1200);
      expect(after.session?.ttftCount).toBe(2);
      expect(after.session?.totalOutputTokens).toBe(15);
      expect(after.session?.totalReasoningTokens).toBe(2);

      const normalizedModel = model;
      const key = `${normalizedModel}:exec`;
      expect(after.session?.byModel[key]?.responseCount).toBe(2);
    });

    it("should be idempotent for the same child minion", async () => {
      const telemetry = createMockTelemetryService();
      const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
      service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

      const projectPath = "/tmp/lattice-session-timing-rollup-test-project";
      const model = "openai:gpt-4o";

      const parentMinionId = "parent-minion";
      const childMinionId = "child-minion";

      await config.addMinion(projectPath, {
        id: parentMinionId,
        name: "parent-branch",
        projectName: "test-project",
        projectPath,
        runtimeConfig: { type: "local" },
      });

      // Child stream.
      const childMessageId = "c1";
      const startTimeChild = 2_000_000;

      service.handleStreamStart({
        type: "stream-start",
        minionId: childMinionId,
        messageId: childMessageId,
        model,
        historySequence: 1,
        startTime: startTimeChild,
        mode: "exec",
      });

      service.handleStreamDelta({
        type: "stream-delta",
        minionId: childMinionId,
        messageId: childMessageId,
        delta: "hi",
        tokens: 5,
        timestamp: startTimeChild + 200,
      });

      service.handleStreamEnd({
        type: "stream-end",
        minionId: childMinionId,
        messageId: childMessageId,
        metadata: {
          model,
          duration: 1500,
          usage: {
            inputTokens: 1,
            outputTokens: 5,
            totalTokens: 6,
          },
        },
        parts: [],
      });

      await service.waitForIdle(childMinionId);

      const first = await service.rollUpTimingIntoParent(parentMinionId, childMinionId);
      expect(first.didRollUp).toBe(true);

      const second = await service.rollUpTimingIntoParent(parentMinionId, childMinionId);
      expect(second.didRollUp).toBe(false);

      const result = await service.getSnapshot(parentMinionId);
      expect(result.session?.responseCount).toBe(1);

      const timingFilePath = path.join(
        config.getSessionDir(parentMinionId),
        "session-timing.json"
      );
      const raw = await fs.readFile(timingFilePath, "utf-8");
      const parsed = JSON.parse(raw) as { rolledUpFrom?: Record<string, true> };
      expect(parsed.rolledUpFrom?.[childMinionId]).toBe(true);
    });
  });
  it("persists completed stream stats to session-timing.json", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 1_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      delta: "hi",
      tokens: 5,
      timestamp: startTime + 1000,
    });

    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "echo hi" },
      tokens: 3,
      timestamp: startTime + 2000,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 3000,
    });

    service.handleStreamEnd({
      type: "stream-end",
      minionId,
      messageId,
      metadata: {
        model,
        duration: 5000,
        usage: {
          inputTokens: 1,
          outputTokens: 10,
          totalTokens: 11,
          reasoningTokens: 2,
        },
      },
      parts: [],
    });

    await service.waitForIdle(minionId);

    const filePath = path.join(config.getSessionDir(minionId), "session-timing.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();

    const file = await service.getSnapshot(minionId);
    expect(file.lastRequest?.messageId).toBe(messageId);
    expect(file.lastRequest?.totalDurationMs).toBe(5000);
    expect(file.lastRequest?.toolExecutionMs).toBe(1000);
    expect(file.lastRequest?.ttftMs).toBe(1000);
    expect(file.lastRequest?.streamingMs).toBe(3000);
    expect(file.lastRequest?.invalid).toBe(false);

    expect(file.session?.responseCount).toBe(1);
    expect(file.session?.totalDurationMs).toBe(5000);
    expect(file.session?.totalToolExecutionMs).toBe(1000);
    expect(file.session?.totalStreamingMs).toBe(3000);
    expect(file.session?.totalOutputTokens).toBe(10);
    expect(file.session?.totalReasoningTokens).toBe(2);

    const normalizedModel = model;
    const key = `${normalizedModel}:exec`;
    expect(file.session?.byModel[key]).toBeDefined();
    expect(file.session?.byModel[key]?.responseCount).toBe(1);
  });

  it("uses agentId for the per-model breakdown when available", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 1_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
      agentId: "explore",
    });

    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      delta: "hi",
      tokens: 5,
      timestamp: startTime + 100,
    });

    service.handleStreamEnd({
      type: "stream-end",
      minionId,
      messageId,
      metadata: {
        model,
        duration: 500,
        usage: {
          inputTokens: 1,
          outputTokens: 10,
          totalTokens: 11,
        },
      },
      parts: [],
    });

    await service.waitForIdle(minionId);

    const snapshot = await service.getSnapshot(minionId);

    const normalizedModel = model;
    const key = `${normalizedModel}:explore`;

    expect(snapshot.session?.byModel[key]).toBeDefined();
    expect(snapshot.session?.byModel[key]?.agentId).toBe("explore");
    expect(snapshot.session?.byModel[key]?.mode).toBe("exec");

    // Regression: splitting should not label explore traffic as plain exec.
    expect(snapshot.session?.byModel[`${normalizedModel}:exec`]).toBeUndefined();
  });

  it("ignores replayed events so timing stats aren't double-counted", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 4_000_000;

    // Normal completed stream
    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      delta: "hi",
      tokens: 5,
      timestamp: startTime + 1000,
    });

    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "echo hi" },
      tokens: 3,
      timestamp: startTime + 2000,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 3000,
    });

    service.handleStreamEnd({
      type: "stream-end",
      minionId,
      messageId,
      metadata: {
        model,
        duration: 5000,
        usage: {
          inputTokens: 1,
          outputTokens: 10,
          totalTokens: 11,
        },
      },
      parts: [],
    });

    await service.waitForIdle(minionId);

    const timingFilePath = path.join(config.getSessionDir(minionId), "session-timing.json");
    const beforeRaw = await fs.readFile(timingFilePath, "utf-8");
    const beforeSnapshot = await service.getSnapshot(minionId);

    expect(beforeSnapshot.active).toBeUndefined();
    expect(beforeSnapshot.lastRequest?.messageId).toBe(messageId);

    // Replay the same events (e.g., reconnect)
    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      replay: true,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      replay: true,
      delta: "hi",
      tokens: 5,
      timestamp: startTime + 1000,
    });

    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      replay: true,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "echo hi" },
      tokens: 3,
      timestamp: startTime + 2000,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      replay: true,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 3000,
    });

    await service.waitForIdle(minionId);

    const afterRaw = await fs.readFile(timingFilePath, "utf-8");
    const afterSnapshot = await service.getSnapshot(minionId);

    expect(afterRaw).toBe(beforeRaw);

    expect(afterSnapshot.active).toBeUndefined();
    expect(afterSnapshot.lastRequest).toEqual(beforeSnapshot.lastRequest);
    expect(afterSnapshot.session).toEqual(beforeSnapshot.session);
  });

  it("does not double-count overlapping tool calls", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 3_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
      mode: "exec",
    });

    // First token arrives quickly.
    service.handleStreamDelta({
      type: "stream-delta",
      minionId,
      messageId,
      delta: "hi",
      tokens: 2,
      timestamp: startTime + 500,
    });

    // Two tools overlap: [1000, 3000] and [1500, 4000]
    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "sleep 2" },
      tokens: 1,
      timestamp: startTime + 1000,
    });

    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t2",
      toolName: "bash",
      args: { cmd: "sleep 3" },
      tokens: 1,
      timestamp: startTime + 1500,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 3000,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t2",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 4000,
    });

    service.handleStreamEnd({
      type: "stream-end",
      minionId,
      messageId,
      metadata: {
        model,
        duration: 5000,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      },
      parts: [],
    });

    await service.waitForIdle(minionId);

    const snapshot = await service.getSnapshot(minionId);
    expect(snapshot.lastRequest?.totalDurationMs).toBe(5000);

    // Tool wall-time should be the union: [1000, 4000] = 3000ms.
    expect(snapshot.lastRequest?.toolExecutionMs).toBe(3000);
    expect(snapshot.lastRequest?.toolExecutionMs).toBeLessThanOrEqual(
      snapshot.lastRequest?.totalDurationMs ?? 0
    );

    expect(snapshot.lastRequest?.ttftMs).toBe(500);
    expect(snapshot.lastRequest?.streamingMs).toBe(1500);
    expect(snapshot.lastRequest?.invalid).toBe(false);
  });

  it("emits invalid timing telemetry when tool percent would exceed 100%", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 2_000_000;

    service.handleStreamStart({
      type: "stream-start",
      minionId,
      messageId,
      model,
      historySequence: 1,
      startTime,
    });

    // Tool runs 10s, but we lie in metadata.duration=1s.
    service.handleToolCallStart({
      type: "tool-call-start",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      args: { cmd: "sleep" },
      tokens: 1,
      timestamp: startTime + 100,
    });

    service.handleToolCallEnd({
      type: "tool-call-end",
      minionId,
      messageId,
      toolCallId: "t1",
      toolName: "bash",
      result: { ok: true },
      timestamp: startTime + 10_100,
    });

    service.handleStreamEnd({
      type: "stream-end",
      minionId,
      messageId,
      metadata: {
        model,
        duration: 1000,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
      },
      parts: [],
    });

    await service.waitForIdle(minionId);

    expect(telemetry.capture).toHaveBeenCalled();

    // Bun's mock() returns a callable with `.mock.calls`, but our TelemetryService typing
    // does not expose that. Introspect via unknown.
    const calls = (telemetry.capture as unknown as { mock: { calls: Array<[unknown]> } }).mock
      .calls;

    const invalidCalls = calls.filter((c) => {
      const payload = c[0];
      if (!payload || typeof payload !== "object") {
        return false;
      }

      return (
        "event" in payload && (payload as { event?: unknown }).event === "stream_timing_invalid"
      );
    });

    expect(invalidCalls.length).toBeGreaterThan(0);
  });

  it("throttles delta-driven change events per minion", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 5_000_000;

    const onChange = mock<(minionId: string) => void>(() => undefined);

    service.onStatsChange(onChange);
    service.addSubscriber(minionId);

    try {
      service.handleStreamStart({
        type: "stream-start",
        minionId,
        messageId,
        model,
        historySequence: 1,
        startTime,
        mode: "exec",
      });

      expect(onChange).toHaveBeenCalledTimes(1);

      // First token should be emitted immediately so TTFT updates promptly.
      service.handleStreamDelta({
        type: "stream-delta",
        minionId,
        messageId,
        delta: "hi",
        tokens: 1,
        timestamp: startTime + 100,
      });

      expect(onChange).toHaveBeenCalledTimes(2);

      // Burst of deltas should coalesce into a single trailing emit.
      for (let i = 0; i < 25; i++) {
        service.handleStreamDelta({
          type: "stream-delta",
          minionId,
          messageId,
          delta: "x",
          tokens: 1,
          timestamp: startTime + 200 + i,
        });
      }

      // Still only the immediate start + first token emits.
      expect(onChange).toHaveBeenCalledTimes(2);

      await sleep(250);
      expect(onChange).toHaveBeenCalledTimes(3);

      // Without new deltas, we shouldn't keep emitting.
      await sleep(250);
      expect(onChange).toHaveBeenCalledTimes(3);
    } finally {
      service.offStatsChange(onChange);
      service.removeSubscriber(minionId);
    }
  });

  it("clears scheduled delta emits when the last subscriber disconnects", async () => {
    const telemetry = createMockTelemetryService();
    const service = new SessionTimingService(config, telemetry as unknown as TelemetryService);
    service.setStatsTabState({ enabled: true, variant: "stats", override: "default" });

    const minionId = "test-minion";
    const messageId = "m1";
    const model = "openai:gpt-4o";
    const startTime = 6_000_000;

    const onChange = mock<(minionId: string) => void>(() => undefined);

    service.onStatsChange(onChange);
    service.addSubscriber(minionId);

    try {
      service.handleStreamStart({
        type: "stream-start",
        minionId,
        messageId,
        model,
        historySequence: 1,
        startTime,
        mode: "exec",
      });

      service.handleStreamDelta({
        type: "stream-delta",
        minionId,
        messageId,
        delta: "hi",
        tokens: 1,
        timestamp: startTime + 100,
      });

      expect(onChange).toHaveBeenCalledTimes(2);

      // Schedule a throttled emit.
      service.handleStreamDelta({
        type: "stream-delta",
        minionId,
        messageId,
        delta: "x",
        tokens: 1,
        timestamp: startTime + 200,
      });

      const deltaEmitState = (
        service as unknown as { deltaEmitState: Map<string, { timer?: unknown }> }
      ).deltaEmitState;
      expect(deltaEmitState.get(minionId)?.timer).toBeDefined();

      // Unsubscribe before the throttle window elapses; timer should be cleared.
      service.removeSubscriber(minionId);
      expect(deltaEmitState.has(minionId)).toBe(false);

      await sleep(250);
      expect(onChange).toHaveBeenCalledTimes(2);
    } finally {
      service.offStatsChange(onChange);
      service.removeSubscriber(minionId);
    }
  });
});
