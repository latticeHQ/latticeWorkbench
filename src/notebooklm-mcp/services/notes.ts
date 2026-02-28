/**
 * Note service — create, list, update, and delete notes within notebooks.
 */

import type { BaseClient } from "../client/base";
import { RPC } from "../client/constants";
import type { Note } from "../client/types";

export class NoteService {
  constructor(private readonly client: BaseClient) {}

  async create(
    notebookId: string,
    content: string,
    title?: string,
  ): Promise<Note> {
    // Create note uses SAVE_MIND_MAP RPC with note-specific params
    const result = await this.client.rpcCall(RPC.CREATE_NOTE, [
      notebookId,
      [null, content, null, null, title ?? ""],
    ]);

    const noteId = Array.isArray(result) ? (result[0] as string) ?? "" : "";

    // Update content if provided (create may not set it fully)
    if (noteId && content) {
      await this.update(noteId, content, title, notebookId);
    }

    return {
      id: noteId,
      title: title ?? "",
      content,
      notebookId,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
  }

  async list(notebookId: string): Promise<Note[]> {
    const result = await this.client.rpcCall(RPC.GET_NOTES, [notebookId]);

    if (!Array.isArray(result)) return [];

    const notes: Note[] = [];
    const entries = Array.isArray(result[0]) ? result[0] : result;

    for (const entry of entries as unknown[][]) {
      if (!Array.isArray(entry)) continue;

      // Filter out deleted items and mind maps
      // Notes have a specific structure; mind maps differ
      const id = entry[0] as string;
      const content = entry[1] as string | unknown[];

      // Skip if content is a complex mind map structure (not plain text)
      if (typeof content !== "string" && !Array.isArray(content)) continue;

      notes.push({
        id,
        title: (entry[2] as string) ?? "",
        content: typeof content === "string" ? content : "",
        notebookId,
        createdAt: null,
        modifiedAt: null,
      });
    }

    return notes;
  }

  async update(
    noteId: string,
    content: string,
    title?: string,
    notebookId?: string,
  ): Promise<void> {
    await this.client.rpcCall(RPC.UPDATE_NOTE, [
      noteId, content, title ?? null, notebookId ?? null,
    ]);
  }

  async delete(noteId: string, notebookId?: string): Promise<void> {
    await this.client.rpcCall(RPC.DELETE_NOTE, [
      noteId, notebookId ?? null,
    ]);
  }
}
