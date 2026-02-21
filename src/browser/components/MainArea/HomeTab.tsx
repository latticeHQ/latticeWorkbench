/**
 * HomeTab — Team dashboard / agent hierarchy view for the main area.
 *
 * Shows a live tree of the current workspace's child agent workspaces,
 * CLI agent terminal sessions, aggregate stats, and per-agent metrics.
 */
import React, { useCallback, useMemo } from "react";
import { cn } from "@/common/lib/utils";
import { useWorkspaceContext, toWorkspaceSelection } from "@/browser/contexts/WorkspaceContext";
import {
  useWorkspaceUsage,
  useWorkspaceState,
} from "@/browser/stores/WorkspaceStore";
import {
  getTotalCost,
  formatCostWithDollar,
} from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";
import type { FrontendWorkspaceMetadata } from "@/common/types/workspace";
import type { EmployeeMeta } from "./MainAreaTabBar";
import type { EmployeeSlug } from "./AgentPicker";
import { CliAgentIcon } from "@/browser/components/CliAgentIcon";
import {
  LayoutDashboard,
  GitBranch,
  Cpu,
  Terminal,
  DollarSign,
  Zap,
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  ArrowRight,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface HomeTabProps {
  workspaceId: string;
  workspaceName: string;
  projectName: string;
  employeeMeta: Map<string, EmployeeMeta>;
  onOpenSession?: (sessionId: string) => void;
}

type AgentStatus = "streaming" | "running" | "awaiting" | "done" | "queued" | "idle" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function deriveAgentStatus(
  taskStatus: FrontendWorkspaceMetadata["taskStatus"],
  isStreaming: boolean
): AgentStatus {
  if (isStreaming) return "streaming";
  if (taskStatus === "running") return "running";
  if (taskStatus === "awaiting_report") return "awaiting";
  if (taskStatus === "reported") return "done";
  if (taskStatus === "queued") return "queued";
  return "idle";
}

function statusLabel(status: AgentStatus): string {
  switch (status) {
    case "streaming": return "streaming";
    case "running":   return "active";
    case "awaiting":  return "awaiting";
    case "done":      return "done";
    case "queued":    return "queued";
    case "error":     return "error";
    default:          return "idle";
  }
}

function getAgentEmoji(agentId?: string): string {
  if (!agentId) return "🤖";
  if (agentId.includes("explore")) return "🔬";
  if (agentId.includes("exec")) return "⚡";
  if (agentId.includes("plan")) return "📋";
  if (agentId.includes("build") || agentId.includes("code")) return "🔨";
  if (agentId.includes("test")) return "🧪";
  if (agentId.includes("review")) return "👁";
  if (agentId.includes("fix")) return "🔧";
  if (agentId.includes("research")) return "📚";
  return "🤖";
}

// ─────────────────────────────────────────────────────────────────────────────
// Status dot
// ─────────────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "streaming" || status === "running") {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-exec-mode)]" />
      </span>
    );
  }
  if (status === "done") {
    return <span className="text-[var(--color-success)] text-[10px] leading-none font-bold">✓</span>;
  }
  if (status === "awaiting") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 block" />;
  }
  if (status === "queued") {
    return <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-muted)] block" />;
  }
  if (status === "error") {
    return <span className="text-destructive text-[10px] leading-none font-bold">!</span>;
  }
  // idle
  return <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-muted)] opacity-40 block" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-4 transition-colors",
        "border-border bg-background-secondary",
        accent && "border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/5"
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("text-muted", accent && "text-[var(--color-exec-mode)]")}>{icon}</span>
        <span className="text-muted text-[10px] uppercase tracking-widest font-semibold">{label}</span>
      </div>
      <span
        className={cn(
          "text-2xl font-bold tabular-nums leading-none",
          accent ? "text-[var(--color-exec-mode)]" : "text-foreground"
        )}
      >
        {value}
      </span>
      {sub && <span className="text-muted text-[10px]">{sub}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent workspace node (child workspace)
// ─────────────────────────────────────────────────────────────────────────────

function AgentWorkspaceCard({
  workspace,
  isLast,
  depth,
  onOpen,
}: {
  workspace: FrontendWorkspaceMetadata;
  isLast: boolean;
  depth: number;
  onOpen?: (workspace: FrontendWorkspaceMetadata) => void;
}) {
  const usage = useWorkspaceUsage(workspace.id);
  const wsState = useWorkspaceState(workspace.id);
  const status = deriveAgentStatus(workspace.taskStatus, wsState.loading);
  const totalCost = getTotalCost(usage.sessionTotal);
  const totalTokens = usage.totalTokens;
  const emoji = getAgentEmoji(workspace.agentId);
  const title = workspace.title ?? workspace.name;
  const currentActivity = wsState.agentStatus?.message;
  const isActive = status === "streaming" || status === "running";

  return (
    <div className="relative flex items-stretch">
      {/* Tree connector lines */}
      <div className="relative mr-3 flex w-4 shrink-0 flex-col items-center">
        {/* Vertical line */}
        <div
          className={cn(
            "absolute left-1/2 top-0 w-px -translate-x-1/2 bg-border",
            isLast ? "h-5" : "h-full"
          )}
        />
        {/* Horizontal connector */}
        <div className="absolute left-1/2 top-5 h-px w-4 -translate-y-0 bg-border" />
      </div>

      {/* Card (clickable → opens that workspace) */}
      <div
        role={onOpen ? "button" : undefined}
        tabIndex={onOpen ? 0 : undefined}
        onClick={() => onOpen?.(workspace)}
        onKeyDown={(e) => {
          if (onOpen && (e.key === "Enter" || e.key === " ")) onOpen(workspace);
        }}
        className={cn(
          "group/card mb-2 flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-3 transition-all duration-200",
          "border-border bg-background-secondary",
          isActive && "border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/5 shadow-sm",
          onOpen && "cursor-pointer hover:border-[var(--color-exec-mode)]/50 hover:bg-[var(--color-exec-mode)]/5"
        )}
      >
        {/* Emoji + status */}
        <div className="mt-0.5 flex shrink-0 flex-col items-center gap-1.5">
          <span className="text-base leading-none">{emoji}</span>
          <StatusDot status={status} />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-foreground truncate text-sm font-semibold">{title}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                status === "streaming" || status === "running"
                  ? "bg-[var(--color-exec-mode)]/15 text-[var(--color-exec-mode)]"
                  : status === "done"
                    ? "bg-[var(--color-success)]/15 text-[var(--color-success)]"
                    : status === "awaiting"
                      ? "bg-amber-400/15 text-amber-400"
                      : "bg-border text-muted"
              )}
            >
              {statusLabel(status)}
            </span>
          </div>

          {workspace.agentId && (
            <span className="text-muted mt-0.5 block text-[11px]">
              {workspace.agentId}
            </span>
          )}

          {/* Current activity */}
          {currentActivity && (
            <p className="text-muted mt-1 truncate text-[11px] italic">
              "{currentActivity}"
            </p>
          )}

          {/* Metrics row */}
          <div className="mt-2 flex items-center gap-3">
            {totalCost !== undefined && (
              <span className="text-muted flex items-center gap-0.5 text-[11px]">
                <DollarSign className="h-2.5 w-2.5" />
                {totalCost > 0 ? formatCostWithDollar(totalCost) : "$0.00"}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="text-muted flex items-center gap-0.5 text-[11px]">
                <Zap className="h-2.5 w-2.5" />
                {formatTokens(totalTokens)} tok
              </span>
            )}
            {workspace.createdAt && (
              <span className="text-muted flex items-center gap-0.5 text-[11px]">
                <Clock className="h-2.5 w-2.5" />
                {new Date(workspace.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </div>
        </div>

        {/* Open arrow — visible on hover */}
        {onOpen && (
          <div className="mt-1 shrink-0 self-start opacity-0 transition-opacity group-hover/card:opacity-100">
            <ArrowRight className="text-[var(--color-exec-mode)] h-3.5 w-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI employee card (terminal session)
// ─────────────────────────────────────────────────────────────────────────────

function EmployeeCard({
  sessionId,
  meta,
  onOpen,
}: {
  sessionId: string;
  meta: EmployeeMeta;
  onOpen?: (sessionId: string) => void;
}) {
  const isRunning = meta.status === "running";
  const isDone = meta.status === "done";
  const isError = meta.status === "error";

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(sessionId)}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) onOpen(sessionId);
      }}
      className={cn(
        "group/emp flex items-center gap-3 rounded-lg border p-3 transition-all duration-150",
        "border-border bg-background-secondary",
        isRunning && "border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/5",
        onOpen && "cursor-pointer hover:border-[var(--color-exec-mode)]/50"
      )}
    >
      <div className="flex shrink-0 flex-col items-center gap-1">
        {meta.slug === "terminal" ? (
          <Terminal className="text-muted h-4 w-4" />
        ) : (
          <CliAgentIcon slug={meta.slug as EmployeeSlug} className="text-base" />
        )}
        {isRunning ? (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-exec-mode)]" />
          </span>
        ) : isDone ? (
          <CheckCircle2 className="h-3 w-3 text-[var(--color-success)]" />
        ) : isError ? (
          <AlertCircle className="text-destructive h-3 w-3" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-muted)] opacity-30 block" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-xs font-medium">{meta.label}</span>
        <span
          className={cn(
            "text-[10px]",
            isRunning
              ? "text-[var(--color-exec-mode)]"
              : isDone
                ? "text-[var(--color-success)]"
                : isError
                  ? "text-destructive"
                  : "text-muted"
          )}
        >
          {meta.status ?? "idle"}
        </span>
      </div>

      {onOpen && (
        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-exec-mode)] opacity-0 transition-opacity group-hover/emp:opacity-100" />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OrchestratorCard (current workspace / PM)
// ─────────────────────────────────────────────────────────────────────────────

function OrchestratorCard({
  workspaceId,
  workspaceName,
  workspaceTitle,
}: {
  workspaceId: string;
  workspaceName: string;
  workspaceTitle?: string;
}) {
  const wsState = useWorkspaceState(workspaceId);
  const usage = useWorkspaceUsage(workspaceId);
  const isStreaming = wsState.loading;
  const totalCost = getTotalCost(usage.sessionTotal);
  const totalTokens = usage.totalTokens;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 transition-all duration-200",
        "border-border bg-background-secondary",
        isStreaming && "border-[var(--color-exec-mode)]/50 bg-[var(--color-exec-mode)]/8 shadow-md"
      )}
    >
      {/* Icon */}
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg text-base",
            "border border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/10"
          )}
        >
          ✨
        </div>
        <StatusDot status={isStreaming ? "streaming" : "idle"} />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <span className="text-foreground text-sm font-semibold">PM Orchestrator</span>
            <span className="text-muted ml-2 text-xs">{workspaceTitle ?? workspaceName}</span>
          </div>
          {isStreaming && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--color-exec-mode)]/15 text-[var(--color-exec-mode)]">
              streaming
            </span>
          )}
        </div>

        {wsState.agentStatus?.message && (
          <p className="text-muted mt-1 truncate text-[11px] italic">
            "{wsState.agentStatus.message}"
          </p>
        )}

        <div className="mt-2 flex items-center gap-3">
          {totalCost !== undefined && (
            <span className="text-muted flex items-center gap-0.5 text-[11px]">
              <DollarSign className="h-2.5 w-2.5" />
              {totalCost > 0 ? formatCostWithDollar(totalCost) : "$0.00"}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="text-muted flex items-center gap-0.5 text-[11px]">
              <Zap className="h-2.5 w-2.5" />
              {formatTokens(totalTokens)} tok
            </span>
          )}
          {wsState.currentModel && (
            <span className="text-muted text-[11px]">{wsState.currentModel}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main HomeTab
// ─────────────────────────────────────────────────────────────────────────────

export function HomeTab({
  workspaceId,
  workspaceName,
  projectName,
  employeeMeta,
  onOpenSession,
}: HomeTabProps) {
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();
  const ownUsage = useWorkspaceUsage(workspaceId);
  const ownState = useWorkspaceState(workspaceId);

  const currentWorkspace = workspaceMetadata.get(workspaceId);

  // Child workspaces spawned by this workspace
  const childWorkspaces = useMemo(
    () =>
      Array.from(workspaceMetadata.values())
        .filter((ws) => ws.parentWorkspaceId === workspaceId)
        .sort((a, b) => {
          // Sort: running first, then queued, then done
          const order: Record<string, number> = { running: 0, queued: 1, awaiting_report: 2, reported: 3 };
          return (order[a.taskStatus ?? ""] ?? 4) - (order[b.taskStatus ?? ""] ?? 4);
        }),
    [workspaceMetadata, workspaceId]
  );

  // CLI employee sessions
  const employeeEntries = useMemo(
    () => Array.from(employeeMeta.entries()),
    [employeeMeta]
  );

  // Aggregate stats (own workspace only — children shown individually)
  const ownCost = getTotalCost(ownUsage.sessionTotal);
  const ownTokens = ownUsage.totalTokens;

  const runningAgents =
    childWorkspaces.filter((ws) => ws.taskStatus === "running").length +
    employeeEntries.filter(([, m]) => m.status === "running").length +
    (ownState.loading ? 1 : 0);

  const doneAgents = childWorkspaces.filter(
    (ws) => ws.taskStatus === "reported" || ws.taskStatus === "awaiting_report"
  ).length;

  const totalAgents = childWorkspaces.length + employeeEntries.length;

  const hasActivity = childWorkspaces.length > 0 || employeeEntries.length > 0;

  const handleOpenWorkspace = useCallback(
    (ws: FrontendWorkspaceMetadata) => {
      setSelectedWorkspace(toWorkspaceSelection(ws));
    },
    [setSelectedWorkspace]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="text-[var(--color-exec-mode)] h-5 w-5" />
              <h1 className="text-foreground text-xl font-bold">Team Dashboard</h1>
            </div>
            <p className="text-muted mt-1 text-sm">
              <span className="font-medium">{projectName}</span>
              {currentWorkspace?.title && (
                <>
                  {" · "}
                  <span>{currentWorkspace.title}</span>
                </>
              )}
            </p>
          </div>

          {/* Live indicator */}
          {ownState.loading && (
            <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/10 px-3 py-1.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-exec-mode)]" />
              </span>
              <span className="text-[var(--color-exec-mode)] text-xs font-medium">Live</span>
            </div>
          )}
        </div>

        {/* Hero stats */}
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label="Session Cost"
            value={ownCost !== undefined ? formatCostWithDollar(ownCost) : "—"}
            sub="this workspace"
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label="Tokens Used"
            value={ownTokens > 0 ? formatTokens(ownTokens) : "0"}
            sub="total tokens"
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Active Agents"
            value={String(runningAgents)}
            sub={totalAgents > 0 ? `of ${totalAgents} total` : "none started"}
            accent={runningAgents > 0}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Tasks Done"
            value={String(doneAgents)}
            sub={childWorkspaces.length > 0 ? `of ${childWorkspaces.length} tasks` : "no tasks yet"}
          />
        </div>

        {/* Agent hierarchy */}
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <GitBranch className="text-muted h-4 w-4" />
            <h2 className="text-foreground text-sm font-semibold">Agent Hierarchy</h2>
            {childWorkspaces.length > 0 && (
              <span className="bg-border text-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
                {childWorkspaces.length}
              </span>
            )}
          </div>

          {/* Tree */}
          <div className="relative">
            {/* Orchestrator node */}
            <OrchestratorCard
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              workspaceTitle={currentWorkspace?.title}
            />

            {/* Child workspace nodes */}
            {childWorkspaces.length > 0 && (
              <div className="ml-6 mt-1">
                {/* Vertical spine from orchestrator */}
                <div
                  className="relative"
                  style={{ paddingLeft: "1rem" }}
                >
                  {childWorkspaces.map((ws, idx) => (
                    <AgentWorkspaceCard
                      key={ws.id}
                      workspace={ws}
                      isLast={idx === childWorkspaces.length - 1}
                      depth={1}
                      onOpen={handleOpenWorkspace}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {childWorkspaces.length === 0 && (
              <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
                <Cpu className="text-muted mx-auto mb-2 h-6 w-6 opacity-40" />
                <p className="text-muted text-xs">
                  No agent tasks spawned yet. Ask PM Chat to delegate work to agents.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* CLI Agents section */}
        {employeeEntries.length > 0 && (
          <section>
            <div className="mb-3 flex items-center gap-2">
              <Terminal className="text-muted h-4 w-4" />
              <h2 className="text-foreground text-sm font-semibold">CLI Agents</h2>
              <span className="bg-border text-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
                {employeeEntries.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {employeeEntries.map(([sessionId, meta]) => (
                <EmployeeCard
                  key={sessionId}
                  sessionId={sessionId}
                  meta={meta}
                  onOpen={onOpenSession}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty overall state */}
        {!hasActivity && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/10">
              <LayoutDashboard className="text-[var(--color-exec-mode)] h-7 w-7 opacity-70" />
            </div>
            <h3 className="text-foreground mb-1 text-base font-semibold">
              Team ready to deploy
            </h3>
            <p className="text-muted max-w-xs text-sm leading-relaxed">
              Start a conversation in PM Chat. When agents are hired or tasks are delegated,
              they'll appear here in real time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
