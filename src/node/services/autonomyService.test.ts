import { describe, it, expect } from "bun:test";

import {
  resolveAutonomyConfig,
  createCircuitBreakerState,
  evaluateCircuitBreaker,
  createPhaseGatingState,
  advancePhaseIfNeeded,
  getPhaseToolPolicy,
  getPhaseInstruction,
  buildSiblingContextBlock,
  createQualityMetrics,
  updateMetricsFromStreamEnd,
  getToolSuccessRate,
  ExecutionPhase,
  CIRCUIT_BREAKER_DEFAULTS,
  PHASE_DEFAULTS,
  SIBLING_CONTEXT_DEFAULTS,
  RevertTracker,
  REVERT_THRESHOLD,
} from "./autonomyService";

// ---------------------------------------------------------------------------
// resolveAutonomyConfig
// ---------------------------------------------------------------------------

describe("resolveAutonomyConfig", () => {
  it("returns all-disabled defaults when frontmatter is undefined", () => {
    const config = resolveAutonomyConfig(undefined);
    expect(config.circuitBreaker.enabled).toBe(false);
    expect(config.phases.enabled).toBe(false);
    expect(config.siblingContext.enabled).toBe(false);
    expect(config.challenger.enabled).toBe(false);
  });

  it("returns all-disabled defaults when frontmatter has no autonomy field", () => {
    const config = resolveAutonomyConfig({ name: "test" });
    expect(config.circuitBreaker.enabled).toBe(false);
    expect(config.circuitBreaker.softLimit).toBe(CIRCUIT_BREAKER_DEFAULTS.SOFT_LIMIT);
    expect(config.circuitBreaker.hardLimit).toBe(CIRCUIT_BREAKER_DEFAULTS.HARD_LIMIT);
    expect(config.phases.exploreTurns).toBe(PHASE_DEFAULTS.EXPLORE_TURNS);
    expect(config.siblingContext.maxSiblings).toBe(SIBLING_CONTEXT_DEFAULTS.MAX_SIBLINGS);
  });

  it("respects explicit values from frontmatter", () => {
    const config = resolveAutonomyConfig({
      name: "test",
      autonomy: {
        circuit_breaker: { enabled: true, soft_limit: 5, hard_limit: 10 },
        phases: { enabled: true, explore_turns: 2, plan_turns: 1, execute_turns: 8, verify_turns: 2 },
        sibling_context: { enabled: true, max_siblings: 5, max_tokens_per_sibling: 2000 },
        challenger: { enabled: true, model: "haiku", max_rounds: 3 },
      },
    });

    expect(config.circuitBreaker.enabled).toBe(true);
    expect(config.circuitBreaker.softLimit).toBe(5);
    expect(config.circuitBreaker.hardLimit).toBe(10);
    expect(config.phases.enabled).toBe(true);
    expect(config.phases.exploreTurns).toBe(2);
    expect(config.phases.planTurns).toBe(1);
    expect(config.phases.executeTurns).toBe(8);
    expect(config.phases.verifyTurns).toBe(2);
    expect(config.siblingContext.enabled).toBe(true);
    expect(config.siblingContext.maxSiblings).toBe(5);
    expect(config.siblingContext.maxTokensPerSibling).toBe(2000);
    expect(config.challenger.enabled).toBe(true);
    expect(config.challenger.model).toBe("haiku");
    expect(config.challenger.maxRounds).toBe(3);
  });

  it("fills defaults for partially specified autonomy", () => {
    const config = resolveAutonomyConfig({
      name: "test",
      autonomy: {
        circuit_breaker: { enabled: true },
      },
    });
    expect(config.circuitBreaker.enabled).toBe(true);
    expect(config.circuitBreaker.softLimit).toBe(CIRCUIT_BREAKER_DEFAULTS.SOFT_LIMIT);
    expect(config.circuitBreaker.hardLimit).toBe(CIRCUIT_BREAKER_DEFAULTS.HARD_LIMIT);
    // Other mechanisms should be disabled
    expect(config.phases.enabled).toBe(false);
    expect(config.challenger.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evaluateCircuitBreaker
// ---------------------------------------------------------------------------

describe("evaluateCircuitBreaker", () => {
  const enabledConfig = { enabled: true, softLimit: 5, hardLimit: 10 };
  const disabledConfig = { enabled: false, softLimit: 5, hardLimit: 10 };

  it("returns none when disabled", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 99 };
    const result = evaluateCircuitBreaker(state, disabledConfig, "test");
    expect(result.type).toBe("none");
  });

  it("returns none when under soft limit", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 4 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test");
    expect(result.type).toBe("none");
  });

  it("returns reflect at soft limit", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 5 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test");
    expect(result.type).toBe("reflect");
    expect(result.instruction).toContain("REFLECTION REQUIRED");
    expect(result.instruction).toContain("<reflection>");
  });

  it("returns compact at hard limit", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 10 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test");
    expect(result.type).toBe("compact");
    expect(result.instruction).toContain("HARD LIMIT");
  });

  it("does not nudge twice (softLimitNudged = true)", () => {
    const state = {
      turnsSinceUserMessage: 7,
      softLimitNudged: true,
      hardLimitTriggered: false,
    };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test");
    expect(result.type).toBe("none");
  });

  it("does not compact twice (hardLimitTriggered = true)", () => {
    const state = {
      turnsSinceUserMessage: 15,
      softLimitNudged: true,
      hardLimitTriggered: true,
    };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test");
    expect(result.type).toBe("none");
  });

  it("hard limit takes precedence over soft limit", () => {
    // If somehow both thresholds are crossed at once (e.g. softLimit=5, hardLimit=5)
    const config = { enabled: true, softLimit: 5, hardLimit: 5 };
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 5 };
    const result = evaluateCircuitBreaker(state, config, "test");
    expect(result.type).toBe("compact");
  });
});

