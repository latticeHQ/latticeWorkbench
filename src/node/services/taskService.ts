import assert from "node:assert/strict";
import * as fsPromises from "fs/promises";

import { MutexMap } from "@/node/utils/concurrency/mutexMap";
import { AsyncMutex } from "@/node/utils/concurrency/asyncMutex";
import type { Config, Minion as MinionConfigEntry } from "@/node/config";
import type { AIService } from "@/node/services/aiService";
import type { MinionService } from "@/node/services/minionService";
import type { HistoryService } from "@/node/services/historyService";
import type { InitStateManager } from "@/node/services/initStateManager";
import { log } from "@/node/services/log";
import {
  discoverAgentDefinitions,
  readAgentDefinition,
  resolveAgentFrontmatter,
} from "@/node/services/agentDefinitions/agentDefinitionsService";
import { resolveAgentInheritanceChain } from "@/node/services/agentDefinitions/resolveAgentInheritanceChain";
import { isAgentEffectivelyDisabled } from "@/node/services/agentDefinitions/agentEnablement";
import { orchestrateFork } from "@/node/services/utils/forkOrchestrator";
import { createRuntimeForMinion } from "@/node/runtime/runtimeHelpers";
import { runBackgroundInit } from "@/node/runtime/runtimeFactory";
import type { InitLogger, Runtime } from "@/node/runtime/Runtime";
import { readPlanFile } from "@/node/utils/runtime/helpers";
import { routePlanToExecutor } from "@/node/services/planExecutorRouter";
import {
  coerceNonEmptyString,
  tryReadGitHeadCommitSha,
  findMinionEntry,
} from "@/node/services/taskUtils";
import { validateMinionName } from "@/common/utils/validation/minionValidation";
import { Ok, Err, type Result } from "@/common/types/result";
import {
  DEFAULT_TASK_SETTINGS,
  type PlanSidekickExecutorRouting,
  type TaskSettings,
} from "@/common/types/tasks";

import { createLatticeMessage, type LatticeMessage } from "@/common/types/message";
import {
  createCompactionSummaryMessageId,
  createTaskReportMessageId,
} from "@/node/services/utils/messageIds";
import { defaultModel } from "@/common/utils/ai/models";
import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";
import type { RuntimeConfig } from "@/common/types/runtime";
import { AgentIdSchema } from "@/common/orpc/schemas";
import { GitPatchArtifactService } from "@/node/services/gitPatchArtifactService";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { StreamEndEvent } from "@/common/types/stream";
import { isDynamicToolPart, type DynamicToolPart } from "@/common/types/toolParts";
import {
  AgentReportToolArgsSchema,
  TaskToolResultSchema,
  TaskToolArgsSchema,
} from "@/common/utils/tools/toolDefinitions";
import { isPlanLikeInResolvedChain } from "@/common/utils/agentTools";
import { formatSendMessageError } from "@/node/services/utils/sendMessageError";
import { enforceThinkingPolicy } from "@/common/utils/thinking/policy";
import {
  PLAN_AUTO_ROUTING_STATUS_EMOJI,
  PLAN_AUTO_ROUTING_STATUS_MESSAGE,
} from "@/common/constants/planAutoRoutingStatus";
import { taskQueueDebug } from "@/node/services/taskQueueDebug";
import { readSidekickGitPatchArtifact } from "@/node/services/sidekickGitPatchArtifacts";
import {
  readSidekickReportArtifact,
  readSidekickReportArtifactsFile,
  upsertSidekickReportArtifact,
} from "@/node/services/sidekickReportArtifacts";
import { secretsToRecord } from "@/common/types/secrets";
import { getErrorMessage } from "@/common/utils/errors";

export type TaskKind = "agent";

export type AgentTaskStatus = NonNullable<MinionConfigEntry["taskStatus"]>;

export interface TaskCreateArgs {
  parentMinionId: string;
  kind: TaskKind;
  /** Preferred identifier (matches agent definition id). */
  agentId?: string;
  /** @deprecated Legacy alias for agentId (kept for on-disk compatibility). */
  agentType?: string;
  prompt: string;
  /** Human-readable title for the task (displayed in sidebar) */
  title: string;
  modelString?: string;
  thinkingLevel?: ThinkingLevel;
  /** Experiments to inherit to sidekick */
  experiments?: {
    programmaticToolCalling?: boolean;
    programmaticToolCallingExclusive?: boolean;
    execSidekickHardRestart?: boolean;
  };
}

export interface TaskCreateResult {
  taskId: string;
  kind: TaskKind;
  status: "queued" | "running";
}

export interface TerminateAgentTaskResult {
  /** Task IDs terminated (includes descendants). */
  terminatedTaskIds: string[];
}

export interface DescendantAgentTaskInfo {
  taskId: string;
  status: AgentTaskStatus;
  parentMinionId: string;
  agentType?: string;
  minionName?: string;
  title?: string;
  createdAt?: string;
  modelString?: string;
  thinkingLevel?: ThinkingLevel;
  depth: number;
}

type AgentTaskMinionEntry = MinionConfigEntry & { projectPath: string };

const COMPLETED_REPORT_CACHE_MAX_ENTRIES = 128;

/** Maximum consecutive auto-resumes before stopping. Prevents infinite loops when descendants are stuck. */
// Task-recovery paths must stay deterministic and editing-capable even when
// minion/default agent preferences evolve (e.g., auto router defaults).
const TASK_RECOVERY_FALLBACK_AGENT_ID = "exec";

const MAX_CONSECUTIVE_PARENT_AUTO_RESUMES = 3;

interface AgentTaskIndex {
  byId: Map<string, AgentTaskMinionEntry>;
  childrenByParent: Map<string, string[]>;
  parentById: Map<string, string>;
}

interface PendingTaskWaiter {
  createdAt: number;
  resolve: (report: { reportMarkdown: string; title?: string }) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

interface PendingTaskStartWaiter {
  createdAt: number;
  start: () => void;
  cleanup: () => void;
}

interface CompletedAgentReportCacheEntry {
  reportMarkdown: string;
  title?: string;
  // Ancestor minion IDs captured when the report was cached.
  // Used to keep descendant-scope checks working even if the task minion is cleaned up.
  ancestorMinionIds: string[];
}

interface ParentAutoResumeHint {
  agentId?: string;
}

function isTypedMinionEvent(value: unknown, type: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type: unknown }).type === type &&
    "minionId" in value &&
    typeof (value as { minionId: unknown }).minionId === "string"
  );
}

function isStreamEndEvent(value: unknown): value is StreamEndEvent {
  return isTypedMinionEvent(value, "stream-end");
}

function hasAncestorMinionId(
  entry: { ancestorMinionIds?: unknown } | null | undefined,
  ancestorMinionId: string
): boolean {
  const ids = entry?.ancestorMinionIds;
  return Array.isArray(ids) && ids.includes(ancestorMinionId);
}

function isSuccessfulToolResult(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as { success?: unknown }).success === true
  );
}

function sanitizeAgentTypeForName(agentType: string): string {
  const normalized = agentType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");

  return normalized.length > 0 ? normalized : "agent";
}

function buildAgentMinionName(agentType: string, minionId: string): string {
  const safeType = sanitizeAgentTypeForName(agentType);
  const base = `agent_${safeType}_${minionId}`;
  // Hard cap to validation limit (64). Ensure stable suffix is preserved.
  if (base.length <= 64) return base;

  const suffix = `_${minionId}`;
  const maxPrefixLen = 64 - suffix.length;
  const prefix = `agent_${safeType}`.slice(0, Math.max(0, maxPrefixLen));
  const name = `${prefix}${suffix}`;
  return name.length <= 64 ? name : `agent_${minionId}`.slice(0, 64);
}

function getIsoNow(): string {
  return new Date().toISOString();
}

export class TaskService {
  // Serialize stream-end processing per minion to avoid races when
  // finalizing reported tasks and cleanup state transitions.
  private readonly minionEventLocks = new MutexMap<string>();
  private readonly mutex = new AsyncMutex();
  private readonly pendingWaitersByTaskId = new Map<string, PendingTaskWaiter[]>();
  private readonly pendingStartWaitersByTaskId = new Map<string, PendingTaskStartWaiter[]>();
  // Tracks minions currently blocked in a foreground wait (e.g. a task tool call awaiting
  // agent_report). Used to avoid scheduler deadlocks when maxParallelAgentTasks is low and tasks
  // spawn nested tasks in the foreground.
  private readonly foregroundAwaitCountByMinionId = new Map<string, number>();
  // Cache completed reports so callers can retrieve them without re-reading disk.
  // Bounded by max entries; disk persistence is the source of truth for restart-safety.
  private readonly completedReportsByTaskId = new Map<string, CompletedAgentReportCacheEntry>();
  private readonly gitPatchArtifactService: GitPatchArtifactService;
  private readonly remindedAwaitingReport = new Set<string>();
  private readonly handoffInProgress = new Set<string>();
  /**
   * Hard-interrupted parent minions must not auto-resume until the next user message.
   * This closes races where descendants could report between parent interrupt and cascade cleanup.
   */
  private interruptedParentMinionIds = new Set<string>();
  /** Tracks consecutive auto-resumes per minion. Reset when a user message is sent. */
  private consecutiveAutoResumes = new Map<string, number>();

  constructor(
    private readonly config: Config,
    private readonly historyService: HistoryService,
    private readonly aiService: AIService,
    private readonly minionService: MinionService,
    private readonly initStateManager: InitStateManager
  ) {
    this.gitPatchArtifactService = new GitPatchArtifactService(config);

    this.aiService.on("stream-end", (payload: unknown) => {
      if (!isStreamEndEvent(payload)) return;

      void this.minionEventLocks
        .withLock(payload.minionId, async () => {
          await this.handleStreamEnd(payload);
        })
        .catch((error: unknown) => {
          log.error("TaskService.handleStreamEnd failed", { error });
        });
    });
  }

  // Prefer per-agent settings so tasks inherit the correct agent defaults;
  // fall back to legacy minion settings for older configs.
  private resolveMinionAISettings(
    minion: {
      aiSettingsByAgent?: Record<string, { model: string; thinkingLevel?: ThinkingLevel }>;
      aiSettings?: { model: string; thinkingLevel?: ThinkingLevel };
    },
    agentId: string | undefined
  ): { model: string; thinkingLevel?: ThinkingLevel } | undefined {
    const normalizedAgentId =
      typeof agentId === "string" && agentId.trim().length > 0
        ? agentId.trim().toLowerCase()
        : undefined;
    return (
      (normalizedAgentId ? minion.aiSettingsByAgent?.[normalizedAgentId] : undefined) ??
      minion.aiSettings
    );
  }
  /**
   * Derives auto-resume send options (agentId, model, thinkingLevel) from durable
   * conversation metadata, so synthetic resumes preserve the parent's active agent.
   *
   * Precedence: stream-end event metadata → last assistant message in history → minion AI settings → defaults.
   */
  private async resolveParentAutoResumeOptions(
    parentMinionId: string,
    parentEntry: {
      minion: {
        aiSettingsByAgent?: Record<string, { model: string; thinkingLevel?: ThinkingLevel }>;
        aiSettings?: { model: string; thinkingLevel?: ThinkingLevel };
      };
    },
    fallbackModel: string,
    hint?: ParentAutoResumeHint
  ): Promise<{ model: string; agentId: string; thinkingLevel?: ThinkingLevel }> {
    // 1) Try stream-end hint metadata (available in handleStreamEnd path)
    let agentId = hint?.agentId;

    // 2) Fall back to latest assistant message metadata in history (restart-safe)
    if (!agentId) {
      try {
        const historyResult = await this.historyService.getLastMessages(parentMinionId, 20);
        if (historyResult.success) {
          for (let i = historyResult.data.length - 1; i >= 0; i--) {
            const msg = historyResult.data[i];
            if (msg?.role === "assistant" && msg.metadata?.agentId) {
              agentId = msg.metadata.agentId;
              break;
            }
          }
        }
      } catch {
        // Best-effort; fall through to defaults
      }
    }

    // 3) Default
    // Keep task auto-resume recovery on exec even if the minion default agent changes.
    // This path needs a deterministic editing-capable fallback for legacy/incomplete metadata.
    agentId = agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID;

    const aiSettings = this.resolveMinionAISettings(parentEntry.minion, agentId);
    return {
      model: aiSettings?.model ?? fallbackModel,
      agentId,
      thinkingLevel: aiSettings?.thinkingLevel,
    };
  }

  private async isPlanLikeTaskMinion(entry: {
    projectPath: string;
    minion: Pick<
      MinionConfigEntry,
      "id" | "name" | "path" | "runtimeConfig" | "agentId" | "agentType"
    >;
  }): Promise<boolean> {
    assert(entry.projectPath.length > 0, "isPlanLikeTaskMinion: projectPath must be non-empty");

    const rawAgentId = coerceNonEmptyString(entry.minion.agentId ?? entry.minion.agentType);
    if (!rawAgentId) {
      return false;
    }

    const normalizedAgentId = rawAgentId.trim().toLowerCase();
    const parsedAgentId = AgentIdSchema.safeParse(normalizedAgentId);
    if (!parsedAgentId.success) {
      return normalizedAgentId === "plan";
    }

    const minionPath = coerceNonEmptyString(entry.minion.path);
    const minionName = coerceNonEmptyString(entry.minion.name) ?? entry.minion.id;
    const runtimeConfig = entry.minion.runtimeConfig ?? DEFAULT_RUNTIME_CONFIG;
    if (!minionPath || !minionName) {
      return parsedAgentId.data === "plan";
    }

    try {
      const runtime = createRuntimeForMinion({
        runtimeConfig,
        projectPath: entry.projectPath,
        name: minionName,
      });
      const agentDefinition = await readAgentDefinition(runtime, minionPath, parsedAgentId.data);
      const chain = await resolveAgentInheritanceChain({
        runtime,
        minionPath,
        agentId: agentDefinition.id,
        agentDefinition,
        minionId: entry.minion.id ?? minionName,
      });

      if (agentDefinition.id === "compact") {
        return false;
      }

      return isPlanLikeInResolvedChain(chain);
    } catch (error: unknown) {
      log.debug("Failed to resolve task agent mode; falling back to agentId check", {
        minionId: entry.minion.id,
        agentId: parsedAgentId.data,
        error: error instanceof Error ? error.message : String(error),
      });
      return parsedAgentId.data === "plan";
    }
  }

