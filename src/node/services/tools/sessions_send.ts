/**
 * sessions_send tool — lets PM Chat send text or commands to an active terminal session.
 *
 * PM Chat uses this to direct hired agents: passing prompts, answering their questions,
 * sending shell commands to terminal sessions, or providing follow-up instructions.
 * A newline is appended by default so the input is submitted immediately.
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";

export const createSessionsSendTool: ToolFactory = (config) => {
  return tool({
    description: TOOL_DEFINITIONS.sessions_send.description,
    inputSchema: TOOL_DEFINITIONS.sessions_send.schema,
    execute: async ({ sessionId, text, newline }) => {
      if (!config.terminalService) {
        return {
          success: false as const,
          error: "Terminal service unavailable in this workspace",
        };
      }

      // Validate session exists
      const meta = config.terminalService.getSessionMeta(sessionId);
      if (!meta) {
        return {
          success: false as const,
          error: `Session "${sessionId}" not found or has been closed. Use sessions_list to get valid session IDs.`,
        };
      }

      const appendNewline = newline !== false; // default: true
      const payload = appendNewline ? `${text}\n` : text;

      try {
        config.terminalService.sendInput(sessionId, payload);

        return {
          success: true as const,
          sessionId,
          label: meta.label,
          slug: meta.slug,
          sent: payload,
          hint: "Input delivered. Use sessions_history to read the agent's response.",
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
