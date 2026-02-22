/**
 * ProjectHQOverview — Layered pipeline architecture dashboard.
 *
 * Visualizes the agent network as a multi-layer pipeline:
 *   Sections → pipeline LAYERS  (each shown as a full-width band)
 *   Workspaces → parallel WORKTREES (side-by-side cards inside each layer)
 *   Sub-agents → PIPELINE STEPS (Explorer → Planner → Coder → Tester)
 *
 * All nodes are clickable:
 *   • Click worktree card  → navigate into that workspace
 *   • Click layer header   → collapse / expand
 *
 * No SVG. Pure CSS + React state.
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
  ChevronDown,
  ChevronRight,
  ArrowDown,
  Layers,
  Activity,
} from "lucide-react";
import { Shimmer } from "./ai-elements/shimmer";
import {
  getTotalCost,
  formatCostWithDollar,
} from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";
import { CliAgentIcon } from "./CliAgentIcon";

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline step classification
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineStep {
  order: number;
  icon: string;
  label: string;
}

function classifyPipelineStep(agentId?: string): PipelineStep {
  if (!agentId) return { order: 99, icon: "🤖", label: "Agent" };
  const id = agentId.toLowerCase();

  if (id.includes("explor"))   return { order: 0, icon: "🔍", label: "Explorer" };
  if (id.includes("research")) return { order: 0, icon: "📚", label: "Researcher" };
  if (id.includes("plan"))     return { order: 1, icon: "📐", label: "Planner" };
  if (id.includes("arch"))     return { order: 1, icon: "🏗️", label: "Architect" };
  if (id.includes("cod"))      return { order: 2, icon: "✍️",  label: "Coder" };
  if (id.includes("build"))    return { order: 2, icon: "🔨", label: "Builder" };
  if (id.includes("impl"))     return { order: 2, icon: "⚙️",  label: "Implementer" };
  if (id.includes("exec"))     return { order: 2, icon: "⚡", label: "Executor" };
  if (id.includes("test"))     return { order: 3, icon: "🧪", label: "Tester" };
  if (id.includes("review"))   return { order: 4, icon: "👁️",  label: "Reviewer" };
  if (id.includes("qa"))       return { order: 4, icon: "🛡️",  label: "QA" };
  if (id.includes("fix"))      return { order: 3, icon: "🔧", label: "Fixer" };
  if (id.includes("deploy"))   return { order: 5, icon: "🚀", label: "Deployer" };

  // CLI providers — treat as executor
  if (id.includes("claude"))   return { order: 2, icon: "✦",  label: "Claude" };
  if (id.includes("gemini"))   return { order: 2, icon: "✧",  label: "Gemini" };
  if (id.includes("codex") || id.includes("openai")) return { order: 2, icon: "⬡", label: "Codex" };

  return { order: 99, icon: "🤖", label: agentId };
}

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
// Pipeline step row inside a worktree card
// ─────────────────────────────────────────────────────────────────────────────

function StepRow({
  ws,
  isLast,
  layerColor,
}: {
  ws: FrontendWorkspaceMetadata;
  isLast: boolean;
  layerColor: string;
}) {
  const state = useWorkspaceSidebarState(ws.id);
  const step = classifyPipelineStep(ws.agentId);
  const isStreaming = state.canInterrupt || state.isStarting;
  const isDone = ws.taskStatus === "reported";
  const isQueued = ws.taskStatus === "queued";

  return (
    <div className={cn("flex items-center gap-2 relative", !isLast && "pb-0.5")}>
      {/* Vertical connector */}
      {!isLast && (
        <div
          className="absolute left-[9px] top-4 w-px bottom-0"
          style={{ background: `${layerColor}25` }}
        />
      )}

      {/* Step icon circle */}
      <div
        className={cn(
          "relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] leading-none",
          isStreaming
            ? "border-[var(--color-exec-mode)]/60 bg-[var(--color-exec-mode)]/15 shadow-[0_0_6px_var(--color-exec-mode)/30]"
            : isDone
              ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10"
              : "border-border/50 bg-background/60"
        )}
      >
        {step.icon}
      </div>

      {/* Step label + status */}
      <div className="flex flex-1 min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "text-[9.5px] font-medium truncate",
            isStreaming ? "text-foreground" : isDone ? "text-foreground/55" : "text-foreground/45"
          )}
        >
          {step.label}
        </span>

        {ws.agentId && KNOWN_CLI_SLUGS.has(ws.agentId) && (
          <CliAgentIcon slug={ws.agentId} className="h-2.5 w-2.5 text-foreground/30 shrink-0" />
        )}

        {/* Status indicator */}
        <span className="ml-auto shrink-0">
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Worktree card (one workspace + its pipeline steps)
// ─────────────────────────────────────────────────────────────────────────────

