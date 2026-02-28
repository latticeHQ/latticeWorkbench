/**
 * Inbox tools: manage conversation channels (Slack, Discord, etc.),
 * read messages, send replies, and control adapter connections.
 *
 * The inbox system bridges external messaging platforms into Lattice,
 * allowing agents to monitor and respond to conversations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

const channelEnum = z.enum([
  "discord", "googlechat", "imessage", "irc", "signal", "slack", "telegram", "whatsapp",
]);

export function registerInboxTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List inbox conversations ────────────────────────────────────────────
  server.tool(
    "inbox_list",
    "List all inbox conversations. Optionally filter by channel (slack, discord, telegram, etc.).",
    {
      projectPath: z.string().describe("Absolute project path"),
      channel: channelEnum.optional().describe("Filter by messaging channel"),
    },
    (params) =>
      withErrorHandling(async () => {
        const conversations = await client.inbox.list({
          projectPath: params.projectPath,
          channel: params.channel,
        });
        return { content: [jsonContent(conversations)] };
      })
  );

  // ── Get conversation ────────────────────────────────────────────────────
  server.tool(
    "inbox_get_conversation",
    "Get the full message history for a specific inbox conversation.",
    {
      projectPath: z.string().describe("Absolute project path"),
      sessionKey: z.string().describe("The conversation session key"),
    },
    (params) =>
      withErrorHandling(async () => {
        const conversation = await client.inbox.getConversation({
          projectPath: params.projectPath,
          sessionKey: params.sessionKey,
        });
        return { content: [jsonContent(conversation)] };
      })
  );

  // ── Send reply ──────────────────────────────────────────────────────────
  server.tool(
    "inbox_send_reply",
    "Send a reply to an inbox conversation.",
    {
      projectPath: z.string().describe("Absolute project path"),
      sessionKey: z.string().describe("The conversation session key"),
      message: z.string().describe("The reply message text"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.inbox.sendReply({
          projectPath: params.projectPath,
          sessionKey: params.sessionKey,
          message: params.message,
        });
        return { content: [jsonContent({ message: "Reply sent" })] };
      })
  );

  // ── Update conversation status ──────────────────────────────────────────
  server.tool(
    "inbox_update_status",
    "Update the status of an inbox conversation.",
    {
      projectPath: z.string().describe("Absolute project path"),
      sessionKey: z.string().describe("The conversation session key"),
      status: z.enum(["unread", "processing", "replied", "errored", "archived"])
        .describe("New status for the conversation"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.inbox.updateStatus({
          projectPath: params.projectPath,
          sessionKey: params.sessionKey,
          status: params.status,
        });
        return { content: [jsonContent({ message: `Status updated to '${params.status}'` })] };
      })
  );

  // ── Connection status ───────────────────────────────────────────────────
  server.tool(
    "inbox_connection_status",
    "Check the connection status of all inbox adapters (Slack, Discord, Telegram, etc.).",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await client.inbox.connectionStatus();
        return { content: [jsonContent(status)] };
      })
  );

  // ── Connect adapter ─────────────────────────────────────────────────────
  server.tool(
    "inbox_connect_adapter",
    "Connect an inbox adapter to start receiving messages from a messaging platform.",
    {
      channel: channelEnum.describe("The messaging channel to connect"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.inbox.connectAdapter({ channel: params.channel });
        return { content: [jsonContent({ message: `Adapter '${params.channel}' connected` })] };
      })
  );

  // ── Disconnect adapter ──────────────────────────────────────────────────
  server.tool(
    "inbox_disconnect_adapter",
    "Disconnect an inbox adapter. Stops receiving messages from that platform.",
    {
      channel: channelEnum.describe("The messaging channel to disconnect"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.inbox.disconnectAdapter({ channel: params.channel });
        return { content: [jsonContent({ message: `Adapter '${params.channel}' disconnected` })] };
      })
  );

  // ── Get channel tokens ──────────────────────────────────────────────────
  server.tool(
    "inbox_get_channel_tokens",
    "Get configured channel tokens/credentials for inbox adapters. " +
      "Returns which channels are configured and masked token values.",
    {},
    () =>
      withErrorHandling(async () => {
        const tokens = await client.inbox.getChannelTokens();
        return { content: [jsonContent(tokens)] };
      })
  );

  // ── Set channel token ───────────────────────────────────────────────────
  server.tool(
    "inbox_set_channel_token",
    "Set or update a channel token/credential for an inbox adapter. " +
      "Pass null for token to remove the credential.",
    {
      channel: channelEnum.describe("The messaging channel"),
      token: z.string().nullable().optional().describe("The authentication token (null to remove)"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.inbox.setChannelToken({
          channel: params.channel,
          token: params.token,
        });
        return { content: [jsonContent({ message: `Channel token for '${params.channel}' updated` })] };
      })
  );
}
