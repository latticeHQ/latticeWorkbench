import { tool } from "ai";
import type { ParallelSearchToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_SEARCH_TIMEOUT_MS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelSearchTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_search.description,
    inputSchema: TOOL_DEFINITIONS.parallel_search.schema,
    execute: async ({ query, num_results }): Promise<ParallelSearchToolResult> => {
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
        const timeout = setTimeout(() => controller.abort(), PARALLEL_SEARCH_TIMEOUT_MS);

        try {
          const response = await client.beta.search(
            {
              objective: query,
              max_results: num_results ?? 10,
            },
            { signal: controller.signal }
          );

          const results = response.results.map((r) => ({
            url: r.url,
            title: r.title ?? "Untitled",
            excerpt: (r.excerpts ?? []).join("\n").slice(0, 2000) || "(no excerpt)",
          }));

          // Truncate total output if too large
          let output = JSON.stringify(results);
          if (output.length > PARALLEL_MAX_OUTPUT_BYTES) {
            // Trim results until under limit
            while (results.length > 1 && JSON.stringify(results).length > PARALLEL_MAX_OUTPUT_BYTES) {
              results.pop();
            }
          }

          return {
            success: true,
            results,
            query,
            total: response.results.length,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI search failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
