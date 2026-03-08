import { tool } from "ai";
import type { ParallelExtractToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_EXTRACT_TIMEOUT_MS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelExtractTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_extract.description,
    inputSchema: TOOL_DEFINITIONS.parallel_extract.schema,
    execute: async ({ urls }): Promise<ParallelExtractToolResult> => {
      const apiKey = config.secrets?.PARALLEL_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error:
            "PARALLEL_API_KEY secret is not configured. " +
            "Go to Settings → Integrations to add your Parallel AI API key.",
        };
      }

      try {
        const { Parallel } = await import("parallel-web");
        const client = new Parallel({ apiKey });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PARALLEL_EXTRACT_TIMEOUT_MS);

        try {
          const response = await client.beta.extract(
            {
              urls,
              full_content: true,
            },
            { signal: controller.signal }
          );

          const pages = response.results.map((r) => {
            let content = r.full_content ?? (r.excerpts ?? []).join("\n") ?? "";
            if (content.length > PARALLEL_MAX_OUTPUT_BYTES) {
              content = content.slice(0, PARALLEL_MAX_OUTPUT_BYTES) + "\n\n[Content truncated]";
            }
            return {
              url: r.url,
              title: r.title ?? "Untitled",
              content,
            };
          });

          // Report any extraction errors
          if (response.errors.length > 0 && pages.length === 0) {
            const errorMessages = response.errors
              .map((e) => `${e.url}: ${e.error_type}`)
              .join("; ");
            return {
              success: false,
              error: `Failed to extract content: ${errorMessages}`,
            };
          }

          return {
            success: true,
            pages,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI extract failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