  private async isAgentEnabledForTaskMinion(args: {
    minionId: string;
    projectPath: string;
    minion: Pick<MinionConfigEntry, "id" | "name" | "path" | "runtimeConfig">;
    agentId: "exec" | "orchestrator";
  }): Promise<boolean> {
    assert(
      args.minionId.length > 0,
      "isAgentEnabledForTaskMinion: minionId must be non-empty"
    );
    assert(
      args.projectPath.length > 0,
      "isAgentEnabledForTaskMinion: projectPath must be non-empty"
    );

    const minionName = coerceNonEmptyString(args.minion.name) ?? args.minion.id;
    if (!minionName) {
      return false;
    }

    const runtimeConfig = args.minion.runtimeConfig ?? DEFAULT_RUNTIME_CONFIG;
    const runtime = createRuntimeForMinion({
      runtimeConfig,
      projectPath: args.projectPath,
      name: minionName,
    });
    const minionPath =
      coerceNonEmptyString(args.minion.path) ??
      runtime.getMinionPath(args.projectPath, minionName);

    if (!minionPath) {
      return false;
    }

    try {
      const resolvedFrontmatter = await resolveAgentFrontmatter(
        runtime,
        minionPath,
        args.agentId
      );
      const cfg = this.config.loadConfigOrDefault();
      const effectivelyDisabled = isAgentEffectivelyDisabled({
        cfg,
        agentId: args.agentId,
        resolvedFrontmatter,
      });
      return !effectivelyDisabled;
    } catch (error: unknown) {
      log.warn("Failed to resolve task handoff target agent availability", {
        minionId: args.minionId,
        agentId: args.agentId,
        error: getErrorMessage(error),
      });
      return false;
    }
  }

  private async resolvePlanAutoHandoffTargetAgentId(args: {
    minionId: string;
    entry: {
      projectPath: string;
      minion: Pick<
        MinionConfigEntry,
        "id" | "name" | "path" | "runtimeConfig" | "taskModelString"
      >;
    };
    routing: PlanSidekickExecutorRouting;
    planContent: string | null;
  }): Promise<"exec" | "orchestrator"> {
    assert(
      args.minionId.length > 0,
      "resolvePlanAutoHandoffTargetAgentId: minionId must be non-empty"
    );
    assert(
      args.routing === "exec" || args.routing === "orchestrator" || args.routing === "auto",
      "resolvePlanAutoHandoffTargetAgentId: routing must be exec, orchestrator, or auto"
    );

    const resolveOrchestratorAvailability = async (): Promise<"exec" | "orchestrator"> => {
      const orchestratorEnabled = await this.isAgentEnabledForTaskMinion({
        minionId: args.minionId,
        projectPath: args.entry.projectPath,
        minion: args.entry.minion,
        agentId: "orchestrator",
      });
      if (orchestratorEnabled) {
        return "orchestrator";
      }

      // If orchestrator is disabled/unavailable, fall back to exec before mutating
      // minion agent state so the handoff stream can still proceed.
      log.warn("Plan-task auto-handoff falling back to exec because orchestrator is unavailable", {
        minionId: args.minionId,
      });
      return "exec";
    };

    if (args.routing === "exec") {
      return "exec";
    }

    if (args.routing === "orchestrator") {
      return resolveOrchestratorAvailability();
    }

    if (!args.planContent || args.planContent.trim().length === 0) {
      log.warn("Plan-task auto-handoff auto-routing has no plan content; defaulting to exec", {
        minionId: args.minionId,
      });
      return "exec";
    }

    const modelString =
      coerceNonEmptyString(args.entry.minion.taskModelString) ?? defaultModel;
    assert(
      modelString.trim().length > 0,
      "resolvePlanAutoHandoffTargetAgentId: modelString must be non-empty"
    );

    const modelResult = await this.aiService.createModel(modelString);
    if (!modelResult.success) {
      log.warn("Plan-task auto-handoff auto-routing failed to create model; defaulting to exec", {
        minionId: args.minionId,
        model: modelString,
        error: modelResult.error,
      });
      return "exec";
    }

    const decision = await routePlanToExecutor({
      model: modelResult.data,
      planContent: args.planContent,
    });

    log.info("Plan-task auto-handoff routing decision", {
      minionId: args.minionId,
      target: decision.target,
      reasoning: decision.reasoning,
      model: modelString,
    });

    if (decision.target === "orchestrator") {
      return resolveOrchestratorAvailability();
    }

    return "exec";
  }

  private async emitMinionMetadata(minionId: string): Promise<void> {
    assert(minionId.length > 0, "emitMinionMetadata: minionId must be non-empty");

    const allMetadata = await this.config.getAllMinionMetadata();
    const metadata = allMetadata.find((m) => m.id === minionId) ?? null;
    this.minionService.emit("metadata", { minionId, metadata });
  }

  private async editMinionEntry(
    minionId: string,
    updater: (minion: MinionConfigEntry) => void,
    options?: { allowMissing?: boolean }
  ): Promise<boolean> {
    assert(minionId.length > 0, "editMinionEntry: minionId must be non-empty");

    let found = false;
    await this.config.editConfig((config) => {
      for (const [_projectPath, project] of config.projects) {
        const ws = project.minions.find((w) => w.id === minionId);
        if (!ws) continue;
        updater(ws);
        found = true;
        return config;
      }

      if (options?.allowMissing) {
        return config;
      }

      throw new Error(`editMinionEntry: minion ${minionId} not found`);
    });

    return found;
  }

  async initialize(): Promise<void> {
    await this.maybeStartQueuedTasks();

    const config = this.config.loadConfigOrDefault();
    const awaitingReportTasks = this.listAgentTaskMinions(config).filter(
      (t) => t.taskStatus === "awaiting_report"
    );
    const runningTasks = this.listAgentTaskMinions(config).filter(
      (t) => t.taskStatus === "running"
    );

    for (const task of awaitingReportTasks) {
      if (!task.id) continue;

      // Avoid resuming a task while it still has active descendants (it shouldn't report yet).
      const hasActiveDescendants = this.hasActiveDescendantAgentTasks(config, task.id);
      if (hasActiveDescendants) {
        continue;
      }

      // Restart-safety: if this task stream ends again without its required completion tool,
      // fall back immediately.
      this.remindedAwaitingReport.add(task.id);

      const isPlanLike = await this.isPlanLikeTaskMinion({
        projectPath: task.projectPath,
        minion: task,
      });
      const completionToolName = isPlanLike ? "propose_plan" : "agent_report";

      const model = task.taskModelString ?? defaultModel;
      const sendResult = await this.minionService.sendMessage(
        task.id,
        isPlanLike
          ? "This task is awaiting its final propose_plan. Call propose_plan exactly once now."
          : "This task is awaiting its final agent_report. Call agent_report exactly once now.",
        {
          model,
          agentId: task.agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID,
          thinkingLevel: task.taskThinkingLevel,
          toolPolicy: [{ regex_match: `^${completionToolName}$`, action: "require" }],
        },
        { synthetic: true }
      );
      if (!sendResult.success) {
        log.error("Failed to resume awaiting_report task on startup", {
          taskId: task.id,
          error: sendResult.error,
        });

        await this.fallbackReportMissingCompletionTool(
          {
            projectPath: task.projectPath,
            minion: task,
          },
          completionToolName
        );
      }
    }

    for (const task of runningTasks) {
      if (!task.id) continue;
      // Best-effort: if lattice restarted mid-stream, nudge the agent to continue and report.
      // Only do this when the task has no running descendants, to avoid duplicate spawns.
      const hasActiveDescendants = this.hasActiveDescendantAgentTasks(config, task.id);
      if (hasActiveDescendants) {
        continue;
      }

      const isPlanLike = await this.isPlanLikeTaskMinion({
        projectPath: task.projectPath,
        minion: task,
      });

      const model = task.taskModelString ?? defaultModel;
      await this.minionService.sendMessage(
        task.id,
        isPlanLike
          ? "Lattice restarted while this task was running. Continue where you left off. " +
              "When you have a final plan, call propose_plan exactly once."
          : "Lattice restarted while this task was running. Continue where you left off. " +
              "When you have a final answer, call agent_report exactly once.",
        {
          model,
          agentId: task.agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID,
          thinkingLevel: task.taskThinkingLevel,
          experiments: task.taskExperiments,
        },
        { synthetic: true }
      );
    }

    // Restart-safety for git patch artifacts:
    // - If lattice crashed mid-generation, patch artifacts can be left "pending".
    // - Reported tasks are auto-deleted once they're leaves; defer deletion while patches are pending.
    const reportedTasks = this.listAgentTaskMinions(config).filter(
      (t) => t.taskStatus === "reported" && typeof t.id === "string" && t.id.length > 0
    );

    for (const task of reportedTasks) {
      if (!task.parentMinionId) continue;
      try {
        await this.gitPatchArtifactService.maybeStartGeneration(
          task.parentMinionId,
          task.id!,
          (wsId) => this.requestReportedTaskCleanupRecheck(wsId)
        );
      } catch (error: unknown) {
        log.error("Failed to resume sidekick git patch generation on startup", {
          parentMinionId: task.parentMinionId,
          childMinionId: task.id,
          error,
        });
      }
    }

    // Best-effort cleanup of reported leaf tasks (will no-op when patch artifacts are pending).
    for (const task of reportedTasks) {
      if (!task.id) continue;
      await this.cleanupReportedLeafTask(task.id);
    }
  }

  private startMinionInit(minionId: string, projectPath: string): InitLogger {
    assert(minionId.length > 0, "startMinionInit: minionId must be non-empty");
    assert(projectPath.length > 0, "startMinionInit: projectPath must be non-empty");

    this.initStateManager.startInit(minionId, projectPath);
    return {
      logStep: (message: string) => this.initStateManager.appendOutput(minionId, message, false),
      logStdout: (line: string) => this.initStateManager.appendOutput(minionId, line, false),
      logStderr: (line: string) => this.initStateManager.appendOutput(minionId, line, true),
      logComplete: (exitCode: number) => void this.initStateManager.endInit(minionId, exitCode),
      enterHookPhase: () => this.initStateManager.enterHookPhase(minionId),
    };
  }

