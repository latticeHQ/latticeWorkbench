/**
 * Slash command constants shared between suggestion filtering and command execution.
 */

/**
 * Command keys that only work in minion context (not during creation).
 * These correspond to top-level slash command keys in the registry.
 */
export const MINION_ONLY_COMMAND_KEYS: ReadonlySet<string> = new Set([
  "clear",
  "truncate",
  "compact",
  "fork",
  "new",
  "plan",
]);

/**
 * Parsed command types that require an existing minion context.
 */
export const MINION_ONLY_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "clear",
  "truncate",
  "compact",
  "fork",
  "new",
  "plan-show",
  "plan-open",
]);
