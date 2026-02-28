import { Err, Ok, type Result } from "@/common/types/result";
import type { RuntimeConfig } from "@/common/types/runtime";
import type { Config } from "@/node/config";
import { detectDefaultTrunkBranch, listLocalBranches } from "@/node/git";
import type { InitLogger, Runtime } from "@/node/runtime/Runtime";
import { getContainerName } from "@/node/runtime/DockerRuntime";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import { applyForkRuntimeUpdates } from "@/node/services/utils/forkRuntimeUpdates";

interface OrchestrateForkParams {
  /** Runtime for the source minion (used to call forkMinion + optional create fallback) */
  sourceRuntime: Runtime;
  projectPath: string;
  sourceMinionName: string;
  newMinionName: string;
  initLogger: InitLogger;

  /** For applying runtime config updates */
  config: Config;
  sourceMinionId: string;
  sourceRuntimeConfig: RuntimeConfig;

  /**
   * If true, fall back to createMinion when fork fails (task mode).
   * If false, return error on fork failure (interactive mode).
   */
  allowCreateFallback: boolean;

  /**
   * Caller-supplied trunk fallback, preferred over local git discovery.
   * Useful when local git metadata is unavailable (e.g. SSH/Docker queues).
   */
  preferredTrunkBranch?: string;

  abortSignal?: AbortSignal;
}

interface OrchestrateForkSuccess {
  /** Path to the new minion on disk */
  minionPath: string;
  /** Trunk branch for init */
  trunkBranch: string;
  /** Resolved runtime config for the forked minion */
  forkedRuntimeConfig: RuntimeConfig;
  /** Fresh runtime handle targeting the new minion */
  targetRuntime: Runtime;
  /** Whether the fork succeeded (false = fell back to createMinion) */
  forkedFromSource: boolean;
  /** Resolved runtime config update for the source minion (persisted by caller). */
  sourceRuntimeConfigUpdate?: RuntimeConfig;
  /** Whether source runtime config was updated (caller should emit metadata) */
  sourceRuntimeConfigUpdated: boolean;
}

export async function orchestrateFork(
  params: OrchestrateForkParams
): Promise<Result<OrchestrateForkSuccess>> {
  const {
    sourceRuntime,
    projectPath,
    sourceMinionName,
    newMinionName,
    initLogger,
    config,
    sourceMinionId,
    sourceRuntimeConfig,
    allowCreateFallback,
    abortSignal,
  } = params;

  const forkResult = await sourceRuntime.forkMinion({
    projectPath,
    sourceMinionName,
    newMinionName,
    initLogger,
    abortSignal,
  });

  const { forkedRuntimeConfig, sourceRuntimeConfigUpdate } = await applyForkRuntimeUpdates(
    config,
    sourceMinionId,
    sourceRuntimeConfig,
    forkResult,
    { persistSourceRuntimeConfigUpdate: false }
  );
  const sourceRuntimeConfigUpdated = sourceRuntimeConfigUpdate != null;

  // Forked minion metadata must use destination identity, not inherited source state.
  // Docker containerName is derived from (projectPath, minionName); if the fork
  // inherits source config, the containerName would point at the wrong container.
  const normalizedForkedRuntimeConfig: RuntimeConfig =
    forkedRuntimeConfig.type === "docker"
      ? {
          ...forkedRuntimeConfig,
          containerName: getContainerName(projectPath, newMinionName),
        }
      : forkedRuntimeConfig;

  if (!forkResult.success) {
    if (forkResult.failureIsFatal) {
      return Err(forkResult.error ?? "Fork failed (fatal)");
    }

    if (!allowCreateFallback) {
      return Err(forkResult.error ?? "Failed to clone minion");
    }
  }

  let trunkBranch: string;
  if (forkResult.success && forkResult.sourceBranch) {
    trunkBranch = forkResult.sourceBranch;
  } else if (params.preferredTrunkBranch?.trim()) {
    // Caller-supplied fallback (e.g., queued task's persisted trunk branch).
    // Preferred over local git discovery, which may be unavailable in SSH/Docker.
    trunkBranch = params.preferredTrunkBranch.trim();
  } else {
    try {
      const localBranches = await listLocalBranches(projectPath);
      if (localBranches.includes(sourceMinionName)) {
        trunkBranch = sourceMinionName;
      } else {
        trunkBranch = await detectDefaultTrunkBranch(projectPath, localBranches);
      }
    } catch {
      trunkBranch = "main";
    }
  }

  let minionPath: string;
  let forkedFromSource: boolean;
  if (forkResult.success) {
    if (!forkResult.minionPath) {
      return Err("Fork succeeded but returned no minion path");
    }
    minionPath = forkResult.minionPath;
    forkedFromSource = true;
  } else {
    const createResult = await sourceRuntime.createMinion({
      projectPath,
      branchName: newMinionName,
      trunkBranch,
      directoryName: newMinionName,
      initLogger,
      abortSignal,
    });

    if (!createResult.success || !createResult.minionPath) {
      return Err(createResult.error ?? "Failed to summon minion");
    }

    minionPath = createResult.minionPath;
    forkedFromSource = false;
  }

  const targetRuntime = createRuntime(normalizedForkedRuntimeConfig, {
    projectPath,
    minionName: newMinionName,
  });

  return Ok({
    minionPath,
    trunkBranch,
    forkedRuntimeConfig: normalizedForkedRuntimeConfig,
    targetRuntime,
    forkedFromSource,
    ...(sourceRuntimeConfigUpdate ? { sourceRuntimeConfigUpdate } : {}),
    sourceRuntimeConfigUpdated,
  });
}
