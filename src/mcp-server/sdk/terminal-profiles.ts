/**
 * Lattice SDK — Terminal profile operations (3 functions)
 *
 * Manage CLI tool profiles (claude-code, gemini-cli, github-copilot, aider,
 * codex, amp): detect installed tools, enable/disable, get install recipes.
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

/** List all terminal profiles with auto-detection status and user config. */
export async function listProfiles(c: RouterClient<AppRouter>) {
  return c.terminalProfiles.list();
}

/** Update configuration for a terminal profile (enable/disable, overrides). */
export async function setProfileConfig(
  c: RouterClient<AppRouter>,
  profileId: string,
  config: {
    enabled: boolean;
    commandOverride?: string;
    argsOverride?: string[];
    env?: Record<string, string>;
  }
) {
  return c.terminalProfiles.setConfig({ profileId, config });
}

/** Get install recipes for a profile on the given runtime type. */
export async function getInstallRecipe(
  c: RouterClient<AppRouter>,
  profileId: string,
  runtimeType: "local" | "worktree" | "ssh" | "docker" | "devcontainer"
) {
  return c.terminalProfiles.getInstallRecipe({ profileId, runtimeType });
}
