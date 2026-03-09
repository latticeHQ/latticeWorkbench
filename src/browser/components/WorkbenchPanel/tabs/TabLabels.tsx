/**
 * Tab label components for WorkbenchPanel tabs.
 *
 * Each tab type has its own label component that handles badges, icons, and actions.
 *
 * CostsTabLabel and StatsTabLabel subscribe to their own data to avoid re-rendering
 * the entire WorkbenchPanelTabsetNode tree when stats update during agent streaming.
 */

import React from "react";
import {
  Brain,
  Calendar,
  Clock,
  ExternalLink,
  FolderTree,
  Globe,
  Plug,
  Share2,
  RefreshCw,
  Megaphone,
  PenTool,
  X,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { FileIcon } from "../../FileIcon";
import { formatTabDuration, type ReviewStats } from "./registry";
import { formatKeybind, KEYBINDS } from "@/browser/utils/ui/keybinds";
import { cn } from "@/common/lib/utils";
import { useMinionUsage, useMinionStatsSnapshot } from "@/browser/stores/MinionStore";
import { sumUsageHistory, type ChatUsageDisplay } from "@/common/utils/tokens/usageAggregator";

interface CostsTabLabelProps {
  minionId: string;
}

/**
 * Costs tab label with session cost badge.
 * Subscribes to minion usage directly to avoid re-rendering parent components.
 */
export const CostsTabLabel: React.FC<CostsTabLabelProps> = ({ minionId }) => {
  const usage = useMinionUsage(minionId);

  const sessionCost = React.useMemo(() => {
    const parts: ChatUsageDisplay[] = [];
    if (usage.sessionTotal) parts.push(usage.sessionTotal);
    if (usage.liveCostUsage) parts.push(usage.liveCostUsage);
    if (parts.length === 0) return null;

    const aggregated = sumUsageHistory(parts);
    if (!aggregated) return null;

    const total =
      (aggregated.input.cost_usd ?? 0) +
      (aggregated.cached.cost_usd ?? 0) +
      (aggregated.cacheCreate.cost_usd ?? 0) +
      (aggregated.output.cost_usd ?? 0) +
      (aggregated.reasoning.cost_usd ?? 0);
    return total > 0 ? total : null;
  }, [usage.sessionTotal, usage.liveCostUsage]);

  return (
    <>
      Budget
      {sessionCost !== null && (
        <span className="text-muted text-[10px]">
          ${sessionCost < 0.01 ? "<0.01" : sessionCost.toFixed(2)}
        </span>
      )}
    </>
  );
};

interface ReviewTabLabelProps {
  reviewStats: ReviewStats | null;
}

/** Editorial tab label with read/total badge */
export const ReviewTabLabel: React.FC<ReviewTabLabelProps> = ({ reviewStats }) => (
  <>
    Editorial
    {reviewStats !== null && reviewStats.total > 0 && (
      <span
        className={cn(
          "text-[10px]",
          reviewStats.read === reviewStats.total ? "text-muted" : "text-muted"
        )}
      >
        {reviewStats.read}/{reviewStats.total}
      </span>
    )}
  </>
);

interface StatsTabLabelProps {
  minionId: string;
}

/**
 * Stats tab label with session duration badge.
 * Subscribes to minion stats directly to avoid re-rendering parent components.
 */
export const StatsTabLabel: React.FC<StatsTabLabelProps> = ({ minionId }) => {
  const statsSnapshot = useMinionStatsSnapshot(minionId);

  const sessionDuration = React.useMemo(() => {
    const baseDuration = statsSnapshot?.session?.totalDurationMs ?? 0;
    const activeDuration = statsSnapshot?.active?.elapsedMs ?? 0;
    const total = baseDuration + activeDuration;
    return total > 0 ? total : null;
  }, [statsSnapshot]);

  return (
    <>
      Analytics
      {sessionDuration !== null && (
        <span className="text-muted text-[10px]">{formatTabDuration(sessionDuration)}</span>
      )}
    </>
  );
};

/** Assets tab label with folder tree icon */
export const ExplorerTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <FolderTree className="h-3 w-3 shrink-0" />
    Assets
  </span>
);

