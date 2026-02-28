/**
 * Stream context builder: assembles plan instructions and system prompt for a stream.
 *
 * Extracted from `streamMessage()` to make these purely functional
 * preparation steps explicit and testable. Contains:
 * - Plan file reading, mode instructions, task nesting warnings
 * - Plan→exec handoff transition content
 * - Agent body resolution with inheritance + sidekick prompt append
 * - Sidekick discovery for tool descriptions
 * - Skill discovery for tool descriptions
 * - System message construction and token counting
 *
 * All functions are pure — no service dependencies (`this.*`).
 */

import assert from "@/common/utils/assert";
import type { LatticeMessage } from "@/common/types/message";
import type { MinionMetadata } from "@/common/types/minion";
import type { ProjectsConfig } from "@/common/types/project";
import type { ProvidersConfigMap } from "@/common/orpc/types";
import type { TaskSettings } from "@/common/types/tasks";
import type { Runtime } from "@/node/runtime/Runtime";
import { isPlanLikeInResolvedChain } from "@/common/utils/agentTools";
import { getPlanFilePath } from "@/common/utils/planStorage";
import { getPlanFileHint, getPlanModeInstruction } from "@/common/utils/ui/modeUtils";
import { hasStartHerePlanSummary } from "@/common/utils/messages/startHerePlanSummary";
import { readPlanFile } from "@/node/utils/runtime/helpers";
import {
  readAgentDefinition,
  resolveAgentBody,
  resolveAgentFrontmatter,
  discoverAgentDefinitions,
  type AgentDefinitionsRoots,
} from "@/node/services/agentDefinitions/agentDefinitionsService";
import { isAgentEffectivelyDisabled } from "@/node/services/agentDefinitions/agentEnablement";
import { resolveAgentInheritanceChain } from "@/node/services/agentDefinitions/resolveAgentInheritanceChain";
import { discoverAgentSkills } from "@/node/services/agentSkills/agentSkillsService";
import { buildSystemMessage } from "./systemMessage";
import { getTokenizerForModel } from "@/node/utils/main/tokenizer";
import { resolveModelForMetadata } from "@/common/utils/providers/modelEntries";
import { log } from "./log";
import { getErrorMessage } from "@/common/utils/errors";

// ---------------------------------------------------------------------------
// Plan & Instructions Assembly
// ---------------------------------------------------------------------------

/** Options for building plan-aware additional instructions. */
export interface BuildPlanInstructionsOptions {
  runtime: Runtime;
  metadata: MinionMetadata;
  minionId: string;
  minionPath: string;
  effectiveMode: "plan" | "exec" | "compact";
  effectiveAgentId: string;
  agentIsPlanLike: boolean;
  agentDiscoveryPath: string;
  /** Base additional instructions from the caller (may be undefined). */
  additionalSystemInstructions: string | undefined;
  shouldDisableTaskToolsForDepth: boolean;
  taskDepth: number;
  taskSettings: TaskSettings;
  /**
   * Message history that will be sent to the provider (after request-time slicing/filtering).
   *
   * Plan-context derivation must stay aligned with the request payload to avoid pre-boundary
   * history (e.g., old Start Here summaries) suppressing required plan hints.
   */
  requestPayloadMessages: LatticeMessage[];
}

/** Result of plan instructions assembly. */
export interface PlanInstructionsResult {
  /** System instructions with plan-mode/nesting directives merged in. */
  effectiveAdditionalInstructions: string | undefined;
  /** Absolute path to the plan file (always computed, even if file doesn't exist). */
  planFilePath: string;
  /** Plan file content for plan→exec handoff injection (undefined if no handoff). */
  planContentForTransition: string | undefined;
}

/**
 * Build plan-aware additional instructions and determine transition content.
 *
 * This handles:
 * 1. Reading the plan file (with legacy migration)
 * 2. Injecting plan-mode instructions when in plan mode
 * 3. Injecting plan-file hints in non-plan modes (unless Start Here already has it)
 * 4. Appending task-nesting-depth warnings
 * 5. Determining plan→exec handoff content by checking if the last assistant
 *    used a plan-like agent
 */
