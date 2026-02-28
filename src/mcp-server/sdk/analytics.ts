/**
 * Lattice SDK — Analytics operations (8 functions)
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

interface DateRange { projectPath?: string; from?: string; to?: string }

export async function getSummary(c: RouterClient<AppRouter>, opts?: DateRange) {
  return c.analytics.getSummary(opts as Parameters<typeof c.analytics.getSummary>[0]);
}

export async function getSpendOverTime(c: RouterClient<AppRouter>, granularity: "hour" | "day" | "week", opts?: DateRange) {
  return c.analytics.getSpendOverTime({ granularity, ...opts } as Parameters<typeof c.analytics.getSpendOverTime>[0]);
}

export async function getSpendByProject(c: RouterClient<AppRouter>, opts?: { from?: string; to?: string }) {
  return c.analytics.getSpendByProject(opts as Parameters<typeof c.analytics.getSpendByProject>[0]);
}

export async function getSpendByModel(c: RouterClient<AppRouter>, opts?: DateRange) {
  return c.analytics.getSpendByModel(opts as Parameters<typeof c.analytics.getSpendByModel>[0]);
}

export async function getTimingDistribution(c: RouterClient<AppRouter>, metric: "ttft" | "duration" | "tps", opts?: DateRange) {
  return c.analytics.getTimingDistribution({ metric, ...opts } as Parameters<typeof c.analytics.getTimingDistribution>[0]);
}

export async function getAgentCostBreakdown(c: RouterClient<AppRouter>, opts?: DateRange) {
  return c.analytics.getAgentCostBreakdown(opts as Parameters<typeof c.analytics.getAgentCostBreakdown>[0]);
}

export async function getCacheHitRatioByProvider(c: RouterClient<AppRouter>, opts?: DateRange) {
  return c.analytics.getCacheHitRatioByProvider(opts as Parameters<typeof c.analytics.getCacheHitRatioByProvider>[0]);
}

export async function rebuildDatabase(c: RouterClient<AppRouter>) {
  return c.analytics.rebuildDatabase({});
}
