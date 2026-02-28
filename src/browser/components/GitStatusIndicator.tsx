import React, { useState, useCallback } from "react";
import type { GitStatus } from "@/common/types/minion";
import { GIT_STATUS_INDICATOR_MODE_KEY } from "@/common/constants/storage";
import { STORAGE_KEYS, MINION_DEFAULTS } from "@/constants/minionDefaults";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { invalidateGitStatus, useGitStatusRefreshing } from "@/browser/stores/GitStatusStore";
import { GitStatusIndicatorView, type GitStatusIndicatorMode } from "./GitStatusIndicatorView";
import { useGitBranchDetails } from "./hooks/useGitBranchDetails";

interface GitStatusIndicatorProps {
  gitStatus: GitStatus | null;
  minionId: string;
  projectPath: string;
  tooltipPosition?: "right" | "bottom";
  /** When true, shows blue pulsing styling to indicate agent is working */
  isWorking?: boolean;
}

/**
 * Container component for git status indicator.
 * Manages dialog visibility and data fetching.
 * Delegates rendering to GitStatusIndicatorView.
 */
export const GitStatusIndicator: React.FC<GitStatusIndicatorProps> = ({
  gitStatus,
  minionId,
  projectPath,
  tooltipPosition = "right",
  isWorking = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const trimmedMinionId = minionId.trim();
  const isRefreshing = useGitStatusRefreshing(trimmedMinionId);

  const [mode, setMode] = usePersistedState<GitStatusIndicatorMode>(
    GIT_STATUS_INDICATOR_MODE_KEY,
    "line-delta",
    { listener: true }
  );

  // Per-project default base (fallback for new minions)
  const [projectDefaultBase] = usePersistedState<string>(
    STORAGE_KEYS.reviewDefaultBase(projectPath),
    MINION_DEFAULTS.reviewBase,
    { listener: true }
  );

  // Per-minion base ref (shared with review panel, syncs via listener)
  const [baseRef, setBaseRef] = usePersistedState<string>(
    STORAGE_KEYS.reviewDiffBase(trimmedMinionId),
    projectDefaultBase,
    { listener: true }
  );

  const handleBaseChange = useCallback(
    (value: string) => {
      setBaseRef(value);
      invalidateGitStatus(trimmedMinionId);
    },
    [setBaseRef, trimmedMinionId]
  );

  const handleModeChange = useCallback(
    (nextMode: GitStatusIndicatorMode) => {
      setMode(nextMode);
    },
    [setMode]
  );

  console.assert(
    trimmedMinionId.length > 0,
    "GitStatusIndicator requires minionId to be a non-empty string."
  );

  // Fetch branch details only while the divergence dialog is open
  const { branchHeaders, commits, dirtyFiles, isLoading, errorMessage } = useGitBranchDetails(
    trimmedMinionId,
    gitStatus,
    isOpen
  );

  return (
    <GitStatusIndicatorView
      mode={mode}
      gitStatus={gitStatus}
      tooltipPosition={tooltipPosition}
      branchHeaders={branchHeaders}
      commits={commits}
      dirtyFiles={dirtyFiles}
      isLoading={isLoading}
      errorMessage={errorMessage}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      onModeChange={handleModeChange}
      baseRef={baseRef}
      onBaseChange={handleBaseChange}
      isWorking={isWorking}
      isRefreshing={isRefreshing}
    />
  );
};
