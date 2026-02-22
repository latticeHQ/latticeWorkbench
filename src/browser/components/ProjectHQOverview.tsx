/**
 * ProjectHQOverview — 2-D AWS-architecture canvas.
 *
 * Layout rules:
 *   Active sections  (have workspaces) → full zone boxes in 12-col grid
 *   Empty  sections  (no workspaces)   → compact dormant pill row at bottom
 *
 * Connections: SVG overlay with animated DASHED lines + moving dot.
 *   Idle   → subtle dashed gray line, slow dot
 *   Active → bright colored dashed line, fast glow dot
 */
import React, {
  useMemo, useCallback, useState, useRef, useLayoutEffect,
} from "react";
import { cn } from "@/common/lib/utils";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useWorkspaceContext, toWorkspaceSelection } from "@/browser/contexts/WorkspaceContext";
import { useWorkspaceSidebarState, useWorkspaceUsage } from "@/browser/stores/WorkspaceStore";
import { resolveSectionColor } from "@/common/constants/ui";
import { sortSectionsByLinkedList } from "@/common/utils/sections";
import type { FrontendWorkspaceMetadata } from "@/common/types/workspace";
import type { SectionConfig } from "@/common/types/project";
import {
  CheckCircle2, Clock, DollarSign, Zap, Users,
  ChevronDown, ChevronRight, Activity, Layers, ArrowRight,
} from "lucide-react";
import { Shimmer } from "./ai-elements/shimmer";
import { getTotalCost, formatCostWithDollar } from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";
import { CliAgentIcon } from "./CliAgentIcon";

// ─────────────────────────────────────────────────────────────────────────────
// Step classifier
// ─────────────────────────────────────────────────────────────────────────────
interface StepMeta { order: number; icon: string; label: string }
function classifyStep(agentId?: string): StepMeta {
  if (!agentId) return { order: 99, icon: "🤖", label: "Agent" };
  const id = agentId.toLowerCase();
  if (id.includes("explor"))  return { order: 0, icon: "🔍", label: "Explorer" };
  if (id.includes("research"))return { order: 0, icon: "📚", label: "Researcher" };
  if (id.includes("plan"))    return { order: 1, icon: "📐", label: "Planner" };
  if (id.includes("arch"))    return { order: 1, icon: "🏗️",  label: "Architect" };
  if (id.includes("cod"))     return { order: 2, icon: "✍️",  label: "Coder" };
  if (id.includes("build"))   return { order: 2, icon: "🔨", label: "Builder" };
  if (id.includes("exec"))    return { order: 2, icon: "⚡", label: "Executor" };
  if (id.includes("impl"))    return { order: 2, icon: "⚙️",  label: "Implementer" };
  if (id.includes("test"))    return { order: 3, icon: "🧪", label: "Tester" };
  if (id.includes("review"))  return { order: 4, icon: "👁️",  label: "Reviewer" };
  if (id.includes("qa"))      return { order: 4, icon: "🛡️",  label: "QA" };
  if (id.includes("fix"))     return { order: 3, icon: "🔧", label: "Fixer" };
  if (id.includes("deploy"))  return { order: 5, icon: "🚀", label: "Deployer" };
  if (id.includes("claude"))  return { order: 2, icon: "✦",  label: "Claude" };
  if (id.includes("gemini"))  return { order: 2, icon: "✧",  label: "Gemini" };
  if (id.includes("codex"))   return { order: 2, icon: "⬡",  label: "Codex" };
  return { order: 99, icon: "🤖", label: agentId };
}
const KNOWN_CLI = new Set(["claude-code","codex","gemini","github-copilot","kiro"]);

