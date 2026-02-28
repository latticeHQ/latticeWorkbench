/**
 * Lattice SDK — Secrets operations (2 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function getSecrets(c: RouterClient<AppRouter>, projectPath?: string) {
  return c.secrets.get({ projectPath } as Parameters<typeof c.secrets.get>[0]);
}

export async function updateSecrets(c: RouterClient<AppRouter>, secrets: Array<{ name: string; value: string }>, projectPath?: string) {
  return c.secrets.update({ secrets, projectPath } as unknown as Parameters<typeof c.secrets.update>[0]);
}
