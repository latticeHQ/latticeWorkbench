import { z } from "zod";

// --- Schedule config ---

export const CronScheduleSchema = z.object({
  kind: z.literal("cron"),
  expression: z.string(),
  timezone: z.string().nullish(),
});

export const IntervalScheduleSchema = z.object({
  kind: z.literal("interval"),
  everyMs: z.number(),
});

export const ScheduleConfigSchema = z.discriminatedUnion("kind", [
  CronScheduleSchema,
  IntervalScheduleSchema,
]);

// --- Job definition ---

export const ScheduledJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  minionId: z.string(),
  prompt: z.string(),
  model: z.string().nullish(),
  schedule: ScheduleConfigSchema,
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// --- Runtime state ---

export const ScheduledJobStateSchema = z.object({
  nextRunAtMs: z.number().nullish(),
  lastRunAtMs: z.number().nullish(),
  lastStatus: z.enum(["ok", "error", "skipped"]).nullish(),
  lastError: z.string().nullish(),
  lastDurationMs: z.number().nullish(),
  consecutiveErrors: z.number(),
});

// --- Combined view for frontend ---

export const ScheduledJobWithStateSchema = ScheduledJobSchema.extend({
  state: ScheduledJobStateSchema,
});

// --- Run history ---

export const ScheduledJobRunSchema = z.object({
  jobId: z.string(),
  sessionId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullish(),
  status: z.enum(["running", "ok", "error"]),
  error: z.string().nullish(),
});

// --- CRUD inputs ---

export const SchedulerListInputSchema = z.object({
  projectPath: z.string(),
});

export const SchedulerCreateInputSchema = z.object({
  projectPath: z.string(),
  name: z.string(),
  minionId: z.string(),
  prompt: z.string(),
  model: z.string().nullish(),
  schedule: ScheduleConfigSchema,
  enabled: z.boolean(),
});

export const SchedulerUpdateInputSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  minionId: z.string().nullish(),
  prompt: z.string().nullish(),
  model: z.string().nullish(),
  schedule: ScheduleConfigSchema.nullish(),
  enabled: z.boolean().nullish(),
});

export const SchedulerRemoveInputSchema = z.object({
  id: z.string(),
});

export const SchedulerRunInputSchema = z.object({
  id: z.string(),
});

export const SchedulerHistoryInputSchema = z.object({
  jobId: z.string(),
});

export const SchedulerSubscribeInputSchema = z.object({
  projectPath: z.string(),
});
