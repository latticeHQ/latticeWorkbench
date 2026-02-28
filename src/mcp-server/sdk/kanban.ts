/**
 * Lattice SDK — Kanban board operations (3 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function listCards(c: RouterClient<AppRouter>, minionId: string) {
  return c.kanban.list({ minionId });
}

export async function moveCard(
  c: RouterClient<AppRouter>,
  minionId: string,
  sessionId: string,
  targetColumn: "queued" | "active" | "completed" | "archived",
) {
  return c.kanban.moveCard({ minionId, sessionId, targetColumn });
}

export async function getArchivedBuffer(c: RouterClient<AppRouter>, minionId: string, sessionId: string) {
  return c.kanban.getArchivedBuffer({ minionId, sessionId });
}
