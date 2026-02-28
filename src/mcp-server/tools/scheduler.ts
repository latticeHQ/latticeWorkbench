/**
 * Scheduler tools: create, manage, and run scheduled/automated tasks.
 *
 * The scheduler enables cron-like task automation within Lattice —
 * run agent tasks on a schedule, view execution history, and manage
 * scheduled jobs.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    expression: z.string().describe("Cron expression (e.g. '0 * * * *' for hourly)"),
    timezone: z.string().nullable().optional().describe("IANA timezone (e.g. 'America/New_York')"),
  }),
  z.object({
    kind: z.literal("interval"),
    everyMs: z.number().describe("Interval in milliseconds"),
  }),
]);

export function registerSchedulerTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List scheduled tasks ────────────────────────────────────────────────
  server.tool(
    "scheduler_list",
    "List all scheduled tasks for a project with their configuration, status, and next run time.",
    {
      projectPath: z.string().describe("Absolute project path"),
    },
    (params) =>
      withErrorHandling(async () => {
        const schedules = await client.scheduler.list({ projectPath: params.projectPath });
        return { content: [jsonContent(schedules)] };
      })
  );

  // ── Create scheduled task ───────────────────────────────────────────────
  server.tool(
    "scheduler_create",
    "Create a new scheduled task that runs automatically. Supports cron expressions " +
      "or fixed-interval schedules.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("Human-readable name for the scheduled task"),
      minionId: z.string().describe("Minion ID to run the task in"),
      prompt: z.string().describe("The message/prompt to send to the agent when triggered"),
      model: z.string().nullable().optional().describe("Model to use (null for default)"),
      schedule: scheduleSchema.describe("Schedule definition (cron or interval)"),
      enabled: z.boolean().describe("Whether the schedule is active"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.scheduler.create({
          projectPath: params.projectPath,
          name: params.name,
          minionId: params.minionId,
          prompt: params.prompt,
          model: params.model,
          schedule: params.schedule,
          enabled: params.enabled,
        });
        return { content: [jsonContent({ message: "Scheduled task created", ...result })] };
      })
  );

  // ── Update scheduled task ───────────────────────────────────────────────
  server.tool(
    "scheduler_update",
    "Update an existing scheduled task's configuration.",
    {
      id: z.string().describe("The schedule ID to update"),
      name: z.string().nullable().optional().describe("New name"),
      minionId: z.string().nullable().optional().describe("New minion ID"),
      prompt: z.string().nullable().optional().describe("New prompt"),
      model: z.string().nullable().optional().describe("New model"),
      schedule: scheduleSchema.nullable().optional().describe("New schedule"),
      enabled: z.boolean().nullable().optional().describe("Enable or disable"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.scheduler.update({
          id: params.id,
          name: params.name,
          minionId: params.minionId,
          prompt: params.prompt,
          model: params.model,
          schedule: params.schedule,
          enabled: params.enabled,
        });
        return { content: [jsonContent({ message: "Schedule updated", ...result })] };
      })
  );

  // ── Remove scheduled task ───────────────────────────────────────────────
  server.tool(
    "scheduler_remove",
    "Delete a scheduled task.",
    {
      id: z.string().describe("The schedule ID to remove"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.scheduler.remove({ id: params.id });
        return { content: [jsonContent({ message: "Schedule removed", ...result })] };
      })
  );

  // ── Run scheduled task now ──────────────────────────────────────────────
  server.tool(
    "scheduler_run",
    "Manually trigger a scheduled task to run immediately (outside its regular schedule).",
    {
      id: z.string().describe("The schedule ID to run now"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.scheduler.run({ id: params.id });
        return { content: [jsonContent({ message: "Schedule triggered", ...result })] };
      })
  );

  // ── Get schedule execution history ──────────────────────────────────────
  server.tool(
    "scheduler_history",
    "Get the execution history for a scheduled task — past runs, results, and errors.",
    {
      jobId: z.string().describe("The scheduled job ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const history = await client.scheduler.history({ jobId: params.jobId });
        return { content: [jsonContent(history)] };
      })
  );
}
