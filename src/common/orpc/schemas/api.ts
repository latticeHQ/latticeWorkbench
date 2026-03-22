import { eventIterator } from "@orpc/server";
import { UIModeSchema } from "../../types/mode";
import { z } from "zod";
import { ChatStatsSchema, SessionUsageFileSchema } from "./chatStats";
import { NameGenerationErrorSchema, SendMessageErrorSchema } from "./errors";
import { BranchListResultSchema, FilePartSchema, LatticeMessageSchema } from "./message";
import { ProjectConfigSchema, StageConfigSchema } from "./project";
import { ResultSchema } from "./result";
import { SshPromptEventSchema, SshPromptResponseInputSchema } from "./ssh";
import {
  RuntimeConfigSchema,
  RuntimeAvailabilitySchema,
  RuntimeEnablementIdSchema,
} from "./runtime";
import { SecretSchema } from "./secrets";
import {
  CompletedMessagePartSchema,
  OnChatModeSchema,
  SendMessageOptionsSchema,
  StreamEndEventSchema,
  UpdateStatusSchema,
  MinionChatMessageSchema,
} from "./stream";
import { LayoutPresetsConfigSchema } from "./uiLayouts";
import {
  TerminalCreateParamsSchema,
  TerminalResizeParamsSchema,
  TerminalSessionSchema,
} from "./terminal";
import {
  BrowserActionResultSchema,
  BrowserProviderConfigSchema,
  BrowserSessionConfigSchema,
  BrowserSessionInfoSchema,
} from "./browser";
import {
  KanbanArchivedBufferOutputSchema,
  KanbanCardSchema,
  KanbanGetArchivedBufferInputSchema,
  KanbanListInputSchema,
  KanbanMoveCardInputSchema,
  KanbanSubscribeInputSchema,
} from "./kanban";
import { ExoStatusSchema } from "./inference";
import { LatticeInferenceClusterStatusSchema } from "./latticeInferenceCluster";
import {
  LatticeInferenceStatusSchema,
  DownloadProgressSchema,
  ClusterStateSchema,
  ClusterNodeSchema,
  BenchmarkResultSchema,
  InferenceSetupStatusSchema,
  SetupStreamEventSchema,
  PullModelInputSchema,
  LoadModelInputSchema,
  UnloadModelInputSchema,
  DeleteModelInputSchema,
  BenchmarkInputSchema,
  LatticeModelInfoSchema,
} from "./latticeInference";
import {
  ScheduledJobRunSchema,
  ScheduledJobWithStateSchema,
  SchedulerCreateInputSchema,
  SchedulerHistoryInputSchema,
  SchedulerListInputSchema,
  SchedulerRemoveInputSchema,
  SchedulerRunInputSchema,
  SchedulerSubscribeInputSchema,
  SchedulerUpdateInputSchema,
} from "./scheduler";
import {
  SyncConfigSchema,
  SyncStatusSchema,
  SyncSaveConfigInputSchema,
  SyncSuccessOutputSchema,
  SyncGhAuthOutputSchema,
  SyncGhRepoSchema,
  SyncCreateRepoInputSchema,
  SyncCreateRepoOutputSchema,
} from "./sync";
import {
  InboxChannelTokenStatusSchema,
  InboxConnectAdapterInputSchema,
  InboxConnectionStatusSchema,
  InboxConversationSchema,
  InboxConversationSummarySchema,
  InboxDisconnectAdapterInputSchema,
  InboxGetConversationInputSchema,
  InboxListInputSchema,
  InboxSendReplyInputSchema,
  InboxSetChannelTokenInputSchema,
  InboxSubscribeInputSchema,
  InboxUpdateStatusInputSchema,
} from "./inbox";
import { BashToolResultSchema, FileTreeNodeSchema } from "./tools";
import { MinionStatsSnapshotSchema } from "./minionStats";
import { FrontendMinionMetadataSchema, MinionActivitySnapshotSchema, MinionMetadataSchema } from "./minion";
import { MinionAISettingsSchema } from "./minionAiSettings";
import {
  AgentSkillDescriptorSchema,
  AgentSkillIssueSchema,
  AgentSkillPackageSchema,
  SkillNameSchema,
} from "./agentSkill";
import {
  AgentDefinitionDescriptorSchema,
  AgentDefinitionPackageSchema,
  AgentIdSchema,
} from "./agentDefinition";
import {
  MCPAddGlobalParamsSchema,
  MCPAddParamsSchema,
  MCPListParamsSchema,
  MCPRemoveGlobalParamsSchema,
  MCPRemoveParamsSchema,
  MCPServerMapSchema,
  MCPSetEnabledGlobalParamsSchema,
  MCPSetEnabledParamsSchema,
  MCPSetToolAllowlistGlobalParamsSchema,
  MCPSetToolAllowlistParamsSchema,
  MCPTestGlobalParamsSchema,
  MCPTestParamsSchema,
  MCPTestResultSchema,
  MinionMCPOverridesSchema,
} from "./mcp";
import { PolicyGetResponseSchema } from "./policy";

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

// Re-export analytics schemas
export { analytics } from "./analytics";

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
      minionId: z.string(),
      messages: z.array(LatticeMessageSchema),
      model: z.string(),
    }),
    output: ChatStatsSchema,
  },
};

// Providers
export const AWSCredentialStatusSchema = z.object({
  region: z.string().optional(),
  /** Optional AWS shared config profile name (equivalent to AWS_PROFILE). */
  profile: z.string().optional(),
  bearerTokenSet: z.boolean(),
  accessKeyIdSet: z.boolean(),
  secretAccessKeySet: z.boolean(),
});

export const ProviderModelEntrySchema = z.union([
  z.string().min(1),
  z
    .object({
      id: z.string().min(1),
      contextWindowTokens: z.number().int().positive().optional(),
      mappedToModel: z.string().min(1).optional(),
    })
    .strict(),
]);

