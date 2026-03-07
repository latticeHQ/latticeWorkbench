/**
 * Reflections Tab — Episodic memory viewer for a minion.
 *
 * Shows the structured reflections the agent wrote when the circuit breaker
 * fired, allowing users to see what the agent tried, what failed, and what
 * strategy it pivoted to. Users can mark reflections as resolved or clear all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, CheckCircle2, Circle, Trash2 } from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import type { ReflectionData } from "@/common/orpc/schemas";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReflectionsTabProps {
  minionId: string;
}

// ---------------------------------------------------------------------------
// Trigger badge colors
// ---------------------------------------------------------------------------

const TRIGGER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  soft_limit: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Soft Limit" },
  revert: { bg: "bg-red-500/20", text: "text-red-400", label: "Revert" },
  manual: { bg: "bg-sky-500/20", text: "text-sky-400", label: "Manual" },
};

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReflectionsTab({ minionId }: ReflectionsTabProps): React.JSX.Element {
  const { api } = useAPI();
  const [reflections, setReflections] = useState<ReflectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef<() => Promise<void>>();

  fetchRef.current = async () => {
    if (!api) return;
    try {
      const data = await api.reflections.list({ minionId });
      setReflections(data);
    } catch {
      // Non-fatal — tab just shows empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRef.current?.();
  }, [api, minionId]);

  // Refresh on window focus (user may switch back after agent worked)
  useEffect(() => {
    const handleFocus = (): void => {
      void fetchRef.current?.();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const handleToggleResolved = useCallback(
    async (id: string, resolved: boolean) => {
      if (!api) return;
      // Optimistic update
      setReflections((prev) =>
        prev.map((r) => (r.id === id ? { ...r, resolved } : r)),
      );
      try {
        await api.reflections.resolve({ minionId, reflectionId: id, resolved });
      } catch {
        // Revert on error
        setReflections((prev) =>
          prev.map((r) => (r.id === id ? { ...r, resolved: !resolved } : r)),
        );
      }
    },
    [api, minionId],
  );

  const handleClearAll = useCallback(async () => {
    if (!api) return;
    const prev = reflections;
    setReflections([]);
    try {
      await api.reflections.clear({ minionId });
    } catch {
      setReflections(prev);
    }
  }, [api, minionId, reflections]);

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/40">
        Loading reflections...
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------

  if (reflections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/40">
        <Brain className="h-10 w-10 opacity-30" />
        <div className="text-sm font-medium">No reflections yet</div>
        <div className="max-w-[280px] text-xs leading-relaxed">
          When the circuit breaker fires, the agent writes a structured reflection
          about what went wrong. Those reflections appear here and get re-injected
          on future turns so the agent learns from its mistakes.
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Reflection cards
  // ---------------------------------------------------------------------------

  const unresolvedCount = reflections.filter((r) => !r.resolved).length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50">
          {reflections.length} reflection{reflections.length !== 1 ? "s" : ""}
          {unresolvedCount < reflections.length && (
            <span className="text-white/30">
              {" "}
              ({unresolvedCount} unresolved)
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => void handleClearAll()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
        >
          <Trash2 className="h-3 w-3" />
          Clear all
        </button>
      </div>

      {/* Cards — newest first */}
      {[...reflections].reverse().map((reflection) => {
        const trigger = TRIGGER_STYLES[reflection.trigger] ?? TRIGGER_STYLES.manual;
        return (
          <div
            key={reflection.id}
            className={`rounded-lg border border-white/[0.06] p-3 transition-colors ${
              reflection.resolved ? "opacity-50" : ""
            }`}
          >
            {/* Card header */}
            <div className="mb-2 flex items-center gap-2">
              <span
                className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${trigger.bg} ${trigger.text}`}
              >
                {trigger.label}
              </span>
              {reflection.phase && (
                <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-white/40">
                  {reflection.phase}
                </span>
              )}
              <span className="text-[9px] text-white/30">
                turn {reflection.turnCount}
              </span>
              <span className="ml-auto text-[9px] text-white/20">
                {timeAgo(reflection.timestamp)}
              </span>
            </div>

            {/* Content */}
            <div className="text-xs leading-relaxed whitespace-pre-wrap text-white/70">
              {reflection.content}
            </div>

            {/* Resolved toggle */}
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void handleToggleResolved(reflection.id, !reflection.resolved)}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors ${
                  reflection.resolved
                    ? "text-emerald-400 hover:text-emerald-300"
                    : "text-white/30 hover:text-white/50"
                }`}
              >
                {reflection.resolved ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                {reflection.resolved ? "Resolved" : "Mark resolved"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
