/**
 * Mock ORPC client factory for Storybook stories.
 *
 * Creates a client that matches the AppRouter interface with configurable mock data.
 */
import type { APIClient } from "@/browser/contexts/API";
import type {
  AgentDefinitionDescriptor,
  AgentDefinitionPackage,
} from "@/common/types/agentDefinition";
import type { AgentSkillDescriptor, AgentSkillIssue } from "@/common/types/agentSkill";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { ProjectConfig } from "@/node/config";
import {
  DEFAULT_LAYOUT_PRESETS_CONFIG,
  normalizeLayoutPresetsConfig,
  type LayoutPresetsConfig,
} from "@/common/types/uiLayouts";
import type {
  MinionChatMessage,
  ProvidersConfigMap,
  MinionStatsSnapshot,
  ServerAuthSession,
} from "@/common/orpc/types";
import type { LatticeMessage } from "@/common/types/message";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { DebugLlmRequestSnapshot } from "@/common/types/debugLlmRequest";
import type { NameGenerationError } from "@/common/types/errors";
import type { Secret } from "@/common/types/secrets";
import type { MCPHttpServerInfo, MCPServerInfo } from "@/common/types/mcp";
import type { MCPOAuthAuthStatus } from "@/common/types/mcpOauth";
import type { ChatStats } from "@/common/types/chatStats";
import {
  LATTICE_HELP_CHAT_AGENT_ID,
  LATTICE_HELP_CHAT_MINION_ID,
  LATTICE_HELP_CHAT_MINION_NAME,
  LATTICE_HELP_CHAT_MINION_TITLE,
} from "@/common/constants/latticeChat";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { getMinionLastReadKey } from "@/common/constants/storage";
import {
  normalizeRuntimeEnablement,
  RUNTIME_ENABLEMENT_IDS,
  type RuntimeEnablementId,
} from "@/common/types/runtime";
import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";
import {
  DEFAULT_TASK_SETTINGS,
  normalizeSidekickAiDefaults,
  normalizeTaskSettings,
  type SidekickAiDefaults,
  type TaskSettings,
} from "@/common/types/tasks";
import { normalizeAgentAiDefaults, type AgentAiDefaults } from "@/common/types/agentAiDefaults";
import { createAsyncMessageQueue } from "@/common/utils/asyncMessageQueue";
import type {
  LatticeInfo,
  LatticeListPresetsResult,
  LatticeListTemplatesResult,
  LatticeListMinionsResult,
  LatticePreset,
  LatticeTemplate,
  LatticeMinion,
} from "@/common/orpc/schemas/lattice";
import { isMinionArchived } from "@/common/utils/archive";

/** Session usage data structure matching SessionUsageFileSchema */
export interface MockSessionUsage {
  byModel: Record<
    string,
    {
      input: { tokens: number; cost_usd?: number };
      cached: { tokens: number; cost_usd?: number };
      cacheCreate: { tokens: number; cost_usd?: number };
      output: { tokens: number; cost_usd?: number };
      reasoning: { tokens: number; cost_usd?: number };
      model?: string;
    }
  >;
  lastRequest?: {
    model: string;
    usage: {
      input: { tokens: number; cost_usd?: number };
      cached: { tokens: number; cost_usd?: number };
      cacheCreate: { tokens: number; cost_usd?: number };
      output: { tokens: number; cost_usd?: number };
      reasoning: { tokens: number; cost_usd?: number };
      model?: string;
    };
    timestamp: number;
  };
  version: 1;
}

export interface MockTerminalSession {
  sessionId: string;
  minionId: string;
  cols: number;
  rows: number;
  /** Initial snapshot returned by terminal.attach ({ type: "screenState" }). */
  screenState: string;
  /** Optional live output chunks yielded after screenState ({ type: "output" }). */
  outputChunks?: string[];
}

