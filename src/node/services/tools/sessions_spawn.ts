/**
 * sessions_spawn tool — lets PM Chat spawn a background AI agent without opening a visible tab.
 *
 * Unlike hire_employee (which opens a browser tab), sessions_spawn creates a background
 * worker session. PM Chat can then monitor it via sessions_history and direct it via
 * sessions_send. Useful for parallel autonomous tasks that don't need a visible terminal.
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";

/** Terminal dimensions for background worker sessions — wider for agent UIs */
const SPAWN_COLS = 220;
const SPAWN_ROWS = 50;

/** Delay in ms before sending the initial prompt, allowing the agent UI to initialise */
const AGENT_STARTUP_DELAY_MS = 1500;

export const createSessionsSpawnTool: ToolFactory = (config) => {
  return tool({
    description: TOOL_DEFINITIONS.sessions_spawn.description,
    inputSchema: TOOL_DEFINITIONS.sessions_spawn.schema,
    execute: async ({ slug, initialPrompt }) => {
      if (!config.terminalService) {
        return {
          success: false as const,
          error: "Terminal service unavailable in this workspace",
        };
      }

      if (!config.workspaceId) {
        return {
          success: false as const,
          error: "Workspace ID is required to spawn a session",
        };
      }

      const agentDef = CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS];
      const isTerminal = slug === "terminal";
      const initialCommand = isTerminal ? undefined : (agentDef?.binaryNames[0] ?? slug);
      const label = isTerminal ? "Terminal" : (agentDef?.displayName ?? slug);

      try {
        const session = await config.terminalService.create({
          workspaceId: config.workspaceId,
          cols: SPAWN_COLS,
          rows: SPAWN_ROWS,
          initialCommand,
          slug,
          label,
          // Spawn the agent binary directly — no shell prompt or echo artifacts
          directExec: !isTerminal,
          // Background session — suppress browser tab opening
          noTab: true,
        });

        if (initialPrompt) {
          // Give the agent UI a moment to initialise before delivering the first prompt
          await new Promise<void>((resolve) => setTimeout(resolve, AGENT_STARTUP_DELAY_MS));
          config.terminalService.sendInput(session.sessionId, `${initialPrompt}\n`);
        }

        return {
          success: true as const,
          sessionId: session.sessionId,
          label,
          slug,
          message:
            `${label} is running in the background (session ${session.sessionId}).` +
            " Use sessions_history to read its output, sessions_send to direct it.",
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
