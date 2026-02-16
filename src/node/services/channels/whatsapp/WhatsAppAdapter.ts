/**
 * WhatsAppAdapter — connects to WhatsApp Business Cloud API.
 *
 * Uses the Meta Graph API (v21.0) for sending and a local webhook receiver
 * for receiving inbound messages. Normalizes WhatsApp messages into the
 * platform-agnostic ChannelMessage format.
 *
 * Architecture:
 * - Outbound: REST calls to graph.facebook.com
 * - Inbound: Starts a tiny HTTP server that receives Meta webhook callbacks.
 *   Configure your WhatsApp Business webhook URL to point to this server.
 *
 * Required credentials:
 * - accessToken: Meta Graph API access token (permanent or system user token)
 * - phoneNumberId: WhatsApp Business phone number ID
 *
 * Optional settings:
 * - webhookPort: Port for the local webhook server (default: 3478)
 * - webhookVerifyToken: Token for webhook verification handshake (default: random)
 * - graphApiVersion: Meta Graph API version (default: v21.0)
 */
import { EventEmitter } from "events";
import * as http from "http";
import * as crypto from "crypto";
import type { ChannelAdapter } from "@/common/types/channel";
import type {
  ChannelConfig,
  ChannelMessage,
  ChannelStatus,
  OutboundChannelMessage,
  ChannelSendResult,
} from "@/common/orpc/schemas/channels";
import { log } from "@/node/services/log";

// ── WhatsApp Cloud API types (minimal subset) ────────────────────────────

interface WAContact {
  profile: { name: string };
  wa_id: string;
}

interface WATextMessage {
  body: string;
}

interface WAImageMessage {
  id: string;
  mime_type: string;
  caption?: string;
}

interface WADocumentMessage {
  id: string;
  mime_type: string;
  filename?: string;
  caption?: string;
}

interface WAAudioMessage {
  id: string;
  mime_type: string;
}

interface WAVideoMessage {
  id: string;
  mime_type: string;
  caption?: string;
}

interface WAMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "image" | "document" | "audio" | "video" | "location" | "contacts" | "sticker" | "reaction";
  text?: WATextMessage;
  image?: WAImageMessage;
  document?: WADocumentMessage;
  audio?: WAAudioMessage;
  video?: WAVideoMessage;
  context?: { message_id: string };
}

interface WAWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: WAContact[];
      messages?: WAMessage[];
    };
    field: string;
  }>;
}

interface WAWebhookPayload {
  object: string;
  entry: WAWebhookEntry[];
}

// ── Adapter ─────────────────────────────────────────────────────────────

export class WhatsAppAdapter extends EventEmitter implements ChannelAdapter {
  readonly type = "whatsapp" as const;
  readonly accountId: string;

  private _status: ChannelStatus = "disconnected";
  private config?: ChannelConfig;
  private webhookServer?: http.Server;
  private _botUsername?: string;

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

  private get accessToken(): string {
    return this.config?.credentials.accessToken ?? "";
  }

  private get phoneNumberId(): string {
    return this.config?.credentials.phoneNumberId ?? "";
  }

  private get graphApiVersion(): string {
    return (this.config?.settings?.graphApiVersion as string) ?? "v21.0";
  }

  private get webhookPort(): number {
    const port = this.config?.settings?.webhookPort;
    return typeof port === "number" ? port : (typeof port === "string" ? parseInt(port, 10) : 3478);
  }

  private get webhookVerifyToken(): string {
    return (this.config?.settings?.webhookVerifyToken as string) ??
      (this.config?.credentials.webhookVerifyToken ?? `lattice-wa-${this.accountId}`);
  }

