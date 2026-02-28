/**
 * MCP tool registrations for export operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerExportTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_export_to_docs",
    "Export a studio artifact (report, flashcards, etc.) to Google Docs. Returns the URL of the created document.",
    {
      notebookId: z.string().describe("The notebook ID"),
      artifactId: z.string().describe("The artifact ID to export"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.exports.toDocs(
          params.notebookId,
          params.artifactId,
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_export_to_sheets",
    "Export a studio artifact (data table, etc.) to Google Sheets. Returns the URL of the created spreadsheet.",
    {
      notebookId: z.string().describe("The notebook ID"),
      artifactId: z.string().describe("The artifact ID to export"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.exports.toSheets(
          params.notebookId,
          params.artifactId,
        );
        return { content: [jsonContent(result)] };
      }),
  );
}
