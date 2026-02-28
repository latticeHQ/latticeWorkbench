/**
 * Source service — add, list, sync, and manage notebook sources.
 */

import type { BaseClient } from "../client/base";
import { RPC, SourceTypes, SOURCE_ADD_TIMEOUT } from "../client/constants";
import type { SourceInfo } from "../client/types";

export class SourceService {
  constructor(private readonly client: BaseClient) {}

  async addUrl(notebookId: string, url: string): Promise<unknown> {
    // YouTube URLs go in position 7, regular URLs in position 2
    const isYouTube = /youtube\.com|youtu\.be/i.test(url);
    const params: unknown[] = [notebookId];

    if (isYouTube) {
      // Positions 1-6: null, position 7: YouTube URL
      for (let i = 0; i < 6; i++) params.push(null);
      params.push(url);
    } else {
      params.push(null); // 1
      params.push(url);  // 2: regular URL
    }

    return this.client.rpcCall(RPC.ADD_SOURCE, params, {
      timeout: SOURCE_ADD_TIMEOUT,
    });
  }

  async addUrls(notebookId: string, urls: string[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const url of urls) {
      results.push(await this.addUrl(notebookId, url));
    }
    return results;
  }

  async addText(
    notebookId: string,
    text: string,
    title?: string,
  ): Promise<unknown> {
    const params: unknown[] = [notebookId];
    params.push([text, title ?? "Pasted text"]); // 1: text payload
    return this.client.rpcCall(RPC.ADD_SOURCE, params, {
      timeout: SOURCE_ADD_TIMEOUT,
    });
  }

  async addDrive(
    notebookId: string,
    documentId: string,
    title?: string,
    mimeType?: string,
  ): Promise<unknown> {
    const params: unknown[] = [notebookId];
    params.push(null); // 1
    params.push(null); // 2
    params.push(null); // 3
    params.push(null); // 4
    params.push([[documentId, null, title ?? "", mimeType ?? ""]]); // 5: Drive source
    return this.client.rpcCall(RPC.ADD_SOURCE, params, {
      timeout: SOURCE_ADD_TIMEOUT,
    });
  }

  async listWithTypes(notebookId: string): Promise<SourceInfo[]> {
    // Use get_notebook and parse source metadata from the sources array
    const result = await this.client.rpcCall(RPC.GET_NOTEBOOK, [
      notebookId, null, [2], null, 0,
    ]);

    if (!Array.isArray(result) || !Array.isArray(result[3])) return [];

    return (result[3] as unknown[][]).map((src) => {
      const typeCode = src[3] as number | undefined;
      return {
        id: src[0] as string,
        title: (src[4] as string) ?? "Untitled",
        type: typeCode != null ? SourceTypes.getName(typeCode) : "unknown",
        typeCode,
        driveDocId: (src[10] as string) ?? null,
        url: (src[9] as string) ?? null,
        canSync: false,
        processingStatus: src[15] === 2 ? "ready" : src[15] === 3 ? "error" : "processing",
      };
    });
  }

  async rename(
    notebookId: string,
    sourceId: string,
    newTitle: string,
  ): Promise<void> {
    await this.client.rpcCall(RPC.RENAME_SOURCE, [
      notebookId, sourceId, newTitle,
    ]);
  }

  async delete(sourceIds: string | string[]): Promise<void> {
    const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
    await this.client.rpcCall(RPC.DELETE_SOURCE, [ids]);
  }

  async describe(sourceId: string): Promise<{
    summary: string;
    keywords: string[];
  }> {
    const result = await this.client.rpcCall(RPC.GET_SOURCE_GUIDE, [sourceId]);

    if (!Array.isArray(result)) return { summary: "", keywords: [] };

    const summary = (result[0] as string) ?? "";
    const keywords: string[] = [];
    if (Array.isArray(result[1])) {
      for (const kw of result[1]) {
        if (typeof kw === "string") keywords.push(kw);
        else if (Array.isArray(kw) && typeof kw[0] === "string") {
          keywords.push(kw[0]);
        }
      }
    }
    return { summary, keywords };
  }

  async getContent(sourceId: string): Promise<{
    text: string;
    title: string;
  }> {
    const result = await this.client.rpcCall(RPC.GET_SOURCE, [sourceId]);

    if (!Array.isArray(result)) return { text: "", title: "" };

    return {
      text: (result[1] as string) ?? "",
      title: (result[4] as string) ?? "",
    };
  }

  async checkFreshness(sourceId: string): Promise<boolean> {
    const result = await this.client.rpcCall(RPC.CHECK_FRESHNESS, [sourceId]);
    // Returns freshness status — true if stale (needs sync)
    return Array.isArray(result) && result[0] === true;
  }

  async syncDrive(sourceId: string): Promise<void> {
    await this.client.rpcCall(RPC.SYNC_DRIVE, [sourceId]);
  }
}
