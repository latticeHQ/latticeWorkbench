/**
 * Lattice SDK — OAuth operations (17 functions)
 * Device-code and server-side flows for Copilot, Codex, and MCP servers.
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// Copilot
export async function copilotStartDeviceFlow(c: RouterClient<AppRouter>) { return c.copilotOauth.startDeviceFlow(); }
export async function copilotWaitForDeviceFlow(c: RouterClient<AppRouter>, flowId: string, timeoutMs?: number) { return c.copilotOauth.waitForDeviceFlow({ flowId, timeoutMs }); }
export async function copilotCancelDeviceFlow(c: RouterClient<AppRouter>, flowId: string) { return c.copilotOauth.cancelDeviceFlow({ flowId }); }

// Codex
export async function codexStartDeviceFlow(c: RouterClient<AppRouter>) { return c.codexOauth.startDeviceFlow(); }
export async function codexWaitForDeviceFlow(c: RouterClient<AppRouter>, flowId: string, timeoutMs?: number) { return c.codexOauth.waitForDeviceFlow({ flowId, timeoutMs }); }
export async function codexCancelDeviceFlow(c: RouterClient<AppRouter>, flowId: string) { return c.codexOauth.cancelDeviceFlow({ flowId }); }
export async function codexDisconnect(c: RouterClient<AppRouter>) { return c.codexOauth.disconnect(); }

// Global MCP OAuth (server flow)
export async function mcpStartServerFlow(c: RouterClient<AppRouter>, serverName: string, projectPath?: string) {
  return c.mcpOauth.startServerFlow({ serverName, projectPath } as Parameters<typeof c.mcpOauth.startServerFlow>[0]);
}
export async function mcpWaitForServerFlow(c: RouterClient<AppRouter>, flowId: string, timeoutMs?: number) { return c.mcpOauth.waitForServerFlow({ flowId, timeoutMs }); }
export async function mcpCancelServerFlow(c: RouterClient<AppRouter>, flowId: string) { return c.mcpOauth.cancelServerFlow({ flowId }); }
export async function mcpGetAuthStatus(c: RouterClient<AppRouter>, serverUrl: string) { return c.mcpOauth.getAuthStatus({ serverUrl }); }
export async function mcpLogout(c: RouterClient<AppRouter>, serverUrl: string) { return c.mcpOauth.logout({ serverUrl }); }

// Project MCP OAuth (server flow)
export async function projectMcpStartServerFlow(c: RouterClient<AppRouter>, projectPath: string, serverName: string) {
  return c.projects.mcpOauth.startServerFlow({ projectPath, serverName } as Parameters<typeof c.projects.mcpOauth.startServerFlow>[0]);
}
export async function projectMcpWaitForServerFlow(c: RouterClient<AppRouter>, flowId: string, timeoutMs?: number) { return c.projects.mcpOauth.waitForServerFlow({ flowId, timeoutMs }); }
export async function projectMcpCancelServerFlow(c: RouterClient<AppRouter>, flowId: string) { return c.projects.mcpOauth.cancelServerFlow({ flowId }); }
export async function projectMcpGetAuthStatus(c: RouterClient<AppRouter>, projectPath: string, serverName: string) { return c.projects.mcpOauth.getAuthStatus({ projectPath, serverName }); }
export async function projectMcpLogout(c: RouterClient<AppRouter>, projectPath: string, serverName: string) { return c.projects.mcpOauth.logout({ projectPath, serverName }); }