export async function buildPlanInstructions(
  opts: BuildPlanInstructionsOptions
): Promise<PlanInstructionsResult> {
  const {
    runtime,
    metadata,
    minionId,
    effectiveMode,
    effectiveAgentId,
    agentIsPlanLike,
    agentDiscoveryPath,
    additionalSystemInstructions,
    shouldDisableTaskToolsForDepth,
    taskDepth,
    taskSettings,
    requestPayloadMessages,
  } = opts;

  const minionLog = log.withFields({ minionId, minionName: metadata.name });

  // Construct plan mode instruction if in plan mode
  // This is done backend-side because we have access to the plan file path
  let effectiveAdditionalInstructions = additionalSystemInstructions;
  const latticeHome = runtime.getLatticeHome();
  const planFilePath = getPlanFilePath(metadata.name, metadata.projectName, latticeHome);

  // Read plan file (handles legacy migration transparently)
  const planResult = await readPlanFile(runtime, metadata.name, metadata.projectName, minionId);

  const chatHasStartHerePlanSummary = hasStartHerePlanSummary(requestPayloadMessages);

  if (effectiveMode === "plan") {
    const planModeInstruction = getPlanModeInstruction(planFilePath, planResult.exists);
    effectiveAdditionalInstructions = additionalSystemInstructions
      ? `${planModeInstruction}\n\n${additionalSystemInstructions}`
      : planModeInstruction;
  } else if (planResult.exists && planResult.content.trim()) {
    // Users often use "Replace all chat history" after plan mode. In exec (or other non-plan)
    // modes, the model can lose the plan file location because plan path injection only
    // happens in plan mode.
    //
    // Exception: the ProposePlanToolCall "Start Here" flow already stores the full plan
    // (and plan path) directly in chat history. In that case, prompting the model to
    // re-open the plan file is redundant and often results in an extra "read …KB" step.
    if (!chatHasStartHerePlanSummary) {
      const planFileHint = getPlanFileHint(planFilePath, planResult.exists);
      if (planFileHint) {
        effectiveAdditionalInstructions = effectiveAdditionalInstructions
          ? `${planFileHint}\n\n${effectiveAdditionalInstructions}`
          : planFileHint;
      }
    } else {
      minionLog.debug(
        "Skipping plan file hint: Start Here already includes the plan in chat history."
      );
    }
  }

  if (shouldDisableTaskToolsForDepth) {
    const nestingInstruction =
      `Task delegation is disabled in this minion (taskDepth=${taskDepth}, ` +
      `maxTaskNestingDepth=${taskSettings.maxTaskNestingDepth}). Do not call task/task_await/task_list/task_terminate.`;
    effectiveAdditionalInstructions = effectiveAdditionalInstructions
      ? `${effectiveAdditionalInstructions}\n\n${nestingInstruction}`
      : nestingInstruction;
  }

  // Read plan content for agent transition (plan-like → exec/orchestrator).
  // Only read if switching to the built-in exec/orchestrator agent and last assistant was plan-like.
  let planContentForTransition: string | undefined;
  const isPlanHandoffAgent = effectiveAgentId === "exec" || effectiveAgentId === "orchestrator";
  if (isPlanHandoffAgent && !chatHasStartHerePlanSummary) {
    const lastAssistantMessage = [...requestPayloadMessages]
      .reverse()
      .find((m) => m.role === "assistant");
    const lastAgentId = lastAssistantMessage?.metadata?.agentId;
    if (lastAgentId && planResult.content.trim()) {
      let lastAgentIsPlanLike = false;
      if (lastAgentId === effectiveAgentId) {
        lastAgentIsPlanLike = agentIsPlanLike;
      } else {
        try {
          const lastDefinition = await readAgentDefinition(
            runtime,
            agentDiscoveryPath,
            lastAgentId
          );
          const lastChain = await resolveAgentInheritanceChain({
            runtime,
            minionPath: agentDiscoveryPath,
            agentId: lastAgentId,
            agentDefinition: lastDefinition,
            minionId,
          });
          lastAgentIsPlanLike = isPlanLikeInResolvedChain(lastChain);
        } catch (error) {
          minionLog.warn("Failed to resolve last agent definition for plan handoff", {
            lastAgentId,
            error: getErrorMessage(error),
          });
        }
      }

      if (lastAgentIsPlanLike) {
        planContentForTransition = planResult.content;
      }
    }
  } else if (isPlanHandoffAgent && chatHasStartHerePlanSummary) {
    minionLog.debug(
      "Skipping plan content injection for plan handoff transition: Start Here already includes the plan in chat history."
    );
  }

  return { effectiveAdditionalInstructions, planFilePath, planContentForTransition };
}