  private apiUrl(path: string): string {
    return `https://graph.facebook.com/${this.graphApiVersion}/${path}`;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config;

    if (!this.accessToken) {
      throw new Error("WhatsApp access token not provided in credentials.accessToken");
    }
    if (!this.phoneNumberId) {
      throw new Error("WhatsApp phone number ID not provided in credentials.phoneNumberId");
    }

    this.setStatus("connecting");

    try {
      // Validate token by fetching phone number info
      const res = await fetch(this.apiUrl(this.phoneNumberId), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`WhatsApp API auth failed: ${err}`);
      }

      const phoneInfo = (await res.json()) as { display_phone_number?: string; verified_name?: string };
      this._botUsername = phoneInfo.verified_name ?? phoneInfo.display_phone_number ?? this.phoneNumberId;

      log.info("[WhatsAppAdapter] Authenticated", {
        accountId: this.accountId,
        phoneNumber: phoneInfo.display_phone_number,
        verifiedName: phoneInfo.verified_name,
      });

      // Start webhook server for inbound messages
      await this.startWebhookServer();

      this.setStatus("connected");
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.stopWebhookServer();
    this.setStatus("disconnected");
    log.info("[WhatsAppAdapter] Disconnected", { accountId: this.accountId });
  }

  // ── Webhook Server ───────────────────────────────────────────────────

