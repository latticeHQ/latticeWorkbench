#!/usr/bin/env node
/**
 * Lattice Workbench MCP Server
 *
 * Exposes the workbench's capabilities as MCP tools so any LLM
 * (Claude Code, Cursor, TG bot, etc.) can operate the workbench
 * programmatically — create workspaces, send messages, run bash,
 * manage channels, all from the outside.
 *
 * Usage:
 *   npx tsx src/mcp-server/index.ts [--workbench-url URL] [--auth-token TOKEN]
 *
 * Defaults:
 *   --workbench-url http://localhost:3000
 *   --auth-token   (none, or LATTICE_SERVER_AUTH_TOKEN env var)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WorkbenchClient } from "./client.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerConfigTools } from "./tools/config.js";
import { registerSystemTools } from "./tools/system.js";
import { registerBootstrapTools } from "./tools/bootstrap.js";
import { registerSwarmTools } from "./tools/swarm.js";
import { registerCronTools } from "./tools/cron.js";
import { registerHealthTools } from "./tools/health.js";
import { registerCodexTools } from "./tools/codex.js";
import { registerSkillsTools } from "./tools/skills.js";
import { registerBrowserTools } from "./tools/browser.js";

// ── Parse CLI args ──────────────────────────────────────────────────

function parseArgs(): { workbenchUrl: string; authToken?: string } {
  const args = process.argv.slice(2);
  let workbenchUrl = process.env.LATTICE_WORKBENCH_URL ?? "http://localhost:3000";
  let authToken = process.env.LATTICE_SERVER_AUTH_TOKEN ?? undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workbench-url" && args[i + 1]) {
      workbenchUrl = args[++i]!;
    } else if (args[i] === "--auth-token" && args[i + 1]) {
      authToken = args[++i]!;
    }
  }

  return { workbenchUrl, authToken };
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { workbenchUrl, authToken } = parseArgs();

  // Create the MCP server
  const server = new McpServer({
    name: "lattice-workbench",
    version: "1.0.0",
  });

  // Create the HTTP client for the workbench API
  const client = new WorkbenchClient({
    baseUrl: workbenchUrl,
    authToken,
  });

  // Validate auth token against workbench API (if token provided)
  if (authToken) {
    console.error(`[lattice-workbench-mcp] Validating auth token against workbench...`);
    const isValid = await client.ping();
    if (!isValid) {
      console.error(`[lattice-workbench-mcp] WARNING: Workbench not reachable — token validation deferred to first request`);
    } else {
      console.error(`[lattice-workbench-mcp] Auth token validated successfully`);
    }
  }

  // Register all tools
  registerWorkspaceTools(server, client);
  registerProjectTools(server, client);
  registerChannelTools(server, client);
  registerConfigTools(server, client);
  registerSystemTools(server);
  registerBootstrapTools(server, client);
  registerSwarmTools(server, client);
  registerCronTools(server, client);
  registerHealthTools(server, client);
  registerCodexTools(server, client);
  registerSkillsTools(server, client);
  registerBrowserTools(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`[lattice-workbench-mcp] Server started`);
  console.error(`[lattice-workbench-mcp] Workbench URL: ${workbenchUrl}`);
  console.error(`[lattice-workbench-mcp] Auth: ${authToken ? "enabled" : "none"}`);
  console.error(`[lattice-workbench-mcp] Tools registered: workspace, project, channel, config, system, bootstrap, swarm, cron, health, codex, skills, browser`);

  // Graceful shutdown — close WebSocket and transport on exit signals
  const shutdown = async () => {
    console.error(`[lattice-workbench-mcp] Shutting down...`);
    client.closeWebSocket();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[lattice-workbench-mcp] Fatal error:", error);
  process.exit(1);
});