// ---------------------------------------------------------------------------
// advancePhaseIfNeeded
// ---------------------------------------------------------------------------

describe("advancePhaseIfNeeded", () => {
  const enabledConfig = {
    enabled: true,
    exploreTurns: 3,
    planTurns: 2,
    executeTurns: 5,
    verifyTurns: 2,
  };
  const disabledConfig = { ...enabledConfig, enabled: false };

  it("returns unchanged state when disabled", () => {
    const state = createPhaseGatingState();
    state.turnsInCurrentPhase = 99;
    const result = advancePhaseIfNeeded(state, disabledConfig, "test");
    expect(result.transitioned).toBe(false);
    expect(result.state).toBe(state);
  });

  it("does not advance when under turn limit", () => {
    const state = { currentPhase: ExecutionPhase.EXPLORE, turnsInCurrentPhase: 2 };
    const result = advancePhaseIfNeeded(state, enabledConfig, "test");
    expect(result.transitioned).toBe(false);
  });

  it("advances from EXPLORE to PLAN at limit", () => {
    const state = { currentPhase: ExecutionPhase.EXPLORE, turnsInCurrentPhase: 3 };
    const result = advancePhaseIfNeeded(state, enabledConfig, "test");
    expect(result.transitioned).toBe(true);
    expect(result.state.currentPhase).toBe(ExecutionPhase.PLAN);
    expect(result.state.turnsInCurrentPhase).toBe(0);
  });

  it("advances from PLAN to EXECUTE at limit", () => {
    const state = { currentPhase: ExecutionPhase.PLAN, turnsInCurrentPhase: 2 };
    const result = advancePhaseIfNeeded(state, enabledConfig, "test");
    expect(result.transitioned).toBe(true);
    expect(result.state.currentPhase).toBe(ExecutionPhase.EXECUTE);
  });

  it("advances from EXECUTE to VERIFY at limit", () => {
    const state = { currentPhase: ExecutionPhase.EXECUTE, turnsInCurrentPhase: 5 };
    const result = advancePhaseIfNeeded(state, enabledConfig, "test");
    expect(result.transitioned).toBe(true);
    expect(result.state.currentPhase).toBe(ExecutionPhase.VERIFY);
  });

  it("loops from VERIFY back to EXECUTE at limit", () => {
    const state = { currentPhase: ExecutionPhase.VERIFY, turnsInCurrentPhase: 2 };
    const result = advancePhaseIfNeeded(state, enabledConfig, "test");
    expect(result.transitioned).toBe(true);
    expect(result.state.currentPhase).toBe(ExecutionPhase.EXECUTE);
  });
});

// ---------------------------------------------------------------------------
// getPhaseToolPolicy
// ---------------------------------------------------------------------------