  private async startWebhookServer(): Promise<void> {
    await this.stopWebhookServer();

    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.method === "GET") {
          // Webhook verification handshake
          this.handleWebhookVerification(req, res);
        } else if (req.method === "POST") {
          // Inbound message webhook
          this.handleWebhookPost(req, res);
        } else {
          res.writeHead(405);
          res.end();
        }
      });

      server.on("error", (error) => {
        log.error("[WhatsAppAdapter] Webhook server error", { error });
        if (this._status === "connecting") {
          reject(error);
        }
      });

      server.listen(this.webhookPort, () => {
        log.info("[WhatsAppAdapter] Webhook server listening", {
          port: this.webhookPort,
          verifyToken: this.webhookVerifyToken,
        });
        this.webhookServer = server;
        resolve();
      });
    });
  }

  private async stopWebhookServer(): Promise<void> {
    if (this.webhookServer) {
      return new Promise((resolve) => {
        this.webhookServer!.close(() => {
          this.webhookServer = undefined;
          resolve();
        });
      });
    }
  }

  private handleWebhookVerification(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "", `http://localhost:${this.webhookPort}`);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === this.webhookVerifyToken) {
      log.info("[WhatsAppAdapter] Webhook verified");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      log.warn("[WhatsAppAdapter] Webhook verification failed", { mode, token });
      res.writeHead(403);
      res.end("Forbidden");
    }
  }

  private handleWebhookPost(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = "";

    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      // Always respond 200 quickly (Meta requires <20s response)
      res.writeHead(200);
      res.end("OK");

      try {
        const payload = JSON.parse(body) as WAWebhookPayload;
        if (payload.object === "whatsapp_business_account") {
          this.processWebhookPayload(payload);
        }
      } catch (error) {
        log.error("[WhatsAppAdapter] Failed to parse webhook payload", { error });
      }
    });
  }

  private processWebhookPayload(payload: WAWebhookPayload): void {
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const { contacts, messages } = change.value;
        if (!messages?.length) continue;

        // Build contact lookup
        const contactMap = new Map<string, WAContact>();
        if (contacts) {
          for (const c of contacts) {
            contactMap.set(c.wa_id, c);
          }
        }

        for (const msg of messages) {
          this.handleWhatsAppMessage(msg, contactMap);
        }
      }
    }
  }

  private handleWhatsAppMessage(msg: WAMessage, contacts: Map<string, WAContact>): void {
    const contact = contacts.get(msg.from);

    // Build text and attachments
    let text: string | undefined;
    const attachments: Array<{ type: "image" | "file" | "audio" | "video"; url?: string; mimeType?: string; filename?: string }> = [];

    switch (msg.type) {
      case "text":
        text = msg.text?.body;
        break;

      case "image":
        if (msg.image) {
          text = msg.image.caption;
          attachments.push({
            type: "image",
            url: `wa-media://${msg.image.id}`,
            mimeType: msg.image.mime_type,
          });
        }
        break;

      case "document":
        if (msg.document) {
          text = msg.document.caption;
          attachments.push({
            type: "file",
            url: `wa-media://${msg.document.id}`,
            mimeType: msg.document.mime_type,
            filename: msg.document.filename,
          });
        }
        break;

      case "audio":
        if (msg.audio) {
          attachments.push({
            type: "audio",
            url: `wa-media://${msg.audio.id}`,
            mimeType: msg.audio.mime_type,
          });
        }
        break;

      case "video":
        if (msg.video) {
          text = msg.video.caption;
          attachments.push({
            type: "video",
            url: `wa-media://${msg.video.id}`,
            mimeType: msg.video.mime_type,
          });
        }
        break;

      default:
        // Unsupported message type — send text description
        text = `[${msg.type} message — not supported yet]`;
        break;
    }

    const channelMessage: ChannelMessage = {
      id: `wa-${this.accountId}-${msg.id}`,
      channelType: "whatsapp",
      channelAccountId: this.accountId,
      externalMessageId: msg.id,
      direction: "inbound",
      from: {
        id: msg.from,
        displayName: contact?.profile.name,
      },
      to: {
        id: this.phoneNumberId,
      },
      content: {
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      timestamp: parseInt(msg.timestamp, 10) * 1000,
      metadata: {
        chatType: "dm",
        isGroupChat: false,
        hasBotMention: true, // WhatsApp DMs always address the bot
        hasBotCommand: false,
      },
    };

    this.emit("message", channelMessage);
  }

  // ── Sending ───────────────────────────────────────────────────────────

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.config) return;

    // WhatsApp doesn't have a typing indicator API,
    // but we can mark messages as "read" which shows blue checkmarks
    // No-op for typing — just use mark_read when we receive messages
  }

  async sendMessage(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    const text = message.text ?? "";

    try {
      const res = await fetch(this.apiUrl(`${this.phoneNumberId}/messages`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: message.to.id,
          type: "text",
          text: { body: text },
          ...(message.threadId ? { context: { message_id: message.threadId } } : {}),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return { success: false, error: `WhatsApp API ${res.status}: ${err}` };
      }

      const data = (await res.json()) as { messages?: Array<{ id: string }> };
      const externalId = data.messages?.[0]?.id;

      return { success: true, externalId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Download media from WhatsApp using the media ID.
   * Two-step: get media URL from Graph API, then download the binary.
   */
  async downloadFile(mediaId: string): Promise<{ dataUrl: string; mimeType: string } | null> {
    if (!this.config) return null;

    try {
      // Step 1: Get media URL
      const mediaRes = await fetch(this.apiUrl(mediaId), {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!mediaRes.ok) {
        log.warn("[WhatsAppAdapter] Media info request failed", { mediaId, status: mediaRes.status });
        return null;
      }

      const mediaInfo = (await mediaRes.json()) as { url?: string; mime_type?: string; file_size?: number };

      if (!mediaInfo.url) {
        log.warn("[WhatsAppAdapter] No URL in media info", { mediaId });
        return null;
      }

      // Skip files larger than 15MB
      if (mediaInfo.file_size && mediaInfo.file_size > 15 * 1024 * 1024) {
        log.warn("[WhatsAppAdapter] File too large", { mediaId, size: mediaInfo.file_size });
        return null;
      }

      // Step 2: Download the binary
      const fileRes = await fetch(mediaInfo.url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      if (!fileRes.ok) {
        log.warn("[WhatsAppAdapter] Media download failed", { mediaId, status: fileRes.status });
        return null;
      }

      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const mimeType = mediaInfo.mime_type ?? "application/octet-stream";
      const base64 = buffer.toString("base64");

      return {
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
      };
    } catch (error) {
      log.error("[WhatsAppAdapter] downloadFile error", { mediaId, error });
      return null;
    }
  }

  /**
   * Mark a message as read (shows blue checkmarks to sender).
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      await fetch(this.apiUrl(`${this.phoneNumberId}/messages`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    } catch {
      // Best-effort
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
