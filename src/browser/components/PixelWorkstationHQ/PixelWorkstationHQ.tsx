/**
 * PixelWorkstationHQ — Agent Network grid layout + pixel art workstation cards.
 *
 * Clones ProjectHQOverview structure (phases, stages, snake layout) but
 * replaces ServiceNode text cards with pixel-art desk+character scenes.
 * Includes time-of-day ambient lighting (morning/afternoon/evening/night).
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
  CheckCircle2, Clock, DollarSign, Zap, Users, Building,
  ChevronDown, ChevronRight, Activity, ArrowRight,
  Sun, Moon, Sunrise, Sunset,
} from "lucide-react";
import { Shimmer } from "../ai-elements/shimmer";
import { getTotalCost, formatCostWithDollar } from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";
import { CliAgentIcon } from "../CliAgentIcon";
import {
  type CharState, type CharPalette, type DeskPalette,
  CHAR_FRAMES, ANIM_INTERVALS,
  buildPalette, buildCharShadow, buildDeskPalette,
  DESK_RECTS,
} from "./pixelSprites";
import { useCharacterWalk } from "./useCharacterWalk";
import { SCENE_PX_W, SCENE_PX_H, DESK_SVG_W, DESK_SVG_H } from "./tileGrid";

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline step classifier (same as ProjectHQOverview)
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
// Time-of-day ambient system
// ─────────────────────────────────────────────────────────────────────────────
type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

const TIME_LABELS: Record<TimeOfDay, string> = {
  morning:   "Morning",
  afternoon: "Afternoon",
  evening:   "Evening",
  night:     "Night",
};

const TIME_ICONS: Record<TimeOfDay, typeof Sun> = {
  morning:   Sunrise,
  afternoon: Sun,
  evening:   Sunset,
  night:     Moon,
};

/** Ambient overlay — subtle gradient that tints the entire HQ view. */
const TIME_AMBIENCE: Record<TimeOfDay, { gradient: string; dotBg: string }> = {
  morning: {
    gradient: "linear-gradient(180deg, rgba(255,200,100,0.04) 0%, transparent 60%)",
    dotBg: "rgba(255,200,100,0.025)",
  },
  afternoon: {
    gradient: "linear-gradient(180deg, rgba(255,255,220,0.03) 0%, transparent 50%)",
    dotBg: "rgba(255,255,220,0.02)",
  },
  evening: {
    gradient: "linear-gradient(180deg, rgba(255,120,60,0.05) 0%, transparent 60%)",
    dotBg: "rgba(255,120,60,0.02)",
  },
  night: {
    gradient: "linear-gradient(180deg, rgba(40,50,100,0.08) 0%, transparent 60%)",
    dotBg: "rgba(100,120,200,0.015)",
  },
};

