import type { RuntimeConfig } from "@/common/types/runtime";

/**
 * Default runtime configuration for worktree minions.
 * Uses git worktrees for minion isolation.
 * Used when no runtime config is specified.
 */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  type: "worktree",
  srcBaseDir: "~/.lattice/src",
} as const;
