/**
 * SchedulerService — in-process cron/interval scheduler for automated agent tasks.
 *
 * Uses `croner` for precise timer management. Jobs are persisted in config.json
 * under each project. Runtime state (next run, error counts) lives in memory
 * with an optional state file for crash recovery.
 *
 * Execution: sends the job's prompt to the target minion via
 * MinionService.sendMessage(), creating a proper AI agent session.
 */

import { Cron } from "croner";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";
import type { MinionService } from "@/node/services/minionService";
import type {
  ScheduledJob,
  ScheduledJobPatch,
  ScheduledJobRun,
  ScheduledJobState,
  ScheduledJobWithState,
} from "@/common/types/scheduler";
import {
  ERROR_BACKOFF_MS,
  MAX_CONSECUTIVE_ERRORS,
  MAX_RUN_HISTORY,
} from "@/common/types/scheduler";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

type SchedulerEventListener = (jobs: ScheduledJobWithState[]) => void;

export class SchedulerService {
  private readonly config: Config;
  private minionService: MinionService | undefined;

  /** Active croner instances keyed by job ID. */
  private readonly timers = new Map<string, Cron>();

  /** In-memory runtime state keyed by job ID. */
  private readonly states = new Map<string, ScheduledJobState>();

  /** Recent run history keyed by job ID (ring buffer per job). */
  private readonly history = new Map<string, ScheduledJobRun[]>();

  /** Listeners for real-time state changes (used by subscribe endpoint). */
  private readonly listeners = new Set<SchedulerEventListener>();

  constructor(config: Config) {
    this.config = config;
  }

  /** Late-bind minion service to break circular dep in ServiceContainer. */
  setMinionService(service: MinionService): void {
    this.minionService = service;
  }

  /** Load all jobs from config and arm timers for enabled ones. */
  initialize(): void {
    try {
      const allJobs = this.getAllJobs();
      for (const job of allJobs) {
        if (job.enabled) {
          this.armTimer(job);
        }
        // Initialize state if missing
        if (!this.states.has(job.id)) {
          this.states.set(job.id, { consecutiveErrors: 0 });
        }
      }
      log.debug(`[Scheduler] Initialized with ${allJobs.length} jobs`);
    } catch (err) {
      // Startup-time initialization must never crash the app
      log.warn("[Scheduler] Failed to initialize", { error: err });
    }
  }

  /** List all jobs for a project, enriched with runtime state. */
  list(projectPath: string): ScheduledJobWithState[] {
    const jobs = this.getJobsForProject(projectPath);
    return jobs.map((job) => this.enrichWithState(job));
  }

  /** Create a new scheduled job. */
  async create(
    projectPath: string,
    input: {
      name: string;
      minionId: string;
      prompt: string;
      model?: string | null;
      schedule: ScheduledJob["schedule"];
      enabled: boolean;
    },
  ): Promise<ScheduledJobWithState> {
    const id = generateId();
    const now = Date.now();
    const job: ScheduledJob = {
      id,
      name: input.name,
      minionId: input.minionId,
      prompt: input.prompt,
      model: input.model ?? undefined,
      schedule: input.schedule,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };

    const state: ScheduledJobState = { consecutiveErrors: 0 };
    this.states.set(id, state);

    await this.persistJob(projectPath, job);

    if (job.enabled) {
      this.armTimer(job);
    }

    this.notifyListeners(projectPath);
    return { ...job, state };
  }

  /** Update an existing job. */
  async update(id: string, patch: ScheduledJobPatch): Promise<ScheduledJobWithState> {
    const { job, projectPath } = this.findJobOrThrow(id);

    const updated: ScheduledJob = {
      ...job,
      ...(patch.name != null ? { name: patch.name } : {}),
      ...(patch.minionId != null ? { minionId: patch.minionId } : {}),
      ...(patch.prompt != null ? { prompt: patch.prompt } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.schedule != null ? { schedule: patch.schedule } : {}),
      ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
      updatedAt: Date.now(),
    };

    // Disarm old timer, re-arm if still enabled
    this.disarmTimer(id);
    if (updated.enabled) {
      // Reset error count when re-enabling
      if (!job.enabled && updated.enabled) {
        const state = this.states.get(id);
        if (state) {
          state.consecutiveErrors = 0;
        }
      }
      this.armTimer(updated);
    }

    await this.persistJob(projectPath, updated);
    this.notifyListeners(projectPath);
    return this.enrichWithState(updated);
  }

  /** Remove a scheduled job. */
  async remove(id: string): Promise<{ ok: boolean }> {
    const { projectPath } = this.findJobOrThrow(id);
    this.disarmTimer(id);
    this.states.delete(id);
    this.history.delete(id);

    await this.removeJobFromConfig(id);
    this.notifyListeners(projectPath);
    return { ok: true };
  }

