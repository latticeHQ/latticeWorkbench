/**
 * Lattice SDK — Terminal operations (8 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function createTerminal(
  c: RouterClient<AppRouter>,
  minionId: string,
  opts?: {
    cols?: number;
    rows?: number;
    initialCommand?: string;
    /** Terminal profile ID to launch (e.g. 'claude-code', 'gemini-cli', 'aider') */
    profileId?: string;
    /** Explicit command (overrides profileId resolution) */
    profileCommand?: string;
    /** Arguments for the profile command */
    profileArgs?: string[];
    /** Additional env vars for the profile */
    profileEnv?: Record<string, string>;
  }
) {
  return c.terminal.create({
    minionId,
    cols: opts?.cols ?? 120,
    rows: opts?.rows ?? 30,
    initialCommand: opts?.initialCommand,
    profileId: opts?.profileId,
    profileCommand: opts?.profileCommand,
    profileArgs: opts?.profileArgs,
    profileEnv: opts?.profileEnv,
  });
}

export async function sendInput(c: RouterClient<AppRouter>, sessionId: string, data: string) {
  return c.terminal.sendInput({ sessionId, data });
}

export async function closeTerminal(c: RouterClient<AppRouter>, sessionId: string) {
  return c.terminal.close({ sessionId });
}

export async function listSessions(c: RouterClient<AppRouter>, minionId: string) {
  return c.terminal.listSessions({ minionId });
}

export async function resizeTerminal(c: RouterClient<AppRouter>, sessionId: string, cols: number, rows: number) {
  return c.terminal.resize({ sessionId, cols, rows });
}

export async function openNative(c: RouterClient<AppRouter>, minionId: string) {
  return c.terminal.openNative({ minionId });
}

export async function openWindow(c: RouterClient<AppRouter>, minionId: string, sessionId?: string) {
  return c.terminal.openWindow({ minionId, sessionId });
}

export async function closeWindow(c: RouterClient<AppRouter>, minionId: string) {
  return c.terminal.closeWindow({ minionId });
}
