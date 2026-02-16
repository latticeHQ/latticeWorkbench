/**
 * SlackAdapter — connects to Slack via Socket Mode (WebSocket) + Web API.
 *
 * Uses native fetch + WebSocket (no @slack/bolt dependency). Normalizes Slack
 * events into the platform-agnostic ChannelMessage format. Supports:
 * - Socket Mode (app-level token) for receiving events without a public URL
 * - Web API for sending messages, typing indicators
 * - DMs, channels, group conversations
 * - Bot mention detection in channels
 * - Thread support
 * - File/image attachments (download via Slack API)
 *
 * Required credentials:
 * - botToken: xoxb-* (Bot User OAuth Token from Slack App settings)
 * - appToken: xapp-* (App-Level Token with connections:write scope)
 */
import { EventEmitter } from "events";
import { WebSocket } from "ws";
import type { ChannelAdapter } from "@/common/types/channel";
import type {
  ChannelConfig,
  ChannelMessage,
  ChannelStatus,
  OutboundChannelMessage,
  ChannelSendResult,
} from "@/common/orpc/schemas/channels";
import { log } from "@/node/services/log";

// ── Slack API types (minimal subset) ─────────────────────────────────────

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
}

interface SlackFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  url_private_download?: string;
  size?: number;
}

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  channel_type?: string; // "im", "mpim", "channel", "group"
  bot_id?: string;
  files?: SlackFile[];
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

