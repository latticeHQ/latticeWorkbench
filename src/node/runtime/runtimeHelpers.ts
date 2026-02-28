import type { RuntimeConfig } from "@/common/types/runtime";
import type { Runtime } from "./Runtime";
import { createRuntime } from "./runtimeFactory";

/**
 * Minimal minion metadata needed to create a runtime with proper minion path.
 * Matches the subset of FrontendMinionMetadata / MinionMetadata used at call sites.
 */
export interface MinionMetadataForRuntime {
  runtimeConfig: RuntimeConfig;
  projectPath: string;
  name: string;
}

/**
 * Create a runtime from minion metadata, ensuring minionName is always passed.
 *
 * Use this helper when creating a runtime from minion metadata to ensure
 * DevcontainerRuntime.currentMinionPath is set, enabling host-path reads
 * (stat, readFile, etc.) before the container is ready.
 */
export function createRuntimeForMinion(metadata: MinionMetadataForRuntime): Runtime {
  return createRuntime(metadata.runtimeConfig, {
    projectPath: metadata.projectPath,
    minionName: metadata.name,
  });
}