// Column span — based on workspace count inside the section
function colSpanClass(count: number): string {
  if (count === 1) return "col-span-12 sm:col-span-6 lg:col-span-4";
  if (count === 2) return "col-span-12 sm:col-span-6 lg:col-span-5";
  if (count === 3) return "col-span-12 lg:col-span-6";
  if (count <= 5)  return "col-span-12 lg:col-span-8";
  return "col-span-12";
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG animated dashed connection canvas
// ─────────────────────────────────────────────────────────────────────────────
interface EdgeData {
  id: string; x1: number; y1: number; x2: number; y2: number;
  color: string; active: boolean; sameRow: boolean;
}

function ConnectionCanvas({ edges, width, height }: { edges: EdgeData[]; width: number; height: number }) {
  if (!width || !height || edges.length === 0) return null;
  return (
    <svg className="absolute inset-0 pointer-events-none" width={width} height={height} style={{ zIndex: 0 }}>
      <defs>
        <style>{`
          @keyframes hqDash { to { stroke-dashoffset: -32; } }
          @keyframes hqDashFast { to { stroke-dashoffset: -20; } }
          .hq-dash-idle   { animation: hqDash     2.8s linear infinite; }
          .hq-dash-active { animation: hqDashFast 0.9s linear infinite; }
        `}</style>
        {/* Arrowhead markers */}
        {edges.map(e => (
          <marker key={`m-${e.id}`} id={`m-${e.id}`}
            markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0.5 L6,3.5 L0,6.5"
              fill="none"
              stroke={e.active ? e.color : "hsl(var(--border))"}
              strokeWidth="1.2"
              strokeOpacity={e.active ? 0.9 : 0.4}
              strokeLinecap="round" strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>

      {edges.map(edge => {
        const { x1, y1, x2, y2 } = edge;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        // Smooth bezier — S-curve horizontal, arc vertical
        const d = edge.sameRow
          ? `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;

        return (
          <g key={edge.id}>
            {/* Glow for active (wide, faint) */}
            {edge.active && (
              <path d={d} fill="none" stroke={edge.color} strokeWidth={8} strokeOpacity={0.07} />
            )}

            {/* Static dashed base */}
            <path
              d={d} fill="none"
              stroke={edge.active ? edge.color : "hsl(var(--border))"}
              strokeWidth={edge.active ? 1.5 : 1}
              strokeOpacity={edge.active ? 0.3 : 0.25}
              strokeDasharray="6 4"
              strokeLinecap="round"
            />

            {/* Animated flowing dashes on top */}
            <path
              d={d} fill="none"
              stroke={edge.active ? edge.color : "hsl(var(--border))"}
              strokeWidth={edge.active ? 2 : 1}
              strokeOpacity={edge.active ? 0.85 : 0.18}
              strokeDasharray={edge.active ? "10 6" : "6 10"}
              strokeLinecap="round"
              className={edge.active ? "hq-dash-active" : "hq-dash-idle"}
              markerEnd={`url(#m-${edge.id})`}
            />

            {/* Moving dot */}
            <circle
              r={edge.active ? 3.5 : 2}
              fill={edge.active ? edge.color : "hsl(var(--border))"}
              opacity={edge.active ? 0.9 : 0.35}
            >
              <animateMotion
                dur={edge.active ? "1.2s" : "4s"}
                repeatCount="indefinite"
                path={d}
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live pulse dot
// ─────────────────────────────────────────────────────────────────────────────
function LiveDot({ size = "md" }: { size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span className={cn("relative flex shrink-0", s)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
      <span className={cn("relative inline-flex rounded-full bg-[var(--color-exec-mode)]", s)} />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-agent step row inside a workspace card
// ─────────────────────────────────────────────────────────────────────────────
function SubStepRow({ ws, isLast, accent }: { ws: FrontendWorkspaceMetadata; isLast: boolean; accent: string }) {
  const state = useWorkspaceSidebarState(ws.id);
  const step  = classifyStep(ws.agentId);
  const live  = state.canInterrupt || state.isStarting;
  const done  = ws.taskStatus === "reported";
  return (
    <div className="flex items-center gap-1.5 relative py-[2px]">
      {!isLast && (
        <div className="absolute left-[8px] top-4 w-px bottom-0" style={{ background: `${accent}20` }} />
      )}
      <div className={cn(
        "relative z-10 h-4 w-4 shrink-0 flex items-center justify-center rounded-full border text-[8px] leading-none",
        live ? "border-[var(--color-exec-mode)]/50 bg-[var(--color-exec-mode)]/15"
             : done ? "border-[var(--color-success)]/35 bg-[var(--color-success)]/8"
                    : "border-border/40 bg-background/50"
      )}>{step.icon}</div>
      <span className={cn("flex-1 min-w-0 text-[9px] truncate",
        live ? "text-foreground/90 font-medium" : done ? "text-foreground/45" : "text-foreground/40")}>
        {step.label}
      </span>
      {live  ? <LiveDot size="sm" />
             : done ? <CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)] shrink-0" />
                    : <span className="h-1.5 w-1.5 rounded-full bg-muted/15 shrink-0 block" />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace service node card
// ─────────────────────────────────────────────────────────────────────────────
function ServiceNode({ ws, subAgents, accent, onOpen }: {
  ws: FrontendWorkspaceMetadata; subAgents: FrontendWorkspaceMetadata[];
  accent: string; onOpen: (ws: FrontendWorkspaceMetadata) => void;
}) {
  const state   = useWorkspaceSidebarState(ws.id);
  const usage   = useWorkspaceUsage(ws.id);
  const live    = state.canInterrupt || state.isStarting;
  const waiting = !live && state.awaitingUserQuestion;
  const done    = ws.taskStatus === "reported";
  const queued  = ws.taskStatus === "queued";
  const title   = ws.title ?? ws.name;
  const step    = classifyStep(ws.agentId);
  const cost    = getTotalCost(usage.sessionTotal);
  const tok     = usage.totalTokens;

  const sorted = useMemo(
    () => [...subAgents].sort((a, b) => classifyStep(a.agentId).order - classifyStep(b.agentId).order),
    [subAgents]
  );
  const activeSubStep = sorted.find(s => s.taskStatus === "running");
  const activeMeta    = activeSubStep ? classifyStep(activeSubStep.agentId) : null;

  return (
    <div
      role="button" tabIndex={0}
      onClick={() => onOpen(ws)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpen(ws); }}
      className={cn(
        "group/sn relative flex flex-col rounded-lg border cursor-pointer select-none overflow-hidden",
        "transition-all duration-150 border-border/40 bg-background/55",
        "hover:border-border hover:bg-background hover:shadow-md hover:shadow-black/25",
        live    && "border-[var(--color-exec-mode)]/40 bg-[var(--color-exec-mode)]/4 shadow-sm",
        waiting && "border-amber-400/35",
        done    && "opacity-50",
        queued  && "opacity-70"
      )}
    >
      <div className="h-[2.5px] w-full shrink-0" style={{
        background: live ? "var(--color-exec-mode)" : waiting ? "#f59e0b" : done ? "var(--color-success)" : accent,
        opacity: done ? 0.3 : live ? 1 : 0.65,
      }} />

      <div className="flex flex-col gap-1 p-2">
        <div className="flex items-start gap-1.5 min-w-0">
          <div className={cn(
            "shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border text-sm",
            live ? "border-[var(--color-exec-mode)]/30 bg-[var(--color-exec-mode)]/12"
                 : "border-border/35 bg-background-secondary/60"
          )}>{step.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1 min-w-0">
              <span className="flex-1 min-w-0 text-[10.5px] font-semibold text-foreground leading-tight">
                {live
                  ? <Shimmer colorClass="var(--color-foreground)" className="block truncate">{title}</Shimmer>
                  : <span className="block truncate">{title}</span>}
              </span>
              <span className="shrink-0 mt-0.5">
                {live    ? <LiveDot size="sm" /> :
                 done    ? <CheckCircle2 className="h-2.5 w-2.5 text-[var(--color-success)]" /> :
                 waiting ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400 block" /> :
                 queued  ? <span className="h-1.5 w-1.5 rounded-full border border-muted/40 block" /> :
                           <span className="h-1.5 w-1.5 rounded-full bg-muted/12 block" />}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {ws.agentId && KNOWN_CLI.has(ws.agentId) && (
                <span className="flex items-center gap-0.5 text-[8px] text-foreground/35 font-mono">
                  <CliAgentIcon slug={ws.agentId} className="h-2.5 w-2.5" />{ws.agentId}
                </span>
              )}
              {ws.agentId && !KNOWN_CLI.has(ws.agentId) && (
                <span className="text-[8px] text-foreground/30 font-mono">{ws.agentId}</span>
              )}
              {activeMeta && (
                <span className="ml-auto text-[8px] text-[var(--color-exec-mode)]">
                  {activeMeta.icon} {activeMeta.label}
                </span>
              )}
            </div>
          </div>
        </div>

        {(cost > 0 || tok > 0 || ws.createdAt) && (
          <div className="flex items-center gap-2 flex-wrap">
            {cost > 0 && <span className="text-[8px] text-muted/50 flex items-center gap-0.5"><DollarSign className="h-1.5 w-1.5" />{formatCostWithDollar(cost)}</span>}
            {tok > 0  && <span className="text-[8px] text-muted/50 flex items-center gap-0.5"><Zap className="h-1.5 w-1.5" />{formatTokens(tok)}</span>}
            {ws.createdAt && (
              <span className="text-[8px] text-muted/30 flex items-center gap-0.5 ml-auto">
                <Clock className="h-1.5 w-1.5" />
                {new Date(ws.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {sorted.length > 0 && (
          <div className="border-t pt-1.5 flex flex-col gap-0" style={{ borderColor: `${accent}18` }}>
            <div className="flex items-center gap-1 mb-1">
              <Users className="h-2 w-2 text-muted/35" />
              <span className="text-[8px] text-muted/35">{sorted.length} agent{sorted.length !== 1 ? "s" : ""}</span>
            </div>
            {sorted.slice(0, 5).map((s, i) => (
              <SubStepRow key={s.id} ws={s} isLast={i === sorted.length - 1} accent={accent} />
            ))}
            {sorted.length > 5 && <span className="text-[8px] text-muted/30 pl-6">+{sorted.length - 5} more</span>}
          </div>
        )}
      </div>
      <ArrowRight className="absolute right-1.5 top-1.5 h-3 w-3 text-[var(--color-exec-mode)] opacity-0 group-hover/sn:opacity-60 transition-opacity" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Active zone box (has workspaces)
// ─────────────────────────────────────────────────────────────────────────────
function ZoneBox({
  section, workspaces, childrenByParent, onOpen,
  globalIdx, collapsed, onToggle, nodeRef,
}: {
  section: SectionConfig; workspaces: FrontendWorkspaceMetadata[];
  childrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
  globalIdx: number; collapsed: boolean; onToggle: () => void;
  nodeRef: (el: HTMLDivElement | null) => void;
}) {
  const color  = resolveSectionColor(section.color);
  const active = workspaces.some(w => w.taskStatus === "running");
  const cliIds = useMemo(() => {
    const s = new Set<string>();
    workspaces.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s].slice(0, 3);
  }, [workspaces]);

  return (
    <div
      ref={nodeRef}
      className={cn(colSpanClass(workspaces.length), "relative rounded-xl transition-all duration-200")}
      style={{
        border: `2px dashed ${color}50`,
        background: `${color}05`,
        boxShadow: active ? `0 0 0 1px ${color}22, 0 6px 20px ${color}10` : undefined,
        zIndex: 1,
      }}
    >
      {/* Header */}
      <button
        type="button" onClick={onToggle}
        className="group/hdr flex w-full items-center gap-2 px-3 py-2 rounded-t-xl hover:bg-white/4 transition-colors cursor-pointer focus-visible:outline-none"
        style={{ borderBottom: collapsed ? "none" : `1px dashed ${color}30` }}
      >
        <span className="shrink-0 flex h-5 min-w-[20px] items-center justify-center rounded text-[9px] font-bold tabular-nums px-1"
          style={{ background: `${color}25`, color }}>
          {globalIdx + 1}
        </span>
        <span className={cn("flex-1 min-w-0 text-left text-[10px] font-bold uppercase tracking-[0.13em] truncate",
          active ? "text-foreground" : "text-foreground/60")}
          style={active ? { color } : undefined}>
          {section.name}
        </span>
        {active && <LiveDot size="sm" />}
        {cliIds.map(id => <CliAgentIcon key={id} slug={id} className="h-3 w-3 text-foreground/35 shrink-0" />)}
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
          style={{ background: `${color}18`, color }}>
          {workspaces.length}
        </span>
        <span className="shrink-0 text-muted/30 group-hover/hdr:text-muted/60 transition-colors">
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="p-2.5">
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))" }}>
            {workspaces.map(ws => (
              <ServiceNode key={ws.id} ws={ws} subAgents={childrenByParent.get(ws.id) ?? []}
                accent={color} onOpen={onOpen} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty stages — compact dormant pill row
// ─────────────────────────────────────────────────────────────────────────────
function DormantPills({ sections, globalOffset }: { sections: SectionConfig[]; globalOffset: number }) {
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl border border-dashed border-border/20 bg-background/20">
      <span className="text-[9px] text-muted/35 font-medium uppercase tracking-wider shrink-0">
        Dormant stages
      </span>
      <div className="w-px h-3 bg-border/20 shrink-0" />
      {sections.map((sec, i) => {
        const color = resolveSectionColor(sec.color);
        return (
          <span
            key={sec.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-[9.5px] font-medium transition-opacity opacity-50 hover:opacity-80"
            style={{ borderColor: `${color}45`, color: `${color}90` }}
          >
            <span className="text-[8px] font-bold opacity-70">{globalOffset + i + 1}</span>
            <span>{sec.name}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics bar
// ─────────────────────────────────────────────────────────────────────────────
function MetricsBar({ totalMissions, activeMissions, totalSubAgents, stageCount, cliIds }: {
  totalMissions: number; activeMissions: number; totalSubAgents: number;
  stageCount: number; cliIds: string[];
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border/25 bg-background-secondary/50 flex-wrap text-[10.5px]">
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-6 w-6 flex items-center justify-center rounded-md border border-border/35 bg-background-secondary">
          <Layers className="h-3 w-3 text-muted/55" />
        </div>
        <span className="text-foreground/40 text-[9px] font-bold uppercase tracking-widest">Agent Network</span>
      </div>
      <div className="w-px h-4 bg-border/25 shrink-0" />
      {activeMissions > 0 ? (
        <span className="flex items-center gap-1.5 text-[var(--color-exec-mode)] font-semibold shrink-0">
          <LiveDot size="sm" />{activeMissions} running
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted/35 shrink-0">
          <Activity className="h-3 w-3" />idle
        </span>
      )}
      <span className="text-muted/45 shrink-0"><strong className="text-foreground/65">{totalMissions}</strong> missions</span>
      {totalSubAgents > 0 && <span className="text-muted/45 shrink-0"><strong className="text-foreground/65">{totalSubAgents}</strong> sub-agents</span>}
      <span className="text-muted/45 shrink-0"><strong className="text-foreground/65">{stageCount}</strong> stages</span>
      {cliIds.length > 0 && (
        <>
          <div className="w-px h-4 bg-border/25 shrink-0 ml-auto" />
          <div className="flex items-center gap-2 shrink-0">
            {cliIds.map(id => <CliAgentIcon key={id} slug={id} className="h-3.5 w-3.5 text-foreground/35" />)}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────
export function ProjectHQOverview({ projectPath, projectName: _pn }: { projectPath: string; projectName: string }) {
  const { projects }                          = useProjectContext();
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();

  const projectConfig = projects.get(projectPath);
  const allSections   = useMemo(() => sortSectionsByLinkedList(projectConfig?.sections ?? []), [projectConfig]);

  const projectWorkspaces = useMemo(
    () => Array.from(workspaceMetadata.values()).filter(ws => ws.projectPath === projectPath && !ws.archivedAt),
    [workspaceMetadata, projectPath]
  );
  const projectWsIds = useMemo(() => new Set(projectWorkspaces.map(ws => ws.id)), [projectWorkspaces]);

  const { rootWorkspaces, childrenByParent } = useMemo(() => {
    const roots: FrontendWorkspaceMetadata[] = [];
    const childMap = new Map<string, FrontendWorkspaceMetadata[]>();
    for (const ws of projectWorkspaces) {
      if (ws.parentWorkspaceId && projectWsIds.has(ws.parentWorkspaceId)) {
        const arr = childMap.get(ws.parentWorkspaceId) ?? [];
        arr.push(ws);
        childMap.set(ws.parentWorkspaceId, arr);
      } else roots.push(ws);
    }
    return { rootWorkspaces: roots, childrenByParent: childMap };
  }, [projectWorkspaces, projectWsIds]);

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

  // Split into active (has workspaces) and dormant (empty)
  const { activeSections, dormantSections } = useMemo(() => {
    const active: SectionConfig[]  = [];
    const dormant: SectionConfig[] = [];
    for (const s of allSections) {
      if ((workspacesBySection.get(s.id) ?? []).length > 0) active.push(s);
      else dormant.push(s);
    }
    return { activeSections: active, dormantSections: dormant };
  }, [allSections, workspacesBySection]);

  const activeMissions = rootWorkspaces.filter(w => w.taskStatus === "running").length;
  const totalSubAgents = [...childrenByParent.values()].reduce((s, a) => s + a.length, 0);
  const allCliIds      = useMemo(() => {
    const s = new Set<string>();
    rootWorkspaces.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s];
  }, [rootWorkspaces]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleOpen = useCallback(
    (ws: FrontendWorkspaceMetadata) => setSelectedWorkspace(toWorkspaceSelection(ws)),
    [setSelectedWorkspace]
  );

  // ── SVG edge measurement (only active sections) ───────────────────────────
  const canvasRef  = useRef<HTMLDivElement>(null);
  const nodeRefs   = useRef<Map<string, HTMLDivElement>>(new Map());
  const [edges, setEdges]           = useState<EdgeData[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || activeSections.length < 2) { setEdges([]); return; }

    const measure = () => {
      const cr = canvas.getBoundingClientRect();
      setCanvasSize({ w: cr.width, h: cr.height });
      const newEdges: EdgeData[] = [];

      for (let i = 0; i < activeSections.length - 1; i++) {
        const from = activeSections[i]!;
        const to   = activeSections[i + 1]!;
        const fEl  = nodeRefs.current.get(from.id);
        const tEl  = nodeRefs.current.get(to.id);
        if (!fEl || !tEl) continue;

        const fr = fEl.getBoundingClientRect();
        const tr = tEl.getBoundingClientRect();
        const active = (workspacesBySection.get(from.id) ?? []).some(w => w.taskStatus === "running")
                    || (workspacesBySection.get(to.id)   ?? []).some(w => w.taskStatus === "running");
        const sameRow = Math.abs(fr.top - tr.top) < fr.height * 0.5;

        let x1: number, y1: number, x2: number, y2: number;
        if (sameRow) {
          x1 = fr.right  - cr.left;   y1 = fr.top + fr.height / 2 - cr.top;
          x2 = tr.left   - cr.left;   y2 = tr.top + tr.height / 2 - cr.top;
        } else {
          x1 = fr.left + fr.width  / 2 - cr.left; y1 = fr.bottom - cr.top;
          x2 = tr.left + tr.width  / 2 - cr.left; y2 = tr.top    - cr.top;
        }
        newEdges.push({ id: `${from.id}→${to.id}`, x1, y1, x2, y2,
          color: resolveSectionColor(from.color), active, sameRow });
      }
      setEdges(newEdges);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [activeSections, workspacesBySection, collapsed]);

  if (rootWorkspaces.length === 0 && allSections.length === 0) return null;

  const unsectioned = workspacesBySection.get(null) ?? [];

  // Global index map (section order across all sections for stage number)
  const sectionGlobalIdx = useMemo(() => {
    const map = new Map<string, number>();
    allSections.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [allSections]);

  return (
    <div
      className="flex flex-col gap-3 w-full"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.022) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {/* Metrics bar */}
      <MetricsBar
        totalMissions={rootWorkspaces.length}
        activeMissions={activeMissions}
        totalSubAgents={totalSubAgents}
        stageCount={allSections.length}
        cliIds={allCliIds}
      />

      {/* Active zones grid + SVG overlay */}
      {activeSections.length > 0 && (
        <div ref={canvasRef} className="relative">
          <ConnectionCanvas edges={edges} width={canvasSize.w} height={canvasSize.h} />
          <div className="grid grid-cols-12 gap-3 items-start" style={{ zIndex: 1, position: "relative" }}>
            {activeSections.map(sec => (
              <ZoneBox
                key={sec.id}
                section={sec}
                workspaces={workspacesBySection.get(sec.id) ?? []}
                childrenByParent={childrenByParent}
                onOpen={handleOpen}
                globalIdx={sectionGlobalIdx.get(sec.id) ?? 0}
                collapsed={collapsed.has(sec.id)}
                onToggle={() => toggle(sec.id)}
                nodeRef={el => { if (el) nodeRefs.current.set(sec.id, el); else nodeRefs.current.delete(sec.id); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unsectioned workspaces */}
      {unsectioned.length > 0 && (
        <div className="rounded-xl" style={{ border: "2px dashed rgba(107,114,128,0.3)", background: "rgba(107,114,128,0.02)" }}>
          <div className="flex items-center gap-2.5 px-3 py-2" style={{ borderBottom: "1px dashed rgba(107,114,128,0.2)" }}>
            <span className="h-5 w-5 flex items-center justify-center rounded bg-muted/12 text-[9px] font-bold text-muted/50">?</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-foreground/45 flex-1">Unsectioned</span>
            <span className="text-[9px] font-semibold text-muted/40 bg-muted/10 px-1.5 py-0.5 rounded">{unsectioned.length}</span>
          </div>
          <div className="p-2.5 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))" }}>
            {unsectioned.map(ws => (
              <ServiceNode key={ws.id} ws={ws} subAgents={childrenByParent.get(ws.id) ?? []}
                accent="#6b7280" onOpen={handleOpen} />
            ))}
          </div>
        </div>
      )}

      {/* Dormant (empty) stages as compact pills */}
      <DormantPills
        sections={dormantSections}
        globalOffset={activeSections.length + (unsectioned.length > 0 ? 1 : 0)}
      />

      {/* Empty state */}
      {rootWorkspaces.length === 0 && allSections.length > 0 && (
        <p className="text-center text-[10.5px] text-muted/30 py-2">
          No missions yet — dispatch one with the wizard above ↑
        </p>
      )}
    </div>
  );
}
