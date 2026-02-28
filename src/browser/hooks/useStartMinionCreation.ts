import { useCallback, useEffect } from "react";
import type { ProjectConfig } from "@/node/config";
import { CUSTOM_EVENTS, type CustomEventPayloads } from "@/common/constants/events";
import { updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  getInputKey,
  getModelKey,
  getPendingScopeId,
  getProjectScopeId,
  getTrunkBranchKey,
} from "@/common/constants/storage";

export type StartMinionCreationDetail =
  CustomEventPayloads[typeof CUSTOM_EVENTS.START_MINION_CREATION];

export function getFirstProjectPath(projects: Map<string, ProjectConfig>): string | null {
  const iterator = projects.keys().next();
  return iterator.done ? null : iterator.value;
}

type PersistFn = typeof updatePersistedState;

export function persistMinionCreationPrefill(
  projectPath: string,
  detail: StartMinionCreationDetail | undefined,
  persist: PersistFn = updatePersistedState
): void {
  if (!detail) {
    return;
  }

  if (detail.startMessage !== undefined) {
    persist(getInputKey(getPendingScopeId(projectPath)), detail.startMessage);
  }

  if (detail.model !== undefined) {
    persist(getModelKey(getProjectScopeId(projectPath)), detail.model);
  }

  if (detail.trunkBranch !== undefined) {
    const normalizedTrunk = detail.trunkBranch.trim();
    persist(
      getTrunkBranchKey(projectPath),
      normalizedTrunk.length > 0 ? normalizedTrunk : undefined
    );
  }

  // Note: runtime is intentionally NOT persisted here - it's a one-time override.
  // The default runtime can only be changed via the icon selector.
}

interface UseStartMinionCreationOptions {
  projects: Map<string, ProjectConfig>;
  beginMinionCreation: (projectPath: string) => void;
}

function resolveProjectPath(
  projects: Map<string, ProjectConfig>,
  requestedPath: string
): string | null {
  if (projects.has(requestedPath)) {
    return requestedPath;
  }

  return getFirstProjectPath(projects);
}

export function useStartMinionCreation({
  projects,
  beginMinionCreation,
}: UseStartMinionCreationOptions) {
  const startMinionCreation = useCallback(
    (projectPath: string, detail?: StartMinionCreationDetail) => {
      const resolvedProjectPath = resolveProjectPath(projects, projectPath);

      if (!resolvedProjectPath) {
        console.warn("No projects available for minion creation");
        return;
      }

      persistMinionCreationPrefill(resolvedProjectPath, detail);
      beginMinionCreation(resolvedProjectPath);
    },
    [projects, beginMinionCreation]
  );

  useEffect(() => {
    const handleStartCreation = (event: Event) => {
      const customEvent = event as CustomEvent<StartMinionCreationDetail | undefined>;
      const detail = customEvent.detail;

      if (!detail?.projectPath) {
        console.warn("START_MINION_CREATION event missing projectPath detail");
        return;
      }

      startMinionCreation(detail.projectPath, detail);
    };

    window.addEventListener(
      CUSTOM_EVENTS.START_MINION_CREATION,
      handleStartCreation as EventListener
    );

    return () =>
      window.removeEventListener(
        CUSTOM_EVENTS.START_MINION_CREATION,
        handleStartCreation as EventListener
      );
  }, [startMinionCreation]);

  return startMinionCreation;
}
