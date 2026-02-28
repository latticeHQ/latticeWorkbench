import { createHash } from "crypto";
import { EventEmitter } from "events";
import type { Config } from "@/node/config";
import { SessionFileManager } from "@/node/utils/sessionFile";
import { log } from "@/node/services/log";
import {
  INBOXES_PROJECT_MINION_ID,
} from "@/common/constants/inboxProject";
import type {
  InboxChannelId,
  InboxConversation,
  InboxConversationStatus,
  InboxMessage,
  PersistedInboxState,
} from "@/common/types/inbox";
import {
  MAX_INBOX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
} from "@/common/types/inbox";
import { DEFAULT_MODEL } from "@/common/constants/knownModels";
import type {
  InboxChannelAdapter,
  InboxInboundMessage,
  ChannelConnectionInfo,
} from "./inbox/channelAdapter";
import { formatForChannel, type FormattedResponse } from "./inbox/channelFormatter";
import { renderMarkdownToImage } from "./inbox/markdownRenderer";
import type { MinionService } from "./minionService";
import type { AIService } from "./aiService";
import type { StreamEndEvent } from "@/common/types/stream";

/**
 * Derive a stable project-scoped key for SessionFileManager.
 * Since inbox is project-level (not minion-level), we hash the
 * projectPath into a short hex identifier to use as the "minionId"
 * in SessionFileManager's path resolution.
 */
function projectScope(projectPath: string): string {
  return `__inbox__${createHash("sha256").update(projectPath).digest("hex").slice(0, 16)}`;
}

/** Maximum time to wait for an agent response before timing out (ms). */
const AGENT_RESPONSE_TIMEOUT_MS = 120_000;

/**
 * Extract the final assistant text from a chat history.
 * Walks backwards from the last message to find the latest assistant
 * response and concatenates its text parts.
 */
function extractAssistantText(
  messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const textParts = msg.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!);
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }
  }
  return null;
}

/**
 * InboxService — manages inbox conversations from channel adapters.
 *
 * Follows the KanbanService pattern exactly:
 * - EventEmitter for change notifications (→ oRPC subscription)
 * - SessionFileManager for persistence
 * - Lazy-loaded in-memory cache keyed by project scope
 * - Self-healing: corrupted JSON returns empty state
 *
 * Channel adapters (Telegram, Slack, Discord, etc.) are registered via
 * registerAdapter(). Each adapter implements InboxChannelAdapter and provides
 * normalized inbound messages. InboxService handles the common orchestration:
 * persist, emit, auto-dispatch to agent, route response back.
 */
export class InboxService {
  private readonly sessionFileManager: SessionFileManager<PersistedInboxState>;
  /** In-memory cache keyed by project scope. Lazy-loaded from disk. */
  private readonly conversations = new Map<string, InboxConversation[]>();
  /** Tracks which project scopes have been loaded from disk. */
  private readonly loadedScopes = new Set<string>();
  /** Emits (scope: string) when conversations change. */
  private readonly changeEmitter = new EventEmitter();

  /** Registered channel adapters, keyed by channel ID. */
  private readonly adapters = new Map<InboxChannelId, InboxChannelAdapter>();
  /** Unsubscribe functions for adapter message listeners. */
  private readonly adapterUnsubs = new Map<InboxChannelId, () => void>();

  // Late-bound dependencies (setter injection to avoid circular deps in ServiceContainer)
  private minionService: MinionService | null = null;
  private aiService: AIService | null = null;

  constructor(config: Config) {
    this.sessionFileManager = new SessionFileManager<PersistedInboxState>(
      config,
      "inbox.json",
    );
  }

  // ---------------------------------------------------------------------------
  // Late-bound dependency injection (called by ServiceContainer after all
  // services are created — avoids constructor circular dependency)
  // ---------------------------------------------------------------------------

  /** Wire MinionService for agent dispatch. */
  setMinionService(ws: MinionService): void {
    this.minionService = ws;
  }

  /** Wire AIService to listen for stream-end events. */
  setAIService(ai: AIService): void {
    this.aiService = ai;
  }

  // ---------------------------------------------------------------------------
  // Adapter management
  // ---------------------------------------------------------------------------