  async create(args: TaskCreateArgs): Promise<Result<TaskCreateResult, string>> {
    const parentMinionId = coerceNonEmptyString(args.parentMinionId);
    if (!parentMinionId) {
      return Err("Task.create: parentMinionId is required");
    }
    if (args.kind !== "agent") {
      return Err("Task.create: unsupported kind");
    }

    const prompt = coerceNonEmptyString(args.prompt);
    if (!prompt) {
      return Err("Task.create: prompt is required");
    }

    const agentIdRaw = coerceNonEmptyString(args.agentId ?? args.agentType);
    if (!agentIdRaw) {
      return Err("Task.create: agentId is required");
    }

    const normalizedAgentId = agentIdRaw.trim().toLowerCase();
    const parsedAgentId = AgentIdSchema.safeParse(normalizedAgentId);
    if (!parsedAgentId.success) {
      return Err(`Task.create: invalid agentId (${normalizedAgentId})`);
    }

    const agentId = parsedAgentId.data;
    const agentType = agentId; // Legacy alias for on-disk compatibility.

    await using _lock = await this.mutex.acquire();

    // Validate parent exists and fetch runtime context.
    const parentMetaResult = await this.aiService.getMinionMetadata(parentMinionId);
    if (!parentMetaResult.success) {
      return Err(`Task.create: parent minion not found (${parentMetaResult.error})`);
    }
    const parentMeta = parentMetaResult.data;

    // Enforce nesting depth.
    const cfg = this.config.loadConfigOrDefault();
    const taskSettings = cfg.taskSettings ?? DEFAULT_TASK_SETTINGS;

    const parentEntry = findMinionEntry(cfg, parentMinionId);
    if (parentEntry?.minion.taskStatus === "reported") {
      return Err("Task.create: cannot spawn new tasks after agent_report");
    }

    const requestedDepth = this.getTaskDepth(cfg, parentMinionId) + 1;
    if (requestedDepth > taskSettings.maxTaskNestingDepth) {
      return Err(
        `Task.create: maxTaskNestingDepth exceeded (requestedDepth=${requestedDepth}, max=${taskSettings.maxTaskNestingDepth})`
      );
    }

    // Enforce parallelism (global).
    const activeCount = this.countActiveAgentTasks(cfg);
    const shouldQueue = activeCount >= taskSettings.maxParallelAgentTasks;

    const taskId = this.config.generateStableId();
    const minionName = buildAgentMinionName(agentId, taskId);

    const nameValidation = validateMinionName(minionName);
    if (!nameValidation.valid) {
      return Err(
        `Task.create: generated minion name invalid (${nameValidation.error ?? "unknown error"})`
      );
    }

    // User-requested precedence: use global per-agent defaults when configured;
    // otherwise inherit the parent minion's active model/thinking.
    const parentAiSettings = this.resolveMinionAISettings(parentMeta, agentId);
    const inheritedModelCandidate =
      typeof args.modelString === "string" && args.modelString.trim().length > 0
        ? args.modelString
        : parentAiSettings?.model;
    const parentActiveModel =
      typeof inheritedModelCandidate === "string" && inheritedModelCandidate.trim().length > 0
        ? inheritedModelCandidate.trim()
        : defaultModel;
    const globalDefault = cfg.agentAiDefaults?.[agentId];
    const configuredModel = globalDefault?.modelString?.trim();
    const taskModelString =
      configuredModel && configuredModel.length > 0 ? configuredModel : parentActiveModel;
    const canonicalModel = taskModelString.trim();
    assert(canonicalModel.length > 0, "Task.create: resolved model must be non-empty");

    const requestedThinkingLevel: ThinkingLevel =
      globalDefault?.thinkingLevel ??
      args.thinkingLevel ??
      parentAiSettings?.thinkingLevel ??
      "off";
    const effectiveThinkingLevel = enforceThinkingPolicy(canonicalModel, requestedThinkingLevel);

    const parentRuntimeConfig = parentMeta.runtimeConfig;
    const taskRuntimeConfig: RuntimeConfig = parentRuntimeConfig;

    const runtime = createRuntimeForMinion({
      runtimeConfig: taskRuntimeConfig,
      projectPath: parentMeta.projectPath,
      name: parentMeta.name,
    });

    // Validate the agent definition exists and is runnable as a sidekick.
    const isInPlace = parentMeta.projectPath === parentMeta.name;
    const parentMinionPath = isInPlace
      ? parentMeta.projectPath
      : runtime.getMinionPath(parentMeta.projectPath, parentMeta.name);

    // Helper to build error hint with all available runnable agents.
    // NOTE: This resolves frontmatter inheritance so same-name overrides (e.g. project exec.md
    // with base: exec) still count as runnable.
    const getRunnableHint = async (): Promise<string> => {
      try {
        const allAgents = await discoverAgentDefinitions(runtime, parentMinionPath);

        const runnableIds = (
          await Promise.all(
            allAgents.map(async (agent) => {
              try {
                const frontmatter = await resolveAgentFrontmatter(
                  runtime,
                  parentMinionPath,
                  agent.id
                );
                if (frontmatter.sidekick?.runnable !== true) {
                  return null;
                }

                const effectivelyDisabled = isAgentEffectivelyDisabled({
                  cfg,
                  agentId: agent.id,
                  resolvedFrontmatter: frontmatter,
                });
                return effectivelyDisabled ? null : agent.id;
              } catch {
                return null;
              }
            })
          )
        ).filter((id): id is string => typeof id === "string");

        return runnableIds.length > 0
          ? `Runnable agentIds: ${runnableIds.join(", ")}`
          : "No runnable agents available";
      } catch {
        return "Could not discover available agents";
      }
    };

    let skipInitHook = false;
    try {
      const frontmatter = await resolveAgentFrontmatter(runtime, parentMinionPath, agentId);
      if (frontmatter.sidekick?.runnable !== true) {
        const hint = await getRunnableHint();
        return Err(`Task.create: agentId is not runnable as a sub-agent (${agentId}). ${hint}`);
      }

      if (
        isAgentEffectivelyDisabled({
          cfg,
          agentId,
          resolvedFrontmatter: frontmatter,
        })
      ) {
        const hint = await getRunnableHint();
        return Err(`Task.create: agentId is disabled (${agentId}). ${hint}`);
      }
      skipInitHook = frontmatter.sidekick?.skip_init_hook === true;
    } catch {
      const hint = await getRunnableHint();
      return Err(`Task.create: unknown agentId (${agentId}). ${hint}`);
    }

    const createdAt = getIsoNow();

    taskQueueDebug("TaskService.create decision", {
      parentMinionId,
      taskId,
      agentId,
      minionName,
      createdAt,
      activeCount,
      maxParallelAgentTasks: taskSettings.maxParallelAgentTasks,
      shouldQueue,
      runtimeType: taskRuntimeConfig.type,
      promptLength: prompt.length,
      model: taskModelString,
      thinkingLevel: effectiveThinkingLevel,
    });

    if (shouldQueue) {
      const trunkBranch = coerceNonEmptyString(parentMeta.name);
      if (!trunkBranch) {
        return Err("Task.create: parent minion name missing (cannot queue task)");
      }

      // NOTE: Queued tasks are persisted immediately, but their minion is created later
      // when a parallel slot is available. This ensures queued tasks don't create worktrees
      // or run init hooks until they actually start.
      const minionPath = runtime.getMinionPath(parentMeta.projectPath, minionName);

      taskQueueDebug("TaskService.create queued (persist-only)", {
        taskId,
        minionName,
        parentMinionId,
        trunkBranch,
        minionPath,
      });

      await this.config.editConfig((config) => {
        let projectConfig = config.projects.get(parentMeta.projectPath);
        if (!projectConfig) {
          projectConfig = { minions: [] };
          config.projects.set(parentMeta.projectPath, projectConfig);
        }

        projectConfig.minions.push({
          path: minionPath,
          id: taskId,
          name: minionName,
          title: args.title,
          createdAt,
          runtimeConfig: taskRuntimeConfig,
          aiSettings: { model: canonicalModel, thinkingLevel: effectiveThinkingLevel },
          parentMinionId,
          agentId,
          agentType,
          taskStatus: "queued",
          taskPrompt: prompt,
          taskTrunkBranch: trunkBranch,
          taskModelString,
          taskThinkingLevel: effectiveThinkingLevel,
          taskExperiments: args.experiments,
        });
        return config;
      });

      // Emit metadata update so the UI sees the minion immediately.
      await this.emitMinionMetadata(taskId);

      // NOTE: Do NOT persist the prompt into chat history until the task actually starts.
      // Otherwise the frontend treats "last message is user" as an interrupted stream and
      // will auto-retry / backoff-spam resume attempts while the task is queued.
      taskQueueDebug("TaskService.create queued persisted (prompt stored in config)", {
        taskId,
        minionName,
      });

      // Schedule queue processing (best-effort).
      void this.maybeStartQueuedTasks();
      taskQueueDebug("TaskService.create queued scheduled maybeStartQueuedTasks", { taskId });
      return Ok({ taskId, kind: "agent", status: "queued" });
    }

    const initLogger = this.startMinionInit(taskId, parentMeta.projectPath);

    // Note: Local project-dir runtimes share the same directory (unsafe by design).
    // For worktree/ssh runtimes we attempt a fork first; otherwise fall back to createMinion.

    const forkResult = await orchestrateFork({
      sourceRuntime: runtime,
      projectPath: parentMeta.projectPath,
      sourceMinionName: parentMeta.name,
      newMinionName: minionName,
      initLogger,
      config: this.config,
      sourceMinionId: parentMinionId,
      sourceRuntimeConfig: parentRuntimeConfig,
      allowCreateFallback: true,
    });

    if (forkResult.success && forkResult.data.sourceRuntimeConfigUpdate) {
      await this.config.updateMinionMetadata(parentMinionId, {
        runtimeConfig: forkResult.data.sourceRuntimeConfigUpdate,
      });
      // Ensure UI gets the updated runtimeConfig for the parent minion.
      await this.emitMinionMetadata(parentMinionId);
    }

    if (!forkResult.success) {
      initLogger.logComplete(-1);
      return Err(`Task fork failed: ${forkResult.error}`);
    }

    const {
      minionPath,
      trunkBranch,
      forkedRuntimeConfig,
      targetRuntime: runtimeForTaskMinion,
      forkedFromSource,
    } = forkResult.data;
    const taskBaseCommitSha = await tryReadGitHeadCommitSha(runtimeForTaskMinion, minionPath);

    taskQueueDebug("TaskService.create started (minion created)", {
      taskId,
      minionName,
      minionPath,
      trunkBranch,
      forkSuccess: forkedFromSource,
    });

    // Persist minion entry before starting work so it's durable across crashes.
    await this.config.editConfig((config) => {
      let projectConfig = config.projects.get(parentMeta.projectPath);
      if (!projectConfig) {
        projectConfig = { minions: [] };
        config.projects.set(parentMeta.projectPath, projectConfig);
      }

      projectConfig.minions.push({
        path: minionPath,
        id: taskId,
        name: minionName,
        title: args.title,
        createdAt,
        runtimeConfig: forkedRuntimeConfig,
        aiSettings: { model: canonicalModel, thinkingLevel: effectiveThinkingLevel },
        agentId,
        parentMinionId,
        agentType,
        taskStatus: "running",
        taskTrunkBranch: trunkBranch,
        taskBaseCommitSha: taskBaseCommitSha ?? undefined,
        taskModelString,
        taskThinkingLevel: effectiveThinkingLevel,
        taskExperiments: args.experiments,
      });
      return config;
    });

    // Emit metadata update so the UI sees the minion immediately.
    await this.emitMinionMetadata(taskId);

    // Kick init (best-effort, async).
    const secrets = secretsToRecord(this.config.getEffectiveSecrets(parentMeta.projectPath));
    runBackgroundInit(
      runtimeForTaskMinion,
      {
        projectPath: parentMeta.projectPath,
        branchName: minionName,
        trunkBranch,
        minionPath,
        initLogger,
        env: secrets,
        skipInitHook,
      },
      taskId
    );

    // Start immediately (counts towards parallel limit).
    const sendResult = await this.minionService.sendMessage(taskId, prompt, {
      model: taskModelString,
      agentId,
      thinkingLevel: effectiveThinkingLevel,
      experiments: args.experiments,
    });
    if (!sendResult.success) {
      const message =
        typeof sendResult.error === "string"
          ? sendResult.error
          : formatSendMessageError(sendResult.error).message;
      await this.rollbackFailedTaskCreate(
        runtimeForTaskMinion,
        parentMeta.projectPath,
        minionName,
        taskId
      );
      return Err(message);
    }

    return Ok({ taskId, kind: "agent", status: "running" });
  }

  async terminateDescendantAgentTask(
    ancestorMinionId: string,
    taskId: string
  ): Promise<Result<TerminateAgentTaskResult, string>> {
    assert(
      ancestorMinionId.length > 0,
      "terminateDescendantAgentTask: ancestorMinionId must be non-empty"
    );
    assert(taskId.length > 0, "terminateDescendantAgentTask: taskId must be non-empty");

    const terminatedTaskIds: string[] = [];

    {
      await using _lock = await this.mutex.acquire();

      const cfg = this.config.loadConfigOrDefault();
      const entry = findMinionEntry(cfg, taskId);
      if (!entry?.minion.parentMinionId) {
        return Err("Task not found");
      }

      const index = this.buildAgentTaskIndex(cfg);
      if (
        !this.isDescendantAgentTaskUsingParentById(index.parentById, ancestorMinionId, taskId)
      ) {
        return Err("Task is not a descendant of this minion");
      }

      // Terminate the entire subtree to avoid orphaned descendant tasks.
      const descendants = this.listDescendantAgentTaskIdsFromIndex(index, taskId);
      const toTerminate = Array.from(new Set([taskId, ...descendants]));

      // Delete leaves first to avoid leaving children with missing parents.
      const parentById = index.parentById;
      const depthById = new Map<string, number>();
      for (const id of toTerminate) {
        depthById.set(id, this.getTaskDepthFromParentById(parentById, id));
      }
      toTerminate.sort((a, b) => (depthById.get(b) ?? 0) - (depthById.get(a) ?? 0));

      const terminationError = new Error("Task terminated");

      for (const id of toTerminate) {
        // Best-effort: stop any active stream immediately to avoid further token usage.
        try {
          const stopResult = await this.aiService.stopStream(id, { abandonPartial: true });
          if (!stopResult.success) {
            log.debug("terminateDescendantAgentTask: stopStream failed", { taskId: id });
          }
        } catch (error: unknown) {
          log.debug("terminateDescendantAgentTask: stopStream threw", { taskId: id, error });
        }

        this.remindedAwaitingReport.delete(id);
        this.completedReportsByTaskId.delete(id);
        this.rejectWaiters(id, terminationError);

        const removeResult = await this.minionService.remove(id, true);
        if (!removeResult.success) {
          return Err(`Failed to remove task minion (${id}): ${removeResult.error}`);
        }

        terminatedTaskIds.push(id);
      }
    }

    // Free slots and start any queued tasks (best-effort).
    await this.maybeStartQueuedTasks();

    return Ok({ terminatedTaskIds });
  }

  /**
   * Interrupt all descendant agent tasks for a minion (leaf-first).
   *
   * Rationale: when a user hard-interrupts a parent minion, descendants must
   * also stop so they cannot later auto-resume the interrupted parent.
   *
   * Keep interrupted task minions on disk so users can inspect or manually
   * resume them later.
   *
   * Legacy naming note: this method retains the original "terminate" name for
   * compatibility with existing call sites.
   */
  async terminateAllDescendantAgentTasks(minionId: string): Promise<string[]> {
    assert(
      minionId.length > 0,
      "terminateAllDescendantAgentTasks: minionId must be non-empty"
    );

    const interruptedTaskIds: string[] = [];

    {
      await using _lock = await this.mutex.acquire();

      const cfg = this.config.loadConfigOrDefault();
      const index = this.buildAgentTaskIndex(cfg);
      const descendants = this.listDescendantAgentTaskIdsFromIndex(index, minionId);
      if (descendants.length === 0) {
        return interruptedTaskIds;
      }

      // Interrupt leaves first to avoid descendant/ancestor status races.
      const parentById = index.parentById;
      const depthById = new Map<string, number>();
      for (const id of descendants) {
        depthById.set(id, this.getTaskDepthFromParentById(parentById, id));
      }
      descendants.sort((a, b) => (depthById.get(b) ?? 0) - (depthById.get(a) ?? 0));

      const interruptionError = new Error("Parent minion interrupted");

      for (const id of descendants) {
        // Best-effort: clear queue first. AgentSession stream-end cleanup auto-flushes
        // queued messages, so descendants must not keep pending input after a hard interrupt.
        try {
          const clearQueueResult = this.minionService.clearQueue(id);
          if (!clearQueueResult.success) {
            log.debug("terminateAllDescendantAgentTasks: clearQueue failed", {
              taskId: id,
              error: clearQueueResult.error,
            });
          }
        } catch (error: unknown) {
          log.debug("terminateAllDescendantAgentTasks: clearQueue threw", { taskId: id, error });
        }

        // Best-effort: stop any active stream immediately to avoid further token usage.
        try {
          const stopResult = await this.aiService.stopStream(id, { abandonPartial: true });
          if (!stopResult.success) {
            log.debug("terminateAllDescendantAgentTasks: stopStream failed", { taskId: id });
          }
        } catch (error: unknown) {
          log.debug("terminateAllDescendantAgentTasks: stopStream threw", { taskId: id, error });
        }

        this.remindedAwaitingReport.delete(id);
        this.completedReportsByTaskId.delete(id);
        this.rejectWaiters(id, interruptionError);

        const updated = await this.editMinionEntry(
          id,
          (ws) => {
            const previousStatus = ws.taskStatus;
            const persistedQueuedPrompt = coerceNonEmptyString(ws.taskPrompt);
            ws.taskStatus = "interrupted";

            // Queued tasks persist their initial prompt in config until first start.
            // Preserve that prompt when interrupting queued descendants so users can
            // still inspect/resume the preserved minion intent.
            //
            // Also preserve across repeated hard interrupts: once a never-started task
            // is first interrupted, its status becomes "interrupted". Later cascades
            // must not clear the same persisted prompt.
            if (previousStatus !== "queued" && !persistedQueuedPrompt) {
              ws.taskPrompt = undefined;
            }
          },
          { allowMissing: true }
        );
        if (!updated) {
          log.debug("terminateAllDescendantAgentTasks: descendant minion missing", {
            taskId: id,
          });
          continue;
        }

        interruptedTaskIds.push(id);
      }
    }

    for (const taskId of interruptedTaskIds) {
      await this.emitMinionMetadata(taskId);
    }

    // Free slots and start any queued tasks (best-effort).
    await this.maybeStartQueuedTasks();

    return interruptedTaskIds;
  }

