import { eventIterator } from "@orpc/server";
import { UIModeSchema } from "../../types/mode";
import { z } from "zod";
import { ChatStatsSchema, SessionUsageFileSchema } from "./chatStats";
import { SendMessageErrorSchema } from "./errors";
import { BranchListResultSchema, FilePartSchema, LatticeMessageSchema } from "./message";
import { ProjectConfigSchema, SectionConfigSchema } from "./project";

// Re-export channels namespace (defined in its own file for clarity)
export {
  channels,
  ChannelConfigSchema,
  ChannelMessageSchema,
  ChannelListItemSchema,
  ChannelTypeSchema,
  ChannelStatusSchema,
  ChannelSessionScopeSchema,
  ChannelSessionEntrySchema,
  ChannelPeerKindSchema,
} from "./channels";
import { ResultSchema } from "./result";
import { RuntimeConfigSchema, RuntimeAvailabilitySchema } from "./runtime";
import { SecretSchema } from "./secrets";
import {
  CompletedMessagePartSchema,
  SendMessageOptionsSchema,
  StreamEndEventSchema,
  UpdateStatusSchema,
  WorkspaceChatMessageSchema,
} from "./stream";
import { LayoutPresetsConfigSchema } from "./uiLayouts";
import {
  TerminalCreateParamsSchema,
  TerminalResizeParamsSchema,
  TerminalSessionSchema,
} from "./terminal";
import { BashToolResultSchema, FileTreeNodeSchema } from "./tools";
import { WorkspaceStatsSnapshotSchema } from "./workspaceStats";
import { FrontendWorkspaceMetadataSchema, WorkspaceActivitySnapshotSchema } from "./workspace";
import { WorkspaceAISettingsSchema } from "./workspaceAiSettings";
import { AgentSkillDescriptorSchema, AgentSkillPackageSchema, SkillNameSchema } from "./agentSkill";
import {
  PluginPackDescriptorSchema,
  PluginPackMcpServerSchema,
  PluginPackNameSchema,
} from "./pluginPack";
import {
  AgentDefinitionDescriptorSchema,
  AgentDefinitionPackageSchema,
  AgentIdSchema,
} from "./agentDefinition";
import {
  MCPAddParamsSchema,
  MCPRemoveParamsSchema,
  MCPServerMapSchema,
  MCPSetEnabledParamsSchema,
  MCPSetToolAllowlistParamsSchema,
  MCPTestParamsSchema,
  MCPTestResultSchema,
  WorkspaceMCPOverridesSchema,
} from "./mcp";

// Experiments
export const ExperimentValueSchema = z.object({
  value: z.union([z.string(), z.boolean(), z.null()]),
  source: z.enum(["posthog", "cache", "disabled"]),
});

export const experiments = {
  getAll: {
    input: z.void(),
    output: z.record(z.string(), ExperimentValueSchema),
  },
  reload: {
    input: z.void(),
    output: z.void(),
  },
};
// Re-export telemetry schemas
export { telemetry, TelemetryEventSchema } from "./telemetry";

// Re-export signing schemas
export { signing, type SigningCapabilities, type SignatureEnvelope } from "./signing";

// --- API Router Schemas ---

// Background process info (for UI display)
export const BackgroundProcessInfoSchema = z.object({
  id: z.string(),
  pid: z.number(),
  script: z.string(),
  displayName: z.string().optional(),
  startTime: z.number(),
  status: z.enum(["running", "exited", "killed", "failed"]),
  exitCode: z.number().optional(),
});

export type BackgroundProcessInfo = z.infer<typeof BackgroundProcessInfoSchema>;

// Tokenizer
export const tokenizer = {
  countTokens: {
    input: z.object({ model: z.string(), text: z.string() }),
    output: z.number(),
  },
  countTokensBatch: {
    input: z.object({ model: z.string(), texts: z.array(z.string()) }),
    output: z.array(z.number()),
  },
  calculateStats: {
    input: z.object({
      workspaceId: z.string(),
      messages: z.array(LatticeMessageSchema),
      model: z.string(),
    }),
    output: ChatStatsSchema,
  },
};

// Providers
export const AWSCredentialStatusSchema = z.object({
  region: z.string().optional(),
  bearerTokenSet: z.boolean(),
  accessKeyIdSet: z.boolean(),
  secretAccessKeySet: z.boolean(),
});

export const ProviderConfigInfoSchema = z.object({
  apiKeySet: z.boolean(),
  /** Whether this provider is configured and ready to use */
  isConfigured: z.boolean(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()).optional(),
  /** OpenAI-specific fields */
  serviceTier: z.enum(["auto", "default", "flex", "priority"]).optional(),
  /** AWS-specific fields (only present for bedrock provider) */
  aws: AWSCredentialStatusSchema.optional(),
  couponCodeSet: z.boolean().optional(),
});

export const ProvidersConfigMapSchema = z.record(z.string(), ProviderConfigInfoSchema);

