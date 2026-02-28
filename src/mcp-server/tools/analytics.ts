/**
 * Analytics tools: spend tracking, usage summaries, timing distributions,
 * cost breakdowns, and database management.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

const dateRange = {
  projectPath: z.string().optional().describe("Filter to a specific project"),
  from: z.string().optional().describe("Start date (ISO 8601, e.g. '2025-01-01')"),
  to: z.string().optional().describe("End date (ISO 8601)"),
};

export function registerAnalyticsTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Get summary ────────────────────────────────────────────────────────
  server.tool(
    "analytics_get_summary",
    "Get an aggregate spend/usage summary including total cost, tokens, and request counts.",
    dateRange,
    (params) =>
      withErrorHandling(async () => {
        const summary = await client.analytics.getSummary({
          projectPath: params.projectPath,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getSummary>[0]);
        return { content: [jsonContent(summary)] };
      })
  );

  // ── Spend over time ────────────────────────────────────────────────────
  server.tool(
    "analytics_spend_over_time",
    "Get spend bucketed over time by model. Useful for cost trend analysis.",
    {
      ...dateRange,
      granularity: z.enum(["hour", "day", "week"]).describe("Time bucket granularity"),
    },
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getSpendOverTime({
          projectPath: params.projectPath,
          granularity: params.granularity,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getSpendOverTime>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Spend by project ───────────────────────────────────────────────────
  server.tool(
    "analytics_spend_by_project",
    "Get spend grouped by project.",
    {
      from: z.string().optional().describe("Start date (ISO 8601)"),
      to: z.string().optional().describe("End date (ISO 8601)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getSpendByProject({
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getSpendByProject>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Spend by model ─────────────────────────────────────────────────────
  server.tool(
    "analytics_spend_by_model",
    "Get spend grouped by model.",
    dateRange,
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getSpendByModel({
          projectPath: params.projectPath,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getSpendByModel>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Timing distribution ────────────────────────────────────────────────
  server.tool(
    "analytics_timing_distribution",
    "Get latency/throughput percentiles and histogram (TTFT, duration, or tokens-per-second).",
    {
      ...dateRange,
      metric: z.enum(["ttft", "duration", "tps"]).describe("Metric: time-to-first-token, total duration, or tokens/sec"),
    },
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getTimingDistribution({
          projectPath: params.projectPath,
          metric: params.metric,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getTimingDistribution>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Agent cost breakdown ───────────────────────────────────────────────
  server.tool(
    "analytics_agent_cost_breakdown",
    "Get cost breakdown per agent type.",
    dateRange,
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getAgentCostBreakdown({
          projectPath: params.projectPath,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getAgentCostBreakdown>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Cache hit ratio by provider ────────────────────────────────────────
  server.tool(
    "analytics_cache_hit_ratio",
    "Get prompt cache hit ratios by provider.",
    dateRange,
    (params) =>
      withErrorHandling(async () => {
        const data = await client.analytics.getCacheHitRatioByProvider({
          projectPath: params.projectPath,
          from: params.from,
          to: params.to,
        } as Parameters<typeof client.analytics.getCacheHitRatioByProvider>[0]);
        return { content: [jsonContent(data)] };
      })
  );

  // ── Rebuild database ───────────────────────────────────────────────────
  server.tool(
    "analytics_rebuild_database",
    "Rebuild the local DuckDB analytics database from all session chat.jsonl files. " +
      "Use this if analytics data seems stale or incomplete.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.analytics.rebuildDatabase({});
        return { content: [jsonContent({ message: "Analytics database rebuilt", ...result })] };
      })
  );
}
