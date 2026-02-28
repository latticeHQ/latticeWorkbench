/**
 * MCP tool registrations for note operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerNoteTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_create_note",
    "Create a new note in a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      content: z.string().describe("Note content (text or markdown)"),
      title: z.string().optional().describe("Note title"),
    },
    (params) =>
      withErrorHandling(async () => {
        const note = await client.notes.create(
          params.notebookId,
          params.content,
          params.title,
        );
        return { content: [jsonContent(note)] };
      }),
  );

  server.tool(
    "nlm_list_notes",
    "List all notes in a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const notes = await client.notes.list(params.notebookId);
        return { content: [jsonContent(notes)] };
      }),
  );

  server.tool(
    "nlm_update_note",
    "Update an existing note's content and/or title.",
    {
      noteId: z.string().describe("The note ID"),
      content: z.string().describe("New content for the note"),
      title: z.string().optional().describe("New title for the note"),
      notebookId: z
        .string()
        .optional()
        .describe("The notebook ID (required for some operations)"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.notes.update(
          params.noteId,
          params.content,
          params.title,
          params.notebookId,
        );
        return {
          content: [
            jsonContent({ success: true, message: "Note updated" }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_delete_note",
    "Delete a note from a notebook.",
    {
      noteId: z.string().describe("The note ID to delete"),
      notebookId: z.string().optional().describe("The notebook ID"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
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
        await client.notes.delete(params.noteId, params.notebookId);
        return {
          content: [
            jsonContent({ success: true, message: "Note deleted" }),
          ],
        };
      }),
  );
}
