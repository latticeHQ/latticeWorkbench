/**
 * Inbox domain types for channel adapters.
 *
 * Each messaging platform (Telegram, Slack, etc.) has a direct adapter that
 * implements InboxChannelAdapter. Inbound messages flow into InboxService,
 * which auto-dispatches them to Lattice agents and routes responses back through
 * the originating adapter.
 */

/** Supported channel identifiers. */
export const INBOX_CHANNELS = [
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
] as const;

export type InboxChannelId = (typeof INBOX_CHANNELS)[number];

/** Display labels for each channel. */
export const INBOX_CHANNEL_LABELS: Record<InboxChannelId, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  irc: "IRC",
  googlechat: "Google Chat",
  slack: "Slack",
  signal: "Signal",
  imessage: "iMessage",
};

/** Status of a conversation in the inbox. */
export type InboxConversationStatus =
  | "unread"
  | "processing"
  | "replied"
  | "errored"
  | "archived";

/**
 * A single message within an inbox conversation.
 * Covers both inbound (from channel user) and outbound (agent response).
 */
export interface InboxMessage {
  /** Unique message ID (UUID) */
  id: string;
  /** Text content of the message */
  body: string;
  /** Display name of the sender */
  senderName: string;
  /** Platform-specific sender identifier (phone number, username, user ID) */
  senderId: string;
  /** When the message was received/sent (epoch ms) */
  timestamp: number;
  /** Whether this was received from the channel or sent by the Lattice agent */
  direction: "inbound" | "outbound";
  /** Optional media attachment URLs (nullish for Zod .nullish() compat) */
  mediaUrls?: string[] | null;
}

/**
 * A conversation thread grouped by session key.
 *
 * Each conversation maps 1:1 to a unique channel + peer/group identity.
 * Messages are stored in chronological order (oldest first).
 */
export interface InboxConversation {
  /** Session key (e.g., "inbox:telegram:direct:12345") */
  sessionKey: string;
  /** The channel this conversation originated from */
  channel: InboxChannelId;
  /** Whether this is a direct or group conversation */
  chatType: "direct" | "group";
  /** Display name for the conversation (sender name or group subject) */
  displayName: string;
  /** The peer identifier (phone number, user ID, group ID) */
  peerId: string;
  /** Current processing status */
  status: InboxConversationStatus;
  /** Messages in chronological order (oldest first) */
  messages: InboxMessage[];
  /** When the conversation was last active (epoch ms) */
  lastActivityAt: number;
  /** Number of unread inbound messages */
  unreadCount: number;
  /**
   * Routing metadata for sending replies back through the channel adapter.
   * Captured from the inbound message's delivery context so we know
   * exactly where to route agent responses.
   */
  replyRoute: InboxReplyRoute;
}

/** Routing info for sending a reply back through a channel adapter. */
export interface InboxReplyRoute {
  channel: InboxChannelId;
  /** Destination identifier (phone number, chat ID, etc.) */
  to: string;
  /** Account ID for multi-account channels (nullish for Zod compat) */
  accountId?: string | null;
  /** Thread/topic ID for threaded channels (Slack threads, Telegram topics) */
  threadId?: string | null;
}

/**
 * Root shape of persisted inbox state.
 * Stored at ~/.lattice/inbox/{projectHash}/inbox.json
 */
export interface PersistedInboxState {
  version: 1;
  conversations: InboxConversation[];
}

/** Max conversations per project before oldest-first eviction. */
export const MAX_INBOX_CONVERSATIONS = 500;

/** Max messages per conversation before oldest-first eviction. */
export const MAX_MESSAGES_PER_CONVERSATION = 200;
