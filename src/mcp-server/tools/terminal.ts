/**
 * Terminal tools: create, send input, close, list, resize, and open native terminal.
 *
 * Note: Real-time terminal output streaming is not exposed because it requires
 * WebSocket subscriptions (eventIterator). Use `initialCommand` on create for
 * fire-and-forget commands, or prefer `send_message` with bash tool calls for
 * command execution with output capture.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerTerminalTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Create terminal ────────────────────────────────────────────────────
  server.tool(
    "terminal_create",
    "Create a new terminal session in a minion. Can launch a BUILT-IN AI agent " +
      "profile (claude-code, gemini-cli, github-copilot, codex, aider, amp) by " +
      "passing profileId — no need to build anything, these are pre-configured.\n\n" +
      "To launch an AI agent terminal: pass profileId (e.g. 'claude-code', 'gemini-cli'). " +
      "To run a plain shell: pass initialCommand or leave empty for interactive shell. " +
      "Returns sessionId for subsequent send_input/close calls.\n\n" +
      "IMPORTANT: When a user asks to 'run Claude Code', 'open Gemini', 'launch Aider', " +
      "etc. — use this tool with the corresponding profileId. Check terminal_profiles_list " +
      "first to verify it's installed and enabled.",
    {
      minionId: z.string().describe("The minion ID to create the terminal in"),
      cols: z.number().optional().describe("Terminal columns (default: 120)"),
      rows: z.number().optional().describe("Terminal rows (default: 30)"),
      initialCommand: z
        .string()
        .optional()
        .describe("Command to run immediately after creation (e.g. 'ls -la')"),
      profileId: z
        .string()
        .optional()
        .describe("Terminal profile ID to launch (e.g. 'claude-code', 'gemini-cli', 'aider', 'codex', 'amp', 'github-copilot')"),
      profileCommand: z
        .string()
        .optional()
        .describe("Explicit command for the profile (overrides profileId resolution)"),
      profileArgs: z
        .array(z.string())
        .optional()
        .describe("Arguments for the profile command"),
      profileEnv: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional environment variables for the profile"),
    },
    (params) =>
      withErrorHandling(async () => {
        const session = await client.terminal.create({
          minionId: params.minionId,
          cols: params.cols ?? 120,
          rows: params.rows ?? 30,
          initialCommand: params.initialCommand,
          profileId: params.profileId,
          profileCommand: params.profileCommand,
          profileArgs: params.profileArgs,
          profileEnv: params.profileEnv,
        });
        return {
          content: [
            jsonContent({
              message: params.profileId
                ? `Terminal created with profile '${params.profileId}'`
                : "Terminal created successfully",
              sessionId: session.sessionId,
              minionId: session.minionId,
              cols: session.cols,
              rows: session.rows,
            }),
          ],
        };
      })
  );

  // ── Send input ─────────────────────────────────────────────────────────
  server.tool(
    "terminal_send_input",
    "Send text input to a terminal session. Use '\\n' at the end to execute a command. " +
      "Note: This tool does not return output — terminal output requires streaming subscriptions.",
    {
      sessionId: z.string().describe("The terminal session ID"),
      data: z
        .string()
        .describe("Text to send to the terminal (include '\\n' to press Enter)"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.sendInput({
          sessionId: params.sessionId,
          data: params.data,
        });
        return {
          content: [jsonContent({ message: "Input sent to terminal" })],
        };
      })
  );

  // ── Close terminal ─────────────────────────────────────────────────────
  server.tool(
    "terminal_close",
    "Close a terminal session and release its resources.",
    {
      sessionId: z.string().describe("The terminal session ID to close"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.close({ sessionId: params.sessionId });
        return {
          content: [jsonContent({ message: "Terminal closed successfully" })],
        };
      })
  );

  // ── List terminal sessions ─────────────────────────────────────────────
  server.tool(
    "terminal_list_sessions",
    "List active terminal session IDs for a minion.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const sessions = await client.terminal.listSessions({
          minionId: params.minionId,
        });
        return { content: [jsonContent(sessions)] };
      })
  );

  // ── Resize terminal ────────────────────────────────────────────────────
  server.tool(
    "terminal_resize",
    "Resize a terminal session to new dimensions.",
    {
      sessionId: z.string().describe("The terminal session ID"),
      cols: z.number().describe("New column count"),
      rows: z.number().describe("New row count"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.resize({
          sessionId: params.sessionId,
          cols: params.cols,
          rows: params.rows,
        });
        return {
          content: [jsonContent({ message: "Terminal resized" })],
        };
      })
  );

  // ── Open native terminal ───────────────────────────────────────────────
  server.tool(
    "terminal_open_native",
    "Open the native system terminal app in the minion directory.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.openNative({ minionId: params.minionId });
        return {
          content: [jsonContent({ message: "Native terminal opened" })],
        };
      })
  );

  // ── Open/close terminal window ─────────────────────────────────────────
  server.tool(
    "terminal_open_window",
    "Open a dedicated terminal window (pop-out) for a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      sessionId: z.string().optional().describe("Specific session ID to open in the window"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.openWindow({
          minionId: params.minionId,
          sessionId: params.sessionId,
        });
        return {
          content: [jsonContent({ message: "Terminal window opened" })],
        };
      })
  );

  server.tool(
    "terminal_close_window",
    "Close the dedicated terminal window for a minion.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminal.closeWindow({ minionId: params.minionId });
        return {
          content: [jsonContent({ message: "Terminal window closed" })],
        };
      })
  );
}
