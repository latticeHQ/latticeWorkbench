/**
 * Agent resolution: resolves the active agent and computes tool policy for a stream.
 *
 * Extracted from `streamMessage()` to make the agent resolution logic
 * explicit and testable. Contains:
 * - Agent ID normalization & fallback to exec
 * - Agent definition loading with error recovery
 * - Disabled-agent enforcement (sidekick minions error, top-level falls back)
 * - Inheritance chain resolution + plan-like detection
 * - Task nesting depth enforcement
 * - Tool policy composition (agent → caller → system minion)
 * - Sentinel tool name computation for agent transition detection
 */

import * as os from "os";
import { AgentIdSchema } from "@/common/orpc/schemas";
import { LATTICE_HELP_CHAT_AGENT_ID, LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { DEFAULT_TASK_SETTINGS } from "@/common/types/tasks";
import type { ErrorEvent } from "@/common/types/stream";
import type { MinionMetadata } from "@/common/types/minion";
import type { ProjectsConfig } from "@/common/types/project";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import type { SendMessageError } from "@/common/types/errors";
import { applyToolPolicy, type ToolPolicy } from "@/common/utils/tools/toolPolicy";
import { getToolsForModel } from "@/common/utils/tools/tools";
import { isPlanLikeInResolvedChain } from "@/common/utils/agentTools";
import type { Runtime } from "@/node/runtime/Runtime";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import {
  readAgentDefinition,
  resolveAgentFrontmatter,
} from "@/node/services/agentDefinitions/agentDefinitionsService";
import { isAgentEffectivelyDisabled } from "@/node/services/agentDefinitions/agentEnablement";
import { resolveToolPolicyForAgent } from "@/node/services/agentDefinitions/resolveToolPolicy";
import { resolveAgentInheritanceChain } from "@/node/services/agentDefinitions/resolveAgentInheritanceChain";
import type { InitStateManager } from "./initStateManager";
import { createAssistantMessageId } from "./utils/messageIds";
import { createErrorEvent } from "./utils/sendMessageError";
import { getTaskDepthFromConfig } from "./taskUtils";
import { log } from "./log";
import { getErrorMessage } from "@/common/utils/errors";

/** Options for agent resolution. */
export interface ResolveAgentOptions {
  minionId: string;
  metadata: MinionMetadata;
  runtime: Runtime;
  minionPath: string;
  /** Requested agent ID from the frontend (may be undefined → defaults to exec). */
  requestedAgentId: string | undefined;
  /** When true, skip minion-specific agents (for "unbricking" broken agent files). */
  disableMinionAgents: boolean;
  /** Enable switch_agent tool for sessions that were started from the Auto agent. */
  enableAgentSwitchTool: boolean;
  modelString: string;
  /** Caller-supplied tool policy (applied AFTER agent policy for further restriction). */
  callerToolPolicy: ToolPolicy | undefined;
  /** Loaded config from Config.loadConfigOrDefault(). */
  cfg: ProjectsConfig;
  /** Emit an error event on the AIService EventEmitter (for disabled-agent sidekick errors). */
  emitError: (event: ErrorEvent) => void;
  /** For sentinel tool name computation. */
  initStateManager: InitStateManager;
}

/** Result of agent resolution — all computed values needed by the stream pipeline. */
export interface AgentResolutionResult {
  effectiveAgentId: string;
  agentDefinition: Awaited<ReturnType<typeof readAgentDefinition>>;
  /** Path used for agent discovery (minion path or project path if agents disabled). */
  agentDiscoveryPath: string;
  isSidekickMinion: boolean;
  /** Whether the resolved agent inherits plan-like behavior (has propose_plan in tool chain). */
  agentIsPlanLike: boolean;
  effectiveMode: "plan" | "exec" | "compact";
  taskSettings: ProjectsConfig["taskSettings"] & {};
  taskDepth: number;
  shouldDisableTaskToolsForDepth: boolean;
  /** Composed tool policy: agent → caller → system minion (in application order). */
  effectiveToolPolicy: ToolPolicy | undefined;
  /** Tool names for agent transition sentinel injection in message preparation. */
  toolNamesForSentinel: string[];
}

/**
 * Resolve the active agent and compute tool policy for a stream request.
 *
 * This is the first major phase of `streamMessage()` after minion/runtime setup.
 * It determines which agent definition to use, whether plan mode is active, and what
 * tools are available (via policy). The result feeds into message preparation,
 * system prompt construction, and tool assembly.
 *
 * Returns `Err` only when a disabled agent is requested in a sidekick minion
 * (top-level minions silently fall back to exec).
 */
export async function resolveAgentForStream(
  opts: ResolveAgentOptions
): Promise<Result<AgentResolutionResult, SendMessageError>> {
  const {
    minionId,
    metadata,
    runtime,
    minionPath,
    requestedAgentId: rawAgentId,
    disableMinionAgents,
    enableAgentSwitchTool,
    modelString,
    callerToolPolicy,
    cfg,
    emitError,
    initStateManager,
  } = opts;

  const minionLog = log.withFields({ minionId, minionName: metadata.name });

  // --- Agent ID resolution ---
  // Precedence:
  // - Child minions (tasks) use their persisted agentId/agentType.
  // - Main minions use the requested agentId (frontend), falling back to exec.
  const requestedAgentIdRaw =
    minionId === LATTICE_HELP_CHAT_MINION_ID
      ? LATTICE_HELP_CHAT_AGENT_ID
      : ((metadata.parentMinionId ? (metadata.agentId ?? metadata.agentType) : undefined) ??
        (typeof rawAgentId === "string" ? rawAgentId : undefined) ??
        "exec");
  const requestedAgentIdNormalized = requestedAgentIdRaw.trim().toLowerCase();
  const parsedAgentId = AgentIdSchema.safeParse(requestedAgentIdNormalized);
  const requestedAgentId = parsedAgentId.success ? parsedAgentId.data : ("exec" as const);
  let effectiveAgentId = requestedAgentId;

  // When disableMinionAgents is true, skip minion-specific agents entirely.
  // Use project path so only built-in/global agents are available. This allows "unbricking"
  // when iterating on agent files — a broken agent in the worktree won't affect message sending.
  const agentDiscoveryPath = disableMinionAgents ? metadata.projectPath : minionPath;

  const isSidekickMinion = Boolean(metadata.parentMinionId);

  // --- Load agent definition (with fallback to exec) ---
  let agentDefinition;
  try {
    agentDefinition = await readAgentDefinition(runtime, agentDiscoveryPath, effectiveAgentId);
  } catch (error) {
    minionLog.warn("Failed to load agent definition; falling back to exec", {
      effectiveAgentId,
      agentDiscoveryPath,
      disableMinionAgents,
      error: getErrorMessage(error),
    });
    agentDefinition = await readAgentDefinition(runtime, agentDiscoveryPath, "exec");
  }

  // Keep agent ID aligned with the actual definition used (may fall back to exec).
  effectiveAgentId = agentDefinition.id;

  // --- Disabled-agent enforcement ---
  // Disabled agents should never run as sidekicks, even if a task minion already exists
  // on disk (e.g., config changed since creation).
  // For top-level minions, fall back to exec to keep the minion usable.
  if (agentDefinition.id !== "exec") {
    try {
      const resolvedFrontmatter = await resolveAgentFrontmatter(
        runtime,
        agentDiscoveryPath,
        agentDefinition.id
      );

      const effectivelyDisabled = isAgentEffectivelyDisabled({
        cfg,
        agentId: agentDefinition.id,
        resolvedFrontmatter,
      });

      if (effectivelyDisabled) {
        const errorMessage = `Agent '${agentDefinition.id}' is disabled.`;

        if (isSidekickMinion) {
          const errorMessageId = createAssistantMessageId();
          emitError(
            createErrorEvent(minionId, {
              messageId: errorMessageId,
              error: errorMessage,
              errorType: "unknown",
            })
          );
          return Err({ type: "unknown", raw: errorMessage });
        }

        minionLog.warn("Selected agent is disabled; falling back to exec", {
          agentId: agentDefinition.id,
          requestedAgentId,
        });
        agentDefinition = await readAgentDefinition(runtime, agentDiscoveryPath, "exec");
        effectiveAgentId = agentDefinition.id;
      }
    } catch (error: unknown) {
      // Best-effort only — do not fail a stream due to disablement resolution.
      minionLog.debug("Failed to resolve agent enablement; continuing", {
        agentId: agentDefinition.id,
        error: getErrorMessage(error),
      });
    }
  }

  // --- Inheritance chain & plan-like detection ---
  const agentsForInheritance = await resolveAgentInheritanceChain({
    runtime,
    minionPath: agentDiscoveryPath,
    agentId: agentDefinition.id,
    agentDefinition,
    minionId,
  });

  const agentIsPlanLike = isPlanLikeInResolvedChain(agentsForInheritance);
  const effectiveMode =
    agentDefinition.id === "compact" ? "compact" : agentIsPlanLike ? "plan" : "exec";

  // --- Task nesting depth enforcement ---
  const taskSettings = cfg.taskSettings ?? DEFAULT_TASK_SETTINGS;
  const taskDepth = getTaskDepthFromConfig(cfg, minionId);
  const shouldDisableTaskToolsForDepth = taskDepth >= taskSettings.maxTaskNestingDepth;

  // --- Tool policy composition ---
  // Agent policy establishes baseline (deny-all + enable whitelist + runtime restrictions).
  // Caller policy then narrows further if needed.
  // Auto must be able to call switch_agent on its first turn even before metadata persistence.
  const shouldEnableAgentSwitchTool = enableAgentSwitchTool || agentDefinition.id === "auto";
  // Only force toolChoice=require in top-level minions where switch_agent can actually run.
  // Corrupted/stale sidekick metadata may still point at auto; that should degrade safely.
  const shouldRequireSwitchAgentTool =
    agentDefinition.id === "auto" && shouldEnableAgentSwitchTool && !isSidekickMinion;
  const agentToolPolicy = resolveToolPolicyForAgent({
    agents: agentsForInheritance,
    isSidekick: isSidekickMinion,
    disableTaskToolsForDepth: shouldDisableTaskToolsForDepth,
    enableAgentSwitchTool: shouldEnableAgentSwitchTool,
    requireSwitchAgentTool: shouldRequireSwitchAgentTool,
  });

  // The Chat with Lattice system minion must remain sandboxed regardless of caller-supplied
  // toolPolicy (defense-in-depth).
  const systemMinionToolPolicy: ToolPolicy | undefined =
    minionId === LATTICE_HELP_CHAT_MINION_ID
      ? [
          { regex_match: ".*", action: "disable" },

          // Allow docs lookup via built-in skills (e.g. lattice-docs), while keeping
          // filesystem/binary execution locked down.
          { regex_match: "agent_skill_read", action: "enable" },
          { regex_match: "agent_skill_read_file", action: "enable" },

          { regex_match: "lattice_global_agents_read", action: "enable" },
          { regex_match: "lattice_global_agents_write", action: "enable" },
          { regex_match: "ask_user_question", action: "enable" },
          { regex_match: "todo_read", action: "enable" },
          { regex_match: "todo_write", action: "enable" },
          { regex_match: "status_set", action: "enable" },
          { regex_match: "notify", action: "enable" },
        ]
      : undefined;

  const effectiveToolPolicy: ToolPolicy | undefined =
    callerToolPolicy || agentToolPolicy.length > 0 || systemMinionToolPolicy
      ? [...agentToolPolicy, ...(callerToolPolicy ?? []), ...(systemMinionToolPolicy ?? [])]
      : undefined;

  // --- Sentinel tool names for agent transition detection ---
  // Creates a throwaway runtime to compute the tool name list that the message pipeline
  // uses for mode-transition sentinel injection. This avoids depending on the real
  // tool assembly (which happens later) while still respecting tool policy.
  const earlyRuntime = createRuntime({ type: "local", srcBaseDir: process.cwd() });
  const earlyAllTools = await getToolsForModel(
    modelString,
    {
      cwd: process.cwd(),
      runtime: earlyRuntime,
      runtimeTempDir: os.tmpdir(),
      secrets: {},
      planFileOnly: agentIsPlanLike,
    },
    "", // Empty minion ID for early stub config
    initStateManager,
    undefined,
    undefined
  );
  const earlyTools = applyToolPolicy(earlyAllTools, effectiveToolPolicy);
  const toolNamesForSentinel = Object.keys(earlyTools);

  return Ok({
    effectiveAgentId,
    agentDefinition,
    agentDiscoveryPath,
    isSidekickMinion,
    agentIsPlanLike,
    effectiveMode,
    taskSettings,
    taskDepth,
    shouldDisableTaskToolsForDepth,
    effectiveToolPolicy,
    toolNamesForSentinel,
  });
}
