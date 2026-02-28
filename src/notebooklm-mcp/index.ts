#!/usr/bin/env bun

/**
 * NotebookLM MCP Server — built-in MCP server for Google NotebookLM.
 *
 * Provides 31+ tools for managing notebooks, sources, studio artifacts
 * (audio, video, reports, flashcards, infographics, slide decks, data tables,
 * mind maps), chat/query, research, sharing, notes, downloads, and exports.
 *
 * Auth: Uses Google cookies extracted from Chrome via CDP. Cookies are stored
 * at ~/.lattice/notebooklm/. Set LATTICE_NLM_PROFILE to use a named profile.
 *
 * Usage:
 *   bun run src/notebooklm-mcp/index.ts
 *
 * Or as a built-in inline server via lattice's coreServices.ts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NotebookLmClient } from "./client/notebookLmClient";

// Tool modules
import { registerAuthTools } from "./tools/auth";
import { registerNotebookTools } from "./tools/notebooks";
import { registerSourceTools } from "./tools/sources";
import { registerStudioTools } from "./tools/studio";
import { registerChatTools } from "./tools/chat";
import { registerResearchTools } from "./tools/research";
import { registerSharingTools } from "./tools/sharing";
import { registerNoteTools } from "./tools/notes";
import { registerDownloadTools } from "./tools/downloads";
import { registerExportTools } from "./tools/exports";

async function main(): Promise<void> {
  process.stderr.write("[notebooklm-mcp] Starting NotebookLM MCP server...\n");

  // Create and initialize the NotebookLM client
  const client = new NotebookLmClient({
    profile: process.env.LATTICE_NLM_PROFILE,
  });

  try {
    await client.init();
    process.stderr.write("[notebooklm-mcp] Client initialized with auth\n");
  } catch (err) {
    // Auth may not be available yet — that's okay, tools will fail gracefully
    process.stderr.write(
      `[notebooklm-mcp] Warning: Auth initialization failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    process.stderr.write(
      "[notebooklm-mcp] Use nlm_auth_extract_cookies to authenticate\n",
    );
  }

  // Create MCP server
  const server = new McpServer({
    name: "notebooklm",
    version: "1.0.0",
  });

  // Register all tool modules
  registerAuthTools(server, client);
  registerNotebookTools(server, client);
  registerSourceTools(server, client);
  registerStudioTools(server, client);
  registerChatTools(server, client);
  registerResearchTools(server, client);
  registerSharingTools(server, client);
  registerNoteTools(server, client);
  registerDownloadTools(server, client);
  registerExportTools(server, client);

  // Count registered tools
  const internalTools = (server as any)._registeredTools;
  const toolCount = internalTools instanceof Map
    ? internalTools.size
    : Object.keys(internalTools ?? {}).length;

  process.stderr.write(
    `[notebooklm-mcp] Registered ${toolCount} tools\n`,
  );

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("[notebooklm-mcp] MCP server running on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[notebooklm-mcp] Fatal error: ${
      err instanceof Error ? err.message : String(err)
    }\n`,
  );
  process.exit(1);
});
