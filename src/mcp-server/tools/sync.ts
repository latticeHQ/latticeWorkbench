/**
 * Git sync tools: push/pull changes, manage remote repositories,
 * check GitHub auth, and configure sync settings.
 *
 * The sync system handles bidirectional synchronization between
 * Lattice workbench state and remote Git repositories, enabling
 * collaboration and cloud backup.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerSyncTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Get sync status ─────────────────────────────────────────────────────
  server.tool(
    "sync_get_status",
    "Get the current sync status — whether sync is active, last sync time, " +
      "pending changes, and any errors.",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await client.sync.getStatus();
        return { content: [jsonContent(status)] };
      })
  );

  // ── Get sync config ─────────────────────────────────────────────────────
  server.tool(
    "sync_get_config",
    "Get the current sync configuration (remote repo URL, auto-sync settings, " +
      "sync category toggles).",
    {},
    () =>
      withErrorHandling(async () => {
        const config = await client.sync.getConfig();
        return { content: [jsonContent(config ?? { message: "No sync config" })] };
      })
  );

  // ── Save sync config ────────────────────────────────────────────────────
  server.tool(
    "sync_save_config",
    "Update sync configuration. Control which categories are synced " +
      "(config, MCP config, chat history, providers, secrets).",
    {
      repoUrl: z.string().describe("Remote repository URL"),
      autoSync: z.boolean().describe("Enable automatic sync"),
      autoSyncDebounceMs: z.number().nullable().optional()
        .describe("Debounce time in ms for auto-sync (null for default)"),
      categories: z.object({
        config: z.boolean().describe("Sync global config"),
        mcpConfig: z.boolean().describe("Sync MCP server config"),
        chatHistory: z.boolean().describe("Sync chat history"),
        providers: z.boolean().describe("Sync provider settings"),
        secrets: z.boolean().describe("Sync secrets"),
      }).describe("Which data categories to include in sync"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sync.saveConfig({
          repoUrl: params.repoUrl,
          autoSync: params.autoSync,
          autoSyncDebounceMs: params.autoSyncDebounceMs,
          categories: params.categories,
        });
        return { content: [jsonContent({ message: "Sync config saved", ...result })] };
      })
  );

  // ── Check GitHub auth ───────────────────────────────────────────────────
  server.tool(
    "sync_check_gh_auth",
    "Check if GitHub CLI authentication is configured and valid for sync operations.",
    {},
    () =>
      withErrorHandling(async () => {
        const authStatus = await client.sync.checkGhAuth();
        return { content: [jsonContent(authStatus)] };
      })
  );

  // ── List remote repos ───────────────────────────────────────────────────
  server.tool(
    "sync_list_repos",
    "List available remote repositories for sync (from authenticated GitHub account).",
    {},
    () =>
      withErrorHandling(async () => {
        const repos = await client.sync.listRepos();
        return { content: [jsonContent(repos)] };
      })
  );

  // ── Create remote repo ──────────────────────────────────────────────────
  server.tool(
    "sync_create_repo",
    "Create a new remote GitHub repository for sync.",
    {
      name: z.string().describe("Repository name"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sync.createRepo({ name: params.name });
        return { content: [jsonContent({ message: "Repository created", ...result })] };
      })
  );

  // ── Push changes ────────────────────────────────────────────────────────
  server.tool(
    "sync_push",
    "Push local Lattice state to the remote repository.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.sync.push();
        return { content: [jsonContent(result)] };
      })
  );

  // ── Pull changes ────────────────────────────────────────────────────────
  server.tool(
    "sync_pull",
    "Pull remote changes into the local Lattice state.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.sync.pull();
        return { content: [jsonContent(result)] };
      })
  );

  // ── Disconnect sync ─────────────────────────────────────────────────────
  server.tool(
    "sync_disconnect",
    "Disconnect from the remote sync repository. Local data is preserved.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.sync.disconnect();
        return { content: [jsonContent({ message: "Sync disconnected", ...result })] };
      })
  );
}
