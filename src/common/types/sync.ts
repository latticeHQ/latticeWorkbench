/**
 * Sync types for GitHub config backup.
 *
 * The sync feature mirrors ~/.lattice/ files to a private GitHub repo
 * so configs are recoverable after reinstalls or accidental deletion.
 */

/** Which categories of files to include in sync. Sensitive categories default OFF. */
export interface SyncCategories {
  /** config.json (projects, minion metadata, global settings) */
  config: boolean;
  /** mcp.jsonc (global MCP servers) */
  mcpConfig: boolean;
  /** sessions/ (chat.jsonl + session-timing.json per minion) */
  chatHistory: boolean;
  /** providers.jsonc — contains API keys, off by default */
  providers: boolean;
  /** secrets.json — contains env var secrets, off by default */
  secrets: boolean;
}

/** Persisted sync configuration — stored in config.json under `sync`. */
export interface SyncConfig {
  /** Remote repository URL (SSH or HTTPS) */
  repoUrl: string;
  /** Whether auto-sync-on-change is enabled */
  autoSync: boolean;
  /** Debounce interval in ms for auto-sync (default: 30_000) */
  autoSyncDebounceMs?: number | null;
  /** File categories to include */
  categories: SyncCategories;
}

export type SyncStatusState = "idle" | "syncing" | "error" | "success";

/** Volatile runtime status — kept in memory only. */
export interface SyncStatus {
  state: SyncStatusState;
  lastSyncAt?: number | null;
  lastSyncCommit?: string | null;
  lastError?: string | null;
  /** Current operation in progress */
  operation?: "push" | "pull" | null;
  /** Count of files synced in last operation */
  fileCount?: number | null;
}

/** Default category selection — sensitive items off by default. */
export const DEFAULT_SYNC_CATEGORIES: SyncCategories = {
  config: true,
  mcpConfig: true,
  chatHistory: true,
  providers: false,
  secrets: false,
};

/** Default auto-sync debounce interval (30 seconds). */
export const AUTO_SYNC_DEBOUNCE_MS = 30_000;