  /**
   * Register a channel adapter.
   * Call this before connect() to make the adapter available.
   * Automatically subscribes to the adapter's inbound messages.
   */
  registerAdapter(adapter: InboxChannelAdapter): void {
    const existing = this.adapters.get(adapter.channel);
    if (existing) {
      // Unsubscribe old adapter's message listener
      this.adapterUnsubs.get(adapter.channel)?.();
    }

    this.adapters.set(adapter.channel, adapter);

    // Subscribe to inbound messages from this adapter
    const unsub = adapter.onMessage((msg) => {
      this.handleInboundMessage(msg).catch((err) => {
        log.error(`InboxService: failed to handle inbound from ${adapter.channel}:`, err);
      });
    });
    this.adapterUnsubs.set(adapter.channel, unsub);

    log.info(`InboxService: registered ${adapter.channel} adapter`);
  }

  /** Get a registered adapter by channel. */
  getAdapter(channel: InboxChannelId): InboxChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  /** Get connection info for all registered adapters. */
  getConnectionStatus(): ChannelConnectionInfo[] {
    const result: ChannelConnectionInfo[] = [];
    for (const adapter of this.adapters.values()) {
      result.push(adapter.getConnectionInfo());
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Connect all registered adapters.
   * Startup-safe: individual adapter failures don't crash the service.
   */
  async connectAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.connect();
        log.info(`InboxService: ${adapter.channel} adapter connected`);
      } catch (err) {
        log.error(`InboxService: ${adapter.channel} adapter failed to connect:`, err);
        // Continue with other adapters — one failure shouldn't block the rest
      }
    }
  }

  /**
   * Connect a single adapter by channel ID.
   * Used when a bot token is added/changed at runtime.
   */
  async connectAdapter(channel: InboxChannelId): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${channel}`);
    }
    await adapter.connect();
  }

  /**
   * Disconnect a single adapter by channel ID.
   */
  async disconnectAdapter(channel: InboxChannelId): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) return;
    await adapter.disconnect();
  }

  /** Stop all adapters and persist state. */
  async stop(): Promise<void> {
    // Disconnect all adapters
    for (const adapter of this.adapters.values()) {
      try {
        await adapter.disconnect();
      } catch (err) {
        log.warn(`InboxService: error disconnecting ${adapter.channel}:`, err);
      }
    }

    // Unsubscribe all message listeners
    for (const unsub of this.adapterUnsubs.values()) {
      unsub();
    }
    this.adapterUnsubs.clear();

    await this.saveAll();
  }

  // ---------------------------------------------------------------------------
  // Inbound message handling
  // ---------------------------------------------------------------------------

  /**
   * Handle a normalized inbound message from any channel adapter.
   * Uses a default project scope since messages aren't project-routed yet.
   * TODO: route to specific project based on config/agent binding.
   */
  private async handleInboundMessage(msg: InboxInboundMessage): Promise<void> {
    // Session key: encode channel + chatType + peerId for uniqueness
    const sessionKey = `inbox:${msg.channel}:${msg.chatType}:${msg.peerId}`;
    const scope = projectScope("__global__");
    const convos = await this.ensureLoaded(scope);

    let convo = convos.find((c) => c.sessionKey === sessionKey);
    if (!convo) {
      convo = {
        sessionKey,
        channel: msg.channel,
        chatType: msg.chatType,
        displayName: msg.displayName,
        peerId: msg.peerId,
        status: "unread",
        messages: [],
        lastActivityAt: msg.timestamp,
        unreadCount: 0,
        replyRoute: msg.replyRoute,
      };
      convos.push(convo);
    }

    const newMessage: InboxMessage = {
      id: crypto.randomUUID(),
      body: msg.body,
      senderName: msg.senderName,
      senderId: msg.senderId,
      timestamp: msg.timestamp,
      direction: "inbound",
      mediaUrls: msg.mediaUrls,
    };

    convo.messages.push(newMessage);
    convo.lastActivityAt = msg.timestamp;
    convo.unreadCount += 1;
    convo.status = "unread";
    // Always update reply route with latest delivery context
    convo.replyRoute = msg.replyRoute;

    // Evict old messages within conversation
    if (convo.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      convo.messages = convo.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    }

    this.evictOldConversations(convos);

    await this.persist(scope);
    this.emitChange(scope);

    // Auto-dispatch to agent: mark as processing, then route response back.
    // This runs async — the conversation update above is already persisted
    // so the UI shows the inbound message immediately.
    this.autoDispatch(scope, convo, msg.body).catch((err) => {
      log.error("InboxService: auto-dispatch failed:", err);
    });
  }

  // ---------------------------------------------------------------------------
  // Agent auto-dispatch — sends inbound message to a Lattice agent minion,
  // waits for streaming to complete, extracts the response text, and routes
  // it back through the originating channel adapter.
  // ---------------------------------------------------------------------------

  /**
   * Auto-dispatch an inbound message to a Lattice agent and route the response back.
   *
   * Flow:
   * 1. Find or create a dedicated inbox agent minion for the project
   * 2. Send the inbound message text to the minion via MinionService
   * 3. Wait for AIService "stream-end" event (with timeout)
   * 4. Read chat history and extract the last assistant text
   * 5. Send the response back through the originating channel adapter
   */
  private async autoDispatch(
    scope: string,
    convo: InboxConversation,
    inboundBody: string,
  ): Promise<void> {
    try {
      convo.status = "processing";
      this.emitChange(scope);

      // Get agent response — either from a real minion agent or placeholder
      const agentResponse = await this.getAgentResponse(inboundBody, convo);

      // Transform agent markdown into the channel's native format.
      // Returns either inline text (short responses) or image mode
      // (long responses rendered as PNG for readable chat display).
      const formatted = formatForChannel(convo.replyRoute.channel, agentResponse);

      // Send reply back through the originating channel adapter
      const adapter = this.adapters.get(convo.replyRoute.channel);
      if (adapter) {
        await this.sendFormattedResponse(adapter, convo, formatted);
      } else {
        log.warn(`InboxService: no adapter for ${convo.replyRoute.channel} to send reply`);
      }

      // Record the outbound message
      const recordedBody = formatted.mode === "image"
        ? `${formatted.caption ?? ""}\n\n(Full response sent as image)`
        : formatted.body;
      convo.messages.push({
        id: crypto.randomUUID(),
        body: recordedBody,
        senderName: "Lattice Agent",
        senderId: "__lattice__",
        timestamp: Date.now(),
        direction: "outbound",
      });
      convo.lastActivityAt = Date.now();
      convo.status = "replied";

      await this.persist(scope);
      this.emitChange(scope);
    } catch (err) {
      convo.status = "errored";
      this.emitChange(scope);
      throw err;
    }
  }

  /**
   * Send a message to the inbox agent minion and collect the response.
   * Falls back to a placeholder if MinionService/AIService aren't wired yet.
   */
  private async getAgentResponse(
    inboundBody: string,
    _convo: InboxConversation,
  ): Promise<string> {
    if (!this.minionService || !this.aiService) {
      log.warn("InboxService: MinionService/AIService not wired — using placeholder response");
      return `[Lattice Agent] Received your message. Agent services are initializing.`;
    }

    // Use the dedicated Inboxes system project minion — created at startup
    // by serviceContainer. All channel conversations consolidate here.
    const minionId = INBOXES_PROJECT_MINION_ID;

    // Send just the raw message text — no channel metadata prefix.
    // The agent should respond as if chatting directly (plain conversation).
    // Channel routing (sending the reply back through Telegram/WhatsApp/etc.)
    // is handled by InboxService infrastructure, not the agent.
    const messageToAgent = inboundBody;

    // Send the message to the minion agent
    const sendResult = await this.minionService.sendMessage(
      minionId,
      messageToAgent,
      { model: DEFAULT_MODEL, agentId: "exec" },
    );

    if (!sendResult.success) {
      log.error("InboxService: sendMessage failed:", sendResult.error);
      return `[Lattice Agent] Unable to process your message right now. Please try again.`;
    }

    // Wait for the agent to finish streaming — listen for stream-end/stream-abort
    // events rather than polling (deterministic signal, per CLAUDE.md guidelines).
    const agentText = await this.waitForAgentResponse(minionId);
    return agentText ?? `[Lattice Agent] Processing completed but no response was generated.`;
  }

  /**
   * Wait for the agent to finish streaming and return the response text.
   * Listens to AIService stream-end/stream-abort events for the target minion.
   * Returns null if the stream aborts or times out.
   */
  private waitForAgentResponse(minionId: string): Promise<string | null> {
    const ai = this.aiService;
    const ws = this.minionService;
    if (!ai || !ws) return Promise.resolve(null);

    return new Promise<string | null>((resolve) => {
      let resolved = false;

      const cleanup = () => {
        resolved = true;
        ai.off("stream-end", onStreamEnd);
        ai.off("stream-abort", onStreamAbort);
        clearTimeout(timer);
      };

      const onStreamEnd = (event: StreamEndEvent) => {
        if (resolved || event.minionId !== minionId) return;
        cleanup();

        // Extract text from the stream-end parts directly (avoids extra disk read)
        const textParts = event.parts
          ?.filter((p: { type: string }) => p.type === "text")
          .map((p: { type: string; text?: string }) => p.text ?? "")
          .filter(Boolean);

        if (textParts && textParts.length > 0) {
          resolve(textParts.join("\n"));
          return;
        }

        // Fallback: read from history if parts aren't in the event
        void ws.getChatHistory(minionId).then((history) => {
          const text = extractAssistantText(history);
          resolve(text);
        }).catch((err) => {
          log.error("InboxService: failed to read chat history:", err);
          resolve(null);
        });
      };

      const onStreamAbort = (event: { minionId: string }) => {
        if (resolved || event.minionId !== minionId) return;
        cleanup();
        log.warn("InboxService: agent stream aborted for inbox dispatch");
        resolve(null);
      };

      // Timeout guard — don't wait forever for the agent
      const timer = setTimeout(() => {
        if (resolved) return;
        cleanup();
        log.warn("InboxService: agent response timed out");
        resolve(null);
      }, AGENT_RESPONSE_TIMEOUT_MS);

      ai.on("stream-end", onStreamEnd);
      ai.on("stream-abort", onStreamAbort);
    });
  }

  /**
   * Send a formatted response through the adapter — either as inline text
   * or as a rendered image for long responses. Humans share heavy data
   * as images/attachments; the agent should do the same.
   */
  private async sendFormattedResponse(
    adapter: InboxChannelAdapter,
    convo: InboxConversation,
    formatted: FormattedResponse,
  ): Promise<void> {
    const opts = {
      threadId: convo.replyRoute.threadId ?? undefined,
      accountId: convo.replyRoute.accountId ?? undefined,
    };

    if (formatted.mode === "image" && formatted.rawMarkdown) {
      // Long response → render markdown to PNG image and send as photo.
      // Falls back to plain text if image rendering fails.
      const imageBuffer = await renderMarkdownToImage(formatted.rawMarkdown);

      if (imageBuffer) {
        await adapter.sendPhoto(
          convo.replyRoute.to,
          imageBuffer,
          formatted.caption,
          opts,
        );
      } else {
        // Fallback: send as plain text if image rendering failed
        log.warn("InboxService: image render failed, falling back to text");
        await adapter.sendMessage(convo.replyRoute.to, formatted.body, opts);
      }
    } else {
      // Short response → send as inline text
      await adapter.sendMessage(convo.replyRoute.to, formatted.body, opts);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — called by oRPC procedures
  // ---------------------------------------------------------------------------

  /**
   * Get all conversations for a project, optionally filtered by channel.
   * Conversations are sorted by lastActivityAt descending (newest first).
   */
  async getConversations(
    projectPath: string,
    channelFilter?: InboxChannelId | null,
  ): Promise<InboxConversation[]> {
    const scope = projectScope(projectPath);
    const convos = await this.ensureLoaded(scope);

    const filtered = channelFilter
      ? convos.filter((c) => c.channel === channelFilter)
      : convos;

    // Sort by most recent activity first
    return [...filtered].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** Get a single conversation with full messages. */
  async getConversation(
    projectPath: string,
    sessionKey: string,
  ): Promise<InboxConversation | null> {
    const scope = projectScope(projectPath);
    const convos = await this.ensureLoaded(scope);
    return convos.find((c) => c.sessionKey === sessionKey) ?? null;
  }

  /** Update the status of a conversation (mark read, archive, etc.). */
  async updateStatus(
    projectPath: string,
    sessionKey: string,
    status: InboxConversationStatus,
  ): Promise<void> {
    const scope = projectScope(projectPath);
    const convos = await this.ensureLoaded(scope);
    const convo = convos.find((c) => c.sessionKey === sessionKey);
    if (!convo) return;

    convo.status = status;
    if (status === "replied" || status === "archived") {
      convo.unreadCount = 0;
    }

    await this.persist(scope);
    this.emitChange(scope);
  }

  /**
   * Send a manual reply through the appropriate channel adapter.
   * Replaces the old bridge.sendReply() — now routes through the
   * adapter registered for the conversation's channel.
   */
  async sendReply(
    projectPath: string,
    sessionKey: string,
    message: string,
  ): Promise<void> {
    const scope = projectScope(projectPath);
    const convos = await this.ensureLoaded(scope);
    const convo = convos.find((c) => c.sessionKey === sessionKey);
    if (!convo) throw new Error("Conversation not found");

    // Route through the correct channel adapter
    const adapter = this.adapters.get(convo.replyRoute.channel);
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${convo.replyRoute.channel}`);
    }

    await adapter.sendMessage(
      convo.replyRoute.to,
      message,
      {
        threadId: convo.replyRoute.threadId ?? undefined,
        accountId: convo.replyRoute.accountId ?? undefined,
      },
    );

    convo.messages.push({
      id: crypto.randomUUID(),
      body: message,
      senderName: "Lattice Agent",
      senderId: "__lattice__",
      timestamp: Date.now(),
      direction: "outbound",
    });
    convo.lastActivityAt = Date.now();
    convo.status = "replied";
    convo.unreadCount = 0;

    await this.persist(scope);
    this.emitChange(scope);
  }

  /** Subscribe to changes. Returns unsubscribe function. */
  onChange(callback: (scope: string) => void): () => void {
    this.changeEmitter.on("change", callback);
    return () => this.changeEmitter.off("change", callback);
  }

  /** Persist all loaded scopes to disk. Called on app shutdown. */
  async saveAll(): Promise<void> {
    const promises: Array<Promise<void>> = [];
    for (const scope of this.loadedScopes) {
      promises.push(this.persist(scope));
    }
    await Promise.allSettled(promises);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure conversations for a scope are loaded into memory.
   * Self-healing: corrupted files return empty array.
   */
  private async ensureLoaded(scope: string): Promise<InboxConversation[]> {
    if (!this.loadedScopes.has(scope)) {
      this.loadedScopes.add(scope);
      try {
        const persisted = await this.sessionFileManager.read(scope);
        if (
          persisted?.version === 1 &&
          Array.isArray(persisted.conversations)
        ) {
          // Self-healing: filter out malformed conversations
          const valid = persisted.conversations.filter(
            (c) =>
              typeof c.sessionKey === "string" &&
              typeof c.channel === "string" &&
              typeof c.lastActivityAt === "number",
          );
          this.conversations.set(scope, valid);
        } else {
          this.conversations.set(scope, []);
        }
      } catch (error) {
        log.error(
          "InboxService: failed to load inbox.json, starting fresh:",
          error,
        );
        this.conversations.set(scope, []);
      }
    }
    return this.conversations.get(scope) ?? [];
  }

  /** Persist current in-memory state to disk. */
  private async persist(scope: string): Promise<void> {
    const convos = this.conversations.get(scope) ?? [];
    const state: PersistedInboxState = { version: 1, conversations: convos };
    const result = await this.sessionFileManager.write(scope, state);
    if (!result.success) {
      log.error("InboxService: failed to persist:", result.error);
    }
  }

  /** Emit change event for oRPC subscription. */
  private emitChange(scope: string): void {
    this.changeEmitter.emit("change", scope);
  }

  /** Evict oldest conversations when exceeding the limit. */
  private evictOldConversations(convos: InboxConversation[]): void {
    if (convos.length <= MAX_INBOX_CONVERSATIONS) return;

    // Sort by lastActivityAt ascending — oldest first
    const sorted = [...convos].sort(
      (a, b) => a.lastActivityAt - b.lastActivityAt,
    );
    const excess = convos.length - MAX_INBOX_CONVERSATIONS;
    const toRemove = new Set(sorted.slice(0, excess));

    // Remove in place
    for (let i = convos.length - 1; i >= 0; i--) {
      if (toRemove.has(convos[i])) {
        convos.splice(i, 1);
      }
    }
  }
}