export interface MockORPCClientOptions {
  /** Layout presets config for Settings → Layouts stories */
  layoutPresets?: LayoutPresetsConfig;
  projects?: Map<string, ProjectConfig>;
  minions?: FrontendMinionMetadata[];
  /** Initial task settings for config.getConfig (e.g., Settings → Tasks crew) */
  taskSettings?: Partial<TaskSettings>;
  /** Initial unified AI defaults for agents (plan/exec/compact + sidekicks) */
  agentAiDefaults?: AgentAiDefaults;
  /** Agent definitions to expose via agents.list */
  agentDefinitions?: AgentDefinitionDescriptor[];
  /** Initial per-sidekick AI defaults for config.getConfig (e.g., Settings → Tasks crew) */
  sidekickAiDefaults?: SidekickAiDefaults;
  /** Lattice lifecycle preferences for config.getConfig (e.g., Settings → Lattice crew) */
  stopLatticeMinionOnArchive?: boolean;
  /** Initial runtime enablement for config.getConfig */
  runtimeEnablement?: Record<string, boolean>;
  /** Initial default runtime for config.getConfig (global) */
  defaultRuntime?: RuntimeEnablementId | null;
  /** Per-minion chat callback. Return messages to emit, or use the callback for streaming. */
  onChat?: (minionId: string, emit: (msg: MinionChatMessage) => void) => (() => void) | void;
  /** Mock for executeBash per minion */
  executeBash?: (
    minionId: string,
    script: string
  ) => Promise<{ success: true; output: string; exitCode: number; wall_duration_ms: number }>;
  /** Provider configuration (API keys, base URLs, etc.) */
  providersConfig?: ProvidersConfigMap;
  /** List of available provider names */
  providersList?: string[];
  /** Server auth sessions for Settings → Server Access stories */
  serverAuthSessions?: ServerAuthSession[];
  /** Mock for projects.remove - return error string to simulate failure */
  onProjectRemove?: (projectPath: string) => { success: true } | { success: false; error: string };
  /** Override for nameGeneration.generate result (default: success) */
  nameGenerationResult?: { success: false; error: NameGenerationError };
  /** Background processes per minion */
  backgroundProcesses?: Map<
    string,
    Array<{
      id: string;
      pid: number;
      script: string;
      displayName?: string;
      startTime: number;
      status: "running" | "exited" | "killed" | "failed";
      exitCode?: number;
    }>
  >;
  /** Session usage data per minion (for Costs tab) */
  minionStatsSnapshots?: Map<string, MinionStatsSnapshot>;
  statsTabVariant?: "control" | "stats";
  /** Global secrets (Settings → Secrets → Global) */
  globalSecrets?: Secret[];
  /** Project secrets per project */
  projectSecrets?: Map<string, Secret[]>;
  /** Terminal sessions to expose via terminal.listSessions + terminal.attach */
  terminalSessions?: MockTerminalSession[];
  sessionUsage?: Map<string, MockSessionUsage>;
  /** Debug snapshot per minion for the last LLM request modal */
  lastLlmRequestSnapshots?: Map<string, DebugLlmRequestSnapshot | null>;
  /** Mock transcripts for minion.getSidekickTranscript (taskId -> persisted transcript response). */
  sidekickTranscripts?: Map<
    string,
    { messages: LatticeMessage[]; model?: string; thinkingLevel?: ThinkingLevel }
  >;
  /** Global MCP server configuration (Settings → MCP) */
  globalMcpServers?: Record<string, MCPServerInfo>;
  /** MCP server configuration per project */
  mcpServers?: Map<string, Record<string, MCPServerInfo>>;
  /** Optional OAuth auth status per MCP server URL (serverUrl -> status) */
  mcpOauthAuthStatus?: Map<string, MCPOAuthAuthStatus>;
  /** MCP minion overrides per minion */
  mcpOverrides?: Map<
    string,
    {
      disabledServers?: string[];
      enabledServers?: string[];
      toolAllowlist?: Record<string, string[]>;
    }
  >;
  /** MCP test results - maps server name to tools list or error */
  mcpTestResults?: Map<
    string,
    { success: true; tools: string[] } | { success: false; error: string }
  >;
  /** Custom listBranches implementation (for testing non-git repos) */
  listBranches?: (input: {
    projectPath: string;
  }) => Promise<{ branches: string[]; recommendedTrunk: string | null }>;
  /** Custom runtimeAvailability response (for testing non-git repos) */
  runtimeAvailability?: {
    local: { available: true } | { available: false; reason: string };
    worktree: { available: true } | { available: false; reason: string };
    ssh: { available: true } | { available: false; reason: string };
    docker: { available: true } | { available: false; reason: string };
    devcontainer:
      | { available: true; configs: Array<{ path: string; label: string }>; cliVersion?: string }
      | { available: false; reason: string };
  };
  /** Custom gitInit implementation (for testing git init flow) */
  gitInit?: (input: {
    projectPath: string;
  }) => Promise<{ success: true } | { success: false; error: string }>;
  /** Idle compaction hours per project (null = disabled) */
  idleCompactionHours?: Map<string, number | null>;
  /** Override signing capabilities response */
  signingCapabilities?: {
    publicKey: string | null;
    githubUser: string | null;
    error: { message: string; hasEncryptedKey: boolean } | null;
  };
  /** Lattice CLI availability info */
  latticeInfo?: LatticeInfo;
  /** Lattice templates available for minion creation */
  latticeTemplates?: LatticeTemplate[];
  /** Lattice presets per template name */
  latticePresets?: Map<string, LatticePreset[]>;
  /** Existing Lattice minions */
  latticeMinions?: LatticeMinion[];
  /** Override Lattice template list result (including error states) */
  latticeTemplatesResult?: LatticeListTemplatesResult;
  /** Override Lattice preset list result per template (including error states) */
  latticePresetsResult?: Map<string, LatticeListPresetsResult>;
  /** Override Lattice minion list result (including error states) */
  latticeMinionsResult?: LatticeListMinionsResult;
  /** Available agent skills (descriptors) */
  agentSkills?: AgentSkillDescriptor[];
  /** Agent skills that were discovered but couldn't be loaded (SKILL.md parse errors, etc.) */
  invalidAgentSkills?: AgentSkillIssue[];
  /** Lattice Governor URL (null = not enrolled) */
  latticeGovernorUrl?: string | null;
  /** Whether enrolled with Lattice Governor */
  latticeGovernorEnrolled?: boolean;
  /** Policy response for policy.get */
  policyResponse?: {
    source: "none" | "env" | "governor";
    status: { state: "disabled" | "enforced" | "blocked"; reason?: string };
    policy: unknown;
  };
  /** Mock log entries for Output tab (subscribeLogs snapshot) */
  logEntries?: Array<{
    timestamp: number;
    level: "error" | "warn" | "info" | "debug";
    message: string;
    location: string;
  }>;
  /** Mock clearLogs result (default: { success: true, error: null }) */
  clearLogsResult?: { success: boolean; error?: string | null };
}

interface MockBackgroundProcess {
  id: string;
  pid: number;
  script: string;
  displayName?: string;
  startTime: number;
  status: "running" | "exited" | "killed" | "failed";
  exitCode?: number;
}

type MockMcpServers = Record<string, MCPServerInfo>;

interface MockMcpOverrides {
  disabledServers?: string[];
  enabledServers?: string[];
  toolAllowlist?: Record<string, string[]>;
}

type MockMcpTestResult = { success: true; tools: string[] } | { success: false; error: string };

/**
 * Creates a mock ORPC client for Storybook.
 *
 * Usage:
 * ```tsx
 * const client = createMockORPCClient({
 *   projects: new Map([...]),
 *   minions: [...],
 *   onChat: (wsId, emit) => {
 *     emit({ type: "caught-up" });
 *     // optionally return cleanup function
 *   },
 * });
 *
 * return <AppLoader client={client} />;
 * ```
 */