  private async rollbackFailedTaskCreate(
    runtime: Runtime,
    projectPath: string,
    minionName: string,
    taskId: string
  ): Promise<void> {
    try {
      await this.config.removeMinion(taskId);
    } catch (error: unknown) {
      log.error("Task.create rollback: failed to remove minion from config", {
        taskId,
        error: getErrorMessage(error),
      });
    }

    this.minionService.emit("metadata", { minionId: taskId, metadata: null });

    try {
      const deleteResult = await runtime.deleteMinion(projectPath, minionName, true);
      if (!deleteResult.success) {
        log.error("Task.create rollback: failed to delete minion", {
          taskId,
          error: deleteResult.error,
        });
      }
    } catch (error: unknown) {
      log.error("Task.create rollback: runtime.deleteMinion threw", {
        taskId,
        error: getErrorMessage(error),
      });
    }

    try {
      const sessionDir = this.config.getSessionDir(taskId);
      await fsPromises.rm(sessionDir, { recursive: true, force: true });
    } catch (error: unknown) {
      log.error("Task.create rollback: failed to remove session directory", {
        taskId,
        error: getErrorMessage(error),
      });
    }
  }

  private isForegroundAwaiting(minionId: string): boolean {
    const count = this.foregroundAwaitCountByMinionId.get(minionId);
    return typeof count === "number" && count > 0;
  }

  private startForegroundAwait(minionId: string): () => void {
    assert(minionId.length > 0, "startForegroundAwait: minionId must be non-empty");

    const current = this.foregroundAwaitCountByMinionId.get(minionId) ?? 0;
    assert(
      Number.isInteger(current) && current >= 0,
      "startForegroundAwait: expected non-negative integer counter"
    );

    this.foregroundAwaitCountByMinionId.set(minionId, current + 1);

    return () => {
      const current = this.foregroundAwaitCountByMinionId.get(minionId) ?? 0;
      assert(
        Number.isInteger(current) && current > 0,
        "startForegroundAwait cleanup: expected positive integer counter"
      );
      if (current <= 1) {
        this.foregroundAwaitCountByMinionId.delete(minionId);
      } else {
        this.foregroundAwaitCountByMinionId.set(minionId, current - 1);
      }
    };
  }

