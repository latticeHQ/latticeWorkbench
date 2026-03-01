import * as fs from "fs/promises";
import { EventEmitter } from "events";

import { type LanguageModel, type Tool } from "ai";

import { linkAbortSignal } from "@/node/utils/abort";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import type { MinionMetadata } from "@/common/types/minion";
import type { SendMessageOptions, ProvidersConfigMap } from "@/common/orpc/types";

import type { DebugLlmRequestSnapshot } from "@/common/types/debugLlmRequest";

import type { LatticeMessage } from "@/common/types/message";
import { createLatticeMessage } from "@/common/types/message";
import type { Config } from "@/node/config";
import { StreamManager } from "./streamManager";
import type { InitStateManager } from "./initStateManager";
import type { SendMessageError } from "@/common/types/errors";
import { getToolsForModel } from "@/common/utils/tools/tools";
import { cloneToolPreservingDescriptors } from "@/common/utils/tools/cloneToolPreservingDescriptors";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import { getLatticeEnv, getRuntimeType } from "@/node/runtime/initHook";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { secretsToRecord } from "@/common/types/secrets";
import type { LatticeProviderOptions } from "@/common/types/providerOptions";
import type { PolicyService } from "@/node/services/policyService";
import type { ProviderService } from "@/node/services/providerService";
import type { CodexOauthService } from "@/node/services/codexOauthService";
import type { AnthropicOauthService } from "@/node/services/anthropicOauthService";
import type { BackgroundProcessManager } from "@/node/services/backgroundProcessManager";
import type { FileState, EditedFileAttachment } from "@/node/services/agentSession";
import { log } from "./log";
import {
  addInterruptedSentinel,
  filterEmptyAssistantMessages,
} from "@/browser/utils/messages/modelMessageTransform";
import type { PostCompactionAttachment } from "@/common/types/attachment";

import type { HistoryService } from "./historyService";
import { delegatedToolCallManager } from "./delegatedToolCallManager";
import { createErrorEvent } from "./utils/sendMessageError";
import { createAssistantMessageId } from "./utils/messageIds";
import type { SessionUsageService } from "./sessionUsageService";
import { sumUsageHistory, getTotalCost } from "@/common/utils/tokens/usageAggregator";
import { readToolInstructions } from "./systemMessage";
import type { TelemetryService } from "@/node/services/telemetryService";

import type { MinionMCPOverrides } from "@/common/types/mcp";
import type { MCPServerManager, MCPMinionStats } from "@/node/services/mcpServerManager";
import { MinionMcpOverridesService } from "./minionMcpOverridesService";
import type { TaskService } from "@/node/services/taskService";
import { buildProviderOptions, buildRequestHeaders } from "@/common/utils/ai/providerOptions";
import { sliceMessagesFromLatestCompactionBoundary } from "@/common/utils/messages/compactionBoundary";

import { THINKING_LEVEL_OFF, type ThinkingLevel } from "@/common/types/thinking";

import type { StreamAbortEvent, StreamAbortReason, StreamEndEvent } from "@/common/types/stream";
import type { ToolPolicy } from "@/common/utils/tools/toolPolicy";
import type { PTCEventWithParent } from "@/node/services/tools/code_execution";
import { MockAiStreamPlayer } from "./mock/mockAiStreamPlayer";
import { ProviderModelFactory, modelCostsIncluded } from "./providerModelFactory";
import { wrapToolsWithSystem1 } from "./system1ToolWrapper";
import { prepareMessagesForProvider } from "./messagePipeline";
import { resolveAgentForStream } from "./agentResolution";
import { buildPlanInstructions, buildStreamSystemContext } from "./streamContextBuilder";
import {
  simulateContextLimitError,
  simulateToolPolicyNoop,
  type SimulationContext,
} from "./streamSimulation";
import { applyToolPolicyAndExperiments, captureMcpToolTelemetry } from "./toolAssembly";
import { getErrorMessage } from "@/common/utils/errors";

// ---------------------------------------------------------------------------
// streamMessage options
// ---------------------------------------------------------------------------

/** Options bag for {@link AIService.streamMessage}. */
export interface StreamMessageOptions {
  messages: LatticeMessage[];
  minionId: string;
  modelString: string;
  thinkingLevel?: ThinkingLevel;
  toolPolicy?: ToolPolicy;
  abortSignal?: AbortSignal;
  additionalSystemInstructions?: string;
  maxOutputTokens?: number;
  latticeProviderOptions?: LatticeProviderOptions;
  agentId?: string;
  /** ACP prompt correlation id used to match stream events to a specific request. */
  acpPromptId?: string;
  /** Tool names that should be delegated back to ACP clients for this request. */
  delegatedToolNames?: string[];
  recordFileState?: (filePath: string, state: FileState) => void;
  changedFileAttachments?: EditedFileAttachment[];
  postCompactionAttachments?: PostCompactionAttachment[] | null;
  experiments?: SendMessageOptions["experiments"];
  system1Model?: string;
  system1ThinkingLevel?: ThinkingLevel;
  disableMinionAgents?: boolean;
  hasQueuedMessage?: () => boolean;
  openaiTruncationModeOverride?: "auto" | "disabled";
}

// ---------------------------------------------------------------------------
// Utility: deep-clone with structuredClone fallback
// ---------------------------------------------------------------------------

/** Deep-clone a value using structuredClone (with JSON fallback). */
function safeClone<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

interface ToolExecutionContext {
  toolCallId?: string;
  abortSignal?: AbortSignal;
}

