import React, { useState, useEffect, useRef, useCallback } from "react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { useAPI } from "@/browser/contexts/API";
import { isMinionArchived } from "@/common/utils/archive";
import { BenchedMinions } from "../BenchedMinions";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { getBenchedMinionsKey } from "@/common/constants/storage";

interface ProjectArchivedTabProps {
  projectPath: string;
  projectName: string;
}

/** Compare archived minion lists by ID set (order doesn't matter for equality) */
function archivedListsEqual(
  prev: FrontendMinionMetadata[],
  next: FrontendMinionMetadata[]
): boolean {
  if (prev.length !== next.length) return false;
  const prevIds = new Set(prev.map((w) => w.id));
  return next.every((w) => prevIds.has(w.id));
}

/**
 * Archived tab — shows archived minions for this project.
 * Extracted from ProjectOverviewTab so it lives on its own tab.
 */
export const ProjectArchivedTab: React.FC<ProjectArchivedTabProps> = (props) => {
  const { api } = useAPI();
  const [archivedMinions, setBenchedMinions] = useState<FrontendMinionMetadata[]>(() =>
    readPersistedState<FrontendMinionMetadata[]>(getBenchedMinionsKey(props.projectPath), [])
  );

  const archivedMapRef = useRef<Map<string, FrontendMinionMetadata>>(new Map());

  const syncArchivedState = useCallback(() => {
    const next = Array.from(archivedMapRef.current.values());
    setBenchedMinions((prev) => {
      if (archivedListsEqual(prev, next)) return prev;
      updatePersistedState(getBenchedMinionsKey(props.projectPath), next);
      return next;
    });
  }, [props.projectPath]);

  // Load archived minions on mount
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    const loadArchived = async () => {
      try {
        const allArchived = await api.minion.list({ archived: true });
        if (cancelled) return;
        const projectArchived = allArchived.filter((w) => w.projectPath === props.projectPath);
        archivedMapRef.current = new Map(projectArchived.map((w) => [w.id, w]));
        syncArchivedState();
      } catch (error) {
        console.error("Failed to load archived minions:", error);
      }
    };

    void loadArchived();
    return () => {
      cancelled = true;
    };
  }, [api, props.projectPath, syncArchivedState]);

  // Subscribe to metadata changes for real-time archive/unarchive updates
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();

    (async () => {
      try {
        const iterator = await api.minion.onMetadata(undefined, { signal: controller.signal });
        for await (const event of iterator) {
          if (controller.signal.aborted) break;

          const meta = event.metadata;
          if (meta && meta.projectPath !== props.projectPath) continue;
          if (!meta && !archivedMapRef.current.has(event.minionId)) continue;

          const isArchived = meta && isMinionArchived(meta.archivedAt, meta.unarchivedAt);

          if (isArchived) {
            archivedMapRef.current.set(meta.id, meta);
          } else {
            archivedMapRef.current.delete(event.minionId);
          }

          syncArchivedState();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to subscribe to metadata for archived minions:", err);
        }
      }
    })();

    return () => controller.abort();
  }, [api, props.projectPath, syncArchivedState]);

  if (archivedMinions.length === 0) {
    // Compact empty card — matches MCP card shape for visual pairing
    return (
      <div className="text-muted flex flex-1 items-center justify-center">
        <p className="text-sm">No benched minions.</p>
      </div>
    );
  }

  // BenchedMinions already renders as a bordered card
  return (
    <BenchedMinions
      projectPath={props.projectPath}
      projectName={props.projectName}
      minions={archivedMinions}
      onMinionsChanged={() => {
        if (!api) return;
        void api.minion.list({ archived: true }).then((all) => {
          setBenchedMinions(all.filter((w) => w.projectPath === props.projectPath));
        });
      }}
    />
  );
};
