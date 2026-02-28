/**
 * Notebook service — CRUD operations for NotebookLM notebooks.
 */

import type { BaseClient } from "../client/base";
import { RPC, OWNERSHIP_MINE, OWNERSHIP_SHARED } from "../client/constants";
import { type Notebook, parseTimestamp, notebookUrl } from "../client/types";

export class NotebookService {
  constructor(private readonly client: BaseClient) {}

  async list(): Promise<Notebook[]> {
    const result = await this.client.rpcCall(RPC.LIST_NOTEBOOKS, [
      null, 1, null, [2],
    ]);

    if (!Array.isArray(result) || !Array.isArray(result[0])) return [];

    return result[0].map((entry: unknown[]) => ({
      id: entry[0] as string,
      title: (entry[2] as string) ?? "Untitled",
      sourceCount: Array.isArray(entry[3]) ? (entry[3] as unknown[]).length : 0,
      sources: Array.isArray(entry[3]) ? (entry[3] as unknown[]) : [],
      isOwned: entry[9] === OWNERSHIP_MINE,
      isShared: entry[9] === OWNERSHIP_SHARED,
      createdAt: parseTimestamp(entry[7]),
      modifiedAt: parseTimestamp(entry[8]),
    }));
  }

  async get(notebookId: string): Promise<Notebook> {
    const result = await this.client.rpcCall(RPC.GET_NOTEBOOK, [
      notebookId, null, [2], null, 0,
    ]);

    if (!Array.isArray(result)) {
      throw new Error(`Notebook not found: ${notebookId}`);
    }

    return {
      id: result[0] as string,
      title: (result[2] as string) ?? "Untitled",
      sourceCount: Array.isArray(result[3]) ? (result[3] as unknown[]).length : 0,
      sources: Array.isArray(result[3]) ? (result[3] as unknown[]) : [],
      isOwned: result[9] === OWNERSHIP_MINE,
      isShared: result[9] === OWNERSHIP_SHARED,
      createdAt: parseTimestamp(result[7]),
      modifiedAt: parseTimestamp(result[8]),
    };
  }

  async describe(notebookId: string): Promise<{
    summary: string;
    suggestedTopics: string[];
  }> {
    const result = await this.client.rpcCall(RPC.GET_SUMMARY, [
      notebookId, [2],
    ]);

    if (!Array.isArray(result)) return { summary: "", suggestedTopics: [] };

    const summary = (result[0] as string) ?? "";
    const topics: string[] = [];
    if (Array.isArray(result[1])) {
      for (const topic of result[1]) {
        if (typeof topic === "string") topics.push(topic);
        else if (Array.isArray(topic) && typeof topic[0] === "string") {
          topics.push(topic[0]);
        }
      }
    }

    return { summary, suggestedTopics: topics };
  }

  async create(title?: string): Promise<Notebook> {
    const result = await this.client.rpcCall(RPC.CREATE_NOTEBOOK, []);

    if (!Array.isArray(result)) {
      throw new Error("Failed to create notebook");
    }

    const notebook: Notebook = {
      id: result[0] as string,
      title: title ?? "Untitled notebook",
      sourceCount: 0,
      sources: [],
      isOwned: true,
      isShared: false,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };

    // Rename if title provided
    if (title) {
      await this.rename(notebook.id, title);
      notebook.title = title;
    }

    return notebook;
  }

  async rename(notebookId: string, newTitle: string): Promise<void> {
    await this.client.rpcCall(RPC.RENAME_NOTEBOOK, [
      notebookId, newTitle,
    ]);
  }

  async delete(notebookId: string): Promise<void> {
    await this.client.rpcCall(RPC.DELETE_NOTEBOOK, [
      [notebookId], [2],
    ]);
  }

  async configureChat(
    notebookId: string,
    opts: {
      goal?: string;
      customPrompt?: string;
      responseLength?: string;
    },
  ): Promise<void> {
    // Chat config uses the rename RPC with extra params at position 7
    const { ChatGoals, ChatResponseLengths } = await import("../client/constants");
    const goalCode = opts.goal ? ChatGoals.getCode(opts.goal) : undefined;
    const lengthCode = opts.responseLength
      ? ChatResponseLengths.getCode(opts.responseLength)
      : undefined;

    const params: unknown[] = [notebookId, null];
    // Fill positions 2-6 with null
    for (let i = 0; i < 5; i++) params.push(null);
    // Position 7: chat settings
    params.push([goalCode ?? null, opts.customPrompt ?? null, lengthCode ?? null]);

    await this.client.rpcCall(RPC.RENAME_NOTEBOOK, params);
  }
}