function getTimeOfDay(): TimeOfDay {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
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
// Stage / phase cost rollup badge
// ─────────────────────────────────────────────────────────────────────────────
function StageCostBadge({ minions, color }: {
  minions: FrontendMinionMetadata[]; color?: string;
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
// Pixel art components
// ─────────────────────────────────────────────────────────────────────────────

/** Inline SVG full workstation scene: dual monitors, plant, bookshelf, lamp. */
function PixelDesk({ palette, timeOfDay }: { palette: DeskPalette; timeOfDay: TimeOfDay }) {
  // Night mode dims screens slightly
  const screenOpacity = timeOfDay === "night" ? 0.7 : 1;

  return (
    <svg
      viewBox="-2 0 34 14"
      width={102}
      height={42}
      className="shrink-0"
      style={{ imageRendering: "pixelated" }}
    >
      {DESK_RECTS.map((rect, i) => {
        const isScreen = rect.colorKey === "screen" || rect.colorKey === "screen2" || rect.colorKey === "screenLine";
        return (
          <rect
            key={i}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            fill={palette[rect.colorKey]}
            opacity={isScreen ? screenOpacity : 1}
          />
        );
      })}
    </svg>
  );
}

/** Pixel-art character scale (matches MINI_TILE_PX rendering). */
const CHAR_SCALE = 3;
/** Character sprite dimensions in pixel-space (8×12 grid). */
const CHAR_PX_W = 8;
/** Row of the shoe pixels in the sprite — used as the foot anchor. */
const CHAR_FEET_ROW = 10;

/** Scene container screen dimensions. */
const SCENE_SCREEN_W = SCENE_PX_W * CHAR_SCALE; // 108
const SCENE_SCREEN_H = SCENE_PX_H * CHAR_SCALE; // 72
/** Horizontal offset to center the desk SVG (102px) inside the container (108px). */
const DESK_OFFSET_X = Math.floor((SCENE_SCREEN_W - DESK_SVG_W) / 2); // 3

/** CSS box-shadow pixel character with animation and feet-anchored positioning. */
function PixelCharacter({
  charState, palette, x, y,
}: {
  charState: CharState; palette: CharPalette;
  /** Pixel-space position from useCharacterWalk hook. */
  x: number; y: number;
}) {
  const frames = CHAR_FRAMES[charState];
  const interval = ANIM_INTERVALS[charState];
  const [frameIdx, setFrameIdx] = useState(0);

  useEffect(() => {
    if (frames.length <= 1 || interval === 0) {
      setFrameIdx(0);
      return;
    }
    const timer = setInterval(() => {
      setFrameIdx(prev => (prev + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [frames.length, interval]);

  const shadow = useMemo(
    () => buildCharShadow(frames[frameIdx % frames.length], palette),
    [frames, frameIdx, palette]
  );

  // Feet-based anchoring: tile position = where the character's feet are.
  // The shoe row (10) aligns with the tile center vertically.
  // Horizontally the sprite is centered on the tile.
  const screenLeft = x * CHAR_SCALE - (CHAR_PX_W * CHAR_SCALE) / 2;
  const screenTop  = y * CHAR_SCALE - CHAR_FEET_ROW * CHAR_SCALE;

  return (
    <div
      className="absolute"
      style={{
        width: CHAR_PX_W * CHAR_SCALE,
        height: CHAR_PX_W * CHAR_SCALE + CHAR_FEET_ROW * CHAR_SCALE, // full sprite height
        left: screenLeft,
        top: screenTop,
        zIndex: 10,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          boxShadow: shadow,
          transform: `scale(${CHAR_SCALE})`,
          transformOrigin: "top left",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pixel Workstation Card — replaces ServiceNode
// ─────────────────────────────────────────────────────────────────────────────
function PixelWorkstationCard({ ws, sidekicks, accent, onOpen, timeOfDay }: {
  ws: FrontendMinionMetadata; sidekicks: FrontendMinionMetadata[];
  accent: string; onOpen: (ws: FrontendMinionMetadata) => void;
  timeOfDay: TimeOfDay;
}) {
  const state   = useMinionSidebarState(ws.id);
  const usage   = useMinionUsage(ws.id);
  const live    = state.canInterrupt || state.isStarting;
  const waiting = !live && state.awaitingUserQuestion;
  const done    = ws.taskStatus === "reported";
  const queued  = ws.taskStatus === "queued";
  const title   = ws.title ?? ws.name;
  const cost    = getTotalCost(usage.sessionTotal) ?? 0;
  const tok     = usage.totalTokens;

  // Character walk hook — manages position + FSM
  const walkResult = useCharacterWalk(live, waiting, done);
  const charPalette = useMemo(() => buildPalette(accent), [accent]);
  const deskPalette = useMemo(() => buildDeskPalette(accent, live), [accent, live]);

  const sorted = useMemo(
    () => [...sidekicks].sort((a, b) => classifyStep(a.agentId).order - classifyStep(b.agentId).order),
    [sidekicks]
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
      {/* Top accent bar */}
      <div className="h-[2.5px] w-full shrink-0" style={{
        background: live ? "var(--color-exec-mode)" : waiting ? "#f59e0b" : done ? "var(--color-success)" : accent,
        opacity: done ? 0.3 : live ? 1 : 0.65,
      }} />

      <div className="flex flex-col gap-1.5 p-2">
        {/* ── Pixel scene: desk + character (absolute positioned world) ── */}
        <div
          className="relative rounded-md overflow-hidden"
          style={{
            background: `${accent}08`,
            width: SCENE_SCREEN_W,
            height: SCENE_SCREEN_H,
            margin: "0 auto",
          }}
        >
          {/* Ambient glow when live */}
          {live && (
            <div
              className="absolute inset-0 animate-pulse"
              style={{ background: `radial-gradient(ellipse at 50% 20%, ${accent}15 0%, transparent 60%)` }}
            />
          )}

          {/* Floor area below desk — subtle pixel tile pattern */}
          <div
            className="absolute left-0 right-0 bottom-0"
            style={{
              top: DESK_SVG_H,
              background: `${accent}06`,
              backgroundImage: `radial-gradient(circle, ${accent}12 0.5px, transparent 0.5px)`,
              backgroundSize: "6px 6px",
            }}
          />

          {/* Desk as background layer — positioned at top */}
          <div className="absolute" style={{ top: 0, left: DESK_OFFSET_X }}>
            <PixelDesk palette={deskPalette} timeOfDay={timeOfDay} />
          </div>

          {/* Character — feet-anchored, positioned by walk hook */}
          <PixelCharacter
            charState={walkResult.charState}
            palette={charPalette}
            x={walkResult.x}
            y={walkResult.y}
          />

          {/* Waiting bubble */}
          {waiting && (
            <div className="absolute top-0.5 left-1/3 text-[10px] font-bold text-amber-400 animate-bounce z-20">?</div>
          )}
          {/* Done checkmark */}
          {done && (
            <div className="absolute top-0.5 right-1 text-[var(--color-success)] z-20">
              <CheckCircle2 className="h-3 w-3" />
            </div>
          )}
        </div>

        {/* ── Info overlay ── */}
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

        {/* CLI agent ID */}
        {ws.agentId && (
          <div className="flex items-center gap-0.5">
            {KNOWN_CLI.has(ws.agentId) ? (
              <span className="flex items-center gap-0.5 text-[8px] text-foreground/35 font-mono">
                <CliAgentIcon slug={ws.agentId} className="h-2.5 w-2.5" />{ws.agentId}
              </span>
            ) : (
              <span className="text-[8px] text-foreground/30 font-mono">{ws.agentId}</span>
            )}
          </div>
        )}

        {/* Metrics row */}
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

        {/* Sidekick rows */}
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
// Stage box — crew container with pixel workstation cards inside
// ─────────────────────────────────────────────────────────────────────────────
function HQStageBox({
  section, minions, childrenByParent, onOpen,
  stageIdx, collapsed, onToggle, timeOfDay,
}: {
  section: CrewConfig;
  minions: FrontendMinionMetadata[];
  childrenByParent: Map<string, FrontendMinionMetadata[]>;
  onOpen: (ws: FrontendMinionMetadata) => void;
  stageIdx: number; collapsed: boolean; onToggle: () => void;
  timeOfDay: TimeOfDay;
}) {
  const color   = resolveCrewColor(section.color);
  const active  = minions.some(w => w.taskStatus === "running");
  const isEmpty = minions.length === 0;

  const cliIds = useMemo(() => {
    const s = new Set<string>();
    minions.forEach(w => { if (w.agentId && KNOWN_CLI.has(w.agentId)) s.add(w.agentId); });
    return [...s].slice(0, 3);
  }, [minions]);

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

      {/* Content — pixel workstation cards */}
      {!isEmpty && !collapsed && (
        <div className="p-2 flex flex-col gap-2">
          {minions.map(ws => (
            <PixelWorkstationCard
              key={ws.id} ws={ws}
              sidekicks={childrenByParent.get(ws.id) ?? []}
              accent={color} onOpen={onOpen}
              timeOfDay={timeOfDay}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase group — 3 stages with phase header and snake layout
// ─────────────────────────────────────────────────────────────────────────────
const PHASE_SIZE = 3;

function HQPhaseGroup({
  phaseIdx, phaseSections, minionsBySection, childrenByParent,
  onOpen, collapsed, toggle, timeOfDay,
}: {
  phaseIdx: number;
  phaseSections: CrewConfig[];
  minionsBySection: Map<string | null, FrontendMinionMetadata[]>;
  childrenByParent: Map<string, FrontendMinionMetadata[]>;
  onOpen: (ws: FrontendMinionMetadata) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  timeOfDay: TimeOfDay;
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

      {/* Stage boxes — snake layout */}
      {(() => {
        const isReversed  = phaseIdx % 2 === 1;
        const displaySecs = isReversed ? [...phaseSections].reverse() : phaseSections;
        return (
        <div
          className="grid gap-10 p-5 items-start justify-center"
          style={{ gridTemplateColumns: `repeat(${displaySecs.length}, minmax(180px, 280px))` }}
        >
        {displaySecs.map((sec) => {
          const logicalIdx = phaseSections.indexOf(sec);
          const globalIdx  = phaseIdx * PHASE_SIZE + logicalIdx;
          return (
            <HQStageBox
              key={sec.id}
              section={sec}
              minions={minionsBySection.get(sec.id) ?? []}
              childrenByParent={childrenByParent}
              onOpen={onOpen}
              stageIdx={globalIdx}
              collapsed={collapsed.has(sec.id)}
              onToggle={() => toggle(sec.id)}
              timeOfDay={timeOfDay}
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
function HQMetricsBar({ totalMissions, activeMissions, totalSidekicks, stageCount, cliIds, minions, timeOfDay, onCycleTime }: {
  totalMissions: number; activeMissions: number;
  totalSidekicks: number; stageCount: number; cliIds: string[];
  minions: FrontendMinionMetadata[];
  timeOfDay: TimeOfDay;
  onCycleTime: () => void;
}) {
  const TimeIcon = TIME_ICONS[timeOfDay];
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border/25 bg-background-secondary/50 flex-wrap text-[10.5px] w-fit mx-auto">
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-6 w-6 flex items-center justify-center rounded-md border border-border/35 bg-background-secondary">
          <Building className="h-3 w-3 text-muted/55" />
        </div>
        <span className="text-foreground/40 text-[9px] font-bold uppercase tracking-widest">Workbench</span>
      </div>
      <div className="w-px h-4 bg-border/25 shrink-0" />

      {/* Time of day switcher */}
      <button
        onClick={onCycleTime}
        className="flex items-center gap-1 text-[9px] text-muted/50 hover:text-foreground/60 transition-colors cursor-pointer border-none bg-transparent p-0"
        title={`${TIME_LABELS[timeOfDay]} — click to cycle`}
      >
        <TimeIcon className="h-3 w-3" />
        <span className="font-medium">{TIME_LABELS[timeOfDay]}</span>
      </button>
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
export function PixelWorkstationHQ({ projectPath, projectName: _pn }: {
  projectPath: string; projectName: string;
}) {
  const { projects }                          = useProjectContext();
  const { minionMetadata, setSelectedMinion } = useMinionContext();

  // Time-of-day ambient — auto-detect from local clock, with manual override
  const [timeOverride, setTimeOverride] = useState<TimeOfDay | null>(null);
  const [autoTime, setAutoTime] = useState<TimeOfDay>(getTimeOfDay);

  // Update auto time every minute
  useEffect(() => {
    const interval = setInterval(() => setAutoTime(getTimeOfDay()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const timeOfDay = timeOverride ?? autoTime;
  const cycleOrder: TimeOfDay[] = ["morning", "afternoon", "evening", "night"];
  const handleCycleTime = useCallback(() => {
    const current = timeOverride ?? autoTime;
    const idx = cycleOrder.indexOf(current);
    const next = cycleOrder[(idx + 1) % cycleOrder.length];
    // If cycling back to auto time, clear override
    if (next === autoTime) {
      setTimeOverride(null);
    } else {
      setTimeOverride(next);
    }
  }, [timeOverride, autoTime]);

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

  const unsectioned = minionsBySection.get(null) ?? [];
  const ambience = TIME_AMBIENCE[timeOfDay];
  const isEmpty = rootMinions.length === 0 && sections.length === 0;

  return (
    <div
      className="flex flex-col gap-4 w-full"
      style={{
        backgroundImage: `${ambience.gradient}, radial-gradient(circle, ${ambience.dotBg} 1px, transparent 1px)`,
        backgroundSize: "100% 100%, 22px 22px",
      }}
    >
      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center py-20 gap-6">
          {/* Pixel art empty desk scene */}
          <div className="relative">
            <svg
              viewBox="-2 0 34 14"
              width={170}
              height={70}
              style={{ imageRendering: "pixelated", opacity: 0.35 }}
            >
              {DESK_RECTS.map((rect, i) => (
                <rect
                  key={i} x={rect.x} y={rect.y} width={rect.w} height={rect.h}
                  fill={buildDeskPalette("#6b7280", false)[rect.colorKey]}
                />
              ))}
            </svg>
          </div>
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex items-center gap-2">
              <Building className="h-4 w-4 text-muted/40" />
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-foreground/30">
                Workbench
              </span>
            </div>
            <p className="text-[11px] text-muted/35 max-w-[260px] leading-relaxed">
              No missions yet. Create crews in Settings, then dispatch missions from the sidebar.
            </p>
          </div>
        </div>
      )}
      {/* Metrics bar */}
      <HQMetricsBar
        totalMissions={rootMinions.length}
        activeMissions={activeMissions}
        totalSidekicks={totalSidekicks}
        stageCount={sections.length}
        cliIds={allCliIds}
        minions={rootMinions}
        timeOfDay={timeOfDay}
        onCycleTime={handleCycleTime}
      />

      {/* Phase rows */}
      {sections.length > 0 && (
        <div className="flex flex-col gap-4">
          {phases.map((phaseSections, phaseIdx) => (
            <HQPhaseGroup
              key={phaseIdx}
              phaseIdx={phaseIdx}
              phaseSections={phaseSections}
              minionsBySection={minionsBySection}
              childrenByParent={childrenByParent}
              onOpen={handleOpen}
              collapsed={collapsed}
              toggle={toggle}
              timeOfDay={timeOfDay}
            />
          ))}
        </div>
      )}

      {/* Unsectioned minions */}
      {unsectioned.length > 0 && (
        <div className="rounded-xl w-fit mx-auto"
          style={{ border: "2px dashed rgba(107,114,128,0.3)", background: "rgba(107,114,128,0.02)" }}>
          <div className="flex items-center gap-2.5 px-3 py-2"
            style={{ borderBottom: "1px dashed rgba(107,114,128,0.2)" }}>
            <span className="h-5 w-5 flex items-center justify-center rounded bg-muted/12 text-[9px] font-bold text-muted/50">?</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.13em] text-foreground/45 flex-1">Unsectioned</span>
            <span className="text-[9px] font-semibold text-muted/40 bg-muted/10 px-1.5 py-0.5 rounded">{unsectioned.length}</span>
          </div>
          <div className="p-2 grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))" }}>
            {unsectioned.map(ws => (
              <PixelWorkstationCard key={ws.id} ws={ws}
                sidekicks={childrenByParent.get(ws.id) ?? []}
                accent="#6b7280" onOpen={handleOpen}
                timeOfDay={timeOfDay} />
            ))}
          </div>
        </div>
      )}

      {rootMinions.length === 0 && sections.length > 0 && (
        <p className="text-center text-[10.5px] text-muted/30 py-2">
          No missions yet — dispatch one with the wizard above
        </p>
      )}
    </div>
  );
}
