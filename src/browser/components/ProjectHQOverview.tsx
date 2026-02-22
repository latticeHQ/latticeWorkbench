/**
 * ProjectHQOverview — Interactive hierarchy canvas for the HQ root page.
 *
 * Sections → Workspaces → Sub-agents, all clickable:
 *  • Click section header  → collapse / expand that section
 *  • Click workspace card  → navigate into that workspace
 *  • Shows CLI agent used per workspace (CliAgentIcon)
 *  • Shows status, cost, tokens, sub-agent roster
 *
 * No SVG connections — clean card-grid layout.
 */
import React, { useMemo, useCallback, useState } from "react";
import { cn } from "@/common/lib/utils";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useWorkspaceContext, toWorkspaceSelection } from "@/browser/contexts/WorkspaceContext";
import {
  useWorkspaceSidebarState,
  useWorkspaceUsage,
} from "@/browser/stores/WorkspaceStore";
import { resolveSectionColor } from "@/common/constants/ui";
import { sortSectionsByLinkedList } from "@/common/utils/sections";
import type { FrontendWorkspaceMetadata } from "@/common/types/workspace";
import type { SectionConfig } from "@/common/types/project";
import {
  CheckCircle2,
  Clock,
  DollarSign,
  Zap,
  Users,
  ArrowRight,
  Layers,
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";
import { Shimmer } from "./ai-elements/shimmer";
import {
  getTotalCost,
  formatCostWithDollar,
} from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";
import { CliAgentIcon } from "./CliAgentIcon";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectHQOverviewProps {
  projectPath: string;
  projectName: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map common agentId/mode values to emojis */
function getAgentEmoji(agentId?: string): string {
  if (!agentId) return "🤖";
  const id = agentId.toLowerCase();
  if (id.includes("explore")) return "🔬";
  if (id.includes("exec"))    return "⚡";
  if (id.includes("plan"))    return "📋";
  if (id.includes("build") || id.includes("code")) return "🔨";
  if (id.includes("test"))    return "🧪";
  if (id.includes("review"))  return "👁";
  if (id.includes("fix"))     return "🔧";
  if (id.includes("research"))return "📚";
  if (id.includes("claude"))  return "✦";
  if (id.includes("gemini"))  return "✧";
  if (id.includes("codex") || id.includes("openai")) return "⬡";
  return "🤖";
}

/** Known CLI provider slugs — used to render icon vs text badge */
const KNOWN_CLI_SLUGS = new Set([
  "claude-code", "codex", "gemini", "github-copilot", "kiro",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Live pulse dot
// ─────────────────────────────────────────────────────────────────────────────

function LiveDot({ size = "md" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span className={cn("relative flex shrink-0", sz)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
      <span className={cn("relative inline-flex rounded-full bg-[var(--color-exec-mode)]", sz)} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent ID badge — shows CLI icon if known, else text pill
// ─────────────────────────────────────────────────────────────────────────────

function AgentBadge({
  agentId,
  size = "sm",
}: {
  agentId: string;
  size?: "xs" | "sm";
}) {
  const isCliSlug = KNOWN_CLI_SLUGS.has(agentId);
  const emoji = getAgentEmoji(agentId);
  const textSize = size === "xs" ? "text-[9px]" : "text-[10px]";

  if (isCliSlug) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border border-border/40 bg-background-secondary/60 px-1.5 py-0.5 font-mono",
          textSize
        )}
      >
        <CliAgentIcon slug={agentId} className="h-2.5 w-2.5 shrink-0 text-foreground/70" />
        <span className="text-foreground/70">{agentId}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-border/40 bg-background-secondary/60 px-1.5 py-0.5 font-mono",
        textSize
      )}
    >
      <span className="leading-none">{emoji}</span>
      <span className="text-foreground/60">{agentId}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-agent row inside workspace card
// ─────────────────────────────────────────────────────────────────────────────

function SubAgentRow({ ws }: { ws: FrontendWorkspaceMetadata }) {
  const state = useWorkspaceSidebarState(ws.id);
  const isStreaming = state.canInterrupt || state.isStarting;
  const isDone = ws.taskStatus === "reported";
  const isQueued = ws.taskStatus === "queued";
  const emoji = getAgentEmoji(ws.agentId);

  return (
    <div className="flex items-center gap-1.5 min-w-0 py-[3px] pl-1.5 rounded hover:bg-white/5 transition-colors">
      <span className="text-[10px] leading-none shrink-0">{emoji}</span>
      <span className="flex-1 min-w-0 truncate text-[9.5px] text-foreground/55">
        {ws.title ?? ws.name}
      </span>
      {ws.agentId && (
        <span className="text-muted/40 text-[8.5px] font-mono shrink-0 hidden sm:block">
          {ws.agentId}
        </span>
      )}
      <span className="shrink-0">
        {isStreaming ? (
          <LiveDot size="sm" />
        ) : isDone ? (
          <CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />
        ) : isQueued ? (
          <span className="h-1.5 w-1.5 rounded-full border border-muted/40 block" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-muted/15 block" />
        )}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace card
// ─────────────────────────────────────────────────────────────────────────────

function WorkspaceCard({
  ws,
  sectionColor,
  children,
  onOpen,
}: {
  ws: FrontendWorkspaceMetadata;
  sectionColor: string;
  children: FrontendWorkspaceMetadata[];
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
}) {
  const state = useWorkspaceSidebarState(ws.id);
  const usage = useWorkspaceUsage(ws.id);

  const isStreaming = state.canInterrupt || state.isStarting;
  const isAwaiting = !isStreaming && state.awaitingUserQuestion;
  const isDone = ws.taskStatus === "reported";
  const isQueued = ws.taskStatus === "queued";
  const isIdle = !isStreaming && !isAwaiting && !isDone && !isQueued;

  const title = ws.title ?? ws.name;
  const cost = getTotalCost(usage.sessionTotal);
  const tokens = usage.totalTokens;
  const activeKids = children.filter(
    (c) => c.taskStatus === "running" || c.taskStatus === "queued"
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ws)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(ws);
      }}
      className={cn(
        "group/ws relative flex flex-col rounded-lg border text-left cursor-pointer overflow-hidden",
        "transition-all duration-150 select-none",
        // base
        "border-border/50 bg-background/70",
        // hover
        "hover:border-border hover:bg-background hover:shadow-md hover:shadow-black/20",
        // streaming
        isStreaming &&
          "border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/4 shadow-sm shadow-[var(--color-exec-mode)]/15",
        // awaiting
        isAwaiting && "border-amber-400/35",
        // done — dimmed
        isDone && "opacity-55",
        // queued — subtle
        isQueued && "border-border/40 opacity-75"
      )}
    >
      {/* Top accent bar */}
      <div
        className="h-[2.5px] w-full shrink-0"
        style={{
          background: isStreaming
            ? "var(--color-exec-mode)"
            : isAwaiting
              ? "#f59e0b"
              : isDone
                ? "var(--color-success)"
                : sectionColor,
          opacity: isIdle ? 0.4 : 0.85,
        }}
      />

      <div className="flex flex-col gap-1.5 p-2.5">
        {/* Title row */}
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-sm leading-none shrink-0 mt-0.5">
            {getAgentEmoji(ws.agentId)}
          </span>
          <span className="flex-1 min-w-0 text-[11.5px] font-semibold text-foreground leading-snug">
            {isStreaming ? (
              <Shimmer colorClass="var(--color-foreground)" className="truncate block">
                {title}
              </Shimmer>
            ) : (
              <span className="truncate block">{title}</span>
            )}
          </span>
          {/* Status indicator */}
          <span className="shrink-0 mt-0.5">
            {isStreaming ? (
              <LiveDot size="sm" />
            ) : isDone ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />
            ) : isAwaiting ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 block" />
            ) : isQueued ? (
              <span className="h-1.5 w-1.5 rounded-full border border-muted/50 block" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-muted/20 block" />
            )}
          </span>
        </div>

        {/* Agent ID badge row */}
        {ws.agentId && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <AgentBadge agentId={ws.agentId} size="xs" />
            {isStreaming && state.agentStatus?.message && (
              <span className="text-[9px] text-muted/55 italic truncate flex-1 min-w-0">
                {state.agentStatus.message}
              </span>
            )}
          </div>
        )}

        {/* Metadata: cost, tokens, time */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {cost !== undefined && cost > 0 && (
            <span className="text-muted/55 text-[9px] flex items-center gap-0.5">
              <DollarSign className="h-2 w-2" />
              {formatCostWithDollar(cost)}
            </span>
          )}
          {tokens > 0 && (
            <span className="text-muted/55 text-[9px] flex items-center gap-0.5">
              <Zap className="h-2 w-2" />
              {formatTokens(tokens)}
            </span>
          )}
          {ws.createdAt && (
            <span className="text-muted/35 text-[9px] flex items-center gap-0.5 ml-auto">
              <Clock className="h-2 w-2" />
              {new Date(ws.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>

        {/* Sub-agents */}
        {children.length > 0 && (
          <div className="border-t border-border/25 pt-1.5 mt-0.5">
            <div className="flex items-center gap-1 text-[9px] text-muted/45 mb-1">
              <Users className="h-2 w-2" />
              <span>
                {children.length} agent{children.length !== 1 ? "s" : ""}
              </span>
              {activeKids.length > 0 && (
                <span className="flex items-center gap-1 text-[var(--color-exec-mode)] ml-auto">
                  <LiveDot size="sm" />
                  {activeKids.length} active
                </span>
              )}
            </div>
            {children.slice(0, 5).map((c) => (
              <SubAgentRow key={c.id} ws={c} />
            ))}
            {children.length > 5 && (
              <span className="text-muted/30 text-[9px] pl-1.5">
                +{children.length - 5} more
              </span>
            )}
          </div>
        )}
      </div>

      {/* Navigate arrow (hover) */}
      <ArrowRight className="absolute right-2 bottom-2 h-3 w-3 text-[var(--color-exec-mode)] opacity-0 group-hover/ws:opacity-70 transition-opacity" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section box — collapsible group
// ─────────────────────────────────────────────────────────────────────────────

function SectionBox({
  section,
  workspaces,
  childrenByParent,
  onOpen,
  collapsed,
  onToggleCollapse,
}: {
  section: SectionConfig;
  workspaces: FrontendWorkspaceMetadata[];
  childrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const color = resolveSectionColor(section.color);
  const hasActive = workspaces.some((ws) => ws.taskStatus === "running");
  const isEmpty = workspaces.length === 0;

  // Unique agent IDs used in this section
  const agentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of workspaces) {
      if (ws.agentId) ids.add(ws.agentId);
    }
    return Array.from(ids).slice(0, 4);
  }, [workspaces]);

  return (
    <div
      className={cn(
        "rounded-xl border overflow-hidden flex flex-col transition-all duration-200",
        isEmpty && "opacity-40"
      )}
      style={{
        borderColor: `${color}30`,
        background: `${color}05`,
        boxShadow: hasActive ? `0 0 0 1px ${color}20, 0 4px 20px ${color}10` : undefined,
      }}
    >
      {/* ── Section header (clickable / collapsible) ── */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className={cn(
          "group/hdr w-full flex items-center gap-2 px-3 py-2.5 border-b text-left",
          "hover:bg-white/5 active:bg-white/8 transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        style={{
          background: `${color}10`,
          borderColor: `${color}22`,
          borderTopWidth: 3,
          borderTopColor: color,
        }}
      >
        {/* Color bullet */}
        <span
          className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/15"
          style={{ backgroundColor: color }}
        />

        {/* Section name */}
        <span
          className={cn(
            "flex-1 min-w-0 text-[10.5px] font-bold uppercase tracking-widest truncate",
            hasActive ? "text-foreground" : "text-foreground/65"
          )}
        >
          {section.name}
        </span>

        {/* Active pulse */}
        {hasActive && <LiveDot size="sm" />}

        {/* Agent IDs used in this section */}
        {agentIds.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {agentIds.map((id) =>
              KNOWN_CLI_SLUGS.has(id) ? (
                <CliAgentIcon
                  key={id}
                  slug={id}
                  className="h-3 w-3 text-foreground/50"
                />
              ) : (
                <span key={id} className="text-[9px] text-foreground/40 font-mono leading-none">
                  {getAgentEmoji(id)}
                </span>
              )
            )}
          </div>
        )}

        {/* Count badge */}
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
          style={{
            background: workspaces.length > 0 ? `${color}18` : "transparent",
            color: workspaces.length > 0 ? color : "var(--color-muted)",
          }}
        >
          {workspaces.length}
        </span>

        {/* Collapse chevron */}
        <span className="shrink-0 text-muted/40 group-hover/hdr:text-muted/70 transition-colors">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* ── Workspace cards ── */}
      {!collapsed && (
        <div className="p-2 flex flex-col gap-1.5">
          {isEmpty ? (
            <div className="flex items-center justify-center py-5">
              <span
                className="text-[10px]"
                style={{ color: `${color}35` }}
              >
                — no missions —
              </span>
            </div>
          ) : (
            workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                sectionColor={color}
                children={childrenByParent.get(ws.id) ?? []}
                onOpen={onOpen}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HQ header card — project name + aggregate stats
// ─────────────────────────────────────────────────────────────────────────────

function HQHeaderCard({
  projectName,
  totalMissions,
  activeMissions,
  totalSubAgents,
  stageCount,
  activeAgentIds,
}: {
  projectName: string;
  totalMissions: number;
  activeMissions: number;
  totalSubAgents: number;
  stageCount: number;
  activeAgentIds: string[];
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-border/40 bg-background-secondary/70 backdrop-blur-sm">
      {/* Left: project name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-exec-mode)]/25 bg-[var(--color-exec-mode)]/8 shrink-0">
          <Layers className="h-4 w-4 text-[var(--color-exec-mode)]" />
        </div>
        <div className="min-w-0">
          <p className="text-foreground text-sm font-bold leading-tight truncate">{projectName}</p>
          <p className="text-muted text-[10px]">HQ — Agent Network</p>
        </div>
      </div>

      {/* Right: stats + active agents */}
      <div className="flex items-center gap-4 text-[11px] shrink-0">
        {/* Active CLI agents */}
        {activeAgentIds.length > 0 && (
          <div className="flex items-center gap-1.5 text-muted/60">
            {activeAgentIds.map((id) =>
              KNOWN_CLI_SLUGS.has(id) ? (
                <CliAgentIcon key={id} slug={id} className="h-3.5 w-3.5 text-foreground/50" />
              ) : (
                <span key={id} className="font-mono text-[10px] text-foreground/40">
                  <Terminal className="h-3 w-3 inline" />
                </span>
              )
            )}
          </div>
        )}

        {activeMissions > 0 && (
          <span className="flex items-center gap-1.5 text-[var(--color-exec-mode)] font-medium">
            <LiveDot size="sm" />
            {activeMissions} active
          </span>
        )}
        <span className="text-muted">
          <strong className="text-foreground">{totalMissions}</strong> missions
        </span>
        {totalSubAgents > 0 && (
          <span className="text-muted">
            <strong className="text-foreground">{totalSubAgents}</strong> sub-agents
          </span>
        )}
        {stageCount > 0 && (
          <span className="text-muted">
            <strong className="text-foreground">{stageCount}</strong> stages
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/** Number of section columns in the grid (responsive via CSS auto-fill) */
const SECTION_MIN_WIDTH = 260; // px

export function ProjectHQOverview({ projectPath, projectName }: ProjectHQOverviewProps) {
  const { projects } = useProjectContext();
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();

  const projectConfig = projects.get(projectPath);
  const sections = useMemo(
    () => sortSectionsByLinkedList(projectConfig?.sections ?? []),
    [projectConfig]
  );

  // Live workspaces for this project (non-archived)
  const projectWorkspaces = useMemo(
    () =>
      Array.from(workspaceMetadata.values()).filter(
        (ws) => ws.projectPath === projectPath && !ws.archivedAt
      ),
    [workspaceMetadata, projectPath]
  );

  const projectWsIds = useMemo(
    () => new Set(projectWorkspaces.map((ws) => ws.id)),
    [projectWorkspaces]
  );

  // Build root vs children hierarchy
  const { rootWorkspaces, childrenByParent } = useMemo(() => {
    const roots: FrontendWorkspaceMetadata[] = [];
    const childMap = new Map<string, FrontendWorkspaceMetadata[]>();
    for (const ws of projectWorkspaces) {
      if (ws.parentWorkspaceId && projectWsIds.has(ws.parentWorkspaceId)) {
        const arr = childMap.get(ws.parentWorkspaceId) ?? [];
        arr.push(ws);
        childMap.set(ws.parentWorkspaceId, arr);
      } else {
        roots.push(ws);
      }
    }
    return { rootWorkspaces: roots, childrenByParent: childMap };
  }, [projectWorkspaces, projectWsIds]);

  // Group root workspaces by section
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
  const activeMissions = rootWorkspaces.filter((ws) => ws.taskStatus === "running").length;
  const totalSubAgents = Array.from(childrenByParent.values()).reduce(
    (s, a) => s + a.length,
    0
  );

  // All unique agentIds used across the whole project
  const allAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of rootWorkspaces) {
      if (ws.agentId) ids.add(ws.agentId);
    }
    return Array.from(ids).slice(0, 6);
  }, [rootWorkspaces]);

  // Collapsed state for sections (starts all expanded)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleOpen = useCallback(
    (ws: FrontendWorkspaceMetadata) => setSelectedWorkspace(toWorkspaceSelection(ws)),
    [setSelectedWorkspace]
  );

  // Nothing to show: no sections configured AND no workspaces yet
  if (rootWorkspaces.length === 0 && sections.length === 0) return null;

  const unsectioned = workspacesBySection.get(null) ?? [];

  return (
    <div
      className="flex flex-col gap-4 w-full"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      {/* ── HQ header bar ── */}
      <HQHeaderCard
        projectName={projectName}
        totalMissions={rootWorkspaces.length}
        activeMissions={activeMissions}
        totalSubAgents={totalSubAgents}
        stageCount={sections.length}
        activeAgentIds={allAgentIds}
      />

      {/* ── Section grid ── */}
      {sections.length > 0 && (
        <div
          className="grid gap-3"
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${SECTION_MIN_WIDTH}px, 1fr))`,
          }}
        >
          {sections.map((section) => (
            <SectionBox
              key={section.id}
              section={section}
              workspaces={workspacesBySection.get(section.id) ?? []}
              childrenByParent={childrenByParent}
              onOpen={handleOpen}
              collapsed={collapsedSections.has(section.id)}
              onToggleCollapse={() => toggleSection(section.id)}
            />
          ))}
        </div>
      )}

      {/* ── Unsectioned workspaces ── */}
      {unsectioned.length > 0 && (
        <div className="rounded-xl border border-border/25 bg-background/35 overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/25 bg-background-secondary/50">
            <span className="h-2 w-2 rounded-full bg-muted/35 shrink-0" />
            <span className="text-muted/55 text-[10.5px] font-bold uppercase tracking-widest flex-1">
              Unsectioned
            </span>
            <span className="text-muted/40 text-[10px] font-semibold tabular-nums">
              {unsectioned.length}
            </span>
          </div>
          {/* Cards */}
          <div
            className="p-2 grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${SECTION_MIN_WIDTH}px, 1fr))`,
            }}
          >
            {unsectioned.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                sectionColor="#6b7280"
                children={childrenByParent.get(ws.id) ?? []}
                onOpen={handleOpen}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state (sections configured but no missions yet) ── */}
      {rootWorkspaces.length === 0 && sections.length > 0 && (
        <p className="text-center text-[11px] text-muted/30 pt-1">
          No missions yet — start one below ↓
        </p>
      )}
    </div>
  );
}
