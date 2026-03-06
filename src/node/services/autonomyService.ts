/**
 * Autonomy Service: DialogLab-inspired self-correction mechanisms for minion agents.
 *
 * Implements four mechanisms that improve agent efficiency without human intervention:
 *
 * 1. **Circuit Breaker** — Turn budgets with auto-pivot to prevent infinite loops.
 *    Injects nudge instructions at soft limit, force-compacts at hard limit.
 *
 * 2. **Phase Gating** — Enforces explore→plan→execute→verify phases with tool
 *    restrictions per phase. Prevents premature file edits.
 *
 * 3. **Sibling Context** — On first turn, injects compacted summaries from other
 *    minions in the same project to avoid redundant exploration.
 *
 * 4. **Quality Metrics** — Tracks turn efficiency, tool success rate, and phase
 *    distribution for analytics.
 *
 * All mechanisms are opt-in via agent frontmatter `autonomy` field.
 * Existing agents are completely unaffected unless they explicitly enable features.
 */

import type { AgentDefinitionFrontmatter } from "@/common/types/agentDefinition";
import type { ToolPolicy } from "@/common/utils/tools/toolPolicy";
import { log } from "./log";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default circuit breaker thresholds (can be overridden in frontmatter). */
export const CIRCUIT_BREAKER_DEFAULTS = {
  SOFT_LIMIT: 9,
  HARD_LIMIT: 15,
} as const;

/** Default phase turn limits. */
export const PHASE_DEFAULTS = {
  EXPLORE_TURNS: 5,
  PLAN_TURNS: 3,
  EXECUTE_TURNS: 12,
  VERIFY_TURNS: 3,
} as const;

/** Default sibling context limits. */
export const SIBLING_CONTEXT_DEFAULTS = {
  MAX_SIBLINGS: 3,
  MAX_TOKENS_PER_SIBLING: 1000,
} as const;

// ---------------------------------------------------------------------------
// Phase Gating
// ---------------------------------------------------------------------------

/** Execution phases for phase-gated agents. */
export enum ExecutionPhase {
  EXPLORE = "explore",
  PLAN = "plan",
  EXECUTE = "execute",
  VERIFY = "verify",
}

/** Phase-specific tool policy overrides (applied as callerToolPolicy). */
const PHASE_TOOL_POLICIES: Record<ExecutionPhase, ToolPolicy> = {
  [ExecutionPhase.EXPLORE]: [
    // Read-only: disable all editing and execution tools
    { regex_match: "file_edit_.*", action: "disable" },
    { regex_match: "task_apply_git_patch", action: "disable" },
  ],
  [ExecutionPhase.PLAN]: [
    // Plan phase: read + plan tools, no execution
    { regex_match: "file_edit_.*", action: "disable" },
    { regex_match: "task_apply_git_patch", action: "disable" },
  ],
  [ExecutionPhase.EXECUTE]: [
    // Execute phase: all tools unlocked (empty policy = no additional restrictions)
  ],
  [ExecutionPhase.VERIFY]: [
    // Verify phase: read-only, no edits
    { regex_match: "file_edit_.*", action: "disable" },
    { regex_match: "task_apply_git_patch", action: "disable" },
  ],
};

