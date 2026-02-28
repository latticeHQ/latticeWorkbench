import { z } from "zod";

export const TerminalSessionSchema = z.object({
  sessionId: z.string(),
  minionId: z.string(),
  cols: z.number(),
  rows: z.number(),
});

export const TerminalCreateParamsSchema = z.object({
  minionId: z.string(),
  cols: z.number(),
  rows: z.number(),
  /** Optional command to run immediately after terminal creation */
  initialCommand: z.string().optional(),
  /** Profile ID — resolves command/args from registry + user overrides */
  profileId: z.string().nullish(),
  /** Explicit profile command (overrides profileId resolution) */
  profileCommand: z.string().nullish(),
  /** Arguments for the profile command */
  profileArgs: z.array(z.string()).nullish(),
  /** Additional env vars from the profile */
  profileEnv: z.record(z.string(), z.string()).nullish(),
});

export const TerminalResizeParamsSchema = z.object({
  sessionId: z.string(),
  cols: z.number(),
  rows: z.number(),
});
