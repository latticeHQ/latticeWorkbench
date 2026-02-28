/**
 * Global MCP server management tools: list, add, remove, test, enable/disable,
 * and set tool allowlists for MCP servers.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerMcpManagementTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List global MCP servers ────────────────────────────────────────────
  server.tool(
    "list_mcp_servers",
    "List globally configured MCP servers. Optionally pass projectPath for project-specific overrides.",
    {
      projectPath: z.string().optional().describe("Project path for override context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const servers = await client.mcp.list({
          projectPath: params.projectPath,
        } as Parameters<typeof client.mcp.list>[0]);
        return { content: [jsonContent(servers)] };
      })
  );

  // ── Add global MCP server ─────────────────────────────────────────────
  server.tool(
    "add_mcp_server",
    "Add or update a global MCP server configuration.",
    {
      name: z.string().describe("Unique server name"),
      transport: z.enum(["stdio", "sse", "streamable-http"]).describe("Transport type"),
      command: z.string().optional().describe("Command for stdio transport (e.g. 'npx')"),
      args: z.array(z.string()).optional().describe("Command arguments for stdio transport"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
      url: z.string().optional().describe("URL for SSE or streamable-http transport"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcp.add({
          name: params.name,
          transport: params.transport,
          command: params.command,
          args: params.args,
          env: params.env,
          url: params.url,
        } as Parameters<typeof client.mcp.add>[0]);
        return { content: [jsonContent({ message: "MCP server added", ...result })] };
      })
  );

  // ── Remove global MCP server ──────────────────────────────────────────
  server.tool(
    "remove_mcp_server",
    "Remove a globally configured MCP server.",
    {
      name: z.string().describe("Server name to remove"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcp.remove({
          name: params.name,
        } as Parameters<typeof client.mcp.remove>[0]);
        return { content: [jsonContent({ message: "MCP server removed", ...result })] };
      })
  );

  // ── Test global MCP server ────────────────────────────────────────────
  server.tool(
    "test_mcp_server",
    "Test connectivity to a globally configured MCP server.",
    {
      name: z.string().describe("Server name to test"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcp.test({
          name: params.name,
        } as Parameters<typeof client.mcp.test>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Enable/disable global MCP server ──────────────────────────────────
  server.tool(
    "set_mcp_server_enabled",
    "Enable or disable a globally configured MCP server.",
    {
      name: z.string().describe("Server name"),
      enabled: z.boolean().describe("Whether to enable the server"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcp.setEnabled({
          name: params.name,
          enabled: params.enabled,
        } as Parameters<typeof client.mcp.setEnabled>[0]);
        return { content: [jsonContent({ message: `MCP server ${params.enabled ? "enabled" : "disabled"}`, ...result })] };
      })
  );

  // ── Set tool allowlist ────────────────────────────────────────────────
  server.tool(
    "set_mcp_tool_allowlist",
    "Set the tool allowlist for a global MCP server. Pass null to allow all tools.",
    {
      name: z.string().describe("Server name"),
      allowlist: z.array(z.string()).nullable().describe("Array of allowed tool names, or null for all"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcp.setToolAllowlist({
          name: params.name,
          allowlist: params.allowlist,
        } as unknown as Parameters<typeof client.mcp.setToolAllowlist>[0]);
        return { content: [jsonContent({ message: "Tool allowlist updated", ...result })] };
      })
  );
}