function WorktreeCard({
  ws,
  subAgents,
  layerColor,
  onOpen,
}: {
  ws: FrontendWorkspaceMetadata;
  subAgents: FrontendWorkspaceMetadata[];
  layerColor: string;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
}) {
  const state = useWorkspaceSidebarState(ws.id);
  const usage = useWorkspaceUsage(ws.id);

  const isStreaming = state.canInterrupt || state.isStarting;
  const isAwaiting = !isStreaming && state.awaitingUserQuestion;
  const isDone = ws.taskStatus === "reported";
  const isQueued = ws.taskStatus === "queued";

  const title = ws.title ?? ws.name;
  const cost = getTotalCost(usage.sessionTotal);
  const tokens = usage.totalTokens;

  // Sort sub-agents by pipeline order
  const sortedSteps = useMemo(
    () =>
      [...subAgents].sort(
        (a, b) => classifyPipelineStep(a.agentId).order - classifyPipelineStep(b.agentId).order
      ),
    [subAgents]
  );

  // Active pipeline step — derived from taskStatus (no hook needed)
  const activeStepWs = sortedSteps.find((s) => s.taskStatus === "running");
  const activePipelineStep = activeStepWs
    ? classifyPipelineStep(activeStepWs.agentId)
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(ws)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen(ws);
      }}
      className={cn(
        "group/wt relative flex flex-col rounded-lg border cursor-pointer select-none",
        "w-52 min-w-[208px] shrink-0 overflow-hidden",
        "transition-all duration-150",
        "border-border/45 bg-background/60",
        "hover:border-border hover:bg-background hover:shadow-lg hover:shadow-black/20",
        isStreaming && [
          "border-[var(--color-exec-mode)]/35",
          "bg-[var(--color-exec-mode)]/3",
          "shadow-sm shadow-[var(--color-exec-mode)]/10",
        ],
        isAwaiting && "border-amber-400/30",
        isDone && "opacity-50"
      )}
    >
      {/* Top accent bar */}
      <div
        className="h-[2px] w-full shrink-0"
        style={{
          background: isStreaming
            ? "var(--color-exec-mode)"
            : isAwaiting
              ? "#f59e0b"
              : isDone
                ? "var(--color-success)"
                : layerColor,
          opacity: isDone ? 0.3 : isStreaming ? 1 : 0.6,
        }}
      />

      {/* Card header */}
      <div className="px-2.5 pt-2 pb-1.5">
        {/* Title */}
        <div className="flex items-start gap-1.5 min-w-0">
          <span className="flex-1 min-w-0 text-[10.5px] font-semibold text-foreground leading-snug">
            {isStreaming ? (
              <Shimmer colorClass="var(--color-foreground)" className="block truncate">
                {title}
              </Shimmer>
            ) : (
              <span className="block truncate">{title}</span>
            )}
          </span>
          {/* Status */}
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
              <span className="h-1.5 w-1.5 rounded-full bg-muted/15 block" />
            )}
          </span>
        </div>

        {/* CLI agent + active step */}
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {ws.agentId && KNOWN_CLI_SLUGS.has(ws.agentId) && (
            <span className="flex items-center gap-0.5 text-[8.5px] text-foreground/40 font-mono">
              <CliAgentIcon slug={ws.agentId} className="h-2.5 w-2.5" />
              {ws.agentId}
            </span>
          )}
          {ws.agentId && !KNOWN_CLI_SLUGS.has(ws.agentId) && (
            <span className="text-[8.5px] text-foreground/35 font-mono">{ws.agentId}</span>
          )}
          {activePipelineStep && (
            <span className="text-[8.5px] text-[var(--color-exec-mode)] ml-auto">
              {activePipelineStep.icon} {activePipelineStep.label}
            </span>
          )}
        </div>

        {/* Cost + tokens */}
        {(cost > 0 || tokens > 0) && (
          <div className="flex items-center gap-2 mt-1">
            {cost > 0 && (
              <span className="text-[8.5px] text-muted/50 flex items-center gap-0.5">
                <DollarSign className="h-2 w-2" />{formatCostWithDollar(cost)}
              </span>
            )}
            {tokens > 0 && (
              <span className="text-[8.5px] text-muted/50 flex items-center gap-0.5">
                <Zap className="h-2 w-2" />{formatTokens(tokens)}
              </span>
            )}
            {ws.createdAt && (
              <span className="text-[8px] text-muted/30 ml-auto flex items-center gap-0.5">
                <Clock className="h-1.5 w-1.5" />
                {new Date(ws.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Pipeline steps */}
      {sortedSteps.length > 0 && (
        <div
          className="mx-2.5 mb-2 border-t pt-2 flex flex-col gap-0.5"
          style={{ borderColor: `${layerColor}20` }}
        >
          {sortedSteps.map((step, i) => (
            <StepRow
              key={step.id}
              ws={step}
              isLast={i === sortedSteps.length - 1}
              layerColor={layerColor}
            />
          ))}
        </div>
      )}

      {/* No sub-agents: show single self-step */}
      {sortedSteps.length === 0 && ws.agentId && (
        <div
          className="mx-2.5 mb-2 border-t pt-2"
          style={{ borderColor: `${layerColor}20` }}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px]",
                isStreaming
                  ? "border-[var(--color-exec-mode)]/50 bg-[var(--color-exec-mode)]/12"
                  : "border-border/40 bg-background/50"
              )}
            >
              {classifyPipelineStep(ws.agentId).icon}
            </div>
            <span className="text-[9.5px] text-foreground/40 truncate">
              {classifyPipelineStep(ws.agentId).label}
            </span>
            <span className="ml-auto shrink-0">
              {isStreaming ? (
                <LiveDot size="sm" />
              ) : isDone ? (
                <CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-muted/15 block" />
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer band — one full-width pipeline layer
// ─────────────────────────────────────────────────────────────────────────────

function LayerBand({
  section,
  workspaces,
  childrenByParent,
  onOpen,
  stageIndex,
  totalStages,
  collapsed,
  onToggle,
}: {
  section: SectionConfig;
  workspaces: FrontendWorkspaceMetadata[];
  childrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
  stageIndex: number;
  totalStages: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const color = resolveSectionColor(section.color);
  const hasActive = workspaces.some((ws) => ws.taskStatus === "running");
  const isEmpty = workspaces.length === 0;

  // Unique CLI agents used in this layer
  const cliAgents = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of workspaces) {
      if (ws.agentId && KNOWN_CLI_SLUGS.has(ws.agentId)) ids.add(ws.agentId);
    }
    return Array.from(ids).slice(0, 4);
  }, [workspaces]);

  return (
    <div
      className={cn(
        "rounded-xl overflow-hidden border transition-all duration-200",
        isEmpty && "opacity-40"
      )}
      style={{
        borderColor: `${color}30`,
        borderLeftWidth: 3,
        borderLeftColor: color,
        background: `linear-gradient(135deg, ${color}06 0%, transparent 60%)`,
        boxShadow: hasActive ? `0 0 0 1px ${color}18, 0 4px 20px ${color}08` : undefined,
      }}
    >
      {/* ── Layer header ── */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "group/lhdr w-full flex items-center gap-2.5 px-4 py-2.5 text-left",
          "hover:bg-white/4 active:bg-white/6 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        style={{ borderBottom: collapsed ? "none" : `1px solid ${color}18` }}
      >
        {/* Stage index badge */}
        <span
          className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold tabular-nums"
          style={{ background: `${color}20`, color }}
        >
          {stageIndex + 1}
        </span>

        {/* Section name */}
        <span
          className={cn(
            "flex-1 min-w-0 text-[11px] font-bold uppercase tracking-[0.12em] truncate",
            hasActive ? "text-foreground" : "text-foreground/60"
          )}
          style={hasActive ? { color } : undefined}
        >
          {section.name}
        </span>

        {/* Active pulse */}
        {hasActive && <LiveDot size="sm" />}

        {/* CLI agent icons */}
        {cliAgents.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            {cliAgents.map((id) => (
              <CliAgentIcon
                key={id}
                slug={id}
                className="h-3 w-3 text-foreground/40"
              />
            ))}
          </div>
        )}

        {/* Workspace count */}
        {workspaces.length > 0 && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold tabular-nums"
            style={{ background: `${color}15`, color }}
          >
            {workspaces.length}
          </span>
        )}

        {/* Collapse chevron */}
        <span className="shrink-0 text-muted/35 group-hover/lhdr:text-muted/60 transition-colors">
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {/* ── Worktree row ── */}
      {!collapsed && (
        <div className="px-3 py-2.5 overflow-x-auto">
          {isEmpty ? (
            <div className="flex items-center justify-center py-4">
              <span className="text-[10px]" style={{ color: `${color}30` }}>
                — no missions in this stage —
              </span>
            </div>
          ) : (
            <div className="flex gap-2.5 pb-1">
              {workspaces.map((ws) => (
                <WorktreeCard
                  key={ws.id}
                  ws={ws}
                  subAgents={childrenByParent.get(ws.id) ?? []}
                  layerColor={color}
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
// Flow arrow between layers
// ─────────────────────────────────────────────────────────────────────────────

function LayerConnector({ fromColor, toColor }: { fromColor: string; toColor: string }) {
  return (
    <div className="flex flex-col items-center py-0.5 gap-0" aria-hidden>
      <div
        className="w-px h-3"
        style={{
          background: `linear-gradient(to bottom, ${fromColor}40, ${toColor}40)`,
        }}
      />
      <ArrowDown
        className="h-3 w-3"
        style={{ color: toColor, opacity: 0.4 }}
        strokeWidth={1.5}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics strip — aggregate observability
// ─────────────────────────────────────────────────────────────────────────────

function MetricsStrip({
  totalMissions,
  activeMissions,
  totalSubAgents,
  stageCount,
  agentIds,
}: {
  totalMissions: number;
  activeMissions: number;
  totalSubAgents: number;
  stageCount: number;
  agentIds: string[];
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border/25 bg-background-secondary/50 text-[10.5px] flex-wrap">
      {/* HQ icon + title */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border/40 bg-background-secondary">
          <Layers className="h-3 w-3 text-muted/60" />
        </div>
        <div>
          <span className="text-foreground/50 text-[9px] font-bold uppercase tracking-widest">
            HQ Network
          </span>
        </div>
      </div>

      <div className="w-px h-4 bg-border/30 shrink-0" />

      {/* Active indicator */}
      {activeMissions > 0 ? (
        <span className="flex items-center gap-1.5 text-[var(--color-exec-mode)] font-semibold shrink-0">
          <LiveDot size="sm" />
          {activeMissions} running
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted/40 shrink-0">
          <Activity className="h-3 w-3" />
          idle
        </span>
      )}

      {/* Stats */}
      <span className="text-muted/50 shrink-0">
        <strong className="text-foreground/70">{totalMissions}</strong> missions
      </span>
      {totalSubAgents > 0 && (
        <span className="text-muted/50 shrink-0">
          <strong className="text-foreground/70">{totalSubAgents}</strong> sub-agents
        </span>
      )}
      <span className="text-muted/50 shrink-0">
        <strong className="text-foreground/70">{stageCount}</strong> stages
      </span>

      {/* CLI agent icons */}
      {agentIds.length > 0 && (
        <>
          <div className="w-px h-4 bg-border/30 shrink-0 ml-auto" />
          <div className="flex items-center gap-1.5 shrink-0">
            {agentIds.map((id) =>
              KNOWN_CLI_SLUGS.has(id) ? (
                <CliAgentIcon key={id} slug={id} className="h-3.5 w-3.5 text-foreground/40" />
              ) : null
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectHQOverview({ projectPath, projectName: _projectName }: { projectPath: string; projectName: string }) {
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
  const allCliAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ws of rootWorkspaces) {
      if (ws.agentId && KNOWN_CLI_SLUGS.has(ws.agentId)) ids.add(ws.agentId);
    }
    return Array.from(ids);
  }, [rootWorkspaces]);

  // Collapsed sections
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

  // Nothing to show
  if (rootWorkspaces.length === 0 && sections.length === 0) return null;

  const unsectioned = workspacesBySection.get(null) ?? [];

  return (
    <div className="flex flex-col gap-2 w-full">

      {/* ── Metrics strip ── */}
      <MetricsStrip
        totalMissions={rootWorkspaces.length}
        activeMissions={activeMissions}
        totalSubAgents={totalSubAgents}
        stageCount={sections.length}
        agentIds={allCliAgentIds}
      />

      {/* ── Pipeline layers ── */}
      {sections.length > 0 && (
        <div className="flex flex-col gap-0">
          {sections.map((section, i) => {
            const prevColor = i > 0 ? resolveSectionColor(sections[i - 1]!.color) : resolveSectionColor(section.color);
            const thisColor = resolveSectionColor(section.color);
            return (
              <React.Fragment key={section.id}>
                {i > 0 && (
                  <LayerConnector fromColor={prevColor} toColor={thisColor} />
                )}
                <LayerBand
                  section={section}
                  workspaces={workspacesBySection.get(section.id) ?? []}
                  childrenByParent={childrenByParent}
                  onOpen={handleOpen}
                  stageIndex={i}
                  totalStages={sections.length}
                  collapsed={collapsedSections.has(section.id)}
                  onToggle={() => toggleSection(section.id)}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* ── Unsectioned workspaces ── */}
      {unsectioned.length > 0 && (
        <>
          {sections.length > 0 && (
            <LayerConnector fromColor="#6b7280" toColor="#6b7280" />
          )}
          <div className="rounded-xl border border-border/25 overflow-hidden" style={{ borderLeftWidth: 3, borderLeftColor: "#6b7280" }}>
            <div className="flex items-center gap-2.5 px-4 py-2.5" style={{ borderBottom: "1px solid rgba(107,114,128,0.15)" }}>
              <span className="flex h-5 w-5 items-center justify-center rounded text-[9px] font-bold bg-muted/15 text-muted/60">?</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/50">
                Unsectioned
              </span>
              <span className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold bg-muted/10 text-muted/50 ml-auto">
                {unsectioned.length}
              </span>
            </div>
            <div className="px-3 py-2.5 overflow-x-auto">
              <div className="flex gap-2.5 pb-1">
                {unsectioned.map((ws) => (
                  <WorktreeCard
                    key={ws.id}
                    ws={ws}
                    subAgents={childrenByParent.get(ws.id) ?? []}
                    layerColor="#6b7280"
                    onOpen={handleOpen}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Empty state ── */}
      {rootWorkspaces.length === 0 && sections.length > 0 && (
        <p className="text-center text-[10.5px] text-muted/30 pt-1 pb-2">
          No missions yet — use the wizard above to dispatch the first one ↑
        </p>
      )}
    </div>
  );
}
