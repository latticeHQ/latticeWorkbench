/**
 * Scheduled job types for the embedded cron/interval scheduler.
 *
 * Jobs are persisted in ~/.lattice/config.json under each project.
 * Runtime state (next run, error counts) lives in memory + a separate
 * state file to avoid polluting config with volatile data.
 */

/** How often a job should run. */
export type ScheduleConfig =
  | { kind: "cron"; expression: string; timezone?: string | null | undefined }
  | { kind: "interval"; everyMs: number };

/** Persisted job definition — stored in config.json. */
export interface ScheduledJob {
  /** Unique ID (nanoid). */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Target minion to spawn the agent session in. */
  minionId: string;
  /** Prompt sent to the agent when the job fires. */
  prompt: string;
  /** Model to use for the agent run (e.g. "anthropic:claude-sonnet-4-6"). */
  model?: string | null | undefined;
  /** Cron expression or fixed interval. */
  schedule: ScheduleConfig;
  /** Whether the scheduler should arm a timer for this job. */
  enabled: boolean;
  /** Epoch ms when the job was first created. */
  createdAt: number;
  /** Epoch ms of the last config edit. */
  updatedAt: number;
}

/** Volatile runtime state — kept in memory, optionally persisted to a state file. */
export interface ScheduledJobState {
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastStatus?: "ok" | "error" | "skipped" | null;
  lastError?: string | null;
  lastDurationMs?: number | null;
  /** Resets to 0 on success; drives exponential backoff. */
  consecutiveErrors: number;
}

/** A single historical run of a scheduled job. */
export interface ScheduledJobRun {
  jobId: string;
  /** PTY session ID spawned for this run. */
  sessionId: string;
  startedAt: number;
  finishedAt?: number | null;
  status: "running" | "ok" | "error";
  error?: string | null;
}

/** Combined view sent to the frontend — job definition + live state. */
export interface ScheduledJobWithState extends ScheduledJob {
  state: ScheduledJobState;
}

/** Fields the frontend can patch on an existing job. */
export type ScheduledJobPatch = Partial<
  Pick<ScheduledJob, "name" | "minionId" | "prompt" | "model" | "schedule" | "enabled">
>;

/**
 * Exponential backoff schedule (ms) indexed by consecutiveErrors - 1.
 * Mirrors openclaw's proven backoff ladder.
 */
export const ERROR_BACKOFF_MS = [
  30_000, // 1st error: 30s
  60_000, // 2nd: 1m
  5 * 60_000, // 3rd: 5m
  15 * 60_000, // 4th: 15m
  60 * 60_000, // 5th+: 1h
] as const;

/** Auto-disable a job after this many consecutive failures. */
export const MAX_CONSECUTIVE_ERRORS = 5;

/** Max run history entries kept in memory per job. */
export const MAX_RUN_HISTORY = 50;
