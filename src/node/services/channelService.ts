/**
 * ChannelService — manages cross-platform messaging channel adapters.
 *
 * Channels are workbench-scoped: each adapter instance represents one external identity
 * (e.g., one Telegram bot) that serves the entire workbench. Inbound messages are routed
 * to workspaces via the ChannelSessionRouter (OpenClaw pattern), which maps each external
 * peer to an isolated workspace session.
 *
 * Follows the same EventEmitter + ORPC patterns as WorkspaceService.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { log } from "@/node/services/log";
import { defaultModel } from "@/common/utils/ai/models";
import type { Config } from "@/node/config";
import type { WorkspaceService } from "@/node/services/workspaceService";
import type { ChannelAdapter } from "@/common/types/channel";
import type {
  ChannelConfig,
  ChannelMessage,
  ChannelStatus,
  ChannelType,
  OutboundChannelMessage,
  ChannelSendResult,
  ChannelListItem,
} from "@/common/orpc/schemas/channels";
import type { WorkspaceChatMessage } from "@/common/orpc/types";
import { ChannelConfigSchema } from "@/common/orpc/schemas/channels";
import { TelegramAdapter } from "./channels/telegram/TelegramAdapter";
import { DiscordAdapter } from "./channels/discord/DiscordAdapter";
import { SlackAdapter } from "./channels/slack/SlackAdapter";
import { WhatsAppAdapter } from "./channels/whatsapp/WhatsAppAdapter";
import type { ChannelSessionRouter } from "./channelSessionRouter";

// ── Event types ─────────────────────────────────────────────────────────

export interface ChannelServiceEvents {
  message: (message: ChannelMessage) => void;
  statusChange: (accountId: string, status: ChannelStatus) => void;
}

export declare interface ChannelService {
  on<U extends keyof ChannelServiceEvents>(event: U, listener: ChannelServiceEvents[U]): this;
  off<U extends keyof ChannelServiceEvents>(event: U, listener: ChannelServiceEvents[U]): this;
  emit<U extends keyof ChannelServiceEvents>(
    event: U,
    ...args: Parameters<ChannelServiceEvents[U]>
  ): boolean;
}

// ── Service ─────────────────────────────────────────────────────────────

export class ChannelService extends EventEmitter {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private readonly configs = new Map<string, ChannelConfig>();
  private readonly channelsFile: string;

  /** Accumulates stream-delta text per workspace for outbound channel responses */
  private readonly pendingResponses = new Map<string, string>();

  /** Typing indicator intervals per workspace — sends "typing" every 4s while streaming */
  private readonly typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  /** Track retry attempts per workspace to avoid infinite loops */
  private readonly retryAttempts = new Map<string, number>();

  /**
   * Track which workspaces have an active channel-originated conversation.
   * When a message comes from TG/Discord, we mark the workspace here.
   * When a stream-end fires, we clear it. This prevents workbench UI messages
   * from leaking back to the channel — only channel-initiated conversations
   * get routed back.
   */
  private readonly channelOriginatedStreams = new Set<string>();

  /** Factory registry — maps channel type → adapter constructor */
  private readonly adapterFactories = new Map<
    ChannelType,
    (config: ChannelConfig) => ChannelAdapter
  >([
    ["telegram", (cfg) => new TelegramAdapter(cfg)],
    ["discord", (cfg) => new DiscordAdapter(cfg)],
    ["slack", (cfg) => new SlackAdapter(cfg)],
    ["whatsapp", (cfg) => new WhatsAppAdapter(cfg)],
  ]);

  constructor(
    private readonly config: Config,
    private readonly workspaceService: WorkspaceService,
    private readonly sessionRouter: ChannelSessionRouter
  ) {
    super();
    this.channelsFile = path.join(config.rootDir, "channels.json");
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Initialize: load persisted configs, load session mappings, and auto-connect enabled channels.
   * Called during ServiceContainer.initialize().
   */
  async initialize(): Promise<void> {
    this.loadConfigs();
    this.sessionRouter.loadSessions();

    // Listen for workspace chat events and route assistant responses back to channel peers
    this.workspaceService.on(
      "chat",
      (event: { workspaceId: string; message: WorkspaceChatMessage }) => {
        this.handleOutboundChatEvent(event.workspaceId, event.message);
      }
    );

    // Auto-connect all enabled channels (best-effort, don't block startup)
    const enabledConfigs = Array.from(this.configs.values()).filter((c) => c.enabled);
    for (const cfg of enabledConfigs) {
      try {
        await this.connectChannel(cfg.accountId);
      } catch (error) {
        log.warn("[ChannelService] Failed to auto-connect channel on startup", {
          accountId: cfg.accountId,
          type: cfg.type,
          error,
        });
      }
    }
  }

  /**
   * Gracefully disconnect all adapters. Called during ServiceContainer.shutdown().
   */
  async shutdown(): Promise<void> {
    const disconnections = Array.from(this.adapters.keys()).map((accountId) =>
      this.disconnectChannel(accountId).catch((error) => {
        log.warn("[ChannelService] Error disconnecting channel during shutdown", {
          accountId,
          error,
        });
      })
    );
    await Promise.all(disconnections);
  }

  // ── Config persistence ──────────────────────────────────────────────

  private loadConfigs(): void {
    try {
      if (!fs.existsSync(this.channelsFile)) {
        return;
      }
      const raw = fs.readFileSync(this.channelsFile, "utf-8");
      const parsed = JSON.parse(raw) as unknown[];

      if (!Array.isArray(parsed)) {
        log.warn("[ChannelService] channels.json is not an array, ignoring");
        return;
      }

      for (const item of parsed) {
        // Try new schema first, then attempt migration from old format
        let result = ChannelConfigSchema.safeParse(item);

        if (!result.success && typeof item === "object" && item !== null) {
          const migrated = this.migrateOldConfig(item as Record<string, unknown>);
          if (migrated) {
            result = ChannelConfigSchema.safeParse(migrated);
          }
        }

        if (result.success) {
          this.configs.set(result.data.accountId, result.data);
        } else {
          log.warn("[ChannelService] Invalid channel config entry, skipping", {
            error: result.error.message,
          });
        }
      }

      log.debug("[ChannelService] Loaded channel configs", { count: this.configs.size });
    } catch (error) {
      log.warn("[ChannelService] Failed to load channels.json", { error });
    }
  }

  /**
   * Migrate old project-scoped config to new workbench-scoped format.
   */
  private migrateOldConfig(old: Record<string, unknown>): Record<string, unknown> | null {
    if ("projectPath" in old || "defaultWorkspaceId" in old) {
      log.info("[ChannelService] Migrating old project-scoped channel config", {
        accountId: old.accountId,
      });
      const { projectPath, defaultWorkspaceId, ...rest } = old;
      return {
        ...rest,
        defaultProjectPath: projectPath,
        sessionScope: "per-peer",
      };
    }
    return null;
  }

  private saveConfigs(): void {
    try {
      const data = Array.from(this.configs.values());
      fs.writeFileSync(this.channelsFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      log.error("[ChannelService] Failed to save channels.json", { error });
    }
  }

  // ── CRUD operations ─────────────────────────────────────────────────

  async createChannel(config: ChannelConfig): Promise<{ success: boolean; error?: string }> {
    if (this.configs.has(config.accountId)) {
      return { success: false, error: `Channel "${config.accountId}" already exists` };
    }

    this.configs.set(config.accountId, config);
    this.saveConfigs();

    if (config.enabled) {
      const connectResult = await this.connectChannel(config.accountId);
      if (!connectResult.success) {
        return connectResult;
      }
    }

    log.info("[ChannelService] Channel created", {
      accountId: config.accountId,
      type: config.type,
    });
    return { success: true };
  }

  async updateChannel(config: ChannelConfig): Promise<{ success: boolean; error?: string }> {
    if (!this.configs.has(config.accountId)) {
      return { success: false, error: `Channel "${config.accountId}" not found` };
    }

    // Disconnect if currently connected (will reconnect with new config if enabled)
    if (this.adapters.has(config.accountId)) {
      await this.disconnectChannel(config.accountId);
    }

    this.configs.set(config.accountId, config);
    this.saveConfigs();

    if (config.enabled) {
      const connectResult = await this.connectChannel(config.accountId);
      if (!connectResult.success) {
        return connectResult;
      }
    }

    log.info("[ChannelService] Channel updated", { accountId: config.accountId });
    return { success: true };
  }

  async removeChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.configs.has(accountId)) {
      return { success: false, error: `Channel "${accountId}" not found` };
    }

    if (this.adapters.has(accountId)) {
      await this.disconnectChannel(accountId);
    }

    this.configs.delete(accountId);
    this.saveConfigs();

    log.info("[ChannelService] Channel removed", { accountId });
    return { success: true };
  }

  // ── Connection management ───────────────────────────────────────────

  async connectChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.get(accountId);
    if (!config) {
      return { success: false, error: `Channel "${accountId}" not found` };
    }

    if (this.adapters.has(accountId)) {
      return { success: false, error: `Channel "${accountId}" is already connected` };
    }

    // ── Prevent duplicate bot token conflicts ──
    // Telegram only allows one getUpdates consumer per bot token.
    // If another channel is already using the same token, disconnect it first.
    const newToken = config.credentials?.botToken;
    if (newToken && config.type === "telegram") {
      for (const [existingId, existingAdapter] of this.adapters) {
        const existingConfig = this.configs.get(existingId);
        if (
          existingConfig &&
          existingConfig.type === "telegram" &&
          existingConfig.credentials?.botToken === newToken &&
          existingId !== accountId
        ) {
          log.warn("[ChannelService] Disconnecting duplicate bot token", {
            existingChannel: existingId,
            newChannel: accountId,
          });
          await this.disconnectChannel(existingId);
        }
      }
    }

    const factory = this.adapterFactories.get(config.type);
    if (!factory) {
      return { success: false, error: `Unsupported channel type: ${config.type}` };
    }

    try {
      const adapter = factory(config);

      // Subscribe to adapter events — forward to ChannelService EventEmitter
      adapter.onMessage((message) => {
        this.handleInboundMessage(message);
      });

      adapter.onStatusChange((status) => {
        this.emit("statusChange", accountId, status);
      });

      await adapter.connect(config);
      this.adapters.set(accountId, adapter);

      log.info("[ChannelService] Channel connected", { accountId, type: config.type });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("[ChannelService] Failed to connect channel", { accountId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async disconnectChannel(accountId: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.adapters.get(accountId);
    if (!adapter) {
      return { success: false, error: `Channel "${accountId}" is not connected` };
    }

    try {
      await adapter.disconnect();
      this.adapters.delete(accountId);

      log.info("[ChannelService] Channel disconnected", { accountId });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("[ChannelService] Failed to disconnect channel", {
        accountId,
        error: errorMessage,
      });
      // Remove from map even on error — adapter is in unknown state
      this.adapters.delete(accountId);
      return { success: false, error: errorMessage };
    }
  }

  // ── Messaging ───────────────────────────────────────────────────────

  async sendMessage(
    accountId: string,
    message: OutboundChannelMessage
  ): Promise<ChannelSendResult> {
    const adapter = this.adapters.get(accountId);
    if (!adapter) {
      return { success: false, error: `Channel "${accountId}" is not connected` };
    }

    try {
      return await adapter.sendMessage(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("[ChannelService] Failed to send message", { accountId, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────

  listChannels(): ChannelListItem[] {
    return Array.from(this.configs.values()).map((config) => ({
      type: config.type,
      accountId: config.accountId,
      sessionScope: config.sessionScope ?? "per-peer",
      status: this.adapters.get(config.accountId)?.status ?? "disconnected",
      enabled: config.enabled,
      sessionCount: this.sessionRouter.listSessions(config.accountId).length,
    }));
  }

  getConfig(accountId: string): ChannelConfig | undefined {
    return this.configs.get(accountId);
  }

  // ── Outbound response routing ─────────────────────────────────────

  /**
   * Handle workspace chat events. Accumulates stream-delta text and sends
   * the complete response back to the channel peer on stream-end.
   *
   * Also handles stream-abort gracefully by notifying the user instead of
   * silently swallowing the error.
   */
  private handleOutboundChatEvent(workspaceId: string, message: WorkspaceChatMessage): void {
    try {
      // Only process workspaces that belong to a channel session
      const session = this.sessionRouter.findByWorkspaceId(workspaceId);
      if (!session) return;

      // Only route back to channel if this conversation was initiated FROM the channel.
      // If the user is chatting in the workbench UI on the same workspace, don't
      // duplicate responses to TG/Discord — that's not how real people work.
      if (!this.channelOriginatedStreams.has(workspaceId)) return;

      const msg = message as Record<string, unknown>;

      switch (message.type) {
        case "stream-start": {
          // Reset accumulator for new response
          this.pendingResponses.set(workspaceId, "");
          this.retryAttempts.delete(workspaceId);

          // Start typing indicator
          this.startTypingIndicator(session.accountId, session.peerId, workspaceId);
          break;
        }

        case "stream-delta": {
          // Accumulate text deltas
          const current = this.pendingResponses.get(workspaceId) ?? "";
          this.pendingResponses.set(workspaceId, current + (msg.delta as string));
          break;
        }

        case "stream-end": {
          // Stop typing indicator and clear channel origin flag
          this.stopTypingIndicator(workspaceId);
          this.channelOriginatedStreams.delete(workspaceId);

          // Flush accumulated response to channel
          const fullText = this.pendingResponses.get(workspaceId)?.trim();
          this.pendingResponses.delete(workspaceId);

          if (!fullText) return;

          this.sendResponseToChannel(session.accountId, session.peerId, fullText, workspaceId);
          break;
        }

        case "stream-abort": {
          // Stop typing + clear flag + notify user
          this.stopTypingIndicator(workspaceId);
          this.channelOriginatedStreams.delete(workspaceId);
          const abortedText = this.pendingResponses.get(workspaceId)?.trim();
          this.pendingResponses.delete(workspaceId);

          // If we had partial text, send what we have
          if (abortedText) {
            this.sendResponseToChannel(session.accountId, session.peerId, abortedText, workspaceId);
          } else {
            // Notify user something went wrong
            const adapter = this.adapters.get(session.accountId);
            if (adapter) {
              adapter
                .sendMessage({
                  to: { id: session.peerId },
                  text: "⚠️ _Something went wrong. Try again or rephrase your message._",
                })
                .catch(() => {});
            }
          }
          break;
        }
      }
    } catch (error) {
      log.error("[ChannelService] Error in outbound chat event handler", { workspaceId, error });
    }
  }

  /**
   * Send a response back to a channel peer. The LLM is instructed to use "---"
   * as a message break delimiter when it wants to split into multiple messages.
   * We split on that, add typing indicators between messages, and send sequentially.
   */
  private sendResponseToChannel(
    accountId: string,
    peerId: string,
    text: string,
    workspaceId: string
  ): void {
    const adapter = this.adapters.get(accountId);
    if (!adapter) {
      log.warn("[ChannelService] No connected adapter for outbound response", {
        accountId,
        workspaceId,
      });
      return;
    }

    // Split on LLM-provided message breaks (--- on its own line)
    // Then hard-split any chunk that still exceeds Telegram's 4096 limit
    const rawParts = text
      .split(/\n---\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const messages: string[] = [];
    for (const part of rawParts) {
      if (part.length <= 4096) {
        messages.push(part);
      } else {
        messages.push(...hardSplit(part, 4096));
      }
    }

    if (messages.length === 0) return;

    // Send sequentially with typing indicators between messages
    const sendSequence = async () => {
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;

        if (i > 0) {
          // Show typing indicator + pause proportional to message length
          if (adapter.sendTypingIndicator) {
            await adapter.sendTypingIndicator(peerId).catch(() => {});
          }
          const typingMs = Math.min(Math.max(msg.length * 5, 600), 2500);
          await new Promise((r) => setTimeout(r, typingMs));
        }

        await adapter.sendMessage({ to: { id: peerId }, text: msg }).catch((error) => {
          log.error("[ChannelService] Failed to send outbound response to channel", {
            accountId,
            peerId,
            error,
          });
        });
      }
    };

    sendSequence().catch((error) => {
      log.error("[ChannelService] Error in outbound send chain", { accountId, workspaceId, error });
    });
  }

  // ── Typing indicator ─────────────────────────────────────────────────

  private startTypingIndicator(accountId: string, peerId: string, workspaceId: string): void {
    // Clear any existing interval for this workspace
    this.stopTypingIndicator(workspaceId);

    const adapter = this.adapters.get(accountId);
    if (!adapter?.sendTypingIndicator) return;

    // Send immediately
    adapter.sendTypingIndicator(peerId).catch(() => {});

    // Repeat every 4 seconds (Telegram typing expires after ~5s)
    const interval = setInterval(() => {
      const a = this.adapters.get(accountId);
      if (a?.sendTypingIndicator) {
        a.sendTypingIndicator(peerId).catch(() => {});
      } else {
        this.stopTypingIndicator(workspaceId);
      }
    }, 4000);

    this.typingIntervals.set(workspaceId, interval);
  }

  private stopTypingIndicator(workspaceId: string): void {
    const interval = this.typingIntervals.get(workspaceId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(workspaceId);
    }
  }

  // ── Inbound message handling ────────────────────────────────────────

  /**
   * Handle an inbound message from an external channel.
   * Routes to the appropriate workspace via the session router (OpenClaw pattern).
   *
   * Supports:
   * - Slash commands: /new (reset session), /status (workspace info)
   * - Group chat filtering: only responds when @mentioned or /command
   * - Voice transcription via OpenAI Whisper API
   */
  private async handleInboundMessage(message: ChannelMessage): Promise<void> {
    try {
      const config = this.configs.get(message.channelAccountId);
      if (!config) {
        log.warn("[ChannelService] Received message for unconfigured channel", {
          channelAccountId: message.channelAccountId,
        });
        return;
      }

      // ── Group chat filtering ──────────────────────────────────────────
      // In group chats, only respond when the bot is @mentioned or a /command is sent.
      // This prevents the bot from responding to every message in a group.
      const isGroupChat = message.metadata?.isGroupChat === true;
      const hasBotMention = message.metadata?.hasBotMention === true;
      const hasBotCommand = message.metadata?.hasBotCommand === true;

      if (isGroupChat && !hasBotMention && !hasBotCommand) {
        // Silent ignore — don't respond to non-addressed group messages
        return;
      }

      // Always emit for ORPC streaming subscribers (channels.onMessage)
      this.emit("message", message);

      // ── Slash command handling ─────────────────────────────────────────
      const text = (message.content.text ?? "").trim();

      if (text === "/new" || text.startsWith("/new ") || text.startsWith("/new@")) {
        await this.handleNewCommand(message, config);
        return;
      }

      if (text === "/status" || text.startsWith("/status ") || text.startsWith("/status@")) {
        await this.handleStatusCommand(message, config);
        return;
      }

      // Strip bot mention from text in group chats so the LLM sees clean input
      let cleanedText = message.content.text;
      if (isGroupChat && hasBotMention) {
        const adapter = this.adapters.get(message.channelAccountId);
        const botName = adapter?.botUsername;
        if (botName) {
          cleanedText = (cleanedText ?? "").replace(new RegExp(`@${botName}\\b`, "gi"), "").trim();
        }
      }

      // Route to workspace via session router
      const { workspaceId, isNew } = await this.sessionRouter.resolve(message, config);

      if (isNew) {
        log.info("[ChannelService] Created new workspace for channel peer", {
          workspaceId,
          peerId: message.from.id,
          channel: config.type,
        });
      }

      // Build prefixed message with sender context
      const senderLabel = message.from.displayName ?? message.from.username ?? message.from.id;
      const prefix = isGroupChat
        ? `[${config.type}/group/${senderLabel}]`
        : `[${config.type}/${senderLabel}]`;
      const msgText = cleanedText ?? "";

      // Download attachments and convert to fileParts for multimodal LLM input
      const fileParts: Array<{ url: string; mediaType: string; filename?: string }> = [];
      const attachmentDescs: string[] = [];

      if (message.content.attachments?.length) {
        const adapter = this.adapters.get(message.channelAccountId);

        for (const att of message.content.attachments) {
          // Try to download the file and pass as vision input
          if (adapter?.downloadFile && att.url) {
            // Extract platform file ID from the URL (e.g. "tg-file://ABC123" → "ABC123")
            const fileId = att.url.replace(/^tg-file:\/\//, "").replace(/^discord-file:\/\//, "");
            try {
              const downloaded = await adapter.downloadFile(fileId);
              if (downloaded && downloaded.mimeType.startsWith("image/")) {
                fileParts.push({
                  url: downloaded.dataUrl,
                  mediaType: downloaded.mimeType,
                  filename: att.filename,
                });
                log.info("[ChannelService] Downloaded image for multimodal input", {
                  type: att.type,
                  mimeType: downloaded.mimeType,
                });
                continue; // Successfully downloaded — skip text fallback
              } else if (downloaded && downloaded.mimeType === "application/pdf") {
                fileParts.push({
                  url: downloaded.dataUrl,
                  mediaType: downloaded.mimeType,
                  filename: att.filename,
                });
                continue;
              }
            } catch (error) {
              log.warn(
                "[ChannelService] Failed to download attachment, falling back to text description",
                {
                  error,
                }
              );
            }
          }

          // Try voice transcription for audio attachments
          if (att.type === "audio" && adapter?.downloadFile && att.url) {
            const audioFileId = att.url
              .replace(/^tg-file:\/\//, "")
              .replace(/^discord-file:\/\//, "");
            try {
              const audioFile = await adapter.downloadFile(audioFileId);
              if (audioFile) {
                const transcript = await this.transcribeAudio(
                  audioFile.dataUrl,
                  audioFile.mimeType
                );
                if (transcript) {
                  attachmentDescs.push(`[🎤 Voice message transcription]: "${transcript}"`);
                  continue;
                }
              }
            } catch (error) {
              log.warn(
                "[ChannelService] Voice transcription failed, falling back to text description",
                { error }
              );
            }
          }

          // Fallback: describe attachment as text if download failed or unsupported
          if (att.type === "image") {
            attachmentDescs.push("[📷 Image attached — could not download]");
          } else if (att.type === "audio") {
            attachmentDescs.push(
              "[🎤 Voice message — could not transcribe. Ask the user to type their message instead.]"
            );
          } else if (att.type === "file") {
            attachmentDescs.push(`[📎 File: ${att.filename ?? "unknown"}]`);
          } else {
            attachmentDescs.push(`[📁 ${att.type}]`);
          }
        }
      }

      const parts = [prefix, msgText, ...attachmentDescs].filter(Boolean);
      const fullMessage = parts.join(" ");

      // Resolve the model from the workspace's own AI settings so that if the
      // user switches models in the workbench UI, Telegram messages honour that
      // choice. Falls back to platform default only when no setting exists yet.
      const agentId = "exec";
      const found = this.config.findWorkspace(workspaceId);
      let model = defaultModel;
      if (found) {
        const wsConfig = this.config.loadConfigOrDefault();
        const project = wsConfig.projects.get(found.projectPath);
        const ws = project?.workspaces.find((w) => w.id === workspaceId);
        const wsModel = ws?.aiSettingsByAgent?.[agentId]?.model ?? ws?.aiSettings?.model;
        if (wsModel) model = wsModel as typeof defaultModel;
      }

      const sendOpts = {
        model,
        agentId,
        additionalSystemInstructions: getChannelSystemPrompt(config.type),
        ...(fileParts.length > 0 ? { fileParts } : {}),
      };

      // Mark this workspace as having an active channel-originated conversation
      // so the outbound handler knows to route the response back to the channel.
      // Without this, typing in the workbench UI on the same workspace would
      // also send responses to TG/Discord — which is not what users expect.
      this.channelOriginatedStreams.add(workspaceId);

      const result = await this.workspaceService.sendMessage(workspaceId, fullMessage, sendOpts);

      if (!result.success) {
        log.error("[ChannelService] Failed to forward channel message to workspace", {
          workspaceId,
          error: result.error,
        });

        // Retry once — many failures are transient (rate limits, network blips)
        const retries = this.retryAttempts.get(workspaceId) ?? 0;
        if (retries < 1) {
          this.retryAttempts.set(workspaceId, retries + 1);
          log.info("[ChannelService] Retrying message delivery after 2s", {
            workspaceId,
            attempt: retries + 1,
          });
          await new Promise((r) => setTimeout(r, 2000));
          const retry = await this.workspaceService.sendMessage(workspaceId, fullMessage, sendOpts);
          if (!retry.success) {
            // Notify user of failure
            const adapter = this.adapters.get(message.channelAccountId);
            if (adapter) {
              await adapter
                .sendMessage({
                  to: {
                    id:
                      message.channelType === "telegram"
                        ? message.from.id === message.to.id
                          ? message.from.id
                          : message.to.id
                        : message.to.id,
                  },
                  text: "⚠️ _Couldn't process your message right now. Try again in a moment._",
                })
                .catch(() => {});
            }
          }
        }
      }
    } catch (error) {
      log.error("[ChannelService] Error handling inbound channel message", { error });

      // Best-effort: notify user of error
      try {
        const adapter = this.adapters.get(message.channelAccountId);
        const chatId = message.to.id;
        if (adapter) {
          await adapter
            .sendMessage({
              to: { id: chatId },
              text: "⚠️ _Something went wrong processing your message. Please try again._",
            })
            .catch(() => {});
        }
      } catch {
        /* final fallback — don't let error notification crash us */
      }
    }
  }

  // ── Slash command handlers ──────────────────────────────────────────

  /**
   * /new — Reset the conversation session. Deletes the session mapping so the
   * next message from this peer creates a fresh workspace.
   */
  private async handleNewCommand(message: ChannelMessage, config: ChannelConfig): Promise<void> {
    const adapter = this.adapters.get(message.channelAccountId);
    if (!adapter) return;

    const peerKind = this.sessionRouter.inferPeerKind(message);
    const peerId = peerKind === "dm" ? message.from.id : message.to.id;
    const scope = config.sessionScope ?? "per-peer";
    const sessionKey = this.sessionRouter.buildSessionKey(
      message.channelType,
      peerKind,
      peerId,
      scope
    );

    const deleted = this.sessionRouter.deleteSession(sessionKey);
    const chatId = message.to.id || message.from.id;

    if (deleted) {
      await adapter
        .sendMessage({
          to: { id: chatId },
          text: "🔄 _Session reset. Your next message starts a fresh conversation._",
        })
        .catch(() => {});

      log.info("[ChannelService] /new command: session reset", {
        sessionKey,
        oldWorkspaceId: deleted.workspaceId,
        peerId,
      });
    } else {
      await adapter
        .sendMessage({
          to: { id: chatId },
          text: "✨ _No active session. Your next message will start a new conversation._",
        })
        .catch(() => {});
    }
  }

  /**
   * /status — Show information about the current session and workspace.
   */
  private async handleStatusCommand(message: ChannelMessage, config: ChannelConfig): Promise<void> {
    const adapter = this.adapters.get(message.channelAccountId);
    if (!adapter) return;

    const peerKind = this.sessionRouter.inferPeerKind(message);
    const peerId = peerKind === "dm" ? message.from.id : message.to.id;
    const scope = config.sessionScope ?? "per-peer";
    const sessionKey = this.sessionRouter.buildSessionKey(
      message.channelType,
      peerKind,
      peerId,
      scope
    );

    const sessions = this.sessionRouter.listSessions(config.accountId);
    const mySession = sessions.find((s) => s.sessionKey === sessionKey);
    const chatId = message.to.id || message.from.id;

    const lines: string[] = [];
    lines.push(`*Channel:* ${config.type} (${config.accountId})`);
    lines.push(`*Status:* ${adapter.status}`);
    lines.push(`*Session scope:* ${scope}`);
    lines.push(`*Total sessions:* ${sessions.length}`);

    if (mySession) {
      lines.push("");
      lines.push(`*Your session:*`);
      lines.push(`  Workspace: \`${mySession.workspaceId.slice(0, 12)}…\``);
      lines.push(`  Started: ${new Date(mySession.createdAt).toLocaleString()}`);
      lines.push(`  Last active: ${new Date(mySession.lastMessageAt).toLocaleString()}`);
    } else {
      lines.push("");
      lines.push("_No active session. Send a message to start one._");
    }

    lines.push("");
    lines.push("_Commands: /new (reset session), /status (this info)_");

    await adapter
      .sendMessage({
        to: { id: chatId },
        text: lines.join("\n"),
      })
      .catch(() => {});
  }

  // ── Voice transcription ─────────────────────────────────────────────

  /**
   * Transcribe audio using OpenAI Whisper API.
   * Falls back gracefully if no API key or if transcription fails.
   */
  private async transcribeAudio(dataUrl: string, mimeType: string): Promise<string | null> {
    // Look for OpenAI API key in provider config or env
    const providersConfig = this.config.loadProvidersConfig();
    const openaiKey = providersConfig?.["openai"]?.apiKey ?? process.env.OPENAI_API_KEY;

    if (!openaiKey) {
      log.debug("[ChannelService] No OpenAI API key available for voice transcription");
      return null;
    }

    try {
      // Convert data URL to buffer
      const base64Data = dataUrl.split(",")[1];
      if (!base64Data) return null;

      const buffer = Buffer.from(base64Data, "base64");

      // Determine file extension from mime type
      const extMap: Record<string, string> = {
        "audio/ogg": "ogg",
        "audio/mpeg": "mp3",
        "audio/mp4": "m4a",
        "audio/webm": "webm",
        "audio/wav": "wav",
      };
      const ext = extMap[mimeType] ?? "ogg";

      // Build multipart form data for Whisper API
      const boundary = `----FormBoundary${Date.now()}`;
      const formParts: Buffer[] = [];

      // File part
      formParts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="voice.${ext}"\r\n` +
            `Content-Type: ${mimeType}\r\n\r\n`
        )
      );
      formParts.push(buffer);
      formParts.push(Buffer.from("\r\n"));

      // Model part
      formParts.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="model"\r\n\r\n` +
            `whisper-1\r\n`
        )
      );

      // Closing boundary
      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(formParts);

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!response.ok) {
        const errText = await response.text();
        log.warn("[ChannelService] Whisper API error", { status: response.status, error: errText });
        return null;
      }

      const result = (await response.json()) as { text?: string };
      const transcript = result.text?.trim();

      if (transcript) {
        log.info("[ChannelService] Voice message transcribed", {
          length: transcript.length,
          preview: transcript.slice(0, 80),
        });
      }

      return transcript || null;
    } catch (error) {
      log.error("[ChannelService] Voice transcription error", { error });
      return null;
    }
  }
}

// ── Channel system prompts ────────────────────────────────────────────────

/**
 * Platform-specific system instructions that tell the LLM how to craft its
 * response for the target channel. The LLM handles formatting, tone, length,
 * and message splitting natively — no post-processing gymnastics needed.
 */
// ── Autonomous agent identity ──────────────────────────────────────────────

const AGENT_IDENTITY = `You are an autonomous AI agent with full capability to act, not just talk. You are chatting with a real person on a messaging app. Behave like a brilliant friend who happens to be a genius engineer — not like a corporate chatbot.

CORE BEHAVIOUR:
• ACT, don't advise. When asked to do something, DO IT. Don't explain how — just do it.
• NEVER say "I can't do that" or "I'm not able to". Find an alternative and do that instead. If you truly have zero options, say so in ONE short sentence and move on — no bullet lists of what you CAN do, no suggestions to use other tools.
• NEVER apologize. No "sorry", "unfortunately", "I appreciate...". Just solve the problem.
• ZERO filler. No "Great question!", "Sure!", "I'd be happy to help!", "Absolutely!", "Of course!". Just answer.
• NEVER list your capabilities or limitations unprompted. Nobody cares what you can or can't do — they care about getting their thing done.
• When you see an image, analyze it immediately. Describe what you see. Never ask the user to describe it.
• When a task fails, try a different approach silently. Don't narrate your retries.
• Match the user's language, tone, and energy exactly. If they text casually, you text casually. If they're technical, be technical. If they use slang, use slang.
• Keep responses SHORT by default. Expand only when the task demands it.
• You have personality. You have opinions. You're not a yes-machine.`;

// ── Platform-specific formatting rules ───────────────────────────────────

const CHANNEL_SYSTEM_PROMPTS: Record<string, string> = {
  telegram: `${AGENT_IDENTITY}

TELEGRAM FORMATTING:
• Write conversationally — short, punchy messages like a real person texting.
• Keep each message under 3000 characters. Most should be much shorter.
• Split long responses into multiple messages using "---" on its own line. Each part should feel like a natural follow-up.
• Use Telegram markdown: *bold*, _italic_, \`inline code\`, \`\`\`code blocks\`\`\`. No HTML.
• Use emoji naturally but don't overdo it.
• Bullet points and numbered lists — keep them tight.
• No markdown headers (# etc.) — Telegram doesn't render them.
• Long code → its own message (use --- before and after).`,

  discord: `${AGENT_IDENTITY}

DISCORD FORMATTING:
• Write conversationally — chat-style responses.
• Keep each message under 1800 characters (Discord limit is 2000).
• Split long responses using "---" on its own line.
• Use Discord markdown: **bold**, *italic*, __underline__, ~~strikethrough~~, \`inline code\`, \`\`\`code blocks\`\`\`.
• Use emoji naturally.
• Long code → its own message.`,

  slack: `${AGENT_IDENTITY}

SLACK FORMATTING:
• Write concise, scannable messages.
• Keep each message under 3000 characters.
• Split long responses using "---" on its own line.
• Use Slack mrkdwn: *bold*, _italic_, ~strikethrough~, \`inline code\`, \`\`\`code blocks\`\`\`.
• Use emoji codes like :thumbsup: naturally.`,

  whatsapp: `${AGENT_IDENTITY}

WHATSAPP FORMATTING:
• Write like you're texting a friend. Short, natural.
• Most messages: 1-3 sentences.
• Split long responses using "---" on its own line.
• Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~, \`\`\`monospace\`\`\`.
• Use emoji naturally — WhatsApp users expect them.
• No code blocks or technical formatting — keep it simple.`,
};

function getChannelSystemPrompt(channelType: string): string {
  return CHANNEL_SYSTEM_PROMPTS[channelType] ?? CHANNEL_SYSTEM_PROMPTS.telegram!;
}

// ── Safety-net splitting ──────────────────────────────────────────────────

/**
 * Hard-split a message that exceeds the platform max length.
 * Only used as a safety net — the LLM should already handle splitting via "---".
 */
function hardSplit(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.3) {
      cut = remaining.lastIndexOf(" ", maxLen);
    }
    if (cut < maxLen * 0.3) {
      cut = maxLen;
    }

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}
