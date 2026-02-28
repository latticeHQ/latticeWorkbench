/**
 * MCP tool registrations for notebook operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerNotebookTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_list_notebooks",
    "List all NotebookLM notebooks. Returns notebook IDs, titles, and metadata.",
    {
      ownership: z
        .enum(["mine", "shared"])
        .optional()
        .describe("Filter by ownership: 'mine' (default) or 'shared'"),
    },
    (params) =>
      withErrorHandling(async () => {
        const notebooks = await client.notebooks.list(params.ownership);
        return { content: [jsonContent(notebooks)] };
      }),
  );

  server.tool(
    "nlm_get_notebook",
    "Get detailed information about a specific notebook including sources, settings, and sharing status.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const notebook = await client.notebooks.get(params.notebookId);
        return { content: [jsonContent(notebook)] };
      }),
  );

  server.tool(
    "nlm_describe_notebook",
    "Get a comprehensive description of a notebook including AI-generated summary, source guide, and structure overview.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const description = await client.notebooks.describe(params.notebookId);
        return { content: [jsonContent(description)] };
      }),
  );

  server.tool(
    "nlm_create_notebook",
    "Create a new NotebookLM notebook.",
    {
      title: z.string().describe("Title for the new notebook"),
    },
    (params) =>
      withErrorHandling(async () => {
        const notebook = await client.notebooks.create(params.title);
        return { content: [jsonContent(notebook)] };
      }),
  );

  server.tool(
    "nlm_rename_notebook",
    "Rename an existing notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      title: z.string().describe("New title for the notebook"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.notebooks.rename(params.notebookId, params.title);
        return {
          content: [
            jsonContent({
              success: true,
              message: `Notebook renamed to '${params.title}'`,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_delete_notebook",
    "Delete a notebook. This action is irreversible.",
    {
      notebookId: z.string().describe("The notebook ID to delete"),
      confirm: z
        .boolean()
        .describe("Must be true to confirm deletion"),
    },
    (params) =>
      withErrorHandling(async () => {
        if (!params.confirm) {
          return {
            content: [
              jsonContent({
                error: "Deletion not confirmed. Set confirm=true to proceed.",
              }),
            ],
          };
        }
        await client.notebooks.delete(params.notebookId);
        return {
          content: [
            jsonContent({ success: true, message: "Notebook deleted" }),
          ],
        };
      }),
  );
}
