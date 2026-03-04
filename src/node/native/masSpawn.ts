/**
 * Process spawning wrapper.
 *
 * On non-MAS builds: delegates to child_process.spawn (zero overhead).
 * On MAS builds: all spawning (terminal, MCP servers, bash) goes through
 * SSH runtime — this function is never called because the local runtime
 * is disabled. If somehow called on MAS, falls back to spawn with
 * detached:false which works for system binaries.
 */

import { spawn, type ChildProcess, type SpawnOptions } from "child_process";

/**
 * Spawn a child process via child_process.spawn.
 *
 * Ensures detached:false to avoid EPERM in sandboxed environments.
 * The function signature is kept for compatibility with existing callsites.
 */
export function masSpawn(
  command: string,
  args: string[],
  options?: SpawnOptions
): ChildProcess {
  // Always disable detached — it causes EPERM in sandboxed environments
  // and is never needed for Lattice's spawn use cases.
  return spawn(command, args, { ...(options ?? {}), detached: false });
}
