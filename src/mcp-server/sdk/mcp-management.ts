/**
 * Lattice SDK — Global MCP server management (6 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function listMcpServers(c: RouterClient<AppRouter>, projectPath?: string) {
  return c.mcp.list({ projectPath } as Parameters<typeof c.mcp.list>[0]);
}

export async function addMcpServer(c: RouterClient<AppRouter>, input: { name: string; transport: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string }) {
  return c.mcp.add(input as Parameters<typeof c.mcp.add>[0]);
}

export async function removeMcpServer(c: RouterClient<AppRouter>, name: string) {
  return c.mcp.remove({ name } as Parameters<typeof c.mcp.remove>[0]);
}

export async function testMcpServer(c: RouterClient<AppRouter>, name: string) {
  return c.mcp.test({ name } as Parameters<typeof c.mcp.test>[0]);
}

export async function setMcpServerEnabled(c: RouterClient<AppRouter>, name: string, enabled: boolean) {
  return c.mcp.setEnabled({ name, enabled } as Parameters<typeof c.mcp.setEnabled>[0]);
}

export async function setMcpToolAllowlist(c: RouterClient<AppRouter>, name: string, allowlist: string[] | null) {
  return c.mcp.setToolAllowlist({ name, allowlist } as unknown as Parameters<typeof c.mcp.setToolAllowlist>[0]);
}