// ---------------------------------------------------------------------------
// Agent System Prompt & System Message Assembly
// ---------------------------------------------------------------------------

/** Options for building the system message context. */
export interface BuildStreamSystemContextOptions {
  runtime: Runtime;
  metadata: MinionMetadata;
  minionPath: string;
  minionId: string;
  /** Agent definition (may have fallen back to exec). Use `.id` for resolution. */
  agentDefinition: { id: string };
  agentDiscoveryPath: string;
  isSidekickMinion: boolean;
  effectiveAdditionalInstructions: string | undefined;
  modelString: string;
  cfg: ProjectsConfig;
  providersConfig?: ProvidersConfigMap | null;
  mcpServers: Parameters<typeof buildSystemMessage>[5];
}

/** Result of system context assembly. */
export interface StreamSystemContextResult {
  /** Resolved agent body (with inheritance + sidekick append). */
  agentSystemPrompt: string;
  /** Full system message string. */
  systemMessage: string;
  /** Token count of the system message. */
  systemMessageTokens: number;
  /** Available sidekick definitions for tool descriptions (undefined for sidekick minions). */
  agentDefinitions: Awaited<ReturnType<typeof discoverAgentDefinitions>> | undefined;
  /** Available skills for tool descriptions. */
  availableSkills: Awaited<ReturnType<typeof discoverAgentSkills>> | undefined;
}

/**
 * Build the agent system prompt, system message, and discover available agents/skills.
 *
 * This handles:
 * 1. Resolving the agent body with inheritance (prompt.append merges with base)
 * 2. Appending sidekick.append_prompt for sidekick minions
 * 3. Discovering available sidekick definitions for task tool context
 * 4. Discovering available skills for tool descriptions
 * 5. Constructing the final system message
 * 6. Counting system message tokens
 */
export async function buildStreamSystemContext(
  opts: BuildStreamSystemContextOptions
): Promise<StreamSystemContextResult> {
  const {
    runtime,
    metadata,
    minionPath,
    minionId,
    agentDefinition,
    agentDiscoveryPath,
    isSidekickMinion,
    effectiveAdditionalInstructions,
    modelString,
    cfg,
    providersConfig,
    mcpServers,
  } = opts;

  const minionLog = log.withFields({ minionId, minionName: metadata.name });

  // Resolve the body with inheritance (prompt.append merges with base).
  // Use agentDefinition.id (may have fallen back to exec) instead of effectiveAgentId.
  const resolvedBody = await resolveAgentBody(runtime, agentDiscoveryPath, agentDefinition.id);

  let sidekickAppendPrompt: string | undefined;
  if (isSidekickMinion) {
    try {
      const resolvedFrontmatter = await resolveAgentFrontmatter(
        runtime,
        agentDiscoveryPath,
        agentDefinition.id
      );
      sidekickAppendPrompt = resolvedFrontmatter.sidekick?.append_prompt;
    } catch (error: unknown) {
      minionLog.debug("Failed to resolve agent frontmatter for sidekick append_prompt", {
        agentId: agentDefinition.id,
        error: getErrorMessage(error),
      });
    }
  }

  const agentSystemPrompt =
    isSidekickMinion && sidekickAppendPrompt
      ? `${resolvedBody}\n\n${sidekickAppendPrompt}`
      : resolvedBody;

  // Discover available agent definitions for sidekick context (only for top-level minions).
  //
  // NOTE: discoverAgentDefinitions returns disabled agents too, so Settings can surface them.
  // For tool descriptions (task tool), filter to agents that are effectively enabled.
  let agentDefinitions: Awaited<ReturnType<typeof discoverAgentDefinitions>> | undefined;
  if (!isSidekickMinion) {
    agentDefinitions = await discoverAvailableSidekicksForToolContext({
      runtime,
      minionPath: agentDiscoveryPath,
      cfg,
    });
  }

  // Discover available skills for tool description context
  let availableSkills: Awaited<ReturnType<typeof discoverAgentSkills>> | undefined;
  try {
    availableSkills = await discoverAgentSkills(runtime, minionPath);
  } catch (error) {
    minionLog.warn("Failed to discover agent skills for tool description", { error });
  }

  // Build system message from minion metadata
  const systemMessage = await buildSystemMessage(
    metadata,
    runtime,
    minionPath,
    effectiveAdditionalInstructions,
    modelString,
    mcpServers,
    { agentSystemPrompt }
  );

  // Count system message tokens for cost tracking
  const metadataModel = resolveModelForMetadata(modelString, providersConfig ?? null);
  const tokenizer = await getTokenizerForModel(modelString, metadataModel);
  const systemMessageTokens = await tokenizer.countTokens(systemMessage);

  return {
    agentSystemPrompt,
    systemMessage,
    systemMessageTokens,
    agentDefinitions,
    availableSkills,
  };
}

