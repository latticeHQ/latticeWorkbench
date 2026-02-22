/**
 * HomeTab — Team dashboard / agent kanban view for the main area.
 *
 * Shows a live kanban board of the current workspace's child agent workspaces
 * and CLI agent terminal sessions, plus aggregate stats.
 *
 * Columns:  Active → Queued → Done
 */
import React, { useCallback, useMemo, useState } from "react";
import { cn } from "@/common/lib/utils";
import { useWorkspaceContext, toWorkspaceSelection } from "@/browser/contexts/WorkspaceContext";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { resolveSectionColor } from "@/common/constants/ui";
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
  Terminal,
  DollarSign,
  Zap,
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  ArrowRight,
  X,
  Hourglass,
  Layers,
  Sparkles,
  Copy,
  Check,
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
  onCloseSession?: (sessionId: string) => void;
}

type AgentStatus = "streaming" | "running" | "awaiting" | "done" | "queued" | "idle" | "error";

type KanbanItem =
  | { kind: "workspace"; workspace: FrontendWorkspaceMetadata }
  | { kind: "cli"; sessionId: string; meta: EmployeeMeta };

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

function cliToKanbanColumn(status: EmployeeMeta["status"]): "active" | "queued" | "done" {
  if (status === "running") return "active";
  if (status === "done" || status === "error") return "done";
  return "queued";
}

function wsToKanbanColumn(status: AgentStatus): "active" | "queued" | "done" {
  if (status === "streaming" || status === "running") return "active";
  if (status === "done" || status === "awaiting") return "done";
  return "queued";
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
    return <CheckCircle2 className="h-3 w-3 shrink-0 text-[var(--color-success)]" />;
  }
  if (status === "awaiting") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400 block" />;
  }
  if (status === "queued") {
    return <span className="h-2 w-2 shrink-0 rounded-full border border-[var(--color-muted)] block" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />;
  }
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
      <div className="flex shrink-0 flex-col items-center gap-2 pt-0.5">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            "border border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/10"
          )}
        >
          <Sparkles className="h-4 w-4 text-[var(--color-exec-mode)]" />
        </div>
        <StatusDot status={isStreaming ? "streaming" : "idle"} />
      </div>

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
// Kanban agent card — workspace variant
// ─────────────────────────────────────────────────────────────────────────────