  async waitForAgentReport(
    taskId: string,
    options?: { timeoutMs?: number; abortSignal?: AbortSignal; requestingMinionId?: string }
  ): Promise<{ reportMarkdown: string; title?: string }> {
    assert(taskId.length > 0, "waitForAgentReport: taskId must be non-empty");

    const cached = this.completedReportsByTaskId.get(taskId);
    if (cached) {
      return { reportMarkdown: cached.reportMarkdown, title: cached.title };
    }

    const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000; // 10 minutes
    assert(Number.isFinite(timeoutMs) && timeoutMs > 0, "waitForAgentReport: timeoutMs invalid");

    const requestingMinionId = coerceNonEmptyString(options?.requestingMinionId);

    const tryReadPersistedReport = async (): Promise<{
      reportMarkdown: string;
      title?: string;
    } | null> => {
      if (!requestingMinionId) {
        return null;
      }

      const sessionDir = this.config.getSessionDir(requestingMinionId);
      const artifact = await readSidekickReportArtifact(sessionDir, taskId);
      if (!artifact) {
        return null;
      }

      // Cache for the current process (best-effort). Disk is the source of truth.
      this.completedReportsByTaskId.set(taskId, {
        reportMarkdown: artifact.reportMarkdown,
        title: artifact.title,
        ancestorMinionIds: artifact.ancestorMinionIds,
      });
      this.enforceCompletedReportCacheLimit();

      return { reportMarkdown: artifact.reportMarkdown, title: artifact.title };
    };

    // Fast-path: if the task is already gone (cleanup) or already reported (restart), return the
    // persisted artifact from the requesting minion session dir.
    const cfg = this.config.loadConfigOrDefault();
    const taskMinionEntry = findMinionEntry(cfg, taskId);
    const taskStatus = taskMinionEntry?.minion.taskStatus;
    if (!taskMinionEntry || taskStatus === "reported" || taskStatus === "interrupted") {
      const persisted = await tryReadPersistedReport();
      if (persisted) {
        return persisted;
      }

      if (taskStatus === "interrupted") {
        throw new Error("Task interrupted");
      }

      throw new Error("Task not found");
    }

    return await new Promise<{ reportMarkdown: string; title?: string }>((resolve, reject) => {
      void (async () => {
        // Validate existence early to avoid waiting on never-resolving task IDs.
        const cfg = this.config.loadConfigOrDefault();
        const taskMinionEntry = findMinionEntry(cfg, taskId);
        if (!taskMinionEntry) {
          const persisted = await tryReadPersistedReport();
          if (persisted) {
            resolve(persisted);
            return;
          }

          reject(new Error("Task not found"));
          return;
        }

        if (
          taskMinionEntry.minion.taskStatus === "reported" ||
          taskMinionEntry.minion.taskStatus === "interrupted"
        ) {
          const persisted = await tryReadPersistedReport();
          if (persisted) {
            resolve(persisted);
            return;
          }

          reject(
            new Error(
              taskMinionEntry.minion.taskStatus === "interrupted"
                ? "Task interrupted"
                : "Task not found"
            )
          );
          return;
        }

        let timeout: ReturnType<typeof setTimeout> | null = null;
        let startWaiter: PendingTaskStartWaiter | null = null;
        let abortListener: (() => void) | null = null;
        let stopBlockingRequester: (() => void) | null = requestingMinionId
          ? this.startForegroundAwait(requestingMinionId)
          : null;

        const startReportTimeout = () => {
          if (timeout) return;
          timeout = setTimeout(() => {
            entry.cleanup();
            reject(new Error("Timed out waiting for agent_report"));
          }, timeoutMs);
        };

        const cleanupStartWaiter = () => {
          if (!startWaiter) return;
          startWaiter.cleanup();
          startWaiter = null;
        };

        const entry: PendingTaskWaiter = {
          createdAt: Date.now(),
          resolve: (report) => {
            entry.cleanup();
            resolve(report);
          },
          reject: (error) => {
            entry.cleanup();
            reject(error);
          },
          cleanup: () => {
            const current = this.pendingWaitersByTaskId.get(taskId);
            if (current) {
              const next = current.filter((w) => w !== entry);
              if (next.length === 0) {
                this.pendingWaitersByTaskId.delete(taskId);
              } else {
                this.pendingWaitersByTaskId.set(taskId, next);
              }
            }

            cleanupStartWaiter();

            if (timeout) {
              clearTimeout(timeout);
              timeout = null;
            }

            if (abortListener && options?.abortSignal) {
              options.abortSignal.removeEventListener("abort", abortListener);
              abortListener = null;
            }

            if (stopBlockingRequester) {
              try {
                stopBlockingRequester();
              } finally {
                stopBlockingRequester = null;
              }
            }
          },
        };

        const list = this.pendingWaitersByTaskId.get(taskId) ?? [];
        list.push(entry);
        this.pendingWaitersByTaskId.set(taskId, list);

        // Don't start the execution timeout while the task is still queued.
        // The timer starts once the child actually begins running (queued -> running).
        const initialStatus = taskMinionEntry.minion.taskStatus;
        if (initialStatus === "queued") {
          const startWaiterEntry: PendingTaskStartWaiter = {
            createdAt: Date.now(),
            start: startReportTimeout,
            cleanup: () => {
              const currentStartWaiters = this.pendingStartWaitersByTaskId.get(taskId);
              if (currentStartWaiters) {
                const next = currentStartWaiters.filter((w) => w !== startWaiterEntry);
                if (next.length === 0) {
                  this.pendingStartWaitersByTaskId.delete(taskId);
                } else {
                  this.pendingStartWaitersByTaskId.set(taskId, next);
                }
              }
            },
          };
          startWaiter = startWaiterEntry;

          const currentStartWaiters = this.pendingStartWaitersByTaskId.get(taskId) ?? [];
          currentStartWaiters.push(startWaiterEntry);
          this.pendingStartWaitersByTaskId.set(taskId, currentStartWaiters);

          // Close the race where the task starts between the initial config read and registering the waiter.
          const cfgAfterRegister = this.config.loadConfigOrDefault();
          const afterEntry = findMinionEntry(cfgAfterRegister, taskId);
          if (afterEntry?.minion.taskStatus !== "queued") {
            cleanupStartWaiter();
            startReportTimeout();
          }

          // If the awaited task is queued and the caller is blocked in the foreground, ensure the
          // scheduler runs after the waiter is registered. This avoids deadlocks when
          // maxParallelAgentTasks is low.
          if (requestingMinionId) {
            void this.maybeStartQueuedTasks();
          }
        } else {
          startReportTimeout();
        }

        if (options?.abortSignal) {
          if (options.abortSignal.aborted) {
            entry.cleanup();
            reject(new Error("Interrupted"));
            return;
          }

          abortListener = () => {
            entry.cleanup();
            reject(new Error("Interrupted"));
          };
          options.abortSignal.addEventListener("abort", abortListener, { once: true });
        }
      })().catch((error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  getAgentTaskStatus(taskId: string): AgentTaskStatus | null {
    assert(taskId.length > 0, "getAgentTaskStatus: taskId must be non-empty");

    const cfg = this.config.loadConfigOrDefault();
    const entry = findMinionEntry(cfg, taskId);
    const status = entry?.minion.taskStatus;
    return status ?? null;
  }

  hasActiveDescendantAgentTasksForMinion(minionId: string): boolean {
    assert(
      minionId.length > 0,
      "hasActiveDescendantAgentTasksForMinion: minionId must be non-empty"
    );

    const cfg = this.config.loadConfigOrDefault();
    return this.hasActiveDescendantAgentTasks(cfg, minionId);
  }

  listActiveDescendantAgentTaskIds(minionId: string): string[] {
    assert(
      minionId.length > 0,
      "listActiveDescendantAgentTaskIds: minionId must be non-empty"
    );

    const cfg = this.config.loadConfigOrDefault();
    const index = this.buildAgentTaskIndex(cfg);

    const activeStatuses = new Set<AgentTaskStatus>(["queued", "running", "awaiting_report"]);
    const result: string[] = [];
    const stack: string[] = [...(index.childrenByParent.get(minionId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      const status = index.byId.get(next)?.taskStatus;
      if (status && activeStatuses.has(status)) {
        result.push(next);
      }
      const children = index.childrenByParent.get(next);
      if (children) {
        for (const child of children) {
          stack.push(child);
        }
      }
    }
    return result;
  }

  listDescendantAgentTasks(
    minionId: string,
    options?: { statuses?: AgentTaskStatus[] }
  ): DescendantAgentTaskInfo[] {
    assert(minionId.length > 0, "listDescendantAgentTasks: minionId must be non-empty");

    const statuses = options?.statuses;
    const statusFilter = statuses && statuses.length > 0 ? new Set(statuses) : null;

    const cfg = this.config.loadConfigOrDefault();
    const index = this.buildAgentTaskIndex(cfg);

    const result: DescendantAgentTaskInfo[] = [];

    const stack: Array<{ taskId: string; depth: number }> = [];
    for (const childTaskId of index.childrenByParent.get(minionId) ?? []) {
      stack.push({ taskId: childTaskId, depth: 1 });
    }

    while (stack.length > 0) {
      const next = stack.pop()!;
      const entry = index.byId.get(next.taskId);
      if (!entry) continue;

      assert(
        entry.parentMinionId,
        `listDescendantAgentTasks: task ${next.taskId} is missing parentMinionId`
      );

      const status: AgentTaskStatus = entry.taskStatus ?? "running";
      if (!statusFilter || statusFilter.has(status)) {
        result.push({
          taskId: next.taskId,
          status,
          parentMinionId: entry.parentMinionId,
          agentType: entry.agentType,
          minionName: entry.name,
          title: entry.title,
          createdAt: entry.createdAt,
          modelString: entry.aiSettings?.model,
          thinkingLevel: entry.aiSettings?.thinkingLevel,
          depth: next.depth,
        });
      }

      for (const childTaskId of index.childrenByParent.get(next.taskId) ?? []) {
        stack.push({ taskId: childTaskId, depth: next.depth + 1 });
      }
    }

    // Stable ordering: oldest first, then depth (ties by taskId for determinism).
    result.sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (aTime !== bTime) return aTime - bTime;
      if (a.depth !== b.depth) return a.depth - b.depth;
      return a.taskId.localeCompare(b.taskId);
    });

    return result;
  }

  async filterDescendantAgentTaskIds(
    ancestorMinionId: string,
    taskIds: string[]
  ): Promise<string[]> {
    assert(
      ancestorMinionId.length > 0,
      "filterDescendantAgentTaskIds: ancestorMinionId required"
    );
    assert(Array.isArray(taskIds), "filterDescendantAgentTaskIds: taskIds must be an array");

    const cfg = this.config.loadConfigOrDefault();
    const parentById = this.buildAgentTaskIndex(cfg).parentById;

    const result: string[] = [];
    const maybePersisted: string[] = [];

    for (const taskId of taskIds) {
      if (typeof taskId !== "string" || taskId.length === 0) continue;

      if (this.isDescendantAgentTaskUsingParentById(parentById, ancestorMinionId, taskId)) {
        result.push(taskId);
        continue;
      }

      const cached = this.completedReportsByTaskId.get(taskId);
      if (hasAncestorMinionId(cached, ancestorMinionId)) {
        result.push(taskId);
        continue;
      }

      maybePersisted.push(taskId);
    }

    if (maybePersisted.length === 0) {
      return result;
    }

    const sessionDir = this.config.getSessionDir(ancestorMinionId);
    const persisted = await readSidekickReportArtifactsFile(sessionDir);
    for (const taskId of maybePersisted) {
      const entry = persisted.artifactsByChildTaskId[taskId];
      if (!entry) continue;
      if (hasAncestorMinionId(entry, ancestorMinionId)) {
        result.push(taskId);
      }
    }

    return result;
  }

  private listDescendantAgentTaskIdsFromIndex(
    index: AgentTaskIndex,
    minionId: string
  ): string[] {
    assert(
      minionId.length > 0,
      "listDescendantAgentTaskIdsFromIndex: minionId must be non-empty"
    );

    const result: string[] = [];
    const stack: string[] = [...(index.childrenByParent.get(minionId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      result.push(next);
      const children = index.childrenByParent.get(next);
      if (children) {
        for (const child of children) {
          stack.push(child);
        }
      }
    }
    return result;
  }

  async isDescendantAgentTask(ancestorMinionId: string, taskId: string): Promise<boolean> {
    assert(ancestorMinionId.length > 0, "isDescendantAgentTask: ancestorMinionId required");
    assert(taskId.length > 0, "isDescendantAgentTask: taskId required");

    const cfg = this.config.loadConfigOrDefault();
    const parentById = this.buildAgentTaskIndex(cfg).parentById;
    if (this.isDescendantAgentTaskUsingParentById(parentById, ancestorMinionId, taskId)) {
      return true;
    }

    // The task minion may have been removed after it reported (cleanup/restart). Preserve scope
    // checks by consulting persisted report artifacts in the ancestor session dir.
    const cached = this.completedReportsByTaskId.get(taskId);
    if (hasAncestorMinionId(cached, ancestorMinionId)) {
      return true;
    }

    const sessionDir = this.config.getSessionDir(ancestorMinionId);
    const persisted = await readSidekickReportArtifactsFile(sessionDir);
    const entry = persisted.artifactsByChildTaskId[taskId];
    return hasAncestorMinionId(entry, ancestorMinionId);
  }

  private isDescendantAgentTaskUsingParentById(
    parentById: Map<string, string>,
    ancestorMinionId: string,
    taskId: string
  ): boolean {
    let current = taskId;
    for (let i = 0; i < 32; i++) {
      const parent = parentById.get(current);
      if (!parent) return false;
      if (parent === ancestorMinionId) return true;
      current = parent;
    }

    throw new Error(
      `isDescendantAgentTaskUsingParentById: possible parentMinionId cycle starting at ${taskId}`
    );
  }

  // --- Internal orchestration ---

  private listAncestorMinionIdsUsingParentById(
    parentById: Map<string, string>,
    taskId: string
  ): string[] {
    const ancestors: string[] = [];

    let current = taskId;
    for (let i = 0; i < 32; i++) {
      const parent = parentById.get(current);
      if (!parent) return ancestors;
      ancestors.push(parent);
      current = parent;
    }

    throw new Error(
      `listAncestorMinionIdsUsingParentById: possible parentMinionId cycle starting at ${taskId}`
    );
  }

  private listAgentTaskMinions(
    config: ReturnType<Config["loadConfigOrDefault"]>
  ): AgentTaskMinionEntry[] {
    const tasks: AgentTaskMinionEntry[] = [];
    for (const [projectPath, project] of config.projects) {
      for (const minion of project.minions) {
        if (!minion.id) continue;
        if (!minion.parentMinionId) continue;
        tasks.push({ ...minion, projectPath });
      }
    }
    return tasks;
  }

  private buildAgentTaskIndex(config: ReturnType<Config["loadConfigOrDefault"]>): AgentTaskIndex {
    const byId = new Map<string, AgentTaskMinionEntry>();
    const childrenByParent = new Map<string, string[]>();
    const parentById = new Map<string, string>();

    for (const task of this.listAgentTaskMinions(config)) {
      const taskId = task.id!;
      byId.set(taskId, task);

      const parent = task.parentMinionId;
      if (!parent) continue;

      parentById.set(taskId, parent);
      const list = childrenByParent.get(parent) ?? [];
      list.push(taskId);
      childrenByParent.set(parent, list);
    }

    return { byId, childrenByParent, parentById };
  }

  private countActiveAgentTasks(config: ReturnType<Config["loadConfigOrDefault"]>): number {
    let activeCount = 0;
    for (const task of this.listAgentTaskMinions(config)) {
      const status: AgentTaskStatus = task.taskStatus ?? "running";
      // If this task minion is blocked in a foreground wait, do not count it towards parallelism.
      // This prevents deadlocks where a task spawns a nested task in the foreground while
      // maxParallelAgentTasks is low (e.g. 1).
      // Note: StreamManager can still report isStreaming() while a tool call is executing, so
      // isStreaming is not a reliable signal for "actively doing work" here.
      if (status === "running" && task.id && this.isForegroundAwaiting(task.id)) {
        continue;
      }
      if (status === "running" || status === "awaiting_report") {
        activeCount += 1;
        continue;
      }

      // Defensive: task status and runtime stream state can be briefly out of sync during
      // termination/cleanup boundaries. Count streaming tasks as active so we never exceed
      // the configured parallel limit.
      if (task.id && this.aiService.isStreaming(task.id)) {
        activeCount += 1;
      }
    }

    return activeCount;
  }

  private hasActiveDescendantAgentTasks(
    config: ReturnType<Config["loadConfigOrDefault"]>,
    minionId: string
  ): boolean {
    assert(minionId.length > 0, "hasActiveDescendantAgentTasks: minionId must be non-empty");

    const index = this.buildAgentTaskIndex(config);

    const activeStatuses = new Set<AgentTaskStatus>(["queued", "running", "awaiting_report"]);
    const stack: string[] = [...(index.childrenByParent.get(minionId) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      const status = index.byId.get(next)?.taskStatus;
      if (status && activeStatuses.has(status)) {
        return true;
      }
      const children = index.childrenByParent.get(next);
      if (children) {
        for (const child of children) {
          stack.push(child);
        }
      }
    }

    return false;
  }

  /**
   * Topology predicate: does this minion still have child agent-task nodes in config?
   * Unlike hasActiveDescendantAgentTasks (which checks runtime activity for scheduling),
   * this checks structural tree shape — any child node blocks parent deletion regardless
   * of its status.
   */
  private hasChildAgentTasks(index: AgentTaskIndex, minionId: string): boolean {
    return (index.childrenByParent.get(minionId)?.length ?? 0) > 0;
  }

  private getTaskDepth(
    config: ReturnType<Config["loadConfigOrDefault"]>,
    minionId: string
  ): number {
    assert(minionId.length > 0, "getTaskDepth: minionId must be non-empty");

    return this.getTaskDepthFromParentById(
      this.buildAgentTaskIndex(config).parentById,
      minionId
    );
  }

  private getTaskDepthFromParentById(parentById: Map<string, string>, minionId: string): number {
    let depth = 0;
    let current = minionId;
    for (let i = 0; i < 32; i++) {
      const parent = parentById.get(current);
      if (!parent) break;
      depth += 1;
      current = parent;
    }

    if (depth >= 32) {
      throw new Error(
        `getTaskDepthFromParentById: possible parentMinionId cycle starting at ${minionId}`
      );
    }

    return depth;
  }

  async maybeStartQueuedTasks(): Promise<void> {
    await using _lock = await this.mutex.acquire();

    const configAtStart = this.config.loadConfigOrDefault();
    const taskSettingsAtStart: TaskSettings = configAtStart.taskSettings ?? DEFAULT_TASK_SETTINGS;

    const activeCount = this.countActiveAgentTasks(configAtStart);
    const availableSlots = Math.max(0, taskSettingsAtStart.maxParallelAgentTasks - activeCount);
    taskQueueDebug("TaskService.maybeStartQueuedTasks summary", {
      activeCount,
      maxParallelAgentTasks: taskSettingsAtStart.maxParallelAgentTasks,
      availableSlots,
    });
    if (availableSlots === 0) return;

    const queuedTaskIds = this.listAgentTaskMinions(configAtStart)
      .filter((t) => t.taskStatus === "queued" && typeof t.id === "string")
      .sort((a, b) => {
        const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
        return aTime - bTime;
      })
      .map((t) => t.id!);

    taskQueueDebug("TaskService.maybeStartQueuedTasks candidates", {
      queuedCount: queuedTaskIds.length,
      queuedIds: queuedTaskIds,
    });

    for (const taskId of queuedTaskIds) {
      const config = this.config.loadConfigOrDefault();
      const taskSettings: TaskSettings = config.taskSettings ?? DEFAULT_TASK_SETTINGS;
      assert(
        Number.isFinite(taskSettings.maxParallelAgentTasks) &&
          taskSettings.maxParallelAgentTasks > 0,
        "TaskService.maybeStartQueuedTasks: maxParallelAgentTasks must be a positive number"
      );

      const activeCount = this.countActiveAgentTasks(config);
      if (activeCount >= taskSettings.maxParallelAgentTasks) {
        break;
      }

      const taskEntry = findMinionEntry(config, taskId);
      if (!taskEntry?.minion.parentMinionId) continue;
      const task = taskEntry.minion;
      if (task.taskStatus !== "queued") continue;

      // Defensive: tasks can begin streaming before taskStatus flips to "running".
      if (this.aiService.isStreaming(taskId)) {
        taskQueueDebug("TaskService.maybeStartQueuedTasks queued-but-streaming; marking running", {
          taskId,
        });
        await this.setTaskStatus(taskId, "running");
        continue;
      }

      assert(typeof task.name === "string" && task.name.trim().length > 0, "Task name missing");

      const parentId = coerceNonEmptyString(task.parentMinionId);
      if (!parentId) {
        log.error("Queued task missing parentMinionId; cannot start", { taskId });
        continue;
      }

      const parentEntry = findMinionEntry(config, parentId);
      if (!parentEntry) {
        log.error("Queued task parent not found; cannot start", { taskId, parentId });
        continue;
      }

      const parentMinionName = coerceNonEmptyString(parentEntry.minion.name);
      if (!parentMinionName) {
        log.error("Queued task parent minion name missing; cannot start", {
          taskId,
          parentId,
        });
        continue;
      }

      const taskRuntimeConfig = task.runtimeConfig ?? parentEntry.minion.runtimeConfig;
      if (!taskRuntimeConfig) {
        log.error("Queued task missing runtimeConfig; cannot start", { taskId });
        continue;
      }

      const parentRuntimeConfig = parentEntry.minion.runtimeConfig ?? taskRuntimeConfig;
      const minionName = task.name.trim();
      const runtime = createRuntimeForMinion({
        runtimeConfig: taskRuntimeConfig,
        projectPath: taskEntry.projectPath,
        name: minionName,
      });
      let runtimeForTaskMinion = runtime;
      let forkedRuntimeConfig = taskRuntimeConfig;

      let minionPath =
        coerceNonEmptyString(task.path) ??
        runtime.getMinionPath(taskEntry.projectPath, minionName);

      let minionExists = false;
      try {
        await runtime.stat(minionPath);
        minionExists = true;
      } catch {
        minionExists = false;
      }

      const inMemoryInit = this.initStateManager.getInitState(taskId);
      const persistedInit = inMemoryInit
        ? null
        : await this.initStateManager.readInitStatus(taskId);

      // Re-check capacity after awaiting IO to avoid dequeuing work (worktree creation/init) when
      // another task became active in the meantime.
      const latestConfig = this.config.loadConfigOrDefault();
      const latestTaskSettings: TaskSettings = latestConfig.taskSettings ?? DEFAULT_TASK_SETTINGS;
      const latestActiveCount = this.countActiveAgentTasks(latestConfig);
      if (latestActiveCount >= latestTaskSettings.maxParallelAgentTasks) {
        taskQueueDebug("TaskService.maybeStartQueuedTasks became full mid-loop", {
          taskId,
          activeCount: latestActiveCount,
          maxParallelAgentTasks: latestTaskSettings.maxParallelAgentTasks,
        });
        break;
      }

      // Ensure the minion exists before starting. Queued tasks should not create worktrees/directories
      // until they are actually dequeued.
      let trunkBranch =
        typeof task.taskTrunkBranch === "string" && task.taskTrunkBranch.trim().length > 0
          ? task.taskTrunkBranch.trim()
          : parentMinionName;
      if (trunkBranch.length === 0) {
        trunkBranch = "main";
      }

      let shouldRunInit = !inMemoryInit && !persistedInit;
      let initLogger: InitLogger | null = null;
      const getInitLogger = (): InitLogger => {
        if (initLogger) return initLogger;
        initLogger = this.startMinionInit(taskId, taskEntry.projectPath);
        return initLogger;
      };

      taskQueueDebug("TaskService.maybeStartQueuedTasks start attempt", {
        taskId,
        minionName,
        parentId,
        parentMinionName,
        runtimeType: taskRuntimeConfig.type,
        minionPath,
        minionExists,
        trunkBranch,
        shouldRunInit,
        inMemoryInit: Boolean(inMemoryInit),
        persistedInit: Boolean(persistedInit),
      });

      // If the minion doesn't exist yet, create it now (fork preferred, else createMinion).
      if (!minionExists) {
        shouldRunInit = true;
        const initLogger = getInitLogger();

        const forkOrchestratorResult = await orchestrateFork({
          sourceRuntime: runtime,
          projectPath: taskEntry.projectPath,
          sourceMinionName: parentMinionName,
          newMinionName: minionName,
          initLogger,
          config: this.config,
          sourceMinionId: parentId,
          sourceRuntimeConfig: parentRuntimeConfig,
          allowCreateFallback: true,
          preferredTrunkBranch: trunkBranch,
        });

        if (
          forkOrchestratorResult.success &&
          forkOrchestratorResult.data.sourceRuntimeConfigUpdate
        ) {
          await this.config.updateMinionMetadata(parentId, {
            runtimeConfig: forkOrchestratorResult.data.sourceRuntimeConfigUpdate,
          });
          // Ensure UI gets the updated runtimeConfig for the parent minion.
          await this.emitMinionMetadata(parentId);
        }

        if (!forkOrchestratorResult.success) {
          initLogger.logComplete(-1);
          log.error("Task fork failed", { taskId, error: forkOrchestratorResult.error });
          taskQueueDebug("TaskService.maybeStartQueuedTasks fork failed", {
            taskId,
            error: forkOrchestratorResult.error,
          });
          continue;
        }

        const {
          forkedRuntimeConfig: resolvedForkedRuntimeConfig,
          targetRuntime,
          minionPath: resolvedMinionPath,
          trunkBranch: resolvedTrunkBranch,
          forkedFromSource,
        } = forkOrchestratorResult.data;

        forkedRuntimeConfig = resolvedForkedRuntimeConfig;
        runtimeForTaskMinion = targetRuntime;
        minionPath = resolvedMinionPath;
        trunkBranch = resolvedTrunkBranch;
        minionExists = true;

        taskQueueDebug("TaskService.maybeStartQueuedTasks minion created", {
          taskId,
          minionPath,
          forkSuccess: forkedFromSource,
          trunkBranch,
        });

        // Persist any corrected path/trunkBranch for restart-safe init.
        await this.editMinionEntry(
          taskId,
          (ws) => {
            ws.path = minionPath;
            ws.taskTrunkBranch = trunkBranch;
            ws.runtimeConfig = forkedRuntimeConfig;
          },
          { allowMissing: true }
        );
      }

      // If init has not yet run for this minion, start it now (best-effort, async).
      // This is intentionally coupled to task start so queued tasks don't run init hooks
      // Capture base commit for git-format-patch generation before the agent starts.
      // This must reflect the *actual* minion HEAD after creation/fork, not the parent's current HEAD
      // (queued tasks can start much later).
      if (!coerceNonEmptyString(task.taskBaseCommitSha)) {
        const taskBaseCommitSha = await tryReadGitHeadCommitSha(
          runtimeForTaskMinion,
          minionPath
        );
        if (taskBaseCommitSha) {
          await this.editMinionEntry(
            taskId,
            (ws) => {
              ws.taskBaseCommitSha = taskBaseCommitSha;
            },
            { allowMissing: true }
          );
        }
      }

      // (SSH sync, .lattice/init scripts, etc.) until they actually begin execution.
      if (shouldRunInit) {
        const initLogger = getInitLogger();
        taskQueueDebug("TaskService.maybeStartQueuedTasks initMinion starting", {
          taskId,
          minionPath,
          trunkBranch,
        });
        const secrets = secretsToRecord(this.config.getEffectiveSecrets(taskEntry.projectPath));
        let skipInitHook = false;
        const agentIdRaw = coerceNonEmptyString(task.agentId ?? task.agentType);
        if (agentIdRaw) {
          const parsedAgentId = AgentIdSchema.safeParse(agentIdRaw.trim().toLowerCase());
          if (parsedAgentId.success) {
            const isInPlace = taskEntry.projectPath === parentMinionName;
            const parentMinionPath =
              coerceNonEmptyString(parentEntry.minion.path) ??
              (isInPlace
                ? taskEntry.projectPath
                : runtime.getMinionPath(taskEntry.projectPath, parentMinionName));

            try {
              const frontmatter = await resolveAgentFrontmatter(
                runtime,
                parentMinionPath,
                parsedAgentId.data
              );
              skipInitHook = frontmatter.sidekick?.skip_init_hook === true;
            } catch (error: unknown) {
              log.debug("Queued task: failed to read agent definition for skip_init_hook", {
                taskId,
                agentId: parsedAgentId.data,
                error: getErrorMessage(error),
              });
            }
          }
        }

        runBackgroundInit(
          runtimeForTaskMinion,
          {
            projectPath: taskEntry.projectPath,
            branchName: minionName,
            trunkBranch,
            minionPath,
            initLogger,
            env: secrets,
            skipInitHook,
          },
          taskId
        );
      }

      const model = task.taskModelString ?? defaultModel;
      const queuedPrompt = coerceNonEmptyString(task.taskPrompt);
      if (queuedPrompt) {
        taskQueueDebug("TaskService.maybeStartQueuedTasks sendMessage starting (dequeue)", {
          taskId,
          model,
          promptLength: queuedPrompt.length,
        });
        const sendResult = await this.minionService.sendMessage(
          taskId,
          queuedPrompt,
          {
            model,
            agentId: task.agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID,
            thinkingLevel: task.taskThinkingLevel,
            experiments: task.taskExperiments,
          },
          { allowQueuedAgentTask: true }
        );
        if (!sendResult.success) {
          log.error("Failed to start queued task via sendMessage", {
            taskId,
            error: sendResult.error,
          });
          continue;
        }
      } else {
        // Backward compatibility: older queued tasks persisted their prompt in chat history.
        taskQueueDebug("TaskService.maybeStartQueuedTasks resumeStream starting (legacy dequeue)", {
          taskId,
          model,
        });
        const resumeResult = await this.minionService.resumeStream(
          taskId,
          {
            model,
            agentId: task.agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID,
            thinkingLevel: task.taskThinkingLevel,
            experiments: task.taskExperiments,
          },
          { allowQueuedAgentTask: true }
        );

        if (!resumeResult.success) {
          log.error("Failed to start queued task", { taskId, error: resumeResult.error });
          taskQueueDebug("TaskService.maybeStartQueuedTasks resumeStream failed", {
            taskId,
            error: resumeResult.error,
          });
          continue;
        }
      }

      await this.setTaskStatus(taskId, "running");
      taskQueueDebug("TaskService.maybeStartQueuedTasks started", { taskId });
    }
  }

  private async setTaskStatus(minionId: string, status: AgentTaskStatus): Promise<void> {
    assert(minionId.length > 0, "setTaskStatus: minionId must be non-empty");

    await this.editMinionEntry(minionId, (ws) => {
      ws.taskStatus = status;
      if (status === "running") {
        ws.taskPrompt = undefined;
      }
    });

    await this.emitMinionMetadata(minionId);

    if (status === "running") {
      const waiters = this.pendingStartWaitersByTaskId.get(minionId);
      if (!waiters || waiters.length === 0) return;
      this.pendingStartWaitersByTaskId.delete(minionId);
      for (const waiter of waiters) {
        try {
          waiter.start();
        } catch (error: unknown) {
          log.error("Task start waiter callback failed", { minionId, error });
        }
      }
    }
  }

  /**
   * Reset interrupt + auto-resume state for a minion (called when user sends a real message).
   */
  resetAutoResumeCount(minionId: string): void {
    assert(minionId.length > 0, "resetAutoResumeCount: minionId must be non-empty");
    this.consecutiveAutoResumes.delete(minionId);
    this.interruptedParentMinionIds.delete(minionId);
  }

  /** Mark a parent minion as hard-interrupted by the user. */
  markParentMinionInterrupted(minionId: string): void {
    assert(minionId.length > 0, "markParentMinionInterrupted: minionId must be non-empty");
    this.consecutiveAutoResumes.delete(minionId);
    this.interruptedParentMinionIds.add(minionId);
  }

  /**
   * If a preserved descendant task minion was previously interrupted and the user manually
   * resumes it, restore taskStatus=running so stream-end finalization can proceed normally.
   *
   * Returns true only when a state transition happened.
   */
  async markInterruptedTaskRunning(minionId: string): Promise<boolean> {
    assert(minionId.length > 0, "markInterruptedTaskRunning: minionId must be non-empty");

    const configAtStart = this.config.loadConfigOrDefault();
    const entryAtStart = findMinionEntry(configAtStart, minionId);
    if (!entryAtStart?.minion.parentMinionId) {
      return false;
    }
    if (entryAtStart.minion.taskStatus !== "interrupted") {
      return false;
    }

    let transitionedToRunning = false;
    await this.editMinionEntry(
      minionId,
      (ws) => {
        // Only descendant task minions have task lifecycle status.
        if (!ws.parentMinionId) {
          return;
        }
        if (ws.taskStatus !== "interrupted") {
          return;
        }

        // Preserve taskPrompt here: interrupted queued tasks store their only initial
        // prompt in config. If send/resume fails, restoreInterruptedTaskAfterResumeFailure
        // must be able to retain that original prompt for inspection/retry.
        ws.taskStatus = "running";
        transitionedToRunning = true;
      },
      { allowMissing: true }
    );

    if (!transitionedToRunning) {
      return false;
    }

    await this.emitMinionMetadata(minionId);
    return true;
  }

  /**
   * Revert a pre-stream interrupted->running transition when send/resume fails to start
   * or complete. This preserves fail-fast interrupted semantics for task_await.
   */
  async restoreInterruptedTaskAfterResumeFailure(minionId: string): Promise<void> {
    assert(
      minionId.length > 0,
      "restoreInterruptedTaskAfterResumeFailure: minionId must be non-empty"
    );

    let revertedToInterrupted = false;
    await this.editMinionEntry(
      minionId,
      (ws) => {
        if (!ws.parentMinionId) {
          return;
        }
        if (ws.taskStatus !== "running") {
          return;
        }

        ws.taskStatus = "interrupted";
        revertedToInterrupted = true;
      },
      { allowMissing: true }
    );

    if (!revertedToInterrupted) {
      return;
    }

    await this.emitMinionMetadata(minionId);
  }

  private async handleStreamEnd(event: StreamEndEvent): Promise<void> {
    const minionId = event.minionId;

    const cfg = this.config.loadConfigOrDefault();
    const entry = findMinionEntry(cfg, minionId);
    if (!entry) return;

    // Parent minions must not end while they have active background tasks.
    // Enforce by auto-resuming the stream with a directive to await outstanding tasks.
    if (!entry.minion.parentMinionId) {
      const hasActiveDescendants = this.hasActiveDescendantAgentTasks(cfg, minionId);
      if (!hasActiveDescendants) {
        return;
      }

      if (this.aiService.isStreaming(minionId)) {
        return;
      }

      if (this.interruptedParentMinionIds.has(minionId)) {
        log.debug("Skipping parent auto-resume after hard interrupt", { minionId });
        return;
      }

      const activeTaskIds = this.listActiveDescendantAgentTaskIds(minionId);

      // Check for auto-resume flood protection
      const resumeCount = this.consecutiveAutoResumes.get(minionId) ?? 0;
      if (resumeCount >= MAX_CONSECUTIVE_PARENT_AUTO_RESUMES) {
        log.warn("Auto-resume limit reached for parent minion with active descendants", {
          minionId,
          resumeCount,
          activeTaskIds,
          limit: MAX_CONSECUTIVE_PARENT_AUTO_RESUMES,
        });
        return;
      }
      this.consecutiveAutoResumes.set(minionId, resumeCount + 1);

      const resumeOptions = await this.resolveParentAutoResumeOptions(
        minionId,
        entry,
        defaultModel,
        event.metadata
      );

      const sendResult = await this.minionService.sendMessage(
        minionId,
        `You have active background sub-agent task(s) (${activeTaskIds.join(", ")}). ` +
          "You MUST NOT end your turn while any sub-agent tasks are queued/running/awaiting_report. " +
          "Call task_await now to wait for them to finish (omit timeout_secs to wait up to 10 minutes). " +
          "If any tasks are still queued/running/awaiting_report after that, call task_await again. " +
          "Only once all tasks are completed should you write your final response, integrating their reports.",
        {
          model: resumeOptions.model,
          agentId: resumeOptions.agentId,
          thinkingLevel: resumeOptions.thinkingLevel,
        },
        // Skip auto-resume counter reset — this IS an auto-resume, not a user message.
        { skipAutoResumeReset: true, synthetic: true }
      );
      if (!sendResult.success) {
        log.error("Failed to resume parent with active background tasks", {
          minionId,
          error: sendResult.error,
        });
      }
      return;
    }

    const status = entry.minion.taskStatus;
    if (status === "interrupted") {
      return;
    }
    if (status === "reported") {
      await this.finalizeTerminationPhaseForReportedTask(minionId);
      return;
    }

    const isPlanLike = await this.isPlanLikeTaskMinion(entry);

    // Never allow a task to finish/report while it still has active descendant tasks.
    // We'll auto-resume this task once the last descendant reports.
    const hasActiveDescendants = this.hasActiveDescendantAgentTasks(cfg, minionId);
    if (hasActiveDescendants) {
      if (status === "awaiting_report") {
        await this.setTaskStatus(minionId, "running");
      }
      return;
    }

    const reportArgs = this.findAgentReportArgsInParts(event.parts);
    if (reportArgs) {
      await this.finalizeAgentTaskReport(minionId, entry, reportArgs);
      await this.finalizeTerminationPhaseForReportedTask(minionId);
      return;
    }

    const proposePlanResult = this.findProposePlanSuccessInParts(event.parts);
    if (isPlanLike && proposePlanResult) {
      await this.handleSuccessfulProposePlanAutoHandoff({
        minionId,
        entry,
        proposePlanResult,
        planSidekickExecutorRouting:
          (cfg.taskSettings ?? DEFAULT_TASK_SETTINGS).planSidekickExecutorRouting ?? "exec",
      });
      return;
    }

    const missingCompletionToolName = isPlanLike ? "propose_plan" : "agent_report";

    // If a task stream ends without its required completion tool, request it once.
    if (status === "awaiting_report" && this.remindedAwaitingReport.has(minionId)) {
      await this.fallbackReportMissingCompletionTool(entry, missingCompletionToolName);
      await this.finalizeTerminationPhaseForReportedTask(minionId);
      return;
    }

    await this.setTaskStatus(minionId, "awaiting_report");

    this.remindedAwaitingReport.add(minionId);

    const model = entry.minion.taskModelString ?? defaultModel;
    await this.minionService.sendMessage(
      minionId,
      isPlanLike
        ? "Your stream ended without calling propose_plan. Call propose_plan exactly once now."
        : "Your stream ended without calling agent_report. Call agent_report exactly once now with your final report.",
      {
        model,
        agentId: entry.minion.agentId ?? TASK_RECOVERY_FALLBACK_AGENT_ID,
        thinkingLevel: entry.minion.taskThinkingLevel,
        toolPolicy: [{ regex_match: `^${missingCompletionToolName}$`, action: "require" }],
      },
      { synthetic: true }
    );
  }

  private async handleSuccessfulProposePlanAutoHandoff(args: {
    minionId: string;
    entry: { projectPath: string; minion: MinionConfigEntry };
    proposePlanResult: { planPath: string };
    planSidekickExecutorRouting: PlanSidekickExecutorRouting;
  }): Promise<void> {
    assert(
      args.minionId.length > 0,
      "handleSuccessfulProposePlanAutoHandoff: minionId must be non-empty"
    );
    assert(
      args.proposePlanResult.planPath.length > 0,
      "handleSuccessfulProposePlanAutoHandoff: planPath must be non-empty"
    );

    if (this.handoffInProgress.has(args.minionId)) {
      log.debug("Skipping duplicate plan-task auto-handoff", { minionId: args.minionId });
      return;
    }

    this.handoffInProgress.add(args.minionId);

    try {
      let planSummary: { content: string; path: string } | null = null;

      try {
        const info = await this.minionService.getInfo(args.minionId);
        if (!info) {
          log.error("Plan-task auto-handoff could not read minion metadata", {
            minionId: args.minionId,
          });
        } else {
          const runtime = createRuntimeForMinion(info);
          const planResult = await readPlanFile(
            runtime,
            info.name,
            info.projectName,
            args.minionId
          );
          if (planResult.exists) {
            planSummary = { content: planResult.content, path: planResult.path };
          } else {
            log.error("Plan-task auto-handoff did not find plan file content", {
              minionId: args.minionId,
              planPath: args.proposePlanResult.planPath,
            });
          }
        }
      } catch (error: unknown) {
        log.error("Plan-task auto-handoff failed to read plan file", {
          minionId: args.minionId,
          planPath: args.proposePlanResult.planPath,
          error,
        });
      }

      const targetAgentId = await (async () => {
        const shouldShowRoutingStatus = args.planSidekickExecutorRouting === "auto";
        if (shouldShowRoutingStatus) {
          // Auto routing can pause for up to the LLM timeout; surface progress in the sidebar.
          await this.minionService.updateAgentStatus(args.minionId, {
            emoji: PLAN_AUTO_ROUTING_STATUS_EMOJI,
            message: PLAN_AUTO_ROUTING_STATUS_MESSAGE,
            // ExtensionMetadataService carries forward the previous status URL when url is omitted.
            // Use an explicit empty string sentinel to clear stale links for this transient status.
            url: "",
          });
        }

        try {
          return await this.resolvePlanAutoHandoffTargetAgentId({
            minionId: args.minionId,
            entry: {
              projectPath: args.entry.projectPath,
              minion: {
                id: args.entry.minion.id,
                name: args.entry.minion.name,
                path: args.entry.minion.path,
                runtimeConfig: args.entry.minion.runtimeConfig,
                taskModelString: args.entry.minion.taskModelString,
              },
            },
            routing: args.planSidekickExecutorRouting,
            planContent: planSummary?.content ?? null,
          });
        } finally {
          if (shouldShowRoutingStatus) {
            await this.minionService.updateAgentStatus(args.minionId, null);
          }
        }
      })();

      const summaryContent = planSummary
        ? `# Plan\n\n${planSummary.content}\n\nNote: This chat already contains the full plan; no need to re-open the plan file.\n\n---\n\n*Plan file preserved at:* \`${planSummary.path}\``
        : `A plan was proposed at ${args.proposePlanResult.planPath}. Read the plan file and implement it.`;

      const summaryMessage = createLatticeMessage(
        createCompactionSummaryMessageId(),
        "assistant",
        summaryContent,
        {
          timestamp: Date.now(),
          compacted: "user",
          agentId: "plan",
        }
      );

      const replaceHistoryResult = await this.minionService.replaceHistory(
        args.minionId,
        summaryMessage,
        {
          mode: "append-compaction-boundary",
          deletePlanFile: false,
        }
      );
      if (!replaceHistoryResult.success) {
        log.error("Plan-task auto-handoff failed to compact history", {
          minionId: args.minionId,
          error: replaceHistoryResult.error,
        });
      }

      // Handoff resolution follows the same precedence as Task.create:
      // global per-agent defaults, else inherit the plan task's active model.
      const latestCfg = this.config.loadConfigOrDefault();
      const globalDefault = latestCfg.agentAiDefaults?.[targetAgentId];
      const parentActiveModelCandidate =
        typeof args.entry.minion.taskModelString === "string"
          ? args.entry.minion.taskModelString.trim()
          : "";
      const parentActiveModel =
        parentActiveModelCandidate.length > 0 ? parentActiveModelCandidate : defaultModel;

      const configuredModel = globalDefault?.modelString?.trim();
      const preferredModel =
        configuredModel && configuredModel.length > 0 ? configuredModel : parentActiveModel;
      const resolvedModel =
        preferredModel.length > 0 ? preferredModel : defaultModel;
      assert(
        resolvedModel.trim().length > 0,
        "handleSuccessfulProposePlanAutoHandoff: resolved model must be non-empty"
      );
      const requestedThinking: ThinkingLevel =
        globalDefault?.thinkingLevel ?? args.entry.minion.taskThinkingLevel ?? "off";
      const resolvedThinking = enforceThinkingPolicy(resolvedModel, requestedThinking);

      await this.editMinionEntry(args.minionId, (minion) => {
        minion.agentId = targetAgentId;
        minion.agentType = targetAgentId;
        minion.taskModelString = resolvedModel;
        minion.taskThinkingLevel = resolvedThinking;
      });

      await this.setTaskStatus(args.minionId, "running");
      this.remindedAwaitingReport.delete(args.minionId);

      const kickoffMsg =
        targetAgentId === "orchestrator"
          ? "Start orchestrating the implementation of this plan."
          : "Implement the plan.";
      try {
        const sendKickoffResult = await this.minionService.sendMessage(
          args.minionId,
          kickoffMsg,
          {
            model: resolvedModel,
            agentId: targetAgentId,
            thinkingLevel: resolvedThinking,
            experiments: args.entry.minion.taskExperiments,
          },
          { synthetic: true }
        );
        if (!sendKickoffResult.success) {
          // Keep status as "running" so the restart handler in initialize() can
          // re-attempt the kickoff on next startup, rather than moving to
          // "awaiting_report" which could finalize the task prematurely.
          log.error(
            "Plan-task auto-handoff failed to send kickoff message; task stays running for retry on restart",
            {
              minionId: args.minionId,
              targetAgentId,
              error: sendKickoffResult.error,
            }
          );
        }
      } catch (error: unknown) {
        // Same as above: leave status as "running" for restart recovery.
        log.error(
          "Plan-task auto-handoff failed to send kickoff message; task stays running for retry on restart",
          {
            minionId: args.minionId,
            targetAgentId,
            error,
          }
        );
      }
    } catch (error: unknown) {
      log.error("Plan-task auto-handoff failed", {
        minionId: args.minionId,
        planPath: args.proposePlanResult.planPath,
        error,
      });
    } finally {
      this.handoffInProgress.delete(args.minionId);
    }
  }

  private async finalizeTerminationPhaseForReportedTask(minionId: string): Promise<void> {
    assert(
      minionId.length > 0,
      "finalizeTerminationPhaseForReportedTask: minionId must be non-empty"
    );

    await this.cleanupReportedLeafTask(minionId);
  }

  private async maybeStartPatchGenerationForReportedTask(minionId: string): Promise<void> {
    assert(
      minionId.length > 0,
      "maybeStartPatchGenerationForReportedTask: minionId must be non-empty"
    );

    const cfg = this.config.loadConfigOrDefault();
    const parentMinionId = findMinionEntry(cfg, minionId)?.minion.parentMinionId;
    if (!parentMinionId) {
      return;
    }

    try {
      await this.gitPatchArtifactService.maybeStartGeneration(
        parentMinionId,
        minionId,
        (wsId) => this.requestReportedTaskCleanupRecheck(wsId)
      );
    } catch (error: unknown) {
      log.error("Failed to start sidekick git patch generation", {
        parentMinionId,
        childMinionId: minionId,
        error,
      });
    }
  }

  private requestReportedTaskCleanupRecheck(minionId: string): Promise<void> {
    assert(
      minionId.length > 0,
      "requestReportedTaskCleanupRecheck: minionId must be non-empty"
    );

    return this.minionEventLocks.withLock(minionId, async () => {
      await this.cleanupReportedLeafTask(minionId);
    });
  }

  private async fallbackReportMissingCompletionTool(
    entry: {
      projectPath: string;
      minion: MinionConfigEntry;
    },
    completionToolName: "agent_report" | "propose_plan"
  ): Promise<void> {
    const childMinionId = entry.minion.id;
    if (!childMinionId) {
      return;
    }

    const agentType = entry.minion.agentType ?? "agent";
    const lastText = await this.readLatestAssistantText(childMinionId);
    const completionToolLabel =
      completionToolName === "propose_plan" ? "`propose_plan`" : "`agent_report`";

    const reportMarkdown =
      `*(Note: this agent task did not call ${completionToolLabel}; posting its last assistant output as a fallback.)*\n\n` +
      (lastText?.trim().length ? lastText : "(No assistant output found.)");

    await this.finalizeAgentTaskReport(childMinionId, entry, {
      reportMarkdown,
      title: `Sidekick (${agentType}) report (fallback)`,
    });
  }

  private async readLatestAssistantText(minionId: string): Promise<string | null> {
    const partial = await this.historyService.readPartial(minionId);
    if (partial && partial.role === "assistant") {
      const text = this.concatTextParts(partial).trim();
      if (text.length > 0) return text;
    }

    // Only need recent messages to find last assistant text — avoid full-file read.
    // getLastMessages returns messages in chronological order.
    const historyResult = await this.historyService.getLastMessages(minionId, 20);
    if (!historyResult.success) {
      log.error("Failed to read history for fallback report", {
        minionId,
        error: historyResult.error,
      });
      return null;
    }

    for (let i = historyResult.data.length - 1; i >= 0; i--) {
      const msg = historyResult.data[i];
      if (msg?.role !== "assistant") continue;
      const text = this.concatTextParts(msg).trim();
      if (text.length > 0) return text;
    }

    return null;
  }

  private concatTextParts(msg: LatticeMessage): string {
    let combined = "";
    for (const part of msg.parts) {
      if (!part || typeof part !== "object") continue;
      const maybeText = part as { type?: unknown; text?: unknown };
      if (maybeText.type !== "text") continue;
      if (typeof maybeText.text !== "string") continue;
      combined += maybeText.text;
    }
    return combined;
  }

  private async finalizeAgentTaskReport(
    childMinionId: string,
    childEntry: { projectPath: string; minion: MinionConfigEntry } | null | undefined,
    reportArgs: { reportMarkdown: string; title?: string }
  ): Promise<void> {
    assert(
      childMinionId.length > 0,
      "finalizeAgentTaskReport: childMinionId must be non-empty"
    );
    assert(
      typeof reportArgs.reportMarkdown === "string" && reportArgs.reportMarkdown.length > 0,
      "finalizeAgentTaskReport: reportMarkdown must be non-empty"
    );

    const cfgBeforeReport = this.config.loadConfigOrDefault();
    const statusBefore = findMinionEntry(cfgBeforeReport, childMinionId)?.minion
      .taskStatus;
    if (statusBefore === "reported") {
      return;
    }

    // Notify clients immediately even if we can't delete the minion yet.
    await this.editMinionEntry(
      childMinionId,
      (ws) => {
        ws.taskStatus = "reported";
        ws.reportedAt = getIsoNow();
      },
      { allowMissing: true }
    );

    await this.emitMinionMetadata(childMinionId);

    // NOTE: Stream continues — we intentionally do NOT abort it.
    // Deterministic termination is enforced by StreamManager stopWhen logic that
    // waits for an agent_report tool result where output.success === true at the
    // step boundary (preserving usage accounting). recordSessionUsage runs when
    // the stream ends naturally.

    const cfgAfterReport = this.config.loadConfigOrDefault();
    const latestChildEntry = findMinionEntry(cfgAfterReport, childMinionId) ?? childEntry;
    const parentMinionId = latestChildEntry?.minion.parentMinionId;
    if (!parentMinionId) {
      const reason = latestChildEntry
        ? "missing parentMinionId"
        : "minion not found in config";
      log.debug("Ignoring agent_report: minion is not an agent task", {
        childMinionId,
        reason,
      });
      // Best-effort: resolve any foreground waiters even if we can't deliver to a parent.
      this.resolveWaiters(childMinionId, reportArgs);
      void this.maybeStartQueuedTasks();
      return;
    }

    const parentById = this.buildAgentTaskIndex(cfgAfterReport).parentById;
    const ancestorMinionIds = this.listAncestorMinionIdsUsingParentById(
      parentById,
      childMinionId
    );

    // Persist the completed report in the session dirs of all ancestors so `task_await` can
    // retrieve it after cleanup/restart (even if the task minion itself is deleted).
    const persistedAtMs = Date.now();
    for (const ancestorMinionId of ancestorMinionIds) {
      try {
        const ancestorSessionDir = this.config.getSessionDir(ancestorMinionId);
        await upsertSidekickReportArtifact({
          minionId: ancestorMinionId,
          minionSessionDir: ancestorSessionDir,
          childTaskId: childMinionId,
          parentMinionId,
          ancestorMinionIds,
          reportMarkdown: reportArgs.reportMarkdown,
          model: latestChildEntry?.minion.taskModelString,
          thinkingLevel: latestChildEntry?.minion.taskThinkingLevel,
          title: reportArgs.title,
          nowMs: persistedAtMs,
        });
      } catch (error: unknown) {
        log.error("Failed to persist sidekick report artifact", {
          minionId: ancestorMinionId,
          childTaskId: childMinionId,
          error,
        });
      }
    }

    await this.maybeStartPatchGenerationForReportedTask(childMinionId);

    await this.deliverReportToParent(
      parentMinionId,
      childMinionId,
      latestChildEntry,
      reportArgs
    );

    // Resolve foreground waiters.
    this.resolveWaiters(childMinionId, reportArgs);

    // Free slot and start queued tasks.
    await this.maybeStartQueuedTasks();

    // Auto-resume any parent stream that was waiting on a task tool call (restart-safe).
    const postCfg = this.config.loadConfigOrDefault();
    const parentEntry = findMinionEntry(postCfg, parentMinionId);
    if (!parentEntry) {
      // Parent may have been cleaned up (e.g. it already reported and this was its last descendant).
      return;
    }
    const hasActiveDescendants = this.hasActiveDescendantAgentTasks(postCfg, parentMinionId);
    if (!hasActiveDescendants) {
      this.consecutiveAutoResumes.delete(parentMinionId);
    }

    if (this.interruptedParentMinionIds.has(parentMinionId)) {
      log.debug("Skipping post-report parent auto-resume after hard interrupt", {
        parentMinionId,
        childMinionId,
      });
      return;
    }

    if (!hasActiveDescendants && !this.aiService.isStreaming(parentMinionId)) {
      const resumeOptions = await this.resolveParentAutoResumeOptions(
        parentMinionId,
        parentEntry,
        latestChildEntry?.minion.taskModelString ?? defaultModel
      );
      const sendResult = await this.minionService.sendMessage(
        parentMinionId,
        "Your background sub-agent task(s) have completed. Use task_await to retrieve their reports and integrate the results.",
        {
          model: resumeOptions.model,
          agentId: resumeOptions.agentId,
          thinkingLevel: resumeOptions.thinkingLevel,
        },
        // Skip auto-resume counter reset — this IS an auto-resume, not a user message.
        { skipAutoResumeReset: true, synthetic: true }
      );
      if (!sendResult.success) {
        log.error("Failed to auto-resume parent after agent_report", {
          parentMinionId,
          error: sendResult.error,
        });
      }
    }
  }

  private enforceCompletedReportCacheLimit(): void {
    while (this.completedReportsByTaskId.size > COMPLETED_REPORT_CACHE_MAX_ENTRIES) {
      const first = this.completedReportsByTaskId.keys().next();
      if (first.done) break;
      this.completedReportsByTaskId.delete(first.value);
    }
  }

  private resolveWaiters(taskId: string, report: { reportMarkdown: string; title?: string }): void {
    const cfg = this.config.loadConfigOrDefault();
    const parentById = this.buildAgentTaskIndex(cfg).parentById;
    const ancestorMinionIds = this.listAncestorMinionIdsUsingParentById(parentById, taskId);

    this.completedReportsByTaskId.set(taskId, {
      reportMarkdown: report.reportMarkdown,
      title: report.title,
      ancestorMinionIds,
    });
    this.enforceCompletedReportCacheLimit();

    const waiters = this.pendingWaitersByTaskId.get(taskId);
    if (!waiters || waiters.length === 0) {
      return;
    }

    this.pendingWaitersByTaskId.delete(taskId);
    for (const waiter of waiters) {
      try {
        waiter.cleanup();
        waiter.resolve(report);
      } catch {
        // ignore
      }
    }
  }

  private rejectWaiters(taskId: string, error: Error): void {
    const waiters = this.pendingWaitersByTaskId.get(taskId);
    if (!waiters || waiters.length === 0) {
      return;
    }

    for (const waiter of [...waiters]) {
      try {
        waiter.reject(error);
      } catch (rejectError: unknown) {
        log.error("Task waiter reject callback failed", { taskId, error: rejectError });
      }
    }
  }

  private findProposePlanSuccessInParts(parts: readonly unknown[]): { planPath: string } | null {
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!isDynamicToolPart(part)) continue;
      if (part.toolName !== "propose_plan") continue;
      if (part.state !== "output-available") continue;
      if (!isSuccessfulToolResult(part.output)) continue;

      const planPath =
        typeof part.output === "object" &&
        part.output !== null &&
        "planPath" in part.output &&
        typeof (part.output as { planPath?: unknown }).planPath === "string"
          ? (part.output as { planPath: string }).planPath.trim()
          : "";
      if (!planPath) continue;

      return { planPath };
    }
    return null;
  }

  private findAgentReportArgsInParts(
    parts: readonly unknown[]
  ): { reportMarkdown: string; title?: string } | null {
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!isDynamicToolPart(part)) continue;
      if (part.toolName !== "agent_report") continue;
      if (part.state !== "output-available") continue;
      if (!isSuccessfulToolResult(part.output)) continue;
      const parsed = AgentReportToolArgsSchema.safeParse(part.input);
      if (!parsed.success) continue;
      // Normalize null → undefined at the schema boundary so downstream
      // code that expects `title?: string` doesn't need to handle null.
      return { reportMarkdown: parsed.data.reportMarkdown, title: parsed.data.title ?? undefined };
    }
    return null;
  }

  private async deliverReportToParent(
    parentMinionId: string,
    childMinionId: string,
    childEntry: { projectPath: string; minion: MinionConfigEntry } | null | undefined,
    report: { reportMarkdown: string; title?: string }
  ): Promise<void> {
    assert(
      childMinionId.length > 0,
      "deliverReportToParent: childMinionId must be non-empty"
    );

    const agentType = childEntry?.minion.agentType ?? "agent";

    const output = {
      status: "completed" as const,
      taskId: childMinionId,
      reportMarkdown: report.reportMarkdown,
      title: report.title,
      agentType,
    };
    const parsedOutput = TaskToolResultSchema.safeParse(output);
    if (!parsedOutput.success) {
      log.error("Task tool output schema validation failed", { error: parsedOutput.error.message });
      return;
    }

    // If someone is actively awaiting this report (foreground task tool call or task_await),
    // skip injecting a synthetic history message to avoid duplicating the report in context.
    if (childMinionId) {
      const waiters = this.pendingWaitersByTaskId.get(childMinionId);
      if (waiters && waiters.length > 0) {
        return;
      }
    }

    // Restart-safe: if the parent has a pending task tool call in partial.json (interrupted stream),
    // finalize it with the report. Avoid rewriting persisted history to keep earlier messages immutable.
    if (!this.aiService.isStreaming(parentMinionId)) {
      const finalizedPending = await this.tryFinalizePendingTaskToolCallInPartial(
        parentMinionId,
        parsedOutput.data
      );
      if (finalizedPending) {
        return;
      }
    }

    // Background tasks: append a synthetic user message containing the report so earlier history
    // remains immutable (append-only) and prompt caches can still reuse the prefix.
    const titlePrefix = report.title ?? `Sidekick (${agentType}) report`;
    const xml = [
      "<lattice_sidekick_report>",
      `<task_id>${childMinionId}</task_id>`,
      `<agent_type>${agentType}</agent_type>`,
      `<title>${titlePrefix}</title>`,
      "<report_markdown>",
      report.reportMarkdown,
      "</report_markdown>",
      "</lattice_sidekick_report>",
    ].join("\n");

    const messageId = createTaskReportMessageId();
    const reportMessage = createLatticeMessage(messageId, "user", xml, {
      timestamp: Date.now(),
      synthetic: true,
    });

    const appendResult = await this.historyService.appendToHistory(
      parentMinionId,
      reportMessage
    );
    if (!appendResult.success) {
      log.error("Failed to append synthetic sidekick report to parent history", {
        parentMinionId,
        error: appendResult.error,
      });
    }
  }

  private async tryFinalizePendingTaskToolCallInPartial(
    minionId: string,
    output: unknown
  ): Promise<boolean> {
    const parsedOutput = TaskToolResultSchema.safeParse(output);
    if (!parsedOutput.success || parsedOutput.data.status !== "completed") {
      log.error("tryFinalizePendingTaskToolCallInPartial: invalid output", {
        error: parsedOutput.success ? "status is not 'completed'" : parsedOutput.error.message,
      });
      return false;
    }

    const partial = await this.historyService.readPartial(minionId);
    if (!partial) {
      return false;
    }

    type PendingTaskToolPart = DynamicToolPart & { toolName: "task"; state: "input-available" };
    const pendingParts = partial.parts.filter(
      (p): p is PendingTaskToolPart =>
        isDynamicToolPart(p) && p.toolName === "task" && p.state === "input-available"
    );

    if (pendingParts.length === 0) {
      return false;
    }
    if (pendingParts.length > 1) {
      log.error("tryFinalizePendingTaskToolCallInPartial: multiple pending task tool calls", {
        minionId,
      });
      return false;
    }

    const toolCallId = pendingParts[0].toolCallId;

    const parsedInput = TaskToolArgsSchema.safeParse(pendingParts[0].input);
    if (!parsedInput.success) {
      log.error("tryFinalizePendingTaskToolCallInPartial: task input validation failed", {
        minionId,
        error: parsedInput.error.message,
      });
      return false;
    }

    const updated: LatticeMessage = {
      ...partial,
      parts: partial.parts.map((part) => {
        if (!isDynamicToolPart(part)) return part;
        if (part.toolCallId !== toolCallId) return part;
        if (part.toolName !== "task") return part;
        if (part.state === "output-available") return part;
        return { ...part, state: "output-available" as const, output: parsedOutput.data };
      }),
    };

    const writeResult = await this.historyService.writePartial(minionId, updated);
    if (!writeResult.success) {
      log.error("Failed to write finalized task tool output to partial", {
        minionId,
        error: writeResult.error,
      });
      return false;
    }

    this.minionService.emit("chat", {
      minionId,
      message: {
        type: "tool-call-end",
        minionId,
        messageId: updated.id,
        toolCallId,
        toolName: "task",
        result: parsedOutput.data,
        timestamp: Date.now(),
      },
    });

    return true;
  }

  private async canCleanupReportedTask(
    minionId: string
  ): Promise<{ ok: true; parentMinionId: string } | { ok: false; reason: string }> {
    assert(minionId.length > 0, "canCleanupReportedTask: minionId must be non-empty");

    const config = this.config.loadConfigOrDefault();
    const entry = findMinionEntry(config, minionId);
    if (!entry) {
      return { ok: false, reason: "minion_not_found" };
    }

    const parentMinionId = entry.minion.parentMinionId;
    if (!parentMinionId) {
      return { ok: false, reason: "missing_parent_minion" };
    }

    if (entry.minion.taskStatus !== "reported") {
      return { ok: false, reason: "task_not_reported" };
    }

    if (this.aiService.isStreaming(minionId)) {
      log.debug("cleanupReportedLeafTask: deferring auto-delete; stream still active", {
        minionId,
        parentMinionId,
      });
      return { ok: false, reason: "still_streaming" };
    }

    // Topology gate: a reported task can only be cleaned up when it is a structural leaf
    // (has no child agent tasks in config). This is status-agnostic — even reported children
    // block parent deletion, ensuring artifact rollup always targets an existing parent path.
    const index = this.buildAgentTaskIndex(config);
    if (this.hasChildAgentTasks(index, minionId)) {
      return { ok: false, reason: "has_child_tasks" };
    }

    const parentSessionDir = this.config.getSessionDir(parentMinionId);
    const patchArtifact = await readSidekickGitPatchArtifact(parentSessionDir, minionId);
    if (patchArtifact?.status === "pending") {
      log.debug("cleanupReportedLeafTask: deferring auto-delete; patch artifact pending", {
        minionId,
        parentMinionId,
      });
      return { ok: false, reason: "patch_pending" };
    }

    return { ok: true, parentMinionId };
  }

  private async cleanupReportedLeafTask(minionId: string): Promise<void> {
    assert(minionId.length > 0, "cleanupReportedLeafTask: minionId must be non-empty");

    // Lineage reduction: each iteration removes exactly one leaf node, then re-evaluates
    // the parent on fresh config. The structural-leaf gate in canCleanupReportedTask ensures
    // parents are only removed after all children are gone.
    let currentMinionId = minionId;
    const visited = new Set<string>();
    for (let depth = 0; depth < 32; depth++) {
      if (visited.has(currentMinionId)) {
        log.error("cleanupReportedLeafTask: possible parentMinionId cycle", {
          minionId: currentMinionId,
        });
        return;
      }
      visited.add(currentMinionId);

      const cleanupEligibility = await this.canCleanupReportedTask(currentMinionId);
      if (!cleanupEligibility.ok) {
        return;
      }

      const removeResult = await this.minionService.remove(currentMinionId, true);
      if (!removeResult.success) {
        log.error("Failed to auto-delete reported task minion", {
          minionId: currentMinionId,
          error: removeResult.error,
        });
        return;
      }

      currentMinionId = cleanupEligibility.parentMinionId;
    }

    log.error("cleanupReportedLeafTask: exceeded max parent traversal depth", {
      minionId,
    });
  }
}
