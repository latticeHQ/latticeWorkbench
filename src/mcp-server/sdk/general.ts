/**
 * Lattice SDK — General utility operations (6 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function ping(c: RouterClient<AppRouter>, message?: string) {
  return c.general.ping(message ?? "ping");
}

export async function listDirectory(c: RouterClient<AppRouter>, path: string) {
  const result = await c.general.listDirectory({ path });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

export async function createDirectory(c: RouterClient<AppRouter>, path: string) {
  const result = await c.general.createDirectory({ path });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

export async function openInEditor(c: RouterClient<AppRouter>, minionId: string, targetPath: string, editorConfig?: Record<string, unknown>) {
  return c.general.openInEditor({ minionId, targetPath, editorConfig: editorConfig ?? {} } as Parameters<typeof c.general.openInEditor>[0]);
}

export async function getLogPath(c: RouterClient<AppRouter>) {
  return c.general.getLogPath();
}

export async function clearLogs(c: RouterClient<AppRouter>) {
  return c.general.clearLogs();
}