function WorkspaceKanbanCard({
  workspace,
  onOpen,
  sectionName,
  sectionColor,
}: {
  workspace: FrontendWorkspaceMetadata;
  onOpen?: (workspace: FrontendWorkspaceMetadata) => void;
  sectionName?: string;
  sectionColor?: string;
}) {
  const usage = useWorkspaceUsage(workspace.id);
  const wsState = useWorkspaceState(workspace.id);
  const status = deriveAgentStatus(workspace.taskStatus, wsState.loading);
  const totalCost = getTotalCost(usage.sessionTotal);
  const totalTokens = usage.totalTokens;
  const emoji = getAgentEmoji(workspace.agentId);
  const title = workspace.title ?? workspace.name;
  const currentActivity = wsState.agentStatus?.message;

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(workspace)}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) onOpen(workspace);
      }}
      className={cn(
        "group/card w-full rounded-lg border p-3 transition-all duration-150 text-left",
        "border-border bg-background",
        (status === "streaming" || status === "running") &&
          "border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/5",
        onOpen && "cursor-pointer hover:border-[var(--color-exec-mode)]/50 hover:shadow-sm"
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base leading-none shrink-0">{emoji}</span>
          <span className="text-foreground truncate text-xs font-semibold">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusDot status={status} />
          {onOpen && (
            <ArrowRight className="h-3 w-3 text-[var(--color-exec-mode)] opacity-0 transition-opacity group-hover/card:opacity-100" />
          )}
        </div>
      </div>

      {/* Agent ID + section badge */}
      <div className="mt-1 flex items-center justify-between gap-2">
        {workspace.agentId && (
          <span className="text-muted truncate text-[10px]">{workspace.agentId}</span>
        )}
        {sectionName && (
          <span className="flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none text-white/40">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: sectionColor ?? "#6b7280" }}
            />
            <span className="truncate max-w-[80px]">{sectionName}</span>
          </span>
        )}
      </div>

      {/* Activity */}
      {currentActivity && (
        <p className="text-muted mt-1.5 line-clamp-2 text-[10px] italic">"{currentActivity}"</p>
      )}

      {/* Metrics */}
      <div className="mt-2 flex items-center gap-2.5 flex-wrap">
        {totalCost !== undefined && totalCost > 0 && (
          <span className="text-muted flex items-center gap-0.5 text-[10px]">
            <DollarSign className="h-2.5 w-2.5" />{formatCostWithDollar(totalCost)}
          </span>
        )}
        {totalTokens > 0 && (
          <span className="text-muted flex items-center gap-0.5 text-[10px]">
            <Zap className="h-2.5 w-2.5" />{formatTokens(totalTokens)} tok
          </span>
        )}
        {workspace.createdAt && (
          <span className="text-muted flex items-center gap-0.5 text-[10px]">
            <Clock className="h-2.5 w-2.5" />
            {new Date(workspace.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban agent card — CLI session variant
// ─────────────────────────────────────────────────────────────────────────────

function CopyableSessionId({ sessionId }: { sessionId: string }) {
  const [copied, setCopied] = useState(false);

  const shortId =
    sessionId.length > 16
      ? `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}`
      : sessionId;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't trigger card click
    void navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : `Copy session ID: ${sessionId}`}
      className={cn(
        "group/copy flex items-center gap-1 rounded px-0.5 transition-colors",
        "hover:bg-border focus:outline-none",
        copied ? "text-[var(--color-success)]" : "text-muted"
      )}
    >
      <span className="font-mono text-[9px] opacity-70 leading-none">
        {shortId}
      </span>
      {copied ? (
        <Check className="h-2 w-2 shrink-0 opacity-80" />
      ) : (
        <Copy className="h-2 w-2 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-60" />
      )}
    </button>
  );
}

function CliKanbanCard({
  sessionId,
  meta,
  onOpen,
  onClose,
}: {
  sessionId: string;
  meta: EmployeeMeta;
  onOpen?: (sessionId: string) => void;
  onClose?: (sessionId: string) => void;
}) {
  const isRunning = meta.status === "running";
  const isDone = meta.status === "done";
  const isError = meta.status === "error";

  return (
    <div
      className={cn(
        "group/cli relative w-full rounded-lg border p-3 transition-all duration-150",
        "border-border bg-background",
        isRunning && "border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/5",
        isError && "border-destructive/30",
        onOpen && "cursor-pointer hover:border-[var(--color-exec-mode)]/50 hover:shadow-sm"
      )}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(sessionId)}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) onOpen(sessionId);
      }}
    >
      {/* Close button */}
      {onClose && (
        <button
          aria-label="Close agent session"
          onClick={(e) => {
            e.stopPropagation();
            onClose(sessionId);
          }}
          className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-border group-hover/cli:opacity-100"
        >
          <X className="h-2.5 w-2.5 text-muted" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 min-w-0 pr-4">
        {meta.slug === "terminal" ? (
          <Terminal className="text-muted h-3.5 w-3.5 shrink-0" />
        ) : (
          <CliAgentIcon slug={meta.slug as EmployeeSlug} className="text-sm shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-xs font-semibold">{meta.label}</span>
          <CopyableSessionId sessionId={sessionId} />
        </div>
        {onOpen && (
          <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-exec-mode)] opacity-0 transition-opacity group-hover/cli:opacity-100" />
        )}
      </div>

      {/* Status */}
      <div className="mt-1.5 flex items-center gap-1.5">
        {isRunning ? (
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-exec-mode)]" />
          </span>
        ) : isDone ? (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-[var(--color-success)]" />
        ) : isError ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-muted)] opacity-30 block" />
        )}
        <span
          className={cn(
            "text-[10px]",
            isRunning ? "text-[var(--color-exec-mode)]"
            : isDone ? "text-[var(--color-success)]"
            : isError ? "text-destructive"
            : "text-muted"
          )}
        >
          {meta.status ?? "idle"}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban column
