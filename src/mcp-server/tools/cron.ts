/**
 * Cron / Scheduled Task MCP tools — recurring autonomous operations.
 *
 * Ported from OpenClaw's cron system: the octopus can schedule recurring
 * tasks that execute automatically in workspace agents.
 *
 * **Persistent**: all jobs saved to ~/.lattice/cron/jobs.json
 * On restart, jobs are restored and timers re-armed automatically.
 *
 * Use cases:
 *   - Daily code review sweeps
 *   - Periodic dependency updates
 *   - Scheduled test runs
 *   - Health checks on deployed services
 *   - Recurring data collection/analysis
 *   - Automated git operations (pull, merge, rebase)
 */
import { z } from "zod";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

// ── Types ────────────────────────────────────────────────────────────

interface CronHistoryEntry {
  runAt: number;
  durationMs: number;
  success: boolean;
  resultPreview?: string;
  error?: string;
}

interface CronJobData {
  id: string;
  name: string;
  schedule: string; // cron expression or interval string
  intervalMs: number; // parsed interval
  workspaceId: string;
  task: string; // message to send
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastError?: string;
  runCount: number;
  nextRunAt: number;
  missedRuns: number; // count of runs missed while server was down
  history: CronHistoryEntry[]; // last N execution records
}

interface CronJob extends CronJobData {
  timerId?: ReturnType<typeof setTimeout>;
}

interface CronState {
  jobs: Map<string, CronJob>;
  counter: number;
}

// ── Persistence layer ────────────────────────────────────────────────

const CRON_DIR = path.join(os.homedir(), ".lattice", "cron");
const JOBS_FILE = path.join(CRON_DIR, "jobs.json");

function ensureCronDir(): void {
  if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
  }
}

function saveJobs(): void {
  try {
    ensureCronDir();
    // Strip timerId before serializing
    const serialized = Array.from(cronState.jobs.values()).map(
      (job): CronJobData => ({
        id: job.id,
        name: job.name,
        schedule: job.schedule,
        intervalMs: job.intervalMs,
        workspaceId: job.workspaceId,
        task: job.task,
        enabled: job.enabled,
        createdAt: job.createdAt,
        lastRunAt: job.lastRunAt,
        lastResult: job.lastResult,
        lastError: job.lastError,
        runCount: job.runCount,
        nextRunAt: job.nextRunAt,
        missedRuns: job.missedRuns ?? 0,
        history: job.history ?? [],
      })
    );
    fs.writeFileSync(
      JOBS_FILE,
      JSON.stringify({ counter: cronState.counter, jobs: serialized }, null, 2)
    );
  } catch {
    // Non-fatal
  }
}

function loadJobs(): void {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const raw = fs.readFileSync(JOBS_FILE, "utf-8");
    const data = JSON.parse(raw) as { counter: number; jobs: CronJobData[] };
    cronState.counter = data.counter;
    for (const jobData of data.jobs) {
      // Ensure new fields have defaults
      jobData.missedRuns = jobData.missedRuns ?? 0;
      jobData.history = jobData.history ?? [];

      // Detect missed runs while server was down
      if (jobData.enabled && jobData.nextRunAt < Date.now()) {
        const missedMs = Date.now() - jobData.nextRunAt;
        const missedCount = Math.floor(missedMs / jobData.intervalMs);
        if (missedCount > 0) {
          jobData.missedRuns += missedCount;
          jobData.history.push({
            runAt: jobData.nextRunAt,
            durationMs: 0,
            success: false,
            error: `Missed ${missedCount} run(s) while server was down`,
          });
          // Keep history bounded to last 50 entries
          if (jobData.history.length > 50) {
            jobData.history = jobData.history.slice(-50);
          }
        }
        jobData.nextRunAt = Date.now() + jobData.intervalMs;
      }
      cronState.jobs.set(jobData.id, { ...jobData });
    }
  } catch {
    // Corrupted — start fresh
  }
}

// ── State ────────────────────────────────────────────────────────────

