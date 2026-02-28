import { tool } from "ai";

import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TaskListToolResultSchema, TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";

import { toBashTaskId } from "./taskId";
import { parseToolResult, requireTaskService, requireMinionId } from "./toolUtils";

const DEFAULT_STATUSES = ["queued", "running", "awaiting_report"] as const;

export const createTaskListTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.task_list.description,
    inputSchema: TOOL_DEFINITIONS.task_list.schema,
    execute: async (args): Promise<unknown> => {
      const minionId = requireMinionId(config, "task_list");
      const taskService = requireTaskService(config, "task_list");

      const statuses =
        args.statuses && args.statuses.length > 0 ? args.statuses : [...DEFAULT_STATUSES];

      const agentTasks = taskService.listDescendantAgentTasks(minionId, { statuses });
      const tasks = [...agentTasks];

      if (config.backgroundProcessManager) {
        const depthByMinionId = new Map<string, number>();
        depthByMinionId.set(minionId, 0);
        for (const t of agentTasks) {
          depthByMinionId.set(t.taskId, t.depth);
        }

        const processes = await config.backgroundProcessManager.list();
        for (const proc of processes) {
          const inScope =
            proc.minionId === minionId ||
            (await taskService.isDescendantAgentTask(minionId, proc.minionId));
          if (!inScope) continue;

          const status = proc.status === "running" ? "running" : "reported";
          if (!statuses.includes(status)) continue;

          const parentDepth = depthByMinionId.get(proc.minionId) ?? 0;
          tasks.push({
            taskId: toBashTaskId(proc.id),
            status,
            parentMinionId: proc.minionId,
            title: proc.displayName ?? proc.id,
            createdAt: new Date(proc.startTime).toISOString(),
            depth: parentDepth + 1,
          });
        }
      }

      return parseToolResult(TaskListToolResultSchema, { tasks }, "task_list");
    },
  });
};