  /** Manually trigger a job run ("Run Now"). */
  async run(id: string): Promise<{ ok: boolean; sessionId?: string }> {
    const { job, projectPath } = this.findJobOrThrow(id);
    try {
      const sessionId = await this.executeJob(job);
      this.notifyListeners(projectPath);
      return { ok: true, sessionId };
    } catch (err) {
      log.warn(`[Scheduler] Manual run failed for job ${id}`, { error: err });
      return { ok: false };
    }
  }

  /** Get run history for a specific job. */
  getHistory(jobId: string): ScheduledJobRun[] {
    return this.history.get(jobId) ?? [];
  }

  /** Register a listener for real-time state updates. Returns unsubscribe fn. */
  subscribe(listener: SchedulerEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stop all timers. */
  dispose(): void {
    for (const [id, timer] of this.timers) {
      timer.stop();
      this.timers.delete(id);
    }
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Private — timer management
  // ---------------------------------------------------------------------------

  private armTimer(job: ScheduledJob): void {
    this.disarmTimer(job.id);

    const state = this.states.get(job.id) ?? { consecutiveErrors: 0 };

    if (job.schedule.kind === "cron") {
      try {
        const cron = new Cron(
          job.schedule.expression,
          { timezone: job.schedule.timezone ?? undefined },
          () => {
            void this.onTimerFire(job);
          },
        );
        this.timers.set(job.id, cron);
        state.nextRunAtMs = cron.nextRun()?.getTime();
      } catch (err) {
        log.warn(`[Scheduler] Invalid cron expression for job ${job.id}: ${job.schedule.expression}`, { error: err });
      }
    } else if (job.schedule.kind === "interval") {
      // Use croner with interval pattern: "*/N * * * * *" won't work for arbitrary ms.
      // Instead, use a self-rescheduling approach with croner's maxRuns + re-arm.
      const intervalMs = job.schedule.everyMs;
      const nextMs = Date.now() + intervalMs;
      state.nextRunAtMs = nextMs;

      // Schedule a one-shot at the computed next time, then re-arm after execution
      const nextDate = new Date(nextMs);
      try {
        const cron = new Cron(nextDate, () => {
          void this.onTimerFire(job).then(() => {
            // Re-arm for the next interval if still enabled
            const currentJob = this.findJobById(job.id);
            if (currentJob?.enabled) {
              this.armTimer(currentJob);
            }
          });
        });
        this.timers.set(job.id, cron);
      } catch (err) {
        log.warn(`[Scheduler] Failed to arm interval timer for job ${job.id}`, { error: err });
      }
    }

    this.states.set(job.id, state);
  }

  private disarmTimer(jobId: string): void {
    const timer = this.timers.get(jobId);
    if (timer) {
      timer.stop();
      this.timers.delete(jobId);
    }
  }

  private async onTimerFire(job: ScheduledJob): Promise<void> {
    const state = this.states.get(job.id) ?? { consecutiveErrors: 0 };

    // Check backoff — skip if we're in a backoff window
    if (state.nextRunAtMs && Date.now() < state.nextRunAtMs) {
      state.lastStatus = "skipped";
      this.states.set(job.id, state);
      return;
    }

    try {
      const sessionId = await this.executeJob(job);
      state.lastRunAtMs = Date.now();
      state.lastStatus = "ok";
      state.lastError = undefined;
      state.consecutiveErrors = 0;
      log.debug(`[Scheduler] Job ${job.id} completed, session: ${sessionId}`);
    } catch (err) {
      state.lastRunAtMs = Date.now();
      state.lastStatus = "error";
      state.lastError = err instanceof Error ? err.message : String(err);
      state.consecutiveErrors++;
      log.warn(`[Scheduler] Job ${job.id} failed (${state.consecutiveErrors} consecutive)`, { error: err });

      // Auto-disable after too many consecutive failures
      if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log.warn(`[Scheduler] Auto-disabling job ${job.id} after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        this.disarmTimer(job.id);
        // Persist the disabled state
        const { projectPath } = this.findJobOrThrow(job.id);
        await this.persistJob(projectPath, { ...job, enabled: false, updatedAt: Date.now() });
      } else {
        // Apply exponential backoff to next run
        const backoffIndex = Math.min(state.consecutiveErrors - 1, ERROR_BACKOFF_MS.length - 1);
        const backoffMs = ERROR_BACKOFF_MS[backoffIndex] ?? ERROR_BACKOFF_MS[ERROR_BACKOFF_MS.length - 1];
        state.nextRunAtMs = Date.now() + backoffMs;
      }
    }

    this.states.set(job.id, state);

    // Find project path for notification
    try {
      const { projectPath } = this.findJobOrThrow(job.id);
      this.notifyListeners(projectPath);
    } catch {
      // Job may have been deleted during execution — safe to ignore
    }
  }

  // ---------------------------------------------------------------------------
  // Private — job execution
  // ---------------------------------------------------------------------------

  private async executeJob(job: ScheduledJob): Promise<string> {
    if (!this.minionService) {
      throw new Error("MinionService not available");
    }

    const startedAt = Date.now();

    // Record run start
    const run: ScheduledJobRun = {
      jobId: job.id,
      sessionId: job.minionId,
      startedAt,
      status: "running",
    };

    // Resolve model: job-specific override → minion default fallback.
    // sendMessage requires a model string; we default to the global
    // minion default so the scheduler always sends a valid value.
    const model = job.model ?? MINION_DEFAULTS.model;

    // Send the prompt as a message to the minion's agent session —
    // same as the user typing a message in chat. The agent processes it
    // in the existing minion context (no fork, no new minion).
    const result = await this.minionService.sendMessage(
      job.minionId,
      job.prompt,
      { agentId: "exec", model },
    );

    if (!result.success) {
      const errorType = "type" in result.error ? result.error.type : "unknown";
      throw new Error(`sendMessage failed: ${errorType}`);
    }

    // Record in history
    const runs = this.history.get(job.id) ?? [];
    runs.push(run);
    // Ring buffer: keep only the most recent runs
    if (runs.length > MAX_RUN_HISTORY) {
      runs.splice(0, runs.length - MAX_RUN_HISTORY);
    }
    this.history.set(job.id, runs);

    // Mark run as ok (the message was sent; actual agent completion tracked separately)
    run.status = "ok";
    run.finishedAt = Date.now();

    return job.minionId;
  }

  // ---------------------------------------------------------------------------
  // Private — config persistence
  // ---------------------------------------------------------------------------

  private getAllJobs(): ScheduledJob[] {
    try {
      const cfg = this.config.loadConfigOrDefault();
      return cfg.schedules ?? [];
    } catch {
      return [];
    }
  }

  private getJobsForProject(projectPath: string): ScheduledJob[] {
    // Get all minion IDs belonging to this project
    const cfg = this.config.loadConfigOrDefault();
    const projects = cfg.projects;
    if (!projects) return [];

    const projectMinionIds = new Set<string>();
    for (const [path, project] of projects) {
      if (path === projectPath && project.minions) {
        for (const ws of project.minions) {
          if (ws.id) projectMinionIds.add(ws.id);
        }
      }
    }

    return this.getAllJobs().filter((job) => projectMinionIds.has(job.minionId));
  }

  private findJobById(id: string): ScheduledJob | undefined {
    return this.getAllJobs().find((j) => j.id === id);
  }

  private findJobOrThrow(id: string): { job: ScheduledJob; projectPath: string } {
    const allJobs = this.getAllJobs();
    const job = allJobs.find((j) => j.id === id);
    if (!job) {
      throw new Error(`Scheduled job not found: ${id}`);
    }

    // Find the project this job's minion belongs to
    const cfg = this.config.loadConfigOrDefault();
    let projectPath = "";
    if (cfg.projects) {
      for (const [path, project] of cfg.projects) {
        if (project.minions?.some((ws) => ws.id != null && ws.id === job.minionId)) {
          projectPath = path;
          break;
        }
      }
    }

    return { job, projectPath };
  }

  private async persistJob(_projectPath: string, job: ScheduledJob): Promise<void> {
    await this.config.editConfig((cfg) => {
      const schedules = [...(cfg.schedules ?? [])];
      const idx = schedules.findIndex((s) => s.id === job.id);
      if (idx >= 0) {
        schedules[idx] = job;
      } else {
        schedules.push(job);
      }
      cfg.schedules = schedules;
      return cfg;
    });
  }

  private async removeJobFromConfig(id: string): Promise<void> {
    await this.config.editConfig((cfg) => {
      if (cfg.schedules) {
        cfg.schedules = cfg.schedules.filter((s) => s.id !== id);
      }
      return cfg;
    });
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private enrichWithState(job: ScheduledJob): ScheduledJobWithState {
    const state = this.states.get(job.id) ?? { consecutiveErrors: 0 };
    return { ...job, state };
  }

  private notifyListeners(projectPath: string): void {
    if (this.listeners.size === 0) return;
    const jobs = this.list(projectPath);
    for (const listener of this.listeners) {
      try {
        listener(jobs);
      } catch (err) {
        log.warn("[Scheduler] Listener error", { error: err });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(): string {
  // Simple 10-char hex ID matching minion ID convention
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

