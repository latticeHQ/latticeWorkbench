/**
 * StatusBar — slim persistent bottom bar showing live workspace context.
 *
 * Displays: active running agents, session cost, total tokens, streaming TPS.
 * Always visible at the bottom of WorkspaceShell (below MainArea + RightSidebar).
 */
import React, { useMemo } from "react";
import { cn } from "@/common/lib/utils";
import { useWorkspaceState, useWorkspaceUsage } from "@/browser/stores/WorkspaceStore";
import { useWorkspaceContext } from "@/browser/contexts/WorkspaceContext";
import { getTotalCost, formatCostWithDollar } from "@/common/utils/tokens/usageAggregator";
import { formatTokens } from "@/common/utils/tokens/tokenMeterUtils";

interface StatusBarProps {
  workspaceId: string;
}

export function StatusBar({ workspaceId }: StatusBarProps) {
  const wsState = useWorkspaceState(workspaceId);
  const usage = useWorkspaceUsage(workspaceId);
  const { workspaceMetadata } = useWorkspaceContext();

  const isStreaming = wsState.loading;
  const tps = wsState.streamingTPS;
  const cost = getTotalCost(usage.sessionTotal);
  const tokens = usage.totalTokens;

  // Count child agent tasks that are actively running
  const runningChildren = useMemo(
    () =>
      Array.from(workspaceMetadata.values()).filter(
        (ws) => ws.parentWorkspaceId === workspaceId && ws.taskStatus === "running"
      ).length,
    [workspaceMetadata, workspaceId]
  );

  const totalRunning = runningChildren + (isStreaming ? 1 : 0);
  const hasAnything = totalRunning > 0 || cost !== undefined || tokens > 0;

  if (!hasAnything) return <div className="border-border-light border-t h-7" />;

  return (
    <div
      className={cn(
        "border-border-light bg-background-secondary flex h-7 shrink-0 items-center gap-4 border-t px-4 text-[10px]",
        "transition-colors duration-300"
      )}
    >
      {/* Running agents indicator */}
      {totalRunning > 0 ? (
        <span className="flex items-center gap-1.5 text-[var(--color-exec-mode)]">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-exec-mode)]" />
          </span>
          <span className="font-medium">
            {totalRunning} {totalRunning === 1 ? "agent" : "agents"} running
          </span>
        </span>
      ) : (
        <span className="text-muted flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-muted)] opacity-40" />
          <span>idle</span>
        </span>
      )}

      <span className="bg-border-light h-3 w-px shrink-0" />

      {/* Cost */}
      {cost !== undefined && (
        <span className="text-muted tabular-nums">
          {formatCostWithDollar(cost)}
        </span>
      )}

      {/* Tokens */}
      {tokens > 0 && (
        <span className="text-muted tabular-nums">
          {formatTokens(tokens)} tok
        </span>
      )}

      {/* Live TPS */}
      {isStreaming && tps !== undefined && tps > 0 && (
        <>
          <span className="bg-border-light h-3 w-px shrink-0" />
          <span className="text-[var(--color-exec-mode)] tabular-nums font-medium">
            {tps.toFixed(1)} t/s
          </span>
        </>
      )}

      {/* Spacer — pushes workspace name to right */}
      <span className="flex-1" />

      {/* Workspace name (right-aligned) */}
      <span className="text-muted truncate max-w-[200px]">
        {wsState.name}
      </span>
    </div>
  );
}
