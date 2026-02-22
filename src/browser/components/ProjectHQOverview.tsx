/**
 * ProjectHQOverview — full pipeline architecture canvas.
 *
 * ALL stages always visible in a 12-col grid (col-span-4 each → 3 per row).
 * Empty stages show as lightweight placeholder boxes.
 * Animated dashed SVG lines connect every consecutive stage in order.
 * Active connections glow + have a fast-moving dot.
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
// Pipeline step classifier
// ─────────────────────────────────────────────────────────────────────────────
interface StepMeta { order: number; icon: string; label: string }
function classifyStep(agentId?: string): StepMeta {
  if (!agentId) return { order: 99, icon: "🤖", label: "Agent" };
  const id = agentId.toLowerCase();
  if (id.includes("explor"))  return { order: 0, icon: "🔍", label: "Explorer"    };
  if (id.includes("research"))return { order: 0, icon: "📚", label: "Researcher"  };
  if (id.includes("plan"))    return { order: 1, icon: "📐", label: "Planner"     };
  if (id.includes("arch"))    return { order: 1, icon: "🏗️",  label: "Architect"   };
  if (id.includes("cod"))     return { order: 2, icon: "✍️",  label: "Coder"       };
  if (id.includes("build"))   return { order: 2, icon: "🔨", label: "Builder"     };
  if (id.includes("exec"))    return { order: 2, icon: "⚡", label: "Executor"    };
  if (id.includes("impl"))    return { order: 2, icon: "⚙️",  label: "Implementer" };
  if (id.includes("test"))    return { order: 3, icon: "🧪", label: "Tester"      };
  if (id.includes("review"))  return { order: 4, icon: "👁️",  label: "Reviewer"    };
  if (id.includes("qa"))      return { order: 4, icon: "🛡️",  label: "QA"          };
  if (id.includes("fix"))     return { order: 3, icon: "🔧", label: "Fixer"       };
  if (id.includes("deploy"))  return { order: 5, icon: "🚀", label: "Deployer"    };
  if (id.includes("claude"))  return { order: 2, icon: "✦",  label: "Claude"      };
  if (id.includes("gemini"))  return { order: 2, icon: "✧",  label: "Gemini"      };
  if (id.includes("codex"))   return { order: 2, icon: "⬡",  label: "Codex"       };
  return { order: 99, icon: "🤖", label: agentId };
}
const KNOWN_CLI = new Set(["claude-code","codex","gemini","github-copilot","kiro"]);

// ─────────────────────────────────────────────────────────────────────────────
// Animated dashed connection canvas (SVG overlay)
// ─────────────────────────────────────────────────────────────────────────────
interface EdgeData {
  id: string; x1: number; y1: number; x2: number; y2: number;
  color: string; active: boolean; sameRow: boolean;
  bothEmpty: boolean; // true when both endpoints have no workspaces
}

function ConnectionCanvas({ edges, width, height }: { edges: EdgeData[]; width: number; height: number }) {
  if (!width || !height || edges.length === 0) return null;
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={width} height={height}
      style={{ zIndex: 0, overflow: "visible" }}
    >
      <defs>
        <style>{`
          @keyframes hqDashIdle   { to { stroke-dashoffset: -32; } }
          @keyframes hqDashActive { to { stroke-dashoffset: -22; } }
          .hq-idle   { animation: hqDashIdle   3s   linear infinite; }
          .hq-active { animation: hqDashActive 0.8s linear infinite; }
        `}</style>
        {edges.filter(e => !e.bothEmpty).map(e => (
          <marker key={`mk-${e.id}`} id={`mk-${e.id}`}
            markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse">
            <path
              d="M1,1 L7,4 L1,7"
              fill="none"
              stroke={e.active ? e.color : "hsl(var(--border))"}
              strokeWidth="1.2" strokeOpacity={e.active ? 0.85 : 0.35}
              strokeLinecap="round" strokeLinejoin="round"
            />
          </marker>
        ))}
      </defs>

      {edges.map(edge => {
        const { x1, y1, x2, y2, active, color, sameRow, bothEmpty } = edge;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const d = sameRow
          ? `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
          : `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;

        // Both endpoints empty → render as a near-invisible ghost line, no animation
        if (bothEmpty) {
          return (
            <path key={edge.id} d={d} fill="none"
              stroke="hsl(var(--border))"
              strokeWidth={0.75}
              strokeOpacity={0.08}
              strokeDasharray="2 9"
              strokeLinecap="round"
            />
          );
        }

        return (
          <g key={edge.id}>
            {/* Glow halo — active only */}
            {active && (
              <path d={d} fill="none" stroke={color} strokeWidth={10} strokeOpacity={0.08} />
            )}
            {/* Static dashed trace */}
            <path d={d} fill="none"
              stroke={active ? color : "hsl(var(--border))"}
              strokeWidth={active ? 1.5 : 1}
              strokeOpacity={active ? 0.25 : 0.2}
              strokeDasharray="6 5"
              strokeLinecap="round"
            />
            {/* Animated flowing dashes */}
            <path d={d} fill="none"
              stroke={active ? color : "hsl(var(--border))"}
              strokeWidth={active ? 2 : 1}
              strokeOpacity={active ? 0.9 : 0.22}
              strokeDasharray={active ? "10 8" : "5 12"}
              strokeLinecap="round"
              markerEnd={`url(#mk-${edge.id})`}
              className={active ? "hq-active" : "hq-idle"}
            />
            {/* Travelling dot */}
            <circle
              r={active ? 3.5 : 2}
              fill={active ? color : "hsl(var(--border))"}
              opacity={active ? 0.95 : 0.3}
            >
              <animateMotion dur={active ? "1.1s" : "4s"} repeatCount="indefinite" path={d} />
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
// Sub-agent step row
// ─────────────────────────────────────────────────────────────────────────────
function SubStepRow({ ws, isLast, accent }: {
  ws: FrontendWorkspaceMetadata; isLast: boolean; accent: string;
}) {
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
  const activeSubMeta = useMemo(
    () => { const a = sorted.find(s => s.taskStatus === "running"); return a ? classifyStep(a.agentId) : null; },
    [sorted]
  );

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
              {activeSubMeta && (
                <span className="ml-auto text-[8px] text-[var(--color-exec-mode)]">
                  {activeSubMeta.icon} {activeSubMeta.label}
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
// Stage box — used for ALL sections (active or empty)
// ─────────────────────────────────────────────────────────────────────────────
function StageBox({
  section, workspaces, childrenByParent, onOpen,
  stageIdx, collapsed, onToggle, nodeRef,
}: {
  section: SectionConfig;
  workspaces: FrontendWorkspaceMetadata[];
  childrenByParent: Map<string, FrontendWorkspaceMetadata[]>;
  onOpen: (ws: FrontendWorkspaceMetadata) => void;
  stageIdx: number; collapsed: boolean; onToggle: () => void;
  nodeRef: (el: HTMLDivElement | null) => void;
}) {
  const color   = resolveSectionColor(section.color);
  const active  = workspaces.some(w => w.taskStatus === "running");
  const isEmpty = workspaces.length === 0;

  const cliIds = useMemo(() => {
    const s = new Set<string>();
    workspaces.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s].slice(0, 3);
  }, [workspaces]);

  // Empty stages are fully desaturated / disabled — gray, no color accent
  const borderStyle = isEmpty
    ? "2px dashed rgba(120,120,120,0.22)"
    : `2px dashed ${color}50`;
  const bgStyle = isEmpty
    ? `repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(128,128,128,0.025) 5px, rgba(128,128,128,0.025) 10px)`
    : `${color}05`;

  return (
    <div
      ref={nodeRef}
      className={cn(
        "col-span-12 sm:col-span-6 lg:col-span-4",
        "relative rounded-xl transition-all duration-200",
        isEmpty && "opacity-35 grayscale"
      )}
      style={{
        border: borderStyle,
        background: bgStyle,
        boxShadow: active ? `0 0 0 1px ${color}22, 0 6px 20px ${color}10` : undefined,
        zIndex: 1,
        pointerEvents: isEmpty ? "none" : undefined,
      }}
    >
      {/* Header */}
      <button
        type="button" onClick={isEmpty ? undefined : onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 rounded-t-xl focus-visible:outline-none",
          !isEmpty && "group/hdr hover:bg-white/4 transition-colors cursor-pointer"
        )}
        style={{ borderBottom: (collapsed || isEmpty) ? "none" : `1px dashed ${color}28` }}
        tabIndex={isEmpty ? -1 : 0}
      >
        <span
          className="shrink-0 flex h-5 min-w-[20px] items-center justify-center rounded text-[9px] font-bold tabular-nums px-1"
          style={isEmpty
            ? { background: "rgba(128,128,128,0.15)", color: "rgba(128,128,128,0.5)" }
            : { background: `${color}20`, color }}
        >
          {stageIdx + 1}
        </span>
        <span
          className={cn(
            "flex-1 min-w-0 text-left text-[10px] font-bold uppercase tracking-[0.13em] truncate",
            active ? "text-foreground" : isEmpty ? "text-foreground/30" : "text-foreground/60"
          )}
          style={active ? { color } : undefined}
        >
          {section.name}
        </span>
        {active && <LiveDot size="sm" />}
        {!isEmpty && cliIds.map(id => <CliAgentIcon key={id} slug={id} className="h-3 w-3 text-foreground/30 shrink-0" />)}
        {!isEmpty && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tabular-nums"
            style={{ background: `${color}18`, color }}
          >
            {workspaces.length}
          </span>
        )}
        {!isEmpty && (
          <span className="shrink-0 text-muted/25 group-hover/hdr:text-muted/55 transition-colors">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </button>

      {/* Content — only shown when has workspaces and not collapsed */}
      {!isEmpty && !collapsed && (
        <div className="p-2">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
          >
            {workspaces.map(ws => (
              <ServiceNode
                key={ws.id} ws={ws}
                subAgents={childrenByParent.get(ws.id) ?? []}
                accent={color} onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics bar
// ─────────────────────────────────────────────────────────────────────────────
function MetricsBar({ totalMissions, activeMissions, totalSubAgents, stageCount, cliIds }: {
  totalMissions: number; activeMissions: number;
  totalSubAgents: number; stageCount: number; cliIds: string[];
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
      <span className="text-muted/45 shrink-0">
        <strong className="text-foreground/65">{totalMissions}</strong> missions
      </span>
      {totalSubAgents > 0 && (
        <span className="text-muted/45 shrink-0">
          <strong className="text-foreground/65">{totalSubAgents}</strong> sub-agents
        </span>
      )}
      <span className="text-muted/45 shrink-0">
        <strong className="text-foreground/65">{stageCount}</strong> stages
      </span>
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
export function ProjectHQOverview({ projectPath, projectName: _pn }: {
  projectPath: string; projectName: string;
}) {
  const { projects }                              = useProjectContext();
  const { workspaceMetadata, setSelectedWorkspace } = useWorkspaceContext();

  const projectConfig = projects.get(projectPath);
  const sections = useMemo(
    () => sortSectionsByLinkedList(projectConfig?.sections ?? []),
    [projectConfig]
  );

  const projectWorkspaces = useMemo(
    () => Array.from(workspaceMetadata.values()).filter(
      ws => ws.projectPath === projectPath && !ws.archivedAt
    ),
    [workspaceMetadata, projectPath]
  );
  const projectWsIds = useMemo(
    () => new Set(projectWorkspaces.map(ws => ws.id)),
    [projectWorkspaces]
  );

  const { rootWorkspaces, childrenByParent } = useMemo(() => {
    const roots: FrontendWorkspaceMetadata[] = [];
    const childMap = new Map<string, FrontendWorkspaceMetadata[]>();
    for (const ws of projectWorkspaces) {
      if (ws.parentWorkspaceId && projectWsIds.has(ws.parentWorkspaceId)) {
        const arr = childMap.get(ws.parentWorkspaceId) ?? [];
        arr.push(ws); childMap.set(ws.parentWorkspaceId, arr);
      } else roots.push(ws);
    }
    return { rootWorkspaces: roots, childrenByParent: childMap };
  }, [projectWorkspaces, projectWsIds]);

  const workspacesBySection = useMemo(() => {
    const map = new Map<string | null, FrontendWorkspaceMetadata[]>();
    for (const ws of rootWorkspaces) {
      const sid = ws.sectionId ?? null;
      const arr = map.get(sid) ?? [];
      arr.push(ws); map.set(sid, arr);
    }
    return map;
  }, [rootWorkspaces]);

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

  // ── SVG edge measurement — ALL sections ───────────────────────────────────
  const canvasRef  = useRef<HTMLDivElement>(null);
  const nodeRefs   = useRef<Map<string, HTMLDivElement>>(new Map());
  const [edges, setEdges]           = useState<EdgeData[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || sections.length < 2) { setEdges([]); return; }

    const measure = () => {
      const cr = canvas.getBoundingClientRect();
      setCanvasSize({ w: cr.width, h: cr.height });
      const newEdges: EdgeData[] = [];

      for (let i = 0; i < sections.length - 1; i++) {
        const from = sections[i]!;
        const to   = sections[i + 1]!;
        const fEl  = nodeRefs.current.get(from.id);
        const tEl  = nodeRefs.current.get(to.id);
        if (!fEl || !tEl) continue;

        const fr = fEl.getBoundingClientRect();
        const tr = tEl.getBoundingClientRect();

        const fromWs = workspacesBySection.get(from.id) ?? [];
        const toWs   = workspacesBySection.get(to.id)   ?? [];
        const active = fromWs.some(w => w.taskStatus === "running")
                    || toWs.some(w => w.taskStatus === "running");
        const bothEmpty = fromWs.length === 0 && toWs.length === 0;

        // Same row when tops are within half a box height of each other
        const sameRow = Math.abs(fr.top - tr.top) < Math.max(fr.height, tr.height) * 0.5;

        let x1: number, y1: number, x2: number, y2: number;
        if (sameRow) {
          x1 = fr.right  - cr.left; y1 = fr.top + fr.height / 2 - cr.top;
          x2 = tr.left   - cr.left; y2 = tr.top + tr.height / 2 - cr.top;
        } else {
          x1 = fr.left + fr.width  / 2 - cr.left; y1 = fr.bottom - cr.top;
          x2 = tr.left + tr.width  / 2 - cr.left; y2 = tr.top    - cr.top;
        }

        newEdges.push({
          id: `${from.id}→${to.id}`,
          x1, y1, x2, y2,
          color: resolveSectionColor(from.color),
          active,
          sameRow,
          bothEmpty,
        });
      }
      setEdges(newEdges);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [sections, workspacesBySection, collapsed]);

  if (rootWorkspaces.length === 0 && sections.length === 0) return null;

  const unsectioned = workspacesBySection.get(null) ?? [];

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
        stageCount={sections.length}
        cliIds={allCliIds}
      />

      {/* Full pipeline canvas — ALL sections + SVG connections */}
      {sections.length > 0 && (
        <div ref={canvasRef} className="relative">
          {/* SVG animated dashed connections (z-index 0, below cards) */}
          <ConnectionCanvas edges={edges} width={canvasSize.w} height={canvasSize.h} />

          {/* Stage grid — 3 per row (col-span-4 each in 12-col grid) */}
          <div
            className="grid grid-cols-12 gap-3 items-start"
            style={{ position: "relative", zIndex: 1 }}
          >
            {sections.map((sec, i) => (
              <StageBox
                key={sec.id}
                section={sec}
                workspaces={workspacesBySection.get(sec.id) ?? []}
                childrenByParent={childrenByParent}
                onOpen={handleOpen}
                stageIdx={i}
                collapsed={collapsed.has(sec.id)}
                onToggle={() => toggle(sec.id)}
                nodeRef={el => {
                  if (el) nodeRefs.current.set(sec.id, el);
                  else    nodeRefs.current.delete(sec.id);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unsectioned workspaces */}
      {unsectioned.length > 0 && (
        <div className="rounded-xl"
          style={{ border: "2px dashed rgba(107,114,128,0.3)", background: "rgba(107,114,128,0.02)" }}>
          <div className="flex items-center gap-2.5 px-3 py-2"
            style={{ borderBottom: "1px dashed rgba(107,114,128,0.2)" }}>
            <span className="h-5 w-5 flex items-center justify-center rounded bg-muted/12 text-[9px] font-bold text-muted/50">?</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-foreground/45 flex-1">Unsectioned</span>
            <span className="text-[9px] font-semibold text-muted/40 bg-muted/10 px-1.5 py-0.5 rounded">{unsectioned.length}</span>
          </div>
          <div className="p-2 grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(175px, 1fr))" }}>
            {unsectioned.map(ws => (
              <ServiceNode key={ws.id} ws={ws}
                subAgents={childrenByParent.get(ws.id) ?? []}
                accent="#6b7280" onOpen={handleOpen} />
            ))}
          </div>
        </div>
      )}

      {rootWorkspaces.length === 0 && sections.length > 0 && (
        <p className="text-center text-[10.5px] text-muted/30 py-2">
          No missions yet — dispatch one with the wizard above ↑
        </p>
      )}
    </div>
  );
}
