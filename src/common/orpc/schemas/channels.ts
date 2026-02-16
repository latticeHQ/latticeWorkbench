import { z } from "zod";
import { eventIterator } from "@orpc/server";

// Channel platform types
export const ChannelTypeSchema = z.enum(["telegram", "discord", "slack", "whatsapp"]);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

// Channel connection status
export const ChannelStatusSchema = z.enum(["disconnected", "connecting", "connected", "error"]);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

// Message direction
export const ChannelDirectionSchema = z.enum(["inbound", "outbound"]);
export type ChannelDirection = z.infer<typeof ChannelDirectionSchema>;

// Session scope — how inbound messages are routed to workspaces (OpenClaw pattern)
export const ChannelSessionScopeSchema = z.enum(["per-peer", "per-channel-peer", "shared"]).meta({
  description:
    "per-peer: each external user gets their own workspace (default). " +
    "per-channel-peer: same but scoped per channel type. " +
    "shared: all users share one workspace.",
});
export type ChannelSessionScope = z.infer<typeof ChannelSessionScopeSchema>;

// Peer kind — the type of chat context
export const ChannelPeerKindSchema = z.enum(["dm", "group", "channel"]);
export type ChannelPeerKind = z.infer<typeof ChannelPeerKindSchema>;

// Attachment in a channel message
export const ChannelAttachmentSchema = z.object({
  type: z.enum(["image", "file", "audio", "video"]),
  url: z.string().optional(),
  data: z.string().optional().meta({ description: "Base64 encoded data for small files" }),
  mimeType: z.string().optional(),
  filename: z.string().optional(),
});

export type ChannelAttachment = z.infer<typeof ChannelAttachmentSchema>;

// Normalized channel message — platform-agnostic
export const ChannelMessageSchema = z.object({
  id: z.string(),
  channelType: ChannelTypeSchema,
  channelAccountId: z.string(),
  externalMessageId: z.string().meta({ description: "Platform-specific message ID" }),
  direction: ChannelDirectionSchema,
  from: z.object({
    id: z.string(),
    username: z.string().optional(),
    displayName: z.string().optional(),
  }),
  to: z.object({
    id: z.string(),
    username: z.string().optional(),
  }),
  content: z.object({
    text: z.string().optional(),
    attachments: z.array(ChannelAttachmentSchema).optional(),
  }),
  threadId: z.string().optional(),
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

// ── Channel configuration — workbench-scoped ────────────────────────────

export const ChannelConfigSchema = z.object({
  type: ChannelTypeSchema,
  accountId: z.string().meta({ description: "Unique identifier for this channel account" }),
  enabled: z.boolean(),
  defaultProjectPath: z.string().meta({
    description: "Headquarter where new workspaces are auto-created for inbound conversations.",
  }),
  sessionScope: ChannelSessionScopeSchema.default("per-peer").meta({
    description: "How inbound messages are routed to workspaces. Defaults to per-peer isolation.",
  }),
  credentials: z.record(z.string(), z.string()).meta({
    description: "Platform-specific auth (bot tokens, API keys)",
  }),
  settings: z.record(z.string(), z.unknown()).optional().meta({
    description: "Platform-specific settings",
  }),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// Channel list item (returned by channels.list)
export const ChannelListItemSchema = z.object({
  type: ChannelTypeSchema,
  accountId: z.string(),
  sessionScope: ChannelSessionScopeSchema,
  status: ChannelStatusSchema,
  enabled: z.boolean(),
  sessionCount: z
    .number()
    .meta({ description: "Number of active session mappings for this channel" }),
});

export type ChannelListItem = z.infer<typeof ChannelListItemSchema>;

// Outbound message (what you pass to sendMessage)
export const OutboundChannelMessageSchema = z.object({
  to: z.object({ id: z.string() }),
  text: z.string().optional(),
  threadId: z.string().optional(),
  attachments: z.array(ChannelAttachmentSchema).optional(),
});

export type OutboundChannelMessage = z.infer<typeof OutboundChannelMessageSchema>;

// Send result
export const ChannelSendResultSchema = z.object({
  success: z.boolean(),
  externalId: z.string().optional(),
  error: z.string().optional(),
});

export type ChannelSendResult = z.infer<typeof ChannelSendResultSchema>;

// Simple success/error result
export const ChannelOpResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});

// ── Session entry — maps an external peer to a workspace ─────────────────

export const ChannelSessionEntrySchema = z.object({
  sessionKey: z.string().meta({ description: "Unique key: e.g. telegram:dm:123456" }),
  workspaceId: z.string(),
  channelType: ChannelTypeSchema,
  accountId: z.string(),
  peerId: z.string(),
  peerKind: ChannelPeerKindSchema,
  displayName: z.string().optional(),
  lastMessageAt: z.number(),
  createdAt: z.number(),
});

export type ChannelSessionEntry = z.infer<typeof ChannelSessionEntrySchema>;

// ── ORPC operation schemas ──────────────────────────────────────────────

export const channels = {
  list: {
    input: z.void(),
    output: z.array(ChannelListItemSchema),
  },
  get: {
    input: z.object({ accountId: z.string() }),
    output: ChannelConfigSchema,
  },
  create: {
    input: ChannelConfigSchema,
    output: ChannelOpResultSchema,
  },
  update: {
    input: ChannelConfigSchema,
    output: ChannelOpResultSchema,
  },
  remove: {
    input: z.object({ accountId: z.string() }),
    output: ChannelOpResultSchema,
  },
  connect: {
    input: z.object({ accountId: z.string() }),
    output: ChannelOpResultSchema,
  },
  disconnect: {
    input: z.object({ accountId: z.string() }),
    output: ChannelOpResultSchema,
  },
  sendMessage: {
    input: z.object({
      accountId: z.string(),
      message: OutboundChannelMessageSchema,
    }),
    output: ChannelSendResultSchema,
  },
  onMessage: {
    input: z
      .object({
        accountId: z.string().optional().meta({
          description: "Filter to specific channel. Omit for all channels.",
        }),
      })
      .optional(),
    output: eventIterator(ChannelMessageSchema),
  },

  // ── Session management ──────────────────────────────────────────
  sessions: {
    list: {
      input: z
        .object({
          accountId: z.string().optional().meta({
            description: "Filter sessions by channel account. Omit for all.",
          }),
        })
        .optional(),
      output: z.array(ChannelSessionEntrySchema),
    },
    resolve: {
      input: z.object({
        channelType: ChannelTypeSchema,
        accountId: z.string(),
        peerId: z.string(),
        peerKind: ChannelPeerKindSchema,
      }),
      output: z.object({
        sessionKey: z.string(),
        workspaceId: z.string().optional(),
        exists: z.boolean(),
      }),
    },
  },
};
