/**
 * MCP tool registrations for source operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerSourceTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_add_source_url",
    "Add a web page URL as a source to a notebook. NotebookLM will fetch and index the content.",
    {
      notebookId: z.string().describe("The notebook ID"),
      url: z.string().url().describe("URL of the web page to add"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sources.addUrl(
          params.notebookId,
          params.url,
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_add_source_urls",
    "Add multiple web page URLs as sources to a notebook in one operation.",
    {
      notebookId: z.string().describe("The notebook ID"),
      urls: z.array(z.string().url()).describe("URLs to add"),
    },
    (params) =>
      withErrorHandling(async () => {
        const results = await client.sources.addUrls(
          params.notebookId,
          params.urls,
        );
        return { content: [jsonContent(results)] };
      }),
  );

  server.tool(
    "nlm_add_source_text",
    "Add pasted text as a source to a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      text: z.string().describe("Text content to add as a source"),
      title: z.string().optional().describe("Optional title for the source"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sources.addText(
          params.notebookId,
          params.text,
          params.title,
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_add_source_drive",
    "Add a Google Drive file (Docs, Slides, Sheets) as a source to a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      driveUrl: z.string().describe("Google Drive file URL"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sources.addDrive(
          params.notebookId,
          params.driveUrl,
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_list_sources",
    "List all sources in a notebook with their types and metadata.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const sources = await client.sources.listWithTypes(params.notebookId);
        return { content: [jsonContent(sources)] };
      }),
  );

  server.tool(
    "nlm_describe_source",
    "Get a detailed AI-generated description of a specific source.",
    {
      notebookId: z.string().describe("The notebook ID"),
      sourceId: z.string().describe("The source ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const description = await client.sources.describe(
          params.notebookId,
          params.sourceId,
        );
        return { content: [jsonContent(description)] };
      }),
  );

  server.tool(
    "nlm_get_source_content",
    "Get the raw text content of a source.",
    {
      notebookId: z.string().describe("The notebook ID"),
      sourceId: z.string().describe("The source ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const content = await client.sources.getContent(
          params.notebookId,
          params.sourceId,
        );
        return { content: [jsonContent(content)] };
      }),
  );

  server.tool(
    "nlm_rename_source",
    "Rename a source in a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      sourceId: z.string().describe("The source ID"),
      name: z.string().describe("New name for the source"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.sources.rename(
          params.notebookId,
          params.sourceId,
          params.name,
        );
        return {
          content: [
            jsonContent({
              success: true,
              message: `Source renamed to '${params.name}'`,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_delete_sources",
    "Delete one or more sources from a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      sourceIds: z
        .array(z.string())
        .describe("Source IDs to delete"),
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
        await client.sources.delete(params.notebookId, params.sourceIds);
        return {
          content: [
            jsonContent({
              success: true,
              message: `Deleted ${params.sourceIds.length} source(s)`,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_sync_drive_sources",
    "Sync all Google Drive sources in a notebook to pick up external changes.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.sources.syncDrive(params.notebookId);
        return { content: [jsonContent(result)] };
      }),
  );
}
