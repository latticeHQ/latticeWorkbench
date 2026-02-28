/**
 * MCP tool registrations for download operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerDownloadTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_download_artifact",
    "Download a studio artifact (audio, video, etc.) and return metadata about the download. The binary data is saved to the specified output directory.",
    {
      notebookId: z.string().describe("The notebook ID"),
      artifactId: z.string().describe("The artifact ID to download"),
      outputDir: z
        .string()
        .optional()
        .describe("Directory to save the file (default: current directory)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.downloads.download(
          params.notebookId,
          params.artifactId,
        );

        // Write to disk if outputDir is provided
        const outputDir = params.outputDir ?? ".";
        const outputPath = `${outputDir}/${result.filename}`;

        const { writeFile, mkdir } = await import("node:fs/promises");
        await mkdir(outputDir, { recursive: true });
        await writeFile(outputPath, Buffer.from(result.data));

        return {
          content: [
            jsonContent({
              success: true,
              filename: result.filename,
              contentType: result.contentType,
              size: result.data.byteLength,
              path: outputPath,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_get_interactive_html",
    "Get the interactive HTML content for a visual artifact (infographic, slide deck, etc.). Returns the raw HTML that can be rendered in a browser.",
    {
      notebookId: z.string().describe("The notebook ID"),
      artifactId: z.string().describe("The artifact ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const html = await client.downloads.getInteractiveHtml(
          params.notebookId,
          params.artifactId,
        );
        return {
          content: [
            jsonContent({
              html,
              length: html.length,
            }),
          ],
        };
      }),
  );
}
