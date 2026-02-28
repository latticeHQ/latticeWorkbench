/**
 * Terminal session types
 */

import type { z } from "zod";
import type {
  TerminalCreateParamsSchema,
  TerminalResizeParamsSchema,
  TerminalSessionSchema,
} from "../orpc/schemas";

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;
export type TerminalCreateParams = z.infer<typeof TerminalCreateParamsSchema>;
export type TerminalResizeParams = z.infer<typeof TerminalResizeParamsSchema>;

// ---------------------------------------------------------------------------
// Persistence — survives app restarts until user explicitly closes a terminal
// ---------------------------------------------------------------------------

/** Single terminal session serialized to disk on shutdown. */
export interface PersistedTerminalSession {
  sessionId: string;
  minionId: string;
  /** Serialized screen buffer from xterm SerializeAddon (~4KB typical). */
  screenBuffer: string;
  cols: number;
  rows: number;
  /** Profile info for non-default-shell terminals (re-applied on restore). */
  profileId?: string;
  profileCommand?: string;
  profileArgs?: string[];
  profileEnv?: Record<string, string>;
}

/**
 * Root shape of `~/.lattice/sessions/{minionId}/terminals.json`.
 * Version field allows future schema changes without breaking restore.
 */
export interface PersistedTerminalState {
  version: 1;
  sessions: PersistedTerminalSession[];
}
