import { z } from "zod";
import { RuntimeConfigSchema } from "./runtime";
import { MinionAISettingsByAgentSchema, MinionAISettingsSchema } from "./minionAiSettings";

const ThinkingLevelSchema = z.enum(["off", "low", "medium", "high", "xhigh", "max"]);

export const MinionMetadataSchema = z.object({
  id: z.string().meta({
    description:
      "Stable unique identifier (10 hex chars for new minions, legacy format for old)",
  }),
  name: z.string().meta({
    description: 'Git branch / directory name (e.g., "plan-a1b2") - used for path computation',
  }),
  title: z.string().optional().meta({
    description:
      'Human-readable minion title (e.g., "Fix plan mode over SSH") - optional for legacy minions',
  }),
  projectName: z
    .string()
    .meta({ description: "Project name extracted from project path (for display)" }),
  projectPath: z
    .string()
    .meta({ description: "Absolute path to the project (needed to compute minion path)" }),
  createdAt: z.string().optional().meta({
    description:
      "ISO 8601 timestamp of when minion was created (optional for backward compatibility)",
  }),
  aiSettingsByAgent: MinionAISettingsByAgentSchema.optional().meta({
    description: "Per-agent AI settings persisted in config",
  }),
  runtimeConfig: RuntimeConfigSchema.meta({
    description: "Runtime configuration for this minion (always set, defaults to local on load)",
  }),
  aiSettings: MinionAISettingsSchema.optional().meta({
    description: "Minion-scoped AI settings (model + thinking level) persisted in config",
  }),
  parentMinionId: z.string().optional().meta({
    description:
      "If set, this minion is a child minion spawned from the parent minionId (enables nesting in UI and backend orchestration).",
  }),
  agentType: z.string().optional().meta({
    description: 'If set, selects an agent preset for this minion (e.g., "explore" or "exec").',
  }),
  agentId: z.string().optional().meta({
    description:
      'If set, selects an agent definition for this minion (e.g., "explore" or "exec").',
  }),
  taskStatus: z
    .enum(["queued", "running", "awaiting_report", "interrupted", "reported"])
    .optional()
    .meta({
      description:
        "Agent task lifecycle status for child minions (queued|running|awaiting_report|interrupted|reported).",
    }),
  reportedAt: z.string().optional().meta({
    description: "ISO 8601 timestamp for when an agent task reported completion (optional).",
  }),
  taskModelString: z.string().optional().meta({
    description: "Model string used to run this agent task (used for restart-safe resumptions).",
  }),
  taskThinkingLevel: ThinkingLevelSchema.optional().meta({
    description: "Thinking level used for this agent task (used for restart-safe resumptions).",
  }),
  taskPrompt: z.string().optional().meta({
    description:
      "Initial prompt for a queued agent task (persisted only until the task actually starts).",
  }),
  taskTrunkBranch: z.string().optional().meta({
    description:
      "Trunk branch used to create/init this agent task minion (used for restart-safe init on queued tasks).",
  }),
  archivedAt: z.string().optional().meta({
    description:
      "ISO 8601 timestamp when minion was last archived. Minion is considered archived if archivedAt > unarchivedAt (or unarchivedAt is absent).",
  }),
  unarchivedAt: z.string().optional().meta({
    description:
      "ISO 8601 timestamp when minion was last unarchived. Used for recency calculation to bump restored minions to top.",
  }),
  agentSwitchingEnabled: z.boolean().optional().meta({
    description:
      "When true, switch_agent tool is enabled for this minion (set when session starts from Auto agent).",
  }),
  crewId: z.string().optional().meta({
    description: "ID of the section this minion belongs to (optional, unsectioned if absent)",
  }),
});

export const FrontendMinionMetadataSchema = MinionMetadataSchema.extend({
  namedMinionPath: z
    .string()
    .meta({ description: "Worktree path (uses minion name as directory)" }),
  incompatibleRuntime: z.string().optional().meta({
    description:
      "If set, this minion has an incompatible runtime configuration (e.g., from a newer version of lattice). The minion should be displayed but interactions should show this error message.",
  }),
  isRemoving: z.boolean().optional().meta({
    description: "True if this minion is currently being deleted (deletion in progress).",
  }),
  isInitializing: z.boolean().optional().meta({
    description:
      "True if this minion is currently initializing (postCreateSetup or initMinion running).",
  }),
});

export const MinionAgentStatusSchema = z.object({
  emoji: z.string(),
  message: z.string(),
  url: z.string().optional(),
});

export const MinionActivitySnapshotSchema = z.object({
  recency: z.number().meta({ description: "Unix ms timestamp of last user interaction" }),
  streaming: z.boolean().meta({ description: "Whether minion currently has an active stream" }),
  lastModel: z.string().nullable().meta({ description: "Last model sent from this minion" }),
  lastThinkingLevel: ThinkingLevelSchema.nullable().meta({
    description: "Last thinking/reasoning level used in this minion",
  }),
  agentStatus: MinionAgentStatusSchema.nullable().optional().meta({
    description:
      "Most recent status_set value for this minion (used to surface background progress in sidebar).",
  }),
  isIdleCompaction: z.boolean().optional().meta({
    description: "Whether the current streaming activity is an idle (background) compaction",
  }),
});

export const PostCompactionStateSchema = z.object({
  planPath: z.string().nullable(),
  trackedFilePaths: z.array(z.string()),
  excludedItems: z.array(z.string()),
});

export const GitStatusSchema = z.object({
  /** Current HEAD branch name (empty string if detached HEAD or not a git repo) */
  branch: z.string(),
  /** Commit divergence relative to origin's primary branch */
  ahead: z.number(),
  behind: z.number(),
  dirty: z
    .boolean()
    .meta({ description: "Whether there are uncommitted changes (staged or unstaged)" }),

  /**
   * Line deltas for changes unique to this minion.
   * Computed vs the merge-base with origin's primary branch.
   *
   * Note: outgoing includes committed changes + uncommitted changes (working tree).
   */
  outgoingAdditions: z.number(),
  outgoingDeletions: z.number(),

  /** Line deltas for changes that exist on origin's primary branch but not locally */
  incomingAdditions: z.number(),
  incomingDeletions: z.number(),
});
