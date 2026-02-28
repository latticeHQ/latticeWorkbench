/**
 * OAuth flow tools: device-code and server-side OAuth flows for
 * Copilot, Codex (ChatGPT), Anthropic, and MCP server authentication.
 *
 * Desktop-popup OAuth flows are excluded (require Electron window).
 * Only device-code flows (user pastes code in browser) and server-side
 * flows (returns authorizeUrl) are exposed — both work over stdio MCP.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerOAuthTools(server: McpServer, client: RouterClient<AppRouter>): void {
  // ═══════════════════════════════════════════════════════════════════════
  // GitHub Copilot OAuth (device-code flow)
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "copilot_oauth_start",
    "Start GitHub Copilot OAuth device-code flow. Returns a user code and " +
      "verification URL — the user pastes the code in their browser to authenticate.",
    {},
    () =>
      withErrorHandling(async () => {
        const flow = await client.copilotOauth.startDeviceFlow();
        return { content: [jsonContent(flow)] };
      })
  );

  server.tool(
    "copilot_oauth_wait",
    "Poll/wait for a Copilot device-code flow to complete. Call after copilot_oauth_start.",
    {
      flowId: z.string().describe("Flow ID from copilot_oauth_start"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.copilotOauth.waitForDeviceFlow({
          flowId: params.flowId,
          timeoutMs: params.timeoutMs,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "copilot_oauth_cancel",
    "Cancel an in-progress Copilot device-code flow.",
    { flowId: z.string().describe("Flow ID to cancel") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.copilotOauth.cancelDeviceFlow({ flowId: params.flowId });
        return {
          content: [
            jsonContent({
              message: "Copilot OAuth flow cancelled",
              ...(result as unknown as Record<string, unknown>),
            }),
          ],
        };
      })
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Codex (ChatGPT) OAuth
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "codex_oauth_start_device",
    "Start Codex (ChatGPT) OAuth device-code flow. Returns a user code and " +
      "verification URL for browser authentication.",
    {},
    () =>
      withErrorHandling(async () => {
        const flow = await client.codexOauth.startDeviceFlow();
        return { content: [jsonContent(flow)] };
      })
  );

  server.tool(
    "codex_oauth_wait_device",
    "Poll/wait for a Codex device-code flow to complete.",
    {
      flowId: z.string().describe("Flow ID from codex_oauth_start_device"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.codexOauth.waitForDeviceFlow({
          flowId: params.flowId,
          timeoutMs: params.timeoutMs,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "codex_oauth_cancel_device",
    "Cancel an in-progress Codex device-code flow.",
    { flowId: z.string().describe("Flow ID to cancel") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.codexOauth.cancelDeviceFlow({ flowId: params.flowId });
        return {
          content: [
            jsonContent({
              message: "Codex OAuth flow cancelled",
              ...(result as unknown as Record<string, unknown>),
            }),
          ],
        };
      })
  );

  server.tool(
    "codex_oauth_disconnect",
    "Disconnect/revoke stored Codex (ChatGPT) OAuth credentials.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.codexOauth.disconnect();
        return { content: [jsonContent({ message: "Codex OAuth disconnected", ...result })] };
      })
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Anthropic OAuth (Claude Pro/Max subscription — PKCE authorization code)
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "anthropic_oauth_start",
    "Start Anthropic OAuth PKCE flow. Returns a flowId and authorizeUrl — " +
      "the user opens the URL in their browser, logs in, and pastes back the code.",
    {},
    () =>
      withErrorHandling(async () => {
        const flow = await client.anthropicOauth.startFlow();
        return { content: [jsonContent(flow)] };
      })
  );

  server.tool(
    "anthropic_oauth_submit_code",
    "Submit the authorization code from the Anthropic OAuth flow. " +
      "The user pastes the code (in code#state format) after completing browser login.",
    {
      flowId: z.string().describe("Flow ID from anthropic_oauth_start"),
      code: z.string().describe("Authorization code pasted by the user (code#state format)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.anthropicOauth.submitCode({
          flowId: params.flowId,
          code: params.code,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "anthropic_oauth_wait",
    "Wait for an Anthropic OAuth flow to complete (blocks until submitCode resolves). " +
      "Call after anthropic_oauth_start.",
    {
      flowId: z.string().describe("Flow ID from anthropic_oauth_start"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.anthropicOauth.waitForFlow({
          flowId: params.flowId,
          timeoutMs: params.timeoutMs,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "anthropic_oauth_cancel",
    "Cancel an in-progress Anthropic OAuth flow.",
    { flowId: z.string().describe("Flow ID to cancel") },
    (params) =>
      withErrorHandling(async () => {
        await client.anthropicOauth.cancelFlow({ flowId: params.flowId });
        return { content: [jsonContent({ message: "Anthropic OAuth flow cancelled" })] };
      })
  );

  server.tool(
    "anthropic_oauth_disconnect",
    "Disconnect/revoke stored Anthropic OAuth credentials (Claude Pro/Max).",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.anthropicOauth.disconnect();
        return { content: [jsonContent({ message: "Anthropic OAuth disconnected", ...result })] };
      })
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Global MCP server OAuth (server-side flow)
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "mcp_oauth_start_server_flow",
    "Start a server-side OAuth flow for a global MCP server. Returns an authorize URL " +
      "the user can visit in their browser.",
    {
      serverName: z.string().describe("MCP server name to authenticate"),
      projectPath: z.string().optional().describe("Optional project path context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const flow = await client.mcpOauth.startServerFlow({
          serverName: params.serverName,
          projectPath: params.projectPath,
        } as Parameters<typeof client.mcpOauth.startServerFlow>[0]);
        return { content: [jsonContent(flow)] };
      })
  );

  server.tool(
    "mcp_oauth_wait_server_flow",
    "Poll/wait for a global MCP server OAuth flow to complete.",
    {
      flowId: z.string().describe("Flow ID from mcp_oauth_start_server_flow"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcpOauth.waitForServerFlow({
          flowId: params.flowId,
          timeoutMs: params.timeoutMs,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "mcp_oauth_cancel_server_flow",
    "Cancel a global MCP server OAuth flow.",
    { flowId: z.string().describe("Flow ID to cancel") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcpOauth.cancelServerFlow({ flowId: params.flowId });
        return {
          content: [
            jsonContent({
              message: "MCP OAuth flow cancelled",
              ...(result as unknown as Record<string, unknown>),
            }),
          ],
        };
      })
  );

  server.tool(
    "mcp_oauth_get_auth_status",
    "Check if a global MCP server URL has a valid OAuth token.",
    { serverUrl: z.string().describe("MCP server URL to check") },
    (params) =>
      withErrorHandling(async () => {
        const status = await client.mcpOauth.getAuthStatus({ serverUrl: params.serverUrl });
        return { content: [jsonContent(status)] };
      })
  );

  server.tool(
    "mcp_oauth_logout",
    "Log out from a global MCP server's OAuth session.",
    { serverUrl: z.string().describe("MCP server URL to log out from") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.mcpOauth.logout({ serverUrl: params.serverUrl });
        return { content: [jsonContent({ message: "MCP OAuth session logged out", ...result })] };
      })
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Project-scoped MCP server OAuth (server-side flow)
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "project_mcp_oauth_start_server_flow",
    "Start a server-side OAuth flow for a project-scoped MCP server.",
    {
      projectPath: z.string().describe("Absolute project path"),
      serverName: z.string().describe("MCP server name to authenticate"),
    },
    (params) =>
      withErrorHandling(async () => {
        const flow = await client.projects.mcpOauth.startServerFlow({
          projectPath: params.projectPath,
          serverName: params.serverName,
        } as Parameters<typeof client.projects.mcpOauth.startServerFlow>[0]);
        return { content: [jsonContent(flow)] };
      })
  );

  server.tool(
    "project_mcp_oauth_wait_server_flow",
    "Poll/wait for a project-scoped MCP server OAuth flow to complete.",
    {
      flowId: z.string().describe("Flow ID"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcpOauth.waitForServerFlow({
          flowId: params.flowId,
          timeoutMs: params.timeoutMs,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "project_mcp_oauth_cancel_server_flow",
    "Cancel a project-scoped MCP server OAuth flow.",
    { flowId: z.string().describe("Flow ID to cancel") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcpOauth.cancelServerFlow({ flowId: params.flowId });
        return {
          content: [
            jsonContent({
              message: "Project MCP OAuth flow cancelled",
              ...(result as unknown as Record<string, unknown>),
            }),
          ],
        };
      })
  );

  server.tool(
    "project_mcp_oauth_get_auth_status",
    "Check OAuth status for a project-scoped MCP server.",
    {
      projectPath: z.string().describe("Absolute project path"),
      serverName: z.string().describe("MCP server name"),
    },
    (params) =>
      withErrorHandling(async () => {
        const status = await client.projects.mcpOauth.getAuthStatus({
          projectPath: params.projectPath,
          serverName: params.serverName,
        });
        return { content: [jsonContent(status)] };
      })
  );

  server.tool(
    "project_mcp_oauth_logout",
    "Log out from a project-scoped MCP server's OAuth session.",
    {
      projectPath: z.string().describe("Absolute project path"),
      serverName: z.string().describe("MCP server name"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcpOauth.logout({
          projectPath: params.projectPath,
          serverName: params.serverName,
        });
        return {
          content: [jsonContent({ message: "Project MCP OAuth session logged out", ...result })],
        };
      })
  );
}
