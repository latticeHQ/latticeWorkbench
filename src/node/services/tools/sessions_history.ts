/**
 * sessions_history tool — lets PM Chat read the current screen output of a terminal session.
 *
 * Retrieves the serialized screen state from the headless xterm instance and strips ANSI
 * escape sequences to produce clean, human-readable output for the LLM to reason about.
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";

/** Default number of lines to return from the end of screen output */
const DEFAULT_MAX_LINES = 80;

/**
 * Strip ANSI/VT100 escape sequences from a string to produce plain text.
 * Handles CSI sequences, OSC sequences, C0 control chars, and charset designations.
 */
function stripAnsi(raw: string): string {
  return (
    raw
      // CSI sequences: ESC [ ... <final-byte>
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;?=!]*[A-Za-z]/g, "")
      // OSC sequences: ESC ] ... BEL or ST
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // DCS / PM / APC / SOS sequences: ESC P/X/^ ... ST
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[P^_][^\x1b]*\x1b\\/g, "")
      // Remaining two-char escape sequences (SS2, SS3, charset designations, etc.)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[()][AB0-2]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b[NOPQRSTUVWXYZ\\[\]^_]/g, "")
      // Non-printable C0 control characters (except \t, \n, \r which are whitespace)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g, "")
  );
}

export const createSessionsHistoryTool: ToolFactory = (config) => {
  return tool({
    description: TOOL_DEFINITIONS.sessions_history.description,
    inputSchema: TOOL_DEFINITIONS.sessions_history.schema,
    execute: async ({ sessionId, maxLines }) => {
      if (!config.terminalService) {
        return {
          success: false as const,
          error: "Terminal service unavailable in this workspace",
        };
      }

      const raw = config.terminalService.getScreenState(sessionId);

      if (!raw) {
        // Session might exist but have no output yet, or be closed
        const meta = config.terminalService.getSessionMeta(sessionId);
        if (!meta) {
          return {
            success: false as const,
            error: `Session "${sessionId}" not found. Use sessions_list to get valid session IDs.`,
          };
        }
        return {
          success: true as const,
          sessionId,
          label: meta.label,
          output: "",
          linesReturned: 0,
          totalLines: 0,
          hint: "Session exists but has produced no output yet.",
        };
      }

      const clean = stripAnsi(raw);

      // Split into lines, remove completely blank trailing lines for cleaner output
      const allLines = clean.split("\n");
      const trimmedLines = allLines;

      const limit = maxLines ?? DEFAULT_MAX_LINES;
      const startIdx = Math.max(0, trimmedLines.length - limit);
      const returnedLines = trimmedLines.slice(startIdx);

      const meta = config.terminalService.getSessionMeta(sessionId);

      return {
        success: true as const,
        sessionId,
        label: meta?.label ?? "Terminal",
        slug: meta?.slug ?? "terminal",
        output: returnedLines.join("\n"),
        linesReturned: returnedLines.length,
        totalLines: allLines.length,
        ...(allLines.length > limit
          ? { truncated: true, hint: `Showing last ${limit} of ${allLines.length} lines.` }
          : {}),
      };
    },
  });
};
