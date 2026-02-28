/**
 * InboxChannelAdapter — common interface for all channel adapters.
 *
 * Each messaging platform (Telegram, Slack, Discord, etc.) implements this
 * interface with its own SDK. InboxService consumes adapters generically —
 * it doesn't care which platform a message came from.
 *
 * Design follows the same pattern as latticeWorkbench-runtime's TelegramChannel
 * but abstracted into a pluggable interface so Lattice can support N channels.
 */
import type { InboxChannelId, InboxReplyRoute } from "@/common/types/inbox";

// ---------------------------------------------------------------------------
// Normalized inbound message — channel-agnostic
// ---------------------------------------------------------------------------

/** A normalized inbound message from any channel adapter. */
export interface InboxInboundMessage {
  /** Which channel this message came from */
  channel: InboxChannelId;
  /** DM or group conversation */
  chatType: "direct" | "group";
  /** Human-readable sender name */
  senderName: string;
  /** Platform-specific sender ID (user ID, phone number, etc.) */
  senderId: string;
  /** Peer/group identifier for the conversation */
  peerId: string;
  /** Display name for the conversation (sender name or group subject) */
  displayName: string;
  /** Message text content */
  body: string;
  /** When the message was sent (epoch ms) */
  timestamp: number;
  /** Optional media attachment URLs */
  mediaUrls?: string[];
  /** Routing info for sending replies back */
  replyRoute: InboxReplyRoute;
}

// ---------------------------------------------------------------------------
// Channel adapter status
// ---------------------------------------------------------------------------

export type ChannelAdapterStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface ChannelConnectionInfo {
  channel: InboxChannelId;
  status: ChannelAdapterStatus;
  /** Human-readable description (e.g., bot username for Telegram) */
  description?: string;
  /** Error message if status is "error" */
  error?: string;
}

// ---------------------------------------------------------------------------
// Channel adapter interface
// ---------------------------------------------------------------------------

/**
 * Common interface for all messaging channel adapters.
 *
 * Lifecycle:
 * 1. Construct with channel-specific config
 * 2. Call connect() to start receiving messages
 * 3. Register message handler via onMessage()
 * 4. Send replies via sendMessage()
 * 5. Call disconnect() to shut down
 */
export interface InboxChannelAdapter {
  /** Which channel this adapter handles */
  readonly channel: InboxChannelId;

  /** Connect to the messaging platform. Throws on auth failure. */
  connect(): Promise<void>;

  /** Disconnect gracefully. Safe to call if already disconnected. */
  disconnect(): Promise<void>;

  /** Current connection status. */
  getStatus(): ChannelAdapterStatus;

  /** Detailed connection info for UI display. */
  getConnectionInfo(): ChannelConnectionInfo;

  /** Send a text message to a conversation. */
  sendMessage(to: string, text: string, opts?: {
    threadId?: string;
    accountId?: string;
  }): Promise<void>;

  /**
   * Send a photo/image to a conversation.
   * Used for long responses rendered as images for readability.
   */
  sendPhoto(to: string, image: Buffer, caption?: string, opts?: {
    threadId?: string;
    accountId?: string;
  }): Promise<void>;

  /**
   * Register a handler for inbound messages.
   * Returns an unsubscribe function.
   */
  onMessage(handler: (msg: InboxInboundMessage) => void): () => void;

  /**
   * Register a handler for status changes.
   * Returns an unsubscribe function.
   */
  onStatusChange(handler: (status: ChannelAdapterStatus) => void): () => void;
}
