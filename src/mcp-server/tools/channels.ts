/**
 * Channel MCP tools — full CRUD for Telegram/Discord/Slack/WhatsApp channels.
 *
 * Wires into the workbench's channel adapter system:
 *   - Telegram: fully implemented (long-polling bot)
 *   - Discord: fully implemented (Gateway WebSocket bot)
 *   - Slack: config-ready (adapter not yet implemented in backend)
 *   - WhatsApp: config-ready (adapter not yet implemented in backend)
 *
 * Each channel auto-creates workspaces for inbound conversations (OpenClaw pattern).
 * Session routing: per-peer (default), per-channel-peer, or shared.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

const ChannelTypeEnum = z.enum(["telegram", "discord", "slack", "whatsapp"]);
const SessionScopeEnum = z.enum(["per-peer", "per-channel-peer", "shared"]);

export function registerChannelTools(server: McpServer, client: WorkbenchClient): void {
  // ── List channels ─────────────────────────────────────────────────

  server.tool(
    "workbench_list_channels",
    "List all configured messaging channels (Telegram, Discord, Slack, WhatsApp) with their connection status and session counts.",
    {},
    async () => {
      try {
        const channels = await client.listChannels();

        if (!channels || channels.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No channels configured.\n\nUse workbench_create_channel to add one.\nSupported: telegram, discord, slack, whatsapp",
              },
            ],
          };
        }

        const lines: string[] = [];
        lines.push(`CHANNELS (${channels.length})\n`);

        for (const ch of channels) {
          const statusIcon =
            ch.status === "connected"
              ? "[ON]"
              : ch.status === "connecting"
                ? "[...]"
                : ch.status === "error"
                  ? "[ERR]"
                  : "[OFF]";
          lines.push(`${statusIcon} ${ch.accountId} (${ch.type})`);
          lines.push(
            `   Status: ${ch.status} | Enabled: ${ch.enabled} | Sessions: ${ch.sessionCount}`
          );
          lines.push("");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Get channel config ─────────────────────────────────────────────

  server.tool(
    "workbench_get_channel",
    "Get full configuration for a specific channel (credentials masked).",
    {
      accountId: z.string().describe("The channel account ID"),
    },
    async ({ accountId }) => {
      try {
        const config = await client.getChannel(accountId);
        // Mask credential values for security
        const masked = { ...config };
        if (masked.credentials) {
          const maskedCreds: Record<string, string> = {};
          for (const [key, val] of Object.entries(masked.credentials)) {
            maskedCreds[key] = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : "****";
          }
          masked.credentials = maskedCreds;
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(masked, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Create channel ─────────────────────────────────────────────────

  server.tool(
    "workbench_create_channel",
    `Create a new messaging channel configuration.

Supported types:
- telegram: requires credentials.botToken (from @BotFather)
- discord: requires credentials.botToken (from Discord Developer Portal)
- slack: requires credentials.botToken + credentials.appToken
- whatsapp: requires credentials.accessToken + credentials.phoneNumberId

Each inbound message auto-creates a workspace in defaultProjectPath.
Session scoping: per-peer (default), per-channel-peer, shared.`,
    {
      type: ChannelTypeEnum.describe("Channel platform type"),
      accountId: z.string().describe("Unique ID for this channel (e.g., 'my-telegram-bot')"),
      defaultProjectPath: z
        .string()
        .describe("Headquarter path where inbound conversations create workspaces"),
      credentials: z
        .record(z.string(), z.string())
        .describe("Platform-specific auth (botToken, accessToken, etc.)"),
      sessionScope: SessionScopeEnum.optional().describe(
        "How inbound messages are routed (default: per-peer)"
      ),
      enabled: z.boolean().optional().describe("Auto-connect on creation (default: true)"),
      settings: z.record(z.string(), z.string()).optional().describe("Platform-specific settings"),
    },
    async ({
      type,
      accountId,
      defaultProjectPath,
      credentials,
      sessionScope,
      enabled,
      settings,
    }) => {
      try {
        const result = await client.createChannel({
          type,
          accountId,
          enabled: enabled ?? true,
          defaultProjectPath,
          sessionScope: sessionScope ?? "per-peer",
          credentials,
          settings: settings as Record<string, unknown> | undefined,
        });

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed to create channel: ${result.error}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Channel "${accountId}" (${type}) created.\n  Headquarter: ${defaultProjectPath}\n  Scope: ${sessionScope ?? "per-peer"}\n  Enabled: ${enabled ?? true}\n\nUse workbench_connect_channel to start the bot.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Update channel ─────────────────────────────────────────────────

  server.tool(
    "workbench_update_channel",
    "Update an existing channel's configuration. Optionally reconnects if already connected.",
    {
      type: ChannelTypeEnum.describe("Channel platform type"),
      accountId: z.string().describe("Channel account ID to update"),
      defaultProjectPath: z.string().describe("Headquarter path for new conversations"),
      credentials: z.record(z.string(), z.string()).describe("Updated credentials"),
      sessionScope: SessionScopeEnum.optional(),
      enabled: z.boolean().optional(),
      settings: z.record(z.string(), z.string()).optional(),
    },
    async ({
      type,
      accountId,
      defaultProjectPath,
      credentials,
      sessionScope,
      enabled,
      settings,
    }) => {
      try {
        const result = await client.updateChannel({
          type,
          accountId,
          enabled: enabled ?? true,
          defaultProjectPath,
          sessionScope,
          credentials,
          settings: settings as Record<string, unknown> | undefined,
        });

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Channel "${accountId}" updated.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Remove channel ─────────────────────────────────────────────────

  server.tool(
    "workbench_remove_channel",
    "Remove a channel configuration. Disconnects if connected.",
    {
      accountId: z.string().describe("Channel account ID to remove"),
    },
    async ({ accountId }) => {
      try {
        const result = await client.removeChannel(accountId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Channel "${accountId}" removed.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Connect channel ───────────────────────────────────────────────

  server.tool(
    "workbench_connect_channel",
    "Connect a messaging channel adapter (start the bot). The bot will begin receiving messages and auto-creating workspaces.",
    {
      accountId: z.string().describe("The channel account ID to connect"),
    },
    async ({ accountId }) => {
      try {
        const result = await client.connectChannel(accountId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Channel "${accountId}" connected. Bot is now receiving messages.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Disconnect channel ────────────────────────────────────────────

  server.tool(
    "workbench_disconnect_channel",
    "Disconnect a messaging channel adapter (stop the bot).",
    {
      accountId: z.string().describe("The channel account ID to disconnect"),
    },
    async ({ accountId }) => {
      try {
        const result = await client.disconnectChannel(accountId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Channel "${accountId}" disconnected.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Send channel message ──────────────────────────────────────────

  server.tool(
    "workbench_send_channel_message",
    "Send a message to a specific peer through a messaging channel (e.g., send a Telegram message to a user).",
    {
      accountId: z.string().describe("The channel account ID (e.g., 'mybot')"),
      to: z.string().describe("The recipient's ID (e.g., Telegram chat ID, Discord channel ID)"),
      text: z.string().describe("The message text to send"),
    },
    async ({ accountId, to, text }) => {
      try {
        const result = await client.sendChannelMessage(accountId, to, text);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Message sent to ${to} via ${accountId}.` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── List channel sessions ─────────────────────────────────────────

  server.tool(
    "workbench_list_channel_sessions",
    "List active session mappings — shows which external users/groups are mapped to which workspaces.",
    {
      accountId: z.string().optional().describe("Filter by channel account ID (omit for all)"),
    },
    async ({ accountId }) => {
      try {
        const sessions = await client.listChannelSessions(accountId);

        if (!sessions || sessions.length === 0) {
          return { content: [{ type: "text" as const, text: "No active sessions." }] };
        }

        const lines: string[] = [];
        lines.push(`CHANNEL SESSIONS (${sessions.length})\n`);

        for (const s of sessions) {
          const age = Math.round((Date.now() - s.createdAt) / 60_000);
          const lastMsg = Math.round((Date.now() - s.lastMessageAt) / 60_000);
          lines.push(`${s.channelType}/${s.peerKind}/${s.displayName ?? s.peerId}`);
          lines.push(`   Workspace: ${s.workspaceId}`);
          lines.push(`   Session: ${s.sessionKey}`);
          lines.push(`   Age: ${age}m | Last message: ${lastMsg}m ago`);
          lines.push("");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
