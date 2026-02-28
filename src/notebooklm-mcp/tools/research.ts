/**
 * MCP tool registrations for research operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerResearchTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_start_research",
    "Start a research task that searches the web or Google Drive for information. Returns a research ID to poll for results.",
    {
      notebookId: z.string().describe("The notebook ID"),
      query: z.string().describe("Research query"),
      source: z
        .enum(["web", "drive"])
        .optional()
        .describe("Where to search: 'web' (default) or 'drive' (Google Drive)"),
      mode: z
        .enum(["fast", "deep"])
        .optional()
        .describe("Research depth: 'fast' (default) or 'deep' (more thorough)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.research.start(
          params.notebookId,
          params.query,
          {
            source: params.source,
            mode: params.mode,
          },
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_research_status",
    "Check the status of an ongoing research task. Poll until status is 'complete'.",
    {
      notebookId: z.string().describe("The notebook ID"),
      researchId: z.string().describe("The research task ID from nlm_start_research"),
    },
    (params) =>
      withErrorHandling(async () => {
        const status = await client.research.getStatus(
          params.notebookId,
          params.researchId,
        );
        return { content: [jsonContent(status)] };
      }),
  );

  server.tool(
    "nlm_import_research_sources",
    "Import discovered research results as sources into the notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      researchId: z.string().describe("The research task ID"),
      sourceIds: z
        .array(z.string())
        .describe("IDs of research results to import as notebook sources"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.research.importSources(
          params.notebookId,
          params.researchId,
          params.sourceIds,
        );
        return { content: [jsonContent(result)] };
      }),
  );
}
