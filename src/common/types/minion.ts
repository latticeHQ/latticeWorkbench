/**
 * Unified minion metadata type used throughout the application.
 * This is the single source of truth for minion information.
 *
 * ID vs Name:
 * - `id`: Stable unique identifier (10 hex chars for new minions, legacy format for old)
 *   Generated once at creation, never changes
 * - `name`: User-facing mutable name (e.g., "feature-branch")
 *   Can be changed via rename operation
 *
 * For legacy minions created before stable IDs:
 * - id and name are the same (e.g., "lattice-stable-ids")
 * For new minions:
 * - id is a random 10 hex char string (e.g., "a1b2c3d4e5")
 * - name is the branch/minion name (e.g., "feature-branch")
 *
 * Path handling:
 * - Worktree paths are computed on-demand via config.getMinionPath(projectPath, name)
 * - Directory name uses minion.name (the branch name)
 * - This avoids storing redundant derived data
 */
import type { z } from "zod";
import type {
  FrontendMinionMetadataSchema,
  GitStatusSchema,
  MinionActivitySnapshotSchema,
  MinionMetadataSchema,
} from "../orpc/schemas";

export type MinionMetadata = z.infer<typeof MinionMetadataSchema>;

/**
 * Git status for a minion (ahead/behind relative to origin's primary branch)
 */
export type GitStatus = z.infer<typeof GitStatusSchema>;

/**
 * Frontend minion metadata enriched with computed paths.
 * Backend computes these paths to avoid duplication of path construction logic.
 * Follows naming convention: Backend types vs Frontend types.
 */
export type FrontendMinionMetadata = z.infer<typeof FrontendMinionMetadataSchema>;

export type MinionActivitySnapshot = z.infer<typeof MinionActivitySnapshotSchema>;