interface SlackSocketModePayload {
  type: string;
  envelope_id?: string;
  payload?: {
    event?: SlackMessageEvent;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Constants ─────────────────────────────────────────────────────────────

const SLACK_API = "https://slack.com/api";

// ── Adapter ─────────────────────────────────────────────────────────────

export class SlackAdapter extends EventEmitter implements ChannelAdapter {
  readonly type = "slack" as const;
  readonly accountId: string;

  private _status: ChannelStatus = "disconnected";
  private config?: ChannelConfig;
  private ws?: WebSocket;
  private botUserId?: string;
  private _botUsername?: string;
  private reconnecting = false;
  private pingInterval?: ReturnType<typeof setInterval>;

  constructor(config: ChannelConfig) {
    super();
    this.accountId = config.accountId;
  }

  get status(): ChannelStatus {
    return this._status;
  }

  get botUsername(): string | undefined {
    return this._botUsername;
  }

  private setStatus(status: ChannelStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("statusChange", status);
    }
  }

  private get botToken(): string {
    return this.config?.credentials.botToken ?? "";
  }

  private get appToken(): string {
    return this.config?.credentials.appToken ?? "";
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config;

    if (!this.botToken) {
      throw new Error("Slack bot token not provided in credentials.botToken (xoxb-*)");
    }
    if (!this.appToken) {
      throw new Error("Slack app token not provided in credentials.appToken (xapp-*)");
    }

    this.setStatus("connecting");

    try {
      // Validate bot token via auth.test
      const authRes = await this.slackApi("auth.test");
      if (!authRes.ok) {
        throw new Error(`Slack auth.test failed: ${authRes.error ?? "unknown error"}`);
      }

      this.botUserId = authRes.user_id as string;
      this._botUsername = authRes.user as string;

      log.info("[SlackAdapter] Authenticated", {
        accountId: this.accountId,
        botUsername: this._botUsername,
        botUserId: this.botUserId,
      });

      // Open Socket Mode connection
      await this.connectSocketMode();
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false;
    this.cleanup();
    this.setStatus("disconnected");
    log.info("[SlackAdapter] Disconnected", { accountId: this.accountId });
  }

  // ── Socket Mode ─────────────────────────────────────────────────────────

  private async connectSocketMode(): Promise<void> {
    this.cleanup();

    // Request a WebSocket URL from Slack
    const res = await fetch(`${SLACK_API}/apps.connections.open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = (await res.json()) as SlackApiResponse & { url?: string };
    if (!data.ok || !data.url) {
      throw new Error(`Slack apps.connections.open failed: ${data.error ?? "no URL returned"}`);
    }

    const wsUrl = data.url;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      log.debug("[SlackAdapter] Socket Mode WebSocket opened");
      this.setStatus("connected");

      // Ping every 30s to keep alive
      this.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30_000);
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const payload = JSON.parse(raw.toString()) as SlackSocketModePayload;
        this.handleSocketModePayload(payload);
      } catch (error) {
        log.error("[SlackAdapter] Failed to parse Socket Mode message", { error });
      }
    });

    ws.on("close", (code: number) => {
      log.warn("[SlackAdapter] Socket Mode closed", { code, accountId: this.accountId });
      this.stopPing();

      if (this._status !== "disconnected" && !this.reconnecting) {
        this.scheduleReconnect();
      }
    });

    ws.on("error", (error: Error) => {
      log.error("[SlackAdapter] Socket Mode error", { error: error.message });
    });
  }

  private handleSocketModePayload(payload: SlackSocketModePayload): void {
    // Always acknowledge envelope (Slack requires this within 3 seconds)
    if (payload.envelope_id && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ envelope_id: payload.envelope_id }));
    }

    switch (payload.type) {
      case "hello":
        log.debug("[SlackAdapter] Socket Mode hello received");
        break;

      case "disconnect":
        log.info("[SlackAdapter] Server requested disconnect, reconnecting");
        this.scheduleReconnect();
        break;

      case "events_api": {
        const event = payload.payload?.event;
        if (event?.type === "message" && !event.subtype) {
          this.handleSlackMessage(event);
        }
        break;
      }
    }
  }

  private handleSlackMessage(event: SlackMessageEvent): void {
    // Ignore bot's own messages
    if (event.user === this.botUserId) return;
    if (event.bot_id) return;

    // Determine peer kind from channel_type
    const isDM = event.channel_type === "im";
    const isGroupDM = event.channel_type === "mpim";
    const isChannel = event.channel_type === "channel" || event.channel_type === "group";

    // Build attachments from files
    const attachments: Array<{
      type: "image" | "file" | "audio" | "video";
      url?: string;
      mimeType?: string;
      filename?: string;
    }> = [];

    if (event.files?.length) {
      for (const file of event.files) {
        const mimeType = file.mimetype ?? "application/octet-stream";
        const isImage = mimeType.startsWith("image/");
        const isAudio = mimeType.startsWith("audio/");
        const isVideo = mimeType.startsWith("video/");

        attachments.push({
          type: isImage ? "image" : isAudio ? "audio" : isVideo ? "video" : "file",
          url: file.url_private_download ?? file.url_private,
          mimeType,
          filename: file.name,
        });
      }
    }

    // Check if bot is mentioned in text
    const hasBotMention = this.botUserId
      ? (event.text ?? "").includes(`<@${this.botUserId}>`)
      : false;

    const channelMessage: ChannelMessage = {
      id: `slack-${this.accountId}-${event.ts}`,
      channelType: "slack",
      channelAccountId: this.accountId,
      externalMessageId: event.ts,
      direction: "inbound",
      from: {
        id: event.user ?? "unknown",
      },
      to: {
        id: event.channel,
      },
      content: {
        text: event.text ?? undefined,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      threadId: event.thread_ts,
      timestamp: Math.floor(parseFloat(event.ts) * 1000),
      metadata: {
        chatType: event.channel_type,
        isGroupChat: isChannel || isGroupDM,
        hasBotMention,
        hasBotCommand: false,
      },
    };

    // Enrich sender info asynchronously (best-effort)
    this.enrichSender(channelMessage).catch(() => {});

    this.emit("message", channelMessage);
  }

  /**
   * Enrich a message with sender display name/username from Slack API.
   * Best-effort: if it fails, the message already has from.id.
   */
  private async enrichSender(message: ChannelMessage): Promise<void> {
    try {
      const res = await this.slackApi("users.info", { user: message.from.id });
      if (res.ok && res.user) {
        const user = res.user as SlackUser;
        message.from.username = user.name;
        message.from.displayName = user.real_name ?? user.name;
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnecting || this._status === "disconnected") return;
    this.reconnecting = true;
    this.setStatus("connecting");

    setTimeout(
      async () => {
        this.reconnecting = false;
        if (this._status === "disconnected") return;

        try {
          await this.connectSocketMode();
        } catch (error) {
          log.error("[SlackAdapter] Reconnect failed", { error });
          this.setStatus("error");
          // Try again after a longer delay
          setTimeout(() => {
            if (this._status !== "disconnected") {
              this.scheduleReconnect();
            }
          }, 10_000);
        }
      },
      2000 + Math.random() * 3000
    );
  }

  private cleanup(): void {
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close(1000);
      } catch {
        // ignore
      }
      this.ws = undefined;
    }
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  // ── Sending ───────────────────────────────────────────────────────────

  async sendTypingIndicator(channelId: string): Promise<void> {
    if (!this.config) return;
    // Slack doesn't have a direct typing indicator API for bots in the same way,
    // but we can use chat.meMessage or just skip. Socket Mode doesn't support typing.
    // No-op for now — Slack bots don't typically show typing.
  }

  async sendMessage(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    const text = message.text ?? "";

    try {
      const params: Record<string, string> = {
        channel: message.to.id,
        text,
      };

      // Support thread replies
      if (message.threadId) {
        params.thread_ts = message.threadId;
      }

      const res = await this.slackApi("chat.postMessage", params);

      if (!res.ok) {
        return { success: false, error: res.error ?? "Slack API error" };
      }

      return {
        success: true,
        externalId: res.ts as string,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Download a file from Slack using the bot token for authentication.
   * Slack file URLs require the Authorization header.
   */
  async downloadFile(fileUrl: string): Promise<{ dataUrl: string; mimeType: string } | null> {
    if (!this.config) return null;

    try {
      const res = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${this.botToken}` },
      });

      if (!res.ok) {
        log.warn("[SlackAdapter] File download failed", { status: res.status });
        return null;
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const buffer = Buffer.from(await res.arrayBuffer());

      // Skip files larger than 15MB
      if (buffer.length > 15 * 1024 * 1024) {
        log.warn("[SlackAdapter] File too large", { size: buffer.length });
        return null;
      }

      const base64 = buffer.toString("base64");
      return {
        dataUrl: `data:${contentType};base64,${base64}`,
        mimeType: contentType,
      };
    } catch (error) {
      log.error("[SlackAdapter] downloadFile error", { error });
      return null;
    }
  }

  // ── Slack Web API helper ───────────────────────────────────────────────

  private async slackApi(
    method: string,
    params?: Record<string, string>
  ): Promise<SlackApiResponse> {
    const url = `${SLACK_API}/${method}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: params ? JSON.stringify(params) : undefined,
    });

    return (await response.json()) as SlackApiResponse;
  }

  // ── Event subscriptions ───────────────────────────────────────────────

  onMessage(handler: (message: ChannelMessage) => void): () => void {
    this.on("message", handler);
    return () => this.off("message", handler);
  }

  onStatusChange(handler: (status: ChannelStatus) => void): () => void {
    this.on("statusChange", handler);
    return () => this.off("statusChange", handler);
  }
}
