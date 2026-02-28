/**
 * Export service — export studio artifacts to Google Docs or Sheets.
 */

import type { BaseClient } from "../client/base";
import { RPC, ExportTypes } from "../client/constants";

export interface ExportResult {
  /** URL of the created Google Doc or Sheet */
  url: string;
  /** Export format used (docs or sheets) */
  format: string;
}

export class ExportService {
  constructor(private readonly client: BaseClient) {}

  /**
   * Export a studio artifact to Google Docs.
   */
  async toDocs(
    notebookId: string,
    artifactId: string,
  ): Promise<ExportResult> {
    return this.export(notebookId, artifactId, "docs");
  }

  /**
   * Export a studio artifact to Google Sheets.
   */
  async toSheets(
    notebookId: string,
    artifactId: string,
  ): Promise<ExportResult> {
    return this.export(notebookId, artifactId, "sheets");
  }

  /**
   * Export a studio artifact to the given format.
   */
  private async export(
    notebookId: string,
    artifactId: string,
    format: string,
  ): Promise<ExportResult> {
    const formatCode = ExportTypes.getCode(format);

    const result = await this.client.rpcCall(RPC.EXPORT_ARTIFACT, [
      notebookId,
      artifactId,
      formatCode,
    ]);

    // Result should contain the URL of the exported document
    let url = "";
    if (typeof result === "string") {
      url = result;
    } else if (Array.isArray(result)) {
      // Navigate nested arrays to find the URL string
      const findUrl = (arr: unknown[]): string => {
        for (const item of arr) {
          if (typeof item === "string" && item.startsWith("http")) return item;
          if (Array.isArray(item)) {
            const found = findUrl(item);
            if (found) return found;
          }
        }
        return "";
      };
      url = findUrl(result);
    }

    if (!url) {
      throw new Error(
        `Export completed but no document URL was returned for artifact '${artifactId}'`,
      );
    }

    return { url, format };
  }
}
