/**
 * Channel adapter types for cross-platform messaging.
 *
 * Channels are workbench-scoped: each adapter instance represents one external identity
 * (e.g., one Telegram bot) that serves the entire workbench. Inbound messages are routed
 * to workspaces via the ChannelSessionRouter (OpenClaw pattern), which maps each external
 * peer to an isolated workspace session.
 */

// Re-export Zod-inferred types for convenience
export type {
  ChannelType,
  ChannelStatus,
  ChannelDirection,
  ChannelMessage,
  ChannelConfig,
  ChannelAttachment,
  OutboundChannelMessage,
  ChannelSendResult,
  ChannelListItem,
  ChannelSessionScope,
  ChannelSessionEntry,
  ChannelPeerKind,
} from "@/common/orpc/schemas/channels";

import type {
  ChannelType,
  ChannelStatus,
  ChannelConfig,
  ChannelMessage,
  OutboundChannelMessage,
  ChannelSendResult,
} from "@/common/orpc/schemas/channels";

/**
 * Channel adapter interface — implemented by each platform (Telegram, Discord, etc.).
 *
 * Adapters are EventEmitter-based and follow the same patterns as WorkspaceService.
 * They normalize platform-specific messages into ChannelMessage format.
 */
export interface ChannelAdapter {
  /** Platform type (telegram, discord, etc.) */
  readonly type: ChannelType;

  /** Unique account identifier for this adapter instance */
  readonly accountId: string;

  /** Current connection status */
  readonly status: ChannelStatus;

  /** Bot username (available after connect) — used for group chat mention filtering */
  readonly botUsername?: string;

  /** Connect to the platform using the provided config */
  connect(config: ChannelConfig): Promise<void>;

  /** Gracefully disconnect from the platform */
  disconnect(): Promise<void>;

  /** Send a message to a target on the platform */
  sendMessage(message: OutboundChannelMessage): Promise<ChannelSendResult>;

  /** Send a typing/activity indicator to a chat (optional — not all platforms support it) */
  sendTypingIndicator?(chatId: string): Promise<void>;

  /** Download a file by platform-specific ID and return as base64 data URL (optional) */
  downloadFile?(fileId: string): Promise<{ dataUrl: string; mimeType: string } | null>;

  /** Subscribe to incoming messages. Returns unsubscribe function. */
  onMessage(handler: (message: ChannelMessage) => void): () => void;

  /** Subscribe to status changes. Returns unsubscribe function. */
  onStatusChange(handler: (status: ChannelStatus) => void): () => void;
}