export const ProviderConfigInfoSchema = z.object({
  apiKeySet: z.boolean(),
  /** Whether this provider is enabled for model requests */
  isEnabled: z.boolean().default(true),
  /** Whether this provider is configured and ready to use */
  isConfigured: z.boolean(),
  baseUrl: z.string().optional(),
  models: z.array(ProviderModelEntrySchema).optional(),
  /** OpenAI-specific fields */
  serviceTier: z.enum(["auto", "default", "flex", "priority"]).optional(),
  /** Anthropic-specific fields */
  cacheTtl: z.enum(["5m", "1h"]).optional(),
  /** Anthropic-only: whether Anthropic OAuth tokens (Claude Pro/Max) are stored */
  anthropicOauthSet: z.boolean().optional(),
  /** OpenAI-only: whether Codex OAuth tokens are present in providers.jsonc */
  codexOauthSet: z.boolean().optional(),
  /**
   * OpenAI-only: default auth precedence to use for Codex-OAuth-allowed models when BOTH
   * ChatGPT OAuth and an OpenAI API key are configured.
   */
  codexOauthDefaultAuth: z.enum(["oauth", "apiKey"]).optional(),
  /** AWS-specific fields (only present for bedrock provider) */
  aws: AWSCredentialStatusSchema.optional(),
  /** Claude Code-only: execution mode (proxy, agentic, streaming) */
  claudeCodeMode: z.enum(["proxy", "agentic", "streaming"]).optional(),
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
      models: z.array(ProviderModelEntrySchema),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  list: {
    input: z.void(),
    output: z.array(z.string()),
  },
  // Subscription: emits when provider config changes (API keys, models, etc.)
  onConfigChanged: {
    input: z.void(),
    output: eventIterator(z.void()),
  },
};

// Policy (admin-enforced config)
export const policy = {
  get: {
    input: z.void(),
    output: PolicyGetResponseSchema,
  },
  // Subscription: emits when the effective policy changes (file refresh)
  onChanged: {
    input: z.void(),
    output: eventIterator(z.void()),
  },
  // Force a refresh of the effective policy (re-reads LATTICE_POLICY_FILE or Governor policy)
  refreshNow: {
    input: z.void(),
    output: ResultSchema(PolicyGetResponseSchema, z.string()),
  },
};

// GitHub Copilot OAuth (Device Code Flow)
export const copilotOauth = {
  startDeviceFlow: {
    input: z.void(),
    output: ResultSchema(
      z.object({
        flowId: z.string(),
        verificationUri: z.string(),
        userCode: z.string(),
      }),
      z.string()
    ),
  },
  waitForDeviceFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelDeviceFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
};

// Lattice Governor OAuth (enrollment for enterprise policy service)
export const latticeGovernorOauth = {
  startDesktopFlow: {
    input: z.object({ governorOrigin: z.string() }).strict(),
    output: ResultSchema(
      z.object({
        flowId: z.string(),
        authorizeUrl: z.string(),
        redirectUri: z.string(),
      }),
      z.string()
    ),
  },
  waitForDesktopFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelDesktopFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
};

// Codex OAuth (ChatGPT subscription auth)
export const codexOauth = {
  startDesktopFlow: {
    input: z.void(),
    output: ResultSchema(z.object({ flowId: z.string(), authorizeUrl: z.string() }), z.string()),
  },
  waitForDesktopFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelDesktopFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
  startDeviceFlow: {
    input: z.void(),
    output: ResultSchema(
      z.object({
        flowId: z.string(),
        userCode: z.string(),
        verifyUrl: z.string(),
        intervalSeconds: z.number().int().positive(),
      }),
      z.string()
    ),
  },
  waitForDeviceFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelDeviceFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
  disconnect: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
};

// Anthropic OAuth (Claude Pro/Max subscription auth)
export const anthropicOauth = {
  startFlow: {
    input: z.void(),
    output: ResultSchema(z.object({ flowId: z.string(), authorizeUrl: z.string() }), z.string()),
  },
  submitCode: {
    input: z.object({ flowId: z.string(), code: z.string() }).strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  waitForFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
  disconnect: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
};

const MCPOAuthPendingServerSchema = z
  .object({
    // OAuth is only supported for remote transports.
    transport: z.union([z.literal("http"), z.literal("sse"), z.literal("auto")]),
    url: z.string(),
  })
  .strict();

// MCP OAuth
export const mcpOauth = {
  startDesktopFlow: {
    input: z
      .object({
        projectPath: z.string().optional(),
        serverName: z.string(),
        pendingServer: MCPOAuthPendingServerSchema.optional(),
      })
      .strict(),
    output: ResultSchema(
      z.object({
        flowId: z.string(),
        authorizeUrl: z.string(),
        redirectUri: z.string(),
      }),
      z.string()
    ),
  },
  waitForDesktopFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelDesktopFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
  startServerFlow: {
    input: z
      .object({
        projectPath: z.string().optional(),
        serverName: z.string(),
        pendingServer: MCPOAuthPendingServerSchema.optional(),
      })
      .strict(),
    output: ResultSchema(
      z.object({
        flowId: z.string(),
        authorizeUrl: z.string(),
        redirectUri: z.string(),
      }),
      z.string()
    ),
  },
  waitForServerFlow: {
    input: z
      .object({
        flowId: z.string(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  cancelServerFlow: {
    input: z.object({ flowId: z.string() }).strict(),
    output: z.void(),
  },
  getAuthStatus: {
    input: z.object({ serverUrl: z.string() }).strict(),
    output: z.object({
      serverUrl: z.string().optional(),
      isLoggedIn: z.boolean(),
      hasRefreshToken: z.boolean(),
      scope: z.string().optional(),
      updatedAtMs: z.number().optional(),
    }),
  },
  logout: {
    input: z.object({ serverUrl: z.string() }).strict(),
    output: ResultSchema(z.void(), z.string()),
  },
};

// Projects
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
  getDefaultProjectDir: {
    input: z.void(),
    output: z.string(),
  },
  setDefaultProjectDir: {
    input: z.object({ path: z.string() }),
    output: z.void(),
  },
  clone: {
    input: z
      .object({
        repoUrl: z.string(),
        cloneParentDir: z.string().nullish(),
      })
      .strict(),
    output: eventIterator(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("progress"), line: z.string() }),
        z.object({
          type: z.literal("success"),
          projectConfig: ProjectConfigSchema,
          normalizedPath: z.string(),
        }),
        z.object({
          type: z.literal("error"),
          code: z.enum([
            "ssh_host_key_rejected",
            "ssh_credential_cancelled",
            "ssh_prompt_timeout",
            "clone_failed",
          ]),
          error: z.string(),
        }),
      ])
    ),
  },
  pickDirectory: {
    input: z.void(),
    output: z.string().nullable(),
  },
  remove: {
    input: z.object({ projectPath: z.string() }),
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
  mcpOauth: {
    startDesktopFlow: {
      input: z
        .object({
          projectPath: z.string(),
          serverName: z.string(),
          pendingServer: MCPOAuthPendingServerSchema.optional(),
        })
        .strict(),
      output: ResultSchema(
        z.object({
          flowId: z.string(),
          authorizeUrl: z.string(),
          redirectUri: z.string(),
        }),
        z.string()
      ),
    },
    waitForDesktopFlow: {
      input: z
        .object({
          flowId: z.string(),
          timeoutMs: z.number().int().positive().optional(),
        })
        .strict(),
      output: ResultSchema(z.void(), z.string()),
    },
    cancelDesktopFlow: {
      input: z.object({ flowId: z.string() }).strict(),
      output: z.void(),
    },
    startServerFlow: {
      input: z
        .object({
          projectPath: z.string(),
          serverName: z.string(),
          pendingServer: MCPOAuthPendingServerSchema.optional(),
        })
        .strict(),
      output: ResultSchema(
        z.object({
          flowId: z.string(),
          authorizeUrl: z.string(),
          redirectUri: z.string(),
        }),
        z.string()
      ),
    },
    waitForServerFlow: {
      input: z
        .object({
          flowId: z.string(),
          timeoutMs: z.number().int().positive().optional(),
        })
        .strict(),
      output: ResultSchema(z.void(), z.string()),
    },
    cancelServerFlow: {
      input: z.object({ flowId: z.string() }).strict(),
      output: z.void(),
    },
    getAuthStatus: {
      input: z
        .object({
          projectPath: z.string(),
          serverName: z.string(),
        })
        .strict(),
      output: z.object({
        serverUrl: z.string().optional(),
        isLoggedIn: z.boolean(),
        hasRefreshToken: z.boolean(),
        scope: z.string().optional(),
        updatedAtMs: z.number().optional(),
      }),
    },
    logout: {
      input: z
        .object({
          projectPath: z.string(),
          serverName: z.string(),
        })
        .strict(),
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
  stages: {
    list: {
      input: z.object({ projectPath: z.string() }),
      output: z.array(StageConfigSchema),
    },
    create: {
      input: z.object({
        projectPath: z.string(),
        name: z.string().min(1),
        color: z.string().optional(),
      }),
      output: ResultSchema(StageConfigSchema, z.string()),
    },
    update: {
      input: z.object({
        projectPath: z.string(),
        stageId: z.string(),
        name: z.string().min(1).optional(),
        color: z.string().optional(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    remove: {
      input: z.object({
        projectPath: z.string(),
        stageId: z.string(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    reorder: {
      input: z.object({
        projectPath: z.string(),
        stageIds: z.array(z.string()),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
    assignMinion: {
      input: z.object({
        projectPath: z.string(),
        minionId: z.string(),
        stageId: z.string().nullable(),
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
};

/**
 * MCP server configuration.
 *
 * Global config lives in <latticeHome>/mcp.jsonc, with optional repo overrides in <projectPath>/.lattice/mcp.jsonc.
 */
export const mcp = {
  list: {
    input: MCPListParamsSchema,
    output: MCPServerMapSchema,
  },
  add: {
    input: MCPAddGlobalParamsSchema,
    output: ResultSchema(z.void(), z.string()),
  },
  remove: {
    input: MCPRemoveGlobalParamsSchema,
    output: ResultSchema(z.void(), z.string()),
  },
  test: {
    input: MCPTestGlobalParamsSchema,
    output: MCPTestResultSchema,
  },
  setEnabled: {
    input: MCPSetEnabledGlobalParamsSchema,
    output: ResultSchema(z.void(), z.string()),
  },
  setToolAllowlist: {
    input: MCPSetToolAllowlistGlobalParamsSchema,
    output: ResultSchema(z.void(), z.string()),
  },
};

/**
 * Secrets store.
 *
 * - When no projectPath is provided: global secrets
 * - When projectPath is provided: project-only secrets
 */
export const secrets = {
  get: {
    input: z.object({ projectPath: z.string().optional() }),
    output: z.array(SecretSchema),
  },
  update: {
    input: z.object({
      projectPath: z.string().optional(),
      secrets: z.array(SecretSchema),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
};

// Re-export Captain schemas from dedicated file
export { captain } from "./captain";

// Re-export Lattice schemas from dedicated file
export {
  lattice,
  LatticeInfoSchema,
  LatticePresetSchema,
  LatticeTemplateSchema,
  LatticeMinionConfigSchema,
  LatticeMinionSchema,
  LatticeMinionStatusSchema,
} from "./lattice";

// Minion
const DebugLlmRequestSnapshotSchema = z
  .object({
    capturedAt: z.number(),
    minionId: z.string(),
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

export const minion = {
  list: {
    input: z
      .object({
        /** When true, only return archived minions. Default returns only non-archived. */
        archived: z.boolean().optional(),
      })
      .optional(),
    output: z.array(FrontendMinionMetadataSchema),
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
      /** Stage ID to assign the new minion to (optional) */
      stageId: z.string().optional(),
      /** Per-minion autonomy overrides from a mission profile preset or manual config */
      autonomyOverrides: MinionMetadataSchema.shape.autonomyOverrides,
    }),
    output: z.discriminatedUnion("success", [
      z.object({ success: z.literal(true), metadata: FrontendMinionMetadataSchema }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  },
  remove: {
    input: z.object({
      minionId: z.string(),
      options: z.object({ force: z.boolean().optional() }).optional(),
    }),
    output: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  rename: {
    input: z.object({ minionId: z.string(), newName: z.string() }),
    output: ResultSchema(z.object({ newMinionId: z.string() }), z.string()),
  },
  updateTitle: {
    input: z.object({ minionId: z.string(), title: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  regenerateTitle: {
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(z.object({ title: z.string() }), z.string()),
  },
  updateAutonomyOverrides: {
    input: z.object({
      minionId: z.string(),
      autonomyOverrides: MinionMetadataSchema.shape.autonomyOverrides,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  updateAgentAISettings: {
    input: z.object({
      minionId: z.string(),
      agentId: AgentIdSchema,
      aiSettings: MinionAISettingsSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  updateModeAISettings: {
    input: z.object({
      minionId: z.string(),
      mode: UIModeSchema,
      aiSettings: MinionAISettingsSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  archive: {
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  unarchive: {
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  archiveMergedInProject: {
    input: z.object({ projectPath: z.string() }),
    output: ResultSchema(
      z.object({
        archivedMinionIds: z.array(z.string()),
        skippedMinionIds: z.array(z.string()),
        errors: z.array(
          z.object({
            minionId: z.string(),
            error: z.string(),
          })
        ),
      }),
      z.string()
    ),
  },
  fork: {
    input: z.object({ sourceMinionId: z.string(), newName: z.string().optional() }),
    output: z.discriminatedUnion("success", [
      z.object({
        success: z.literal(true),
        metadata: FrontendMinionMetadataSchema,
        projectPath: z.string(),
      }),
      z.object({ success: z.literal(false), error: z.string() }),
    ]),
  },
  sendMessage: {
    input: z.object({
      minionId: z.string(),
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
        minionId: z.string(),
        toolCallId: z.string(),
        answers: z.record(z.string(), z.string()),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  answerDelegatedToolCall: {
    input: z
      .object({
        minionId: z.string(),
        toolCallId: z.string(),
        result: z.unknown(),
      })
      .strict(),
    output: ResultSchema(z.void(), z.string()),
  },
  resumeStream: {
    input: z.object({
      minionId: z.string(),
      options: SendMessageOptionsSchema,
    }),
    output: ResultSchema(
      z.object({
        started: z.boolean(),
      }),
      SendMessageErrorSchema
    ),
  },
  setAutoRetryEnabled: {
    input: z.object({
      minionId: z.string(),
      enabled: z.boolean(),
      // Runtime-only toggle for temporary retry flows (do not mutate persisted preference).
      persist: z.boolean().nullish(),
    }),
    output: ResultSchema(
      z.object({
        previousEnabled: z.boolean(),
        enabled: z.boolean(),
      }),
      z.string()
    ),
  },
  getStartupAutoRetryModel: {
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(z.string().nullable(), z.string()),
  },
  setAutoCompactionThreshold: {
    input: z.object({
      minionId: z.string(),
      threshold: z.number().finite().min(0.1).max(1.0),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  interruptStream: {
    input: z.object({
      minionId: z.string(),
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
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  truncateHistory: {
    input: z.object({
      minionId: z.string(),
      percentage: z.number().optional(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  replaceChatHistory: {
    input: z.object({
      minionId: z.string(),
      summaryMessage: LatticeMessageSchema,
      /**
       * Replace strategy.
       * - destructive (default): clear history, then append summary
       * - append-compaction-boundary: keep history and append summary as durable boundary
       */
      mode: z.enum(["destructive", "append-compaction-boundary"]).nullish(),
      /** When true, delete the plan file (new + legacy paths) and clear plan tracking state. */
      deletePlanFile: z.boolean().optional(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  getDevcontainerInfo: {
    input: z.object({ minionId: z.string() }),
    output: z
      .object({
        containerName: z.string(),
        containerMinionPath: z.string(),
        hostMinionPath: z.string(),
      })
      .nullable(),
  },
  getInfo: {
    input: z.object({ minionId: z.string() }),
    output: FrontendMinionMetadataSchema.nullable(),
  },
  getLastLlmRequest: {
    input: z.object({ minionId: z.string() }),
    output: ResultSchema(DebugLlmRequestSnapshotSchema.nullable(), z.string()),
  },
  getFullReplay: {
    input: z.object({ minionId: z.string() }),
    output: z.array(MinionChatMessageSchema),
  },
  history: {
    loadMore: {
      input: z.object({
        minionId: z.string(),
        cursor: z
          .object({
            beforeHistorySequence: z.number(),
            beforeMessageId: z.string().nullish(),
          })
          .nullish(),
      }),
      output: z.object({
        messages: z.array(MinionChatMessageSchema),
        nextCursor: z
          .object({
            beforeHistorySequence: z.number(),
            beforeMessageId: z.string().nullish(),
          })
          .nullable(),
        hasOlder: z.boolean(),
      }),
    },
  },
  /**
   * Load an archived sidekick transcript (chat.jsonl + optional partial.json) from this minion's
   * session dir.
   */
  getSidekickTranscript: {
    input: z.object({
      /** Minion that owns the transcript artifact index (usually the current minion). */
      minionId: z.string().optional(),
      /** Child task/minion id whose transcript should be loaded. */
      taskId: z.string(),
    }),
    output: z.object({
      messages: z.array(LatticeMessageSchema),
      /** Task-level model string used when running the sidekick (optional for legacy entries). */
      model: z.string().optional(),
      /** Task-level thinking/reasoning level used when running the sidekick (optional for legacy entries). */
      thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional(),
    }),
  },
  executeBash: {
    input: z.object({
      minionId: z.string(),
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
        minionId: z.string(),
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      })
      .strict(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  // Subscriptions
  onChat: {
    input: z.object({
      minionId: z.string(),
      mode: OnChatModeSchema.optional(),
      // One-shot migration hint: legacy renderer localStorage opt-out value.
      // Used only when backend auto-retry preference file is missing.
      legacyAutoRetryEnabled: z.boolean().optional(),
    }),
    output: eventIterator(MinionChatMessageSchema), // Stream event
  },
  onMetadata: {
    input: z.void(),
    output: eventIterator(
      z.object({
        minionId: z.string(),
        metadata: FrontendMinionMetadataSchema.nullable(),
      })
    ),
  },
  activity: {
    list: {
      input: z.void(),
      output: z.record(z.string(), MinionActivitySnapshotSchema),
    },
    subscribe: {
      input: z.void(),
      output: eventIterator(
        z.object({
          minionId: z.string(),
          activity: MinionActivitySnapshotSchema.nullable(),
        })
      ),
    },
  },
  /**
   * Get the current plan file content for a minion.
   * Used by UI to refresh plan display when file is edited externally.
   */
  getPlanContent: {
    input: z.object({ minionId: z.string() }),
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
     * Subscribe to background bash state changes for a minion.
     * Emits full state on connect, then incremental updates.
     */
    subscribe: {
      input: z.object({ minionId: z.string() }),
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
      input: z.object({ minionId: z.string(), processId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
    /**
     * Send a foreground bash process to background.
     * The process continues running but the agent stops waiting for it.
     */
    sendToBackground: {
      input: z.object({ minionId: z.string(), toolCallId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
    /**
     * Peek output for a background bash process without consuming the bash_output cursor.
     */
    getOutput: {
      input: z.object({
        minionId: z.string(),
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
   * Get post-compaction context state for a minion.
   * Returns plan path (if exists) and tracked file paths that will be injected.
   */
  getPostCompactionState: {
    input: z.object({ minionId: z.string() }),
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
      minionId: z.string(),
      itemId: z.string(),
      excluded: z.boolean(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  stats: {
    subscribe: {
      input: z.object({ minionId: z.string() }),
      output: eventIterator(MinionStatsSnapshotSchema),
    },
    clear: {
      input: z.object({ minionId: z.string() }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
  getSessionUsage: {
    input: z.object({ minionId: z.string() }),
    output: SessionUsageFileSchema.optional(),
  },
  /** Batch fetch session usage for multiple minions (for archived minions cost display) */
  getSessionUsageBatch: {
    input: z.object({ minionIds: z.array(z.string()) }),
    output: z.record(z.string(), SessionUsageFileSchema.optional()),
  },
  /** Per-minion MCP configuration (overrides project-level mcp.jsonc) */
  mcp: {
    get: {
      input: z.object({ minionId: z.string() }),
      output: MinionMCPOverridesSchema,
    },
    set: {
      input: z.object({
        minionId: z.string(),
        overrides: MinionMCPOverridesSchema,
      }),
      output: ResultSchema(z.void(), z.string()),
    },
  },
};

export type MinionSendMessageOutput = z.infer<typeof minion.sendMessage.output>;

// Tasks (agent sub-minions)
export const tasks = {
  create: {
    input: z
      .object({
        parentMinionId: z.string(),
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

// Agent definitions (unifies UI modes + sidekicks)
// Agents can be discovered from either the PROJECT path or the MINION path.
// - Project path: <projectPath>/.lattice/agents - shared across all minions
// - Minion path: <worktree>/.lattice/agents - minion-specific (useful for iterating)
// Default is minion path when minionId is provided.
// Use disableMinionAgents in SendMessageOptions to skip minion agents during message sending.

// At least one of projectPath or minionId must be provided for agent discovery.
// Agent discovery input supports:
// - minionId only: resolve projectPath from minion metadata, discover from worktree
// - projectPath only: discover from project path (project page, no minion yet)
// - both: discover from worktree using minionId
// - disableMinionAgents: when true with minionId, use minion's runtime but discover
//   from projectPath instead of worktree (useful for SSH minions when iterating on agents)
const AgentDiscoveryInputSchema = z
  .object({
    projectPath: z.string().optional(),
    minionId: z.string().optional(),
    /** When true, skip minion worktree and discover from projectPath (but still use minion runtime) */
    disableMinionAgents: z.boolean().optional(),
    /** When true, include agents disabled by front-matter (for Settings UI). */
    includeDisabled: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.projectPath ?? data.minionId), {
    message: "Either projectPath or minionId must be provided",
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
  listDiagnostics: {
    input: AgentDiscoveryInputSchema,
    output: z.object({
      skills: z.array(AgentSkillDescriptorSchema),
      invalidSkills: z.array(AgentSkillIssueSchema),
    }),
  },
  get: {
    input: AgentDiscoveryInputSchema.and(z.object({ skillName: SkillNameSchema })),
    output: AgentSkillPackageSchema,
  },
};

// Name generation for new minions (decoupled from minion creation)
export const nameGeneration = {
  generate: {
    input: z.object({
      message: z.string(),
      /** Ordered list of model candidates to try */
      candidates: z.array(z.string()),
    }),
    output: ResultSchema(
      z.object({
        /** Short git-safe name with suffix (e.g., "plan-a1b2") */
        name: z.string(),
        /** Human-readable title (e.g., "Fix plan mode over SSH") */
        title: z.string(),
        modelUsed: z.string(),
      }),
      NameGenerationErrorSchema
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
      minionId: z.string(),
      /** Optional session ID to reattach to an existing terminal session (for pop-out handoff) */
      sessionId: z.string().optional(),
    }),
    output: z.void(),
  },
  closeWindow: {
    input: z.object({ minionId: z.string() }),
    output: z.void(),
  },
  /**
   * Subscribe to terminal activity changes across all minions.
   * First event is a snapshot of all minion aggregates.
   * Subsequent events are per-minion updates.
   */
  activity: {
    subscribe: {
      input: z.void(),
      output: eventIterator(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("snapshot"),
            minions: z.record(
              z.string(),
              z.object({
                activeCount: z.number(),
                totalSessions: z.number(),
              })
            ),
          }),
          z.object({
            type: z.literal("update"),
            minionId: z.string(),
            activity: z.object({
              activeCount: z.number(),
              totalSessions: z.number(),
            }),
          }),
        ])
      ),
    },
  },
  /**
   * List active terminal sessions for a minion.
   * Used by frontend to discover existing sessions to reattach to after reload.
   * Returns session IDs with optional profile metadata so the frontend can seed
   * tab titles for profile-based terminals (e.g. "Google Gemini" instead of "Terminal 2").
   */
  listSessions: {
    input: z.object({ minionId: z.string() }),
    output: z.array(
      z.object({
        sessionId: z.string(),
        /** Profile ID used to create this session (e.g. "gemini-cli", "claude-code"). */
        profileId: z.string().nullish(),
      })
    ),
  },
  /**
   * Open the native system terminal for a minion.
   * Opens the user's preferred terminal emulator (Ghostty, Terminal.app, etc.)
   * with the working directory set to the minion path.
   */
  openNative: {
    input: z.object({ minionId: z.string() }),
    output: z.void(),
  },
};

// Browser — Per-minion headless browser sessions via agent-browser

export const browser = {
  navigate: {
    input: z.object({ minionId: z.string(), url: z.string() }),
    output: BrowserActionResultSchema,
  },
  snapshot: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  screenshot: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  click: {
    input: z.object({ minionId: z.string(), ref: z.string() }),
    output: BrowserActionResultSchema,
  },
  fill: {
    input: z.object({ minionId: z.string(), ref: z.string(), value: z.string() }),
    output: BrowserActionResultSchema,
  },
  type: {
    input: z.object({ minionId: z.string(), text: z.string() }),
    output: BrowserActionResultSchema,
  },
  scrollUp: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  scrollDown: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  back: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  forward: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },
  close: {
    input: z.object({ minionId: z.string() }),
    output: z.void(),
  },
  sessionInfo: {
    input: z.object({ minionId: z.string() }),
    output: BrowserSessionInfoSchema.nullable(),
  },

  // ── Phase 3: Full feature set from agent-browser ──

  /** Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.). */
  press: {
    input: z.object({ minionId: z.string(), key: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Hover over an element by snapshot ref. */
  hover: {
    input: z.object({ minionId: z.string(), ref: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Semantic locator search — find element by role/label/text and perform action. */
  find: {
    input: z.object({
      minionId: z.string(),
      locator: z.string().describe("Locator type: role, text, label, placeholder, testid"),
      value: z.string().describe("Value to match"),
      action: z.string().optional().describe("Action to perform: click, fill, check, etc."),
      actionValue: z.string().optional().describe("Value for action (e.g., text to fill)"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Wait for a condition: selector visible, text appears, URL matches, or fixed time. */
  wait: {
    input: z.object({
      minionId: z.string(),
      target: z.string().describe("What to wait for: CSS selector, text, URL pattern, or time in ms"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Take an annotated screenshot with numbered labels on interactive elements. */
  annotatedScreenshot: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Execute JavaScript on the page and return the result. */
  eval: {
    input: z.object({
      minionId: z.string(),
      js: z.string().describe("JavaScript expression to evaluate in page context"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Set the browser viewport dimensions. */
  setViewport: {
    input: z.object({
      minionId: z.string(),
      width: z.number(),
      height: z.number(),
    }),
    output: BrowserActionResultSchema,
  },

  /** Emulate a device (iPhone 14, iPad, Pixel 7, etc.). */
  setDevice: {
    input: z.object({
      minionId: z.string(),
      device: z.string().describe("Device name, e.g. 'iPhone 14', 'iPad Pro', 'Pixel 7'"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Tab management: list, create, switch, close tabs. */
  tabs: {
    input: z.object({
      minionId: z.string(),
      action: z.enum(["list", "new", "switch", "close"]).default("list"),
      target: z.string().optional().describe("Tab index or URL for switch/new"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Handle browser dialogs (alert, confirm, prompt, beforeunload). */
  dialog: {
    input: z.object({
      minionId: z.string(),
      action: z.enum(["accept", "dismiss"]),
      promptText: z.string().optional().describe("Text to enter for prompt dialogs"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Cookie management: list, set, clear cookies. */
  cookies: {
    input: z.object({
      minionId: z.string(),
      action: z.enum(["list", "set", "clear"]).default("list"),
      name: z.string().optional(),
      value: z.string().optional(),
      domain: z.string().optional(),
    }),
    output: BrowserActionResultSchema,
  },

  /** View tracked network requests. */
  networkRequests: {
    input: z.object({
      minionId: z.string(),
      filter: z.string().optional().describe("URL pattern to filter requests"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Drag and drop from one element to another. */
  drag: {
    input: z.object({
      minionId: z.string(),
      sourceRef: z.string().describe("Source element ref"),
      targetRef: z.string().describe("Target element ref"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Select an option from a <select> dropdown. */
  selectOption: {
    input: z.object({
      minionId: z.string(),
      ref: z.string().describe("Select element ref"),
      value: z.string().describe("Option value or label to select"),
    }),
    output: BrowserActionResultSchema,
  },

  // ── Phase 4: Full-strength agent-browser ──

  /** Save session state (cookies, localStorage, sessionStorage) to file with optional encryption. */
  saveState: {
    input: z.object({
      minionId: z.string(),
      path: z.string().optional().describe("File path to save state to"),
      encrypt: z.boolean().optional().describe("Encrypt with AES-256-GCM"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Restore session state from a previously saved file. */
  restoreState: {
    input: z.object({
      minionId: z.string(),
      path: z.string().optional().describe("File path to restore state from"),
    }),
    output: BrowserActionResultSchema,
  },

  /** localStorage/sessionStorage operations. */
  storage: {
    input: z.object({
      minionId: z.string(),
      storageType: z.enum(["local", "session"]).describe("Storage type"),
      action: z.enum(["get", "set", "remove", "clear", "keys"]).describe("Storage operation"),
      key: z.string().optional().describe("Storage key"),
      value: z.string().optional().describe("Value to set"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Compare current snapshot with previous to detect page changes. */
  snapshotDiff: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Compare current screenshot with previous visually. */
  screenshotDiff: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Take a screenshot of a specific element by ref. */
  screenshotElement: {
    input: z.object({
      minionId: z.string(),
      ref: z.string().describe("Element ref to screenshot"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Print current page to PDF. */
  pdf: {
    input: z.object({
      minionId: z.string(),
      landscape: z.boolean().optional().describe("Landscape orientation"),
      format: z.string().optional().describe("Page format: A4, Letter, Legal, etc."),
    }),
    output: BrowserActionResultSchema,
  },

  /** Get browser console logs. */
  consoleLogs: {
    input: z.object({
      minionId: z.string(),
      level: z.string().optional().describe("Filter by level: log, warn, error, info"),
      clear: z.boolean().optional().describe("Clear logs after reading"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Set geolocation for the browser session. */
  setGeolocation: {
    input: z.object({
      minionId: z.string(),
      latitude: z.number().describe("Latitude (-90 to 90)"),
      longitude: z.number().describe("Longitude (-180 to 180)"),
      accuracy: z.number().optional().describe("Accuracy in meters"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Set browser permissions. */
  setPermissions: {
    input: z.object({
      minionId: z.string(),
      permission: z.string().describe("Permission name: geolocation, notifications, camera, microphone, etc."),
      state: z.enum(["grant", "deny", "prompt"]).describe("Permission state"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Toggle offline mode (network emulation). */
  setOffline: {
    input: z.object({
      minionId: z.string(),
      offline: z.boolean().describe("Whether to enable offline mode"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Set custom HTTP headers for all requests. */
  setHeaders: {
    input: z.object({
      minionId: z.string(),
      headers: z.record(z.string(), z.string()).describe("Header name-value pairs"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Intercept network requests matching a URL pattern. */
  interceptNetwork: {
    input: z.object({
      minionId: z.string(),
      pattern: z.string().describe("URL pattern to intercept"),
      action: z.enum(["block", "modify", "log"]).describe("What to do with matched requests"),
      modifyResponse: z.string().optional().describe("JSON response body for modify action"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Start recording the browser session. */
  startRecording: {
    input: z.object({
      minionId: z.string(),
      outputPath: z.string().optional().describe("Path to save recording"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Stop recording the browser session. */
  stopRecording: {
    input: z.object({ minionId: z.string() }),
    output: BrowserActionResultSchema,
  },

  /** Connect to a cloud browser provider. */
  connectProvider: {
    input: z.object({
      minionId: z.string(),
      provider: BrowserProviderConfigSchema,
    }),
    output: BrowserActionResultSchema,
  },

  /** List all active browser sessions. */
  listSessions: {
    input: z.object({}),
    output: z.array(BrowserSessionInfoSchema),
  },

  /** Configure session-specific settings. */
  configureSession: {
    input: z.object({
      minionId: z.string(),
      config: BrowserSessionConfigSchema,
    }),
    output: BrowserActionResultSchema,
  },

  /** Delete specific cookies by name. */
  deleteCookies: {
    input: z.object({
      minionId: z.string(),
      name: z.string().describe("Cookie name to delete"),
      domain: z.string().optional().describe("Cookie domain"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Scroll to a specific element by ref. */
  scrollToElement: {
    input: z.object({
      minionId: z.string(),
      ref: z.string().describe("Element ref to scroll to"),
    }),
    output: BrowserActionResultSchema,
  },

  /** Scroll by a specific pixel amount in any direction. */
  scrollByPixels: {
    input: z.object({
      minionId: z.string(),
      direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
      pixels: z.number().describe("Number of pixels to scroll"),
    }),
    output: BrowserActionResultSchema,
  },
};

// Terminal Profiles — CLI tool detection, install recipes, user config

const ProfileDetectionStatusSchema = z.object({
  installed: z.boolean(),
  commandPath: z.string().optional(),
  version: z.string().optional(),
});

const InstallRecipeSchema = z.object({
  method: z.enum(["npm", "pip", "brew", "curl", "gh-extension"]),
  command: z.string(),
  requiresSudo: z.boolean().optional(),
});

const TerminalProfileConfigSchema = z.object({
  enabled: z.boolean(),
  commandOverride: z.string().optional(),
  argsOverride: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const TerminalProfileWithStatusSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  command: z.string(),
  defaultArgs: z.array(z.string()).optional(),
  description: z.string(),
  category: z.enum(["ai-agent", "shell", "tool"]),
  group: z.enum(["platform", "community"]),
  detection: ProfileDetectionStatusSchema,
  config: TerminalProfileConfigSchema,
  installRecipes: z.array(InstallRecipeSchema).optional(),
  isCustom: z.boolean().optional(),
});

export const terminalProfiles = {
  /** List all known profiles with their detection status and user config */
  list: {
    input: z.void(),
    output: z.array(TerminalProfileWithStatusSchema),
  },
  /** Update user config for a single profile (enable/disable, overrides) */
  setConfig: {
    input: z.object({
      profileId: z.string(),
      config: TerminalProfileConfigSchema,
    }),
    output: z.void(),
  },
  /** Get install recipe for a profile on the current runtime */
  getInstallRecipe: {
    input: z.object({
      profileId: z.string(),
      runtimeType: z.enum(["local", "worktree", "ssh", "docker", "devcontainer"]),
    }),
    output: z.array(InstallRecipeSchema),
  },
};

// Kanban — terminal session lifecycle tracking board

export const kanban = {
  /** Get all kanban cards for a minion (excludes screenBuffer) */
  list: {
    input: KanbanListInputSchema,
    output: z.array(KanbanCardSchema),
  },
  /** Move a card to a different column (user drag-drop) */
  moveCard: {
    input: KanbanMoveCardInputSchema,
    output: z.void(),
  },
  /** Subscribe to kanban state changes for a minion (live updates) */
  subscribe: {
    input: KanbanSubscribeInputSchema,
    output: eventIterator(z.array(KanbanCardSchema)),
  },
  /** Get the archived screen buffer for a specific session */
  getArchivedBuffer: {
    input: KanbanGetArchivedBufferInputSchema,
    output: KanbanArchivedBufferOutputSchema,
  },
};

// Reflections — episodic memory from circuit breaker reflections

import { ReflectionSchema } from "./reflexion";

export const reflections = {
  /** List all reflections for a minion */
  list: {
    input: z.object({ minionId: z.string() }),
    output: z.array(ReflectionSchema),
  },
  /** Toggle a reflection's resolved state */
  resolve: {
    input: z.object({
      minionId: z.string(),
      reflectionId: z.string(),
      resolved: z.boolean(),
    }),
    output: z.void(),
  },
  /** Clear all reflections for a minion */
  clear: {
    input: z.object({ minionId: z.string() }),
    output: z.void(),
  },
};

// Inbox — channel adapters (Telegram, Slack, etc.)

export const inbox = {
  /** List inbox conversations (excludes messages to keep payloads small) */
  list: {
    input: InboxListInputSchema,
    output: z.array(InboxConversationSummarySchema),
  },
  /** Get a full conversation including messages */
  getConversation: {
    input: InboxGetConversationInputSchema,
    output: InboxConversationSchema,
  },
  /** Update conversation status (mark read, archive, etc.) */
  updateStatus: {
    input: InboxUpdateStatusInputSchema,
    output: z.void(),
  },
  /** Send a manual reply through the channel adapter */
  sendReply: {
    input: InboxSendReplyInputSchema,
    output: z.void(),
  },
  /** Subscribe to inbox state changes for a project (live updates) */
  subscribe: {
    input: InboxSubscribeInputSchema,
    output: eventIterator(z.array(InboxConversationSummarySchema)),
  },
  /** Get the current adapter connection status */
  connectionStatus: {
    input: z.void(),
    output: InboxConnectionStatusSchema,
  },
  /** Connect a single adapter at runtime (e.g., after saving a token) */
  connectAdapter: {
    input: InboxConnectAdapterInputSchema,
    output: z.void(),
  },
  /** Disconnect a single adapter at runtime */
  disconnectAdapter: {
    input: InboxDisconnectAdapterInputSchema,
    output: z.void(),
  },
  /** Set or clear a channel bot token. Persists to config and registers/unregisters adapter. */
  setChannelToken: {
    input: InboxSetChannelTokenInputSchema,
    output: z.void(),
  },
  /** Get masked token status for all supported channels. */
  getChannelTokens: {
    input: z.void(),
    output: z.array(InboxChannelTokenStatusSchema),
  },
};

// Inference — exo distributed inference cluster

export const inference = {
  /** Get current exo cluster status (detect + fetch state) */
  getStatus: {
    input: z.void(),
    output: ExoStatusSchema,
  },
  /** Subscribe to exo cluster state changes (live polling updates) */
  subscribe: {
    input: z.void(),
    output: eventIterator(ExoStatusSchema),
  },
};

// Lattice Inference Cluster — latticeinference as alternate clustering provider

export const latticeInferenceCluster = {
  /** Get current latticeinference cluster status (detect + fetch state) */
  getStatus: {
    input: z.void(),
    output: LatticeInferenceClusterStatusSchema,
  },
  /** Subscribe to latticeinference cluster state changes (live polling updates) */
  subscribe: {
    input: z.void(),
    output: eventIterator(LatticeInferenceClusterStatusSchema),
  },
};

// Lattice Inference — local on-device LLM inference engine

export const latticeInference = {
  /** Get overall inference engine status + loaded/cached models */
  getStatus: {
    input: z.void(),
    output: LatticeInferenceStatusSchema,
  },
  /** List cached models */
  listModels: {
    input: z.void(),
    output: z.array(LatticeModelInfoSchema),
  },
  /** Pull (download) a model from HuggingFace */
  pullModel: {
    input: PullModelInputSchema,
    output: z.object({ modelDir: z.string() }),
  },
  /** Delete a cached model */
  deleteModel: {
    input: DeleteModelInputSchema,
    output: z.void(),
  },
  /** Load a model into the worker pool */
  loadModel: {
    input: LoadModelInputSchema,
    output: z.void(),
  },
  /** Unload a model from the worker pool */
  unloadModel: {
    input: UnloadModelInputSchema,
    output: z.void(),
  },
  /** Get cluster status */
  getClusterStatus: {
    input: z.void(),
    output: ClusterStateSchema.nullable(),
  },
  /** Get cluster nodes */
  getClusterNodes: {
    input: z.void(),
    output: z.array(ClusterNodeSchema),
  },
  /** Get Prometheus metrics */
  getMetrics: {
    input: z.void(),
    output: z.string(),
  },
  /** Run inference benchmark */
  runBenchmark: {
    input: BenchmarkInputSchema,
    output: BenchmarkResultSchema,
  },
  /** Subscribe to download progress events */
  onDownloadProgress: {
    input: z.void(),
    output: eventIterator(DownloadProgressSchema),
  },
  /** Get inference engine config (model dir, polling interval) */
  getInferenceConfig: {
    input: z.void(),
    output: z.object({
      modelDir: z.string(),
      pollIntervalMs: z.number(),
      availableStoragePaths: z.array(z.object({
        path: z.string(),
        label: z.string(),
        type: z.enum(["local", "nas", "external"]),
        available: z.boolean(),
        freeSpaceBytes: z.number(),
      })),
    }),
  },
  /** Update inference engine config */
  setInferenceConfig: {
    input: z.object({
      modelDir: z.string().optional(),
      pollIntervalMs: z.number().optional(),
    }),
    output: z.void(),
  },
};

export const inferenceSetup = {
  /** Check Python/venv/deps setup status */
  checkStatus: {
    input: z.void(),
    output: InferenceSetupStatusSchema,
  },
  /** Run the full setup wizard (streaming) */
  runSetup: {
    input: z.void(),
    output: eventIterator(SetupStreamEventSchema),
  },
};

// Scheduler — cron/interval job scheduling for automated agent tasks

export const scheduler = {
  /** List all scheduled jobs for a project. */
  list: {
    input: SchedulerListInputSchema,
    output: z.array(ScheduledJobWithStateSchema),
  },
  /** Create a new scheduled job. */
  create: {
    input: SchedulerCreateInputSchema,
    output: ScheduledJobWithStateSchema,
  },
  /** Update an existing scheduled job. */
  update: {
    input: SchedulerUpdateInputSchema,
    output: ScheduledJobWithStateSchema,
  },
  /** Remove a scheduled job. */
  remove: {
    input: SchedulerRemoveInputSchema,
    output: z.object({ ok: z.boolean() }),
  },
  /** Manually trigger a job run ("Run Now"). */
  run: {
    input: SchedulerRunInputSchema,
    output: z.object({ ok: z.boolean(), sessionId: z.string().nullish() }),
  },
  /** Get run history for a specific job. */
  history: {
    input: SchedulerHistoryInputSchema,
    output: z.array(ScheduledJobRunSchema),
  },
  /** Subscribe to scheduler state changes (live updates for all jobs in a project). */
  subscribe: {
    input: SchedulerSubscribeInputSchema,
    output: eventIterator(z.array(ScheduledJobWithStateSchema)),
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

export const ServerAuthSessionSchema = z.object({
  id: z.string(),
  label: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  lastUsedAtMs: z.number().int().nonnegative(),
  isCurrent: z.boolean(),
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

export const serverAuth = {
  listSessions: {
    input: z.void(),
    output: z.array(ServerAuthSessionSchema),
  },
  revokeSession: {
    input: z.object({ sessionId: z.string() }).strict(),
    output: z.object({ removed: z.boolean() }),
  },
  revokeOtherSessions: {
    input: z.void(),
    output: z.object({ revokedCount: z.number().int().nonnegative() }),
  },
};

// Config (global settings)
const SidekickAiDefaultsEntrySchema = z
  .object({
    modelString: z.string().min(1).optional(),
    thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const AgentAiDefaultsSchema = z.record(z.string().min(1), SidekickAiDefaultsEntrySchema);
const SidekickAiDefaultsSchema = z.record(z.string().min(1), SidekickAiDefaultsEntrySchema);

export const config = {
  getConfig: {
    input: z.void(),
    output: z.object({
      taskSettings: z.object({
        maxParallelAgentTasks: z.number().int(),
        maxTaskNestingDepth: z.number().int(),
        proposePlanImplementReplacesChatHistory: z.boolean().optional(),
        planSidekickExecutorRouting: z.enum(["exec", "orchestrator", "auto"]).optional(),
        planSidekickDefaultsToOrchestrator: z.boolean().optional(),
        bashOutputCompactionMinLines: z.number().int().optional(),
        bashOutputCompactionMinTotalBytes: z.number().int().optional(),
        bashOutputCompactionMaxKeptLines: z.number().int().optional(),
        bashOutputCompactionTimeoutMs: z.number().int().optional(),
        bashOutputCompactionHeuristicFallback: z.boolean().optional(),
      }),
      defaultModel: z.string().optional(),
      hiddenModels: z.array(z.string()).optional(),
      preferredCompactionModel: z.string().optional(),
      stopLatticeMinionOnArchive: z.boolean(),
      runtimeEnablement: z.record(z.string(), z.boolean()),
      defaultRuntime: z.string().nullable(),
      agentAiDefaults: AgentAiDefaultsSchema,
      // Legacy fields (downgrade compatibility)
      sidekickAiDefaults: SidekickAiDefaultsSchema,
      // Lattice Governor enrollment status (safe fields only - token never exposed)
      latticeGovernorUrl: z.string().nullable(),
      latticeGovernorEnrolled: z.boolean(),
    }),
  },
  saveConfig: {
    input: z.object({
      taskSettings: z.object({
        maxParallelAgentTasks: z.number().int(),
        maxTaskNestingDepth: z.number().int(),
        proposePlanImplementReplacesChatHistory: z.boolean().optional(),
        planSidekickExecutorRouting: z.enum(["exec", "orchestrator", "auto"]).optional(),
        planSidekickDefaultsToOrchestrator: z.boolean().optional(),
        bashOutputCompactionMinLines: z.number().int().optional(),
        bashOutputCompactionMinTotalBytes: z.number().int().optional(),
        bashOutputCompactionMaxKeptLines: z.number().int().optional(),
        bashOutputCompactionTimeoutMs: z.number().int().optional(),
        bashOutputCompactionHeuristicFallback: z.boolean().optional(),
      }),
      agentAiDefaults: AgentAiDefaultsSchema.optional(),
      // Legacy field (downgrade compatibility)
      sidekickAiDefaults: SidekickAiDefaultsSchema.optional(),
    }),
    output: z.void(),
  },
  updateAgentAiDefaults: {
    input: z.object({
      agentAiDefaults: AgentAiDefaultsSchema,
    }),
    output: z.void(),
  },
  updateModelPreferences: {
    input: z.object({
      defaultModel: z.string().optional(),
      hiddenModels: z.array(z.string()).optional(),
      preferredCompactionModel: z.string().optional(),
    }),
    output: z.void(),
  },
  updateLatticePrefs: {
    input: z
      .object({
        stopLatticeMinionOnArchive: z.boolean(),
      })
      .strict(),
    output: z.void(),
  },
  updateRuntimeEnablement: {
    input: z
      .object({
        projectPath: z.string().nullish(),
        runtimeEnablement: z.record(z.string(), z.boolean()).nullish(),
        defaultRuntime: RuntimeEnablementIdSchema.nullish(),
        runtimeOverridesEnabled: z.boolean().nullish(),
      })
      .strict(),
    output: z.void(),
  },
  unenrollLatticeGovernor: {
    input: z.void(),
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
export const UpdateChannelSchema = z.enum(["stable", "nightly"]);

export const update = {
  check: {
    input: z.object({ source: z.enum(["auto", "manual"]).optional() }).optional(),
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
  getChannel: {
    input: z.void(),
    output: UpdateChannelSchema,
  },
  setChannel: {
    input: z.object({ channel: UpdateChannelSchema }),
    output: z.void(),
  },
};

// Editor config schema for openMinionInEditor
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
   * For SSH minions with useRemoteExtension enabled, uses Remote-SSH extension.
   *
   * @param minionId - The minion (used to determine if SSH and get remote host)
   * @param targetPath - The path to open (minion directory or specific file)
   * @param editorConfig - Editor configuration from user settings
   */
  openInEditor: {
    input: z.object({
      minionId: z.string(),
      targetPath: z.string(),
      editorConfig: EditorConfigSchema,
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  getLogPath: {
    input: z.void(),
    output: z.object({ path: z.string() }),
  },
  clearLogs: {
    input: z.void(),
    output: z.object({
      success: z.boolean(),
      error: z.string().nullish(),
    }),
  },
  subscribeLogs: {
    input: z.object({
      level: z.enum(["error", "warn", "info", "debug"]).nullish(),
    }),
    output: eventIterator(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("snapshot"),
          epoch: z.number(),
          entries: z.array(
            z.object({
              timestamp: z.number(),
              level: z.enum(["error", "warn", "info", "debug"]),
              message: z.string(),
              location: z.string(),
            })
          ),
        }),
        z.object({
          type: z.literal("append"),
          epoch: z.number(),
          entries: z.array(
            z.object({
              timestamp: z.number(),
              level: z.enum(["error", "warn", "info", "debug"]),
              message: z.string(),
              location: z.string(),
            })
          ),
        }),
        z.object({
          type: z.literal("reset"),
          epoch: z.number(),
        }),
      ])
    ),
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

// Debug endpoints (test-only, not for production use)
export const debug = {
  /**
   * Trigger an artificial stream error for testing recovery.
   * Used by integration tests to simulate network errors mid-stream.
   */
  triggerStreamError: {
    input: z.object({
      minionId: z.string(),
      errorMessage: z.string().optional(),
    }),
    output: z.boolean(), // true if error was triggered on an active stream
  },
};

// Sync — GitHub config backup

export const sync = {
  /** Get current sync configuration. */
  getConfig: {
    input: z.void(),
    output: SyncConfigSchema.nullish(),
  },
  /** Save sync configuration (creates/updates repo, starts watcher). */
  saveConfig: {
    input: SyncSaveConfigInputSchema,
    output: SyncSuccessOutputSchema,
  },
  /** Get current sync status. */
  getStatus: {
    input: z.void(),
    output: SyncStatusSchema,
  },
  /** Trigger a manual push (sync to GitHub). */
  push: {
    input: z.void(),
    output: SyncStatusSchema,
  },
  /** Trigger a manual pull (restore from GitHub). */
  pull: {
    input: z.void(),
    output: SyncStatusSchema,
  },
  /** Remove sync configuration and stop watchers. */
  disconnect: {
    input: z.void(),
    output: SyncSuccessOutputSchema,
  },
  /** Subscribe to sync status changes. */
  subscribe: {
    input: z.void(),
    output: eventIterator(SyncStatusSchema),
  },
  /** Check if GitHub CLI is authenticated. */
  checkGhAuth: {
    input: z.void(),
    output: SyncGhAuthOutputSchema,
  },
  /** List the user's GitHub repos (via `gh` CLI). */
  listRepos: {
    input: z.void(),
    output: z.array(SyncGhRepoSchema),
  },
  /** Create a new private GitHub repo for sync backup. */
  createRepo: {
    input: SyncCreateRepoInputSchema,
    output: SyncCreateRepoOutputSchema,
  },
};

export const ssh = {
  prompt: {
    subscribe: {
      input: z.void(),
      output: eventIterator(SshPromptEventSchema),
    },
    respond: {
      input: SshPromptResponseInputSchema,
      output: ResultSchema(z.void(), z.string()),
    },
  },
};

// OpenBB — embedded financial data platform

export const OpenBBStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_installed") }),
  z.object({
    status: z.literal("installed_not_running"),
    bootstrapped: z.boolean(),
    platformRoot: z.string(),
  }),
  z.object({ status: z.literal("starting") }),
  z.object({
    status: z.literal("running"),
    port: z.number(),
    baseUrl: z.string(),
    endpointCount: z.number(),
  }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const openbb = {
  /** Get current OpenBB service status (detect + fetch state) */
  getStatus: {
    input: z.void(),
    output: OpenBBStatusSchema,
  },
  /** Subscribe to OpenBB state changes (live polling updates) */
  subscribe: {
    input: z.void(),
    output: eventIterator(OpenBBStatusSchema),
  },
  /** Bootstrap the OpenBB Python venv (first-time setup) */
  bootstrap: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Start the OpenBB API server */
  start: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Stop the OpenBB API server */
  stop: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
};

// ---------------------------------------------------------------------------
// Simulation — multi-agent prediction engine
// ---------------------------------------------------------------------------

export const SimulationStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_configured") }),
  z.object({ status: z.literal("initializing") }),
  z.object({
    status: z.literal("ready"),
    graphDbConnected: z.boolean(),
    activeSimulations: z.number(),
  }),
  z.object({
    status: z.literal("running"),
    simulationId: z.string(),
    progress: z.number(),
  }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);

export const SimulationScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["created", "building_graph", "generating_ontology", "generating_profiles", "ready", "running", "completed", "failed"]),
  createdAt: z.string(),
  totalRounds: z.number().optional(),
  platforms: z.array(z.string()).optional(),
  agentCount: z.number().optional(),
});

export const SimulationRoundResultSchema = z.object({
  round: z.number(),
  simulatedHour: z.number(),
  activeAgentCount: z.number().optional(),
  actions: z.array(z.object({
    agentId: z.string(),
    round: z.number().optional(),
    agentName: z.string(),
    actionType: z.string(),
    content: z.string().optional(),
    target: z.string().optional(),
    targetId: z.string().optional(),
    platform: z.string().optional(),
    thinking: z.string().optional(),
    timestamp: z.string().optional(),
    success: z.boolean().optional(),
  })),
  sentimentDistribution: z.object({
    positive: z.number(),
    neutral: z.number(),
    negative: z.number(),
  }),
  viralPosts: z.array(z.object({
    id: z.string(),
    content: z.string(),
    votes: z.number(),
    authorId: z.string().optional(),
    authorName: z.string().optional(),
    isViral: z.boolean().optional(),
  })),
  trending: z.array(z.string()).optional(),
  platformSnapshot: z.object({
    totalPosts: z.number(),
    totalComments: z.number(),
    totalVotes: z.number().optional(),
    activeAgents: z.number(),
    topPosts: z.array(z.object({
      id: z.string(),
      content: z.string(),
      votes: z.number(),
    })),
  }).optional(),
  /** Population-scale metrics (only when populationScale > 0) */
  populationMetrics: z.object({
    totalPopulation: z.number(),
    realAgentCount: z.number(),
    amplifiedActions: z.number(),
    amplifiedEngagement: z.number(),
    populationSentiment: z.object({
      positive: z.number(),
      neutral: z.number(),
      negative: z.number(),
    }),
    tierBreakdown: z.array(z.object({
      tier: z.number(),
      agentCount: z.number(),
      populationRepresented: z.number(),
      amplifiedActions: z.number(),
    })),
  }).optional(),
});

export const CreateScenarioInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  seedDocuments: z.array(z.object({
    filename: z.string(),
    content: z.string(),
  })),
  department: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  rounds: z.number().optional(),
  modelRouting: z.record(z.string(), z.object({
    provider: z.string(),
    model: z.string(),
  })).optional(),
  /** Population scale — configurable target population (e.g., 1_000_000 for 1M simulation) */
  populationScale: z.number().optional(),
  /** When true and seedDocuments have content, extract entities from docs instead of using templates */
  useDocumentDrivenGeneration: z.boolean().optional(),
});

export const SimulationSettingsSchema = z.object({
  modelRouting: z.any(),
  socialDynamics: z.object({
    recommendation: z.object({
      recencyWeight: z.number(),
      popularityWeight: z.number(),
      relevanceWeight: z.number(),
      echoChamberStrength: z.number(),
    }).optional(),
    viral: z.object({
      viralThreshold: z.number(),
      viralBoostMultiplier: z.number(),
      viralDecayRate: z.number(),
    }).optional(),
    activitySchedule: z.object({
      peakMultiplier: z.number(),
      workMultiplier: z.number(),
      morningMultiplier: z.number(),
      nightMultiplier: z.number(),
      deadMultiplier: z.number(),
    }).optional(),
  }).optional(),
  graphDb: z.object({
    host: z.string(),
    port: z.number(),
    protocol: z.string(),
  }).optional(),
  defaultEnsemble: z.object({
    runs: z.number(),
    personalityVariance: z.number(),
    initialConditionVariance: z.number(),
  }).optional(),
  /** Default population scale for new scenarios (0 = disabled) */
  defaultPopulationScale: z.number().optional(),
  /** Agent processing batch size (how many LLM calls in parallel per round) */
  agentBatchSize: z.number().optional(),
  /** Timeout per agent decision in milliseconds */
  agentTimeoutMs: z.number().optional(),
  /** Auto-start FalkorDB on simulation init */
  autoStartGraphDb: z.boolean().optional(),
  accuracyTrackingEnabled: z.boolean().optional(),
});

export const SimulationSetupStatusSchema = z.object({
  llmProviderConfigured: z.boolean(),
  graphDbConfigured: z.boolean(),
  graphDbConnected: z.boolean(),
  graphDbHost: z.string(),
  graphDbPort: z.number(),
  dockerAvailable: z.boolean(),
  falkorDbContainerRunning: z.boolean(),
  ready: z.boolean(),
});

export const simulation = {
  /** Get current simulation service status */
  getStatus: {
    input: z.void(),
    output: SimulationStatusSchema,
  },
  /** Subscribe to simulation state changes */
  subscribe: {
    input: z.void(),
    output: eventIterator(SimulationStatusSchema),
  },
  /** Create a new simulation scenario */
  createScenario: {
    input: CreateScenarioInputSchema,
    output: SimulationScenarioSchema,
  },
  /** List all scenarios */
  listScenarios: {
    input: z.void(),
    output: z.array(SimulationScenarioSchema),
  },
  /** Run a simulation (streaming round results) */
  runSimulation: {
    input: z.object({ scenarioId: z.string() }),
    output: eventIterator(SimulationRoundResultSchema),
  },
  /** Stop a running simulation */
  stopSimulation: {
    input: z.object({ scenarioId: z.string() }),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Get results for a completed simulation */
  getResults: {
    input: z.object({ scenarioId: z.string() }),
    output: z.array(SimulationRoundResultSchema),
  },
  /** Update simulation settings */
  updateSettings: {
    input: SimulationSettingsSchema,
    output: ResultSchema(z.void(), z.string()),
  },
  /** Check setup dependencies */
  checkSetup: {
    input: z.void(),
    output: SimulationSetupStatusSchema,
  },
  /** Start FalkorDB Docker container */
  startFalkorDb: {
    input: z.void(),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Get available models from configured providers (same pool as chat) */
  getAvailableModels: {
    input: z.void(),
    output: z.object({
      models: z.array(z.object({
        id: z.string(),
        provider: z.string(),
        providerDisplayName: z.string(),
        modelId: z.string(),
      })),
      currentRouting: z.record(z.string(), z.object({
        provider: z.string(),
        model: z.string(),
      })),
    }),
  },
  /** Update model routing for a specific route key */
  updateModelRouting: {
    input: z.object({
      routeKey: z.string(),
      provider: z.string(),
      model: z.string(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Get/set environment variables for provider API keys */
  getEnvVars: {
    input: z.void(),
    output: z.array(z.object({
      key: z.string(),
      isSet: z.boolean(),
      provider: z.string().optional(),
    })),
  },
  /** Set an environment variable and restart provider */
  setEnvVar: {
    input: z.object({
      key: z.string(),
      value: z.string(),
    }),
    output: ResultSchema(z.void(), z.string()),
  },
  /** Check Claude Code CLI binary availability and authentication */
  checkClaudeCode: {
    input: z.void(),
    output: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
  },
  /** Generate a report for a completed simulation */
  generateReport: {
    input: z.object({ scenarioId: z.string() }),
    output: z.object({
      status: z.enum(["pending", "planning", "generating", "completed", "failed"]),
      markdownContent: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  /** Chat with a simulated agent post-simulation (MiroFish-style dialogue) */
  chatWithAgent: {
    input: z.object({
      scenarioId: z.string(),
      agentId: z.string(),
      message: z.string(),
    }),
    output: z.object({
      response: z.string(),
      agentName: z.string(),
      agentType: z.string(),
    }),
  },
};
