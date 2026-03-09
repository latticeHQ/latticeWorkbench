import { tool } from "ai";
import type { ParallelResearchToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_RESEARCH_TIMEOUT_MS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelResearchTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_research.description,
    inputSchema: TOOL_DEFINITIONS.parallel_research.schema,
    execute: async ({ query, processor, output_schema }): Promise<ParallelResearchToolResult> => {
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

        // Build optional task spec for structured output
        const taskSpec: Record<string, unknown> = {};
        if (output_schema != null) {
          taskSpec.output_schema = {
            type: "json",
            json_schema: { description: output_schema },
          };
        }

        // Create a task run for deep research
        const run = await client.taskRun.create({
          input: query,
          processor: processor ?? "research",
          ...(Object.keys(taskSpec).length > 0 ? { task_spec: taskSpec } : {}),
        } as any);

        // Poll for result with timeout
        const result = await client.taskRun.result(run.run_id, {
          timeout: Math.floor(PARALLEL_RESEARCH_TIMEOUT_MS / 1000),
        });

        // Extract report content
        let report: string;
        const sources: string[] = [];

        if (result.output.type === "text") {
          report = result.output.content;
          // Extract citation URLs from basis
          for (const basis of result.output.basis) {
            if (basis.citations) {
              for (const citation of basis.citations) {
                if (citation.url && !sources.includes(citation.url)) {
                  sources.push(citation.url);
                }
              }
            }
          }
        } else {
          // JSON output — stringify the content
          report = JSON.stringify(result.output.content, null, 2);
          for (const basis of result.output.basis) {
            if (basis.citations) {
              for (const citation of basis.citations) {
                if (citation.url && !sources.includes(citation.url)) {
                  sources.push(citation.url);
                }
              }
            }
          }
        }

        // Truncate if too large
        if (report.length > PARALLEL_MAX_OUTPUT_BYTES) {
          report = report.slice(0, PARALLEL_MAX_OUTPUT_BYTES) + "\n\n[Report truncated]";
        }

        return {
          success: true,
          report,
          sources: sources.length > 0 ? sources : undefined,
        };
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI research failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
