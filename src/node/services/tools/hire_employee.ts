/**
 * hire_employee tool — lets PM Chat spin up a CLI agent tab directly.
 *
 * When the LLM calls hire_employee({ slug: "claude-code" }), this tool:
 * 1. Resolves the display name + binary from CLI_AGENT_DEFINITIONS
 * 2. Creates a terminal session via TerminalService with slug + label metadata
 * 3. TerminalService emits a sessionCreated event (workspace-scoped)
 * 4. The browser's onEmployeeHired ORPC subscription picks it up and opens the tab
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";

/** Default terminal dimensions used when creating employee sessions */
const EMPLOYEE_TERMINAL_COLS = 80;
const EMPLOYEE_TERMINAL_ROWS = 24;

export const createHireEmployeeTool: ToolFactory = (config) => {
  return tool({
    description: TOOL_DEFINITIONS.hire_employee.description,
    inputSchema: TOOL_DEFINITIONS.hire_employee.schema,
    execute: async ({ slug }) => {
      if (!config.terminalService) {
        return {
          success: false as const,
          error: "Terminal service unavailable in this workspace",
        };
      }

      if (!config.workspaceId) {
        return {
          success: false as const,
          error: "Workspace ID is required to hire an employee",
        };
      }

      const agentDef = CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS];
      const isTerminal = slug === "terminal";
      const initialCommand = isTerminal ? undefined : (agentDef?.binaryNames[0] ?? slug);
      const label = isTerminal ? "Terminal" : (agentDef?.displayName ?? slug);

      try {
        const session = await config.terminalService.create({
          workspaceId: config.workspaceId,
          cols: EMPLOYEE_TERMINAL_COLS,
          rows: EMPLOYEE_TERMINAL_ROWS,
          initialCommand,
          slug,
          label,
          // Spawn the agent binary directly — no shell wrapper, so no echo/prompt visible
          directExec: !isTerminal,
        });

        return {
          success: true as const,
          sessionId: session.sessionId,
          label,
          message: `${label} is now running in a new tab (session ${session.sessionId}).`,
        };
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
};