describe("getPhaseToolPolicy", () => {
  const enabledConfig = {
    enabled: true,
    exploreTurns: 5,
    planTurns: 3,
    executeTurns: 12,
    verifyTurns: 3,
  };

  it("returns undefined when disabled", () => {
    const state = createPhaseGatingState();
    expect(getPhaseToolPolicy(state, { ...enabledConfig, enabled: false })).toBeUndefined();
  });

  it("returns restrictive policy for EXPLORE phase", () => {
    const state = { currentPhase: ExecutionPhase.EXPLORE, turnsInCurrentPhase: 0 };
    const policy = getPhaseToolPolicy(state, enabledConfig);
    expect(policy).toBeDefined();
    expect(policy!.some((p) => p.regex_match === "file_edit_.*" && p.action === "disable")).toBe(
      true
    );
  });

  it("returns undefined (no restrictions) for EXECUTE phase", () => {
    const state = { currentPhase: ExecutionPhase.EXECUTE, turnsInCurrentPhase: 0 };
    const policy = getPhaseToolPolicy(state, enabledConfig);
    expect(policy).toBeUndefined();
  });

  it("returns restrictive policy for VERIFY phase", () => {
    const state = { currentPhase: ExecutionPhase.VERIFY, turnsInCurrentPhase: 0 };
    const policy = getPhaseToolPolicy(state, enabledConfig);
    expect(policy).toBeDefined();
    expect(policy!.some((p) => p.regex_match === "file_edit_.*" && p.action === "disable")).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// getPhaseInstruction
// ---------------------------------------------------------------------------

describe("getPhaseInstruction", () => {
  const enabledConfig = {
    enabled: true,
    exploreTurns: 5,
    planTurns: 3,
    executeTurns: 12,
    verifyTurns: 3,
  };

  it("returns undefined when disabled", () => {
    const state = createPhaseGatingState();
    expect(getPhaseInstruction(state, { ...enabledConfig, enabled: false })).toBeUndefined();
  });

  it("returns EXPLORE instruction for EXPLORE phase", () => {
    const state = { currentPhase: ExecutionPhase.EXPLORE, turnsInCurrentPhase: 0 };
    const instruction = getPhaseInstruction(state, enabledConfig);
    expect(instruction).toContain("EXPLORE");
    expect(instruction).toContain("read-only");
  });

  it("returns EXECUTE instruction for EXECUTE phase", () => {
    const state = { currentPhase: ExecutionPhase.EXECUTE, turnsInCurrentPhase: 0 };
    const instruction = getPhaseInstruction(state, enabledConfig);
    expect(instruction).toContain("EXECUTE");
    expect(instruction).toContain("All tools are now available");
  });
});

// ---------------------------------------------------------------------------
// buildSiblingContextBlock
// ---------------------------------------------------------------------------

describe("buildSiblingContextBlock", () => {
  const enabledConfig = { enabled: true, maxSiblings: 3, maxTokensPerSibling: 100 };
  const disabledConfig = { ...enabledConfig, enabled: false };

  it("returns undefined when disabled", () => {
    const result = buildSiblingContextBlock(
      [{ minionName: "sibling-1", summary: "Did stuff" }],
      disabledConfig
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty summaries", () => {
    const result = buildSiblingContextBlock([], enabledConfig);
    expect(result).toBeUndefined();
  });

  it("builds a context block for sibling summaries", () => {
    const result = buildSiblingContextBlock(
      [
        { minionName: "feat/auth", summary: "Implemented JWT authentication" },
        { minionName: "feat/api", summary: "Built REST API endpoints" },
      ],
      enabledConfig
    );
    expect(result).toContain("SIBLING CONTEXT");
    expect(result).toContain("### feat/auth");
    expect(result).toContain("JWT authentication");
    expect(result).toContain("### feat/api");
    expect(result).toContain("REST API endpoints");
  });

  it("limits the number of siblings", () => {
    const summaries = Array.from({ length: 10 }, (_, i) => ({
      minionName: `sibling-${i}`,
      summary: `Summary ${i}`,
    }));
    const result = buildSiblingContextBlock(summaries, enabledConfig)!;
    // Should only include 3 siblings (maxSiblings)
    expect(result).toContain("### sibling-0");
    expect(result).toContain("### sibling-2");
    expect(result).not.toContain("### sibling-3");
  });

  it("truncates long summaries", () => {
    // maxTokensPerSibling = 100, so charLimit = 400
    const longSummary = "x".repeat(500);
    const result = buildSiblingContextBlock(
      [{ minionName: "wordy", summary: longSummary }],
      enabledConfig
    )!;
    expect(result).toContain("[...truncated]");
    expect(result.length).toBeLessThan(longSummary.length + 200);
  });
});

// ---------------------------------------------------------------------------
// updateMetricsFromStreamEnd
// ---------------------------------------------------------------------------

describe("updateMetricsFromStreamEnd", () => {
  it("increments totalTurns", () => {
    const metrics = createQualityMetrics();
    const updated = updateMetricsFromStreamEnd(metrics, [], undefined);
    expect(updated.totalTurns).toBe(1);
  });

  it("counts tool calls and successes", () => {
    const metrics = createQualityMetrics();
    const parts = [
      { type: "tool-result", toolName: "bash", isError: false },
      { type: "tool-result", toolName: "file_read", isError: false },
      { type: "tool-result", toolName: "bash", isError: true },
    ];
    const updated = updateMetricsFromStreamEnd(metrics, parts, undefined);
    expect(updated.toolCallCount).toBe(3);
    expect(updated.toolCallSuccessCount).toBe(2);
  });

  it("tracks turns per phase", () => {
    let metrics = createQualityMetrics();
    metrics = updateMetricsFromStreamEnd(metrics, [], ExecutionPhase.EXPLORE);
    metrics = updateMetricsFromStreamEnd(metrics, [], ExecutionPhase.EXPLORE);
    metrics = updateMetricsFromStreamEnd(metrics, [], ExecutionPhase.EXECUTE);
    expect(metrics.turnsPerPhase[ExecutionPhase.EXPLORE]).toBe(2);
    expect(metrics.turnsPerPhase[ExecutionPhase.EXECUTE]).toBe(1);
    expect(metrics.turnsPerPhase[ExecutionPhase.PLAN]).toBe(0);
  });

  it("does not mutate the original metrics", () => {
    const metrics = createQualityMetrics();
    const updated = updateMetricsFromStreamEnd(metrics, [], ExecutionPhase.EXPLORE);
    expect(metrics.totalTurns).toBe(0);
    expect(updated.totalTurns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getToolSuccessRate
// ---------------------------------------------------------------------------

describe("getToolSuccessRate", () => {
  it("returns 100 when no tool calls", () => {
    const metrics = createQualityMetrics();
    expect(getToolSuccessRate(metrics)).toBe(100);
  });

  it("returns correct percentage", () => {
    const metrics = { ...createQualityMetrics(), toolCallCount: 10, toolCallSuccessCount: 7 };
    expect(getToolSuccessRate(metrics)).toBe(70);
  });

  it("returns 0 when all tools fail", () => {
    const metrics = { ...createQualityMetrics(), toolCallCount: 5, toolCallSuccessCount: 0 };
    expect(getToolSuccessRate(metrics)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RevertTracker
// ---------------------------------------------------------------------------

describe("RevertTracker", () => {
  it("returns 0 for empty parts", () => {
    const tracker = new RevertTracker();
    expect(tracker.detectReverts([])).toBe(0);
  });

  it("detects git checkout revert", () => {
    const tracker = new RevertTracker();
    const reverts = tracker.detectReverts([
      { toolName: "bash", input: { command: "git checkout -- src/foo.ts" } },
    ]);
    expect(reverts).toBe(1);
  });

  it("detects git restore revert", () => {
    const tracker = new RevertTracker();
    const reverts = tracker.detectReverts([
      { toolName: "bash", input: { command: "git restore src/foo.ts" } },
    ]);
    expect(reverts).toBe(1);
  });

  it("detects git reset --hard revert", () => {
    const tracker = new RevertTracker();
    const reverts = tracker.detectReverts([
      { toolName: "bash", input: { command: "git reset --hard HEAD~1" } },
    ]);
    expect(reverts).toBe(1);
  });

  it("detects git stash revert", () => {
    const tracker = new RevertTracker();
    const reverts = tracker.detectReverts([
      { toolName: "terminal", input: { script: "git stash pop" } },
    ]);
    expect(reverts).toBe(1);
  });

  it("does not flag non-revert bash commands", () => {
    const tracker = new RevertTracker();
    const reverts = tracker.detectReverts([
      { toolName: "bash", input: { command: "git status" } },
      { toolName: "bash", input: { command: "npm test" } },
    ]);
    expect(reverts).toBe(0);
  });

  it("detects re-edits of the same file across turns", () => {
    const tracker = new RevertTracker();

    // Turn 1: edit foo.ts
    const reverts1 = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);
    expect(reverts1).toBe(0);

    // Turn 2: edit foo.ts again → re-edit detected
    const reverts2 = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);
    expect(reverts2).toBe(1);
  });

  it("does not flag different files as re-edits", () => {
    const tracker = new RevertTracker();

    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);

    const reverts = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/bar.ts" },
        output: { success: true },
      },
    ]);
    expect(reverts).toBe(0);
  });

  it("sliding window only tracks the previous turn", () => {
    const tracker = new RevertTracker();

    // Turn 1: edit foo.ts
    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);

    // Turn 2: edit bar.ts (not foo.ts)
    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/bar.ts" },
        output: { success: true },
      },
    ]);

    // Turn 3: edit foo.ts again — but it was 2 turns ago, not in previous turn
    const reverts = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);
    expect(reverts).toBe(0);
  });

  it("ignores failed edits", () => {
    const tracker = new RevertTracker();

    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: false },
      },
    ]);

    const reverts = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);
    // Failed edit shouldn't count as previous-turn file
    expect(reverts).toBe(0);
  });

  it("counts multiple reverts in a single turn", () => {
    const tracker = new RevertTracker();

    // Turn 1: edit multiple files
    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/a.ts" },
        output: { success: true },
      },
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/b.ts" },
        output: { success: true },
      },
    ]);

    // Turn 2: re-edit both files + git restore
    const reverts = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/a.ts" },
        output: { success: true },
      },
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/b.ts" },
        output: { success: true },
      },
      { toolName: "bash", input: { command: "git restore src/c.ts" } },
    ]);
    expect(reverts).toBe(3); // 2 re-edits + 1 git restore
  });

  it("reset clears the sliding window", () => {
    const tracker = new RevertTracker();

    tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);

    tracker.reset();

    // After reset, re-editing foo.ts should not be flagged
    const reverts = tracker.detectReverts([
      {
        toolName: "file_edit_replace_string",
        input: { file_path: "src/foo.ts" },
        output: { success: true },
      },
    ]);
    expect(reverts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateCircuitBreaker with revertCount
// ---------------------------------------------------------------------------

describe("evaluateCircuitBreaker with revertCount", () => {
  const enabledConfig = { enabled: true, softLimit: 5, hardLimit: 10 };

  it("triggers early reflect when revertCount >= REVERT_THRESHOLD before soft limit", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 2 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test", REVERT_THRESHOLD);
    expect(result.type).toBe("reflect");
    expect(result.instruction).toContain("reverted");
    expect(result.instruction).toContain("<reflection>");
  });

  it("does not trigger early nudge when revertCount < REVERT_THRESHOLD", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 2 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test", 1);
    expect(result.type).toBe("none");
  });

  it("does not trigger early nudge if already nudged", () => {
    const state = {
      turnsSinceUserMessage: 2,
      softLimitNudged: true,
      hardLimitTriggered: false,
    };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test", REVERT_THRESHOLD + 5);
    expect(result.type).toBe("none");
  });

  it("hard limit still takes precedence over revert nudge", () => {
    const state = { ...createCircuitBreakerState(), turnsSinceUserMessage: 10 };
    const result = evaluateCircuitBreaker(state, enabledConfig, "test", REVERT_THRESHOLD);
    expect(result.type).toBe("compact");
  });
});

// ---------------------------------------------------------------------------
// updateMetricsFromStreamEnd with revertsThisTurn
// ---------------------------------------------------------------------------

describe("updateMetricsFromStreamEnd with revertsThisTurn", () => {
  it("accumulates revert count", () => {
    let metrics = createQualityMetrics();
    metrics = updateMetricsFromStreamEnd(metrics, [], undefined, 2);
    expect(metrics.revertCount).toBe(2);
    metrics = updateMetricsFromStreamEnd(metrics, [], undefined, 1);
    expect(metrics.revertCount).toBe(3);
  });

  it("does not change revert count when revertsThisTurn is 0", () => {
    let metrics = createQualityMetrics();
    metrics = updateMetricsFromStreamEnd(metrics, [], undefined, 0);
    expect(metrics.revertCount).toBe(0);
  });

  it("does not change revert count when revertsThisTurn is undefined", () => {
    let metrics = createQualityMetrics();
    metrics = updateMetricsFromStreamEnd(metrics, [], undefined);
    expect(metrics.revertCount).toBe(0);
  });
});
