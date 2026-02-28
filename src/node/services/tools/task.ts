import { tool } from "ai";

import { coerceThinkingLevel } from "@/common/types/thinking";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TaskToolResultSchema, TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import type { TaskCreatedEvent } from "@/common/types/stream";
import { log } from "@/node/services/log";

import { parseToolResult, requireTaskService, requireMinionId } from "./toolUtils";
import { getErrorMessage } from "@/common/utils/errors";

/**
 * Build dynamic task tool description with available sidekicks.
 * Injects the list of available sidekicks directly into the tool description
 * so the model sees them adjacent to the tool call schema.
 */
function buildTaskDescription(config: ToolConfiguration): string {
  const baseDescription = TOOL_DEFINITIONS.task.description;
  const sidekicks = config.availableSidekicks?.filter((a) => a.sidekickRunnable) ?? [];

  if (sidekicks.length === 0) {
    return baseDescription;
  }

  const sidekickLines = sidekicks.map((agent) => {
    const desc = agent.description ? `: ${agent.description}` : "";
    return `- ${agent.id}${desc}`;
  });

  return `${baseDescription}\n\nAvailable sub-agents (use \`agentId\` parameter):\n${sidekickLines.join("\n")}`;
}

export const createTaskTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: buildTaskDescription(config),
    inputSchema: TOOL_DEFINITIONS.task.schema,
    execute: async (args, { abortSignal, toolCallId }): Promise<unknown> => {
      // Defensive: tool() should have already validated args via inputSchema,
      // but keep runtime validation here to preserve type-safety.
      const parsedArgs = TOOL_DEFINITIONS.task.schema.safeParse(args);
      if (!parsedArgs.success) {
        const keys =
          args && typeof args === "object" ? Object.keys(args as Record<string, unknown>) : [];
        log.warn(
          "[task tool] Unexpected input validation failure (should have been caught by AI SDK)",
          {
            issues: parsedArgs.error.issues,
            keys,
          }
        );
        throw new Error(`task tool input validation failed: ${parsedArgs.error.message}`);
      }
      const validatedArgs = parsedArgs.data;
      if (abortSignal?.aborted) {
        throw new Error("Interrupted");
      }

      const { agentId, sidekick_type, prompt, title, run_in_background } = validatedArgs;
      const requestedAgentId =
        typeof agentId === "string" && agentId.trim().length > 0 ? agentId : sidekick_type;
      if (!requestedAgentId || !prompt || !title) {
        throw new Error("task tool input validation failed: expected agent task args");
      }

      const minionId = requireMinionId(config, "task");
      const taskService = requireTaskService(config, "task");

      // Nested task spawning is allowed and enforced via maxTaskNestingDepth in TaskService
      // (and by tool policy at/over the depth limit).

      // Plan agent is explicitly non-executing. Allow only read-only exploration tasks.
      if (config.planFileOnly && requestedAgentId !== "explore") {
        throw new Error('In the plan agent you may only spawn agentId: "explore" tasks.');
      }

      const modelString =
        config.latticeEnv && typeof config.latticeEnv.LATTICE_MODEL_STRING === "string"
          ? config.latticeEnv.LATTICE_MODEL_STRING
          : undefined;
      const thinkingLevel = coerceThinkingLevel(config.latticeEnv?.LATTICE_THINKING_LEVEL);

      const created = await taskService.create({
        parentMinionId: minionId,
        kind: "agent",
        agentId: requestedAgentId,
        // Legacy alias (persisted for older clients / on-disk compatibility).
        agentType: requestedAgentId,
        prompt,
        title,
        modelString,
        thinkingLevel,
        experiments: config.experiments,
      });

      if (!created.success) {
        throw new Error(created.error);
      }

      const taskId = created.data.taskId;

      // UI-only signal: expose the spawned taskId as soon as the minion exists.
      // This allows the frontend to show the taskId even when the task tool is running
      // in foreground (run_in_background=false).
      if (config.emitChatEvent && config.minionId && toolCallId) {
        config.emitChatEvent({
          type: "task-created",
          minionId,
          toolCallId,
          taskId,
          timestamp: Date.now(),
        } satisfies TaskCreatedEvent);
      }

      if (run_in_background) {
        return parseToolResult(
          TaskToolResultSchema,
          {
            status: created.data.status,
            taskId,
            note: "Task started in background. Use task_await to monitor progress.",
          },
          "task"
        );
      }

      try {
        const report = await taskService.waitForAgentReport(taskId, {
          abortSignal,
          requestingMinionId: minionId,
        });

        return parseToolResult(
          TaskToolResultSchema,
          {
            status: "completed" as const,
            taskId,
            reportMarkdown: report.reportMarkdown,
            title: report.title,
            agentId: requestedAgentId,
            agentType: requestedAgentId,
          },
          "task"
        );
      } catch (error: unknown) {
        if (abortSignal?.aborted) {
          throw new Error("Interrupted");
        }

        const message = getErrorMessage(error);
        if (message === "Timed out waiting for agent_report") {
          const currentStatus = taskService.getAgentTaskStatus(taskId) ?? created.data.status;
          const normalizedStatus = currentStatus === "queued" ? "queued" : "running";

          return parseToolResult(
            TaskToolResultSchema,
            {
              status: normalizedStatus,
              taskId,
              note: "Task exceeded foreground wait limit and continues running in background. Use task_await to monitor progress.",
            },
            "task"
          );
        }

        throw error;
      }
    },
  });
};
