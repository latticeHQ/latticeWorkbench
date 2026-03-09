import { tool } from "ai";
import type { ParallelBatchToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_BATCH_TIMEOUT_MS,
  PARALLEL_BATCH_POLL_INTERVAL_MS,
  PARALLEL_BATCH_MAX_POLLS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelBatchTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_batch.description,
    inputSchema: TOOL_DEFINITIONS.parallel_batch.schema,
    execute: async ({
      items,
      processor,
      output_schema,
    }): Promise<ParallelBatchToolResult> => {
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
        const timeout = setTimeout(() => controller.abort(), PARALLEL_BATCH_TIMEOUT_MS);

        try {
          // Step 1: Create task group
          const group = await client.beta.taskGroup.create(
            {} as any,
            { signal: controller.signal }
          );

          const groupId =
            (group as any).taskgroup_id ??
            (group as any).group_id ??
            (group as any).id;

          if (!groupId) {
            return { success: false, error: "Task group did not return an ID" };
          }

          // Step 2: Add all items as runs
          const defaultTaskSpec: Record<string, unknown> = {};
          if (output_schema != null) {
            defaultTaskSpec.output_schema = {
              type: "json",
              json_schema: { description: output_schema },
            };
          }

          const inputs = items.map((item) => ({
            input: item,
            processor: processor ?? "base",
          }));

          await client.beta.taskGroup.addRuns(
            groupId,
            {
              inputs,
              ...(Object.keys(defaultTaskSpec).length > 0
                ? { default_task_spec: defaultTaskSpec }
                : {}),
            } as any,
            { signal: controller.signal }
          );

          // Step 3: Poll until complete
          let isActive = true;
          let polls = 0;
          while (isActive && polls < PARALLEL_BATCH_MAX_POLLS) {
            if (controller.signal.aborted) break;
            await new Promise((resolve) =>
              setTimeout(resolve, PARALLEL_BATCH_POLL_INTERVAL_MS)
            );
            const pollResponse = await client.beta.taskGroup.retrieve(groupId, {
              signal: controller.signal,
            });
            const status = (pollResponse as any).status;
            isActive =
              status?.is_active ??
              (typeof status === "string"
                ? status !== "completed" && status !== "failed"
                : true);
            polls++;
          }

          // Step 4: Get results — use getRuns stream
          const runsResponse = await client.beta.taskGroup.getRuns(
            groupId,
            { include_output: true } as any,
            { signal: controller.signal }
          );

          // Parse results — runsResponse may be a stream or array
          const rawRuns: any[] = [];
          if (Symbol.asyncIterator in (runsResponse as any)) {
            for await (const chunk of runsResponse as any) {
              rawRuns.push(chunk);
            }
          } else if (Array.isArray((runsResponse as any).runs)) {
            rawRuns.push(...(runsResponse as any).runs);
          } else if (Array.isArray(runsResponse)) {
            rawRuns.push(...runsResponse);
          }

          const results = rawRuns.map((run: any) => {
            const output =
              run.output?.type === "text"
                ? run.output.content
                : JSON.stringify(run.output?.content ?? run.output ?? "");
            const sources: string[] = [];
            if (run.output?.basis) {
              for (const b of run.output.basis) {
                if (b.citations) {
                  for (const c of b.citations) {
                    if (c.url && !sources.includes(c.url)) sources.push(c.url);
                  }
                }
              }
            }
            return {
              input: typeof run.input === "string" ? run.input : JSON.stringify(run.input ?? ""),
              output,
              sources: sources.length > 0 ? sources : undefined,
            };
          });

          // Truncate total output if too large
          let serialized = JSON.stringify(results);
          const truncated = [...results];
          while (truncated.length > 1 && serialized.length > PARALLEL_MAX_OUTPUT_BYTES) {
            truncated.pop();
            serialized = JSON.stringify(truncated);
          }

          return {
            success: true,
            results: truncated,
            total: rawRuns.length,
            completed: truncated.length,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI Batch failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
