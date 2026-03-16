/**
 * Activity Feed — rich feed showing agent actions with avatars, content previews,
 * action badges, and engagement metrics. Professional social platform-style feed.
 */

import React, { useMemo, useState } from "react";
import {
  Heart,
  MessageSquare,
  Share2,
  Eye,
  TrendingUp,
  ThumbsDown,
  Zap,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";
import type { SimulationRoundResult } from "./useSimulation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeedAction {
  round: number;
  agentId: string;
  agentName: string;
  actionType: string;
  platform: string;
  content?: string;
  target?: string;
  thinking?: string;
  success?: boolean;
  timestamp?: string;
}

interface ActivityFeedProps {
  rounds: SimulationRoundResult[];
  maxItems?: number;
  className?: string;
  onAgentClick?: (agentId: string) => void;
}

// ---------------------------------------------------------------------------
// Action styling
// ---------------------------------------------------------------------------

const ACTION_CONFIG: Record<
  string,
  { icon: LucideIcon; color: string; bg: string; label: string }
> = {
  POST: { icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/10", label: "POST" },
  CREATE_POST: { icon: MessageSquare, color: "text-blue-400", bg: "bg-blue-500/10", label: "POST" },
  COMMENT: { icon: MessageSquare, color: "text-cyan-400", bg: "bg-cyan-500/10", label: "COMMENT" },
  REPLY: { icon: MessageSquare, color: "text-teal-400", bg: "bg-teal-500/10", label: "REPLY" },
  LIKE: { icon: Heart, color: "text-pink-400", bg: "bg-pink-500/10", label: "LIKE" },
  SHARE: { icon: Share2, color: "text-purple-400", bg: "bg-purple-500/10", label: "SHARE" },
  UPVOTE: { icon: TrendingUp, color: "text-green-400", bg: "bg-green-500/10", label: "UPVOTE" },
  DOWNVOTE: { icon: ThumbsDown, color: "text-red-400", bg: "bg-red-500/10", label: "DOWNVOTE" },
  VIEW: { icon: Eye, color: "text-slate-400", bg: "bg-slate-500/10", label: "VIEW" },
  SEARCH: { icon: Eye, color: "text-indigo-400", bg: "bg-indigo-500/10", label: "SEARCH" },
  FOLLOW: { icon: Heart, color: "text-pink-300", bg: "bg-pink-400/10", label: "FOLLOW" },
  MUTE: { icon: Eye, color: "text-slate-500", bg: "bg-slate-600/10", label: "MUTE" },
};

const DEFAULT_CONFIG = {
  icon: Zap,
  color: "text-amber-400",
  bg: "bg-amber-500/10",
  label: "ACT",
};

// Generate deterministic avatar color from agent name
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "#7c3aed", "#2563eb", "#059669", "#d97706", "#db2777",
    "#0891b2", "#ea580c", "#65a30d", "#c026d3", "#0284c7",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function avatarInitials(name: string): string {
  // Handle stat_ prefix agents
  const cleaned = name.replace(/^stat_/, "");
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function formatDisplayName(name: string): string {
  // Make stat_ agent names more readable
  if (name.startsWith("stat_")) {
    return name
      .replace(/^stat_/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return name;
}

// ---------------------------------------------------------------------------
// Feed Item
// ---------------------------------------------------------------------------

const FeedItem: React.FC<{
  action: FeedAction;
  onAgentClick?: (agentId: string) => void;
  expanded?: boolean;
}> = ({ action, onAgentClick }) => {
  const config = ACTION_CONFIG[action.actionType] ?? DEFAULT_CONFIG;
  const Icon = config.icon;
  const color = avatarColor(action.agentName);
  const [showThinking, setShowThinking] = useState(false);
  const displayName = formatDisplayName(action.agentName);
  const isStatistical = action.agentName.startsWith("stat_");

  return (
    <div className="flex gap-2.5 px-3 py-2.5 hover:bg-white/[0.02] transition-colors border-b border-border/20 last:border-0 group">
      {/* Avatar */}
      <button
        onClick={() => onAgentClick?.(action.agentId)}
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm hover:ring-2 hover:ring-primary/40 transition-all"
        style={{ backgroundColor: color }}
        title={action.agentName}
      >
        {avatarInitials(action.agentName)}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Header row */}
        <div className="flex items-center gap-1.5 mb-0.5">
          <button
            onClick={() => onAgentClick?.(action.agentId)}
            className="text-[12px] font-semibold text-foreground hover:text-primary transition-colors truncate max-w-[140px]"
          >
            {displayName}
          </button>

          {/* Platform badge */}
          {action.platform && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground font-medium uppercase">
              {action.platform}
            </span>
          )}

          {/* Action badge */}
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${config.color} ${config.bg}`}
          >
            <Icon className="h-2.5 w-2.5" />
            {config.label}
          </span>

          {/* Round + time */}
          <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
            R{action.round}
            {action.timestamp ? ` · ${formatTime(action.timestamp)}` : ""}
          </span>
        </div>

        {/* Target */}
        {action.target && (
          <div className="text-[10px] text-muted-foreground/60 mb-0.5">
            {action.actionType === "LIKE" || action.actionType === "UPVOTE"
              ? "Liked"
              : action.actionType === "REPLY" || action.actionType === "COMMENT"
                ? "Replied to"
                : action.actionType === "DOWNVOTE"
                  ? "Downvoted"
                  : "→"}{" "}
            <span className="text-foreground/50 font-medium">@{action.target}</span>
          </div>
        )}

        {/* Content text */}
        {action.content && !isStatistical && (
          <div className="text-[12px] text-foreground/80 leading-relaxed mt-0.5">
            {action.content.length > 300
              ? action.content.slice(0, 300) + "..."
              : action.content}
          </div>
        )}

        {/* Statistical agent content (smaller, dimmer) */}
        {action.content && isStatistical && (
          <div className="text-[10px] text-muted-foreground/40 italic mt-0.5">
            {action.content}
          </div>
        )}

        {/* Agent reasoning (expandable) */}
        {action.thinking &&
          action.thinking !== "Failed to parse response" && (
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-0.5 mt-1 text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
            >
              {showThinking ? (
                <ChevronUp className="h-2.5 w-2.5" />
              ) : (
                <ChevronDown className="h-2.5 w-2.5" />
              )}
              agent reasoning
            </button>
          )}
        {showThinking && action.thinking && (
          <div className="text-[10px] text-muted-foreground/40 italic mt-1 pl-2 border-l-2 border-border/30 leading-relaxed">
            {action.thinking.slice(0, 400)}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Format time
// ---------------------------------------------------------------------------

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  rounds,
  maxItems = 100,
  className = "",
  onAgentClick,
}) => {
  // Flatten all actions from all rounds, most recent first
  // IMPORTANT: Enrich with round number from parent since oRPC may strip it
  const allActions = useMemo(() => {
    const actions: FeedAction[] = [];
    for (let i = rounds.length - 1; i >= 0; i--) {
      const round = rounds[i];
      for (const action of round.actions) {
        if (action.actionType === "DO_NOTHING") continue;
        actions.push({
          round: (action as any).round ?? round.round,
          agentId: action.agentId,
          agentName: action.agentName,
          actionType: action.actionType,
          platform: action.platform ?? "forum",
          content: action.content,
          target: action.target ?? action.targetId,
          thinking: action.thinking,
          success: action.success,
          timestamp: action.timestamp,
        });
        if (actions.length >= maxItems) break;
      }
      if (actions.length >= maxItems) break;
    }
    return actions;
  }, [rounds, maxItems]);

  // Comprehensive stats
  const stats = useMemo(() => {
    let posts = 0,
      likes = 0,
      comments = 0,
      shares = 0,
      upvotes = 0,
      downvotes = 0;
    for (const a of allActions) {
      switch (a.actionType) {
        case "POST":
        case "CREATE_POST":
          posts++;
          break;
        case "LIKE":
          likes++;
          break;
        case "COMMENT":
        case "REPLY":
          comments++;
          break;
        case "SHARE":
          shares++;
          break;
        case "UPVOTE":
          upvotes++;
          break;
        case "DOWNVOTE":
          downvotes++;
          break;
      }
    }
    return { posts, likes, comments, shares, upvotes, downvotes };
  }, [allActions]);

  // Unique active agents
  const uniqueAgents = useMemo(() => {
    return new Set(allActions.map((a) => a.agentId)).size;
  }, [allActions]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Stats header */}
      <div className="px-3 py-2.5 border-b border-border bg-card/50">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Activity Feed
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {uniqueAgents} agents · {allActions.length} events
          </span>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <StatBadge icon={MessageSquare} count={stats.posts} label="posts" color="text-blue-400" />
          <StatBadge icon={Heart} count={stats.likes} label="likes" color="text-pink-400" />
          <StatBadge icon={MessageSquare} count={stats.comments} label="comments" color="text-cyan-400" />
          <StatBadge icon={TrendingUp} count={stats.upvotes} label="up" color="text-green-400" />
          <StatBadge icon={ThumbsDown} count={stats.downvotes} label="down" color="text-red-400" />
          {stats.shares > 0 && (
            <StatBadge icon={Share2} count={stats.shares} label="shares" color="text-purple-400" />
          )}
        </div>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto">
        {allActions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground/15 mb-2" />
            <p className="text-xs text-muted-foreground/40">
              No activity yet — run a simulation to see agent interactions
            </p>
          </div>
        ) : (
          allActions.map((action, i) => (
            <FeedItem
              key={`${action.round}-${action.agentId}-${action.actionType}-${i}`}
              action={action}
              onAgentClick={onAgentClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Stat Badge
// ---------------------------------------------------------------------------

const StatBadge: React.FC<{
  icon: LucideIcon;
  count: number;
  label: string;
  color?: string;
}> = ({ icon: Icon, count, label, color = "text-muted-foreground" }) => (
  <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
    <Icon className={`h-3 w-3 ${color}`} />
    <span className="font-semibold text-foreground/70">{count}</span>
    <span className="text-muted-foreground/60">{label}</span>
  </div>
);
