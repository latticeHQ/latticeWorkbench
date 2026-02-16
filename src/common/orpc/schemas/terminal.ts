import { z } from "zod";

export const TerminalSessionSchema = z.object({
  sessionId: z.string(),
  workspaceId: z.string(),
  cols: z.number(),
  rows: z.number(),
});

export const TerminalCreateParamsSchema = z.object({
  workspaceId: z.string(),
  cols: z.number(),
  rows: z.number(),
  /** Optional command to run immediately after terminal creation */
  initialCommand: z.string().optional(),
  /** Employee agent slug (e.g. "claude-code"). When set, signals this is an AI-hired employee session. */
  slug: z.string().optional(),
  /** Display label for the employee tab (e.g. "Claude Code"). */
  label: z.string().optional(),
  /** When true, spawn the initialCommand binary directly as the PTY process (no shell wrapper) */
  directExec: z.boolean().optional(),
  /** When true, suppress the sessionCreated workspace event — session runs without opening a browser tab */
  noTab: z.boolean().optional(),
});

export const TerminalResizeParamsSchema = z.object({
  sessionId: z.string(),
  cols: z.number(),
  rows: z.number(),
});