function isToolExecutionContext(value: unknown): value is ToolExecutionContext {
  if (typeof value !== "object" || value == null || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const toolCallId = record.toolCallId;
  const abortSignal = record.abortSignal;

  const validToolCallId = toolCallId == null || typeof toolCallId === "string";
  const validAbortSignal = abortSignal == null || abortSignal instanceof AbortSignal;

  return validToolCallId && validAbortSignal;
}

export class AIService extends EventEmitter {
  private readonly streamManager: StreamManager;
  private readonly historyService: HistoryService;
  private readonly config: Config;
  private readonly minionMcpOverridesService: MinionMcpOverridesService;
  private mcpServerManager?: MCPServerManager;
  private readonly policyService?: PolicyService;
  private readonly telemetryService?: TelemetryService;
  private readonly initStateManager: InitStateManager;
  private mockModeEnabled: boolean;
  private mockAiStreamPlayer?: MockAiStreamPlayer;
  private readonly backgroundProcessManager?: BackgroundProcessManager;
  private readonly sessionUsageService?: SessionUsageService;
  private readonly providerService: ProviderService;
  private readonly providerModelFactory: ProviderModelFactory;

  // Tracks in-flight stream startup (before StreamManager emits stream-start).
  // This enables user interrupts (Esc/Ctrl+C) during the UI "starting..." phase.
  private readonly pendingStreamStarts = new Map<
    string,
    {
      abortController: AbortController;
      startTime: number;
      syntheticMessageId: string;
      acpPromptId?: string;
    }
  >();

  // Debug: captured LLM request payloads for last send per minion
  private lastLlmRequestByMinion = new Map<string, DebugLlmRequestSnapshot>();
  private taskService?: TaskService;
  private extraTools?: Record<string, Tool>;

  constructor(
    config: Config,
    historyService: HistoryService,
    initStateManager: InitStateManager,
    providerService: ProviderService,
    backgroundProcessManager?: BackgroundProcessManager,
    sessionUsageService?: SessionUsageService,
    minionMcpOverridesService?: MinionMcpOverridesService,
    policyService?: PolicyService,
    telemetryService?: TelemetryService
  ) {
    super();
    // Increase max listeners to accommodate multiple concurrent minion listeners
    // Each minion subscribes to stream events, and we expect >10 concurrent minions
    this.setMaxListeners(50);
    this.minionMcpOverridesService =
      minionMcpOverridesService ?? new MinionMcpOverridesService(config);
    this.config = config;
    this.historyService = historyService;
    this.initStateManager = initStateManager;
    this.backgroundProcessManager = backgroundProcessManager;
    this.sessionUsageService = sessionUsageService;
    this.policyService = policyService;
    this.telemetryService = telemetryService;
    this.providerService = providerService;
    this.streamManager = new StreamManager(historyService, sessionUsageService, () =>
      this.providerService.getConfig()
    );
    this.providerModelFactory = new ProviderModelFactory(config, providerService, policyService);
    void this.ensureSessionsDir();
    this.setupStreamEventForwarding();
    this.mockModeEnabled = false;

    if (process.env.LATTICE_MOCK_AI === "1") {
      log.info("AIService running in LATTICE_MOCK_AI mode");
      this.enableMockMode();
    }
  }

  setCodexOauthService(service: CodexOauthService): void {
    this.providerModelFactory.codexOauthService = service;
  }
  setAnthropicOauthService(service: AnthropicOauthService): void {
    this.providerModelFactory.anthropicOauthService = service;
  }
  setMCPServerManager(manager: MCPServerManager): void {
    this.mcpServerManager = manager;
    this.streamManager.setMCPServerManager(manager);
  }

  setTaskService(taskService: TaskService): void {
    this.taskService = taskService;
  }

  getProvidersConfig(): ProvidersConfigMap | null {
    return this.providerService.getConfig();
  }

  /**
   * Set extra tools to include in every tool call.
   * Used by CLI to inject tools like set_exit_code without modifying core tool definitions.
   */
  setExtraTools(tools: Record<string, Tool>): void {
    this.extraTools = tools;
  }

  /**
   * Forward all stream events from StreamManager to AIService consumers
   */
  private setupStreamEventForwarding(): void {
    // Simple one-to-one event forwarding from StreamManager → AIService consumers
    for (const event of [
      "stream-start",
      "stream-delta",
      "error",
      "tool-call-start",
      "tool-call-delta",
      "tool-call-end",
      "reasoning-delta",
      "reasoning-end",
      "usage-delta",
    ] as const) {
      this.streamManager.on(event, (data) => this.emit(event, data));
    }

    // stream-end needs extra logic: capture provider response for debug modal
    this.streamManager.on("stream-end", (data: StreamEndEvent) => {
      // Best-effort capture of the provider response for the "Last LLM request" debug modal.
      // Must never break live streaming.
      try {
        const snapshot = this.lastLlmRequestByMinion.get(data.minionId);
        if (snapshot) {
          // If messageId is missing (legacy fixtures), attach anyway.
          const shouldAttach = snapshot.messageId === data.messageId || snapshot.messageId == null;
          if (shouldAttach) {
            const updated: DebugLlmRequestSnapshot = {
              ...snapshot,
              response: {
                capturedAt: Date.now(),
                metadata: data.metadata,
                parts: data.parts,
              },
            };

            this.lastLlmRequestByMinion.set(data.minionId, safeClone(updated));
          }
        }
      } catch (error) {
        const errMsg = getErrorMessage(error);
        log.warn("Failed to capture debug LLM response snapshot", { error: errMsg });
      }

      this.emit("stream-end", data);
    });

    // Handle stream-abort: dispose of partial based on abandonPartial flag
    this.streamManager.on("stream-abort", (data: StreamAbortEvent) => {
      void (async () => {
        try {
          if (data.abandonPartial) {
            // Caller requested discarding partial - delete without committing
            await this.historyService.deletePartial(data.minionId);
          } else {
            // Commit interrupted message to history with partial:true metadata
            // This ensures /clear and /truncate can clean up interrupted messages
            const partial = await this.historyService.readPartial(data.minionId);
            if (partial) {
              await this.historyService.commitPartial(data.minionId);
              await this.historyService.deletePartial(data.minionId);
            }
          }
        } catch (error) {
          log.error("Failed partial cleanup during stream-abort", {
            minionId: data.minionId,
            error: getErrorMessage(error),
          });
        } finally {
          // Always forward abort event to consumers (minionService, agentSession)
          // even if partial cleanup failed — stream lifecycle consistency is higher priority.
          this.emit("stream-abort", data);
        }
      })();
    });
  }

  private async ensureSessionsDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.sessionsDir, { recursive: true });
    } catch (error) {
      log.error("Failed to create sessions directory:", error);
    }
  }

  isMockModeEnabled(): boolean {
    return this.mockModeEnabled;
  }

  releaseMockStreamStartGate(minionId: string): void {
    this.mockAiStreamPlayer?.releaseStreamStartGate(minionId);
  }

  enableMockMode(): void {
    this.mockModeEnabled = true;

    this.mockAiStreamPlayer ??= new MockAiStreamPlayer({
      aiService: this,
      historyService: this.historyService,
    });
  }

  async getMinionMetadata(minionId: string): Promise<Result<MinionMetadata>> {
    try {
      // Read from config.json (single source of truth)
      // getAllMinionMetadata() handles migration from legacy metadata.json files
      const allMetadata = await this.config.getAllMinionMetadata();
      const metadata = allMetadata.find((m) => m.id === minionId);

      if (!metadata) {
        return Err(
          `Minion metadata not found for ${minionId}. Minion may not be properly initialized.`
        );
      }

      return Ok(metadata);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to read minion metadata: ${message}`);
    }
  }

  /**
   * Create an AI SDK model from a model string (e.g., "anthropic:claude-opus-4-1").
   * Delegates to ProviderModelFactory.
   */
  async createModel(
    modelString: string,
    latticeProviderOptions?: LatticeProviderOptions
  ): Promise<Result<LanguageModel, SendMessageError>> {
    return this.providerModelFactory.createModel(modelString, latticeProviderOptions);
  }

  private wrapToolsForDelegation(
    minionId: string,
    tools: Record<string, Tool>,
    delegatedToolNames?: string[]
  ): Record<string, Tool> {
    const normalizedDelegatedTools =
      delegatedToolNames
        ?.map((toolName) => toolName.trim())
        .filter((toolName) => toolName.length > 0) ?? [];

    if (normalizedDelegatedTools.length === 0) {
      return tools;
    }

    const delegatedToolSet = new Set(normalizedDelegatedTools);
    const wrappedTools = { ...tools };

    for (const [toolName, tool] of Object.entries(tools)) {
      if (!delegatedToolSet.has(toolName)) {
        continue;
      }

      const toolRecord = tool as Record<string, unknown>;
      const execute = toolRecord.execute;
      if (typeof execute !== "function") {
        continue;
      }

      const wrappedTool = cloneToolPreservingDescriptors(tool);
      const wrappedToolRecord = wrappedTool as Record<string, unknown>;

      wrappedToolRecord.execute = async (_args: unknown, options: unknown) => {
        const executionContext = isToolExecutionContext(options) ? options : undefined;
        const toolCallId = executionContext?.toolCallId?.trim();

        if (executionContext == null || toolCallId == null || toolCallId.length === 0) {
          throw new Error(
            `Delegated tool '${toolName}' requires a non-empty toolCallId in execute context`
          );
        }

        const pendingResult = delegatedToolCallManager.registerPending(
          minionId,
          toolCallId,
          toolName
        );

        const abortSignal = executionContext.abortSignal;
        if (abortSignal == null) {
          return pendingResult;
        }

        if (abortSignal.aborted) {
          try {
            delegatedToolCallManager.cancel(minionId, toolCallId, "Interrupted");
          } catch {
            // no-op: pending may already have resolved
          }
          throw new Error("Interrupted");
        }

        let abortListener: (() => void) | undefined;
        const abortPromise = new Promise<never>((_, reject) => {
          abortListener = () => {
            try {
              delegatedToolCallManager.cancel(minionId, toolCallId, "Interrupted");
            } catch {
              // no-op: pending may already have resolved
            }
            reject(new Error("Interrupted"));
          };

          abortSignal.addEventListener("abort", abortListener, { once: true });
        });

        try {
          return await Promise.race([pendingResult, abortPromise]);
        } finally {
          if (abortListener != null) {
            abortSignal.removeEventListener("abort", abortListener);
          }
        }
      };

      wrappedTools[toolName] = wrappedTool;
    }

    return wrappedTools;
  }

  /** Stream a message conversation to the AI model. */
  async streamMessage(opts: StreamMessageOptions): Promise<Result<void, SendMessageError>> {
    const {
      messages,
      minionId,
      modelString,
      thinkingLevel,
      toolPolicy,
      abortSignal,
      additionalSystemInstructions,
      maxOutputTokens,
      latticeProviderOptions,
      agentId,
      acpPromptId,
      delegatedToolNames,
      recordFileState,
      changedFileAttachments,
      postCompactionAttachments,
      experiments,
      system1Model,
      system1ThinkingLevel,
      disableMinionAgents,
      hasQueuedMessage,
      openaiTruncationModeOverride,
    } = opts;
    // Support interrupts during startup (before StreamManager emits stream-start).
    // We register an AbortController up-front and let stopStream() abort it.
    const pendingAbortController = new AbortController();
    const startTime = Date.now();
    const syntheticMessageId = `starting-${startTime}-${Math.random().toString(36).substring(2, 11)}`;

    // Link external abort signal (if provided).
    const unlinkAbortSignal = linkAbortSignal(abortSignal, pendingAbortController);

    this.pendingStreamStarts.set(minionId, {
      abortController: pendingAbortController,
      startTime,
      syntheticMessageId,
      acpPromptId,
    });

    const combinedAbortSignal = pendingAbortController.signal;

    try {
      if (this.mockModeEnabled && this.mockAiStreamPlayer) {
        await this.initStateManager.waitForInit(minionId, combinedAbortSignal);
        if (combinedAbortSignal.aborted) {
          return Ok(undefined);
        }
        return await this.mockAiStreamPlayer.play(messages, minionId, {
          model: modelString,
          abortSignal: combinedAbortSignal,
        });
      }

      // DEBUG: Log streamMessage call
      const lastMessage = messages[messages.length - 1];
      log.debug(
        `[STREAM MESSAGE] minionId=${minionId} messageCount=${messages.length} lastRole=${lastMessage?.role}`
      );

      // Before starting a new stream, commit any existing partial to history
      // This is idempotent - won't double-commit if already in chat.jsonl
      await this.historyService.commitPartial(minionId);

      // Helper: clean up an assistant placeholder that was appended to history but never
      // streamed (due to abort during setup). Used in two abort-check sites below.
      const deleteAbortedPlaceholder = async (messageId: string): Promise<void> => {
        const deleteResult = await this.historyService.deleteMessage(minionId, messageId);
        if (!deleteResult.success) {
          log.error(
            `Failed to delete aborted assistant placeholder (${messageId}): ${deleteResult.error}`
          );
        }
      };

      // Mode (plan|exec|compact) is derived from the selected agent definition.
      const effectiveLatticeProviderOptions: LatticeProviderOptions = latticeProviderOptions ?? {};
      const effectiveThinkingLevel: ThinkingLevel = thinkingLevel ?? THINKING_LEVEL_OFF;

      // Resolve model string (xAI variant mapping) and create the model.

      const modelResult = await this.providerModelFactory.resolveAndCreateModel(
        modelString,
        effectiveThinkingLevel,
        effectiveLatticeProviderOptions
      );
      if (!modelResult.success) {
        return Err(modelResult.error);
      }
      const {
        effectiveModelString,
        canonicalModelString,
        canonicalProviderName,
        claudeCodeMode,
      } = modelResult.data;

      // Dump original messages for debugging
      log.debug_obj(`${minionId}/1_original_messages.json`, messages);

      // toolNamesForSentinel is set after agent resolution below, used in message pipeline.
      let toolNamesForSentinel: string[] = [];

      // Filter out assistant messages with only reasoning (no text/tools)
      // EXCEPTION: When extended thinking is enabled, preserve reasoning-only messages
      // to comply with Extended Thinking API requirements
      const preserveReasoningOnly =
        canonicalProviderName === "anthropic" && effectiveThinkingLevel !== "off";
      const filteredMessages = filterEmptyAssistantMessages(messages, preserveReasoningOnly);
      log.debug(`Filtered ${messages.length - filteredMessages.length} empty assistant messages`);
      log.debug_obj(`${minionId}/1a_filtered_messages.json`, filteredMessages);

      // WS2 request slicing: only send the latest compaction epoch to providers.
      // This is request-only; persisted history remains append-only for replay/debugging.
      const providerRequestMessages = sliceMessagesFromLatestCompactionBoundary(filteredMessages);
      if (providerRequestMessages !== filteredMessages) {
        log.debug("Sliced provider history from latest compaction boundary", {
          minionId,
          originalCount: filteredMessages.length,
          slicedCount: providerRequestMessages.length,
        });
      }
      log.debug_obj(`${minionId}/1b_provider_request_messages.json`, providerRequestMessages);

      // OpenAI-specific: Keep reasoning parts in history
      // OpenAI manages conversation state via previousResponseId
      if (canonicalProviderName === "openai") {
        log.debug("Keeping reasoning parts for OpenAI (managed via previousResponseId)");
      }
      // Add [CONTINUE] sentinel to partial messages (for model context)
      const messagesWithSentinel = addInterruptedSentinel(providerRequestMessages);

      // Get minion metadata to retrieve minion path
      const metadataResult = await this.getMinionMetadata(minionId);
      if (!metadataResult.success) {
        return Err({ type: "unknown", raw: metadataResult.error });
      }

      const metadata = metadataResult.data;

      if (this.policyService?.isEnforced()) {
        if (!this.policyService.isRuntimeAllowed(metadata.runtimeConfig)) {
          return Err({
            type: "policy_denied",
            message: "Minion runtime is not allowed by policy",
          });
        }
      }
      const minionLog = log.withFields({ minionId, minionName: metadata.name });

      if (!this.config.findMinion(minionId)) {
        return Err({ type: "unknown", raw: `Minion ${minionId} not found in config` });
      }
      const runtime = createRuntime(metadata.runtimeConfig, {
        projectPath: metadata.projectPath,
        minionName: metadata.name,
      });
      // In-place minions (CLI/benchmarks) have projectPath === name
      // Use path directly instead of reconstructing via getMinionPath
      const isInPlace = metadata.projectPath === metadata.name;
      const minionPath = isInPlace
        ? metadata.projectPath
        : runtime.getMinionPath(metadata.projectPath, metadata.name);

      // Wait for init to complete before any runtime I/O operations
      // (SSH/devcontainer may not be ready until init finishes pulling the container)
      await this.initStateManager.waitForInit(minionId, combinedAbortSignal);
      if (combinedAbortSignal.aborted) {
        return Ok(undefined);
      }

      // Verify runtime is actually reachable after init completes.
      // For Docker minions, this checks the container exists and starts it if stopped.
      // For Lattice minions, this may start a stopped minion and wait for it.
      // If init failed during container creation, ensureReady() will return an error.
      const readyResult = await runtime.ensureReady({
        signal: combinedAbortSignal,
        statusSink: (status) => {
          // Emit runtime-status events for frontend UX (StreamingBarrier)
          this.emit("runtime-status", {
            type: "runtime-status",
            minionId,
            phase: status.phase,
            runtimeType: status.runtimeType,
            detail: status.detail,
          });
        },
      });
      if (!readyResult.ready) {
        // Generate message ID for the error event (frontend needs this for synthetic message)
        const errorMessageId = createAssistantMessageId();
        const runtimeType = metadata.runtimeConfig?.type ?? "local";
        const runtimeLabel = runtimeType === "docker" ? "Container" : "Runtime";
        const errorMessage = readyResult.error || `${runtimeLabel} unavailable.`;

        // Use the errorType from ensureReady result (runtime_not_ready vs runtime_start_failed)
        const errorType = readyResult.errorType;

        // Emit error event so frontend receives it via stream subscription.
        // This mirrors the context_exceeded pattern - the fire-and-forget sendMessage
        // call in useCreationMinion.ts won't see the returned Err, but will receive
        // this event through the minion chat subscription.
        this.emit(
          "error",
          createErrorEvent(minionId, {
            messageId: errorMessageId,
            error: errorMessage,
            errorType,
            acpPromptId,
          })
        );

        return Err({
          type: errorType,
          message: errorMessage,
        });
      }

      // Resolve agent definition, compute effective mode & tool policy.
      const cfg = this.config.loadConfigOrDefault();
      const agentResult = await resolveAgentForStream({
        minionId,
        metadata,
        runtime,
        minionPath,
        requestedAgentId: agentId,
        disableMinionAgents: disableMinionAgents ?? false,
        enableAgentSwitchTool: metadata.agentSwitchingEnabled === true,
        modelString,
        callerToolPolicy: toolPolicy,
        cfg,
        emitError: (event) => this.emit("error", event),
        initStateManager: this.initStateManager,
      });
      if (!agentResult.success) {
        return agentResult;
      }
      const {
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
      } = agentResult.data;
      toolNamesForSentinel = agentResult.data.toolNamesForSentinel;

      // Fetch minion MCP overrides (for filtering servers and tools)
      // NOTE: Stored in <minion>/.lattice/mcp.local.jsonc (not ~/.lattice/config.json).
      let mcpOverrides: MinionMCPOverrides | undefined;
      try {
        mcpOverrides =
          await this.minionMcpOverridesService.getOverridesForMinion(minionId);
      } catch (error) {
        log.warn("[MCP] Failed to load minion MCP overrides; continuing without overrides", {
          minionId,
          error,
        });
        mcpOverrides = undefined;
      }

      // Fetch MCP server config for system prompt (before building message)
      // Pass overrides to filter out disabled servers
      const mcpServers =
        this.mcpServerManager && minionId !== LATTICE_HELP_CHAT_MINION_ID
          ? await this.mcpServerManager.listServers(metadata.projectPath, mcpOverrides)
          : undefined;

      // Build plan-aware instructions and determine plan→exec transition content.
      // IMPORTANT: Derive this from the same boundary-sliced message payload that is sent to
      // the model so plan hints/handoffs cannot be suppressed by pre-boundary history.
      const { effectiveAdditionalInstructions, planFilePath, planContentForTransition } =
        await buildPlanInstructions({
          runtime,
          metadata,
          minionId,
          minionPath,
          effectiveMode,
          effectiveAgentId,
          agentIsPlanLike,
          agentDiscoveryPath,
          additionalSystemInstructions,
          shouldDisableTaskToolsForDepth,
          taskDepth,
          taskSettings,
          requestPayloadMessages: providerRequestMessages,
        });

      // Run the full message preparation pipeline (inject context, transform, validate).
      // This is a purely functional pipeline with no service dependencies.
      const finalMessages = await prepareMessagesForProvider({
        messagesWithSentinel,
        effectiveAgentId,
        toolNamesForSentinel,
        planContentForTransition,
        planFilePath,
        changedFileAttachments,
        postCompactionAttachments,
        runtime,
        minionPath,
        abortSignal: combinedAbortSignal,
        providerForMessages: canonicalProviderName,
        effectiveThinkingLevel,
        modelString,
        anthropicCacheTtl: effectiveLatticeProviderOptions.anthropic?.cacheTtl,
        minionId,
      });

      // Build agent system prompt, system message, and discover agents/skills.
      const {
        agentSystemPrompt,
        systemMessage,
        systemMessageTokens,
        agentDefinitions,
        availableSkills,
      } = await buildStreamSystemContext({
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
        providersConfig: this.providerService.getConfig(),
        mcpServers,
      });

      // Load project secrets (system minion never gets secrets injected)
      const projectSecrets =
        minionId === LATTICE_HELP_CHAT_MINION_ID
          ? []
          : this.config.getEffectiveSecrets(metadata.projectPath);

      // Generate stream token and create temp directory for tools
      const streamToken = this.streamManager.generateStreamToken();

      let mcpTools: Record<string, Tool> | undefined;
      let mcpStats: MCPMinionStats | undefined;
      let mcpSetupDurationMs = 0;

      // Skip MCP tool fetching for subprocess providers that manage tools internally
      // (e.g. claude-code in agentic/proxy mode). In "streaming" mode, Lattice manages
      // tools via the AI SDK, so MCP tools must be loaded.
      const isSubprocessProvider =
        canonicalProviderName === "claude-code" && claudeCodeMode !== "streaming";
      if (this.mcpServerManager && minionId !== LATTICE_HELP_CHAT_MINION_ID && !isSubprocessProvider) {
        const start = Date.now();
        try {
          const result = await this.mcpServerManager.getToolsForMinion({
            minionId,
            projectPath: metadata.projectPath,
            runtime,
            minionPath,
            overrides: mcpOverrides,
            projectSecrets: secretsToRecord(projectSecrets),
          });

          mcpTools = result.tools;
          mcpStats = result.stats;
        } catch (error) {
          minionLog.error("Failed to start MCP servers", { error });
        } finally {
          mcpSetupDurationMs = Date.now() - start;
        }
      } else {
      }

      const runtimeTempDir = await this.streamManager.createTempDirForStream(streamToken, runtime);

      // Extract tool-specific instructions from AGENTS.md files and agent definition
      const toolInstructions = await readToolInstructions(
        metadata,
        runtime,
        minionPath,
        modelString,
        agentSystemPrompt
      );

      // Calculate cumulative session costs for LATTICE_COSTS_USD env var
      let sessionCostsUsd: number | undefined;
      if (this.sessionUsageService) {
        const sessionUsage = await this.sessionUsageService.getSessionUsage(minionId);
        if (sessionUsage) {
          const allUsage = sumUsageHistory(Object.values(sessionUsage.byModel));
          sessionCostsUsd = getTotalCost(allUsage);
        }
      }

      // Get model-specific tools with minion path (correct for local or remote)
      const allTools = await getToolsForModel(
        modelString,
        {
          cwd: minionPath,
          runtime,
          secrets: secretsToRecord(projectSecrets),
          latticeEnv: getLatticeEnv(
            metadata.projectPath,
            getRuntimeType(metadata.runtimeConfig),
            metadata.name,
            {
              modelString,
              thinkingLevel: thinkingLevel ?? "off",
              costsUsd: sessionCostsUsd,
            }
          ),
          runtimeTempDir,
          backgroundProcessManager: this.backgroundProcessManager,
          // Plan agent configuration for plan file access.
          // - read: plan file is readable in all agents (useful context)
          // - write: enforced by file_edit_* tools (plan file is read-only outside plan agent)
          planFileOnly: agentIsPlanLike,
          emitChatEvent: (event) => {
            // Defensive: tools should only emit events for the minion they belong to.
            if ("minionId" in event && event.minionId !== minionId) {
              return;
            }
            this.emit(event.type, event as never);
          },
          minionSessionDir: this.config.getSessionDir(minionId),
          planFilePath,
          minionId,
          // Only child minions (tasks) can report to a parent.
          enableAgentReport: Boolean(metadata.parentMinionId),
          // External edit detection callback
          recordFileState,
          taskService: this.taskService,
          // PTC experiments for inheritance to sidekicks
          experiments,
          // Dynamic context for tool descriptions (moved from system prompt for better model attention)
          availableSidekicks: agentDefinitions,
          availableSkills,
        },
        minionId,
        this.initStateManager,
        toolInstructions,
        mcpTools
      );
      const toolsWithDelegation = this.wrapToolsForDelegation(
        minionId,
        allTools,
        delegatedToolNames
      );

      // Create assistant message ID early so the PTC callback closure captures it.
      // The placeholder is appended to history below (after abort check).
      const assistantMessageId = createAssistantMessageId();

      // Apply tool policy and PTC experiments (lazy-loads PTC dependencies only when needed).
      const tools = await applyToolPolicyAndExperiments({
        allTools: toolsWithDelegation,
        extraTools: this.extraTools,
        effectiveToolPolicy,
        experiments,
        // Forward nested PTC tool events to the stream (tool-call-start/end only,
        // not console events which appear in final result only).
        emitNestedToolEvent: (event: PTCEventWithParent) => {
          if (event.type === "tool-call-start" || event.type === "tool-call-end") {
            this.streamManager.emitNestedToolEvent(minionId, assistantMessageId, event);
          }
        },
      });

      captureMcpToolTelemetry({
        telemetryService: this.telemetryService,
        mcpStats,
        mcpTools,
        tools,
        mcpSetupDurationMs,
        minionId,
        modelString,
        effectiveAgentId,
        metadata,
        effectiveToolPolicy,
      });

      if (combinedAbortSignal.aborted) {
        return Ok(undefined);
      }

      const assistantMessage = createLatticeMessage(assistantMessageId, "assistant", "", {
        timestamp: Date.now(),
        model: canonicalModelString,
        systemMessageTokens,
        agentId: effectiveAgentId,
      });

      // Append to history to get historySequence assigned
      const appendResult = await this.historyService.appendToHistory(minionId, assistantMessage);
      if (!appendResult.success) {
        return Err({ type: "unknown", raw: appendResult.error });
      }

      // Get the assigned historySequence
      const historySequence = assistantMessage.metadata?.historySequence ?? 0;

      // Handle simulated stream scenarios (OpenAI SDK testing features).
      // These emit synthetic stream events without calling an AI provider.
      const forceContextLimitError =
        modelString.startsWith("openai:") &&
        effectiveLatticeProviderOptions.openai?.forceContextLimitError === true;
      const simulateToolPolicyNoopFlag =
        modelString.startsWith("openai:") &&
        effectiveLatticeProviderOptions.openai?.simulateToolPolicyNoop === true;

      if (forceContextLimitError || simulateToolPolicyNoopFlag) {
        const simulationCtx: SimulationContext = {
          minionId,
          assistantMessageId,
          canonicalModelString,
          historySequence,
          systemMessageTokens,
          effectiveAgentId,
          effectiveMode,
          effectiveThinkingLevel,
          emit: (event, data) => this.emit(event, data),
        };

        if (forceContextLimitError) {
          await simulateContextLimitError(simulationCtx, this.historyService);
        } else {
          await simulateToolPolicyNoop(simulationCtx, effectiveToolPolicy, this.historyService);
        }
        return Ok(undefined);
      }

      // Build provider options based on thinking level and request-sliced message history.
      const truncationMode = openaiTruncationModeOverride;
      // Use the same boundary-sliced payload history that we send to the provider.
      // This prevents previousResponseId lookup from reaching pre-compaction epochs.
      // Also pass callback to filter out lost responseIds (OpenAI invalidated them).
      // Pass minionId to derive stable promptCacheKey for OpenAI caching.
      const providerOptions = buildProviderOptions(
        modelString,
        effectiveThinkingLevel,
        providerRequestMessages,
        (id) => this.streamManager.isResponseIdLost(id),
        effectiveLatticeProviderOptions,
        minionId,
        truncationMode
      );

      // Build per-request HTTP headers (e.g., anthropic-beta for 1M context).
      // This is the single injection site for provider-specific headers, handling
      // both direct and proxy-routed models identically.
      const requestHeaders = buildRequestHeaders(modelString, effectiveLatticeProviderOptions);
      const stopAfterSuccessfulProposePlan = Boolean(
        metadata.parentMinionId && effectiveMode === "plan"
      );

      // Debug dump: Log the complete LLM request when LATTICE_DEBUG_LLM_REQUEST is set
      if (process.env.LATTICE_DEBUG_LLM_REQUEST === "1") {
        log.info(
          `[LATTICE_DEBUG_LLM_REQUEST] Full LLM request:\n${JSON.stringify(
            {
              minionId,
              model: modelString,
              systemMessage,
              messages: finalMessages,
              tools: Object.fromEntries(
                Object.entries(tools).map(([n, t]) => [
                  n,
                  { description: t.description, inputSchema: t.inputSchema },
                ])
              ),
              providerOptions,
              thinkingLevel: effectiveThinkingLevel,
              maxOutputTokens,
              mode: effectiveMode,
              agentId: effectiveAgentId,
              toolPolicy: effectiveToolPolicy,
            },
            null,
            2
          )}`
        );
      }

      if (combinedAbortSignal.aborted) {
        await deleteAbortedPlaceholder(assistantMessageId);
        return Ok(undefined);
      }

      // Capture request payload for the debug modal, then delegate to StreamManager.
      const snapshot: DebugLlmRequestSnapshot = {
        capturedAt: Date.now(),
        minionId,
        messageId: assistantMessageId,
        model: modelString,
        providerName: canonicalProviderName,
        thinkingLevel: effectiveThinkingLevel,
        mode: effectiveMode,
        agentId: effectiveAgentId,
        maxOutputTokens,
        systemMessage,
        messages: finalMessages,
      };

      try {
        this.lastLlmRequestByMinion.set(minionId, safeClone(snapshot));
      } catch (error) {
        const errMsg = getErrorMessage(error);
        minionLog.warn("Failed to capture debug LLM request snapshot", { error: errMsg });
      }
      const toolsForStream =
        experiments?.system1 === true
          ? wrapToolsWithSystem1({
              tools,
              system1Model,
              system1ThinkingLevel,
              modelString,
              effectiveModelString,
              primaryModel: modelResult.data.model,
              latticeProviderOptions: effectiveLatticeProviderOptions,
              minionId,
              effectiveMode,
              planFilePath,
              taskSettings,
              runtimeTempDir,
              runtime,
              agentDiscoveryPath,
              createModel: (ms, o) => this.createModel(ms, o),
              emitBashOutput: (ev) => this.emit("bash-output", ev),
              sessionUsageService: this.sessionUsageService,
            })
          : tools;

      const streamResult = await this.streamManager.startStream(
        minionId,
        finalMessages,
        modelResult.data.model,
        modelString,
        historySequence,
        systemMessage,
        runtime,
        assistantMessageId, // Shared messageId ensures nested tool events match stream events
        combinedAbortSignal,
        toolsForStream,
        {
          systemMessageTokens,
          timestamp: Date.now(),
          agentId: effectiveAgentId,
          mode: effectiveMode,
          ...(acpPromptId != null ? { acpPromptId } : {}),
          ...(modelCostsIncluded(modelResult.data.model) ? { costsIncluded: true } : {}),
        },
        providerOptions,
        maxOutputTokens,
        effectiveToolPolicy,
        streamToken, // Pass the pre-generated stream token
        hasQueuedMessage,
        metadata.name,
        effectiveThinkingLevel,
        requestHeaders,
        effectiveLatticeProviderOptions.anthropic?.cacheTtl ?? undefined,
        stopAfterSuccessfulProposePlan
      );

      if (!streamResult.success) {
        // StreamManager already returns SendMessageError
        return Err(streamResult.error);
      }

      // If we were interrupted during StreamManager startup before the stream was registered,
      // make sure we don't leave an empty assistant placeholder behind.
      if (combinedAbortSignal.aborted && !this.streamManager.isStreaming(minionId)) {
        await deleteAbortedPlaceholder(assistantMessageId);
      }

      // StreamManager now handles history updates directly on stream-end
      // No need for event listener here
      return Ok(undefined);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      log.error("Stream message error:", error);
      // Return as unknown error type
      return Err({ type: "unknown", raw: `Failed to stream message: ${errorMessage}` });
    } finally {
      unlinkAbortSignal();
      const pending = this.pendingStreamStarts.get(minionId);
      if (pending?.abortController === pendingAbortController) {
        this.pendingStreamStarts.delete(minionId);
      }
    }
  }

  async stopStream(
    minionId: string,
    options?: { soft?: boolean; abandonPartial?: boolean; abortReason?: StreamAbortReason }
  ): Promise<Result<void>> {
    const pending = this.pendingStreamStarts.get(minionId);
    const isActuallyStreaming =
      this.mockModeEnabled && this.mockAiStreamPlayer
        ? this.mockAiStreamPlayer.isStreaming(minionId)
        : this.streamManager.isStreaming(minionId);

    if (pending) {
      pending.abortController.abort();

      // If we're still in pre-stream startup (no StreamManager stream yet), emit a synthetic
      // stream-abort so the renderer can exit the "starting..." UI immediately.
      const abortReason = options?.abortReason ?? "startup";
      if (!isActuallyStreaming) {
        this.emit("stream-abort", {
          type: "stream-abort",
          minionId,
          abortReason,
          messageId: pending.syntheticMessageId,
          metadata: { duration: Date.now() - pending.startTime },
          abandonPartial: options?.abandonPartial,
          acpPromptId: pending.acpPromptId,
        } satisfies StreamAbortEvent);
      }
    }

    if (this.mockModeEnabled && this.mockAiStreamPlayer) {
      this.mockAiStreamPlayer.stop(minionId);
      return Ok(undefined);
    }
    return this.streamManager.stopStream(minionId, options);
  }

  /**
   * Check if a minion is currently streaming
   */
  isStreaming(minionId: string): boolean {
    if (this.mockModeEnabled && this.mockAiStreamPlayer) {
      return this.mockAiStreamPlayer.isStreaming(minionId);
    }
    return this.streamManager.isStreaming(minionId);
  }

  /**
   * Get the current stream state for a minion
   */
  getStreamState(minionId: string): string {
    if (this.mockModeEnabled && this.mockAiStreamPlayer) {
      return this.mockAiStreamPlayer.isStreaming(minionId) ? "streaming" : "idle";
    }
    return this.streamManager.getStreamState(minionId);
  }

  /**
   * Get the current stream info for a minion if actively streaming
   * Used to re-establish streaming context on frontend reconnection
   */
  getStreamInfo(minionId: string): ReturnType<typeof this.streamManager.getStreamInfo> {
    if (this.mockModeEnabled && this.mockAiStreamPlayer) {
      return undefined;
    }
    return this.streamManager.getStreamInfo(minionId);
  }

  /**
   * Replay stream events
   * Emits the same events that would be emitted during live streaming
   */
  async replayStream(minionId: string, opts?: { afterTimestamp?: number }): Promise<void> {
    if (this.mockModeEnabled && this.mockAiStreamPlayer) {
      await this.mockAiStreamPlayer.replayStream(minionId);
      return;
    }
    await this.streamManager.replayStream(minionId, opts);
  }

  debugGetLastMockPrompt(minionId: string): Result<LatticeMessage[] | null> {
    if (typeof minionId !== "string" || minionId.trim().length === 0) {
      return Err("debugGetLastMockPrompt: minionId is required");
    }

    if (!this.mockModeEnabled || !this.mockAiStreamPlayer) {
      return Ok(null);
    }

    return Ok(this.mockAiStreamPlayer.debugGetLastPrompt(minionId));
  }
  debugGetLastMockModel(minionId: string): Result<string | null> {
    if (typeof minionId !== "string" || minionId.trim().length === 0) {
      return Err("debugGetLastMockModel: minionId is required");
    }

    if (!this.mockModeEnabled || !this.mockAiStreamPlayer) {
      return Ok(null);
    }

    return Ok(this.mockAiStreamPlayer.debugGetLastModel(minionId));
  }

  debugGetLastLlmRequest(minionId: string): Result<DebugLlmRequestSnapshot | null> {
    if (typeof minionId !== "string" || minionId.trim().length === 0) {
      return Err("debugGetLastLlmRequest: minionId is required");
    }

    return Ok(this.lastLlmRequestByMinion.get(minionId) ?? null);
  }

  /**
   * DEBUG ONLY: Trigger an artificial stream error for testing.
   * This is used by integration tests to simulate network errors mid-stream.
   * @returns true if an active stream was found and error was triggered
   */
  debugTriggerStreamError(
    minionId: string,
    errorMessage = "Test-triggered stream error"
  ): Promise<boolean> {
    return this.streamManager.debugTriggerStreamError(minionId, errorMessage);
  }

  /**
   * Wait for minion initialization to complete (if running).
   * Public wrapper for agent discovery and other callers.
   */
  async waitForInit(minionId: string, abortSignal?: AbortSignal): Promise<void> {
    return this.initStateManager.waitForInit(minionId, abortSignal);
  }

  async deleteMinion(minionId: string): Promise<Result<void>> {
    try {
      const minionDir = this.config.getSessionDir(minionId);
      await fs.rm(minionDir, { recursive: true, force: true });
      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to delete minion: ${message}`);
    }
  }
}
