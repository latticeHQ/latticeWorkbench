/**
 * TelegramAdapter — direct grammY-based Telegram adapter for the inbox.
 *
 * Ported from latticeWorkbench-runtime's TelegramChannel.ts but adapted to
 * Lattice's InboxChannelAdapter interface. No external gateway needed — connects
 * directly to Telegram's Bot API via long-polling.
 *
 * Features (from grammY ecosystem):
 * - Per-chat-ID sequentialization via @grammyjs/runner
 * - Global + per-chat rate limiting via @grammyjs/transformer-throttler
 * - Automatic retry on transient errors (built into grammY)
 * - 409 conflict detection (multiple bot instances)
 * - Fragment buffering: groups rapid messages from the same chat within 300ms
 * - Markdown-to-plain-text fallback when Telegram rejects formatted messages
 * - Outbound message chunking (Telegram 4096 char limit)
 * - Typing indicator on outbound sends
 */
import { Bot, GrammyError, InputFile, type Context } from "grammy";
import { run, sequentialize } from "@grammyjs/runner";
import { apiThrottler } from "@grammyjs/transformer-throttler";
import { log } from "@/node/services/log";
import type {
  InboxChannelAdapter,
  InboxInboundMessage,
  ChannelAdapterStatus,
  ChannelConnectionInfo,
} from "./channelAdapter";

// ── Constants ────────────────────────────────────────────────────────────────

/** Telegram's max message length */
const MAX_MESSAGE_LENGTH = 4096;
/** Fragment buffering window (ms) — group rapid messages from same chat */
const FRAGMENT_DEBOUNCE_MS = 300;

// ── Internal types ───────────────────────────────────────────────────────────

interface FragmentState {
  buffer: string[];
  timer: ReturnType<typeof setTimeout>;
  /** Metadata from the latest message in the buffer */
  meta: FragmentMeta;
}

interface FragmentMeta {
  userId: string;
  username?: string;
  displayName?: string;
  peerKind: "dm" | "group";
  chatId: string;
  messageId: number;
  timestamp: number;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export class TelegramAdapter implements InboxChannelAdapter {
  readonly channel = "telegram" as const;

  private bot: Bot | null = null;
  private runner: ReturnType<typeof run> | null = null;
  private status: ChannelAdapterStatus = "disconnected";
  private username: string | undefined;
  private errorMessage: string | undefined;
  private readonly fragmentBuffer = new Map<string, FragmentState>();

  // Handler arrays — simple pub/sub pattern matching TelegramChannel.ts
  private messageHandlers: Array<(msg: InboxInboundMessage) => void> = [];
  private statusHandlers: Array<(status: ChannelAdapterStatus) => void> = [];

  constructor(private readonly botToken: string) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.bot) {
      await this.disconnect();
    }

    this.setStatus("connecting");
    this.errorMessage = undefined;

