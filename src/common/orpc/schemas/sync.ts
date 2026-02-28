import { z } from "zod";

// --- Sync categories ---

export const SyncCategoriesSchema = z.object({
  config: z.boolean(),
  mcpConfig: z.boolean(),
  chatHistory: z.boolean(),
  providers: z.boolean(),
  secrets: z.boolean(),
});

// --- Sync config ---

export const SyncConfigSchema = z.object({
  repoUrl: z.string(),
  autoSync: z.boolean(),
  autoSyncDebounceMs: z.number().nullish(),
  categories: SyncCategoriesSchema,
});

// --- Sync status ---

export const SyncStatusSchema = z.object({
  state: z.enum(["idle", "syncing", "error", "success"]),
  lastSyncAt: z.number().nullish(),
  lastSyncCommit: z.string().nullish(),
  lastError: z.string().nullish(),
  operation: z.enum(["push", "pull"]).nullish(),
  fileCount: z.number().nullish(),
});

// --- CRUD inputs ---

export const SyncSaveConfigInputSchema = SyncConfigSchema;

export const SyncSuccessOutputSchema = z.object({
  success: z.boolean(),
});

// --- GitHub CLI integration ---

export const SyncGhAuthOutputSchema = z.object({
  authenticated: z.boolean(),
  username: z.string().nullish(),
});

export const SyncGhRepoSchema = z.object({
  name: z.string(),
  fullName: z.string(),
  url: z.string(),
  isPrivate: z.boolean(),
});

export const SyncCreateRepoInputSchema = z.object({
  name: z.string(),
});

export const SyncCreateRepoOutputSchema = z.object({
  url: z.string(),
  fullName: z.string(),
});