// ---------------------------------------------------------------------------
// Sidekick Discovery Helper
// ---------------------------------------------------------------------------

/**
 * Discover agent definitions for tool description context.
 *
 * The task tool lists "Available sidekicks" by filtering on
 * AgentDefinitionDescriptor.sidekickRunnable.
 *
 * NOTE: discoverAgentDefinitions() sets descriptor.sidekickRunnable from the agent's *own*
 * frontmatter only, which means derived agents (e.g. `base: exec`) may incorrectly appear
 * non-runnable if they don't repeat `sidekick.runnable: true`.
 *
 * Re-resolve frontmatter with inheritance (base-first) so sidekick.runnable is inherited.
 */
export async function discoverAvailableSidekicksForToolContext(args: {
  runtime: Parameters<typeof discoverAgentDefinitions>[0];
  minionPath: string;
  cfg: ProjectsConfig;
  roots?: AgentDefinitionsRoots;
}): Promise<Awaited<ReturnType<typeof discoverAgentDefinitions>>> {
  assert(args, "discoverAvailableSidekicksForToolContext: args is required");
  assert(args.runtime, "discoverAvailableSidekicksForToolContext: runtime is required");
  assert(
    args.minionPath && args.minionPath.length > 0,
    "discoverAvailableSidekicksForToolContext: minionPath is required"
  );
  assert(args.cfg, "discoverAvailableSidekicksForToolContext: cfg is required");

  const discovered = await discoverAgentDefinitions(args.runtime, args.minionPath, {
    roots: args.roots,
  });

  const resolved = await Promise.all(
    discovered.map(async (descriptor) => {
      try {
        const resolvedFrontmatter = await resolveAgentFrontmatter(
          args.runtime,
          args.minionPath,
          descriptor.id,
          { roots: args.roots }
        );

        const effectivelyDisabled = isAgentEffectivelyDisabled({
          cfg: args.cfg,
          agentId: descriptor.id,
          resolvedFrontmatter,
        });

        if (effectivelyDisabled) {
          return null;
        }

        return {
          ...descriptor,
          // Important: descriptor.sidekickRunnable comes from the agent's own frontmatter only.
          // Re-resolve with inheritance so derived agents inherit runnable: true from their base.
          sidekickRunnable: resolvedFrontmatter.sidekick?.runnable ?? false,
        };
      } catch {
        // Best-effort: keep the descriptor if enablement or inheritance can't be resolved.
        return descriptor;
      }
    })
  );

  return resolved.filter((descriptor): descriptor is NonNullable<typeof descriptor> =>
    Boolean(descriptor)
  );
}
