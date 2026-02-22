/**
 * ProjectHQOverview — Full hierarchical view of a Headquarter's structure.
 *
 * Shows: Sections → Root Workspaces → Sub-agents
 * with live status, cost, token, and git metadata for every node.
 */
import React, { useMemo, useState, useCallback } from "react";
import { cn } from "@/common/lib/utils";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useWorkspaceContext, toWorkspaceSelection } from "@/browser/contexts/WorkspaceContext";
import {
  useWorkspaceSidebarState,
  useWorkspaceUsage,
} from "@/browser/stores/WorkspaceStore";
import { useGitStatus } from "@/browser/stores/GitStatusStore";
import { resolveSectionColor } from "@/common/constants/ui";
import { sortSectionsByLinkedList } from "@/common/utils/sections";
import type { FrontendWorkspaceMetadata } from "@/common/types/workspace";
import type { SectionConfig } from "@/common/types/project";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  Zap,
  Users,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Layers,
  Inbox,
  Minus,
} from "lucide-react";
import { Shimmer } from "./ai-elements/shimmer";
import { GitStatusIndicator } from "./GitStatusIndicator";
import {
  getTotalCost,
  formatCostWithDollar,
} from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectHQOverviewProps {
  projectPath: string;
  projectName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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
// Live pulse dot
// ─────────────────────────────────────────────────────────────────────────────

function LiveDot({ size = "md" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span className={cn("relative flex shrink-0", sz)}>
      <span
        className={cn(
          "absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60"
        )}
      />
      <span
        className={cn(
          "relative inline-flex rounded-full bg-[var(--color-exec-mode)]",
          sz
        )}
      />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status chip
// ─────────────────────────────────────────────────────────────────────────────

type AgentStatusKind =
  | "streaming"
  | "awaiting"
  | "done"
  | "queued"
  | "creating"
  | "error"
  | "idle";

function StatusChip({ status }: { status: AgentStatusKind }) {
  const cfg: Record<AgentStatusKind, { label: string; cls: string }> = {
    streaming: {
      label: "working",
      cls: "bg-[var(--color-exec-mode)]/15 text-[var(--color-exec-mode)]",
    },
    awaiting: { label: "awaiting", cls: "bg-amber-400/10 text-amber-400" },
    done: {
      label: "done",
      cls: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
    },
    queued: { label: "queued", cls: "bg-border text-muted" },
    creating: { label: "creating", cls: "bg-border text-muted" },
    error: { label: "error", cls: "bg-destructive/10 text-destructive" },
    idle: { label: "idle", cls: "bg-border text-muted" },
  };
  const { label, cls } = cfg[status];
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider",
        cls
      )}
    >
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status indicator dot (icon row)
// ─────────────────────────────────────────────────────────────────────────────

function StatusDotIcon({ status }: { status: AgentStatusKind }) {
  if (status === "streaming")
    return <LiveDot size="sm" />;
  if (status === "done")
    return (
      <CheckCircle2 className="h-3 w-3 shrink-0 text-[var(--color-success)]" />
    );
  if (status === "awaiting")
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 block" />
    );
  if (status === "queued")
    return (
      <span className="h-1.5 w-1.5 shrink-0 rounded-full border border-muted block" />
    );
  if (status === "error")
    return <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />;
  return (
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/30 block" />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-agent row (compact, nested inside parent card)
// ─────────────────────────────────────────────────────────────────────────────

function SubAgentRow({
  ws,
  projectPath,
  depth,
  grandchildren,
  onOpen,
}: {
  ws: FrontendWorkspaceMetadata;
  projectPath: string;
  depth: number;
  grandchildren: FrontendWorkspaceMetadata[];
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
}) {
  const state = useWorkspaceSidebarState(ws.id);
  const usage = useWorkspaceUsage(ws.id);
  const [expanded, setExpanded] = useState(false);

  const isStreaming = state.canInterrupt || state.isStarting;
  const taskStatus = ws.taskStatus;

  const status: AgentStatusKind = isStreaming
    ? "streaming"
    : state.awaitingUserQuestion
      ? "awaiting"
      : taskStatus === "reported"
        ? "done"
        : taskStatus === "queued"
          ? "queued"
          : ws.status === "creating"
            ? "creating"
            : "idle";

  const totalCost = getTotalCost(usage.sessionTotal);
  const totalTokens = usage.totalTokens;
  const emoji = getAgentEmoji(ws.agentId);
  const title = ws.title ?? ws.name;
  const indentPx = Math.min(depth, 3) * 12;

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 rounded hover:bg-hover/40 transition-colors cursor-pointer"
        style={{ paddingLeft: `${8 + indentPx}px`, paddingRight: 8 }}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(ws)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen(ws);
        }}
      >
        {/* Connector line visual */}
        <span className="text-muted/30 text-[10px] leading-none select-none shrink-0">
          {depth === 0 ? "└" : "└"}
        </span>

        {/* Emoji */}
        <span className="text-xs leading-none shrink-0">{emoji}</span>

        {/* Title */}
        <span className="flex-1 min-w-0 truncate text-foreground/80 text-[11px]">
          {isStreaming ? (
            <Shimmer className="truncate" colorClass="var(--color-foreground)">
              {title}
            </Shimmer>
          ) : (
            title
          )}
        </span>

        {/* Metadata chips */}
        <div className="flex shrink-0 items-center gap-2">
          {ws.agentId && (
            <span className="text-muted text-[9px]">{ws.agentId}</span>
          )}
          {totalCost !== undefined && totalCost > 0 && (
            <span className="text-muted flex items-center gap-0.5 text-[9px]">
              <DollarSign className="h-2 w-2" />
              {formatCostWithDollar(totalCost)}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="text-muted flex items-center gap-0.5 text-[9px]">
              <Zap className="h-2 w-2" />
              {formatTokens(totalTokens)}
            </span>
          )}
          <StatusDotIcon status={status} />
        </div>

        {/* Expand grandchildren */}
        {grandchildren.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 text-muted hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* Grandchildren */}
      {expanded &&
        grandchildren.map((gc) => (
          <SubAgentRow
            key={gc.id}
            ws={gc}
            projectPath={projectPath}
            depth={depth + 1}
            grandchildren={[]}
            onOpen={onOpen}
          />
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root workspace card
// ─────────────────────────────────────────────────────────────────────────────

function WorkspaceCard({
  ws,
  projectPath,
  sectionColor,
  children,
  grandchildrenByParent,
  onOpen,
}: {
  ws: FrontendWorkspaceMetadata;
  projectPath: string;
  sectionColor: string;
  children: FrontendWorkspaceMetadata[];
  grandchildrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
}) {
  const state = useWorkspaceSidebarState(ws.id);
  const usage = useWorkspaceUsage(ws.id);
  const gitStatus = useGitStatus(ws.id);
  const [childrenExpanded, setChildrenExpanded] = useState(true);

  const isStreaming = state.canInterrupt || state.isStarting;
  const isAwaiting = !isStreaming && state.awaitingUserQuestion;

  const status: AgentStatusKind = isStreaming
    ? "streaming"
    : isAwaiting
      ? "awaiting"
      : ws.taskStatus === "reported"
        ? "done"
        : ws.taskStatus === "queued"
          ? "queued"
          : ws.status === "creating"
            ? "creating"
            : "idle";

  const title = ws.title ?? ws.name;
  const emoji = getAgentEmoji(ws.agentId);
  const totalCost = getTotalCost(usage.sessionTotal);
  const totalTokens = usage.totalTokens;

  const activeChildren = children.filter(
    (c) => c.taskStatus === "running" || c.taskStatus === "queued"
  );

  return (
    <div
      className={cn(
        "rounded-xl border transition-all duration-150 overflow-hidden",
        "border-border bg-background",
        isStreaming &&
          "border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/5 shadow-sm",
        isAwaiting && "border-amber-400/30"
      )}
      style={
        isStreaming || isAwaiting
          ? undefined
          : { borderLeftColor: sectionColor, borderLeftWidth: 2 }
      }
    >
      {/* Card header — clickable to open workspace */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(ws)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpen(ws);
        }}
        className={cn(
          "group/card flex cursor-pointer items-start gap-3 p-3",
          "hover:bg-hover/30 transition-colors"
        )}
      >
        {/* Emoji + status column */}
        <div className="flex shrink-0 flex-col items-center gap-1.5 pt-0.5">
          <span className="text-base leading-none">{emoji}</span>
          <StatusDotIcon status={status} />
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Title + status row */}
          <div className="flex items-start justify-between gap-2">
            <span className="text-foreground text-sm font-semibold truncate min-w-0 leading-tight">
              {isStreaming ? (
                <Shimmer
                  className="truncate"
                  colorClass="var(--color-foreground)"
                >
                  {title}
                </Shimmer>
              ) : (
                title
              )}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusChip status={status} />
              <ArrowRight className="h-3 w-3 text-muted opacity-0 transition-opacity group-hover/card:opacity-100" />
            </div>
          </div>

          {/* Agent status message */}
          {state.agentStatus?.message && (
            <p className="text-muted mt-0.5 truncate text-[10px] italic">
              &ldquo;{state.agentStatus.message}&rdquo;
            </p>
          )}

          {/* Metadata strip */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {ws.agentId && (
              <span className="text-muted text-[10px] font-mono">
                {ws.agentId}
              </span>
            )}
            {state.currentModel && (
              <span className="text-muted text-[10px]">
                {state.currentModel}
              </span>
            )}
            {totalCost !== undefined && totalCost > 0 && (
              <span className="text-muted flex items-center gap-0.5 text-[10px]">
                <DollarSign className="h-2.5 w-2.5" />
                {formatCostWithDollar(totalCost)}
              </span>
            )}
            {totalTokens > 0 && (
              <span className="text-muted flex items-center gap-0.5 text-[10px]">
                <Zap className="h-2.5 w-2.5" />
                {formatTokens(totalTokens)} tok
              </span>
            )}
            {ws.createdAt && (
              <span className="text-muted flex items-center gap-0.5 text-[10px]">
                <Clock className="h-2.5 w-2.5" />
                {new Date(ws.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
            {gitStatus && (
              <GitStatusIndicator
                gitStatus={gitStatus}
                workspaceId={ws.id}
                projectPath={projectPath}
                tooltipPosition="bottom"
                isWorking={isStreaming}
              />
            )}
            {children.length > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted">
                <Users className="h-2.5 w-2.5" />
                {children.length} sub-agent{children.length > 1 ? "s" : ""}
                {activeChildren.length > 0 && (
                  <span className="text-[var(--color-exec-mode)] ml-0.5">
                    ({activeChildren.length} active)
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sub-agents section */}
      {children.length > 0 && (
        <div className="border-t border-border/40 bg-background-secondary/50">
          <button
            type="button"
            onClick={() => setChildrenExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted hover:text-foreground transition-colors"
          >
            {childrenExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            <span>
              {children.length} sub-agent{children.length > 1 ? "s" : ""}
            </span>
            {activeChildren.length > 0 && (
              <span className="ml-auto flex items-center gap-1 text-[var(--color-exec-mode)]">
                <LiveDot size="sm" />
                {activeChildren.length} active
              </span>
            )}
          </button>

          {childrenExpanded && (
            <div className="pb-2 px-1">
              {children.map((child) => (
                <SubAgentRow
                  key={child.id}
                  ws={child}
                  projectPath={projectPath}
                  depth={0}
                  grandchildren={grandchildrenByParent.get(child.id) ?? []}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section row
// ─────────────────────────────────────────────────────────────────────────────

function SectionRow({
  section,
  workspaces,
  projectPath,
  childrenByParent,
  grandchildrenByParent,
  onOpenWorkspace,
  defaultExpanded,
}: {
  section: SectionConfig;
  workspaces: FrontendWorkspaceMetadata[];
  projectPath: string;
  childrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  grandchildrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpenWorkspace: (ws: FrontendWorkspaceMetadata) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const color = resolveSectionColor(section.color);

  // Count actively-working workspaces via taskStatus (no hooks needed — from metadata)
  const activeCount = workspaces.filter(
    (ws) => ws.taskStatus === "running"
  ).length;

  // Count all sub-agents within this section
  const totalSubAgents = workspaces.reduce(
    (sum, ws) => sum + (childrenByParent.get(ws.id)?.length ?? 0),
    0
  );

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden transition-all duration-150",
        workspaces.length > 0 ? "border-border" : "border-border/50"
      )}
    >
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
          "bg-background-secondary hover:bg-hover/30"
        )}
      >
        {/* Color swatch */}
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10"
          style={{ backgroundColor: color }}
        />

        {/* Section name */}
        <span
          className={cn(
            "flex-1 text-sm font-semibold",
            workspaces.length > 0 ? "text-foreground" : "text-muted"
          )}
        >
          {section.name}
        </span>

        {/* Active indicator */}
        {activeCount > 0 && <LiveDot size="sm" />}

        {/* Sub-agents count */}
        {totalSubAgents > 0 && (
          <span className="text-[10px] text-muted flex items-center gap-0.5">
            <Users className="h-2.5 w-2.5" />
            {totalSubAgents}
          </span>
        )}

        {/* Workspace count badge */}
        <span
          className={cn(
            "min-w-[22px] rounded px-1.5 py-0.5 text-center text-[11px] font-medium tabular-nums",
            workspaces.length > 0
              ? "bg-[var(--color-exec-mode)]/10 text-[var(--color-exec-mode)]"
              : "bg-border/60 text-muted/60"
          )}
        >
          {workspaces.length}
        </span>

        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
      </button>

      {/* Section body */}
      {expanded && (
        <div
          className="p-3 border-t border-border/40"
          style={{ borderLeftColor: color, borderLeftWidth: 3 }}
        >
          {workspaces.length === 0 ? (
            <p className="text-muted/50 py-2 text-center text-[11px]">
              No missions in this section
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
              {workspaces.map((ws) => (
                <WorkspaceCard
                  key={ws.id}
                  ws={ws}
                  projectPath={projectPath}
                  sectionColor={color}
                  children={childrenByParent.get(ws.id) ?? []}
                  grandchildrenByParent={grandchildrenByParent}
                  onOpen={onOpenWorkspace}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate stats bar
// ─────────────────────────────────────────────────────────────────────────────

function StatsBar({
  totalMissions,
  activeMissions,
  totalSubAgents,
  sectionsCount,
}: {
  totalMissions: number;
  activeMissions: number;
  totalSubAgents: number;
  sectionsCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      <span className="flex items-center gap-1">
        <Layers className="h-3 w-3" />
        <span>
          <strong className="text-foreground">{totalMissions}</strong> mission
          {totalMissions !== 1 ? "s" : ""}
        </span>
      </span>
      {activeMissions > 0 && (
        <span className="flex items-center gap-1 text-[var(--color-exec-mode)]">
          <LiveDot size="sm" />
          <strong>{activeMissions}</strong> active
        </span>
      )}
      {totalSubAgents > 0 && (
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          <span>
            <strong className="text-foreground">{totalSubAgents}</strong>{" "}
            sub-agent{totalSubAgents !== 1 ? "s" : ""}
          </span>
        </span>
      )}
      {sectionsCount > 0 && (
        <span className="flex items-center gap-1">
          <Inbox className="h-3 w-3" />
          <span>
            <strong className="text-foreground">{sectionsCount}</strong>{" "}
            section{sectionsCount !== 1 ? "s" : ""}
          </span>
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectHQOverview({
  projectPath,
  projectName,
}: ProjectHQOverviewProps) {
  const { projects } = useProjectContext();
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();

  const projectConfig = projects.get(projectPath);
  const sections = useMemo(
    () => sortSectionsByLinkedList(projectConfig?.sections ?? []),
    [projectConfig]
  );

  // All live (non-archived) workspaces for this project
  const projectWorkspaces = useMemo(
    () =>
      Array.from(workspaceMetadata.values()).filter(
        (ws) =>
          ws.projectPath === projectPath &&
          !ws.archivedAt
      ),
    [workspaceMetadata, projectPath]
  );

  // IDs of all workspaces in this project (for parent-child detection)
  const projectWsIds = useMemo(
    () => new Set(projectWorkspaces.map((ws) => ws.id)),
    [projectWorkspaces]
  );

  // Split: root workspaces vs direct children vs grandchildren
  const { rootWorkspaces, childrenByParent, grandchildrenByParent } =
    useMemo(() => {
      const roots: FrontendWorkspaceMetadata[] = [];
      const directChildren = new Map<string, FrontendWorkspaceMetadata[]>();
      const grandChildren = new Map<string, FrontendWorkspaceMetadata[]>();

      // First pass: identify root vs direct child
      for (const ws of projectWorkspaces) {
        if (ws.parentWorkspaceId && projectWsIds.has(ws.parentWorkspaceId)) {
          const arr = directChildren.get(ws.parentWorkspaceId) ?? [];
          arr.push(ws);
          directChildren.set(ws.parentWorkspaceId, arr);
        } else {
          roots.push(ws);
        }
      }

      // Second pass: among direct children, find grandchildren
      // (children whose parent is itself a child)
      const directChildIds = new Set(
        Array.from(directChildren.values())
          .flat()
          .map((ws) => ws.id)
      );

      for (const [parentId, kids] of directChildren) {
        const trueKids: FrontendWorkspaceMetadata[] = [];
        for (const kid of kids) {
          if (
            kid.parentWorkspaceId &&
            directChildIds.has(kid.parentWorkspaceId)
          ) {
            // This is a grandchild — attach to its direct parent
            const gcArr = grandChildren.get(kid.parentWorkspaceId) ?? [];
            gcArr.push(kid);
            grandChildren.set(kid.parentWorkspaceId, gcArr);
          } else {
            trueKids.push(kid);
          }
        }
        directChildren.set(parentId, trueKids);
      }

      return {
        rootWorkspaces: roots,
        childrenByParent: directChildren,
        grandchildrenByParent: grandChildren,
      };
    }, [projectWorkspaces, projectWsIds]);

  // Group root workspaces by their sectionId
  const workspacesBySection = useMemo(() => {
    const map = new Map<string | null, FrontendWorkspaceMetadata[]>();
    for (const ws of rootWorkspaces) {
      const sid = ws.sectionId ?? null;
      const arr = map.get(sid) ?? [];
      arr.push(ws);
      map.set(sid, arr);
    }
    return map;
  }, [rootWorkspaces]);

  // Aggregate stats
  const activeMissions = useMemo(
    () => rootWorkspaces.filter((ws) => ws.taskStatus === "running").length,
    [rootWorkspaces]
  );

  const totalSubAgents = useMemo(
    () =>
      Array.from(childrenByParent.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
    [childrenByParent]
  );

  const handleOpen = useCallback(
    (ws: FrontendWorkspaceMetadata) => {
      setSelectedWorkspace(toWorkspaceSelection(ws));
    },
    [setSelectedWorkspace]
  );

  const unsectioned = workspacesBySection.get(null) ?? [];

  // Only render if there's something to show
  if (rootWorkspaces.length === 0 && sections.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[var(--color-exec-mode)] shrink-0" />
          <span className="text-foreground text-sm font-semibold">
            HQ Structure — {projectName}
          </span>
        </div>
        <StatsBar
          totalMissions={rootWorkspaces.length}
          activeMissions={activeMissions}
          totalSubAgents={totalSubAgents}
          sectionsCount={sections.length}
        />
      </div>

      {/* Sections */}
      {sections.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {sections.map((section) => (
            <SectionRow
              key={section.id}
              section={section}
              workspaces={workspacesBySection.get(section.id) ?? []}
              projectPath={projectPath}
              childrenByParent={childrenByParent}
              grandchildrenByParent={grandchildrenByParent}
              onOpenWorkspace={handleOpen}
              defaultExpanded={
                (workspacesBySection.get(section.id)?.length ?? 0) > 0
              }
            />
          ))}
        </div>
      )}

      {/* Unsectioned workspaces */}
      {unsectioned.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-2.5 bg-background-secondary border-b border-border/40">
            <Minus className="h-2.5 w-2.5 shrink-0 text-muted/50" />
            <span className="flex-1 text-sm font-semibold text-muted">
              Unsectioned
            </span>
            <span className="rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums bg-border/60 text-muted/60">
              {unsectioned.length}
            </span>
          </div>
          <div className="p-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
            {unsectioned.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                projectPath={projectPath}
                sectionColor="#6b7280"
                children={childrenByParent.get(ws.id) ?? []}
                grandchildrenByParent={grandchildrenByParent}
                onOpen={handleOpen}
              />
            ))}
          </div>
        </div>
      )}

      {/* No workspaces yet (but sections exist) */}
      {rootWorkspaces.length === 0 && sections.length > 0 && (
        <p className="text-muted/40 py-2 text-center text-xs">
          No active missions — start one below ↓
        </p>
      )}
    </div>
  );
}