const cronState: CronState = {
  jobs: new Map(),
  counter: 0,
};

// Restore from disk
loadJobs();

function genCronId(): string {
  return `cron-${(++cronState.counter).toString().padStart(3, "0")}`;
}

// ── Simple interval parser ───────────────────────────────────────────
// Supports: "30s", "5m", "1h", "6h", "1d", "every 30 minutes", etc.

function parseInterval(schedule: string): number {
  const s = schedule.trim().toLowerCase();

  // Direct ms
  const msMatch = s.match(/^(\d+)\s*ms$/);
  if (msMatch) return parseInt(msMatch[1]!);

  // Seconds
  const secMatch = s.match(/^(\d+)\s*s(?:ec(?:ond)?s?)?$/);
  if (secMatch) return parseInt(secMatch[1]!) * 1000;

  // Minutes
  const minMatch = s.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/);
  if (minMatch) return parseInt(minMatch[1]!) * 60 * 1000;

  // Hours
  const hourMatch = s.match(/^(\d+)\s*h(?:(?:ou)?rs?)?$/);
  if (hourMatch) return parseInt(hourMatch[1]!) * 60 * 60 * 1000;

  // Days
  const dayMatch = s.match(/^(\d+)\s*d(?:ays?)?$/);
  if (dayMatch) return parseInt(dayMatch[1]!) * 24 * 60 * 60 * 1000;

  // "every X minutes/hours/etc"
  const everyMatch = s.match(/^every\s+(\d+)\s+(second|minute|hour|day)s?$/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1]!);
    const unit = everyMatch[2]!;
    switch (unit) {
      case "second":
        return n * 1000;
      case "minute":
        return n * 60 * 1000;
      case "hour":
        return n * 60 * 60 * 1000;
      case "day":
        return n * 24 * 60 * 60 * 1000;
    }
  }

  // Default: treat as minutes
  const numOnly = parseInt(s);
  if (!isNaN(numOnly)) return numOnly * 60 * 1000;

  throw new Error(
    `Cannot parse schedule: "${schedule}". Use formats like "30s", "5m", "1h", "1d", or "every 30 minutes".`
  );
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

// ── History tracking ─────────────────────────────────────────────────

const MAX_HISTORY = 50;

function addHistory(
  job: CronJob,
  runAt: number,
  success: boolean,
  result?: string,
  error?: string
): void {
  if (!job.history) job.history = [];
  job.history.push({
    runAt,
    durationMs: Date.now() - runAt,
    success,
    resultPreview: result ? result.slice(0, 200) : undefined,
    error,
  });
  // Keep bounded
  if (job.history.length > MAX_HISTORY) {
    job.history = job.history.slice(-MAX_HISTORY);
  }
}

// ── Job execution ────────────────────────────────────────────────────

function scheduleNextRun(client: WorkbenchClient, job: CronJob): void {
  // Clear existing timer
  if (job.timerId) {
    clearTimeout(job.timerId);
    job.timerId = undefined;
  }

  if (!job.enabled) return;

  const delay = Math.max(job.nextRunAt - Date.now(), 1000);

  job.timerId = setTimeout(async () => {
    if (!job.enabled) return;

    const runStartedAt = Date.now();
    job.lastRunAt = runStartedAt;
    job.runCount++;

    try {
      // Send the task to the workspace
      const sendResult = await client.sendMessage(
        job.workspaceId,
        `[CRON: ${job.name}]\n${job.task}`
      );

      if (!sendResult.success) {
        job.lastError = sendResult.error ?? "Send failed";
        job.lastResult = undefined;
        addHistory(job, runStartedAt, false, undefined, job.lastError);
      } else {
        // Poll for response (shorter timeout for cron — 3 min)
        try {
          const response = await client.waitForResponse(job.workspaceId, 0, 180_000);
          job.lastResult = response;
          job.lastError = undefined;
          addHistory(job, runStartedAt, true, response);
        } catch (pollErr) {
          job.lastResult = undefined;
          job.lastError = `Poll failed: ${pollErr instanceof Error ? pollErr.message : String(pollErr)}`;
          addHistory(job, runStartedAt, false, undefined, job.lastError);
        }
      }
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error);
      job.lastResult = undefined;
      addHistory(job, runStartedAt, false, undefined, job.lastError);
    }

    // Schedule next run
    job.nextRunAt = Date.now() + job.intervalMs;
    saveJobs();
    scheduleNextRun(client, job);
  }, delay);
}

