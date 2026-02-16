/**
 * TelegramAdapter — connects to Telegram Bot API via long-polling.
 *
 * Uses native fetch (no heavy deps). Normalizes Telegram updates into
 * the platform-agnostic ChannelMessage format.
 */
import { EventEmitter } from "events";
import type { ChannelAdapter } from "@/common/types/channel";
import type {
  ChannelConfig,
  ChannelMessage,
  ChannelStatus,
  OutboundChannelMessage,
  ChannelSendResult,
} from "@/common/orpc/schemas/channels";
import { log } from "@/node/services/log";

// ── Telegram API types (minimal subset) ─────────────────────────────────

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramMessageEntity {
  type: string; // "mention", "bot_command", "text_mention", etc.
  offset: number;
  length: number;
  user?: TelegramUser;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  voice?: TelegramVoice;
  audio?: TelegramDocument;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

// ── Adapter ─────────────────────────────────────────────────────────────

export class TelegramAdapter extends EventEmitter implements ChannelAdapter {
  readonly type = "telegram" as const;
  readonly accountId: string;

  /** Bot username from getMe — used for group chat @mention filtering */
  private _botUsername?: string;

  private _status: ChannelStatus = "disconnected";
  private config?: ChannelConfig;
  private abortController?: AbortController;
  private lastUpdateId = 0;
  private polling = false;

  /** The bot's username (available after connect). Used for group mention detection. */
  get botUsername(): string | undefined {
    return this._botUsername;
  }

  constructor(config: ChannelConfig) {
    super();
    this.accountId = config.accountId;
  }

  get status(): ChannelStatus {
    return this._status;
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

  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(config: ChannelConfig): Promise<void> {
    this.config = config;

    if (!this.token) {
      throw new Error("Telegram bot token not provided in credentials.botToken");
    }

    this.setStatus("connecting");

    try {
      // Validate token via getMe
      const response = await fetch(this.apiUrl("getMe"));
      const data = (await response.json()) as TelegramApiResponse<TelegramUser>;

      if (!data.ok) {
        throw new Error(`Telegram getMe failed: ${data.description ?? "unknown error"}`);
      }

      this._botUsername = data.result.username;

      log.info("[TelegramAdapter] Connected", {
        accountId: this.accountId,
        botUsername: this._botUsername,
      });

      // Start long-polling
      this.abortController = new AbortController();
      this.polling = true;
      this.setStatus("connected");

      // Fire-and-forget polling loop
      void this.pollLoop();
    } catch (error) {
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.polling = false;
    this.abortController?.abort();
    this.abortController = undefined;
    this.setStatus("disconnected");
    log.info("[TelegramAdapter] Disconnected", { accountId: this.accountId });
  }

  // ── Polling ───────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const url = `${this.apiUrl("getUpdates")}?offset=${this.lastUpdateId + 1}&timeout=30`;
        const response = await fetch(url, {
          signal: this.abortController?.signal,
        });

        if (!response.ok) {
          if (response.status === 409) {
            // 409 Conflict = another instance is already polling this bot token.
            // Stop immediately — retrying will just spam errors.
            log.error("[TelegramAdapter] 409 Conflict — another process is polling this bot token. Stopping.", {
              accountId: this.accountId,
            });
            this.polling = false;
            this.setStatus("error");
            break;
          }
          log.error("[TelegramAdapter] Polling HTTP error", { status: response.status, accountId: this.accountId });
          await this.sleep(5000);
          continue;
        }

        const data = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;

        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            if (update.message) {
              this.handleTelegramMessage(update.message);
            }
          }
        }
      } catch (error) {
        if (!this.polling) break; // Expected abort during disconnect

        log.error("[TelegramAdapter] Polling exception", { error });
        this.setStatus("error");
        await this.sleep(5000);
        if (this.polling) this.setStatus("connected"); // Retry
      }
    }
  }

  private handleTelegramMessage(msg: TelegramMessage): void {
    // Skip messages without sender (channel posts, etc.)
    if (!msg.from) return;

    // Build attachments from photos/documents/voice
    const attachments: Array<{ type: "image" | "file" | "audio" | "video"; url?: string; mimeType?: string; filename?: string }> = [];

    if (msg.photo && msg.photo.length > 0) {
      // Telegram sends multiple sizes — use the largest
      const largest = msg.photo[msg.photo.length - 1]!;
      attachments.push({
        type: "image",
        url: `tg-file://${largest.file_id}`,
        mimeType: "image/jpeg",
      });
    }

    if (msg.document) {
      attachments.push({
        type: "file",
        url: `tg-file://${msg.document.file_id}`,
        mimeType: msg.document.mime_type,
        filename: msg.document.file_name,
      });
    }

    if (msg.voice) {
      attachments.push({
        type: "audio",
        url: `tg-file://${msg.voice.file_id}`,
        mimeType: msg.voice.mime_type ?? "audio/ogg",
      });
    }

    if (msg.audio) {
      attachments.push({
        type: "audio",
        url: `tg-file://${msg.audio.file_id}`,
        mimeType: msg.audio.mime_type ?? "audio/mpeg",
        filename: msg.audio.file_name,
      });
    }

    // Use caption for media messages, fall back to text
    const text = msg.text ?? msg.caption;

    // Detect if bot is mentioned in group chats (for filtering)
    const allEntities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
    const hasBotCommand = allEntities.some((e) => e.type === "bot_command");
    const hasBotMention = this._botUsername
      ? allEntities.some(
          (e) =>
            e.type === "mention" &&
            (msg.text ?? msg.caption ?? "")
              .slice(e.offset, e.offset + e.length)
              .toLowerCase() === `@${this._botUsername!.toLowerCase()}`
        )
      : false;

    // Check if this is a reply to the bot's own message
    // (Telegram includes reply_to_message but we keep types minimal — check via text mention)
    const isGroupChat = msg.chat.type === "group" || msg.chat.type === "supergroup";

    const channelMessage: ChannelMessage = {
      id: `tg-${this.accountId}-${msg.message_id}`,
      channelType: "telegram",
      channelAccountId: this.accountId,
      externalMessageId: String(msg.message_id),
      direction: "inbound",
      from: {
        id: String(msg.from.id),
        username: msg.from.username,
        displayName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
      },
      to: {
        id: String(msg.chat.id),
      },
      content: {
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      timestamp: msg.date * 1000,
      metadata: {
        chatType: msg.chat.type,
        isGroupChat,
        hasBotMention,
        hasBotCommand,
      },
    };

    this.emit("message", channelMessage);
  }

  // ── Sending ───────────────────────────────────────────────────────────

  /**
   * Send a "typing…" indicator to a chat. Telegram shows it for ~5 seconds.
   * Call repeatedly for long operations.
   */
  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.config) return;
    try {
      await fetch(this.apiUrl("sendChatAction"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      });
    } catch {
      // Best-effort — don't fail the main flow
    }
  }

  /**
   * Download a file from Telegram by file_id.
   * Uses getFile → file_path → download URL → base64 data URL.
   */
  async downloadFile(fileId: string): Promise<{ dataUrl: string; mimeType: string } | null> {
    if (!this.config) return null;

    try {
      // Step 1: Get file path from Telegram
      const fileInfoRes = await fetch(this.apiUrl("getFile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      });
      const fileInfo = (await fileInfoRes.json()) as TelegramApiResponse<{
        file_id: string;
        file_path?: string;
        file_size?: number;
      }>;

      if (!fileInfo.ok || !fileInfo.result.file_path) {
        log.warn("[TelegramAdapter] getFile failed", { fileId, error: fileInfo.description });
        return null;
      }

      // Skip files larger than 15MB (Telegram bot API limit is 20MB, but be conservative for base64 bloat)
      if (fileInfo.result.file_size && fileInfo.result.file_size > 15 * 1024 * 1024) {
        log.warn("[TelegramAdapter] File too large, skipping download", {
          fileId,
          size: fileInfo.result.file_size,
        });
        return null;
      }

      // Step 2: Download the file bytes
      const downloadUrl = `https://api.telegram.org/file/bot${this.token}/${fileInfo.result.file_path}`;
      const fileRes = await fetch(downloadUrl);
      if (!fileRes.ok) {
        log.warn("[TelegramAdapter] File download failed", { fileId, status: fileRes.status });
        return null;
      }

      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const base64 = buffer.toString("base64");

      // Infer MIME type from file path extension
      const ext = fileInfo.result.file_path.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        pdf: "application/pdf",
        mp4: "video/mp4",
        ogg: "audio/ogg",
        mp3: "audio/mpeg",
      };
      const mimeType = mimeMap[ext] ?? "application/octet-stream";

      return {
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
      };
    } catch (error) {
      log.error("[TelegramAdapter] downloadFile error", { fileId, error });
      return null;
    }
  }

  async sendMessage(message: OutboundChannelMessage): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    const text = message.text ?? "";

    try {
      // Send with Markdown parse mode — the LLM is instructed to write
      // Telegram-native markdown (*bold*, _italic_, `code`, ```blocks```).
      // If Markdown parsing fails, retry as plain text.
      let response = await fetch(this.apiUrl("sendMessage"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: message.to.id,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          ...(message.threadId ? { message_thread_id: Number(message.threadId) } : {}),
        }),
      });

      let data = (await response.json()) as TelegramApiResponse<TelegramMessage>;

      // If Markdown parsing failed (unmatched entities, etc.), retry as plain text
      if (!data.ok && (data.description?.includes("parse") || data.description?.includes("entity"))) {
        log.warn("[TelegramAdapter] Markdown parse failed, retrying as plain text", {
          error: data.description,
        });
        response = await fetch(this.apiUrl("sendMessage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.to.id,
            text,
            disable_web_page_preview: true,
            ...(message.threadId ? { message_thread_id: Number(message.threadId) } : {}),
          }),
        });
        data = (await response.json()) as TelegramApiResponse<TelegramMessage>;
      }

      if (!data.ok) {
        return { success: false, error: data.description ?? "Telegram API error" };
      }

      return {
        success: true,
        externalId: String(data.result.message_id),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a photo to a chat. Accepts a URL or base64 data URL.
   */
  async sendPhoto(
    chatId: string,
    photoUrl: string,
    caption?: string
  ): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    try {
      const response = await fetch(this.apiUrl("sendPhoto"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          ...(caption ? { caption, parse_mode: "Markdown" } : {}),
        }),
      });

      const data = (await response.json()) as TelegramApiResponse<TelegramMessage>;

      if (!data.ok) {
        return { success: false, error: data.description ?? "sendPhoto failed" };
      }

      return { success: true, externalId: String(data.result.message_id) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send a document/file to a chat.
   */
  async sendDocument(
    chatId: string,
    documentUrl: string,
    caption?: string,
    filename?: string
  ): Promise<ChannelSendResult> {
    if (!this.config) {
      return { success: false, error: "Not connected" };
    }

    try {
      const response = await fetch(this.apiUrl("sendDocument"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          document: documentUrl,
          ...(caption ? { caption, parse_mode: "Markdown" } : {}),
          ...(filename ? { filename } : {}),
        }),
      });

      const data = (await response.json()) as TelegramApiResponse<TelegramMessage>;

      if (!data.ok) {
        return { success: false, error: data.description ?? "sendDocument failed" };
      }

      return { success: true, externalId: String(data.result.message_id) };
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

  // ── Helpers ───────────────────────────────────────────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