/** Phase transition instructions injected into additionalSystemInstructions. */
const PHASE_INSTRUCTIONS: Record<ExecutionPhase, string> = {
  [ExecutionPhase.EXPLORE]: [
    "=== PHASE: EXPLORE (read-only) ===",
    "You are in the EXPLORE phase. Read and understand the codebase before making changes.",
    "- Use file_read, bash (read-only commands), grep, and search tools",
    "- Do NOT edit files yet — editing tools are disabled in this phase",
    "- When you have sufficient understanding, the system will advance to the PLAN phase",
  ].join("\n"),
  [ExecutionPhase.PLAN]: [
    "=== PHASE: PLAN ===",
    "You are in the PLAN phase. Produce a concrete plan for the changes.",
    "- Describe what files you will change and why",
    "- List the specific edits in order",
    "- File editing tools are still disabled — plan only, do not implement yet",
  ].join("\n"),
  [ExecutionPhase.EXECUTE]: [
    "=== PHASE: EXECUTE ===",
    "You are in the EXECUTE phase. Implement the changes according to your plan.",
    "- All tools are now available",
    "- Follow your plan from the previous phase",
    "- Make minimal, correct, reviewable changes",
  ].join("\n"),
  [ExecutionPhase.VERIFY]: [
    "=== PHASE: VERIFY ===",
    "You are in the VERIFY phase. Check your own work before marking done.",
    "- Run tests, typecheck, and lint",
    "- Review the diff of your changes",
    "- File editing tools are disabled — if you find issues, report them",
    "- Do NOT edit files in this phase",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Circuit Breaker State
// ---------------------------------------------------------------------------

export interface CircuitBreakerState {
  /** Turns since the last real (non-synthetic) user message. */
  turnsSinceUserMessage: number;
  /** Whether the soft-limit nudge has been injected for the current cycle. */
  softLimitNudged: boolean;
  /** Whether hard-limit compaction has been triggered for the current cycle. */
  hardLimitTriggered: boolean;
}

export function createCircuitBreakerState(): CircuitBreakerState {
  return {
    turnsSinceUserMessage: 0,
    softLimitNudged: false,
    hardLimitTriggered: false,
  };
}

// ---------------------------------------------------------------------------
// Phase Gating State
// ---------------------------------------------------------------------------

export interface PhaseGatingState {
  currentPhase: ExecutionPhase;
  turnsInCurrentPhase: number;
}

export function createPhaseGatingState(): PhaseGatingState {
  return {
    currentPhase: ExecutionPhase.EXPLORE,
    turnsInCurrentPhase: 0,
  };
}

// ---------------------------------------------------------------------------
// Revert Detection
// ---------------------------------------------------------------------------

/**
 * Detects when an agent is reverting its own work — a strong signal of thrashing.
 *
 * Signals detected:
 * 1. **Re-edits**: Same file edited in the previous turn and again this turn
 * 2. **Git reverts**: bash tool calls containing `git checkout`, `git restore`, or `git reset`
 *
 * The tracker maintains a sliding window of recently edited files (last 2 turns).
 */

/** Default revert threshold: this many reverts triggers an early circuit-breaker nudge. */
export const REVERT_THRESHOLD = 2;

/** Stream part shape expected by revert detection. */
export interface RevertDetectorPart {
  toolName?: string;
  input?: unknown;
  output?: unknown;
}

/** Git commands that indicate reverting changes. */
const GIT_REVERT_PATTERNS = [
  /git\s+checkout\s+(?:--\s+)?[^\s]/,
  /git\s+restore\s/,
  /git\s+reset\s+--hard/,
  /git\s+stash\s/,
];

/** File edit tool names. */
const FILE_EDIT_NAMES = new Set([
  "file_edit_replace_string",
  "file_edit_replace_lines",
  "file_edit_insert",
]);

/**
 * Tracks recently edited files across turns to detect re-edit thrashing.
 * Mutable state — lives on AgentSession alongside other autonomy state.
 */
export class RevertTracker {
  /** Files edited in the previous turn. */
  private previousTurnFiles = new Set<string>();
  /** Files edited in the current turn (accumulated during detectReverts). */
  private currentTurnFiles = new Set<string>();

  /**
   * Analyze stream parts from a completed turn and return the number of reverts detected.
   * Also advances the internal turn window.
   */
  detectReverts(parts: RevertDetectorPart[]): number {
    this.currentTurnFiles.clear();
    let reverts = 0;

    for (const part of parts) {
      // Detect git revert commands in bash tool calls
      if (part.toolName === "bash" || part.toolName === "terminal") {
        const cmd = extractBashCommand(part.input);
        if (cmd && GIT_REVERT_PATTERNS.some((p) => p.test(cmd))) {
          reverts++;
        }
      }

      // Track file edits and detect re-edits
      if (part.toolName && FILE_EDIT_NAMES.has(part.toolName)) {
        const filePath = extractFilePath(part.input);
        const isSuccess = isSuccessfulEdit(part.output);
        if (filePath && isSuccess) {
          this.currentTurnFiles.add(filePath);
          if (this.previousTurnFiles.has(filePath)) {
            reverts++;
          }
        }
      }
    }

    // Advance the sliding window
    this.previousTurnFiles = new Set(this.currentTurnFiles);

    return reverts;
  }

  /** Reset tracker state (e.g. on user message). */
  reset(): void {
    this.previousTurnFiles.clear();
    this.currentTurnFiles.clear();
  }
}

function extractBashCommand(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const r = input as Record<string, unknown>;
  if (typeof r.command === "string") return r.command;
  if (typeof r.cmd === "string") return r.cmd;
  if (typeof r.script === "string") return r.script;
  return undefined;
}

function extractFilePath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const r = input as Record<string, unknown>;
  if (typeof r.path === "string") return r.path;
  if (typeof r.file_path === "string") return r.file_path;
  if (typeof r.filePath === "string") return r.filePath;
  return undefined;
}

function isSuccessfulEdit(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  return (output as Record<string, unknown>).success === true;
}

// ---------------------------------------------------------------------------
// Quality Metrics State
// ---------------------------------------------------------------------------

export interface QualityMetrics {
  totalTurns: number;
  toolCallCount: number;
  toolCallSuccessCount: number;
  turnsPerPhase: Record<ExecutionPhase, number>;
  revertCount: number;
}

export function createQualityMetrics(): QualityMetrics {
  return {
    totalTurns: 0,
    toolCallCount: 0,
    toolCallSuccessCount: 0,
    turnsPerPhase: {
      [ExecutionPhase.EXPLORE]: 0,
      [ExecutionPhase.PLAN]: 0,
      [ExecutionPhase.EXECUTE]: 0,
      [ExecutionPhase.VERIFY]: 0,
    },
    revertCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Autonomy Session — per-minion state for all autonomy mechanisms
// ---------------------------------------------------------------------------

export interface AutonomyConfig {
  circuitBreaker: {
    enabled: boolean;
    softLimit: number;
    hardLimit: number;
  };
  phases: {
    enabled: boolean;
    exploreTurns: number;
    planTurns: number;
    executeTurns: number;
    verifyTurns: number;
  };
  siblingContext: {
    enabled: boolean;
    maxSiblings: number;
    maxTokensPerSibling: number;
  };
  challenger: {
    enabled: boolean;
    model: string | undefined;
    maxRounds: number;
  };
}

/**
 * Resolve autonomy configuration from agent frontmatter.
 * Returns a fully-defaulted config — callers don't need to handle undefined fields.
 */
export function resolveAutonomyConfig(
  frontmatter: AgentDefinitionFrontmatter | undefined
): AutonomyConfig {
  const autonomy = frontmatter?.autonomy;
  return {
    circuitBreaker: {
      enabled: autonomy?.circuit_breaker?.enabled ?? false,
      softLimit: autonomy?.circuit_breaker?.soft_limit ?? CIRCUIT_BREAKER_DEFAULTS.SOFT_LIMIT,
      hardLimit: autonomy?.circuit_breaker?.hard_limit ?? CIRCUIT_BREAKER_DEFAULTS.HARD_LIMIT,
    },
    phases: {
      enabled: autonomy?.phases?.enabled ?? false,
      exploreTurns: autonomy?.phases?.explore_turns ?? PHASE_DEFAULTS.EXPLORE_TURNS,
      planTurns: autonomy?.phases?.plan_turns ?? PHASE_DEFAULTS.PLAN_TURNS,
      executeTurns: autonomy?.phases?.execute_turns ?? PHASE_DEFAULTS.EXECUTE_TURNS,
      verifyTurns: autonomy?.phases?.verify_turns ?? PHASE_DEFAULTS.VERIFY_TURNS,
    },
    siblingContext: {
      enabled: autonomy?.sibling_context?.enabled ?? false,
      maxSiblings:
        autonomy?.sibling_context?.max_siblings ?? SIBLING_CONTEXT_DEFAULTS.MAX_SIBLINGS,
      maxTokensPerSibling:
        autonomy?.sibling_context?.max_tokens_per_sibling ??
        SIBLING_CONTEXT_DEFAULTS.MAX_TOKENS_PER_SIBLING,
    },
    challenger: {
      enabled: autonomy?.challenger?.enabled ?? false,
      model: autonomy?.challenger?.model,
      maxRounds: autonomy?.challenger?.max_rounds ?? 2,
    },
  };
}

/**
 * Merge per-minion autonomy overrides on top of agent-frontmatter-resolved config.
 * Overrides only replace the `enabled` flag (and optionally limits for circuit breaker);
 * all other tuning knobs remain from the base config.
 */
export function mergeAutonomyOverrides(
  base: AutonomyConfig,
  overrides: {
    circuitBreaker?: { enabled: boolean; softLimit?: number; hardLimit?: number };
    phases?: { enabled: boolean };
    siblingContext?: { enabled: boolean };
    challenger?: { enabled: boolean };
  }
): AutonomyConfig {
  return {
    circuitBreaker: overrides.circuitBreaker
      ? {
          enabled: overrides.circuitBreaker.enabled,
          softLimit: overrides.circuitBreaker.softLimit ?? base.circuitBreaker.softLimit,
          hardLimit: overrides.circuitBreaker.hardLimit ?? base.circuitBreaker.hardLimit,
        }
      : base.circuitBreaker,
    phases: overrides.phases ? { ...base.phases, enabled: overrides.phases.enabled } : base.phases,
    siblingContext: overrides.siblingContext
      ? { ...base.siblingContext, enabled: overrides.siblingContext.enabled }
      : base.siblingContext,
    challenger: overrides.challenger
      ? { ...base.challenger, enabled: overrides.challenger.enabled }
      : base.challenger,
  };
}

// ---------------------------------------------------------------------------
// Circuit Breaker Logic
// ---------------------------------------------------------------------------

export interface CircuitBreakerAction {
  type: "none" | "nudge" | "compact";
  instruction?: string;
}

/**
 * Evaluate circuit breaker state and return the action to take.
 * Called on each stream-end (before the next turn starts).
 */
export function evaluateCircuitBreaker(
  state: CircuitBreakerState,
  config: AutonomyConfig["circuitBreaker"],
  minionId: string,
  revertCount?: number
): CircuitBreakerAction {
  if (!config.enabled) {
    return { type: "none" };
  }

  const turns = state.turnsSinceUserMessage;

  if (turns >= config.hardLimit && !state.hardLimitTriggered) {
    log.info("Circuit breaker: hard limit reached, forcing compaction", {
      minionId,
      turns,
      hardLimit: config.hardLimit,
    });
    return {
      type: "compact",
      instruction: [
        `=== CIRCUIT BREAKER: HARD LIMIT (${config.hardLimit} turns) ===`,
        "You have used too many turns without completing the task.",
        "Your context will be compacted. After compaction, you will receive:",
        "- A summary of what you've done so far",
        "- The original task",
        "Focus on what has NOT been tried yet. Do NOT repeat failed approaches.",
      ].join("\n"),
    };
  }

  // Revert-triggered early nudge: N reverts = agent is thrashing
  const revertTriggered =
    revertCount !== undefined &&
    revertCount >= REVERT_THRESHOLD &&
    !state.softLimitNudged;

  if ((turns >= config.softLimit || revertTriggered) && !state.softLimitNudged) {
    const reason = revertTriggered
      ? `reverted ${revertCount} times — you are undoing your own work`
      : `used ${turns}/${config.hardLimit} turns`;

    log.info("Circuit breaker: nudge triggered", {
      minionId,
      turns,
      revertCount,
      reason: revertTriggered ? "revert-threshold" : "soft-limit",
    });
    return {
      type: "nudge",
      instruction: [
        `=== CIRCUIT BREAKER: PIVOT NEEDED (${reason}) ===`,
        "You are going in circles. STOP and change strategy:",
        "- Summarize what you've tried and what's blocking you",
        "- Try a fundamentally different approach",
        "- If truly stuck, break the task into smaller sub-tasks using sidekicks",
        `If you do not complete within ${config.hardLimit - turns} more turns, your context will be compacted.`,
      ].join("\n"),
    };
  }

  return { type: "none" };
}

// ---------------------------------------------------------------------------
// Phase Gating Logic
// ---------------------------------------------------------------------------

/**
 * Get the max turns for a phase from the autonomy config.
 */
function getMaxTurnsForPhase(phase: ExecutionPhase, config: AutonomyConfig["phases"]): number {
  switch (phase) {
    case ExecutionPhase.EXPLORE:
      return config.exploreTurns;
    case ExecutionPhase.PLAN:
      return config.planTurns;
    case ExecutionPhase.EXECUTE:
      return config.executeTurns;
    case ExecutionPhase.VERIFY:
      return config.verifyTurns;
  }
}

/** Order of phase progression. */
const PHASE_ORDER: ExecutionPhase[] = [
  ExecutionPhase.EXPLORE,
  ExecutionPhase.PLAN,
  ExecutionPhase.EXECUTE,
  ExecutionPhase.VERIFY,
];

/**
 * Advance the phase if the turn limit for the current phase is reached.
 * Returns the (possibly updated) phase state and whether a transition occurred.
 */
export function advancePhaseIfNeeded(
  state: PhaseGatingState,
  config: AutonomyConfig["phases"],
  minionId: string
): { state: PhaseGatingState; transitioned: boolean } {
  if (!config.enabled) {
    return { state, transitioned: false };
  }

  const maxTurns = getMaxTurnsForPhase(state.currentPhase, config);

  if (state.turnsInCurrentPhase >= maxTurns) {
    const currentIndex = PHASE_ORDER.indexOf(state.currentPhase);
    const nextIndex = currentIndex + 1;

    if (nextIndex < PHASE_ORDER.length) {
      const nextPhase = PHASE_ORDER[nextIndex];
      log.info("Phase gating: advancing phase", {
        minionId,
        from: state.currentPhase,
        to: nextPhase,
        turnsUsed: state.turnsInCurrentPhase,
      });
      return {
        state: {
          currentPhase: nextPhase,
          turnsInCurrentPhase: 0,
        },
        transitioned: true,
      };
    }

    // After VERIFY, loop back to EXECUTE if needed (agent may need to fix issues)
    if (state.currentPhase === ExecutionPhase.VERIFY) {
      log.info("Phase gating: verify complete, looping back to execute", { minionId });
      return {
        state: {
          currentPhase: ExecutionPhase.EXECUTE,
          turnsInCurrentPhase: 0,
        },
        transitioned: true,
      };
    }
  }

  return { state, transitioned: false };
}

/**
 * Get the tool policy for the current phase.
 * This is applied as additional callerToolPolicy entries.
 */
export function getPhaseToolPolicy(
  state: PhaseGatingState,
  config: AutonomyConfig["phases"]
): ToolPolicy | undefined {
  if (!config.enabled) {
    return undefined;
  }
  const policy = PHASE_TOOL_POLICIES[state.currentPhase];
  return policy.length > 0 ? policy : undefined;
}

/**
 * Get the phase instruction to inject into additionalSystemInstructions.
 */
export function getPhaseInstruction(
  state: PhaseGatingState,
  config: AutonomyConfig["phases"]
): string | undefined {
  if (!config.enabled) {
    return undefined;
  }
  return PHASE_INSTRUCTIONS[state.currentPhase];
}

// ---------------------------------------------------------------------------
// Sibling Context
// ---------------------------------------------------------------------------

/**
 * Build a sibling context block from compaction summaries.
 * Returns a string to inject into additionalSystemInstructions, or undefined
 * if no sibling context is available.
 *
 * @param siblingCompactionSummaries — Array of { minionName, summary } from sibling minions.
 *        Callers are responsible for reading these from HistoryService.
 */
export function buildSiblingContextBlock(
  siblingCompactionSummaries: Array<{ minionName: string; summary: string }>,
  config: AutonomyConfig["siblingContext"]
): string | undefined {
  if (!config.enabled || siblingCompactionSummaries.length === 0) {
    return undefined;
  }

  const limited = siblingCompactionSummaries.slice(0, config.maxSiblings);

  const blocks = limited.map(({ minionName, summary }) => {
    // Rough token limit: ~4 chars per token
    const charLimit = config.maxTokensPerSibling * 4;
    const truncated =
      summary.length > charLimit ? summary.slice(0, charLimit) + "\n[...truncated]" : summary;
    return `### ${minionName}\n${truncated}`;
  });

  return [
    "=== SIBLING CONTEXT (from other minions in this project) ===",
    "The following summaries describe work done by other minions in the same project.",
    "Use this to avoid redundant exploration. Do NOT repeat work already done.",
    "",
    ...blocks,
    "",
    "=== END SIBLING CONTEXT ===",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Quality Metrics Helpers
// ---------------------------------------------------------------------------

/**
 * Update quality metrics from a stream-end event.
 */
export function updateMetricsFromStreamEnd(
  metrics: QualityMetrics,
  streamParts: Array<{ type: string; toolName?: string; isError?: boolean }>,
  currentPhase: ExecutionPhase | undefined,
  revertsThisTurn?: number
): QualityMetrics {
  const updated = { ...metrics };
  updated.totalTurns++;

  // Count tool calls and successes
  for (const part of streamParts) {
    if (part.type === "tool-result" || part.type === "tool-call") {
      updated.toolCallCount++;
      if (!part.isError) {
        updated.toolCallSuccessCount++;
      }
    }
  }

  // Track turns per phase
  if (currentPhase) {
    updated.turnsPerPhase = { ...updated.turnsPerPhase };
    updated.turnsPerPhase[currentPhase] =
      (updated.turnsPerPhase[currentPhase] ?? 0) + 1;
  }

  // Accumulate reverts detected this turn
  if (revertsThisTurn !== undefined && revertsThisTurn > 0) {
    updated.revertCount += revertsThisTurn;
  }

  return updated;
}

/**
 * Get the tool success rate as a percentage (0-100).
 */
export function getToolSuccessRate(metrics: QualityMetrics): number {
  if (metrics.toolCallCount === 0) return 100;
  return Math.round((metrics.toolCallSuccessCount / metrics.toolCallCount) * 100);
}
