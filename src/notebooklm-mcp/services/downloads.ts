/**
 * Download service — download studio artifacts (audio, video, etc.).
 *
 * NotebookLM serves artifacts via authenticated URLs. This service
 * fetches the binary content using the client's cookie-based auth.
 */

import type { BaseClient } from "../client/base";
import { RPC, BASE_URL } from "../client/constants";

export interface DownloadResult {
  data: ArrayBuffer;
  contentType: string;
  filename: string;
}

export class DownloadService {
  constructor(private readonly client: BaseClient) {}

  /**
   * Download a studio artifact by its ID.
   * Polls studio status to find the artifact's download URL, then fetches.
   */
  async download(
    notebookId: string,
    artifactId: string,
  ): Promise<DownloadResult> {
    // Poll studio to find the artifact URL
    const status = await this.client.rpcCall(RPC.POLL_STUDIO, [notebookId]);

    let downloadUrl: string | null = null;
    let artifactType = "unknown";

    if (Array.isArray(status)) {
      // Walk the nested structure looking for the matching artifact ID
      const findUrl = (arr: unknown[]): void => {
        for (const item of arr) {
          if (Array.isArray(item)) {
            if (item[0] === artifactId && typeof item[3] === "string") {
              downloadUrl = item[3] as string;
              return;
            }
            findUrl(item);
          }
        }
      };
      findUrl(status);

      // Try to extract artifact type
      if (Array.isArray(status[0])) {
        for (const entry of status[0] as unknown[][]) {
          if (Array.isArray(entry) && entry[0] === artifactId) {
            artifactType = typeof entry[4] === "string" ? (entry[4] as string) : "artifact";
          }
        }
      }
    }

    if (!downloadUrl) {
      throw new Error(
        `No download URL found for artifact '${artifactId}' in notebook '${notebookId}'. ` +
        `The artifact may still be generating or may not exist.`,
      );
    }

    // Resolve relative URLs against NotebookLM base
    const fullUrl = downloadUrl.startsWith("http")
      ? downloadUrl
      : `${BASE_URL}${downloadUrl}`;

    const cookieHeader = this.client.getCookieHeader();
    const resp = await fetch(fullUrl, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!resp.ok) {
      throw new Error(
        `Download failed (${resp.status}): ${resp.statusText}`,
      );
    }

    const contentType = resp.headers.get("content-type") ?? "application/octet-stream";
    const contentDisposition = resp.headers.get("content-disposition") ?? "";
    const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
    const filename = filenameMatch?.[1] ?? `${artifactType}-${artifactId}`;

    const data = await resp.arrayBuffer();

    return { data, contentType, filename };
  }

  /**
   * Get the interactive HTML content for visual artifacts (infographics, slides, etc.).
   */
  async getInteractiveHtml(
    notebookId: string,
    artifactId: string,
  ): Promise<string> {
    const result = await this.client.rpcCall(RPC.GET_INTERACTIVE_HTML, [
      notebookId,
      artifactId,
    ]);

    if (typeof result === "string") return result;
    if (Array.isArray(result) && typeof result[0] === "string") return result[0] as string;

    throw new Error(`No HTML content available for artifact '${artifactId}'`);
  }
}
