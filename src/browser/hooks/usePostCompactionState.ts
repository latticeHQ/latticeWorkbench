import { useEffect, useState, useCallback, useRef } from "react";
import { useAPI } from "@/browser/contexts/API";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { getPostCompactionStateKey } from "@/common/constants/storage";

interface PostCompactionState {
  planPath: string | null;
  trackedFilePaths: string[];
  excludedItems: Set<string>;
  toggleExclusion: (itemId: string) => Promise<void>;
}

interface CachedPostCompactionData {
  planPath: string | null;
  trackedFilePaths: string[];
  excludedItems: string[];
}

/** Load state from localStorage cache for a minion */
function loadFromCache(wsId: string) {
  const cached = readPersistedState<CachedPostCompactionData | null>(
    getPostCompactionStateKey(wsId),
    null
  );
  return {
    planPath: cached?.planPath ?? null,
    trackedFilePaths: cached?.trackedFilePaths ?? [],
    excludedItems: new Set(cached?.excludedItems ?? []),
  };
}

/**
 * Hook to get post-compaction context state for a minion.
 * Fetches lazily from the backend API and caches in localStorage.
 * This avoids the expensive runtime.stat calls during minion.list().
 *
 * Always enabled: post-compaction context is a stable feature (not an experiment).
 */
export function usePostCompactionState(minionId: string): PostCompactionState {
  const { api } = useAPI();
  const [state, setState] = useState(() => loadFromCache(minionId));

  // Track which minionId the current state belongs to.
  // Reset synchronously during render when minionId changes (React-recommended pattern).
  const prevMinionIdRef = useRef(minionId);
  if (prevMinionIdRef.current !== minionId) {
    prevMinionIdRef.current = minionId;
    setState(loadFromCache(minionId));
  }

  // Fetch fresh data when minionId changes
  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    const fetchState = async () => {
      try {
        const result = await api.minion.getPostCompactionState({ minionId });
        if (cancelled) return;

        // Update state
        setState({
          planPath: result.planPath,
          trackedFilePaths: result.trackedFilePaths,
          excludedItems: new Set(result.excludedItems),
        });

        // Cache for next time
        updatePersistedState<CachedPostCompactionData>(getPostCompactionStateKey(minionId), {
          planPath: result.planPath,
          trackedFilePaths: result.trackedFilePaths,
          excludedItems: result.excludedItems,
        });
      } catch (error) {
        // Silently fail - use cached or empty state
        console.warn("[usePostCompactionState] Failed to fetch:", error);
      }
    };

    void fetchState();
    return () => {
      cancelled = true;
    };
  }, [api, minionId]);

  const toggleExclusion = useCallback(
    async (itemId: string) => {
      if (!api) return;
      const isCurrentlyExcluded = state.excludedItems.has(itemId);
      const result = await api.minion.setPostCompactionExclusion({
        minionId,
        itemId,
        excluded: !isCurrentlyExcluded,
      });
      if (result.success) {
        // Optimistic update for immediate UI feedback
        setState((prev) => {
          const newSet = new Set(prev.excludedItems);
          if (isCurrentlyExcluded) {
            newSet.delete(itemId);
          } else {
            newSet.add(itemId);
          }
          const newState = { ...prev, excludedItems: newSet };

          // Update cache
          updatePersistedState<CachedPostCompactionData>(getPostCompactionStateKey(minionId), {
            planPath: newState.planPath,
            trackedFilePaths: newState.trackedFilePaths,
            excludedItems: Array.from(newSet),
          });

          return newState;
        });
      }
    },
    [api, minionId, state.excludedItems]
  );

  return { ...state, toggleExclusion };
}