export const providers = {
  setProviderConfig: {
    input: z.object({
      provider: z.string(),
      keyPath: z.array(z.string()),
      value: z.string(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  getConfig: {
    input: z.void(),
    output: ProvidersConfigMapSchema,
  },
  setModels: {
    input: z.object({
      provider: z.string(),
      models: z.array(z.string()),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  list: {
    input: z.void(),
    output: z.array(z.string()),
  },
  testConnection: {
    input: z.object({ provider: z.string(), model: z.string().optional() }),
    output: z.object({
      success: z.boolean(),
      message: z.string(),
      latencyMs: z.number().optional(),
    }),
  },
  // Subscription: emits when provider config changes (API keys, models, etc.)
  onConfigChanged: {
    input: z.void(),
    output: eventIterator(z.void()),
  },
};

// CLI Agent Detection
export const AgentHealthStatusSchema = z.object({
  status: z.enum(["healthy", "unhealthy", "unknown", "checking"]),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
});

export const CliAgentDetectionResultSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  description: z.string(),
  detected: z.boolean(),
  binaryPath: z.string().optional(),
  version: z.string().optional(),
  installUrl: z.string(),
  installCommand: z.string().optional(),
  category: z.enum(["cli", "vscode-extension", "app"]),
  supportedModels: z.array(z.string()).optional(),
  health: AgentHealthStatusSchema.optional(),
});

export const CliAgentInstallResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  /** If install spawned a background process, the output so far */
  output: z.string().optional(),
});

/** Streaming install event — discriminated union for stdout/stderr/result */
export const InstallStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stdout"), data: z.string() }),
  z.object({ type: z.literal("stderr"), data: z.string() }),
  z.object({ type: z.literal("result"), success: z.boolean(), message: z.string() }),
]);

export const AgentSessionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  displayName: z.string(),
  status: z.enum(["running", "completed", "failed", "stopped"]),
  startedAt: z.number(),
  output: z.string(),
  exitCode: z.number().optional(),
});

export const AgentRunResultSchema = z.object({
  sessionId: z.string(),
  success: z.boolean(),
  output: z.string(),
  exitCode: z.number().optional(),
  durationMs: z.number(),
});

export const CliAgentPreferencesSchema = z.object({
  /** Whether this agent is enabled for orchestration */
  enabled: z.boolean(),
  /** Default CLI flags appended to every run (e.g., "--verbose") */
  defaultFlags: z.string().optional(),
  /** Extra environment variables for this agent's process */
  env: z.record(z.string(), z.string()).optional(),
  /** Default timeout in ms (overrides the global 5-min default) */
  timeoutMs: z.number().optional(),
});

export const AllAgentPreferencesSchema = z.record(z.string(), CliAgentPreferencesSchema);

export const cliAgents = {
  detect: {
    input: z.void(),
    output: z.array(CliAgentDetectionResultSchema),
  },
  /**
   * Progressive detection stream — yields one result per agent as each probe
   * resolves (in parallel). Installed agents appear in ~100 ms; the stream
   * ends once all agents have been checked. Use this instead of `detect` to
   * avoid cold-start latency in the UI.
   */
  detectEach: {
    input: z.void(),
    output: eventIterator(CliAgentDetectionResultSchema),
  },
  detectOne: {
    input: z.object({ slug: z.string() }),
    output: CliAgentDetectionResultSchema,
  },
  install: {
    input: z.object({ slug: z.string() }),
    output: CliAgentInstallResultSchema,
  },
  /** Streaming install — yields stdout/stderr chunks and a final result event */
  installStream: {
    input: z.object({ slug: z.string() }),
    output: eventIterator(InstallStreamEventSchema),
  },
  run: {
    input: z.object({
      slug: z.string(),
      prompt: z.string(),
      cwd: z.string(),
      env: z.record(z.string(), z.string()).optional(),
      timeoutMs: z.number().optional(),
    }),
    output: AgentRunResultSchema,
  },
  stop: {
    input: z.object({ sessionId: z.string() }),
    output: z.object({ success: z.boolean() }),
  },
  listSessions: {
    input: z.void(),
    output: z.array(AgentSessionSchema),
  },
  getPreferences: {
    input: z.void(),
    output: AllAgentPreferencesSchema,
  },
  setPreferences: {
    input: z.object({
      slug: z.string(),
      preferences: CliAgentPreferencesSchema,
    }),
    output: z.object({ success: z.boolean() }),
  },
  checkHealth: {
    input: z.object({ slug: z.string() }),
    output: AgentHealthStatusSchema,
  },
  checkAllHealth: {
    input: z.void(),
    output: z.record(z.string(), AgentHealthStatusSchema),
  },
};

