/**
 * Simulation Monitor — console-style log panel showing real-time simulation events.
 *
 * Displays timestamped events with color-coded types (info, action, viral, error).
 */

import React, { useRef, useEffect } from "react";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";

export interface MonitorEntry {
  timestamp: string;
  type: "info" | "action" | "viral" | "graph" | "error" | "complete";
  message: string;
}

interface SimulationMonitorProps {
  entries: MonitorEntry[];
  expanded: boolean;
  onToggle: () => void;
  simulationId?: string;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  info: "text-slate-400",
  action: "text-blue-400",
  viral: "text-amber-400",
  graph: "text-purple-400",
  error: "text-red-400",
  complete: "text-green-400",
};

const TYPE_PREFIX: Record<string, string> = {
  info: "ℹ",
  action: "▸",
  viral: "★",
  graph: "◈",
  error: "✗",
  complete: "✓",
};

export const SimulationMonitor: React.FC<SimulationMonitorProps> = ({
  entries,
  expanded,
  onToggle,
  simulationId,
  className = "",
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, expanded]);

  return (
    <div className={`border-t border-border bg-[#0d1117] ${className}`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Terminal className="h-3 w-3" />
        <span className="font-medium uppercase tracking-wider">Simulation Monitor</span>
        {simulationId && (
          <span className="text-[10px] text-muted-foreground/50 font-mono ml-2">
            {simulationId}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="text-[10px]">{entries.length} events</span>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </span>
      </button>

      {/* Log entries */}
      {expanded && (
        <div
          ref={scrollRef}
          className="h-[140px] overflow-y-auto font-mono text-[11px] leading-[18px] px-3 pb-2"
        >
          {entries.length === 0 ? (
            <div className="text-muted-foreground/30 text-center py-4">
              No simulation events yet
            </div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} className="flex gap-2 hover:bg-white/[0.02]">
                <span className="text-muted-foreground/40 select-none shrink-0">
                  {entry.timestamp}
                </span>
                <span className={`select-none ${TYPE_COLORS[entry.type] ?? TYPE_COLORS.info}`}>
                  {TYPE_PREFIX[entry.type] ?? "·"}
                </span>
                <span className="text-slate-300">{entry.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
