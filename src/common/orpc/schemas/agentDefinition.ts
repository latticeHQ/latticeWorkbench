import { z } from "zod";

export const AgentDefinitionScopeSchema = z.enum(["built-in", "project", "global"]);

// Agent IDs come from filenames (<agentId>.md).
// Keep constraints conservative so IDs are safe to use in storage keys, URLs, etc.
export const AgentIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/);

const AgentDefinitionUiRequirementSchema = z.enum(["plan"]);
const ThinkingLevelSchema = z.enum(["off", "low", "medium", "high", "xhigh", "max"]);

const AgentDefinitionUiSchema = z
  .object({
    // New: hidden is opt-out. Default: visible.
    hidden: z.boolean().optional(),

    // Legacy: selectable was opt-in. Keep for backwards compatibility.
    selectable: z.boolean().optional(),

    // When true, completely hides this agent (useful for disabling built-ins)
    disabled: z.boolean().optional(),

    // UI color (CSS color value). Inherited from base agent if not specified.
    color: z.string().min(1).optional(),

    // Requirements for this agent to be selectable in the UI.
    // Enforced in agents.list by toggling uiSelectable.
    requires: z.array(AgentDefinitionUiRequirementSchema).min(1).optional(),
  })
  .strip();

const AgentDefinitionSidekickSchema = z
  .object({
    runnable: z.boolean().optional(),
    // Instructions appended when this agent runs as a sidekick (child minion)
    append_prompt: z.string().min(1).optional(),
    // When true, do not run the project's .lattice/init hook for this sidekick.
    // NOTE: This skips only the hook execution, not runtime provisioning (e.g. SSH sync, Docker setup).
    skip_init_hook: z.boolean().optional(),
  })
  .strip();

const AgentDefinitionAiDefaultsSchema = z
  .object({
    // Model identifier: full string (e.g. "anthropic:claude-sonnet-4-5") or abbreviation (e.g. "sonnet")
    model: z.string().min(1).optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
  })
  .strip();

const AgentDefinitionPromptSchema = z
  .object({
    // When true, append this agent's body to the base agent's body (default: false = replace)
    append: z.boolean().optional(),
  })
  .strip();

// Tool configuration: add/remove patterns (regex).
// Layers are processed in order during inheritance (base first, then child).
const AgentDefinitionToolsSchema = z
  .object({
    // Patterns to add (enable). Processed before remove.
    add: z.array(z.string().min(1)).optional(),
    // Patterns to remove (disable). Processed after add.
    remove: z.array(z.string().min(1)).optional(),
  })
  .strip();

// Autonomy configuration: DialogLab-inspired mechanisms for self-correcting agents.
// All fields are optional — omitting autonomy leaves existing behavior unchanged.
const AgentDefinitionAutonomySchema = z
  .object({
    // Circuit breaker: automatic turn budgets to prevent infinite loops.
    // When enabled, the system injects pivot instructions at soft_limit and
    // forces context compaction at hard_limit. Resets on real user messages.
    circuit_breaker: z
      .object({
        enabled: z.boolean().optional(),
        // Turn count at which a "try a different approach" nudge is injected.
        soft_limit: z.number().int().min(3).max(50).optional(),
        // Turn count at which context is force-compacted and the agent restarts fresh.
        hard_limit: z.number().int().min(5).max(100).optional(),
      })
      .strip()
      .optional(),

    // Challenger gate: after task completion, spawn a cheap review sidekick
    // to validate the output before reporting to the parent.
    challenger: z
      .object({
        enabled: z.boolean().optional(),
        // Model to use for the review (should be fast/cheap, e.g. "haiku").
        model: z.string().min(1).optional(),
        // Maximum review rounds before accepting the output regardless.
        max_rounds: z.number().int().min(1).max(5).optional(),
      })
      .strip()
      .optional(),

    // Phase-gated execution: enforce explore→plan→execute→verify phases
    // with tool restrictions per phase. Prevents premature file edits.
    phases: z
      .object({
        enabled: z.boolean().optional(),
        // Max turns per phase before auto-advancing.
        explore_turns: z.number().int().min(1).max(20).optional(),
        plan_turns: z.number().int().min(1).max(10).optional(),
        execute_turns: z.number().int().min(1).max(30).optional(),
        verify_turns: z.number().int().min(1).max(10).optional(),
      })
      .strip()
      .optional(),

    // Sibling context sharing: on first turn, inject compacted summaries
    // from other minions in the same project to avoid redundant exploration.
    sibling_context: z
      .object({
        enabled: z.boolean().optional(),
        // Max number of sibling summaries to inject.
        max_siblings: z.number().int().min(1).max(5).optional(),
        // Max tokens per sibling summary.
        max_tokens_per_sibling: z.number().int().min(100).max(4000).optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export const AgentDefinitionFrontmatterSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(1024).optional(),

    // Inheritance: reference a built-in or custom agent ID
    base: AgentIdSchema.optional(),

    // When true, this agent is disabled by default.
    //
    // Notes:
    // - This is a top-level flag (separate from ui.disabled) so repos can ship agents that are
    //   present on disk but opt-in.
    // - When both are set, `disabled` takes precedence over `ui.disabled`.
    disabled: z.boolean().optional(),

    // UI metadata (color, visibility, etc.)
    ui: AgentDefinitionUiSchema.optional(),

    // Prompt behavior configuration
    prompt: AgentDefinitionPromptSchema.optional(),

    sidekick: AgentDefinitionSidekickSchema.optional(),

    ai: AgentDefinitionAiDefaultsSchema.optional(),

    // Tool configuration: add/remove patterns (regex).
    // If omitted and no base, no tools are available.
    tools: AgentDefinitionToolsSchema.optional(),

    // Autonomy configuration: DialogLab-inspired self-correction mechanisms.
    // Opt-in per agent. Omitting leaves existing behavior unchanged.
    autonomy: AgentDefinitionAutonomySchema.optional(),
  })
  .strip();

export const AgentDefinitionDescriptorSchema = z
  .object({
    id: AgentIdSchema,
    scope: AgentDefinitionScopeSchema,
    name: z.string().min(1).max(128),
    description: z.string().min(1).max(1024).optional(),
    uiSelectable: z.boolean(),
    uiColor: z.string().min(1).optional(),
    sidekickRunnable: z.boolean(),
    // Base agent ID for inheritance (e.g., "exec", "plan", or custom agent)
    base: AgentIdSchema.optional(),
    aiDefaults: AgentDefinitionAiDefaultsSchema.optional(),
    // Tool configuration (for UI display / inheritance computation)
    tools: AgentDefinitionToolsSchema.optional(),
    // Autonomy capabilities summary (populated from frontmatter for UI badges)
    autonomy: z
      .object({
        circuitBreaker: z.boolean(),
        phases: z.boolean(),
        siblingContext: z.boolean(),
        challenger: z.boolean(),
      })
      .optional(),
  })
  .strict();

export const AgentDefinitionPackageSchema = z
  .object({
    id: AgentIdSchema,
    scope: AgentDefinitionScopeSchema,
    frontmatter: AgentDefinitionFrontmatterSchema,
    body: z.string(),
  })
  .strict();