// Headquarters
export const projects = {
  create: {
    input: z.object({ projectPath: z.string() }),
    output: ResultSchema(
      z.object({
        projectConfig: ProjectConfigSchema,
        normalizedPath: z.string(),
      }),
      z.string()
    ),
  },
  pickDirectory: {
    input: z.void(),
    output: z.string().nullable(),
  },
  remove: {
    input: z.object({ projectPath: z.string(), force: z.boolean().optional() }),
    output: ResultSchema(z.void(), z.string()),
  },
  list: {
    input: z.void(),
    output: z.array(z.tuple([z.string(), ProjectConfigSchema])),
  },
  getFileCompletions: {
    input: z
      .object({
        projectPath: z.string(),
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      })
      .strict(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  runtimeAvailability: {
    input: z.object({ projectPath: z.string() }),
    output: RuntimeAvailabilitySchema,
  },
  listBranches: {
    input: z.object({ projectPath: z.string() }),
    output: BranchListResultSchema,
  },
  gitInit: {
    input: z.object({ projectPath: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  mcp: {
    list: {
      input: z.object({ projectPath: z.string() }),
      output: MCPServerMapSchema,
    },
    add: {
      input: MCPAddParamsSchema,
      output: ResultSchema(z.void(), z.string()),
    },
    remove: {
      input: MCPRemoveParamsSchema,
      output: ResultSchema(z.void(), z.string()),
    },
    test: {
      input: MCPTestParamsSchema,
      output: MCPTestResultSchema,
    },
    setEnabled: {
      input: MCPSetEnabledParamsSchema,
      output: ResultSchema(z.void(), z.string()),
    },
    setToolAllowlist: {
      input: MCPSetToolAllowlistParamsSchema,
      output: ResultSchema(z.void(), z.string()),
    },
  },
  secrets: {
    get: {
      input: z.object({ projectPath: z.string() }),
      output: z.array(SecretSchema),
    },
    update: {
      input: z.object({
        projectPath: z.string(),
        secrets: z.array(SecretSchema),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
  idleCompaction: {
    get: {
      input: z.object({ projectPath: z.string() }),
      output: z.object({ hours: z.number().nullable() }),
    },
    set: {
      input: z.object({
        projectPath: z.string(),
        hours: z.number().min(1).nullable(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
  sections: {
    list: {
      input: z.object({ projectPath: z.string() }),
      output: z.array(SectionConfigSchema),
    },
    create: {
      input: z.object({
        projectPath: z.string(),
        name: z.string().min(1),
        color: z.string().optional(),
      }),
      output: ResultSchema(SectionConfigSchema, z.string()),
    },
    update: {
      input: z.object({
        projectPath: z.string(),
        sectionId: z.string(),
        name: z.string().min(1).optional(),
        color: z.string().optional(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    remove: {
      input: z.object({
        projectPath: z.string(),
        sectionId: z.string(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    reorder: {
      input: z.object({
        projectPath: z.string(),
        sectionIds: z.array(z.string()),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    assignWorkspace: {
      input: z.object({
        projectPath: z.string(),
        workspaceId: z.string(),
        sectionId: z.string().nullable(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
};

// Re-export Lattice schemas from dedicated file
export {
  lattice,
  LatticeInfoSchema,
  LatticePresetSchema,
  LatticeTemplateSchema,
  LatticeWorkspaceConfigSchema,
  LatticeWorkspaceSchema,
  LatticeWorkspaceStatusSchema,
} from "./lattice";

// Workspace
const DebugLlmRequestSnapshotSchema = z
  .object({
    capturedAt: z.number(),
    workspaceId: z.string(),
    messageId: z.string().optional(),
    model: z.string(),
    providerName: z.string(),
    thinkingLevel: z.string(),
    mode: z.string().optional(),
    agentId: z.string().optional(),
    maxOutputTokens: z.number().optional(),
    systemMessage: z.string(),
    messages: z.array(z.unknown()),
    response: z
      .object({
        capturedAt: z.number(),
        metadata: StreamEndEventSchema.shape.metadata,
        parts: z.array(CompletedMessagePartSchema),
      })
      .strict()
      .optional(),
  })
  .strict();

export const workspace = {
  list: {
    input: z
      .object({
        /** When true, only return archived workspaces. Default returns only non-archived. */
        archived: z.boolean().optional(),
      })
      .optional(),
    output: z.array(FrontendWorkspaceMetadataSchema),
  },
  create: {
    input: z.object({
      projectPath: z.string(),
      branchName: z.string(),
      /** Trunk branch to fork from - only required for worktree/SSH runtimes, ignored for local */
      trunkBranch: z.string().optional(),
      /** Human-readable title (e.g., "Fix plan mode over SSH") - optional for backwards compat */
      title: z.string().optional(),
      runtimeConfig: RuntimeConfigSchema.optional(),
      /** Section ID to assign the new workspace to (optional) */
      sectionId: z.string().optional(),
    }),
    output: z.discriminatedUnion("success", [
      z.object({ success: z.literal(true), metadata: FrontendWorkspaceMetadataSchema }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  },
  remove: {
    input: z.object({
      workspaceId: z.string(),
      options: z.object({ force: z.boolean().optional() }).optional(),
    }),
    output: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  rename: {
    input: z.object({ workspaceId: z.string(), newName: z.string() }),
    output: ResultSchema(z.object({ newWorkspaceId: z.string() }), z.string()),
  },
  updateTitle: {
    input: z.object({ workspaceId: z.string(), title: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  updateAgentAISettings: {
    input: z.object({
      workspaceId: z.string(),
      agentId: AgentIdSchema,
      aiSettings: WorkspaceAISettingsSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  updateModeAISettings: {
    input: z.object({
      workspaceId: z.string(),
      mode: UIModeSchema,
      aiSettings: WorkspaceAISettingsSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  archive: {
    input: z.object({ workspaceId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  unarchive: {
    input: z.object({ workspaceId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  fork: {
    input: z.object({ sourceWorkspaceId: z.string(), newName: z.string() }),
    output: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
        metadata: FrontendWorkspaceMetadataSchema,
        projectPath: z.string(),
      }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  },
  sendMessage: {
    input: z.object({
      workspaceId: z.string(),
      message: z.string(),
      options: SendMessageOptionsSchema.extend({
        fileParts: z.array(FilePartSchema).optional(),
      }),
    }),
    output: ResultSchema(z.object({}), SendMessageErrorSchema),
  },
  answerAskUserQuestion: {
    input: z
      .object({
        workspaceId: z.string(),
        toolCallId: z.string(),
        answers: z.record(z.string(), z.string()),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  resumeStream: {
    input: z.object({
      workspaceId: z.string(),
      options: SendMessageOptionsSchema,
    }),
    output: ResultSchema(z.void(), SendMessageErrorSchema),
  },
  interruptStream: {
    input: z.object({
      workspaceId: z.string(),
      options: z
        .object({
          soft: z.boolean().optional(),
          abandonPartial: z.boolean().optional(),
          sendQueuedImmediately: z.boolean().optional(),
        })
        .optional(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  clearQueue: {
    input: z.object({ workspaceId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  truncateHistory: {
    input: z.object({
      workspaceId: z.string(),
      percentage: z.number().optional(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  replaceChatHistory: {
    input: z.object({
      workspaceId: z.string(),
      summaryMessage: LatticeMessageSchema,
      /** When true, delete the plan file (new + legacy paths) and clear plan tracking state. */
      deletePlanFile: z.boolean().optional(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  getDevcontainerInfo: {
    input: z.object({ workspaceId: z.string() }),
    output: z
      .object({
        containerName: z.string(),
        containerWorkspacePath: z.string(),
        hostWorkspacePath: z.string(),
      })
      .nullable(),
  },
  getInfo: {
    input: z.object({ workspaceId: z.string() }),
    output: FrontendWorkspaceMetadataSchema.nullable(),
  },
  getLastLlmRequest: {
    input: z.object({ workspaceId: z.string() }),
    output: ResultSchema(DebugLlmRequestSnapshotSchema.nullable(), z.string()),
  },
  getFullReplay: {
    input: z.object({ workspaceId: z.string() }),
    output: z.array(WorkspaceChatMessageSchema),
  },
  executeBash: {
    input: z.object({
      workspaceId: z.string(),
      script: z.string(),
      options: z
        .object({
          timeout_secs: z.number().optional(),
        })
        .optional(),
    }),
    output: ResultSchema(BashToolResultSchema, z.string()),
  },
  getFileCompletions: {
    input: z
      .object({
        workspaceId: z.string(),
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      })
      .strict(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  // Subscriptions
  onChat: {
    input: z.object({ workspaceId: z.string() }),
    output: eventIterator(WorkspaceChatMessageSchema), // Stream event
  },
  onMetadata: {
    input: z.void(),
    output: eventIterator(
      z.object({
        workspaceId: z.string(),
        metadata: FrontendWorkspaceMetadataSchema.nullable(),
      })
    ),
  },
  activity: {
    list: {
      input: z.void(),
      output: z.record(z.string(), WorkspaceActivitySnapshotSchema),
    },
    subscribe: {
      input: z.void(),
      output: eventIterator(
        z.object({
          workspaceId: z.string(),
          activity: WorkspaceActivitySnapshotSchema.nullable(),
        })
      ),
    },
  },
  /**
   * Get the current plan file content for a workspace.
   * Used by UI to refresh plan display when file is edited externally.
   */
  getPlanContent: {
    input: z.object({ workspaceId: z.string() }),
    output: ResultSchema(
      z.object({
        content: z.string(),
        path: z.string(),
      }),
      z.string()
    ),
  },
  backgroundBashes: {
    /**
     * Subscribe to background bash state changes for a workspace.
     * Emits full state on connect, then incremental updates.
     */
    subscribe: {
      input: z.object({ workspaceId: z.string() }),
      output: eventIterator(
        z.object({
          /** Background processes (not including foreground ones being waited on) */
          processes: z.array(BackgroundProcessInfoSchema),
          /** Tool call IDs of foreground bashes that can be sent to background */
          foregroundToolCallIds: z.array(z.string()),
        })
      ),
    },
    terminate: {
      input: z.object({ workspaceId: z.string(), processId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
    /**
     * Send a foreground bash process to background.
     * The process continues running but the agent stops waiting for it.
     */
    sendToBackground: {
      input: z.object({ workspaceId: z.string(), toolCallId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
    /**
     * Peek output for a background bash process without consuming the bash_output cursor.
     */
    getOutput: {
      input: z.object({
        workspaceId: z.string(),
        processId: z.string(),
        fromOffset: z.number().int().nonnegative().optional(),
        tailBytes: z.number().int().positive().max(1_000_000).optional(),
      }),
      output: ResultSchema(
        z.object({
          status: z.enum(["running", "exited", "killed", "failed"]),
          output: z.string(),
          nextOffset: z.number().int().nonnegative(),
          truncatedStart: z.boolean(),
        }),
        z.string()
      ),
    },
  },
  /**
   * Get post-compaction context state for a workspace.
   * Returns plan path (if exists) and tracked file paths that will be injected.
   */
  getPostCompactionState: {
    input: z.object({ workspaceId: z.string() }),
    output: z.object({
      planPath: z.string().nullable(),
      trackedFilePaths: z.array(z.string()),
      excludedItems: z.array(z.string()),
    }),
  },
  /**
   * Toggle whether a post-compaction item is excluded from injection.
   * Item IDs: "plan" for plan file, "file:<path>" for tracked files.
   */
  setPostCompactionExclusion: {
    input: z.object({
      workspaceId: z.string(),
      itemId: z.string(),
      excluded: z.boolean(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  stats: {
    subscribe: {
      input: z.object({ workspaceId: z.string() }),
      output: eventIterator(WorkspaceStatsSnapshotSchema),
    },
    clear: {
      input: z.object({ workspaceId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
  getSessionUsage: {
    input: z.object({ workspaceId: z.string() }),
    output: SessionUsageFileSchema.optional(),
  },
  /** Batch fetch session usage for multiple workspaces (for archived workspaces cost display) */
  getSessionUsageBatch: {
    input: z.object({ workspaceIds: z.array(z.string()) }),
    output: z.record(z.string(), SessionUsageFileSchema.optional()),
  },
  /** Per-workspace MCP configuration (overrides project-level mcp.jsonc) */
  mcp: {
    get: {
      input: z.object({ workspaceId: z.string() }),
      output: WorkspaceMCPOverridesSchema,
    },
    set: {
      input: z.object({
        workspaceId: z.string(),
        overrides: WorkspaceMCPOverridesSchema,
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
};

export type WorkspaceSendMessageOutput = z.infer<typeof workspace.sendMessage.output>;

// Tasks (agent sub-workspaces)
export const tasks = {
  create: {
    input: z
      .object({
        parentWorkspaceId: z.string(),
        kind: z.literal("agent"),
        agentId: AgentIdSchema.optional(),
        /** @deprecated Legacy alias for agentId (kept for downgrade compatibility). */
        agentType: z.string().min(1).optional(),
        prompt: z.string(),
        title: z.string().min(1),
        modelString: z.string().optional(),
        thinkingLevel: z.string().optional(),
      })
      .superRefine((value, ctx) => {
        const hasAgentId = typeof value.agentId === "string" && value.agentId.trim().length > 0;
        const hasAgentType =
          typeof value.agentType === "string" && value.agentType.trim().length > 0;

        if (hasAgentId === hasAgentType) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "tasks.create: exactly one of agentId or agentType is required",
            path: ["agentId"],
          });
        }
      }),
    output: ResultSchema(
      z.object({
        taskId: z.string(),
        kind: z.literal("agent"),
        status: z.enum(["queued", "running"]),
      }),
      z.string()
    ),
  },
};

// Agent definitions (unifies UI modes + subagents)
// Agents can be discovered from either the PROJECT path or the WORKSPACE path.
// - Headquarter path: <projectPath>/.lattice/agents - shared across all workspaces
// - Workspace path: <worktree>/.lattice/agents - workspace-specific (useful for iterating)
// Default is workspace path when workspaceId is provided.
// Use disableWorkspaceAgents in SendMessageOptions to skip workspace agents during message sending.

// At least one of projectPath or workspaceId must be provided for agent discovery.
// Agent discovery input supports:
// - workspaceId only: resolve projectPath from workspace metadata, discover from worktree
// - projectPath only: discover from project path (project page, no workspace yet)
// - both: discover from worktree using workspaceId
// - disableWorkspaceAgents: when true with workspaceId, use workspace's runtime but discover
//   from projectPath instead of worktree (useful for SSH workspaces when iterating on agents)
const AgentDiscoveryInputSchema = z
  .object({
    projectPath: z.string().optional(),
    workspaceId: z.string().optional(),
    /** When true, skip workspace worktree and discover from projectPath (but still use workspace runtime) */
    disableWorkspaceAgents: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.projectPath ?? data.workspaceId), {
    message: "Either projectPath or workspaceId must be provided",
  });

export const agents = {
  list: {
    input: AgentDiscoveryInputSchema,
    output: z.array(AgentDefinitionDescriptorSchema),
  },
  get: {
    input: AgentDiscoveryInputSchema.and(z.object({ agentId: AgentIdSchema })),
    output: AgentDefinitionPackageSchema,
  },
};

// Agent skills
export const agentSkills = {
  list: {
    input: AgentDiscoveryInputSchema,
    output: z.array(AgentSkillDescriptorSchema),
  },
  get: {
    input: AgentDiscoveryInputSchema.and(z.object({ skillName: SkillNameSchema })),
    output: AgentSkillPackageSchema,
  },
};

// Plugin Packs
export const pluginPacks = {
  list: {
    input: z.object({ projectPath: z.string().optional() }),
    output: z.array(PluginPackDescriptorSchema),
  },
  setEnabled: {
    input: z.object({
      projectPath: z.string().optional(),
      name: PluginPackNameSchema,
      enabled: z.boolean(),
    }),
    output: z.void(),
  },
  getMcpServers: {
    input: z.object({ name: PluginPackNameSchema }),
    output: z.record(z.string(), PluginPackMcpServerSchema),
  },
};

// Name generation for new workspaces (decoupled from workspace creation)
export const nameGeneration = {
  generate: {
    input: z.object({
      message: z.string(),
      /** Models to try in order (defaults to small/cheap models like Haiku, GPT-Mini) */
      preferredModels: z.array(z.string()).optional(),
      /** User's selected model to try after preferred models (for Ollama/Bedrock/custom providers) */
      userModel: z.string().optional(),
    }),
    output: ResultSchema(
      z.object({
        /** Short git-safe name with suffix (e.g., "plan-a1b2") */
        name: z.string(),
        /** Human-readable title (e.g., "Fix plan mode over SSH") */
        title: z.string(),
        modelUsed: z.string(),
      }),
      SendMessageErrorSchema
    ),
  },
};

// Window
export const window = {
  setTitle: {
    input: z.object({ title: z.string() }),
    output: z.void(),
  },
};

// Terminal
export const terminal = {
  create: {
    input: TerminalCreateParamsSchema,
    output: TerminalSessionSchema,
  },
  close: {
    input: z.object({ sessionId: z.string() }),
    output: z.void(),
  },
  resize: {
    input: TerminalResizeParamsSchema,
    output: z.void(),
  },
  sendInput: {
    input: z.object({ sessionId: z.string(), data: z.string() }),
    output: z.void(),
  },
  onOutput: {
    input: z.object({ sessionId: z.string() }),
    output: eventIterator(z.string()),
  },
  /**
   * Attach to a terminal session with race-free state restore.
   * First yields { type: "screenState", data: string } with serialized screen (~4KB),
   * then yields { type: "output", data: string } for each live output chunk.
   * Guarantees no missed output between state snapshot and live stream.
   */
  attach: {
    input: z.object({ sessionId: z.string() }),
    output: eventIterator(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("screenState"), data: z.string() }),
        z.object({ type: z.literal("output"), data: z.string() }),
      ])
    ),
  },

  onExit: {
    input: z.object({ sessionId: z.string() }),
    output: eventIterator(z.number()),
  },
  openWindow: {
    input: z.object({
      workspaceId: z.string(),
      /** Optional session ID to reattach to an existing terminal session (for pop-out handoff) */
      sessionId: z.string().optional(),
    }),
    output: z.void(),
  },
  closeWindow: {
    input: z.object({ workspaceId: z.string() }),
    output: z.void(),
  },
  /**
   * List active terminal sessions for a workspace.
   * Used by frontend to discover existing sessions to reattach to after reload.
   */
  listSessions: {
    input: z.object({ workspaceId: z.string() }),
    output: z.array(z.string()),
  },
  /**
   * Open the native system terminal for a workspace.
   * Opens the user's preferred terminal emulator (Ghostty, Terminal.app, etc.)
   * with the working directory set to the workspace path.
   */
  openNative: {
    input: z.object({ workspaceId: z.string() }),
    output: z.void(),
  },

  /**
   * Subscribe to AI-hired employee terminal sessions.
   * Yields { sessionId, slug, label } whenever PM Chat's hire_employee tool creates a new session.
   * Used by MainArea to auto-add the employee tab without a page interaction.
   */
  onEmployeeHired: {
    input: z.object({ workspaceId: z.string() }),
    output: eventIterator(
      z.object({
        sessionId: z.string(),
        slug: z.string(),
        label: z.string(),
      })
    ),
  },

  /**
   * Disk-backed scrollback persistence for employee agent terminals.
   * Stored at ~/.lattice/terminal-scrollback/{sessionId}.bin, capped at 8 MB.
   * Survives page reloads and app restarts. Cleared when a session exits or is closed.
   */
  scrollback: {
    /** Load the full stored output buffer for a session (empty string if none). */
    load: {
      input: z.object({ sessionId: z.string() }),
      output: z.string(),
    },
    /** Append a chunk of output to the stored buffer, trimming from front if > 8 MB. */
    append: {
      input: z.object({ sessionId: z.string(), data: z.string() }),
      output: z.void(),
    },
    /** Delete the stored buffer for a session. */
    clear: {
      input: z.object({ sessionId: z.string() }),
      output: z.void(),
    },
  },
};

// Server

export const ApiServerStatusSchema = z.object({
  running: z.boolean(),
  /** Base URL that is always connectable from the local machine (loopback for wildcard binds). */
  baseUrl: z.string().nullable(),
  /** The host/interface the server is actually bound to. */
  bindHost: z.string().nullable(),
  /** The port the server is listening on. */
  port: z.number().int().min(0).max(65535).nullable(),
  /** Additional base URLs that may be reachable from other devices (LAN/VPN). */
  networkBaseUrls: z.array(z.url()),
  /** Auth token required for HTTP/WS API access. */
  token: z.string().nullable(),
  /** Configured bind host from ~/.lattice/config.json (if set). */
  configuredBindHost: z.string().nullable(),
  /** Configured port from ~/.lattice/config.json (if set). */
  configuredPort: z.number().int().min(0).max(65535).nullable(),
  /** Whether the API server should serve the lattice web UI at /. */
  configuredServeWebUi: z.boolean(),
});

export const server = {
  getLaunchProject: {
    input: z.void(),
    output: z.string().nullable(),
  },
  getSshHost: {
    input: z.void(),
    output: z.string().nullable(),
  },
  setSshHost: {
    input: z.object({ sshHost: z.string().nullable() }),
    output: z.void(),
  },
  getApiServerStatus: {
    input: z.void(),
    output: ApiServerStatusSchema,
  },
  setApiServerSettings: {
    input: z.object({
      bindHost: z.string().nullable(),
      port: z.number().int().min(0).max(65535).nullable(),
      serveWebUi: z.boolean().nullable().optional(),
    }),
    output: ApiServerStatusSchema,
  },
};

// Config (global settings)
const SubagentAiDefaultsEntrySchema = z
  .object({
    modelString: z.string().min(1).optional(),
    thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh"]).optional(),
  })
  .strict();

const AgentAiDefaultsSchema = z.record(z.string().min(1), SubagentAiDefaultsEntrySchema);
const SubagentAiDefaultsSchema = z.record(z.string().min(1), SubagentAiDefaultsEntrySchema);

export const config = {
  getConfig: {
    input: z.void(),
    output: z.object({
      taskSettings: z.object({
        maxParallelAgentTasks: z.number().int(),
        maxTaskNestingDepth: z.number().int(),
        proposePlanImplementReplacesChatHistory: z.boolean().optional(),
        bashOutputCompactionMinLines: z.number().int().optional(),
        bashOutputCompactionMinTotalBytes: z.number().int().optional(),
        bashOutputCompactionMaxKeptLines: z.number().int().optional(),
        bashOutputCompactionTimeoutMs: z.number().int().optional(),
        bashOutputCompactionHeuristicFallback: z.boolean().optional(),
      }),
      agentAiDefaults: AgentAiDefaultsSchema,
      // Legacy fields (downgrade compatibility)
      subagentAiDefaults: SubagentAiDefaultsSchema,
    }),
  },
  saveConfig: {
    input: z.object({
      taskSettings: z.object({
        maxParallelAgentTasks: z.number().int(),
        maxTaskNestingDepth: z.number().int(),
        proposePlanImplementReplacesChatHistory: z.boolean().optional(),
        bashOutputCompactionMinLines: z.number().int().optional(),
        bashOutputCompactionMinTotalBytes: z.number().int().optional(),
        bashOutputCompactionMaxKeptLines: z.number().int().optional(),
        bashOutputCompactionTimeoutMs: z.number().int().optional(),
        bashOutputCompactionHeuristicFallback: z.boolean().optional(),
      }),
      agentAiDefaults: AgentAiDefaultsSchema.optional(),
      // Legacy field (downgrade compatibility)
      subagentAiDefaults: SubagentAiDefaultsSchema.optional(),
    }),
    output: z.void(),
  },
  updateAgentAiDefaults: {
    input: z.object({
      agentAiDefaults: AgentAiDefaultsSchema,
    }),
    output: z.void(),
  },
};

// UI Layouts (global settings)
export const uiLayouts = {
  getAll: {
    input: z.void(),
    output: LayoutPresetsConfigSchema,
  },
  saveAll: {
    input: z
      .object({
        layoutPresets: LayoutPresetsConfigSchema,
      })
      .strict(),
    output: z.void(),
  },
};

// Splash screens
export const splashScreens = {
  getViewedSplashScreens: {
    input: z.void(),
    output: z.array(z.string()),
  },
  markSplashScreenViewed: {
    input: z.object({
      splashId: z.string(),
    }),
    output: z.void(),
  },
};

// Update
export const update = {
  check: {
    input: z.void(),
    output: z.void(),
  },
  download: {
    input: z.void(),
    output: z.void(),
  },
  install: {
    input: z.void(),
    output: z.void(),
  },
  onStatus: {
    input: z.void(),
    output: eventIterator(UpdateStatusSchema),
  },
};

// Editor config schema for openWorkspaceInEditor
const EditorTypeSchema = z.enum(["vscode", "cursor", "zed", "custom"]);
const EditorConfigSchema = z.object({
  editor: EditorTypeSchema,
  customCommand: z.string().optional(),
});

const StatsTabVariantSchema = z.enum(["control", "stats"]);
const StatsTabOverrideSchema = z.enum(["default", "on", "off"]);
const StatsTabStateSchema = z.object({
  enabled: z.boolean(),
  variant: StatsTabVariantSchema,
  override: StatsTabOverrideSchema,
});

// Feature gates (PostHog-backed)
export const features = {
  getStatsTabState: {
    input: z.void(),
    output: StatsTabStateSchema,
  },
  setStatsTabOverride: {
    input: z.object({ override: StatsTabOverrideSchema }),
    output: StatsTabStateSchema,
  },
};

// General
export const general = {
  listDirectory: {
    input: z.object({ path: z.string() }),
    output: ResultSchema(FileTreeNodeSchema),
  },
  /**
   * Create a directory at the specified path.
   * Creates parent directories recursively if they don't exist (like mkdir -p).
   */
  createDirectory: {
    input: z.object({ path: z.string() }),
    output: ResultSchema(z.object({ normalizedPath: z.string() }), z.string()),
  },
  ping: {
    input: z.string(),
    output: z.string(),
  },
  /**
   * Test endpoint: emits numbered ticks at an interval.
   * Useful for verifying streaming works over HTTP and WebSocket.
   */
  tick: {
    input: z.object({
      count: z.number().int().min(1).max(100),
      intervalMs: z.number().int().min(10).max(5000),
    }),
    output: eventIterator(z.object({ tick: z.number(), timestamp: z.number() })),
  },
  /**
   * Open a path in the user's configured code editor.
   * For SSH workspaces with useRemoteExtension enabled, uses Remote-SSH extension.
   *
   * @param workspaceId - The workspace (used to determine if SSH and get remote host)
   * @param targetPath - The path to open (workspace directory or specific file)
   * @param editorConfig - Editor configuration from user settings
   */
  openInEditor: {
    input: z.object({
      workspaceId: z.string(),
      targetPath: z.string(),
      editorConfig: EditorConfigSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
};

// Menu events (main→renderer notifications)
export const menu = {
  onOpenSettings: {
    input: z.void(),
    output: eventIterator(z.void()),
  },
};

// Voice input (transcription via OpenAI Whisper)
export const voice = {
  transcribe: {
    input: z.object({ audioBase64: z.string() }),
    output: ResultSchema(z.string(), z.string()),
  },
};

// ─── Inference (Local Models) ──────────────────────────────────────

const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  huggingFaceRepo: z.string().optional(),
  format: z.enum(["mlx", "gguf", "pytorch", "unknown"]),
  sizeBytes: z.number(),
  parameterCount: z.number().optional(),
  quantization: z.string().optional(),
  localPath: z.string(),
  backend: z.string().optional(),
  pulledAt: z.string().optional(),
});

const DownloadProgressSchema = z.object({
  fileName: z.string(),
  downloadedBytes: z.number(),
  totalBytes: z.number(),
});

const InferenceStatusSchema = z.object({
  available: z.boolean(),
  loadedModelId: z.string().nullable(),
});

export const inference = {
  getStatus: {
    input: z.void(),
    output: InferenceStatusSchema,
  },
  listModels: {
    input: z.void(),
    output: z.array(ModelInfoSchema),
  },
  pullModel: {
    input: z.object({ modelId: z.string() }),
    output: z.object({ localPath: z.string() }),
  },
  deleteModel: {
    input: z.object({ modelId: z.string() }),
    output: z.void(),
  },
  loadModel: {
    input: z.object({ modelId: z.string(), backend: z.string().optional() }),
    output: z.void(),
  },
  unloadModel: {
    input: z.object({ modelId: z.string().optional() }),
    output: z.void(),
  },
  onDownloadProgress: {
    input: z.void(),
    output: eventIterator(DownloadProgressSchema),
  },
  onStatusChanged: {
    input: z.void(),
    output: eventIterator(InferenceStatusSchema),
  },

  // ─── Pool (Phase 2) ──────────────────────────────────────────────────
  getPoolStatus: {
    input: z.void(),
    output: z.object({
      loadedModels: z.array(
        z.object({
          model_id: z.string(),
          model_path: z.string(),
          backend: z.string(),
          alive: z.boolean(),
          estimated_bytes: z.number(),
          loaded_at: z.string(),
          last_used_at: z.string(),
          use_count: z.number(),
        })
      ),
      modelsLoaded: z.number(),
      maxLoadedModels: z.number(),
      memoryBudgetBytes: z.number(),
      estimatedVramBytes: z.number(),
    }),
  },
  getMetrics: {
    input: z.void(),
    output: z.string(),
  },

  // ─── Cluster (Phase 3) ───────────────────────────────────────────────
  getClusterStatus: {
    input: z.void(),
    output: z
      .object({
        nodes: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            address: z.string(),
            status: z.string(),
            loaded_models: z.array(z.string()),
            active_inferences: z.number(),
            used_memory_bytes: z.number(),
            total_memory_bytes: z.number(),
            gpu_type: z.string(),
            tokens_per_second_avg: z.number(),
            last_heartbeat: z.string(),
          })
        ),
        total_nodes: z.number(),
        total_models: z.number(),
      })
      .nullable(),
  },
  getClusterNodes: {
    input: z.void(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        address: z.string(),
        status: z.string(),
        loaded_models: z.array(z.string()),
        active_inferences: z.number(),
        used_memory_bytes: z.number(),
        total_memory_bytes: z.number(),
        gpu_type: z.string(),
        tokens_per_second_avg: z.number(),
        last_heartbeat: z.string(),
      })
    ),
  },

  // ─── RDMA / Transport (Phase 4+6) ───────────────────────────────────
  getRdmaStatus: {
    input: z.void(),
    output: z
      .object({
        available: z.boolean(),
        mode: z.string(),
        device: z.string(),
        backend: z.string(),
        bandwidth_gbps: z.number(),
        latency_us: z.number(),
        max_message_size: z.number(),
        error: z.string().optional(),
      })
      .nullable(),
  },
  getTransportStatus: {
    input: z.void(),
    output: z
      .object({
        rdma: z.object({
          available: z.boolean(),
          mode: z.string(),
          device: z.string(),
          backend: z.string(),
          bandwidth_gbps: z.number(),
          latency_us: z.number(),
          max_message_size: z.number(),
          error: z.string().optional(),
        }),
        peer_transports: z.array(
          z.object({
            peer_id: z.string(),
            peer_name: z.string(),
            transport: z.string(),
            bandwidth_gbps: z.number(),
            latency_us: z.number(),
            connected: z.boolean(),
          })
        ),
        router_transports: z.record(z.string(), z.string()),
      })
      .nullable(),
  },

  // ─── System Info ─────────────────────────────────────────────────────
  getSystemInfo: {
    input: z.void(),
    output: z.object({
      hostname: z.string(),
      username: z.string(),
      platform: z.string(),
      arch: z.string(),
      osType: z.string(),
      osRelease: z.string(),
      cpuModel: z.string(),
      cpuCores: z.number(),
      totalMemoryBytes: z.number(),
      freeMemoryBytes: z.number(),
      uptime: z.number(),
      nodeVersion: z.string(),
      pid: z.number(),
    }),
  },

  // ─── Benchmark (Sprint 2) ────────────────────────────────────────────
  runBenchmark: {
    input: z.object({ modelId: z.string().optional() }),
    output: z.object({
      model: z.string(),
      completion_tokens: z.number(),
      total_time_ms: z.number(),
      time_to_first_token_ms: z.number(),
      tokens_per_second: z.number(),
      peak_memory_bytes: z.number(),
    }),
  },
};

// Debug endpoints (test-only, not for production use)
export const debug = {
  /**
   * Trigger an artificial stream error for testing recovery.
   * Used by integration tests to simulate network errors mid-stream.
   */
  triggerStreamError: {
    input: z.object({
      workspaceId: z.string(),
      errorMessage: z.string().optional(),
    }),
    output: z.boolean(), // true if error was triggered on an active stream
  },
};
