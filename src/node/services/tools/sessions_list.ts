/**
 * sessions_list tool — lets PM Chat enumerate all active terminal sessions in the workspace.
 *
 * Returns session IDs, agent slugs, labels, and creation timestamps so PM can discover
 * which agents are running before directing them with sessions_send or reading their
 * output with sessions_history.
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";

export const createSessionsListTool: ToolFactory = (config) => {
  return tool({
    description: TOOL_DEFINITIONS.sessions_list.description,
    inputSchema: TOOL_DEFINITIONS.sessions_list.schema,
    execute: async () => {
      if (!config.terminalService) {
        return {
          success: false as const,
          error: "Terminal service unavailable in this workspace",
        };
      }

      if (!config.workspaceId) {
        return {
          success: false as const,
          error: "Workspace ID is required to list sessions",
        };
      }

      const sessions = config.terminalService.listWorkspaceSessions(config.workspaceId);

      return {
        success: true as const,
        sessions,
        count: sessions.length,
        hint:
          sessions.length === 0
            ? "No active sessions. Use hire_employee to open an agent tab, or sessions_spawn for a background agent."
            : `${sessions.length} active session(s). Use sessions_history to read output, sessions_send to direct an agent.`,
      };
    },
  });
};