// ── Restore timers for loaded jobs ───────────────────────────────────

function restoreTimers(client: WorkbenchClient): void {
  for (const [, job] of cronState.jobs) {
    if (job.enabled) {
      scheduleNextRun(client, job);
    }
  }
}

// ── Register cron tools ──────────────────────────────────────────────

export function registerCronTools(server: McpServer, client: WorkbenchClient): void {
  // Restore timers for jobs loaded from disk
  restoreTimers(client);

  server.tool(
    "cron_create",
    `Schedule a recurring task in a workspace agent. The task will be sent as a message at each interval.

Schedule formats: "30s", "5m", "1h", "6h", "1d", "every 30 minutes"

Examples:
- "every 6 hours" + "Run the test suite and report failures"
- "1d" + "Check for dependency updates and create a PR if any found"
- "30m" + "Monitor the deployment health endpoint and alert if down"`,
    {
      name: z.string().describe("Human-readable job name"),
      workspaceId: z.string().describe("Workspace to send task to"),
      schedule: z.string().describe("Interval: '30s', '5m', '1h', '1d', 'every 30 minutes'"),
      task: z.string().describe("The message/instruction to send at each interval"),
      startImmediately: z
        .boolean()
        .optional()
        .describe("Run the first execution immediately (default: false)"),
    },
    async ({ name, workspaceId, schedule, task, startImmediately }) => {
      try {
        const intervalMs = parseInterval(schedule);

        if (intervalMs < 10_000) {
          return {
            content: [{ type: "text" as const, text: "Minimum interval is 10 seconds." }],
            isError: true,
          };
        }

        const id = genCronId();
        const now = Date.now();

        const job: CronJob = {
          id,
          name,
          schedule,
          intervalMs,
          workspaceId,
          task,
          enabled: true,
          createdAt: now,
          runCount: 0,
          nextRunAt: startImmediately ? now + 1000 : now + intervalMs,
          missedRuns: 0,
          history: [],
        };

        cronState.jobs.set(id, job);
        saveJobs();
        scheduleNextRun(client, job);

        return {
          content: [
            {
              type: "text" as const,
              text: `Cron job created: ${id}\n  Name: ${name}\n  Schedule: every ${formatDuration(intervalMs)}\n  Workspace: ${workspaceId}\n  Next run: ${startImmediately ? "~now" : `in ${formatDuration(intervalMs)}`}\n  Task: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "cron_list",
    "List all scheduled cron jobs with their status, last run info, and next run time.",
    {},
    async () => {
      const jobs = Array.from(cronState.jobs.values());

      if (jobs.length === 0) {
        return { content: [{ type: "text" as const, text: "No cron jobs scheduled." }] };
      }

      const lines: string[] = [];
      lines.push(`SCHEDULED JOBS (${jobs.length})\n`);

      for (const job of jobs) {
        const icon = job.enabled ? "[ON]" : "[OFF]";
        const nextIn = job.enabled
          ? formatDuration(Math.max(0, job.nextRunAt - Date.now()))
          : "disabled";

        lines.push(`${icon} ${job.id} "${job.name}"`);
        lines.push(`   Schedule: every ${formatDuration(job.intervalMs)} | Runs: ${job.runCount}`);
        lines.push(`   Workspace: ${job.workspaceId}`);
        lines.push(`   Next run: ${nextIn}`);

        if (job.lastRunAt) {
          const ago = formatDuration(Date.now() - job.lastRunAt);
          lines.push(`   Last run: ${ago} ago`);
          if (job.lastResult) {
            lines.push(
              `   Last result: ${job.lastResult.slice(0, 150)}${job.lastResult.length > 150 ? "..." : ""}`
            );
          }
          if (job.lastError) {
            lines.push(`   Last error: ${job.lastError}`);
          }
        }
        if (job.missedRuns > 0) {
          lines.push(`   ⚠ Missed runs: ${job.missedRuns}`);
        }
        lines.push("");
      }

      lines.push(`Persistence: ${fs.existsSync(JOBS_FILE) ? "jobs.json saved" : "not persisted"}`);

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  server.tool(
    "cron_enable",
    "Enable or disable a cron job.",
    {
      jobId: z.string().describe("Cron job ID"),
      enabled: z.boolean().describe("true to enable, false to disable"),
    },
    async ({ jobId, enabled }) => {
      const job = cronState.jobs.get(jobId);
      if (!job)
        return {
          content: [{ type: "text" as const, text: `Job ${jobId} not found` }],
          isError: true,
        };

      job.enabled = enabled;

      if (enabled) {
        job.nextRunAt = Date.now() + job.intervalMs;
        scheduleNextRun(client, job);
        saveJobs();
        return {
          content: [
            {
              type: "text" as const,
              text: `Job "${job.name}" enabled. Next run in ${formatDuration(job.intervalMs)}`,
            },
          ],
        };
      } else {
        if (job.timerId) {
          clearTimeout(job.timerId);
          job.timerId = undefined;
        }
        saveJobs();
        return { content: [{ type: "text" as const, text: `Job "${job.name}" disabled.` }] };
      }
    }
  );

  server.tool(
    "cron_delete",
    "Delete a cron job permanently.",
    { jobId: z.string() },
    async ({ jobId }) => {
      const job = cronState.jobs.get(jobId);
      if (!job)
        return {
          content: [{ type: "text" as const, text: `Job ${jobId} not found` }],
          isError: true,
        };

      if (job.timerId) clearTimeout(job.timerId);
      cronState.jobs.delete(jobId);
      saveJobs();

      return {
        content: [
          {
            type: "text" as const,
            text: `Job "${job.name}" (${jobId}) deleted. Ran ${job.runCount} times.`,
          },
        ],
      };
    }
  );

  server.tool(
    "cron_run_now",
    "Trigger an immediate execution of a cron job (doesn't affect the regular schedule).",
    { jobId: z.string() },
    async ({ jobId }) => {
      const job = cronState.jobs.get(jobId);
      if (!job)
        return {
          content: [{ type: "text" as const, text: `Job ${jobId} not found` }],
          isError: true,
        };

      job.lastRunAt = Date.now();
      job.runCount++;

      try {
        const sendResult = await client.sendMessage(
          job.workspaceId,
          `[CRON: ${job.name} — manual trigger]\n${job.task}`
        );
        if (!sendResult.success) {
          job.lastError = sendResult.error ?? "Send failed";
          saveJobs();
          return {
            content: [{ type: "text" as const, text: `Failed to trigger: ${sendResult.error}` }],
            isError: true,
          };
        }

        // Poll for response
        const response = await client.waitForResponse(job.workspaceId, 0, 180_000);
        job.lastResult = response;
        job.lastError = undefined;
        saveJobs();

        return {
          content: [
            { type: "text" as const, text: `Job "${job.name}" executed.\n\nResult:\n${response}` },
          ],
        };
      } catch (error) {
        job.lastError = error instanceof Error ? error.message : String(error);
        saveJobs();
        return {
          content: [{ type: "text" as const, text: `Error: ${job.lastError}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "cron_edit",
    "Edit an existing cron job's schedule or task.",
    {
      jobId: z.string(),
      schedule: z.string().optional().describe("New schedule"),
      task: z.string().optional().describe("New task message"),
      name: z.string().optional().describe("New name"),
    },
    async ({ jobId, schedule, task, name }) => {
      const job = cronState.jobs.get(jobId);
      if (!job)
        return {
          content: [{ type: "text" as const, text: `Job ${jobId} not found` }],
          isError: true,
        };

      const changes: string[] = [];

      if (name) {
        job.name = name;
        changes.push(`name -> "${name}"`);
      }
      if (schedule) {
        job.intervalMs = parseInterval(schedule);
        job.schedule = schedule;
        job.nextRunAt = Date.now() + job.intervalMs;
        changes.push(`schedule -> every ${formatDuration(job.intervalMs)}`);
      }
      if (task) {
        job.task = task;
        changes.push(`task updated (${task.length} chars)`);
      }

      // Reschedule if running
      if (job.enabled) {
        scheduleNextRun(client, job);
      }

      saveJobs();

      return {
        content: [
          { type: "text" as const, text: `Job ${jobId} updated:\n  ${changes.join("\n  ")}` },
        ],
      };
    }
  );

  // ── Execution history ─────────────────────────────────────────────

  server.tool(
    "cron_history",
    "Get execution history for a cron job — shows last N runs with timestamps, duration, success/failure, and result previews.",
    {
      jobId: z.string().describe("Cron job ID"),
      limit: z.number().optional().describe("Max entries to return (default: 20)"),
    },
    async ({ jobId, limit }) => {
      const job = cronState.jobs.get(jobId);
      if (!job)
        return {
          content: [{ type: "text" as const, text: `Job ${jobId} not found` }],
          isError: true,
        };

      const history = job.history ?? [];
      const maxEntries = limit ?? 20;
      const entries = history.slice(-maxEntries);

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No execution history for job "${job.name}" (${jobId}).`,
            },
          ],
        };
      }

      const lines: string[] = [];
      lines.push(`EXECUTION HISTORY: "${job.name}" (${jobId})`);
      lines.push(
        `Total runs: ${job.runCount} | Missed: ${job.missedRuns ?? 0} | Showing last ${entries.length}\n`
      );

      const successCount = entries.filter((e) => e.success).length;
      const failCount = entries.length - successCount;
      lines.push(
        `Success: ${successCount} | Failed: ${failCount} | Rate: ${entries.length > 0 ? Math.round((successCount / entries.length) * 100) : 0}%\n`
      );

      for (const entry of entries) {
        const icon = entry.success ? "[OK]" : "[FAIL]";
        const date = new Date(entry.runAt).toLocaleString();
        const dur = formatDuration(entry.durationMs);
        lines.push(`${icon} ${date} (${dur})`);
        if (entry.resultPreview) {
          lines.push(
            `   ${entry.resultPreview.slice(0, 120)}${entry.resultPreview.length > 120 ? "..." : ""}`
          );
        }
        if (entry.error) {
          lines.push(`   Error: ${entry.error}`);
        }
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── Missed runs report ────────────────────────────────────────────

  server.tool(
    "cron_missed_report",
    "Report on missed cron runs across all jobs — shows which jobs missed executions while the server was down.",
    {},
    async () => {
      const jobs = Array.from(cronState.jobs.values());
      const jobsWithMisses = jobs.filter((j) => (j.missedRuns ?? 0) > 0);

      if (jobsWithMisses.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No missed runs detected across all cron jobs." },
          ],
        };
      }

      const totalMissed = jobsWithMisses.reduce((sum, j) => sum + (j.missedRuns ?? 0), 0);

      const lines: string[] = [];
      lines.push(
        `MISSED RUNS REPORT: ${totalMissed} total missed across ${jobsWithMisses.length} job(s)\n`
      );

      for (const job of jobsWithMisses) {
        lines.push(`[!] ${job.id} "${job.name}" — ${job.missedRuns} missed`);
        lines.push(
          `   Schedule: every ${formatDuration(job.intervalMs)} | Total runs: ${job.runCount}`
        );
        lines.push(
          `   Next run: ${job.enabled ? `in ${formatDuration(Math.max(0, job.nextRunAt - Date.now()))}` : "disabled"}`
        );
        lines.push("");
      }

      lines.push("Tip: Use cron_run_now to manually trigger missed jobs.");

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
