import { z } from "zod";

export const InboxChannelIdSchema = z.enum([
  "telegram",
  "whatsapp",
  "discord",
  "irc",
  "googlechat",
  "slack",
  "signal",
  "imessage",
]);

export const InboxConversationStatusSchema = z.enum([
  "unread",
  "processing",
  "replied",
  "errored",
  "archived",
]);

export const InboxReplyRouteSchema = z.object({
  channel: InboxChannelIdSchema,
  to: z.string(),
  accountId: z.string().nullish(),
  threadId: z.string().nullish(),
});

export const InboxMessageSchema = z.object({
  id: z.string(),
  body: z.string(),
  senderName: z.string(),
  senderId: z.string(),
  timestamp: z.number(),
  direction: z.enum(["inbound", "outbound"]),
  mediaUrls: z.array(z.string()).nullish(),
});

/**
 * Full conversation schema including messages.
 * Used for getConversation detail view.
 */
export const InboxConversationSchema = z.object({
  sessionKey: z.string(),
  channel: InboxChannelIdSchema,
  chatType: z.enum(["direct", "group"]),
  displayName: z.string(),
  peerId: z.string(),
  status: InboxConversationStatusSchema,
  messages: z.array(InboxMessageSchema),
  lastActivityAt: z.number(),
  unreadCount: z.number(),
  replyRoute: InboxReplyRouteSchema,
});

/**
 * Summary schema — omits messages[] to keep list payloads small.
 * Same pattern as kanban omitting screenBuffer from list responses.
 */
export const InboxConversationSummarySchema = InboxConversationSchema.omit({
  messages: true,
});

// -- Input schemas --

export const InboxListInputSchema = z.object({
  projectPath: z.string(),
  /** Optional channel filter */
  channel: InboxChannelIdSchema.nullish(),
});

export const InboxGetConversationInputSchema = z.object({
  projectPath: z.string(),
  sessionKey: z.string(),
});

export const InboxUpdateStatusInputSchema = z.object({
  projectPath: z.string(),
  sessionKey: z.string(),
  status: InboxConversationStatusSchema,
});

export const InboxSendReplyInputSchema = z.object({
  projectPath: z.string(),
  sessionKey: z.string(),
  message: z.string(),
});

export const InboxSubscribeInputSchema = z.object({
  projectPath: z.string(),
});

// -- Settings input schemas (connect/disconnect/token management) --

export const InboxConnectAdapterInputSchema = z.object({
  channel: InboxChannelIdSchema,
});

export const InboxDisconnectAdapterInputSchema = z.object({
  channel: InboxChannelIdSchema,
});

/**
 * Set or clear a channel token.
 * Setting token to null removes the token and unregisters the adapter.
 */
export const InboxSetChannelTokenInputSchema = z.object({
  channel: InboxChannelIdSchema,
  /** Bot token (null to clear). */
  token: z.string().nullish(),
});

/**
 * Get the current channel tokens (masked for security — only returns
 * whether a token is configured, not the token itself).
 */
export const InboxChannelTokenStatusSchema = z.object({
  channel: InboxChannelIdSchema,
  configured: z.boolean(),
  /** First 6 chars + "..." for visual confirmation, null if not configured */
  maskedToken: z.string().nullish(),
});

// -- Output schemas --

/** Per-adapter connection status. */
export const InboxAdapterStatusSchema = z.object({
  channel: InboxChannelIdSchema,
  status: z.enum(["disconnected", "connecting", "connected", "error"]),
  /** Human-readable description (e.g., bot username) */
  description: z.string().nullish(),
  /** Error message if status is "error" */
  error: z.string().nullish(),
});

/**
 * Overall inbox connection status — array of per-adapter statuses.
 * Replaces the old single-adapter model.
 */
export const InboxConnectionStatusSchema = z.object({
  adapters: z.array(InboxAdapterStatusSchema),
});