export function createMockORPCClient(options: MockORPCClientOptions = {}): APIClient {
  const {
    projects = new Map<string, ProjectConfig>(),
    minions: inputMinions = [],
    onChat,
    executeBash,
    providersConfig = { anthropic: { apiKeySet: true, isEnabled: true, isConfigured: true } },
    providersList = [],
    serverAuthSessions: initialServerAuthSessions = [],
    onProjectRemove,
    nameGenerationResult,
    backgroundProcesses = new Map<string, MockBackgroundProcess[]>(),
    sessionUsage = new Map<string, MockSessionUsage>(),
    lastLlmRequestSnapshots = new Map<string, DebugLlmRequestSnapshot | null>(),
    sidekickTranscripts = new Map<
      string,
      { messages: LatticeMessage[]; model?: string; thinkingLevel?: ThinkingLevel }
    >(),
    minionStatsSnapshots = new Map<string, MinionStatsSnapshot>(),
    statsTabVariant = "control",
    globalSecrets = [],
    projectSecrets = new Map<string, Secret[]>(),
    terminalSessions: initialTerminalSessions = [],
    globalMcpServers = {},
    mcpServers = new Map<string, MockMcpServers>(),
    mcpOverrides = new Map<string, MockMcpOverrides>(),
    mcpTestResults = new Map<string, MockMcpTestResult>(),
    mcpOauthAuthStatus = new Map<string, MCPOAuthAuthStatus>(),
    taskSettings: initialTaskSettings,
    sidekickAiDefaults: initialSidekickAiDefaults,
    agentAiDefaults: initialAgentAiDefaults,
    stopLatticeMinionOnArchive: initialStopLatticeMinionOnArchive = true,
    runtimeEnablement: initialRuntimeEnablement,
    defaultRuntime: initialDefaultRuntime,
    agentDefinitions: initialAgentDefinitions,
    listBranches: customListBranches,
    gitInit: customGitInit,
    runtimeAvailability: customRuntimeAvailability,
    signingCapabilities: customSigningCapabilities,
    latticeInfo = { state: "unavailable" as const, reason: "missing" as const },
    latticeTemplates = [],
    latticePresets = new Map<string, LatticePreset[]>(),
    latticeMinions = [],
    latticeTemplatesResult,
    latticePresetsResult = new Map<string, LatticeListPresetsResult>(),
    latticeMinionsResult,
    layoutPresets: initialLayoutPresets,
    agentSkills = [],
    invalidAgentSkills = [],
    latticeGovernorUrl = null,
    latticeGovernorEnrolled = false,
    policyResponse = {
      source: "none" as const,
      status: { state: "disabled" as const },
      policy: null,
    },
    logEntries = [],
    clearLogsResult = { success: true, error: null },
  } = options;

  // Feature flags
  let statsTabOverride: "default" | "on" | "off" = "default";

  const getStatsTabState = () => {
    // Stats tab is default-on; keep override as a local kill switch.
    const enabled = statsTabOverride !== "off";

    return { enabled, variant: statsTabVariant, override: statsTabOverride } as const;
  };

  // App now boots into the built-in lattice-chat minion by default.
  // Ensure Storybook mocks always include it so stories don't render "Minion not found".
  const latticeChatMinion: FrontendMinionMetadata = {
    id: LATTICE_HELP_CHAT_MINION_ID,
    name: LATTICE_HELP_CHAT_MINION_NAME,
    title: LATTICE_HELP_CHAT_MINION_TITLE,
    projectName: "Lattice",
    projectPath: "/Users/dev/.lattice/system/chat-with-lattice",
    namedMinionPath: "/Users/dev/.lattice/system/chat-with-lattice",
    runtimeConfig: { type: "local" },
    agentId: LATTICE_HELP_CHAT_AGENT_ID,
  };

  const minions = inputMinions.some((w) => w.id === LATTICE_HELP_CHAT_MINION_ID)
    ? inputMinions
    : [latticeChatMinion, ...inputMinions];

  // Keep Storybook's built-in lattice-help minion behavior deterministic:
  // if stories haven't seeded a read baseline, treat it as "known but never read"
  // rather than "unknown minion" so the unread badge can render when recency exists.
  const latticeHelpLastReadKey = getMinionLastReadKey(LATTICE_HELP_CHAT_MINION_ID);
  if (readPersistedState<number | null>(latticeHelpLastReadKey, null) === null) {
    updatePersistedState(latticeHelpLastReadKey, 0);
  }
  const minionMap = new Map(minions.map((w) => [w.id, w]));

  // Terminal sessions are used by WorkbenchPanel and TerminalView.
  // Stories can seed deterministic sessions (with screenState) to make the embedded terminal look
  // data-rich, while still keeping the default mock (no sessions) lightweight.
  const terminalSessionsById = new Map<string, MockTerminalSession>();
  const terminalSessionIdsByMinion = new Map<string, string[]>();

  const registerTerminalSession = (session: MockTerminalSession) => {
    terminalSessionsById.set(session.sessionId, session);
    const existing = terminalSessionIdsByMinion.get(session.minionId) ?? [];
    if (!existing.includes(session.sessionId)) {
      terminalSessionIdsByMinion.set(session.minionId, [...existing, session.sessionId]);
    }
  };

  for (const session of initialTerminalSessions) {
    registerTerminalSession(session);
  }

  let terminalSessionCounter = initialTerminalSessions.reduce((max, session) => {
    const match = /^mock-terminal-(\d+)$/.exec(session.sessionId);
    if (!match) {
      return max;
    }
    const parsed = Number.parseInt(match[1] ?? "", 10);
    return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
  }, 0);
  const allocTerminalSessionId = () => {
    let nextSessionId = "";
    do {
      terminalSessionCounter += 1;
      nextSessionId = `mock-terminal-${terminalSessionCounter}`;
    } while (terminalSessionsById.has(nextSessionId));
    return nextSessionId;
  };

  let createdMinionCounter = 0;

  const agentDefinitions: AgentDefinitionDescriptor[] =
    initialAgentDefinitions ??
    ([
      {
        id: "plan",
        scope: "built-in",
        name: "Plan",
        description: "Create a plan before coding",
        uiSelectable: true,
        sidekickRunnable: false,
        base: "plan",
        uiColor: "var(--color-plan-mode)",
      },
      {
        id: "exec",
        scope: "built-in",
        name: "Exec",
        description: "Implement changes in the repository",
        uiSelectable: true,
        sidekickRunnable: true,
        uiColor: "var(--color-exec-mode)",
      },
      {
        id: "compact",
        scope: "built-in",
        name: "Compact",
        description: "History compaction (internal)",
        uiSelectable: false,
        sidekickRunnable: false,
      },
      {
        id: "explore",
        scope: "built-in",
        name: "Explore",
        description: "Read-only repository exploration",
        uiSelectable: false,
        sidekickRunnable: true,
        base: "exec",
      },
      {
        id: "lattice",
        scope: "built-in",
        name: "Lattice",
        description: "Configure lattice global behavior (system minion)",
        uiSelectable: false,
        sidekickRunnable: false,
      },
    ] satisfies AgentDefinitionDescriptor[]);

  let taskSettings = normalizeTaskSettings(initialTaskSettings ?? DEFAULT_TASK_SETTINGS);

  let agentAiDefaults = normalizeAgentAiDefaults(
    initialAgentAiDefaults ?? ({ ...(initialSidekickAiDefaults ?? {}) } as const)
  );

  let stopLatticeMinionOnArchive = initialStopLatticeMinionOnArchive;
  let runtimeEnablement: Record<string, boolean> = initialRuntimeEnablement ?? {
    local: true,
    worktree: true,
    ssh: true,
    lattice: true,
    docker: true,
    devcontainer: true,
  };

  let defaultRuntime: RuntimeEnablementId | null = initialDefaultRuntime ?? null;
  let globalSecretsState: Secret[] = [...globalSecrets];
  const globalMcpServersState: MockMcpServers = { ...globalMcpServers };

  let serverAuthSessionsState: ServerAuthSession[] = initialServerAuthSessions.map((session) => ({
    ...session,
  }));

  const deriveSidekickAiDefaults = () => {
    const raw: Record<string, unknown> = {};
    for (const [agentId, entry] of Object.entries(agentAiDefaults)) {
      if (agentId === "plan" || agentId === "exec" || agentId === "compact") {
        continue;
      }
      raw[agentId] = entry;
    }
    return normalizeSidekickAiDefaults(raw);
  };

  let layoutPresets = initialLayoutPresets ?? DEFAULT_LAYOUT_PRESETS_CONFIG;
  let sidekickAiDefaults = deriveSidekickAiDefaults();

  const mockStats: ChatStats = {
    consumers: [],
    totalTokens: 0,
    model: "mock-model",
    tokenizerName: "mock-tokenizer",
    usageHistory: [],
  };

  // MCP OAuth mock state (used by Settings → MCP OAuth UI)
  let mcpOauthFlowCounter = 0;
  const mcpOauthFlows = new Map<
    string,
    { projectPath: string; serverName: string; pendingServerUrl?: string }
  >();

  const getMcpServerUrl = (projectPath: string, serverName: string): string | undefined => {
    const server = mcpServers.get(projectPath)?.[serverName] ?? globalMcpServersState[serverName];
    if (!server || server.transport === "stdio") {
      return undefined;
    }
    return server.url;
  };

  const getMcpOauthStatus = (projectPath: string, serverName: string): MCPOAuthAuthStatus => {
    const serverUrl = getMcpServerUrl(projectPath, serverName);
    const status = serverUrl ? mcpOauthAuthStatus.get(serverUrl) : undefined;

    if (status) {
      return {
        ...status,
        // Prefer the stored serverUrl, but fall back to current config (helps stories stay minimal).
        serverUrl: status.serverUrl ?? serverUrl,
      };
    }

    return {
      serverUrl,
      isLoggedIn: false,
      hasRefreshToken: false,
    };
  };
  // Cast to ORPCClient - TypeScript can't fully validate the proxy structure
  return {
    tokenizer: {
      countTokens: () => Promise.resolve(0),
      countTokensBatch: (_input: { model: string; texts: string[] }) =>
        Promise.resolve(_input.texts.map(() => 0)),
      calculateStats: () => Promise.resolve(mockStats),
    },
    features: {
      getStatsTabState: () => Promise.resolve(getStatsTabState()),
      setStatsTabOverride: (input: { override: "default" | "on" | "off" }) => {
        statsTabOverride = input.override;
        return Promise.resolve(getStatsTabState());
      },
    },
    telemetry: {
      track: () => Promise.resolve(undefined),
      status: () => Promise.resolve({ enabled: true, explicit: false }),
    },
    splashScreens: {
      getViewedSplashScreens: () => Promise.resolve(["onboarding-wizard-v1"]),
      markSplashScreenViewed: () => Promise.resolve(undefined),
    },
    signing: {
      capabilities: () =>
        Promise.resolve(
          customSigningCapabilities ?? {
            publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey",
            githubUser: "mockuser",
            error: null,
          }
        ),
      sign: () =>
        Promise.resolve({
          signature: "mockSignature==",
          publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMockKey",
          githubUser: "mockuser",
        }),
      clearIdentityCache: () => Promise.resolve({ success: true }),
    },
    server: {
      getLaunchProject: () => Promise.resolve(null),
      getSshHost: () => Promise.resolve(null),
      setSshHost: () => Promise.resolve(undefined),
    },
    serverAuth: {
      listSessions: () =>
        Promise.resolve(
          [...serverAuthSessionsState]
            .map((session) => ({ ...session }))
            .sort((a, b) => b.lastUsedAtMs - a.lastUsedAtMs)
        ),
      revokeSession: (input: { sessionId: string }) => {
        const beforeCount = serverAuthSessionsState.length;
        serverAuthSessionsState = serverAuthSessionsState.filter(
          (session) => session.id !== input.sessionId
        );

        return Promise.resolve({ removed: serverAuthSessionsState.length < beforeCount });
      },
      revokeOtherSessions: () => {
        const currentSession = serverAuthSessionsState.find((session) => session.isCurrent);
        const beforeCount = serverAuthSessionsState.length;

        if (!currentSession) {
          return Promise.resolve({ revokedCount: 0 });
        }

        serverAuthSessionsState = serverAuthSessionsState.filter(
          (session) => session.id === currentSession.id
        );

        return Promise.resolve({ revokedCount: beforeCount - serverAuthSessionsState.length });
      },
    },
    // Settings → Layouts (layout presets)
    // Stored in-memory for Storybook only.
    // Frontend code normalizes the response defensively, but we normalize here too so
    // stories remain stable even if they mutate the config.
    uiLayouts: {
      getAll: () => Promise.resolve(layoutPresets),
      saveAll: (input: { layoutPresets: unknown }) => {
        layoutPresets = normalizeLayoutPresetsConfig(input.layoutPresets);
        return Promise.resolve(undefined);
      },
    },
    config: {
      getConfig: () =>
        Promise.resolve({
          taskSettings,
          stopLatticeMinionOnArchive,
          runtimeEnablement,
          defaultRuntime,
          agentAiDefaults,
          sidekickAiDefaults,
          latticeGovernorUrl,
          latticeGovernorEnrolled,
        }),
      saveConfig: (input: {
        taskSettings: unknown;
        agentAiDefaults?: unknown;
        sidekickAiDefaults?: unknown;
      }) => {
        taskSettings = normalizeTaskSettings(input.taskSettings);

        if (input.agentAiDefaults !== undefined) {
          agentAiDefaults = normalizeAgentAiDefaults(input.agentAiDefaults);
          sidekickAiDefaults = deriveSidekickAiDefaults();
        }

        if (input.sidekickAiDefaults !== undefined) {
          sidekickAiDefaults = normalizeSidekickAiDefaults(input.sidekickAiDefaults);

          const nextAgentAiDefaults: Record<string, unknown> = { ...agentAiDefaults };
          for (const [agentType, entry] of Object.entries(sidekickAiDefaults)) {
            nextAgentAiDefaults[agentType] = entry;
          }

          agentAiDefaults = normalizeAgentAiDefaults(nextAgentAiDefaults);
        }

        return Promise.resolve(undefined);
      },
      updateAgentAiDefaults: (input: { agentAiDefaults: unknown }) => {
        agentAiDefaults = normalizeAgentAiDefaults(input.agentAiDefaults);
        sidekickAiDefaults = deriveSidekickAiDefaults();
        return Promise.resolve(undefined);
      },
      updateLatticePrefs: (input: { stopLatticeMinionOnArchive: boolean }) => {
        stopLatticeMinionOnArchive = input.stopLatticeMinionOnArchive;
        return Promise.resolve(undefined);
      },
      updateRuntimeEnablement: (input: {
        projectPath?: string | null;
        runtimeEnablement?: Record<string, boolean> | null;
        defaultRuntime?: RuntimeEnablementId | null;
        runtimeOverridesEnabled?: boolean | null;
      }) => {
        const shouldUpdateRuntimeEnablement = input.runtimeEnablement !== undefined;
        const shouldUpdateDefaultRuntime = input.defaultRuntime !== undefined;
        const shouldUpdateOverridesEnabled = input.runtimeOverridesEnabled !== undefined;
        const projectPath = input.projectPath?.trim();

        const runtimeEnablementOverrides =
          input.runtimeEnablement == null
            ? undefined
            : (() => {
                const normalized = normalizeRuntimeEnablement(input.runtimeEnablement);
                const disabled: Partial<Record<RuntimeEnablementId, false>> = {};

                for (const runtimeId of RUNTIME_ENABLEMENT_IDS) {
                  if (!normalized[runtimeId]) {
                    disabled[runtimeId] = false;
                  }
                }

                return Object.keys(disabled).length > 0 ? disabled : undefined;
              })();

        const runtimeOverridesEnabled = input.runtimeOverridesEnabled === true ? true : undefined;

        if (projectPath) {
          const project = projects.get(projectPath);
          if (project) {
            const nextProject = { ...project };
            if (shouldUpdateRuntimeEnablement) {
              if (runtimeEnablementOverrides) {
                nextProject.runtimeEnablement = runtimeEnablementOverrides;
              } else {
                delete nextProject.runtimeEnablement;
              }
            }

            if (shouldUpdateDefaultRuntime) {
              if (input.defaultRuntime !== null && input.defaultRuntime !== undefined) {
                nextProject.defaultRuntime = input.defaultRuntime;
              } else {
                delete nextProject.defaultRuntime;
              }
            }

            if (shouldUpdateOverridesEnabled) {
              if (runtimeOverridesEnabled) {
                nextProject.runtimeOverridesEnabled = true;
              } else {
                delete nextProject.runtimeOverridesEnabled;
              }
            }
            projects.set(projectPath, nextProject);
          }

          return Promise.resolve(undefined);
        }

        if (shouldUpdateRuntimeEnablement) {
          if (input.runtimeEnablement == null) {
            runtimeEnablement = normalizeRuntimeEnablement({});
          } else {
            runtimeEnablement = normalizeRuntimeEnablement(input.runtimeEnablement);
          }
        }

        if (shouldUpdateDefaultRuntime) {
          defaultRuntime = input.defaultRuntime ?? null;
        }

        return Promise.resolve(undefined);
      },
      unenrollLatticeGovernor: () => Promise.resolve(undefined),
    },
    agents: {
      list: (_input: {
        projectPath?: string;
        minionId?: string;
        disableMinionAgents?: boolean;
        includeDisabled?: boolean;
      }) => Promise.resolve(agentDefinitions),
      get: (input: {
        projectPath?: string;
        minionId?: string;
        disableMinionAgents?: boolean;
        includeDisabled?: boolean;
        agentId: string;
      }) => {
        const descriptor =
          agentDefinitions.find((agent) => agent.id === input.agentId) ?? agentDefinitions[0];

        const agentPackage = {
          id: descriptor.id,
          scope: descriptor.scope,
          frontmatter: {
            name: descriptor.name,
            description: descriptor.description,
            base: descriptor.base,
            ui: { selectable: descriptor.uiSelectable },
            sidekick: { runnable: descriptor.sidekickRunnable },
            ai: descriptor.aiDefaults,
            tools: descriptor.tools,
          },
          body: "",
        } satisfies AgentDefinitionPackage;

        return Promise.resolve(agentPackage);
      },
    },
    agentSkills: {
      list: () => Promise.resolve(agentSkills),
      listDiagnostics: () =>
        Promise.resolve({ skills: agentSkills, invalidSkills: invalidAgentSkills }),
      get: () =>
        Promise.resolve({
          scope: "built-in" as const,
          directoryName: "mock-skill",
          frontmatter: { name: "mock-skill", description: "Mock skill" },
          body: "",
        }),
    },
    providers: {
      list: () => Promise.resolve(providersList),
      getConfig: () => Promise.resolve(providersConfig),
      setProviderConfig: () => Promise.resolve({ success: true, data: undefined }),
      setModels: () => Promise.resolve({ success: true, data: undefined }),
    },
    general: {
      listDirectory: () => Promise.resolve({ entries: [], hasMore: false }),
      ping: (input: string) => Promise.resolve(`Pong: ${input}`),
      tick: async function* () {
        // No ticks in the mock, but keep the subscription open.
        yield* [];
        await new Promise<void>(() => undefined);
      },
      subscribeLogs: async function* (input: { level?: string | null }) {
        const LOG_LEVEL_PRIORITY: Record<string, number> = {
          error: 0,
          warn: 1,
          info: 2,
          debug: 3,
        };
        const minPriority = input.level != null ? (LOG_LEVEL_PRIORITY[input.level] ?? 3) : 3;
        const filtered = logEntries.filter(
          (entry) => (LOG_LEVEL_PRIORITY[entry.level] ?? 3) <= minPriority
        );
        yield { type: "snapshot" as const, epoch: 1, entries: filtered };
        await new Promise<void>(() => undefined);
      },
      clearLogs: () => Promise.resolve(clearLogsResult),
    },
    secrets: {
      get: (input?: { projectPath?: string }) => {
        const projectPath = typeof input?.projectPath === "string" ? input.projectPath.trim() : "";
        if (projectPath) {
          return Promise.resolve(projectSecrets.get(projectPath) ?? []);
        }

        return Promise.resolve(globalSecretsState);
      },
      update: (input: { projectPath?: string; secrets: Secret[] }) => {
        const projectPath = typeof input.projectPath === "string" ? input.projectPath.trim() : "";

        if (projectPath) {
          projectSecrets.set(projectPath, input.secrets);
        } else {
          globalSecretsState = input.secrets;
        }

        return Promise.resolve({ success: true, data: undefined });
      },
    },
    mcp: {
      list: (input?: { projectPath?: string }) => {
        const projectPath = typeof input?.projectPath === "string" ? input.projectPath.trim() : "";
        if (projectPath) {
          return Promise.resolve(mcpServers.get(projectPath) ?? globalMcpServersState);
        }

        return Promise.resolve(globalMcpServersState);
      },
      add: (input: {
        name: string;
        transport?: "stdio" | "http" | "sse" | "auto";
        command?: string;
        url?: string;
        headers?: MCPHttpServerInfo["headers"];
      }) => {
        const transport = input.transport ?? "stdio";

        if (transport === "stdio") {
          globalMcpServersState[input.name] = {
            transport: "stdio",
            command: input.command ?? "",
            disabled: false,
          };
        } else {
          globalMcpServersState[input.name] = {
            transport,
            url: input.url ?? "",
            headers: input.headers,
            disabled: false,
          };
        }

        return Promise.resolve({ success: true, data: undefined });
      },
      remove: (input: { name: string }) => {
        delete globalMcpServersState[input.name];
        return Promise.resolve({ success: true, data: undefined });
      },
      test: (input: { projectPath?: string; name?: string }) => {
        if (input.name && mcpTestResults.has(input.name)) {
          return Promise.resolve(mcpTestResults.get(input.name)!);
        }

        // Default: return empty tools.
        return Promise.resolve({ success: true, tools: [] });
      },
      setEnabled: (input: { name: string; enabled: boolean }) => {
        const server = globalMcpServersState[input.name];
        if (server) {
          const disabled = !input.enabled;
          if (server.transport === "stdio") {
            globalMcpServersState[input.name] = { ...server, disabled };
          } else {
            globalMcpServersState[input.name] = { ...server, disabled };
          }
        }
        return Promise.resolve({ success: true, data: undefined });
      },
      setToolAllowlist: (input: { name: string; toolAllowlist: string[] }) => {
        const server = globalMcpServersState[input.name];
        if (server) {
          if (server.transport === "stdio") {
            globalMcpServersState[input.name] = { ...server, toolAllowlist: input.toolAllowlist };
          } else {
            globalMcpServersState[input.name] = { ...server, toolAllowlist: input.toolAllowlist };
          }
        }
        return Promise.resolve({ success: true, data: undefined });
      },
    },
    mcpOauth: {
      getAuthStatus: (input: { serverUrl: string }) => {
        const status = mcpOauthAuthStatus.get(input.serverUrl);
        return Promise.resolve(
          status ?? {
            serverUrl: input.serverUrl,
            isLoggedIn: false,
            hasRefreshToken: false,
          }
        );
      },
      startDesktopFlow: (input: {
        projectPath?: string;
        serverName: string;
        pendingServer?: { transport: "http" | "sse" | "auto"; url: string };
      }) => {
        mcpOauthFlowCounter += 1;
        const flowId = `mock-mcp-oauth-flow-${mcpOauthFlowCounter}`;

        mcpOauthFlows.set(flowId, {
          projectPath: input.projectPath ?? "",
          serverName: input.serverName,
          pendingServerUrl: input.pendingServer?.url,
        });

        return Promise.resolve({
          success: true,
          data: {
            flowId,
            authorizeUrl: `https://example.com/oauth/authorize?flowId=${encodeURIComponent(flowId)}`,
            redirectUri: "lattice://oauth/callback",
          },
        });
      },
      waitForDesktopFlow: (input: { flowId: string; timeoutMs?: number }) => {
        const flow = mcpOauthFlows.get(input.flowId);
        if (!flow) {
          return Promise.resolve({ success: false as const, error: "OAuth flow not found." });
        }

        mcpOauthFlows.delete(input.flowId);

        const serverUrl =
          flow.pendingServerUrl ?? getMcpServerUrl(flow.projectPath, flow.serverName);
        if (serverUrl) {
          mcpOauthAuthStatus.set(serverUrl, {
            serverUrl,
            isLoggedIn: true,
            hasRefreshToken: true,
            updatedAtMs: Date.now(),
          });
        }

        return Promise.resolve({ success: true as const, data: undefined });
      },
      cancelDesktopFlow: (input: { flowId: string }) => {
        mcpOauthFlows.delete(input.flowId);
        return Promise.resolve(undefined);
      },
      startServerFlow: (input: {
        projectPath?: string;
        serverName: string;
        pendingServer?: { transport: "http" | "sse" | "auto"; url: string };
      }) => {
        mcpOauthFlowCounter += 1;
        const flowId = `mock-mcp-oauth-flow-${mcpOauthFlowCounter}`;

        mcpOauthFlows.set(flowId, {
          projectPath: input.projectPath ?? "",
          serverName: input.serverName,
          pendingServerUrl: input.pendingServer?.url,
        });

        return Promise.resolve({
          success: true,
          data: {
            flowId,
            authorizeUrl: `https://example.com/oauth/authorize?flowId=${encodeURIComponent(flowId)}`,
            redirectUri: "lattice://oauth/callback",
          },
        });
      },
      waitForServerFlow: (input: { flowId: string; timeoutMs?: number }) => {
        const flow = mcpOauthFlows.get(input.flowId);
        if (!flow) {
          return Promise.resolve({ success: false as const, error: "OAuth flow not found." });
        }

        mcpOauthFlows.delete(input.flowId);

        const serverUrl =
          flow.pendingServerUrl ?? getMcpServerUrl(flow.projectPath, flow.serverName);
        if (serverUrl) {
          mcpOauthAuthStatus.set(serverUrl, {
            serverUrl,
            isLoggedIn: true,
            hasRefreshToken: true,
            updatedAtMs: Date.now(),
          });
        }

        return Promise.resolve({ success: true as const, data: undefined });
      },
      cancelServerFlow: (input: { flowId: string }) => {
        mcpOauthFlows.delete(input.flowId);
        return Promise.resolve(undefined);
      },
      logout: (input: { serverUrl: string }) => {
        mcpOauthAuthStatus.set(input.serverUrl, {
          serverUrl: input.serverUrl,
          isLoggedIn: false,
          hasRefreshToken: false,
          updatedAtMs: Date.now(),
        });

        return Promise.resolve({ success: true as const, data: undefined });
      },
    },
    projects: {
      list: () => Promise.resolve(Array.from(projects.entries())),
      create: () =>
        Promise.resolve({
          success: true,
          data: { projectConfig: { minions: [] }, normalizedPath: "/mock/project" },
        }),
      pickDirectory: () => Promise.resolve(null),
      getDefaultProjectDir: () => Promise.resolve("~/.lattice/projects"),
      setDefaultProjectDir: () => Promise.resolve(),
      clone: () =>
        Promise.resolve(
          (function* () {
            yield {
              type: "progress" as const,
              line: "Cloning into '/mock/cloned-project'...\n",
            };
            yield {
              type: "success" as const,
              projectConfig: { minions: [] },
              normalizedPath: "/mock/cloned-project",
            };
          })()
        ),
      listBranches: (input: { projectPath: string }) => {
        if (customListBranches) {
          return customListBranches(input);
        }
        return Promise.resolve({
          branches: ["main", "develop", "feature/new-feature"],
          recommendedTrunk: "main",
        });
      },
      runtimeAvailability: () =>
        Promise.resolve(
          customRuntimeAvailability ?? {
            local: { available: true },
            worktree: { available: true },
            ssh: { available: true },
            docker: { available: true },
            devcontainer: { available: false, reason: "No devcontainer.json found" },
          }
        ),
      gitInit: (input: { projectPath: string }) => {
        if (customGitInit) {
          return customGitInit(input);
        }
        return Promise.resolve({ success: true as const });
      },
      remove: (input: { projectPath: string }) => {
        if (onProjectRemove) {
          return Promise.resolve(onProjectRemove(input.projectPath));
        }
        return Promise.resolve({ success: true, data: undefined });
      },
      secrets: {
        get: (input: { projectPath: string }) =>
          Promise.resolve(projectSecrets.get(input.projectPath) ?? []),
        update: (input: { projectPath: string; secrets: Secret[] }) => {
          projectSecrets.set(input.projectPath, input.secrets);
          return Promise.resolve({ success: true, data: undefined });
        },
      },
      mcp: {
        list: (input: { projectPath: string }) =>
          Promise.resolve(mcpServers.get(input.projectPath) ?? {}),
        add: () => Promise.resolve({ success: true, data: undefined }),
        remove: () => Promise.resolve({ success: true, data: undefined }),
        test: (input: { projectPath: string; name?: string }) => {
          if (input.name && mcpTestResults.has(input.name)) {
            return Promise.resolve(mcpTestResults.get(input.name)!);
          }
          // Default: return empty tools
          return Promise.resolve({ success: true, tools: [] });
        },
        setEnabled: () => Promise.resolve({ success: true, data: undefined }),
        setToolAllowlist: () => Promise.resolve({ success: true, data: undefined }),
      },
      mcpOauth: {
        getAuthStatus: (input: { projectPath: string; serverName: string }) =>
          Promise.resolve(getMcpOauthStatus(input.projectPath, input.serverName)),
        startDesktopFlow: (input: { projectPath: string; serverName: string }) => {
          mcpOauthFlowCounter += 1;
          const flowId = `mock-mcp-oauth-flow-${mcpOauthFlowCounter}`;

          mcpOauthFlows.set(flowId, {
            projectPath: input.projectPath,
            serverName: input.serverName,
          });

          return Promise.resolve({
            success: true,
            data: {
              flowId,
              authorizeUrl: `https://example.com/oauth/authorize?flowId=${encodeURIComponent(flowId)}`,
              redirectUri: "lattice://oauth/callback",
            },
          });
        },
        waitForDesktopFlow: (input: { flowId: string; timeoutMs?: number }) => {
          const flow = mcpOauthFlows.get(input.flowId);
          if (!flow) {
            return Promise.resolve({ success: false as const, error: "OAuth flow not found." });
          }

          mcpOauthFlows.delete(input.flowId);

          const serverUrl = getMcpServerUrl(flow.projectPath, flow.serverName);
          if (serverUrl) {
            mcpOauthAuthStatus.set(serverUrl, {
              serverUrl,
              isLoggedIn: true,
              hasRefreshToken: true,
              updatedAtMs: Date.now(),
            });
          }

          return Promise.resolve({ success: true as const, data: undefined });
        },
        cancelDesktopFlow: (input: { flowId: string }) => {
          mcpOauthFlows.delete(input.flowId);
          return Promise.resolve(undefined);
        },
        logout: (input: { projectPath: string; serverName: string }) => {
          const serverUrl = getMcpServerUrl(input.projectPath, input.serverName);
          if (serverUrl) {
            mcpOauthAuthStatus.set(serverUrl, {
              serverUrl,
              isLoggedIn: false,
              hasRefreshToken: false,
              updatedAtMs: Date.now(),
            });
          }

          return Promise.resolve({ success: true as const, data: undefined });
        },
      },
      idleCompaction: {
        get: (input: { projectPath: string }) =>
          Promise.resolve({ hours: options.idleCompactionHours?.get(input.projectPath) ?? null }),
        set: (input: { projectPath: string; hours: number | null }) => {
          if (options.idleCompactionHours) {
            options.idleCompactionHours.set(input.projectPath, input.hours);
          }
          return Promise.resolve({ success: true, data: undefined });
        },
      },
    },
    minion: {
      list: (input?: { archived?: boolean }) => {
        if (input?.archived) {
          return Promise.resolve(
            minions.filter((w) => isMinionArchived(w.archivedAt, w.unarchivedAt))
          );
        }
        return Promise.resolve(
          minions.filter((w) => !isMinionArchived(w.archivedAt, w.unarchivedAt))
        );
      },
      archive: () => Promise.resolve({ success: true }),
      unarchive: () => Promise.resolve({ success: true }),
      create: (input: { projectPath: string; branchName: string }) => {
        createdMinionCounter += 1;

        return Promise.resolve({
          success: true,
          metadata: {
            id: `ws-created-${createdMinionCounter}`,
            name: input.branchName,
            projectPath: input.projectPath,
            projectName: input.projectPath.split("/").pop() ?? "project",
            namedMinionPath: `/mock/minion/${input.branchName}`,
            runtimeConfig: DEFAULT_RUNTIME_CONFIG,
          },
        });
      },
      remove: () => Promise.resolve({ success: true }),
      updateAgentAISettings: () => Promise.resolve({ success: true, data: undefined }),
      updateModeAISettings: () => Promise.resolve({ success: true, data: undefined }),
      updateTitle: () => Promise.resolve({ success: true, data: undefined }),
      rename: (input: { minionId: string }) =>
        Promise.resolve({
          success: true,
          data: { newMinionId: input.minionId },
        }),
      fork: () => Promise.resolve({ success: false, error: "Not implemented in mock" }),
      sendMessage: () => Promise.resolve({ success: true, data: undefined }),
      resumeStream: () => Promise.resolve({ success: true, data: { started: true } }),
      setAutoRetryEnabled: () =>
        Promise.resolve({
          success: true,
          data: { previousEnabled: true, enabled: true },
        }),
      getStartupAutoRetryModel: () => Promise.resolve({ success: true, data: null }),
      setAutoCompactionThreshold: () => Promise.resolve({ success: true, data: undefined }),
      interruptStream: () => Promise.resolve({ success: true, data: undefined }),
      clearQueue: () => Promise.resolve({ success: true, data: undefined }),
      truncateHistory: () => Promise.resolve({ success: true, data: undefined }),
      replaceChatHistory: () => Promise.resolve({ success: true, data: undefined }),
      getInfo: (input: { minionId: string }) =>
        Promise.resolve(minionMap.get(input.minionId) ?? null),
      getLastLlmRequest: (input: { minionId: string }) =>
        Promise.resolve({
          success: true,
          data: lastLlmRequestSnapshots.get(input.minionId) ?? null,
        }),
      getSidekickTranscript: (input: { minionId?: string; taskId: string }) =>
        Promise.resolve(sidekickTranscripts.get(input.taskId) ?? { messages: [] }),
      executeBash: async (input: { minionId: string; script: string }) => {
        if (executeBash) {
          const result = await executeBash(input.minionId, input.script);
          return { success: true, data: result };
        }
        return {
          success: true,
          data: { success: true, output: "", exitCode: 0, wall_duration_ms: 0 },
        };
      },
      onChat: async function* (input: { minionId: string }, options?: { signal?: AbortSignal }) {
        if (!onChat) {
          // Default mock behavior: subscriptions should remain open.
          // If this ends, MinionStore will retry and reset state, which flakes stories.
          const caughtUp: MinionChatMessage = { type: "caught-up", hasOlderHistory: false };
          yield caughtUp;

          await new Promise<void>((resolve) => {
            if (options?.signal?.aborted) {
              resolve();
              return;
            }
            options?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        }

        const { push, iterate, end } = createAsyncMessageQueue<MinionChatMessage>();

        // Call the user's onChat handler
        const cleanup = onChat(input.minionId, push);

        try {
          yield* iterate();
        } finally {
          end();
          cleanup?.();
        }
      },
      onMetadata: async function* () {
        // No metadata updates in the mock, but keep the subscription open.
        yield* [];
        await new Promise<void>(() => undefined);
      },
      activity: {
        list: () => Promise.resolve({}),
        subscribe: async function* () {
          yield* [];
          await new Promise<void>(() => undefined);
        },
      },
      backgroundBashes: {
        subscribe: async function* (input: { minionId: string }) {
          // Yield initial state
          yield {
            processes: backgroundProcesses.get(input.minionId) ?? [],
            foregroundToolCallIds: [],
          };
          // Then hang forever (like a real subscription)
          await new Promise<void>(() => undefined);
        },
        terminate: () => Promise.resolve({ success: true, data: undefined }),
        getOutput: () =>
          Promise.resolve({
            success: true,
            data: { status: "running" as const, output: "", nextOffset: 0, truncatedStart: false },
          }),
        sendToBackground: () => Promise.resolve({ success: true, data: undefined }),
      },
      stats: {
        subscribe: async function* (input: { minionId: string }) {
          const snapshot = minionStatsSnapshots.get(input.minionId);
          if (snapshot) {
            yield snapshot;
          }
          await new Promise<void>(() => undefined);
        },
        clear: (input: { minionId: string }) => {
          minionStatsSnapshots.delete(input.minionId);
          return Promise.resolve({ success: true, data: undefined });
        },
      },
      getSessionUsage: (input: { minionId: string }) =>
        Promise.resolve(sessionUsage.get(input.minionId)),
      getSessionUsageBatch: (input: { minionIds: string[] }) => {
        const result: Record<string, MockSessionUsage | undefined> = {};
        for (const id of input.minionIds) {
          result[id] = sessionUsage.get(id);
        }
        return Promise.resolve(result);
      },
      mcp: {
        get: (input: { minionId: string }) =>
          Promise.resolve(mcpOverrides.get(input.minionId) ?? {}),
        set: () => Promise.resolve({ success: true, data: undefined }),
      },
      getFileCompletions: (input: { minionId: string; query: string; limit?: number }) => {
        // Mock file paths for storybook - simulate typical project structure
        const mockPaths = [
          "src/browser/components/ChatInput/index.tsx",
          "src/browser/components/CommandSuggestions.tsx",
          "src/browser/components/App.tsx",
          "src/browser/hooks/usePersistedState.ts",
          "src/browser/contexts/MinionContext.tsx",
          "src/common/utils/atMentions.ts",
          "src/common/orpc/types.ts",
          "src/node/services/minionService.ts",
          "package.json",
          "tsconfig.json",
          "README.md",
        ];
        const query = input.query.toLowerCase();
        const filtered = mockPaths.filter((p) => p.toLowerCase().includes(query));
        return Promise.resolve({ paths: filtered.slice(0, input.limit ?? 20) });
      },
    },
    window: {
      setTitle: () => Promise.resolve(undefined),
    },
    lattice: {
      getInfo: () => Promise.resolve(latticeInfo),
      listTemplates: () =>
        Promise.resolve(latticeTemplatesResult ?? { ok: true, templates: latticeTemplates }),
      listPresets: (input: { template: string }) =>
        Promise.resolve(
          latticePresetsResult.get(input.template) ?? {
            ok: true,
            presets: latticePresets.get(input.template) ?? [],
          }
        ),
      listMinions: () =>
        Promise.resolve(latticeMinionsResult ?? { ok: true, minions: latticeMinions }),
    },
    nameGeneration: {
      generate: () => {
        if (nameGenerationResult) {
          return Promise.resolve(nameGenerationResult);
        }
        return Promise.resolve({
          success: true as const,
          data: { name: "generated-minion", title: "Generated Minion", modelUsed: "mock" },
        });
      },
    },
    terminal: {
      activity: {
        subscribe: async function* (_input?: void, opts?: { signal?: AbortSignal }) {
          yield { type: "snapshot" as const, minions: {} };
          await new Promise<void>((resolve) => {
            if (opts?.signal?.aborted) {
              resolve();
              return;
            }
            opts?.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      },
      listSessions: (input: { minionId: string }) =>
        Promise.resolve(
          (terminalSessionIdsByMinion.get(input.minionId) ?? []).map((sessionId) => ({
            sessionId,
            profileId: null,
          }))
        ),
      create: (input: {
        minionId: string;
        cols: number;
        rows: number;
        initialCommand?: string;
      }) => {
        const sessionId = allocTerminalSessionId();
        registerTerminalSession({
          sessionId,
          minionId: input.minionId,
          cols: input.cols,
          rows: input.rows,
          // Leave the terminal visually empty by default; data-rich stories can override via
          // MockTerminalSession.screenState.
          screenState: "",
        });

        return Promise.resolve({
          sessionId,
          minionId: input.minionId,
          cols: input.cols,
          rows: input.rows,
        });
      },
      close: (input: { sessionId: string }) => {
        const session = terminalSessionsById.get(input.sessionId);
        if (session) {
          terminalSessionsById.delete(input.sessionId);
          const ids = terminalSessionIdsByMinion.get(session.minionId) ?? [];
          terminalSessionIdsByMinion.set(
            session.minionId,
            ids.filter((id) => id !== input.sessionId)
          );
        }
        return Promise.resolve(undefined);
      },
      resize: (input: { sessionId: string; cols: number; rows: number }) => {
        const session = terminalSessionsById.get(input.sessionId);
        if (session) {
          terminalSessionsById.set(input.sessionId, {
            ...session,
            cols: input.cols,
            rows: input.rows,
          });
        }
        return Promise.resolve(undefined);
      },
      sendInput: () => undefined,
      attach: async function* (input: { sessionId: string }, opts?: { signal?: AbortSignal }) {
        const session = terminalSessionsById.get(input.sessionId);
        yield { type: "screenState", data: session?.screenState ?? "" };

        for (const chunk of session?.outputChunks ?? []) {
          yield { type: "output", data: chunk };
        }

        // Keep the iterator alive until the caller aborts. The real backend streams output
        // indefinitely; Storybook uses abort to clean up on story change.
        if (opts?.signal) {
          if (opts.signal.aborted) {
            return;
          }
          await new Promise<void>((resolve) => {
            opts.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        }

        await new Promise<void>(() => undefined);
      },
      onExit: async function* (_input: { sessionId: string }, opts?: { signal?: AbortSignal }) {
        yield* [];
        if (opts?.signal) {
          if (opts.signal.aborted) {
            return;
          }
          await new Promise<void>((resolve) => {
            opts.signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return;
        }

        await new Promise<void>(() => undefined);
      },
      openWindow: () => Promise.resolve(undefined),
      closeWindow: () => Promise.resolve(undefined),
      openNative: () => Promise.resolve(undefined),
    },
    update: {
      check: () => Promise.resolve(undefined),
      download: () => Promise.resolve(undefined),
      install: () => Promise.resolve(undefined),
      onStatus: async function* () {
        yield* [];
        await new Promise<void>(() => undefined);
      },
      getChannel: () => Promise.resolve("stable" as const),
      setChannel: () => Promise.resolve(undefined),
    },
    policy: {
      get: () => Promise.resolve(policyResponse),
      onChanged: async function* () {
        yield* [];
        await new Promise<void>(() => undefined);
      },
      refreshNow: () => Promise.resolve({ success: true as const, value: policyResponse }),
    },
    latticeGovernorOauth: {
      startDesktopFlow: () =>
        Promise.resolve({
          success: true as const,
          value: {
            flowId: "mock-flow-id",
            authorizeUrl: "https://governor.example.com/oauth/authorize",
            redirectUri: "http://localhost:12345/callback",
          },
        }),
      waitForDesktopFlow: () =>
        // Never resolves - user would complete in browser
        new Promise(() => undefined),
      cancelDesktopFlow: () => Promise.resolve(undefined),
    },
  } as unknown as APIClient;
}
