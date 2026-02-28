/**
 * Lattice SDK discovery tools — progressive disclosure for code execution.
 *
 * Following the "Code execution with MCP" pattern (Anthropic blog):
 * instead of loading 170+ tool definitions into context, agents discover
 * SDK functions on demand via search, then read SDK files and write code.
 *
 * Two built-in tools:
 *   - lattice_list_categories: Overview of the 14 SDK module categories
 *   - lattice_search_tools: Search functions by keyword/category
 *
 * The agent's workflow:
 *   1. lattice_list_categories → see what's available
 *   2. lattice_search_tools({ query: "minion" }) → find relevant functions
 *   3. file_read("src/mcp-server/sdk/minion.ts") → get full type signatures
 *   4. bash("bun run script.ts") → execute code using the SDK
 */

import * as path from "path";
import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  LATTICE_SDK_CATEGORIES,
  searchSdkCatalog,
} from "@/common/latticeSdkCatalog";

/**
 * Resolve the absolute path to the SDK directory.
 * Works in both dev (src/mcp-server/sdk/) and packaged builds.
 */
function getSdkBasePath(): string {
  // Navigate from src/node/services/tools/ → src/mcp-server/sdk/
  return path.resolve(__dirname, "../../../mcp-server/sdk");
}

/**
 * lattice_list_categories tool factory.
 * Returns all SDK module categories with function counts.
 */
export const createLatticeListCategoriesTool: ToolFactory = (_config) => {
  return tool({
    description: TOOL_DEFINITIONS.lattice_list_categories.description,
    inputSchema: TOOL_DEFINITIONS.lattice_list_categories.schema,
    execute: async () => {
      const sdkBasePath = getSdkBasePath();
      const totalFunctions = LATTICE_SDK_CATEGORIES.reduce(
        (sum, c) => sum + c.functionCount,
        0
      );

      return {
        totalCategories: LATTICE_SDK_CATEGORIES.length,
        totalFunctions,
        sdkBasePath,
        skillFile: path.join(sdkBasePath, "SKILL.md"),
        clientFile: path.join(sdkBasePath, "client.ts"),
        categories: LATTICE_SDK_CATEGORIES.map((c) => ({
          id: c.id,
          description: c.description,
          functions: c.functionCount,
          sdkFile: path.join(sdkBasePath, c.sdkFile.replace("sdk/", "")),
        })),
        hint: "Use lattice_search_tools to find specific functions, then file_read to read SDK files for full type signatures. Execute code via bash (bun run).",
      };
    },
  });
};

/**
 * lattice_search_tools tool factory.
 * Search the SDK catalog by keyword with configurable detail level.
 */
export const createLatticeSearchToolsTool: ToolFactory = (_config) => {
  return tool({
    description: TOOL_DEFINITIONS.lattice_search_tools.description,
    inputSchema: TOOL_DEFINITIONS.lattice_search_tools.schema,
    execute: async ({ query, category, detail: detailInput }) => {
      const detail = detailInput ?? "summary";
      const sdkBasePath = getSdkBasePath();

      const results = searchSdkCatalog(query, {
        category: category ?? undefined,
      });

      if (results.length === 0) {
        return {
          matchCount: 0,
          query,
          category: category ?? null,
          hint: `No functions matched "${query}". Try broader terms or use lattice_list_categories to see available modules.`,
          results: [],
        };
      }

      // Format results based on detail level
      let formattedResults: unknown[];
      switch (detail) {
        case "names":
          formattedResults = results.map((r) => r.name);
          break;
        case "full":
          formattedResults = results.map((r) => {
            const cat = LATTICE_SDK_CATEGORIES.find((c) => c.id === r.category);
            return {
              name: r.name,
              category: r.category,
              description: r.description,
              sdkFile: cat
                ? path.join(sdkBasePath, cat.sdkFile.replace("sdk/", ""))
                : null,
            };
          });
          break;
        case "summary":
        default:
          formattedResults = results.map((r) => ({
            name: r.name,
            category: r.category,
            description: r.description,
          }));
          break;
      }

      return {
        matchCount: results.length,
        query,
        category: category ?? null,
        detail,
        results: formattedResults,
        hint:
          detail !== "full"
            ? `Use detail:"full" to see SDK file paths, then file_read to get full type signatures.`
            : `Read the SDK file via file_read for full TypeScript signatures, then write code and execute via bash (bun).`,
      };
    },
  });
};
