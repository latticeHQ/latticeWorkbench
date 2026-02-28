/**
 * Task tools: create sidekick tasks for parallel agent orchestration.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, errorResponse, withErrorHandling } from "../utils";

export function registerTaskTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Create sidekick task ───────────────────────────────────────────────
  server.tool(
    "create_task",
    "Create a sidekick task for parallel agent orchestration. This spawns a new " +
      "agent task under a parent minion.\n\n" +
      "IMPORTANT: The task is queued and starts asynchronously. Use 'get_minion_activity' " +
      "and 'get_sidekick_transcript' to monitor progress.",
    {
      parentMinionId: z.string().describe("Parent minion ID that owns this task"),
      prompt: z.string().describe("The task prompt/instructions for the sidekick"),
      title: z.string().optional().describe("Human-readable title for the task"),
      agentId: z.string().optional().describe("Agent ID to use (e.g. 'lattice', 'auto')"),
      modelString: z.string().optional().describe("Model to use (e.g. 'claude-sonnet-4-20250514')"),
      thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional().describe("Thinking level"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.tasks.create({
          parentMinionId: params.parentMinionId,
          kind: "agent",
          prompt: params.prompt,
          title: params.title,
          agentId: params.agentId,
          modelString: params.modelString,
          thinkingLevel: params.thinkingLevel,
        } as Parameters<typeof client.tasks.create>[0]);
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to create task");
          return errorResponse(errMsg);
        }
        return {
          content: [
            jsonContent({
              message: "Task created successfully",
              taskId: result.data.taskId,
              hint: "Use 'get_sidekick_transcript' to read the task's chat history.",
            }),
          ],
        };
      })
  );
}
