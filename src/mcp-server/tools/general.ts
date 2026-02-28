/**
 * General utility tools: ping, list/create directory, open in editor, logs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, errorResponse, withErrorHandling } from "../utils";

export function registerGeneralTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Ping ───────────────────────────────────────────────────────────────
  server.tool(
    "ping",
    "Health check — verifies the MCP server can reach the Lattice backend. Returns the backend's pong response.",
    { message: z.string().optional().describe("Optional message to echo back") },
    (params) =>
      withErrorHandling(async () => {
        const response = await client.general.ping(params.message ?? "ping");
        return { content: [jsonContent({ status: "ok", response })] };
      })
  );

  // ── List directory ─────────────────────────────────────────────────────
  server.tool(
    "list_directory",
    "List files and subdirectories at a given path. Returns a tree of file names, types, and sizes.",
    { path: z.string().describe("Absolute path to the directory to list") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.general.listDirectory({ path: params.path });
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to list directory");
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  // ── Create directory ───────────────────────────────────────────────────
  server.tool(
    "create_directory",
    "Create a directory recursively (mkdir -p equivalent).",
    { path: z.string().describe("Absolute path to create") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.general.createDirectory({ path: params.path });
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to create directory");
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Directory created", ...result.data })] };
      })
  );

  // ── Open in editor ─────────────────────────────────────────────────────
  server.tool(
    "open_in_editor",
    "Open a file or directory in the user's configured code editor (VS Code, Cursor, etc.).",
    {
      minionId: z.string().describe("The minion ID"),
      targetPath: z.string().describe("Absolute path to open"),
      editor: z.enum(["vscode", "cursor", "windsurf", "zed"]).optional().describe("Editor to use (default: auto-detect)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const editorConfig: Record<string, unknown> = {};
        if (params.editor != null) editorConfig.editor = params.editor;
        await client.general.openInEditor({
          minionId: params.minionId,
          targetPath: params.targetPath,
          editorConfig: editorConfig as Parameters<typeof client.general.openInEditor>[0]["editorConfig"],
        });
        return { content: [jsonContent({ message: "Opened in editor" })] };
      })
  );

  // ── Get log path ───────────────────────────────────────────────────────
  server.tool(
    "get_log_path",
    "Get the absolute path to the current Lattice log file.",
    {},
    () =>
      withErrorHandling(async () => {
        const logPath = await client.general.getLogPath();
        return { content: [jsonContent({ logPath })] };
      })
  );

  // ── Clear logs ─────────────────────────────────────────────────────────
  server.tool(
    "clear_logs",
    "Clear all log files and in-memory log entries.",
    {},
    () =>
      withErrorHandling(async () => {
        await client.general.clearLogs();
        return { content: [jsonContent({ message: "Logs cleared" })] };
      })
  );
}
