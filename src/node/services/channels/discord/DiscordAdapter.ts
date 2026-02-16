/**
 * DiscordAdapter — connects to Discord Bot via Gateway WebSocket + REST API.
 *
 * Uses raw WebSocket (no discord.js dependency). Normalizes Discord messages
 * into the platform-agnostic ChannelMessage format. Supports:
 * - Gateway v10 with heartbeating and reconnect
 * - Message create events → inbound ChannelMessage
 * - REST sendMessage with Discord markdown (native)
 * - Typing indicator via REST
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

// ── Discord API types (minimal subset) ──────────────────────────────────

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  guild_id?: string;
}

interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const API_BASE = "https://discord.com/api/v10";

// Gateway opcodes
const OP_DISPATCH = 0;
const OP_HEARTBEAT = 1;
const OP_IDENTIFY = 2;
const OP_RESUME = 6;
const OP_RECONNECT = 7;
const OP_INVALID_SESSION = 9;
const OP_HELLO = 10;
const OP_HEARTBEAT_ACK = 11;

// Intents: GUILDS (1) + GUILD_MESSAGES (512) + MESSAGE_CONTENT (32768) + DIRECT_MESSAGES (4096)
const INTENTS = 1 | 512 | 4096 | 32768;

// ── Adapter ─────────────────────────────────────────────────────────────

export class DiscordAdapter extends EventEmitter implements ChannelAdapter {
  readonly type = "discord" as const;
  readonly accountId: string;

  private _status: ChannelStatus = "disconnected";
  private config?: ChannelConfig;
  private ws?: WebSocket;
  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private lastSequence: number | null = null;
  private sessionId?: string;
  private resumeGatewayUrl?: string;
  private botUserId?: string;
  private _botUsername?: string;
  private reconnecting = false;

  constructor(config: ChannelConfig) {
    super();
    this.accountId = config.accountId;
  }

  get status(): ChannelStatus {
    return this._status;
  }

  /** Bot username (available after connect) — used for group mention detection. */
  get botUsername(): string | undefined {
    return this._botUsername;
  }

  private setStatus(status: ChannelStatus): void {
    if (this._status !== status) {
      this._status = status;
      this.emit("statusChange", status);
    }
  }

  private get token(): string {
    return this.config?.credentials.botToken ?? "";
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config;

    if (!this.token) {
      throw new Error("Discord bot token not provided in credentials.botToken");
    }

    this.setStatus("connecting");

    try {
      // Validate token via GET /users/@me
      const meRes = await fetch(`${API_BASE}/users/@me`, {
        headers: { Authorization: `Bot ${this.token}` },
      });

      if (!meRes.ok) {
        const err = await meRes.text();
        throw new Error(`Discord auth failed: ${err}`);
      }

      const me = (await meRes.json()) as DiscordUser;
      this.botUserId = me.id;
      this._botUsername = me.username;

      log.info("[DiscordAdapter] Authenticated", {
        accountId: this.accountId,
        botUsername: this._botUsername,
      });

      // Connect to Gateway
      this.connectGateway(GATEWAY_URL);
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.reconnecting = false;
    this.cleanup();
    this.setStatus("disconnected");
    log.info("[DiscordAdapter] Disconnected", { accountId: this.accountId });
  }

  // ── Gateway WebSocket ─────────────────────────────────────────────────

  private connectGateway(url: string): void {
    this.cleanup();

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      log.debug("[DiscordAdapter] Gateway WebSocket opened");
    });

    ws.on("message", (raw: Buffer) => {
      try {
        const payload = JSON.parse(raw.toString()) as GatewayPayload;
        this.handleGatewayPayload(payload);
      } catch (error) {
        log.error("[DiscordAdapter] Failed to parse Gateway message", { error });
      }
    });

    ws.on("close", (code: number) => {
      log.warn("[DiscordAdapter] Gateway closed", { code, accountId: this.accountId });
      this.stopHeartbeat();

      // Auto-reconnect on non-fatal close codes
      if (this._status !== "disconnected" && !this.reconnecting) {
        // 4004 = auth failed, 4010 = invalid shard, 4011 = sharding required, 4014 = disallowed intent
        const fatal = code === 4004 || code === 4010 || code === 4011 || code === 4014;
        if (!fatal) {
          this.scheduleReconnect();
        } else {
          this.setStatus("error");
          log.error("[DiscordAdapter] Fatal close code, not reconnecting", { code });
        }
      }
    });

    ws.on("error", (error: Error) => {
      log.error("[DiscordAdapter] Gateway error", { error: error.message });
    });
  }

  private handleGatewayPayload(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case OP_HELLO: {
        const { heartbeat_interval } = payload.d as { heartbeat_interval: number };
        this.startHeartbeat(heartbeat_interval);

        if (this.sessionId && this.lastSequence !== null) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case OP_HEARTBEAT_ACK:
        break;

      case OP_HEARTBEAT:
        this.sendHeartbeat();
        break;

      case OP_RECONNECT:
        log.info("[DiscordAdapter] Server requested reconnect");
        this.scheduleReconnect();
        break;

      case OP_INVALID_SESSION: {
        const canResume = payload.d as boolean;
        if (!canResume) {
          this.sessionId = undefined;
          this.lastSequence = null;
        }
        // Wait 1-5s then reconnect (Discord requirement)
        setTimeout(() => this.scheduleReconnect(), 1000 + Math.random() * 4000);
        break;
      }

      case OP_DISPATCH:
        this.handleDispatch(payload.t!, payload.d);
        break;
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    switch (event) {
      case "READY": {
        const ready = data as { session_id: string; resume_gateway_url: string };
        this.sessionId = ready.session_id;
        this.resumeGatewayUrl = ready.resume_gateway_url;
        this.setStatus("connected");
        log.info("[DiscordAdapter] Gateway READY", { accountId: this.accountId });
        break;
      }

      case "RESUMED":
        this.setStatus("connected");
        log.info("[DiscordAdapter] Gateway RESUMED");
        break;

      case "MESSAGE_CREATE":
        this.handleDiscordMessage(data as DiscordMessage);
        break;
    }
  }

  private handleDiscordMessage(msg: DiscordMessage): void {
    // Ignore bot's own messages and other bots
    if (msg.author.id === this.botUserId) return;
    if (msg.author.bot) return;

    const isDM = !msg.guild_id;

    const channelMessage: ChannelMessage = {
      id: `discord-${this.accountId}-${msg.id}`,
      channelType: "discord",
      channelAccountId: this.accountId,
      externalMessageId: msg.id,
      direction: "inbound",
      from: {
        id: msg.author.id,
        username: msg.author.username,
        displayName: msg.author.global_name ?? msg.author.username,
      },
      to: {
        id: msg.channel_id,
      },
      content: {
        text: msg.content || undefined,
      },
      timestamp: new Date(msg.timestamp).getTime(),
      metadata: {
        peerKind: isDM ? "dm" : "group",
        guildId: msg.guild_id,
      },
    };

    this.emit("message", channelMessage);
  }

  // ── Gateway sending ───────────────────────────────────────────────────

  private send(payload: GatewayPayload): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private sendIdentify(): void {
    this.send({
      op: OP_IDENTIFY,
      d: {
        token: this.token,
        intents: INTENTS,
        properties: {
          os: process.platform,
          browser: "lattice-workbench",
          device: "lattice-workbench",
        },
      },
    });
  }

  private sendResume(): void {
    this.send({
      op: OP_RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.lastSequence,
      },
    });
  }

  private sendHeartbeat(): void {
    this.send({ op: OP_HEARTBEAT, d: this.lastSequence });
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    // First heartbeat: jitter (Discord requirement)
    const jitter = Math.random() * intervalMs;
    setTimeout(() => {
      this.sendHeartbeat();
      this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), intervalMs);
    }, jitter);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnecting || this._status === "disconnected") return;
    this.reconnecting = true;
    this.setStatus("connecting");

    setTimeout(() => {
      this.reconnecting = false;
      if (this._status === "disconnected") return;

      const url = this.resumeGatewayUrl
        ? `${this.resumeGatewayUrl}/?v=10&encoding=json`
        : GATEWAY_URL;
      this.connectGateway(url);
    }, 2000 + Math.random() * 3000);
  }

  private cleanup(): void {
    this.stopHeartbeat();
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

  // ── Sending ───────────────────────────────────────────────────────────

  /**
   * Send a typing indicator to a Discord channel.
   */
  async sendTypingIndicator(channelId: string): Promise<void> {
    if (!this.config) return;
    try {
      await fetch(`${API_BASE}/channels/${channelId}/typing`, {
        method: "POST",
        headers: { Authorization: `Bot ${this.token}` },
      });
    } catch {
      // Best-effort
    }
  }

  async sendMessage(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    const text = message.text ?? "";

    try {
      const response = await fetch(`${API_BASE}/channels/${message.to.id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: text }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, error: `Discord API ${response.status}: ${err}` };
      }

      const data = (await response.json()) as DiscordMessage;
      return { success: true, externalId: data.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
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
