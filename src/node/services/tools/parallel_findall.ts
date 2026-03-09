import { tool } from "ai";
import type { ParallelFindAllToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_FINDALL_TIMEOUT_MS,
  PARALLEL_FINDALL_POLL_INTERVAL_MS,
  PARALLEL_FINDALL_MAX_POLLS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelFindAllTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_findall.description,
    inputSchema: TOOL_DEFINITIONS.parallel_findall.schema,
    execute: async ({
      objective,
      generator,
      match_limit,
    }): Promise<ParallelFindAllToolResult> => {
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
        const timeout = setTimeout(() => controller.abort(), PARALLEL_FINDALL_TIMEOUT_MS);

        try {
          // Step 1: Ingest — convert natural language to structured spec
          const schema = await client.beta.findall.ingest(
            { objective } as any,
            { signal: controller.signal }
          );

          // Step 2: Create — start the FindAll run
          const run = await client.beta.findall.create(
            {
              objective,
              entity_type: (schema as any).entity_type ?? "entity",
              match_conditions: (schema as any).match_conditions ?? [],
              generator: generator ?? "preview",
              match_limit: match_limit ?? 10,
            } as any,
            { signal: controller.signal }
          );

          const runId = (run as any).findall_id ?? (run as any).run_id ?? (run as any).id;
          if (!runId) {
            return { success: false, error: "FindAll run did not return an ID" };
          }

          // Step 3: Poll until completed
          let status = (run as any).status ?? "running";
          let polls = 0;
          while (
            status !== "completed" &&
            status !== "failed" &&
            status !== "cancelled" &&
            polls < PARALLEL_FINDALL_MAX_POLLS
          ) {
            if (controller.signal.aborted) break;
            await new Promise((resolve) =>
              setTimeout(resolve, PARALLEL_FINDALL_POLL_INTERVAL_MS)
            );
            const pollResponse = await client.beta.findall.retrieve(runId, undefined, {
              signal: controller.signal,
            });
            status = (pollResponse as any).status;
            polls++;
          }

          if (status === "failed") {
            return { success: false, error: "FindAll run failed" };
          }
          if (status !== "completed") {
            return {
              success: false,
              error: `FindAll run did not complete (status: ${status})`,
            };
          }

          // Step 4: Fetch results
          const resultResponse = await client.beta.findall.result(runId, undefined, {
            signal: controller.signal,
          });

          const rawCandidates = (resultResponse as any).candidates ?? [];
          const candidates = rawCandidates.map((c: any) => ({
            name: c.name ?? "Unknown",
            url: c.url,
            match_status: c.match_status,
            citations: c.citations
              ?.map((cit: any) => cit.url ?? cit)
              .filter(Boolean)
              .slice(0, 5),
          }));

          // Truncate if too large
          let output = JSON.stringify(candidates);
          const truncated = [...candidates];
          while (truncated.length > 1 && output.length > PARALLEL_MAX_OUTPUT_BYTES) {
            truncated.pop();
            output = JSON.stringify(truncated);
          }

          return {
            success: true,
            candidates: truncated,
            objective,
            total: rawCandidates.length,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI FindAll failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
