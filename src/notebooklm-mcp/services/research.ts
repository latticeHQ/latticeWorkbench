/**
 * Research service — start, poll, and import research results.
 */

import type { BaseClient } from "../client/base";
import { RPC, ResearchSources, ResearchModes, ResultTypes } from "../client/constants";
import type { ResearchResult, ResearchStatus } from "../client/types";

export class ResearchService {
  constructor(private readonly client: BaseClient) {}

  async start(
    notebookId: string,
    query: string,
    opts?: {
      source?: string;
      mode?: string;
    },
  ): Promise<{ taskId: string }> {
    const sourceCode = opts?.source ? ResearchSources.getCode(opts.source) : ResearchSources.getCode("web");
    const modeCode = opts?.mode ? ResearchModes.getCode(opts.mode) : ResearchModes.getCode("fast");

    const rpcId = modeCode === ResearchModes.getCode("deep")
      ? RPC.START_DEEP_RESEARCH
      : RPC.START_FAST_RESEARCH;

    const params: unknown[] = [notebookId, query, sourceCode];
    const result = await this.client.rpcCall(rpcId, params);

    // Extract task ID from result
    let taskId = "";
    if (Array.isArray(result) && typeof result[0] === "string") {
      taskId = result[0];
    } else if (typeof result === "string") {
      taskId = result;
    }

    return { taskId };
  }

  async getStatus(
    notebookId: string,
    taskId?: string,
    query?: string,
  ): Promise<ResearchStatus> {
    const result = await this.client.rpcCall(RPC.POLL_RESEARCH, [notebookId]);

    if (!Array.isArray(result)) {
      return {
        taskId: taskId ?? "",
        status: "unknown",
        query: query ?? "",
        results: [],
        report: null,
      };
    }

    // Find matching task
    const tasks = Array.isArray(result[0]) ? result[0] : [result];
    let matchedTask: unknown[] | null = null;

    for (const task of tasks) {
      if (!Array.isArray(task)) continue;
      if (taskId && task[0] === taskId) {
        matchedTask = task;
        break;
      }
      if (query && typeof task[1] === "string" && task[1].includes(query)) {
        matchedTask = task;
        break;
      }
    }

    if (!matchedTask) matchedTask = tasks[0] as unknown[] ?? [];

    // Parse results
    const results: ResearchResult[] = [];
    if (Array.isArray(matchedTask[3])) {
      for (const r of matchedTask[3] as unknown[][]) {
        if (!Array.isArray(r)) continue;
        const typeCode = r[3] as number | undefined;
        results.push({
          id: (r[0] as string) ?? "",
          title: (r[1] as string) ?? "",
          url: (r[2] as string) ?? null,
          type: typeCode != null ? ResultTypes.getName(typeCode) : "unknown",
          typeCode,
          snippet: (r[4] as string) ?? "",
        });
      }
    }

    // Determine status
    const statusCode = matchedTask[2];
    let status = "unknown";
    if (statusCode === 1) status = "in_progress";
    else if (statusCode === 2) status = "complete";
    else if (statusCode === 3) status = "failed";

    return {
      taskId: (matchedTask[0] as string) ?? taskId ?? "",
      status,
      query: (matchedTask[1] as string) ?? query ?? "",
      results,
      report: Array.isArray(matchedTask[5]) ? (matchedTask[5][0] as string) ?? null : null,
    };
  }

  async importSources(
    notebookId: string,
    taskId: string,
    sourceIds: string[],
  ): Promise<void> {
    // Format sources based on type (web vs Drive)
    const formattedSources = sourceIds.map((id) => [id]);
    await this.client.rpcCall(RPC.IMPORT_RESEARCH, [
      notebookId, taskId, formattedSources,
    ]);
  }
}
