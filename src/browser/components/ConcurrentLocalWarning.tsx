import React, { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import { useMinionStoreRaw } from "@/browser/stores/MinionStore";
import { isLocalProjectRuntime } from "@/common/types/runtime";
import type { RuntimeConfig } from "@/common/types/runtime";
import { useSyncExternalStore } from "react";

/**
 * Subtle indicator shown when a local project-dir minion has another minion
 * for the same project that is currently streaming.
 */
export const ConcurrentLocalWarning: React.FC<{
  minionId: string;
  projectPath: string;
  runtimeConfig?: RuntimeConfig;
}> = (props) => {
  // Only show for local project-dir runtimes (not worktree or SSH)
  const isLocalProject = isLocalProjectRuntime(props.runtimeConfig);

  const { minionMetadata } = useMinionContext();
  const store = useMinionStoreRaw();

  // Find other local project-dir minions for the same project
  const otherLocalMinionIds = useMemo(() => {
    if (!isLocalProject) return [];

    const result: string[] = [];
    for (const [id, meta] of minionMetadata) {
      // Skip current minion
      if (id === props.minionId) continue;
      // Must be same project
      if (meta.projectPath !== props.projectPath) continue;
      // Must also be local project-dir runtime
      if (!isLocalProjectRuntime(meta.runtimeConfig)) continue;
      result.push(id);
    }
    return result;
  }, [isLocalProject, minionMetadata, props.minionId, props.projectPath]);

  // Subscribe to streaming state of other local minions
  const streamingMinionName = useSyncExternalStore(
    (listener) => {
      const unsubscribers = otherLocalMinionIds.map((id) => store.subscribeKey(id, listener));
      return () => unsubscribers.forEach((unsub) => unsub());
    },
    () => {
      for (const id of otherLocalMinionIds) {
        try {
          const state = store.getMinionSidebarState(id);
          if (state.canInterrupt) {
            const meta = minionMetadata.get(id);
            return meta?.name ?? id;
          }
        } catch {
          // Minion may not be registered yet, skip
        }
      }
      return null;
    }
  );

  if (!isLocalProject || !streamingMinionName) {
    return null;
  }

  return (
    <div className="text-center text-xs text-yellow-600/80">
      <AlertTriangle aria-hidden="true" className="mr-1 inline-block h-3 w-3 align-[-2px]" />
      <span className="text-yellow-500">{streamingMinionName}</span> is also running in this
      project directory — agents may interfere
    </div>
  );
};
