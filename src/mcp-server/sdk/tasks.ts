/**
 * Lattice SDK — Task operations (1 function)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

/** Create a sidekick task. Returns taskId. */
export async function createTask(c: RouterClient<AppRouter>, input: {
  parentMinionId: string; prompt: string; title?: string; agentId?: string;
  modelString?: string; thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh" | "max";
}) {
  const result = await c.tasks.create({ ...input, kind: "agent" } as Parameters<typeof c.tasks.create>[0]);
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}
