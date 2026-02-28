#!/usr/bin/env bun

/**
 * MCP Server for autonomous LLM control of Lattice.
 *
 * This is a standalone stdio-based MCP server that bridges the Model Context
 * Protocol to the running Lattice backend's oRPC API. It enables external LLMs
 * (e.g. Claude Code) to fully control Lattice — creating minions, sending
 * messages to agents, managing projects, running terminals, etc.
 *
 * Features:
 * - 200+ tools across 18 modules (minion, project, terminal, inbox, kanban, scheduler, sync, etc.)
 * - 2 discovery tools for progressive disclosure (search_tools, list_tool_categories)
 * - 12 MCP resources for efficient data access (projects, config, chat history, inbox, sync, etc.)
 * - 4 MCP prompts for common workflows (create-and-run-task, cost-report, etc.)
 * - Typed SDK for code execution pattern (sdk/ directory)
 *
 * Server discovery order:
 * 1. LATTICE_SERVER_URL + LATTICE_SERVER_AUTH_TOKEN env vars
 * 2. ~/.lattice/server.lock lockfile (auto-discovery)
 * 3. Fallback: http://127.0.0.1:3000
 *
 * Usage:
 *   bun run src/mcp-server/index.ts
 *
 * Or via .mcp.json:
 *   { "mcpServers": { "lattice": { "command": "bun", "args": ["run", "src/mcp-server/index.ts"] } } }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RPCLink as HTTPRPCLink } from "@orpc/client/fetch";
import { createORPCClient } from "@orpc/client";
import type { AppRouter } from "@/node/orpc/router";
import type { RouterClient } from "@orpc/server";

import { discoverServer } from "./utils";

// Tool modules
import { registerGeneralTools } from "./tools/general";
import { registerProjectTools } from "./tools/project";
import { registerMinionTools } from "./tools/minion";
import { registerTerminalTools } from "./tools/terminal";
import { registerConfigTools } from "./tools/config";
import { registerAgentTools } from "./tools/agents";
import { registerTaskTools } from "./tools/tasks";
import { registerMcpManagementTools } from "./tools/mcp-management";
import { registerSecretsTools } from "./tools/secrets";
import { registerAnalyticsTools } from "./tools/analytics";
import { registerServerTools } from "./tools/server";
import { registerTokenizerTools } from "./tools/tokenizer";
import { registerOAuthTools } from "./tools/oauth";
import { registerTerminalProfileTools } from "./tools/terminal-profiles";
import { registerInboxTools } from "./tools/inbox";
import { registerKanbanTools } from "./tools/kanban";
import { registerSchedulerTools } from "./tools/scheduler";
import { registerSyncTools } from "./tools/sync";

// Discovery, resources, prompts
import { registerDiscoveryTools, toolCatalog } from "./tools/discovery";
import { registerResources } from "./resources";
import { registerPrompts } from "./prompts";

/**
 * Create a typed oRPC HTTP client for the Lattice backend.
 * Follows the same pattern as src/cli/proxifyOrpc.ts.
 */
function createOrpcClient(
  baseUrl: string,
  authToken?: string
): RouterClient<AppRouter> {
  const link = new HTTPRPCLink({
    url: `${baseUrl}/orpc`,
    headers: authToken != null ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  return createORPCClient(link);
}

/**
 * Helper: register a tool module and capture its tools into the catalog.
 *
 * After registration, new tools are detected by diffing the McpServer's
 * internal tool map (accessed via _registeredTools). Each new tool is
 * added to the shared toolCatalog with the specified category.
 */
function registerAndCatalog(
  server: McpServer,
  category: string,
  registerFn: () => void,
): void {
  // _registeredTools may be a Map or a plain object depending on SDK version
  const internalTools = (server as any)._registeredTools;
  const getToolNames = (): string[] => {
    if (!internalTools) return [];
    if (internalTools instanceof Map) return [...internalTools.keys()];
    return Object.keys(internalTools);
  };
  const before = new Set(getToolNames());

  // Register the tools
  registerFn();

  // Re-read after registration (reference may have changed)
  const afterTools = (server as any)._registeredTools;
  if (!afterTools) return;

  const entries: Array<[string, { description?: string }]> =
    afterTools instanceof Map
      ? [...afterTools.entries()]
      : Object.entries(afterTools);

  for (const [name, tool] of entries) {
    if (!before.has(name)) {
      toolCatalog.push({
        name,
        category,
        description: tool.description ?? name,
      });
    }
  }
}

async function main(): Promise<void> {
  // Discover the running Lattice backend
  const connection = await discoverServer();

  // Log to stderr (stdout is reserved for MCP protocol)
  process.stderr.write(
    `[lattice-mcp] Connecting to Lattice backend at ${connection.baseUrl}\n`
  );

  // Create oRPC client
  const client = createOrpcClient(connection.baseUrl, connection.authToken);

  // Create MCP server
  const mcpServer = new McpServer({
    name: "lattice",
    version: "1.0.0",
  });

  // Register all tool modules and build the tool catalog for progressive disclosure.
  // Each module's tools are captured into toolCatalog with their category.
  registerAndCatalog(mcpServer, "general", () => registerGeneralTools(mcpServer, client));
  registerAndCatalog(mcpServer, "project", () => registerProjectTools(mcpServer, client));
  registerAndCatalog(mcpServer, "minion", () => registerMinionTools(mcpServer, client));
  registerAndCatalog(mcpServer, "terminal", () => registerTerminalTools(mcpServer, client));
  registerAndCatalog(mcpServer, "config", () => registerConfigTools(mcpServer, client));
  registerAndCatalog(mcpServer, "agents", () => registerAgentTools(mcpServer, client));
  registerAndCatalog(mcpServer, "tasks", () => registerTaskTools(mcpServer, client));
  registerAndCatalog(mcpServer, "mcp-management", () => registerMcpManagementTools(mcpServer, client));
  registerAndCatalog(mcpServer, "secrets", () => registerSecretsTools(mcpServer, client));
  registerAndCatalog(mcpServer, "analytics", () => registerAnalyticsTools(mcpServer, client));
  registerAndCatalog(mcpServer, "server", () => registerServerTools(mcpServer, client));
  registerAndCatalog(mcpServer, "tokenizer", () => registerTokenizerTools(mcpServer, client));
  registerAndCatalog(mcpServer, "oauth", () => registerOAuthTools(mcpServer, client));
  registerAndCatalog(mcpServer, "terminal-profiles", () => registerTerminalProfileTools(mcpServer, client));
  registerAndCatalog(mcpServer, "inbox", () => registerInboxTools(mcpServer, client));
  registerAndCatalog(mcpServer, "kanban", () => registerKanbanTools(mcpServer, client));
  registerAndCatalog(mcpServer, "scheduler", () => registerSchedulerTools(mcpServer, client));
  registerAndCatalog(mcpServer, "sync", () => registerSyncTools(mcpServer, client));

  // Register discovery tools (search_tools + list_tool_categories)
  // These tools use the populated toolCatalog to enable progressive disclosure.
  registerAndCatalog(mcpServer, "discovery", () => registerDiscoveryTools(mcpServer));

  // Register MCP Resources (read-only data browsing)
  registerResources(mcpServer, client);

  // Register MCP Prompts (workflow templates)
  registerPrompts(mcpServer);

  process.stderr.write(
    `[lattice-mcp] Registered ${toolCatalog.length} tools in catalog, ` +
      `12 resources, 4 prompts\n`
  );

  // Connect via stdio transport (stdin/stdout)
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  process.stderr.write("[lattice-mcp] MCP server running on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[lattice-mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
