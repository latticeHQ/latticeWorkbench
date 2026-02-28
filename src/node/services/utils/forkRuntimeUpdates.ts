import type { Config } from "@/node/config";
import type { RuntimeConfig } from "@/common/types/runtime";
import type { MinionForkResult } from "@/node/runtime/Runtime";

export function resolveForkRuntimeConfigs(
  sourceRuntimeConfig: RuntimeConfig,
  forkResult: MinionForkResult
): {
  forkedRuntimeConfig: RuntimeConfig;
  sourceRuntimeConfigUpdate?: RuntimeConfig;
} {
  return {
    forkedRuntimeConfig: forkResult.forkedRuntimeConfig ?? sourceRuntimeConfig,
    sourceRuntimeConfigUpdate: forkResult.sourceRuntimeConfig,
  };
}

/**
 * Apply runtime config updates returned by runtime.forkMinion().
 *
 * Runtimes may return updated runtimeConfig for:
 * - the new minion (forkedRuntimeConfig)
 * - the source minion (sourceRuntimeConfig)
 *
 * This helper centralizes the logic so MinionService and TaskService stay consistent.
 */
interface ApplyForkRuntimeUpdatesOptions {
  persistSourceRuntimeConfigUpdate?: boolean;
}

export async function applyForkRuntimeUpdates(
  config: Config,
  sourceMinionId: string,
  sourceRuntimeConfig: RuntimeConfig,
  forkResult: MinionForkResult,
  options: ApplyForkRuntimeUpdatesOptions = {}
): Promise<{ forkedRuntimeConfig: RuntimeConfig; sourceRuntimeConfigUpdate?: RuntimeConfig }> {
  const resolved = resolveForkRuntimeConfigs(sourceRuntimeConfig, forkResult);
  const persistSourceRuntimeConfigUpdate = options.persistSourceRuntimeConfigUpdate ?? true;

  if (persistSourceRuntimeConfigUpdate && resolved.sourceRuntimeConfigUpdate) {
    await config.updateMinionMetadata(sourceMinionId, {
      runtimeConfig: resolved.sourceRuntimeConfigUpdate,
    });
  }

  return resolved;
}
