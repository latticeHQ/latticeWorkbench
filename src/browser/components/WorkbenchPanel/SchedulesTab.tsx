/**
 * SchedulesTab — UI for managing cron/interval scheduled agent jobs.
 *
 * Three views:
 * 1. Job list (default) — cards with enable/disable toggle, "Run Now" button
 * 2. Create/edit form — inline form for adding or editing a job
 * 3. Run history — expandable per-job history of recent executions
 */

import { useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type {
  ScheduledJobWithState,
  ScheduledJobRun,
  ScheduleConfig,
} from "@/common/types/scheduler";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { formatModelDisplayName } from "@/common/utils/ai/modelDisplay";

/** Built-in model options for the schedule form model picker. */
const MODEL_OPTIONS = Object.values(KNOWN_MODELS).map((m) => ({
  id: m.id,
  label: formatModelDisplayName(m.id),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Human-readable description of a schedule config. */
function describeSchedule(schedule: ScheduleConfig): string {
  if (schedule.kind === "cron") {
    return `Cron: ${schedule.expression}${schedule.timezone ? ` (${schedule.timezone})` : ""}`;
  }
  const ms = schedule.everyMs;
  if (ms < 60_000) return `Every ${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `Every ${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.round((ms % 3_600_000) / 60_000);
  return mins > 0 ? `Every ${hours}h ${mins}m` : `Every ${hours}h`;
}

/** Format epoch ms to a compact relative time string. */
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  ok: "var(--color-success)",
  error: "var(--color-danger)",
  skipped: "var(--color-warning)",
  running: "var(--color-accent)",
};

// ---------------------------------------------------------------------------
// Job Card
// ---------------------------------------------------------------------------

interface JobCardProps {
  job: ScheduledJobWithState;
  onToggle: (id: string, enabled: boolean) => void | Promise<void>;
  onRunNow: (id: string) => void | Promise<void>;
  onEdit: (job: ScheduledJobWithState) => void;
  onDelete: (id: string) => void | Promise<void>;
  expanded: boolean;
  onToggleExpand: () => void;
  history: ScheduledJobRun[];
}

function JobCard(props: JobCardProps) {
  const statusColor = props.job.enabled
    ? "var(--color-success)"
    : "var(--color-muted)";

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--color-border)" }}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-center gap-2 px-3 py-2"
        style={{
          background: "color-mix(in srgb, var(--color-bg-secondary), transparent 40%)",
        }}
        onClick={props.onToggleExpand}
      >
        {/* Status dot */}
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: statusColor }}
        />

        {/* Name */}
        <span className="truncate text-xs font-medium text-[var(--color-text)]">
          {props.job.name}
        </span>

        {/* Schedule description */}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-muted)]">
          {describeSchedule(props.job.schedule)}
        </span>

        {/* Expand chevron */}
        {props.expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-muted)]" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-muted)]" />
        )}
      </div>

      {/* State summary bar */}
      <div
        className="flex items-center gap-2 border-t px-3 py-1"
        style={{ borderColor: "var(--color-border)" }}
      >
        {props.job.state.lastStatus && (
          <span className="flex items-center gap-1 text-[10px]">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor:
                  STATUS_COLORS[props.job.state.lastStatus] ?? "var(--color-muted)",
              }}
            />
            <span className="text-[var(--color-muted)]">
              {props.job.state.lastRunAtMs
                ? formatRelativeTime(props.job.state.lastRunAtMs)
                : "never"}
            </span>
          </span>
        )}

        {props.job.state.consecutiveErrors > 0 && (
          <span className="text-[10px] text-[var(--color-danger)]">
            {props.job.state.consecutiveErrors} errors
          </span>
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1">
          {/* Toggle enable/disable */}
          <button
            type="button"
            className="rounded p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            onClick={(e) => {
              e.stopPropagation();
              void props.onToggle(props.job.id, !props.job.enabled);
            }}
            title={props.job.enabled ? "Disable" : "Enable"}
          >
            {props.job.enabled ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </button>

          {/* Run Now */}
          <button
            type="button"
            className="rounded p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
            onClick={(e) => {
              e.stopPropagation();
              void props.onRunNow(props.job.id);
            }}
            title="Run Now"
          >
            <Play className="h-3 w-3" />
          </button>

          {/* Delete */}
          <button
            type="button"
            className="rounded p-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)]"
            onClick={(e) => {
              e.stopPropagation();
              void props.onDelete(props.job.id);
            }}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {props.expanded && (
        <div
          className="border-t px-3 py-2 text-[11px]"
          style={{ borderColor: "var(--color-border)" }}
        >
          {/* Prompt preview */}
          <div className="mb-2">
            <span className="text-[10px] font-medium tracking-wider text-[var(--color-muted)] uppercase">
              Prompt
            </span>
            <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[var(--color-text)]">
              {props.job.prompt}
            </p>
          </div>

          {/* Edit button */}
          <button
            type="button"
            className="mb-2 rounded border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            onClick={() => props.onEdit(props.job)}
          >
            Edit
          </button>

          {/* Run history */}
          {props.history.length > 0 && (
            <div>
              <span className="text-[10px] font-medium tracking-wider text-[var(--color-muted)] uppercase">
                Recent Runs
              </span>
              <ul className="mt-1 flex flex-col gap-0.5">
                {props.history.slice(-5).reverse().map((run, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[10px]">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          STATUS_COLORS[run.status] ?? "var(--color-muted)",
                      }}
                    />
                    <span className="text-[var(--color-muted)]">
                      {formatRelativeTime(run.startedAt)}
                    </span>
                    {run.finishedAt && (
                      <span className="font-mono text-[var(--color-dim)]">
                        {Math.round((run.finishedAt - run.startedAt) / 1000)}s
                      </span>
                    )}
                    {run.error && (
                      <span className="truncate text-[var(--color-danger)]" title={run.error}>
                        {run.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Error detail */}
          {props.job.state.lastError && (
            <div className="mt-1 rounded bg-[var(--color-danger-bg)] p-1.5 text-[10px] text-[var(--color-danger)]">
              {props.job.state.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / Edit Form
// ---------------------------------------------------------------------------

interface JobFormData {
  name: string;
  minionId: string;
  prompt: string;
  model?: string | null;
  schedule: ScheduleConfig;
  enabled: boolean;
}

interface JobFormProps {
  initial?: ScheduledJobWithState;
  minionId: string;
  onSave: (data: JobFormData) => void | Promise<void>;
  onCancel: () => void;
}

function JobForm(props: JobFormProps) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [prompt, setPrompt] = useState(props.initial?.prompt ?? "");
  const [scheduleKind, setScheduleKind] = useState<"cron" | "interval">(
    props.initial?.schedule.kind ?? "interval",
  );
  const [cronExpr, setCronExpr] = useState(
    props.initial?.schedule.kind === "cron" ? props.initial.schedule.expression : "0 */6 * * *",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(
    props.initial?.schedule.kind === "interval"
      ? Math.round(props.initial.schedule.everyMs / 60_000)
      : 30,
  );
  const [enabled, setEnabled] = useState(props.initial?.enabled ?? true);
  // Empty string = "use minion default" (no override)
  const [model, setModel] = useState(props.initial?.model ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const schedule: ScheduleConfig =
      scheduleKind === "cron"
        ? { kind: "cron", expression: cronExpr }
        : { kind: "interval", everyMs: intervalMinutes * 60_000 };

    void props.onSave({
      name,
      minionId: props.minionId,
      prompt,
      // null = clear override, undefined = no change; empty string → null (use default)
      model: model || null,
      schedule,
      enabled,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text)]">
          {props.initial ? "Edit Schedule" : "New Schedule"}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          onClick={props.onCancel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Name */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Job name"
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-dim)] focus:border-[var(--color-accent)] focus:outline-none"
        required
      />

      {/* Prompt */}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Agent prompt..."
        rows={3}
        className="resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-dim)] focus:border-[var(--color-accent)] focus:outline-none"
        required
      />

      {/* Model selector */}
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
      >
        <option value="">Default model</option>
        {MODEL_OPTIONS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>

      {/* Schedule type toggle */}
      <div className="flex gap-1">
        <button
          type="button"
          className={cn(
            "rounded px-2 py-0.5 text-[10px] border",
            scheduleKind === "interval"
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-muted)]",
          )}
          onClick={() => setScheduleKind("interval")}
        >
          Interval
        </button>
        <button
          type="button"
          className={cn(
            "rounded px-2 py-0.5 text-[10px] border",
            scheduleKind === "cron"
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-muted)]",
          )}
          onClick={() => setScheduleKind("cron")}
        >
          Cron
        </button>
      </div>

      {/* Schedule input */}
      {scheduleKind === "interval" ? (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-muted)]">Every</span>
          <input
            type="number"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 1))}
            min={1}
            className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-xs text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <span className="text-[10px] text-[var(--color-muted)]">minutes</span>
        </div>
      ) : (
        <input
          type="text"
          value={cronExpr}
          onChange={(e) => setCronExpr(e.target.value)}
          placeholder="0 */6 * * *"
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 font-mono text-xs text-[var(--color-text)] placeholder:text-[var(--color-dim)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      )}

      {/* Enable toggle */}
      <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3 w-3"
        />
        Enabled
      </label>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="flex items-center gap-1 rounded bg-[var(--color-accent)] px-2 py-1 text-[10px] font-medium text-white"
        >
          <Check className="h-3 w-3" />
          Save
        </button>
        <button
          type="button"
          className="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)]"
          onClick={props.onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Tab Component
// ---------------------------------------------------------------------------

interface SchedulesTabProps {
  minionId: string;
  projectPath: string;
}

export function SchedulesTab(props: SchedulesTabProps) {
  const { api } = useAPI();
  const [jobs, setJobs] = useState<ScheduledJobWithState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledJobWithState | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, ScheduledJobRun[]>>({});

  // Load jobs + subscribe to updates
  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await api!.scheduler.list({ projectPath: props.projectPath });
        if (!cancelled) {
          setJobs(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load schedules");
          console.error("SchedulesTab: failed to load jobs:", err);
        }
      }
    }

    async function subscribe() {
      try {
        const stream = await api!.scheduler.subscribe(
          { projectPath: props.projectPath },
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setJobs(snapshot);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("SchedulesTab: subscription error:", err);
        }
      }
    }

    void load();
    void subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api, props.projectPath]);

  // Load history when a job is expanded
  useEffect(() => {
    if (!expandedId || !api) return;
    void api.scheduler.history({ jobId: expandedId }).then((runs) => {
      setHistoryMap((prev) => ({ ...prev, [expandedId]: runs }));
    });
  }, [api, expandedId]);

  async function handleCreate(data: JobFormData) {
    if (!api) return;
    try {
      await api.scheduler.create({
        projectPath: props.projectPath,
        ...data,
      });
      setCreating(false);
    } catch (err) {
      console.error("SchedulesTab: create failed:", err);
    }
  }

  async function handleUpdate(data: JobFormData) {
    if (!api || !editing) return;
    try {
      await api.scheduler.update({
        id: editing.id,
        name: data.name,
        minionId: data.minionId,
        prompt: data.prompt,
        model: data.model,
        schedule: data.schedule,
        enabled: data.enabled,
      });
      setEditing(null);
    } catch (err) {
      console.error("SchedulesTab: update failed:", err);
    }
  }

  async function handleToggle(id: string, enabled: boolean) {
    if (!api) return;
    try {
      await api.scheduler.update({ id, enabled });
    } catch (err) {
      console.error("SchedulesTab: toggle failed:", err);
    }
  }

  async function handleRunNow(id: string) {
    if (!api) return;
    try {
      await api.scheduler.run({ id });
    } catch (err) {
      console.error("SchedulesTab: run failed:", err);
    }
  }

  async function handleDelete(id: string) {
    if (!api) return;
    try {
      await api.scheduler.remove({ id });
    } catch (err) {
      console.error("SchedulesTab: delete failed:", err);
    }
  }

  // Show form if creating or editing
  if (creating) {
    return (
      <JobForm
        minionId={props.minionId}
        onSave={handleCreate}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (editing) {
    return (
      <JobForm
        initial={editing}
        minionId={props.minionId}
        onSave={handleUpdate}
        onCancel={() => setEditing(null)}
      />
    );
  }

  if (error) {
    return (
      <div className="text-danger flex h-full items-center justify-center p-4 text-xs">
        {error}
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <Clock className="h-8 w-8 text-[var(--color-muted)] opacity-30" />
        <p className="text-xs text-[var(--color-muted)]">No scheduled jobs</p>
        <p className="max-w-[200px] text-center text-[10px] text-[var(--color-dim)]">
          Create a schedule to run agent tasks automatically on a cron or interval
        </p>
        <button
          type="button"
          className="mt-2 flex items-center gap-1 rounded bg-[var(--color-accent)] px-2 py-1 text-[10px] font-medium text-white"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3 w-3" />
          New Schedule
        </button>
      </div>
    );
  }

  const enabledCount = jobs.filter((j) => j.enabled).length;

  return (
    <div className="flex h-full flex-col">
      {/* Summary header */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 font-mono text-[10px] tracking-wider text-[var(--color-muted)]">
        <span>
          {jobs.length} schedule{jobs.length !== 1 ? "s" : ""}
        </span>
        {enabledCount > 0 && (
          <span className="text-[var(--color-success)]">
            {enabledCount} active
          </span>
        )}
        <button
          type="button"
          className="ml-auto rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          onClick={() => setCreating(true)}
          title="New Schedule"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Job cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onToggle={handleToggle}
            onRunNow={handleRunNow}
            onEdit={setEditing}
            onDelete={handleDelete}
            expanded={expandedId === job.id}
            onToggleExpand={() =>
              setExpandedId((prev) => (prev === job.id ? null : job.id))
            }
            history={historyMap[job.id] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
