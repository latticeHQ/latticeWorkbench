import React from "react";

import { cn } from "@/common/lib/utils";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { useAPI } from "@/browser/contexts/API";
import { ChevronDown, ChevronRight, Loader2, Search, Trash2 } from "lucide-react";
import { ArchiveIcon, ArchiveRestoreIcon } from "./icons/ArchiveIcon";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { RuntimeBadge } from "./RuntimeBadge";
import { Skeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/browser/components/ui/dialog";
import { ForceDeleteModal } from "./ForceDeleteModal";
import { Button } from "@/browser/components/ui/button";
import type { z } from "zod";
import type { SessionUsageFileSchema } from "@/common/orpc/schemas/chatStats";
import {
  sumUsageHistory,
  getTotalCost,
  formatCostWithDollar,
} from "@/common/utils/tokens/usageAggregator";
import { useOptimisticBatchLRU } from "@/browser/hooks/useOptimisticBatchLRU";
import { sessionCostCache } from "@/browser/utils/sessionCostCache";

type SessionUsageFile = z.infer<typeof SessionUsageFileSchema>;

interface BenchedMinionsProps {
  projectPath: string;
  projectName: string;
  minions: FrontendMinionMetadata[];
  /** Called after a minion is unarchived or deleted to refresh the list */
  onMinionsChanged?: () => void;
}

interface BulkOperationState {
  type: "restore" | "delete";
  total: number;
  completed: number;
  current: string | null;
  errors: string[];
}

/** Group minions by time period for timeline display */
function groupByTimePeriod(
  minions: FrontendMinionMetadata[]
): Map<string, FrontendMinionMetadata[]> {
  const groups = new Map<string, FrontendMinionMetadata[]>();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const lastWeek = new Date(today.getTime() - 7 * 86400000);
  const lastMonth = new Date(today.getTime() - 30 * 86400000);

  // Sort by archivedAt descending (most recent first)
  const sorted = [...minions].sort((a, b) => {
    const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
    const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
    return bTime - aTime;
  });

  for (const ws of sorted) {
    const archivedDate = ws.archivedAt ? new Date(ws.archivedAt) : null;
    let period: string;

    if (!archivedDate) {
      period = "Unknown";
    } else if (archivedDate >= today) {
      period = "Today";
    } else if (archivedDate >= yesterday) {
      period = "Yesterday";
    } else if (archivedDate >= lastWeek) {
      period = "This Week";
    } else if (archivedDate >= lastMonth) {
      period = "This Month";
    } else {
      // Group by month/year for older items
      period = archivedDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }

    const existing = groups.get(period) ?? [];
    existing.push(ws);
    groups.set(period, existing);
  }

  return groups;
}

/** Flatten grouped minions back to ordered array for index-based selection */
function flattenGrouped(
  grouped: Map<string, FrontendMinionMetadata[]>
): FrontendMinionMetadata[] {
  const result: FrontendMinionMetadata[] = [];
  for (const minions of grouped.values()) {
    result.push(...minions);
  }
  return result;
}

/** Calculate total cost from a SessionUsageFile by summing all model usages */
function getSessionTotalCost(usage: SessionUsageFile | undefined): number | undefined {
  if (!usage) return undefined;
  const aggregated = sumUsageHistory(Object.values(usage.byModel));
  return getTotalCost(aggregated);
}

/** Cost badge component with size variants for different scopes.
 * Shows a shimmer skeleton while loading to prevent layout flash. */
const CostBadge: React.FC<{
  cost: number | undefined;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}> = ({ cost, loading = false, size = "md", className }) => {
  const sizeStyles = {
    sm: "px-1 py-0.5 text-[10px]",
    md: "px-1.5 py-0.5 text-xs",
    lg: "px-2 py-0.5 text-sm",
  };
  // Skeleton sizes that reserve the same space as a typical cost value (e.g., "$0.12")
  const skeletonSizes = {
    sm: "h-4 w-[5ch]",
    md: "h-5 w-[6ch]",
    lg: "h-6 w-[7ch]",
  };

  // Show skeleton while loading and no cached value available
  if (cost === undefined) {
    if (!loading) return null;
    return (
      <Skeleton
        variant="shimmer"
        className={cn(skeletonSizes[size], sizeStyles[size], className)}
      />
    );
  }

  return (
    <span
      className={cn(
        "text-muted inline-flex items-center rounded bg-white/5 tabular-nums",
        sizeStyles[size],
        className
      )}
    >
      {formatCostWithDollar(cost)}
    </span>
  );
};

/** Progress modal for bulk operations */
const BulkProgressModal: React.FC<{
  operation: BulkOperationState;
  onClose: () => void;
}> = ({ operation, onClose }) => {
  const percentage = Math.round((operation.completed / operation.total) * 100);
  const isComplete = operation.completed === operation.total;
  const actionVerb = operation.type === "restore" ? "Restoring" : "Deleting";
  const actionPast = operation.type === "restore" ? "restored" : "deleted";

  return (
    <Dialog open onOpenChange={(open) => !open && isComplete && onClose()}>
      <DialogContent maxWidth="400px" showCloseButton={isComplete}>
        <DialogHeader>
          <DialogTitle>{isComplete ? "Complete" : `${actionVerb} Minions`}</DialogTitle>
          <DialogDescription>
            {isComplete ? (
              <>
                Successfully {actionPast} {operation.completed} minion
                {operation.completed !== 1 && "s"}
                {operation.errors.length > 0 && ` (${operation.errors.length} failed)`}
              </>
            ) : (
              <>
                {operation.completed} of {operation.total} complete
                {operation.current && <> — {operation.current}</>}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Progress bar */}
        <div className="bg-separator h-2 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full transition-all duration-300",
              operation.type === "restore" ? "bg-green-500" : "bg-red-500"
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Errors */}
        {operation.errors.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded bg-red-500/10 p-2 text-xs text-red-400">
            {operation.errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {isComplete && (
          <DialogFooter className="justify-center">
            <Button variant="secondary" onClick={onClose} className="w-full">
              Done
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

/**
 * Crew showing archived minions for a project.
 * Appears on the project page when there are archived minions.
 */
export const BenchedMinions: React.FC<BenchedMinionsProps> = ({
  projectPath: _projectPath,
  projectName: _projectName,
  minions,
  onMinionsChanged,
}) => {
  const [isExpanded, setIsExpanded] = usePersistedState(
    `archivedMinionsExpanded:${_projectPath}`,
    false
  );
  const archivedRegionId = React.useId();

  const { unarchiveMinion, removeMinion, setSelectedMinion } = useMinionContext();
  const { api } = useAPI();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [processingIds, setProcessingIds] = React.useState<Set<string>>(new Set());
  const [forceDeleteModal, setForceDeleteModal] = React.useState<{
    minionId: string;
    error: string;
  } | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = React.useState<string | null>(null);
  const [bulkOperation, setBulkOperation] = React.useState<BulkOperationState | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = React.useState(false);

  const handleToggleExpanded = () => {
    setIsExpanded((prev) => {
      const next = !prev;

      // Clear selection when collapsing so hidden items can't be bulk-acted later.
      if (!next) {
        setSelectedIds(new Set());
        setLastClickedId(null);
        setBulkDeleteConfirm(false);
      }

      return next;
    });
  };

  // Cost data with optimistic caching - shows cached costs immediately, fetches fresh in background
  const minionIds = React.useMemo(() => minions.map((w) => w.id), [minions]);

  // Memoize fetchBatch so the hook doesn't refetch on every local state change.
  const fetchMinionCosts = React.useCallback(
    async (ids: string[]) => {
      if (!api) return {};

      const usageData = await api.minion.getSessionUsageBatch({ minionIds: ids });

      // Compute costs from usage data and return as record
      const costs: Record<string, number | undefined> = {};
      for (const id of ids) {
        costs[id] = getSessionTotalCost(usageData[id]);
      }
      return costs;
    },
    [api]
  );

  const { values: costsByMinion, status: costsStatus } = useOptimisticBatchLRU({
    keys: minionIds,
    cache: sessionCostCache,
    skip: !api,
    fetchBatch: fetchMinionCosts,
  });
  const costsLoading = costsStatus === "idle" || costsStatus === "loading";

  // Filter minions by search query (frontend-only)
  const filteredMinions = searchQuery.trim()
    ? minions.filter((ws) => {
        const query = searchQuery.toLowerCase();
        const title = (ws.title ?? ws.name).toLowerCase();
        const name = ws.name.toLowerCase();
        return title.includes(query) || name.includes(query);
      })
    : minions;

  // Group filtered minions by time period
  const groupedMinions = groupByTimePeriod(filteredMinions);
  const flatMinions = flattenGrouped(groupedMinions);

  // Calculate total cost and per-period costs from cached/fetched values
  const totalCost = React.useMemo(() => {
    let sum = 0;
    let hasCost = false;
    for (const ws of minions) {
      const cost = costsByMinion[ws.id];
      if (cost !== undefined) {
        sum += cost;
        hasCost = true;
      }
    }
    return hasCost ? sum : undefined;
  }, [minions, costsByMinion]);

  const periodCosts = React.useMemo(() => {
    const costs = new Map<string, number | undefined>();
    for (const [period, periodMinions] of groupedMinions) {
      let sum = 0;
      let hasCost = false;
      for (const ws of periodMinions) {
        const cost = costsByMinion[ws.id];
        if (cost !== undefined) {
          sum += cost;
          hasCost = true;
        }
      }
      costs.set(period, hasCost ? sum : undefined);
    }
    return costs;
  }, [groupedMinions, costsByMinion]);

  // minions prop should already be filtered to archived only
  if (minions.length === 0) {
    return null;
  }

  // Handle checkbox click with shift-click range selection
  const handleCheckboxClick = (minionId: string, event: React.MouseEvent) => {
    const isShiftClick = event.shiftKey;

    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (isShiftClick && lastClickedId) {
        // Range selection
        const lastIndex = flatMinions.findIndex((w) => w.id === lastClickedId);
        const currentIndex = flatMinions.findIndex((w) => w.id === minionId);

        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);

          for (let i = start; i <= end; i++) {
            next.add(flatMinions[i].id);
          }
        }
      } else {
        // Toggle single selection
        if (next.has(minionId)) {
          next.delete(minionId);
        } else {
          next.add(minionId);
        }
      }

      return next;
    });

    setLastClickedId(minionId);
    setBulkDeleteConfirm(false); // Clear confirmation when selection changes
  };

  // Select/deselect all filtered minions
  const handleSelectAll = () => {
    const allFilteredIds = new Set(filteredMinions.map((w) => w.id));
    const allSelected = filteredMinions.every((w) => selectedIds.has(w.id));

    if (allSelected) {
      // Deselect all filtered
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of allFilteredIds) {
          next.delete(id);
        }
        return next;
      });
    } else {
      // Select all filtered
      setSelectedIds((prev) => new Set([...prev, ...allFilteredIds]));
    }
    setBulkDeleteConfirm(false); // Clear confirmation when selection changes
  };

  // Bulk restore
  const handleBulkRestore = async () => {
    const idsToRestore = Array.from(selectedIds);
    setBulkOperation({
      type: "restore",
      total: idsToRestore.length,
      completed: 0,
      current: null,
      errors: [],
    });

    for (let i = 0; i < idsToRestore.length; i++) {
      const id = idsToRestore[i];
      const ws = minions.find((w) => w.id === id);
      setBulkOperation((prev) => (prev ? { ...prev, current: ws?.title ?? ws?.name ?? id } : prev));

      try {
        const result = await unarchiveMinion(id);
        if (!result.success) {
          setBulkOperation((prev) =>
            prev
              ? {
                  ...prev,
                  errors: [
                    ...prev.errors,
                    `Failed to restore ${ws?.name ?? id}${result.error ? `: ${result.error}` : ""}`,
                  ],
                }
              : prev
          );
        }
      } catch {
        setBulkOperation((prev) =>
          prev ? { ...prev, errors: [...prev.errors, `Failed to restore ${ws?.name ?? id}`] } : prev
        );
      }

      setBulkOperation((prev) => (prev ? { ...prev, completed: i + 1 } : prev));
    }

    setSelectedIds(new Set());
    onMinionsChanged?.();
  };

  // Bulk delete (always force: true) - requires confirmation
  const handleBulkDelete = async () => {
    setBulkDeleteConfirm(false);
    const idsToDelete = Array.from(selectedIds);
    setBulkOperation({
      type: "delete",
      total: idsToDelete.length,
      completed: 0,
      current: null,
      errors: [],
    });

    for (let i = 0; i < idsToDelete.length; i++) {
      const id = idsToDelete[i];
      const ws = minions.find((w) => w.id === id);
      setBulkOperation((prev) => (prev ? { ...prev, current: ws?.title ?? ws?.name ?? id } : prev));

      try {
        const result = await removeMinion(id, { force: true });
        if (!result.success) {
          setBulkOperation((prev) =>
            prev
              ? {
                  ...prev,
                  errors: [
                    ...prev.errors,
                    `Failed to delete ${ws?.name ?? id}${result.error ? `: ${result.error}` : ""}`,
                  ],
                }
              : prev
          );
        }
      } catch {
        setBulkOperation((prev) =>
          prev ? { ...prev, errors: [...prev.errors, `Failed to delete ${ws?.name ?? id}`] } : prev
        );
      }

      setBulkOperation((prev) => (prev ? { ...prev, completed: i + 1 } : prev));
    }

    setSelectedIds(new Set());
    onMinionsChanged?.();
  };

  const handleUnarchive = async (minionId: string) => {
    setProcessingIds((prev) => new Set(prev).add(minionId));
    try {
      const result = await unarchiveMinion(minionId);
      if (result.success) {
        // Select the minion after unarchiving
        const minion = minions.find((w) => w.id === minionId);
        if (minion) {
          setSelectedMinion({
            minionId: minion.id,
            projectPath: minion.projectPath,
            projectName: minion.projectName,
            namedMinionPath: minion.namedMinionPath,
          });
        }
        onMinionsChanged?.();
      }
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(minionId);
        return next;
      });
    }
  };

  const handleDelete = async (minionId: string) => {
    setProcessingIds((prev) => new Set(prev).add(minionId));
    try {
      const result = await removeMinion(minionId);
      if (result.success) {
        onMinionsChanged?.();
      } else {
        setForceDeleteModal({
          minionId,
          error: result.error ?? "Failed to remove minion",
        });
      }
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(minionId);
        return next;
      });
    }
  };

  const hasSelection = selectedIds.size > 0;
  const allFilteredSelected =
    filteredMinions.length > 0 && filteredMinions.every((w) => selectedIds.has(w.id));

  return (
    <>
      {/* Bulk operation progress modal */}

      <ForceDeleteModal
        isOpen={forceDeleteModal !== null}
        minionId={forceDeleteModal?.minionId ?? ""}
        error={forceDeleteModal?.error ?? ""}
        onClose={() => setForceDeleteModal(null)}
        onForceDelete={async (minionId) => {
          const result = await removeMinion(minionId, { force: true });
          if (!result.success) {
            throw new Error(result.error ?? "Force delete failed");
          }
          onMinionsChanged?.();
        }}
      />
      {bulkOperation && (
        <BulkProgressModal operation={bulkOperation} onClose={() => setBulkOperation(null)} />
      )}

      <div className="border-border rounded-lg border">
        {/* Header with bulk actions */}
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={handleToggleExpanded}
            className="text-muted hover:text-foreground rounded p-1 transition-colors hover:bg-white/10"
            aria-label={isExpanded ? "Collapse benched minions" : "Expand benched minions"}
            aria-expanded={isExpanded}
            aria-controls={archivedRegionId}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
          <ArchiveIcon className="text-muted h-4 w-4" />
          <span className="text-foreground font-medium">
            Benched Minions ({minions.length})
          </span>
          <CostBadge cost={totalCost} loading={costsLoading} size="lg" />
          <span className="flex-1" />
          {isExpanded && hasSelection && (
            <div className="flex items-center gap-2">
              <span className="text-muted text-xs">{selectedIds.size} selected</span>
              {bulkDeleteConfirm ? (
                <>
                  <span className="text-muted text-xs">
                    Delete permanently (also deletes local branches)?
                  </span>
                  <button
                    onClick={() => void handleBulkDelete()}
                    className="rounded bg-red-600 px-2 py-0.5 text-xs text-white hover:bg-red-700"
                  >
                    Yes, delete {selectedIds.size}
                  </button>
                  <button
                    onClick={() => setBulkDeleteConfirm(false)}
                    className="text-muted hover:text-foreground text-xs"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => void handleBulkRestore()}
                        className="text-muted hover:text-foreground rounded p-1 transition-colors hover:bg-white/10"
                        aria-label="Restore selected"
                      >
                        <ArchiveRestoreIcon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Restore selected</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setBulkDeleteConfirm(true)}
                        className="text-muted rounded p-1 transition-colors hover:bg-white/10 hover:text-red-400"
                        aria-label="Delete selected"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Delete selected permanently (local branches too)
                    </TooltipContent>
                  </Tooltip>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-muted hover:text-foreground ml-1 text-xs"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {isExpanded && (
          <div
            id={archivedRegionId}
            role="region"
            aria-label="Benched minions"
            className="border-border border-t"
          >
            {/* Search input with select all */}
            {minions.length > 1 && (
              <div className="border-border flex items-center gap-2 border-b px-4 py-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleSelectAll}
                  className="h-4 w-4 rounded border-gray-600 bg-transparent"
                  aria-label="Select all"
                />
                {minions.length > 3 && (
                  <div className="relative flex-1">
                    <Search className="text-muted pointer-events-none absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search benched minions or branches..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="bg-bg-dark placeholder:text-muted text-foreground focus:border-border-light w-full rounded border border-transparent py-1.5 pr-3 pl-8 text-sm focus:outline-none"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Timeline grouped list */}
            <div>
              {filteredMinions.length === 0 ? (
                <div className="text-muted px-4 py-6 text-center text-sm">
                  No minions match {`"${searchQuery}"`}
                </div>
              ) : (
                Array.from(groupedMinions.entries()).map(([period, periodMinions]) => (
                  <div key={period}>
                    {/* Period header */}
                    <div className="bg-bg-dark text-muted flex items-center gap-2 px-4 py-1.5 text-xs font-medium">
                      <span>{period}</span>
                      <CostBadge cost={periodCosts.get(period)} loading={costsLoading} />
                    </div>
                    {/* Minions in this period */}
                    {periodMinions.map((minion) => {
                      const isProcessing = processingIds.has(minion.id) || minion.isRemoving;
                      const isSelected = selectedIds.has(minion.id);
                      const minionNameForTooltip =
                        minion.title && minion.title !== minion.name
                          ? minion.name
                          : undefined;
                      const displayTitle = minion.title ?? minion.name;

                      return (
                        <div
                          key={minion.id}
                          className={cn(
                            "border-border flex items-center gap-3 border-b px-4 py-2.5 last:border-b-0",
                            isProcessing && "opacity-50",
                            isSelected && "bg-white/5"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onClick={(e) => handleCheckboxClick(minion.id, e)}
                            onChange={() => undefined} // Controlled by onClick for shift-click support
                            className="h-4 w-4 rounded border-gray-600 bg-transparent"
                            aria-label={`Select ${displayTitle}`}
                          />
                          <RuntimeBadge
                            runtimeConfig={minion.runtimeConfig}
                            isWorking={false}
                            minionPath={minion.namedMinionPath}
                            minionName={minionNameForTooltip}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground truncate text-sm font-medium">
                              {displayTitle}
                            </div>
                            <div className="flex items-center gap-2">
                              {minion.archivedAt && (
                                <span className="text-muted text-xs">
                                  {new Date(minion.archivedAt).toLocaleString(undefined, {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                              <CostBadge
                                cost={costsByMinion[minion.id]}
                                loading={costsLoading}
                                size="sm"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => void handleUnarchive(minion.id)}
                                  disabled={isProcessing}
                                  className="text-muted hover:text-foreground rounded p-1.5 transition-colors hover:bg-white/10 disabled:opacity-50"
                                  aria-label={`Restore minion ${displayTitle}`}
                                >
                                  <ArchiveRestoreIcon className="h-4 w-4" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Restore to sidebar</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => void handleDelete(minion.id)}
                                  disabled={isProcessing}
                                  className="text-muted rounded p-1.5 transition-colors hover:bg-white/10 hover:text-red-400 disabled:opacity-50"
                                  aria-label={`Delete minion ${displayTitle}`}
                                >
                                  {isProcessing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Delete permanently (local branch too)</TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};