// ─────────────────────────────────────────────────────────────────────────────

function KanbanColumn({
  title,
  icon,
  count,
  accent,
  children,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  accent?: "orange" | "green" | "muted";
  children?: React.ReactNode;
  emptyText?: string;
}) {
  const accentClass = {
    orange: "text-[var(--color-exec-mode)]",
    green: "text-[var(--color-success)]",
    muted: "text-muted",
  }[accent ?? "muted"];

  const badgeClass = {
    orange: "bg-[var(--color-exec-mode)]/15 text-[var(--color-exec-mode)]",
    green: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
    muted: "bg-border text-muted",
  }[accent ?? "muted"];

  const borderClass = {
    orange: "border-[var(--color-exec-mode)]/20",
    green: "border-[var(--color-success)]/20",
    muted: "border-border",
  }[accent ?? "muted"];

  return (
    <div className={cn("flex flex-col rounded-xl border bg-background-secondary", borderClass)}>
      {/* Column header */}
      <div className={cn("flex items-center gap-2 border-b px-4 py-3", borderClass)}>
        <span className={accentClass}>{icon}</span>
        <span className={cn("text-xs font-semibold uppercase tracking-widest", accentClass)}>{title}</span>
        <span className={cn("ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", badgeClass)}>
          {count}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 overflow-y-auto p-3" style={{ maxHeight: "calc(100vh - 360px)", minHeight: "80px" }}>
        {count === 0 ? (
          <p className="text-muted py-4 text-center text-[11px]">{emptyText ?? "None"}</p>
        ) : (
          children
        )}
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
  onCloseSession,
}: HomeTabProps) {
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();
  const { projects } = useProjectContext();
  const ownUsage = useWorkspaceUsage(workspaceId);
  const ownState = useWorkspaceState(workspaceId);

  const currentWorkspace = workspaceMetadata.get(workspaceId);

  // Flat sectionId → {name, color} from all projects
  const sectionInfoMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const projectConfig of projects.values()) {
      for (const s of projectConfig.sections ?? []) {
        map.set(s.id, { name: s.name, color: resolveSectionColor(s.color) });
      }
    }
    return map;
  }, [projects]);

  // Walk up the parent chain in workspaceMetadata until a sectionId is found.
  // Child/sub-agent workspaces are not assigned sections directly; they inherit
  // from whichever ancestor workspace IS in a section.
  const resolveSection = useCallback(
    (wsId: string, depth = 0): { name: string; color: string } | undefined => {
      if (depth > 5) return undefined; // guard against loops
      const ws = workspaceMetadata.get(wsId);
      if (!ws) return undefined;
      if (ws.sectionId) return sectionInfoMap.get(ws.sectionId);
      if (ws.parentWorkspaceId) return resolveSection(ws.parentWorkspaceId, depth + 1);
      return undefined;
    },
    [workspaceMetadata, sectionInfoMap]
  );

  // Child workspaces spawned by this workspace
  const childWorkspaces = useMemo(
    () =>
      Array.from(workspaceMetadata.values()).filter(
        (ws) => ws.parentWorkspaceId === workspaceId
      ),
    [workspaceMetadata, workspaceId]
  );

  // CLI employee sessions
  const employeeEntries = useMemo(
    () => Array.from(employeeMeta.entries()),
    [employeeMeta]
  );

  // Build kanban buckets
  const kanban = useMemo(() => {
    const active: KanbanItem[] = [];
    const queued: KanbanItem[] = [];
    const done: KanbanItem[] = [];

    for (const ws of childWorkspaces) {
      const wsState_dummy_loading = false; // streaming state handled per-card
      const status = deriveAgentStatus(ws.taskStatus, wsState_dummy_loading);
      const col = wsToKanbanColumn(status);
      const item: KanbanItem = { kind: "workspace", workspace: ws };
      if (col === "active") active.push(item);
      else if (col === "done") done.push(item);
      else queued.push(item);
    }

    for (const [sessionId, meta] of employeeEntries) {
      const col = cliToKanbanColumn(meta.status);
      const item: KanbanItem = { kind: "cli", sessionId, meta };
      if (col === "active") active.push(item);
      else if (col === "done") done.push(item);
      else queued.push(item);
    }

    return { active, queued, done };
  }, [childWorkspaces, employeeEntries]);

  const totalAgents = childWorkspaces.length + employeeEntries.length;
  const ownCost = getTotalCost(ownUsage.sessionTotal);
  const ownTokens = ownUsage.totalTokens;

  const handleOpenWorkspace = useCallback(
    (ws: FrontendWorkspaceMetadata) => {
      setSelectedWorkspace(toWorkspaceSelection(ws));
    },
    [setSelectedWorkspace]
  );

  const hasActivity = totalAgents > 0;

  function renderItem(item: KanbanItem) {
    if (item.kind === "workspace") {
      const section = resolveSection(item.workspace.id);
      return (
        <WorkspaceKanbanCard
          key={item.workspace.id}
          workspace={item.workspace}
          onOpen={handleOpenWorkspace}
          sectionName={section?.name}
          sectionColor={section?.color}
        />
      );
    }
    return (
      <CliKanbanCard
        key={item.sessionId}
        sessionId={item.sessionId}
        meta={item.meta}
        onOpen={onOpenSession}
        onClose={onCloseSession}
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto p-6">
        {/* ── Header ── */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <LayoutDashboard className="text-[var(--color-exec-mode)] h-5 w-5" />
              <h1 className="text-foreground text-xl font-bold">Workspace Dashboard</h1>
            </div>
            <p className="text-muted mt-1 text-sm">
              <span className="font-medium">{projectName}</span>
              {currentWorkspace?.title && (
                <> · <span>{currentWorkspace.title}</span></>
              )}
            </p>
          </div>

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

        {/* ── Stats ── */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
            value={String(kanban.active.length)}
            sub={totalAgents > 0 ? `of ${totalAgents} total` : "none started"}
            accent={kanban.active.length > 0}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Tasks Done"
            value={String(kanban.done.length)}
            sub={totalAgents > 0 ? `of ${totalAgents} tasks` : "no tasks yet"}
          />
        </div>

        {/* ── Orchestrator card ── */}
        <div className="mb-6">
          <OrchestratorCard
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            workspaceTitle={currentWorkspace?.title}
          />
        </div>

        {/* ── Kanban board ── */}
        {hasActivity ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <KanbanColumn
              title="Active"
              icon={<span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-exec-mode)]" /></span>}
              count={kanban.active.length}
              accent="orange"
              emptyText="No agents running"
            >
              {kanban.active.map(renderItem)}
            </KanbanColumn>

            <KanbanColumn
              title="Queued"
              icon={<Hourglass className="h-3.5 w-3.5" />}
              count={kanban.queued.length}
              accent="muted"
              emptyText="Nothing waiting"
            >
              {kanban.queued.map(renderItem)}
            </KanbanColumn>

            <KanbanColumn
              title="Done"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              count={kanban.done.length}
              accent="green"
              emptyText="No completed tasks"
            >
              {kanban.done.map(renderItem)}
            </KanbanColumn>
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/10">
              <Layers className="text-[var(--color-exec-mode)] h-7 w-7 opacity-70" />
            </div>
            <h3 className="text-foreground mb-1 text-base font-semibold">
              Team ready to deploy
            </h3>
            <p className="text-muted max-w-xs text-sm leading-relaxed">
              Start a conversation in PM Chat. When agents are hired or tasks are
              delegated, they'll appear here across three columns — Active, Queued, Done.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
