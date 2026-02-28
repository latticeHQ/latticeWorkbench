/**
 * Tool discovery tools: progressive disclosure for context-efficient tool usage.
 *
 * Instead of loading all 169 tool definitions upfront, LLMs can use these tools
 * to discover and search for the specific tools they need.
 *
 * Following Anthropic's "Code execution with MCP" pattern:
 * https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

/** Catalog entry for a registered tool. */
export interface ToolCatalogEntry {
  name: string;
  category: string;
  description: string;
}

/** Global tool catalog — populated by index.ts after all tools are registered. */
export const toolCatalog: ToolCatalogEntry[] = [];

/** Category metadata for list_tool_categories.
 *  Each value is prefixed with a scope tag so LLMs know where the tool operates:
 *  [Global] = server-wide, [Project-scoped] = needs projectPath, [Minion-scoped] = needs minionId
 */
const CATEGORIES: Record<string, string> = {
  minion: "[Minion-scoped] Core agent control: create minions, send messages, execute bash, manage streams, compaction, chat history. Parent: project.",
  project: "[Project-scoped] Project management: CRUD, branches, crews, secrets, MCP servers, idle compaction, file completions. Contains: minions, crews.",
  server: "[Global] Server management: API status, SSH, auth sessions, updates, signing, Lattice identity, experiments, telemetry, voice, UI layouts, inference.",
  oauth: "[Global] OAuth flows: device-code and server-side flows for Copilot, Codex, MCP server authentication.",
  config: "[Global] Configuration: global config, model preferences, provider management, runtime enablement.",
  terminal: "[Minion-scoped] Terminal sessions: create, input, close, list, resize, native terminal, pop-out windows. Can launch built-in AI agent profiles via profileId. Parent: minion.",
  analytics: "[Global] Spend tracking: summaries, time series, breakdowns by project/model/agent, cache ratios, DB rebuild.",
  "mcp-management": "[Global] MCP server CRUD: list, add, remove, test, enable/disable, tool allowlists.",
  general: "[Global] Utilities: ping health check, directory operations, editor integration, log management.",
  agents: "[Global] Agent discovery: list/get agent definitions and skills, skill diagnostics.",
  tokenizer: "[Global] Token counting: count tokens, batch count, calculate chat token/cost statistics.",
  secrets: "[Project-scoped] Secrets management: get/update global or project-scoped secrets.",
  tasks: "[Minion-scoped] Sidekick tasks: create agent sub-tasks for parallel orchestration. Parent: minion.",
  "terminal-profiles": "[Global] Built-in AI agent profiles: check/enable/install pre-configured CLI tools (claude-code, gemini-cli, copilot, codex, aider, amp). These are NOT custom tools — they ship with Lattice. Use terminal_create with profileId to launch.",
  inbox: "[Project-scoped] Inbox messaging: bridge conversations from Slack, Discord, Telegram, etc. — list, reply, manage adapters. Parent: project.",
  kanban: "[Minion-scoped] Kanban board: view and move minion task cards between workflow columns (queued → active → completed → archived). Parent: minion.",
  scheduler: "[Project-scoped] Task scheduler: create/manage cron or interval automated tasks that run in minions. Parent: project.",
  sync: "[Global] Git sync: push/pull Lattice state to remote repos, manage GitHub auth, configure sync categories.",
  discovery: "[Global] Tool discovery: search and browse the tool catalog (this category). Start here with list_tool_categories.",
};

export function registerDiscoveryTools(server: McpServer): void {
  // ── List tool categories ───────────────────────────────────────────────
  server.tool(
    "list_tool_categories",
    "List all tool categories with descriptions and tool counts. " +
      "Use this first to understand what capabilities are available, " +
      "then use search_tools to find specific tools.",
    {},
    () =>
      withErrorHandling(async () => {
        // Count tools per category
        const counts = new Map<string, number>();
        for (const entry of toolCatalog) {
          counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
        }

        const categories = Object.entries(CATEGORIES).map(([id, description]) => ({
          category: id,
          description,
          toolCount: counts.get(id) ?? 0,
        }));

        return {
          content: [
            jsonContent({
              totalTools: toolCatalog.length,
              categories,
              hint: "Use search_tools({ category: '<name>' }) to list tools in a category, " +
                "or search_tools({ query: '<keyword>' }) to search by keyword.",
            }),
          ],
        };
      })
  );

  // ── Search tools ───────────────────────────────────────────────────────
  server.tool(
    "search_tools",
    "Search the tool catalog by keyword or category. Returns matching tools " +
      "at the requested detail level.\n\n" +
      "Detail levels:\n" +
      "- 'names': Just tool names (minimal tokens)\n" +
      "- 'summary': Names + one-line descriptions (default)\n" +
      "- 'full': Names + full descriptions (most tokens)\n\n" +
      "Examples:\n" +
      "- search_tools({ query: 'send message' }) — find messaging tools\n" +
      "- search_tools({ category: 'minion' }) — list all minion tools\n" +
      "- search_tools({ query: 'oauth', detail: 'names' }) — just OAuth tool names",
    {
      query: z.string().optional().describe("Keyword to search in tool names and descriptions"),
      category: z.string().optional().describe("Filter to a specific category"),
      detail: z.enum(["names", "summary", "full"]).optional().describe("Detail level (default: summary)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const detail = params.detail ?? "summary";
        let results = [...toolCatalog];

        // Filter by category
        if (params.category) {
          const cat = params.category.toLowerCase();
          results = results.filter(
            (t) => t.category.toLowerCase() === cat
          );
        }

        // Filter by query (fuzzy search on name + description)
        if (params.query) {
          const terms = params.query.toLowerCase().split(/\s+/);
          results = results.filter((t) => {
            const searchText = `${t.name} ${t.description}`.toLowerCase();
            return terms.every((term) => searchText.includes(term));
          });
        }

        // Format based on detail level
        let formatted: unknown[];
        switch (detail) {
          case "names":
            formatted = results.map((t) => t.name);
            break;
          case "summary":
            formatted = results.map((t) => ({
              name: t.name,
              description: t.description.split(".")[0] + ".", // First sentence only
            }));
            break;
          case "full":
            formatted = results.map((t) => ({
              name: t.name,
              category: t.category,
              description: t.description,
            }));
            break;
        }

        return {
          content: [
            jsonContent({
              matchCount: results.length,
              detail,
              tools: formatted,
            }),
          ],
        };
      })
  );
}
