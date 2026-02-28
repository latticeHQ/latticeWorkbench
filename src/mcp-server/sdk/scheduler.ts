/**
 * Lattice SDK — Scheduler operations (6 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

type Schedule =
  | { kind: "cron"; expression: string; timezone?: string | null }
  | { kind: "interval"; everyMs: number };

export async function listSchedules(c: RouterClient<AppRouter>, projectPath: string) {
  return c.scheduler.list({ projectPath });
}

export async function createSchedule(
  c: RouterClient<AppRouter>,
  input: {
    projectPath: string;
    name: string;
    minionId: string;
    prompt: string;
    schedule: Schedule;
    enabled: boolean;
    model?: string | null;
  },
) {
  return c.scheduler.create(input);
}

export async function updateSchedule(
  c: RouterClient<AppRouter>,
  id: string,
  updates: {
    name?: string | null;
    minionId?: string | null;
    prompt?: string | null;
    model?: string | null;
    schedule?: Schedule | null;
    enabled?: boolean | null;
  },
) {
  return c.scheduler.update({ id, ...updates });
}

export async function removeSchedule(c: RouterClient<AppRouter>, id: string) {
  return c.scheduler.remove({ id });
}

export async function runSchedule(c: RouterClient<AppRouter>, id: string) {
  return c.scheduler.run({ id });
}

export async function getHistory(c: RouterClient<AppRouter>, jobId: string) {
  return c.scheduler.history({ jobId });
}