    try {
      const bot = new Bot(this.botToken);

      // Rate limiting: respects Telegram's global (30/s) and per-chat (1/s) limits
      bot.api.config.use(apiThrottler());

      // Sequentialization: per-chat ordering via @grammyjs/runner
      bot.use(
        sequentialize((ctx) => {
          const chatId = ctx.chat?.id.toString();
          const fromId = ctx.from?.id.toString();
          return chatId ?? fromId ?? "global";
        }),
      );

      // Register message handler
      bot.on("message", (ctx) => {
        this.handleRawMessage(ctx);
      });

      // Graceful error handling
      bot.catch((err) => {
        const inner = err.error;
        if (inner instanceof GrammyError) {
          if (inner.error_code === 401) {
            log.error("[TelegramAdapter] 401 Unauthorized — invalid token. Stopping.", {
              description: inner.description,
            });
            this.errorMessage = "Invalid bot token (401 Unauthorized)";
            void this.disconnect();
            this.setStatus("error");
            return;
          }
          if (inner.error_code === 409) {
            log.error("[TelegramAdapter] 409 Conflict — another instance is polling. Stopping.", {
              description: inner.description,
            });
            this.errorMessage = "Another bot instance is running (409 Conflict)";
            void this.disconnect();
            this.setStatus("error");
            return;
          }
          // Transient errors are logged; grammY runner handles retries
          log.warn("[TelegramAdapter] GrammyError (transient)", {
            code: inner.error_code,
            description: inner.description,
          });
          return;
        }
        log.error("[TelegramAdapter] Unhandled error in bot update handler", { err });
      });

      // Verify the token and get bot info
      const me = await bot.api.getMe();
      this.username = me.username;
      log.info("[TelegramAdapter] Connected", { username: this.username });

      // Start polling with the runner (supports graceful shutdown).
      // Disable automatic retry on source errors — 409 Conflict (another instance
      // polling the same token) should stop immediately, not retry forever.
      const handle = run(bot, {
        runner: { maxRetryTime: 0, silent: true },
      });

      // handle.task() resolves (or rejects) when the runner stops.
      // Without awaiting it, a crash in the fetch loop (e.g., 409 Conflict) becomes
      // an unhandled promise rejection that kills the entire Node.js process.
      void handle.task()?.catch((err: unknown) => {
        if (err instanceof GrammyError && err.error_code === 409) {
          log.error("[TelegramAdapter] 409 Conflict from runner — another instance is polling", {
            description: err.description,
          });
          this.errorMessage = "Another bot instance is running (409 Conflict)";
          this.setStatus("error");
          return;
        }
        log.error("[TelegramAdapter] Runner crashed", { err });
        this.errorMessage = err instanceof Error ? err.message : String(err);
        this.setStatus("error");
      });

      this.runner = handle;
      this.bot = bot;
      this.setStatus("connected");
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error("[TelegramAdapter] Failed to connect", { error });
      this.errorMessage = errorMsg;
      this.setStatus("error");
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const previousStatus = this.status;

    // Flush all fragment buffers before shutting down
    for (const [chatId, state] of this.fragmentBuffer) {
      clearTimeout(state.timer);
      if (state.buffer.length > 0) {
        this.flushFragment(chatId, state.buffer.join("\n"), state.meta);
      }
    }
    this.fragmentBuffer.clear();

    if (this.runner?.isRunning()) {
      try {
        await this.runner.stop();
      } catch (error) {
        log.warn("[TelegramAdapter] Error stopping runner", { error });
      }
    }
    this.runner = null;
    this.bot = null;

    // Only update status + log if we were actually connected
    if (previousStatus !== "disconnected") {
      this.setStatus("disconnected");
      this.username = undefined;
      log.info("[TelegramAdapter] Disconnected");
    }
  }

  getStatus(): ChannelAdapterStatus {
    return this.status;
  }

  getConnectionInfo(): ChannelConnectionInfo {
    return {
      channel: "telegram",
      status: this.status,
      description: this.username ? `@${this.username}` : undefined,
      error: this.errorMessage,
    };
  }

  // ── Outbound messaging ──────────────────────────────────────────────────

