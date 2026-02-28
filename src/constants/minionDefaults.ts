/**
 * Storage key helpers for persisted settings.
 */
export const STORAGE_KEYS = {
  /** Per-project default diff base for code review. Pass projectPath. */
  reviewDefaultBase: (projectPath: string) => `review-default-base:${projectPath}`,
  /** Per-minion diff base override. Pass minionId. */
  reviewDiffBase: (minionId: string) => `review-diff-base:${minionId}`,
} as const;

Object.freeze(STORAGE_KEYS);

/**
 * Global default values for all minion settings.
 *
 * These defaults are IMMUTABLE and serve as the fallback when:
 * - A new minion is created
 * - A minion has no stored override in localStorage
 * - Settings are reset to defaults
 *
 * Per-minion overrides persist in localStorage using keys like:
 * - `agentId:{minionId}`
 * - `model:{minionId}`
 * - `thinkingLevel:{minionId}`
 * - `input:{minionId}`
 *
 * The global defaults themselves CANNOT be changed by users.
 * Only per-minion overrides are mutable.
 *
 * IMPORTANT: All values are marked `as const` to ensure immutability at the type level.
 * Do not modify these values at runtime - they serve as the single source of truth.
 */

import { THINKING_LEVEL_OFF } from "@/common/types/thinking";
import { DEFAULT_MODEL } from "@/common/constants/knownModels";

/**
 * Hard-coded default values for minion settings.
 * Type assertions ensure proper typing while maintaining immutability.
 */
export const MINION_DEFAULTS = {
  /** Default agent id for new minions (built-in auto router agent). */
  agentId: "auto" as const,

  /** Default thinking/reasoning level for new minions */
  thinkingLevel: THINKING_LEVEL_OFF,

  /**
   * Default AI model for new minions.
   * Uses the centralized default from knownModels.ts.
   */
  model: DEFAULT_MODEL as string,

  /** Default input text for new minions (empty) */
  input: "" as string,

  /** Default diff base for code review (compare against origin/main) */
  reviewBase: "origin/main" as string,
};

// Freeze the object at runtime to prevent accidental mutation
Object.freeze(MINION_DEFAULTS);

/**
 * Type-safe keys for minion settings
 */
export type MinionSettingKey = keyof typeof MINION_DEFAULTS;

/**
 * Type-safe values for minion settings
 */
export type MinionSettingValue<K extends MinionSettingKey> = (typeof MINION_DEFAULTS)[K];
