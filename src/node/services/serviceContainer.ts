import * as path from "path";
import * as fsPromises from "fs/promises";
import {
  LATTICE_HELP_CHAT_AGENT_ID,
  LATTICE_HELP_CHAT_MINION_ID,
  LATTICE_HELP_CHAT_MINION_NAME,
  LATTICE_HELP_CHAT_MINION_TITLE,
} from "@/common/constants/latticeChat";
import { getLatticeHelpChatProjectPath } from "@/node/constants/latticeChat";
import { getInboxesProjectPath } from "@/node/constants/inboxProject";
import {
  INBOXES_PROJECT_MINION_ID,
  INBOXES_PROJECT_MINION_NAME,
  INBOXES_PROJECT_MINION_TITLE,
} from "@/common/constants/inboxProject";
import { createLatticeMessage } from "@/common/types/message";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";
import { createCoreServices, type CoreServices } from "@/node/services/coreServices";
import { PTYService } from "@/node/services/ptyService";
import type { TerminalWindowManager } from "@/desktop/terminalWindowManager";
import { ProjectService } from "@/node/services/projectService";
import { LatticeGovernorOauthService } from "@/node/services/latticeGovernorOauthService";
import { CodexOauthService } from "@/node/services/codexOauthService";
import { CopilotOauthService } from "@/node/services/copilotOauthService";
import { AnthropicOauthService } from "@/node/services/anthropicOauthService";
import { TerminalService } from "@/node/services/terminalService";
import { EditorService } from "@/node/services/editorService";
import { WindowService } from "@/node/services/windowService";
import { UpdateService } from "@/node/services/updateService";
import { TokenizerService } from "@/node/services/tokenizerService";
import { ServerService } from "@/node/services/serverService";
import { MenuEventService } from "@/node/services/menuEventService";
import { VoiceService } from "@/node/services/voiceService";
import { TelemetryService } from "@/node/services/telemetryService";
import type {
  ReasoningDeltaEvent,
  StreamAbortEvent,
  StreamDeltaEvent,
  StreamEndEvent,
  StreamStartEvent,
  ToolCallDeltaEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from "@/common/types/stream";
import { FeatureFlagService } from "@/node/services/featureFlagService";
import { SessionTimingService } from "@/node/services/sessionTimingService";
import { AnalyticsService } from "@/node/services/analytics/analyticsService";
import { ExperimentsService } from "@/node/services/experimentsService";
import { MinionMcpOverridesService } from "@/node/services/minionMcpOverridesService";
import { McpOauthService } from "@/node/services/mcpOauthService";
import { IdleCompactionService } from "@/node/services/idleCompactionService";
import { getSigningService, type SigningService } from "@/node/services/signingService";
import { latticeService, type LatticeService } from "@/node/services/latticeService";
import { SshPromptService } from "@/node/services/sshPromptService";
import { MinionLifecycleHooks } from "@/node/services/minionLifecycleHooks";
import {
  createStartLatticeOnUnarchiveHook,
  createStopLatticeOnArchiveHook,
} from "@/node/runtime/latticeLifecycleHooks";
import { setGlobalLatticeService } from "@/node/runtime/runtimeFactory";
import { setSshPromptService } from "@/node/runtime/sshConnectionPool";
import { setSshPromptService as setSSH2SshPromptService } from "@/node/runtime/SSH2ConnectionPool";
import { PolicyService } from "@/node/services/policyService";
import { ServerAuthService } from "@/node/services/serverAuthService";
import { KanbanService } from "@/node/services/kanbanService";
import { ExoService } from "@/node/services/exoService";
import { SchedulerService } from "@/node/services/schedulerService";
import { SyncService } from "@/node/services/syncService";
import { InboxService } from "@/node/services/inboxService";
import { TelegramAdapter } from "@/node/services/inbox/telegramAdapter";
import type { ORPCContext } from "@/node/orpc/context";

const LATTICE_HELP_CHAT_WELCOME_MESSAGE_ID = "lattice-chat-welcome";
const LATTICE_HELP_CHAT_WELCOME_MESSAGE = `Hi, I'm Lattice.

This is your built-in **Chat with Lattice** minion — a safe place to ask questions about Lattice itself.

I can help you:
- Configure global agent behavior by editing **~/.lattice/AGENTS.md** (I'll show a diff and ask before writing).
- Pick models/providers and explain Lattice modes + tool policies.
- Troubleshoot common setup issues (keys, runtimes, minions, etc.).

Try asking:
- "What does AGENTS.md do?"
- "Help me write global instructions for code reviews"
- "How do I set up an OpenAI / Anthropic key in Lattice?"
`;

/**
 * ServiceContainer - Central dependency container for all backend services.
 *
 * This class instantiates and wires together all services needed by the ORPC router.
 * Services are accessed via the ORPC context object.
 */
export class ServiceContainer {
  public readonly config: Config;
  // Core services — instantiated by createCoreServices (shared with `lattice run` CLI)
  private readonly historyService: CoreServices["historyService"];
  public readonly aiService: CoreServices["aiService"];
  public readonly minionService: CoreServices["minionService"];
  public readonly taskService: CoreServices["taskService"];
  public readonly providerService: CoreServices["providerService"];
  public readonly mcpConfigService: CoreServices["mcpConfigService"];
  public readonly mcpServerManager: CoreServices["mcpServerManager"];
  public readonly sessionUsageService: CoreServices["sessionUsageService"];
  private readonly extensionMetadata: CoreServices["extensionMetadata"];
  private readonly backgroundProcessManager: CoreServices["backgroundProcessManager"];
  // Desktop-only services
  public readonly projectService: ProjectService;
  public readonly latticeGovernorOauthService: LatticeGovernorOauthService;
  public readonly codexOauthService: CodexOauthService;
  public readonly copilotOauthService: CopilotOauthService;
  public readonly anthropicOauthService: AnthropicOauthService;
  public readonly terminalService: TerminalService;
  public readonly editorService: EditorService;
  public readonly windowService: WindowService;
  public readonly updateService: UpdateService;
  public readonly tokenizerService: TokenizerService;
  public readonly serverService: ServerService;
  public readonly menuEventService: MenuEventService;
  public readonly voiceService: VoiceService;
  public readonly mcpOauthService: McpOauthService;
  public readonly minionMcpOverridesService: MinionMcpOverridesService;
  public readonly telemetryService: TelemetryService;
  public readonly featureFlagService: FeatureFlagService;
  public readonly sessionTimingService: SessionTimingService;
  public readonly analyticsService: AnalyticsService;
  public readonly experimentsService: ExperimentsService;
  public readonly signingService: SigningService;
  public readonly policyService: PolicyService;
  public readonly latticeService: LatticeService;
  public readonly serverAuthService: ServerAuthService;
  public readonly kanbanService: KanbanService;
  public readonly exoService: ExoService;
  public readonly schedulerService: SchedulerService;
  public readonly syncService: SyncService;
  public readonly inboxService: InboxService;
  public readonly sshPromptService = new SshPromptService();
  private readonly ptyService: PTYService;
  public readonly idleCompactionService: IdleCompactionService;

  constructor(config: Config) {
    this.config = config;

    // Cross-cutting services: created first so they can be passed to core
    // services via constructor params (no setter injection needed).
    this.policyService = new PolicyService(config);
    this.telemetryService = new TelemetryService(config.rootDir);
    this.experimentsService = new ExperimentsService({
      telemetryService: this.telemetryService,
      latticeHome: config.rootDir,
    });
    this.sessionTimingService = new SessionTimingService(config, this.telemetryService);
    this.analyticsService = new AnalyticsService(config);

    // Desktop passes MinionMcpOverridesService explicitly so AIService uses
    // the persistent config rather than creating a default with an ephemeral one.
    this.minionMcpOverridesService = new MinionMcpOverridesService(config);

    const core = createCoreServices({
      config,
      extensionMetadataPath: path.join(config.rootDir, "extensionMetadata.json"),
      minionMcpOverridesService: this.minionMcpOverridesService,
      policyService: this.policyService,
      telemetryService: this.telemetryService,
      experimentsService: this.experimentsService,
      sessionTimingService: this.sessionTimingService,
    });

    // Spread core services into class fields
    this.historyService = core.historyService;
    this.aiService = core.aiService;
    this.minionService = core.minionService;
    this.taskService = core.taskService;
    this.providerService = core.providerService;
    this.mcpConfigService = core.mcpConfigService;
    this.mcpServerManager = core.mcpServerManager;
    this.sessionUsageService = core.sessionUsageService;
    this.extensionMetadata = core.extensionMetadata;
    this.backgroundProcessManager = core.backgroundProcessManager;

    this.projectService = new ProjectService(config, this.sshPromptService);

    // Idle compaction service - auto-compacts minions after configured idle period
    this.idleCompactionService = new IdleCompactionService(
      config,
      this.historyService,
      this.extensionMetadata,
      (minionId) => this.minionService.executeIdleCompaction(minionId)
    );
    this.windowService = new WindowService();
    this.mcpOauthService = new McpOauthService(
      config,
      this.mcpConfigService,
      this.windowService,
      this.telemetryService
    );
    this.mcpServerManager.setMcpOauthService(this.mcpOauthService);

    this.latticeGovernorOauthService = new LatticeGovernorOauthService(
      config,
      this.windowService,
      this.policyService
    );
    this.codexOauthService = new CodexOauthService(
      config,
      this.providerService,
      this.windowService
    );
    this.aiService.setCodexOauthService(this.codexOauthService);
    this.copilotOauthService = new CopilotOauthService(this.providerService, this.windowService);
    this.anthropicOauthService = new AnthropicOauthService(
      config,
      this.providerService,
      this.windowService
    );
    this.aiService.setAnthropicOauthService(this.anthropicOauthService);
    // Terminal services - PTYService is cross-platform
    this.ptyService = new PTYService();
    this.kanbanService = new KanbanService(config);
    this.exoService = new ExoService();
    // Inbox service — manages channel adapters (Telegram, Slack, etc.)
    this.inboxService = new InboxService(config);
    // Wire agent dispatch dependencies into inbox service (setter injection
    // to avoid circular deps — minionService + aiService are created earlier)
    this.inboxService.setMinionService(this.minionService);
    this.inboxService.setAIService(this.aiService);
    // Register channel adapters based on config (startup-safe: individual failures don't crash)
    this.registerInboxAdapters();
    this.terminalService = new TerminalService(config, this.ptyService);
    // Wire kanban service into terminal service for lifecycle tracking
    this.terminalService.setKanbanService(this.kanbanService);
    // Scheduler service — late-binds minion service to send agent messages
    this.schedulerService = new SchedulerService(config);
    this.schedulerService.setMinionService(this.minionService);

    // Sync service — mirrors config to a private GitHub repo
    this.syncService = new SyncService(config);
    // Wire terminal service to minion service for cleanup on removal
    this.minionService.setTerminalService(this.terminalService);
    // Editor service for opening minions in code editors
    this.editorService = new EditorService(config);
    this.updateService = new UpdateService(this.config);
    this.tokenizerService = new TokenizerService(this.sessionUsageService);
    this.serverService = new ServerService();
    this.menuEventService = new MenuEventService();
    this.voiceService = new VoiceService(config, this.policyService);
    this.featureFlagService = new FeatureFlagService(config, this.telemetryService);
    this.signingService = getSigningService();
    this.latticeService = latticeService;

    this.serverAuthService = new ServerAuthService(config);

    const minionLifecycleHooks = new MinionLifecycleHooks();
    minionLifecycleHooks.registerBeforeArchive(
      createStopLatticeOnArchiveHook({
        latticeService: this.latticeService,
        shouldStopOnArchive: () =>
          this.config.loadConfigOrDefault().stopLatticeMinionOnArchive !== false,
      })
    );
    minionLifecycleHooks.registerAfterUnarchive(
      createStartLatticeOnUnarchiveHook({
        latticeService: this.latticeService,
        shouldStopOnArchive: () =>
          this.config.loadConfigOrDefault().stopLatticeMinionOnArchive !== false,
      })
    );
    this.minionService.setMinionLifecycleHooks(minionLifecycleHooks);

    // Register globally so all createRuntime calls can create LatticeSSHRuntime
    setGlobalLatticeService(this.latticeService);
    setSshPromptService(this.sshPromptService);
    setSSH2SshPromptService(this.sshPromptService);

    // Backend timing stats (behind feature flag).
    this.aiService.on("stream-start", (data: StreamStartEvent) =>
      this.sessionTimingService.handleStreamStart(data)
    );
    this.aiService.on("stream-delta", (data: StreamDeltaEvent) =>
      this.sessionTimingService.handleStreamDelta(data)
    );
    this.aiService.on("reasoning-delta", (data: ReasoningDeltaEvent) =>
      this.sessionTimingService.handleReasoningDelta(data)
    );
    this.aiService.on("tool-call-start", (data: ToolCallStartEvent) =>
      this.sessionTimingService.handleToolCallStart(data)
    );
    this.aiService.on("tool-call-delta", (data: ToolCallDeltaEvent) =>
      this.sessionTimingService.handleToolCallDelta(data)
    );
    this.aiService.on("tool-call-end", (data: ToolCallEndEvent) =>
      this.sessionTimingService.handleToolCallEnd(data)
    );
    this.aiService.on("stream-end", (data: StreamEndEvent) => {
      this.sessionTimingService.handleStreamEnd(data);

      const minionLookup = this.config.findMinion(data.minionId);
      const sessionDir = this.config.getSessionDir(data.minionId);
      this.analyticsService.ingestMinion(data.minionId, sessionDir, {
        projectPath: minionLookup?.projectPath,
        projectName: minionLookup?.projectPath
          ? path.basename(minionLookup.projectPath)
          : undefined,
      });
    });
    // MinionService emits metadata:null after successful remove().
    // Clear analytics rows immediately so deleted minions disappear from stats
    // without waiting for a future ingest pass.
    this.minionService.on("metadata", (event) => {
      if (event.metadata !== null) {
        return;
      }

      this.analyticsService.clearMinion(event.minionId);
    });

    this.aiService.on("stream-abort", (data: StreamAbortEvent) =>
      this.sessionTimingService.handleStreamAbort(data)
    );
  }

  async initialize(): Promise<void> {
    await this.extensionMetadata.initialize();
    // Check config-level telemetry preference before initializing
    if (!this.config.getTelemetryEnabled()) {
      this.telemetryService._configDisabled = true;
    }
    // Initialize telemetry service (skips PostHog setup if _configDisabled)
    await this.telemetryService.initialize();

    // Initialize policy service (startup gating)
    await this.policyService.initialize();

    // Initialize feature flag state (don't block startup on network).
    this.featureFlagService
      .getStatsTabState()
      .then((state) => this.sessionTimingService.setStatsTabState(state))
      .catch(() => {
        // Ignore feature flag failures.
      });
    await this.experimentsService.initialize();
    await this.taskService.initialize();
    // Start idle compaction checker
    this.idleCompactionService.start();
    // Initialize scheduler (loads jobs, arms timers)
    this.schedulerService.initialize();

    // Initialize sync (verifies repo if configured, starts auto-sync watcher)
    this.syncService.initialize();

    // Refresh Lattice SSH config in background (handles binary path changes on restart)
    // Skip getLatticeInfo() to avoid caching "unavailable" if lattice isn't installed yet
    void this.latticeService.ensureSSHConfig().catch(() => {
      // Ignore errors - lattice may not be installed
    });

    // Connect inbox channel adapters (startup-safe: never crashes the app).
    // Each adapter connects independently — one failure doesn't block others.
    try {
      await this.inboxService.connectAll();
    } catch (error) {
      log.warn("[ServiceContainer] Failed to connect inbox adapters", { error });
    }

    // Ensure the built-in Chat with Lattice system minion exists.
    // Defensive: startup-time initialization must never crash the app.
    try {
      await this.ensureLatticeChatMinion();
    } catch (error) {
      log.warn("[ServiceContainer] Failed to ensure Chat with Lattice minion", { error });
    }

    // Ensure the dedicated Inboxes system project exists so all channel
    // adapter conversations (Telegram, WhatsApp, etc.) consolidate there.
    try {
      await this.ensureInboxesProject();
    } catch (error) {
      log.warn("[ServiceContainer] Failed to ensure Inboxes project", { error });
    }
  }

  /**
   * Register channel adapters based on config.
   * Called once at construction time. Each adapter's connect() is deferred
   * to initialize() → connectAll() so startup never blocks on network I/O.
   */
  private registerInboxAdapters(): void {
    // Telegram: register if bot token is configured
    const telegramToken = this.config.getTelegramBotToken();
    if (telegramToken) {
      this.inboxService.registerAdapter(new TelegramAdapter(telegramToken));
    }
    // Future: add Slack, Discord, etc. adapters here as they are implemented
  }

  private async ensureLatticeChatMinion(): Promise<void> {
    const projectPath = getLatticeHelpChatProjectPath(this.config.rootDir);

    // Ensure the directory exists (LocalRuntime uses project dir directly).
    await fsPromises.mkdir(projectPath, { recursive: true });

    await this.config.editConfig((config) => {
      // Dev builds can run with a different LATTICE_ROOT (for example ~/.lattice-dev).
      // If config.json still has the built-in lattice-chat minion under an older root
      // (for example ~/.lattice), the sidebar can show duplicate "Chat with Lattice" entries.
      // Only treat entries as stale when they still look like a system Lattice project so
      // we do not delete unrelated legacy user minions whose generated ID happened
      // to collide with "lattice-chat" (e.g. project basename "lattice" + minion "chat").
      const staleProjectPaths: string[] = [];
      for (const [existingProjectPath, existingProjectConfig] of config.projects) {
        if (existingProjectPath === projectPath) {
          continue;
        }

        const isSystemLatticeProjectPath =
          path.basename(existingProjectPath) === "Lattice" &&
          path.basename(path.dirname(existingProjectPath)) === "system";

        if (!isSystemLatticeProjectPath) {
          continue;
        }

        existingProjectConfig.minions = existingProjectConfig.minions.filter((minion) => {
          const isLatticeChatMinion = minion.id === LATTICE_HELP_CHAT_MINION_ID;
          if (!isLatticeChatMinion) {
            return true;
          }

          const looksLikeSystemLatticeChat =
            minion.agentId === LATTICE_HELP_CHAT_AGENT_ID ||
            minion.path === existingProjectPath ||
            minion.name === LATTICE_HELP_CHAT_MINION_NAME ||
            minion.title === LATTICE_HELP_CHAT_MINION_TITLE;

          return !looksLikeSystemLatticeChat;
        });

        if (existingProjectConfig.minions.length === 0) {
          staleProjectPaths.push(existingProjectPath);
        }
      }

      for (const staleProjectPath of staleProjectPaths) {
        config.projects.delete(staleProjectPath);
      }

      let projectConfig = config.projects.get(projectPath);
      if (!projectConfig) {
        projectConfig = { minions: [] };
        config.projects.set(projectPath, projectConfig);
      }

      const existing = projectConfig.minions.find((w) => w.id === LATTICE_HELP_CHAT_MINION_ID);

      // Self-heal: enforce invariants for the system minion and collapse duplicates
      // in the active system project down to exactly one lattice-chat entry.
      const latticeChatMinion = {
        ...existing,
        path: projectPath,
        id: LATTICE_HELP_CHAT_MINION_ID,
        name: LATTICE_HELP_CHAT_MINION_NAME,
        title: LATTICE_HELP_CHAT_MINION_TITLE,
        agentId: LATTICE_HELP_CHAT_AGENT_ID,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        runtimeConfig: { type: "local" } as const,
        archivedAt: undefined,
        unarchivedAt: undefined,
      };

      projectConfig.minions = [
        ...projectConfig.minions.filter(
          (minion) => minion.id !== LATTICE_HELP_CHAT_MINION_ID
        ),
        latticeChatMinion,
      ];

      return config;
    });

    await this.ensureLatticeChatWelcomeMessage();
  }

  /**
   * Ensure the dedicated Inboxes system project exists.
   * All channel adapter conversations (Telegram, WhatsApp, Slack, etc.)
   * consolidate under this single project instead of scattering across
   * user projects. Follows the same pattern as ensureLatticeChatMinion.
   */
  private async ensureInboxesProject(): Promise<void> {
    const projectPath = getInboxesProjectPath(this.config.rootDir);

    // Ensure the directory exists (LocalRuntime uses project dir directly).
    await fsPromises.mkdir(projectPath, { recursive: true });

    await this.config.editConfig((config) => {
      let projectConfig = config.projects.get(projectPath);
      if (!projectConfig) {
        projectConfig = { minions: [] };
        config.projects.set(projectPath, projectConfig);
      }

      // Ensure exactly one inbox-dispatch minion exists (self-heal on each startup)
      const existing = projectConfig.minions.find((w) => w.id === INBOXES_PROJECT_MINION_ID);

      const inboxMinion = {
        ...existing,
        path: projectPath,
        id: INBOXES_PROJECT_MINION_ID,
        name: INBOXES_PROJECT_MINION_NAME,
        title: INBOXES_PROJECT_MINION_TITLE,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        runtimeConfig: { type: "local" } as const,
        archivedAt: undefined,
        unarchivedAt: undefined,
      };

      projectConfig.minions = [
        ...projectConfig.minions.filter(
          (minion) => minion.id !== INBOXES_PROJECT_MINION_ID
        ),
        inboxMinion,
      ];

      return config;
    });

    log.info("[ServiceContainer] Inboxes system project ensured", { projectPath });
  }

  private async ensureLatticeChatWelcomeMessage(): Promise<void> {
    // Only need to check if any history exists — avoid parsing the entire file
    if (await this.historyService.hasHistory(LATTICE_HELP_CHAT_MINION_ID)) {
      return;
    }

    const message = createLatticeMessage(
      LATTICE_HELP_CHAT_WELCOME_MESSAGE_ID,
      "assistant",
      LATTICE_HELP_CHAT_WELCOME_MESSAGE,
      // Note: This message should be visible in the UI, so it must NOT be marked synthetic.
      { timestamp: Date.now() }
    );

    const appendResult = await this.historyService.appendToHistory(
      LATTICE_HELP_CHAT_MINION_ID,
      message
    );
    if (!appendResult.success) {
      log.warn("[ServiceContainer] Failed to seed lattice-chat welcome message", {
        error: appendResult.error,
      });
    }
  }

  /**
   * Build the ORPCContext from this container's services.
   * Centralizes the ServiceContainer → ORPCContext mapping so callers
   * (desktop/main.ts, cli/server.ts) don't duplicate a 30-field spread.
   */
  toORPCContext(): Omit<ORPCContext, "headers"> {
    return {
      config: this.config,
      aiService: this.aiService,
      projectService: this.projectService,
      minionService: this.minionService,
      taskService: this.taskService,
      providerService: this.providerService,
      latticeGovernorOauthService: this.latticeGovernorOauthService,
      codexOauthService: this.codexOauthService,
      copilotOauthService: this.copilotOauthService,
      anthropicOauthService: this.anthropicOauthService,
      terminalService: this.terminalService,
      editorService: this.editorService,
      windowService: this.windowService,
      updateService: this.updateService,
      tokenizerService: this.tokenizerService,
      serverService: this.serverService,
      menuEventService: this.menuEventService,
      voiceService: this.voiceService,
      mcpConfigService: this.mcpConfigService,
      mcpOauthService: this.mcpOauthService,
      minionMcpOverridesService: this.minionMcpOverridesService,
      mcpServerManager: this.mcpServerManager,
      featureFlagService: this.featureFlagService,
      sessionTimingService: this.sessionTimingService,
      telemetryService: this.telemetryService,
      experimentsService: this.experimentsService,
      sessionUsageService: this.sessionUsageService,
      policyService: this.policyService,
      signingService: this.signingService,
      latticeService: this.latticeService,
      serverAuthService: this.serverAuthService,
      sshPromptService: this.sshPromptService,
      analyticsService: this.analyticsService,
      kanbanService: this.kanbanService,
      exoService: this.exoService,
      schedulerService: this.schedulerService,
      syncService: this.syncService,
      inboxService: this.inboxService,
    };
  }

  /**
   * Shutdown services that need cleanup
   */
  async shutdown(): Promise<void> {
    this.idleCompactionService.stop();
    await this.analyticsService.dispose();
    await this.telemetryService.shutdown();
  }

  setProjectDirectoryPicker(picker: () => Promise<string | null>): void {
    this.projectService.setDirectoryPicker(picker);
  }

  setTerminalWindowManager(manager: TerminalWindowManager): void {
    this.terminalService.setTerminalWindowManager(manager);
  }

  /**
   * Dispose all services. Called on app quit to clean up resources.
   * Terminates all background processes to prevent orphans.
   */
  async dispose(): Promise<void> {
    // Persist inbox + kanban state before terminal cleanup
    await this.inboxService.stop();
    await this.kanbanService.saveAll();
    // Persist terminal screen buffers BEFORE killing PTY processes.
    // This must happen first — once PTYs are killed the screen state is lost.
    await this.terminalService.saveAllSessions();
    this.terminalService.closeAllSessions();

    await this.analyticsService.dispose();
    this.exoService.dispose();
    this.policyService.dispose();
    this.mcpServerManager.dispose();
    await this.mcpOauthService.dispose();
    await this.latticeGovernorOauthService.dispose();
    await this.codexOauthService.dispose();

    this.copilotOauthService.dispose();
    this.anthropicOauthService.dispose();
    this.serverAuthService.dispose();
    await this.backgroundProcessManager.terminateAll();
  }
}
