/**
 * ProjectHQOverview — full pipeline architecture canvas.
 *
 * ALL stages always visible in a 12-col grid (col-span-4 each → 3 per row).
 * Empty stages show as lightweight placeholder boxes.
 */
import {
  useMemo, useCallback, useState, useEffect,
} from "react";
import { cn } from "@/common/lib/utils";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionContext, toMinionSelection } from "@/browser/contexts/MinionContext";
import { useMinionSidebarState, useMinionUsage, useMinionStoreRaw } from "@/browser/stores/MinionStore";
import { resolveCrewColor } from "@/common/constants/ui";
import { sortCrewsByLinkedList } from "@/common/utils/crews";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { CrewConfig } from "@/common/types/project";
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
  if (id.includes("cod"))     return { order: 2, icon: "✍️",  label: "Lattice"       };
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
// Sidekick step row
// ─────────────────────────────────────────────────────────────────────────────
function SubStepRow({ ws, isLast, accent }: {
  ws: FrontendMinionMetadata; isLast: boolean; accent: string;
}) {
  const state = useMinionSidebarState(ws.id);
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
// Stage / phase cost rollup badge — subscribes to N minion usage stores
// ─────────────────────────────────────────────────────────────────────────────
function StageCostBadge({
  minions, color,
}: {
  minions: FrontendMinionMetadata[];
  color?: string;
}) {
  const store = useMinionStoreRaw();

  const [costData, setCostData] = useState(() => {
    let cost = 0; let tokens = 0;
    for (const ws of minions) {
      const u = store.getMinionUsage(ws.id);
      cost += getTotalCost(u.sessionTotal) ?? 0;
      tokens += u.totalTokens;
    }
    return { cost, tokens };
  });

  useEffect(() => {
    if (minions.length === 0) { setCostData({ cost: 0, tokens: 0 }); return; }
    const compute = () => {
      let cost = 0; let tokens = 0;
      for (const ws of minions) {
        const u = store.getMinionUsage(ws.id);
        cost += getTotalCost(u.sessionTotal) ?? 0;
        tokens += u.totalTokens;
      }
      setCostData(prev =>
        prev.cost === cost && prev.tokens === tokens ? prev : { cost, tokens }
      );
    };
    compute();
    const unsubs = minions.map(ws => store.subscribeUsage(ws.id, compute));
    return () => { unsubs.forEach(fn => fn()); };
  }, [store, minions]);

  if (costData.cost <= 0) return null;

  return (
    <span
      className="shrink-0 flex items-center gap-0.5 text-[8px] tabular-nums font-medium"
      style={{ color: color ? `${color}65` : "rgba(120,120,140,0.6)" }}
    >
      <DollarSign className="h-1.5 w-1.5" />
      {formatCostWithDollar(costData.cost)}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Minion service node card
// ─────────────────────────────────────────────────────────────────────────────
function ServiceNode({ ws, sidekicks, accent, onOpen }: {
  ws: FrontendMinionMetadata; sidekicks: FrontendMinionMetadata[];
  accent: string; onOpen: (ws: FrontendMinionMetadata) => void;
}) {
  const state   = useMinionSidebarState(ws.id);
  const usage   = useMinionUsage(ws.id);
  const live    = state.canInterrupt || state.isStarting;
  const waiting = !live && state.awaitingUserQuestion;
  const done    = ws.taskStatus === "reported";
  const queued  = ws.taskStatus === "queued";
  const title   = ws.title ?? ws.name;
  const step    = classifyStep(ws.agentId);
  const cost    = getTotalCost(usage.sessionTotal) ?? 0;
  const tok     = usage.totalTokens;

  const sorted = useMemo(
    () => [...sidekicks].sort((a, b) => classifyStep(a.agentId).order - classifyStep(b.agentId).order),
    [sidekicks]
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
// Stage box — used for ALL crews (active or empty)
// ─────────────────────────────────────────────────────────────────────────────
function StageBox({
  section, minions, childrenByParent, onOpen,
  stageIdx, collapsed, onToggle,
}: {
  section: CrewConfig;
  minions: FrontendMinionMetadata[];
  childrenByParent: Map<string, FrontendMinionMetadata[]>;
  onOpen: (ws: FrontendMinionMetadata) => void;
  stageIdx: number; collapsed: boolean; onToggle: () => void;
}) {
  const color   = resolveCrewColor(section.color);
  const active  = minions.some(w => w.taskStatus === "running");
  const isEmpty = minions.length === 0;

  const cliIds = useMemo(() => {
    const s = new Set<string>();
    minions.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s].slice(0, 3);
  }, [minions]);

  // Empty stages are fully desaturated / disabled — gray, no color accent
  const borderStyle = isEmpty
    ? "2px dashed rgba(120,120,120,0.22)"
    : `2px dashed ${color}50`;
  const bgStyle = isEmpty
    ? `repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(128,128,128,0.025) 5px, rgba(128,128,128,0.025) 10px)`
    : `${color}05`;

  return (
    <div
      className={cn(
        "relative rounded-xl transition-all duration-200",
        isEmpty && "opacity-35 grayscale"
      )}
      style={{
        border: borderStyle,
        background: bgStyle,
        boxShadow: active ? `0 0 0 1px ${color}22, 0 6px 20px ${color}10` : undefined,
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
            {minions.length}
          </span>
        )}
        {!isEmpty && <StageCostBadge minions={minions} color={color} />}
        {!isEmpty && (
          <span className="shrink-0 text-muted/25 group-hover/hdr:text-muted/55 transition-colors">
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </span>
        )}
      </button>

      {/* Content — only shown when has minions and not collapsed */}
      {!isEmpty && !collapsed && (
        <div className="p-2 flex flex-col gap-2">
          {minions.map(ws => (
            <ServiceNode
              key={ws.id} ws={ws}
              sidekicks={childrenByParent.get(ws.id) ?? []}
              accent={color} onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase group — wraps 3 stages with a phase header band (Gantt-style)
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_SIZE = 3;

function PhaseGroup({
  phaseIdx, phaseSections, minionsBySection, childrenByParent,
  onOpen, collapsed, toggle,
}: {
  phaseIdx: number;
  phaseSections: CrewConfig[];
  minionsBySection: Map<string | null, FrontendMinionMetadata[]>;
  childrenByParent: Map<string, FrontendMinionMetadata[]>;
  onOpen: (ws: FrontendMinionMetadata) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const phaseActive = phaseSections.some(
    s => (minionsBySection.get(s.id) ?? []).some(w => w.taskStatus === "running")
  );
  const phaseHasContent = phaseSections.some(
    s => (minionsBySection.get(s.id) ?? []).length > 0
  );
  const phaseMinions = useMemo(
    () => phaseSections.flatMap(s => minionsBySection.get(s.id) ?? []),
    [phaseSections, minionsBySection]
  );
  // Derive a phase label from crew names
  const phaseNames = phaseSections.map(s => s.name);
  const phaseSubtitle = phaseNames.length <= 2
    ? phaseNames.join(" & ")
    : `${phaseNames[0]} · ${phaseNames[1]} · ${phaseNames[2]}`;

  return (
    <div className={cn(
      "w-fit mx-auto rounded-xl overflow-hidden transition-all duration-200",
      phaseActive
        ? "border border-border/50 shadow-sm"
        : "border border-border/25"
    )}>
      {/* Phase header band */}
      <div className={cn(
        "flex items-center gap-3 px-4 py-2 border-b",
        phaseActive ? "bg-muted/12 border-border/30" : "bg-muted/6 border-border/15"
      )}>
        <span className={cn(
          "shrink-0 flex h-5 w-5 items-center justify-center rounded text-[9px] font-black",
          phaseActive ? "bg-foreground/12 text-foreground/70" : "bg-muted/15 text-foreground/30"
        )}>
          {phaseIdx + 1}
        </span>
        <span className={cn(
          "text-[9px] font-black uppercase tracking-[0.18em]",
          phaseActive ? "text-foreground/55" : "text-foreground/25"
        )}>
          Phase {phaseIdx + 1}
        </span>
        <span className={cn(
          "text-[9px] hidden sm:block",
          phaseActive ? "text-foreground/35" : "text-foreground/18"
        )}>
          {phaseSubtitle}
        </span>
        {phaseActive && <LiveDot size="sm" />}
        {phaseHasContent && (
          <div className="ml-auto flex items-center gap-2">
            {!phaseActive && (
              <span className="text-[8px] text-muted/30">
                {phaseSections.reduce((sum, s) => sum + (minionsBySection.get(s.id) ?? []).length, 0)} missions
              </span>
            )}
            <StageCostBadge minions={phaseMinions} />
          </div>
        )}
      </div>

      {/* Stage boxes — snake layout: odd phases render R→L so stage N+1
          lands directly below stage N in the same column               */}
      {(() => {
        const isReversed  = phaseIdx % 2 === 1;
        const displaySecs = isReversed ? [...phaseSections].reverse() : phaseSections;
        return (
        <div
          className="grid gap-10 p-5 items-start justify-center"
          style={{ gridTemplateColumns: `repeat(${displaySecs.length}, minmax(160px, 260px))` }}
        >
        {displaySecs.map((sec) => {
          // Always use the logical index so stage-number badges are sequential
          const logicalIdx = phaseSections.indexOf(sec);
          const globalIdx  = phaseIdx * PHASE_SIZE + logicalIdx;
          return (
            <StageBox
              key={sec.id}
              section={sec}
              minions={minionsBySection.get(sec.id) ?? []}
              childrenByParent={childrenByParent}
              onOpen={onOpen}
              stageIdx={globalIdx}
              collapsed={collapsed.has(sec.id)}
              onToggle={() => toggle(sec.id)}
            />
          );
        })}
        </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics bar
// ─────────────────────────────────────────────────────────────────────────────
function MetricsBar({ totalMissions, activeMissions, totalSidekicks, stageCount, cliIds, minions }: {
  totalMissions: number; activeMissions: number;
  totalSidekicks: number; stageCount: number; cliIds: string[];
  minions: FrontendMinionMetadata[];
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border/25 bg-background-secondary/50 flex-wrap text-[10.5px] w-fit mx-auto">
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
      {totalSidekicks > 0 && (
        <span className="text-muted/45 shrink-0">
          <strong className="text-foreground/65">{totalSidekicks}</strong> sidekicks
        </span>
      )}
      <span className="text-muted/45 shrink-0">
        <strong className="text-foreground/65">{stageCount}</strong> stages
      </span>
      <StageCostBadge minions={minions} />
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
  const { minionMetadata, setSelectedMinion } = useMinionContext();

  const projectConfig = projects.get(projectPath);
  const sections = useMemo(
    () => sortCrewsByLinkedList(projectConfig?.crews ?? []),
    [projectConfig]
  );

  const projectMinions = useMemo(
    () => Array.from(minionMetadata.values()).filter(
      ws => ws.projectPath === projectPath && !ws.archivedAt
    ),
    [minionMetadata, projectPath]
  );
  const projectWsIds = useMemo(
    () => new Set(projectMinions.map(ws => ws.id)),
    [projectMinions]
  );

  const { rootMinions, childrenByParent } = useMemo(() => {
    const roots: FrontendMinionMetadata[] = [];
    const childMap = new Map<string, FrontendMinionMetadata[]>();
    for (const ws of projectMinions) {
      if (ws.parentMinionId && projectWsIds.has(ws.parentMinionId)) {
        const arr = childMap.get(ws.parentMinionId) ?? [];
        arr.push(ws); childMap.set(ws.parentMinionId, arr);
      } else roots.push(ws);
    }
    return { rootMinions: roots, childrenByParent: childMap };
  }, [projectMinions, projectWsIds]);

  const minionsBySection = useMemo(() => {
    const map = new Map<string | null, FrontendMinionMetadata[]>();
    for (const ws of rootMinions) {
      const sid = ws.crewId ?? null;
      const arr = map.get(sid) ?? [];
      arr.push(ws); map.set(sid, arr);
    }
    return map;
  }, [rootMinions]);

  // Group crews into phases of PHASE_SIZE
  const phases = useMemo(() => {
    const result: CrewConfig[][] = [];
    for (let i = 0; i < sections.length; i += PHASE_SIZE) {
      result.push(sections.slice(i, i + PHASE_SIZE));
    }
    return result;
  }, [sections]);

  const activeMissions = rootMinions.filter(w => w.taskStatus === "running").length;
  const totalSidekicks = [...childrenByParent.values()].reduce((s, a) => s + a.length, 0);
  const allCliIds      = useMemo(() => {
    const s = new Set<string>();
    rootMinions.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s];
  }, [rootMinions]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const handleOpen = useCallback(
    (ws: FrontendMinionMetadata) => setSelectedMinion(toMinionSelection(ws)),
    [setSelectedMinion]
  );

  if (rootMinions.length === 0 && sections.length === 0) return null;

  const unsectioned = minionsBySection.get(null) ?? [];

  return (
    <div
      className="flex flex-col gap-4 w-full"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.022) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      {/* Metrics bar */}
      <MetricsBar
        totalMissions={rootMinions.length}
        activeMissions={activeMissions}
        totalSidekicks={totalSidekicks}
        stageCount={sections.length}
        cliIds={allCliIds}
        minions={rootMinions}
      />

      {/* Phase rows */}
      {sections.length > 0 && (
        <div className="flex flex-col gap-4">
          {phases.map((phaseSections, phaseIdx) => (
            <PhaseGroup
              key={phaseIdx}
              phaseIdx={phaseIdx}
              phaseSections={phaseSections}
              minionsBySection={minionsBySection}
              childrenByParent={childrenByParent}
              onOpen={handleOpen}
              collapsed={collapsed}
              toggle={toggle}
            />
          ))}
        </div>
      )}

      {/* Unsectioned minions */}
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
                sidekicks={childrenByParent.get(ws.id) ?? []}
                accent="#6b7280" onOpen={handleOpen} />
            ))}
          </div>
        </div>
      )}

      {rootMinions.length === 0 && sections.length > 0 && (
        <p className="text-center text-[10.5px] text-muted/30 py-2">
          No missions yet — dispatch one with the wizard above ↑
        </p>
      )}
    </div>
  );
}