/** Browser tab label — shows globe icon + "Browser" text. */
export const BrowserTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Globe className="h-3 w-3 shrink-0" />
    Browser
  </span>
);

export function OutputTabLabel() {
  return <>Feed</>;
}

interface FileTabLabelProps {
  /** File path (relative to minion) */
  filePath: string;
  /** Callback when close button is clicked */
  onClose: () => void;
}

/** File tab label with file icon, filename, and close button */
export const FileTabLabel: React.FC<FileTabLabelProps> = ({ filePath, onClose }) => {
  // Extract just the filename for display
  const fileName = filePath.split("/").pop() ?? filePath;

  return (
    <span className="inline-flex items-center gap-1">
      <FileIcon fileName={fileName} style={{ fontSize: 14 }} className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[120px] truncate" title={filePath}>
        {fileName}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted hover:text-destructive -my-0.5 rounded p-0.5 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close file"
          >
            <X className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Close ({formatKeybind(KEYBINDS.CLOSE_TAB)})</TooltipContent>
      </Tooltip>
    </span>
  );
};

interface TerminalTabLabelProps {
  /** Dynamic title from OSC sequences, if available */
  dynamicTitle?: string;
  /** Terminal index (0-based) within the current tabset */
  terminalIndex: number;
  /** Callback when pop-out button is clicked */
  onPopOut: () => void;
  /** Callback when close button is clicked */
  onClose: () => void;
}

/** Terminal tab label with icon, dynamic title, and action buttons */
export const TerminalTabLabel: React.FC<TerminalTabLabelProps> = ({
  dynamicTitle,
  terminalIndex,
  onPopOut,
  onClose,
}) => {
  const fallbackName = terminalIndex === 0 ? "Workspace" : `Workspace ${terminalIndex + 1}`;
  const displayName = dynamicTitle ?? fallbackName;

  return (
    <span className="inline-flex items-center gap-1">
      <PenTool className="h-3 w-3 shrink-0" />
      <span className="max-w-[20ch] min-w-0 truncate">{displayName}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted hover:text-foreground -my-0.5 rounded p-0.5 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onPopOut();
            }}
            aria-label="Open terminal in new window"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Open in new window</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-muted hover:text-destructive -my-0.5 rounded p-0.5 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close terminal"
          >
            <X className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Close terminal ({formatKeybind(KEYBINDS.CLOSE_TAB)})
        </TooltipContent>
      </Tooltip>
    </span>
  );
};

/** Content calendar tab label — shows calendar icon + "Calendar" text. */
export const KanbanTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Calendar className="h-3 w-3 shrink-0" />
    Calendar
  </span>
);

/** Campaigns tab label — shows megaphone icon + "Campaigns" text. */
export const IssuesTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Megaphone className="h-3 w-3 shrink-0" />
    Campaigns
  </span>
);

/** Platforms tab label — shows share icon + "Platforms" text. */
export const InferenceTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Share2 className="h-3 w-3 shrink-0" />
    Platforms
  </span>
);

/** Schedules tab label — shows clock icon + "Schedules" text. */
export const SchedulesTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Clock className="h-3 w-3 shrink-0" />
    Schedules
  </span>
);

/** Sync tab label — shows refresh icon + "Sync" text. */
export const SyncTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <RefreshCw className="h-3 w-3 shrink-0" />
    Sync
  </span>
);

/** Insights tab label — shows brain icon + "Insights" text. */
export const ReflectionsTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Brain className="h-3 w-3 shrink-0" />
    Insights
  </span>
);

/** Integrations tab label — shows plug icon + "Integrations" text. */
export const IntegrationsTabLabel: React.FC = () => (
  <span className="inline-flex items-center gap-1">
    <Plug className="h-3 w-3 shrink-0" />
    Integrations
  </span>
);