  async sendMessage(
    to: string,
    text: string,
    _opts?: { threadId?: string; accountId?: string },
  ): Promise<void> {
    if (!this.bot) {
      log.warn("[TelegramAdapter] sendMessage called but bot is not connected");
      return;
    }

    // Send typing indicator before sending the actual message
    try {
      await this.bot.api.sendChatAction(to, "typing");
    } catch {
      // Typing indicator failures are non-critical
    }

    const chunks = splitMessage(text);

    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(to, chunk, {
          parse_mode: "Markdown",
        });
      } catch (error) {
        if (error instanceof GrammyError) {
          // Fallback: retry without parse mode (Markdown formatting rejected)
          log.warn("[TelegramAdapter] Parse mode rejected, retrying as plain text", {
            chatId: to,
            code: error.error_code,
          });
          try {
            await this.bot.api.sendMessage(to, chunk);
          } catch (retryError) {
            log.error("[TelegramAdapter] Failed to send message (plain text fallback)", {
              chatId: to,
              error: retryError,
            });
          }
        } else {
          log.error("[TelegramAdapter] Failed to send message", { chatId: to, error });
        }
      }
    }
  }

  async sendPhoto(
    to: string,
    image: Buffer,
    caption?: string,
    _opts?: { threadId?: string; accountId?: string },
  ): Promise<void> {
    if (!this.bot) {
      log.warn("[TelegramAdapter] sendPhoto called but bot is not connected");
      return;
    }

    try {
      await this.bot.api.sendChatAction(to, "upload_photo");
    } catch {
      // Non-critical
    }

    try {
      await this.bot.api.sendPhoto(
        to,
        new InputFile(image, "response.png"),
        { caption: caption ? caption.slice(0, 1024) : undefined },
      );
    } catch (error) {
      log.error("[TelegramAdapter] Failed to send photo", { chatId: to, error });
      // Fallback: send as document if photo fails (e.g. image too large for photo)
      try {
        await this.bot.api.sendDocument(
          to,
          new InputFile(image, "response.png"),
          { caption: caption ? caption.slice(0, 1024) : undefined },
        );
      } catch (docError) {
        log.error("[TelegramAdapter] Document fallback also failed", { chatId: to, error: docError });
      }
    }
  }

  // ── Event subscriptions ─────────────────────────────────────────────────

  onMessage(handler: (msg: InboxInboundMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(handler: (status: ChannelAdapterStatus) => void): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private setStatus(status: ChannelAdapterStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) {
      try {
        handler(status);
      } catch (error) {
        log.error("[TelegramAdapter] Status handler error", { error });
      }
    }
  }

  private handleRawMessage(ctx: Context): void {
    const message = ctx.message;
    if (!message || !ctx.chat) return;

    const chatId = ctx.chat.id.toString();
    const userId = (ctx.from?.id ?? ctx.chat.id).toString();
    const username = ctx.from?.username;
    const displayName = ctx.from
      ? [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username
      : undefined;

    const peerKind: "dm" | "group" =
      ctx.chat.type === "private" ? "dm" : "group";

    const text = message.text ?? message.caption ?? "";

    // Fragment buffering: group rapid messages from the same chat
    this.bufferFragment(chatId, text, {
      userId,
      username,
      displayName,
      peerKind,
      chatId,
      messageId: message.message_id,
      timestamp: message.date * 1000,
    });
  }

  private bufferFragment(chatId: string, text: string, meta: FragmentMeta): void {
    const existing = this.fragmentBuffer.get(chatId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.buffer.push(text);
      existing.meta = meta; // Update to latest metadata
      existing.timer = setTimeout(() => {
        this.fragmentBuffer.delete(chatId);
        this.flushFragment(chatId, existing.buffer.join("\n"), existing.meta);
      }, FRAGMENT_DEBOUNCE_MS);
    } else {
      const state: FragmentState = {
        buffer: [text],
        timer: setTimeout(() => {
          this.fragmentBuffer.delete(chatId);
          this.flushFragment(chatId, state.buffer.join("\n"), state.meta);
        }, FRAGMENT_DEBOUNCE_MS),
        meta,
      };
      this.fragmentBuffer.set(chatId, state);
    }
  }

  /**
   * Flush a fragment buffer and emit a normalized InboxInboundMessage.
   * Converts Telegram-specific fields into the channel-agnostic format.
   */
  private flushFragment(chatId: string, text: string, meta: FragmentMeta): void {
    if (!text.trim()) return;

    const chatType = meta.peerKind === "dm" ? "direct" as const : "group" as const;

    const inbound: InboxInboundMessage = {
      channel: "telegram",
      chatType,
      senderName: meta.displayName ?? meta.username ?? meta.userId,
      senderId: meta.userId,
      peerId: chatId,
      displayName: meta.displayName ?? meta.username ?? chatId,
      body: text,
      timestamp: meta.timestamp,
      replyRoute: {
        channel: "telegram",
        to: chatId,
      },
    };

    for (const handler of this.messageHandlers) {
      try {
        handler(inbound);
      } catch (error) {
        log.error("[TelegramAdapter] Message handler error", { error });
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Split a message into Telegram-safe chunks (<=4096 chars).
 * Splits on newlines where possible to avoid breaking words.
 */
function splitMessage(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LENGTH) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > MAX_MESSAGE_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    if (splitAt <= 0) {
      // No newline found, hard split at limit
      splitAt = MAX_MESSAGE_LENGTH;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
