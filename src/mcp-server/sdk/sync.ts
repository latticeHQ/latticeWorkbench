/**
 * Lattice SDK — Git sync operations (9 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function getStatus(c: RouterClient<AppRouter>) {
  return c.sync.getStatus();
}

export async function getConfig(c: RouterClient<AppRouter>) {
  return c.sync.getConfig();
}

export async function saveConfig(
  c: RouterClient<AppRouter>,
  input: {
    repoUrl: string;
    autoSync: boolean;
    autoSyncDebounceMs?: number | null;
    categories: {
      config: boolean;
      mcpConfig: boolean;
      chatHistory: boolean;
      providers: boolean;
      secrets: boolean;
    };
  },
) {
  return c.sync.saveConfig(input);
}

export async function checkGhAuth(c: RouterClient<AppRouter>) {
  return c.sync.checkGhAuth();
}

export async function listRepos(c: RouterClient<AppRouter>) {
  return c.sync.listRepos();
}

export async function createRepo(c: RouterClient<AppRouter>, name: string) {
  return c.sync.createRepo({ name });
}

export async function push(c: RouterClient<AppRouter>) {
  return c.sync.push();
}

export async function pull(c: RouterClient<AppRouter>) {
  return c.sync.pull();
}

export async function disconnect(c: RouterClient<AppRouter>) {
  return c.sync.disconnect();
}
