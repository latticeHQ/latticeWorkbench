import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { ProjectConfig, CrewConfig } from "@/common/types/project";

// Re-export shared crew sorting utility
export { sortCrewsByLinkedList } from "@/common/utils/crews";

function flattenMinionTree(
  minions: FrontendMinionMetadata[]
): FrontendMinionMetadata[] {
  if (minions.length === 0) return [];

  const byId = new Map<string, FrontendMinionMetadata>();
  for (const minion of minions) {
    byId.set(minion.id, minion);
  }

  const childrenByParent = new Map<string, FrontendMinionMetadata[]>();
  const roots: FrontendMinionMetadata[] = [];

  // Preserve input order for both roots and siblings by iterating in-order.
  for (const minion of minions) {
    const parentId = minion.parentMinionId;
    if (parentId && byId.has(parentId)) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(minion);
      childrenByParent.set(parentId, children);
    } else {
      roots.push(minion);
    }
  }

  const result: FrontendMinionMetadata[] = [];
  const visited = new Set<string>();

  const visit = (minion: FrontendMinionMetadata, depth: number) => {
    if (visited.has(minion.id)) return;
    visited.add(minion.id);

    // Cap depth defensively to avoid pathological cycles/graphs.
    if (depth > 32) {
      result.push(minion);
      return;
    }

    result.push(minion);
    const children = childrenByParent.get(minion.id);
    if (children) {
      for (const child of children) {
        visit(child, depth + 1);
      }
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  // Fallback: ensure we include any remaining nodes (cycles, missing parents, etc.).
  for (const minion of minions) {
    if (!visited.has(minion.id)) {
      visit(minion, 0);
    }
  }

  return result;
}

export function computeMinionDepthMap(
  minions: FrontendMinionMetadata[]
): Record<string, number> {
  const byId = new Map<string, FrontendMinionMetadata>();
  for (const minion of minions) {
    byId.set(minion.id, minion);
  }

  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  const computeDepth = (minionId: string): number => {
    const existing = depths.get(minionId);
    if (existing !== undefined) return existing;

    if (visiting.has(minionId)) {
      // Cycle detected - treat as root.
      return 0;
    }

    visiting.add(minionId);
    const minion = byId.get(minionId);
    const parentId = minion?.parentMinionId;
    const depth = parentId && byId.has(parentId) ? Math.min(computeDepth(parentId) + 1, 32) : 0;
    visiting.delete(minionId);

    depths.set(minionId, depth);
    return depth;
  };

  for (const minion of minions) {
    computeDepth(minion.id);
  }

  return Object.fromEntries(depths);
}

/**
 * Age thresholds for minion filtering, in ascending order.
 * Each tier hides minions older than the specified duration.
 */
export const AGE_THRESHOLDS_DAYS = [1, 7, 30] as const;
export type AgeThresholdDays = (typeof AGE_THRESHOLDS_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a map of project paths to sorted minion metadata lists.
 * Includes both persisted minions (from config) and minions from
 * metadata that haven't yet appeared in config (handles race condition
 * where metadata event arrives before config refresh completes).
 *
 * Minions are sorted by recency (most recent first).
 */
export function buildSortedMinionsByProject(
  projects: Map<string, ProjectConfig>,
  minionMetadata: Map<string, FrontendMinionMetadata>,
  minionRecency: Record<string, number>
): Map<string, FrontendMinionMetadata[]> {
  const result = new Map<string, FrontendMinionMetadata[]>();
  const includedIds = new Set<string>();

  // First pass: include minions from persisted config
  for (const [projectPath, config] of projects) {
    const metadataList: FrontendMinionMetadata[] = [];
    for (const ws of config.minions) {
      if (!ws.id) continue;
      const meta = minionMetadata.get(ws.id);
      if (meta) {
        metadataList.push(meta);
        includedIds.add(ws.id);
      }
    }
    result.set(projectPath, metadataList);
  }

  // Second pass: add minions from metadata not yet in projects config
  // (handles race condition where metadata event arrives before config refresh completes)
  for (const [id, metadata] of minionMetadata) {
    if (!includedIds.has(id)) {
      const projectMinions = result.get(metadata.projectPath) ?? [];
      projectMinions.push(metadata);
      result.set(metadata.projectPath, projectMinions);
    }
  }

  // Sort each project's minions by recency (sort mutates in place)
  // IMPORTANT: Include deterministic tie-breakers so Storybook/Chromatic snapshots can't
  // flip ordering when multiple minions have equal recency.
  for (const metadataList of result.values()) {
    metadataList.sort((a, b) => {
      const aTimestamp = minionRecency[a.id] ?? 0;
      const bTimestamp = minionRecency[b.id] ?? 0;
      if (aTimestamp !== bTimestamp) {
        return bTimestamp - aTimestamp;
      }

      const aCreatedAtRaw = Date.parse(a.createdAt ?? "");
      const bCreatedAtRaw = Date.parse(b.createdAt ?? "");
      const aCreatedAt = Number.isFinite(aCreatedAtRaw) ? aCreatedAtRaw : 0;
      const bCreatedAt = Number.isFinite(bCreatedAtRaw) ? bCreatedAtRaw : 0;
      if (aCreatedAt !== bCreatedAt) {
        return bCreatedAt - aCreatedAt;
      }

      if (a.name !== b.name) {
        return a.name < b.name ? -1 : 1;
      }

      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1;
      }

      return 0;
    });
  }

  // Ensure child minions appear directly below their parents.
  for (const [projectPath, metadataList] of result) {
    result.set(projectPath, flattenMinionTree(metadataList));
  }

  return result;
}

/**
 * Format a day count for display.
 * Returns a human-readable string like "1 day", "7 days", etc.
 */
export function formatDaysThreshold(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * Result of partitioning minions by age thresholds.
 * - recent: minions newer than the first threshold (1 day)
 * - buckets: array of minions for each threshold tier
 *   - buckets[0]: older than 1 day but newer than 7 days
 *   - buckets[1]: older than 7 days but newer than 30 days
 *   - buckets[2]: older than 30 days
 */
export interface AgePartitionResult {
  recent: FrontendMinionMetadata[];
  buckets: FrontendMinionMetadata[][];
}

/**
 * Build the storage key for a tier's expanded state.
 */
export function getTierKey(projectPath: string, tierIndex: number): string {
  return `${projectPath}:${tierIndex}`;
}

/**
 * Find the next non-empty tier starting from a given index.
 * @returns The index of the next non-empty bucket, or -1 if none found.
 */
export function findNextNonEmptyTier(
  buckets: FrontendMinionMetadata[][],
  startIndex: number
): number {
  for (let i = startIndex; i < buckets.length; i++) {
    if (buckets[i].length > 0) return i;
  }
  return -1;
}

/**
 * Partition minions into age-based buckets.
 * Always shows at least one minion in the recent crew (the most recent one).
 */
export function partitionMinionsByAge(
  minions: FrontendMinionMetadata[],
  minionRecency: Record<string, number>
): AgePartitionResult {
  if (minions.length === 0) {
    return { recent: [], buckets: AGE_THRESHOLDS_DAYS.map(() => []) };
  }

  const now = Date.now();
  const thresholdMs = AGE_THRESHOLDS_DAYS.map((d) => d * DAY_MS);

  const recent: FrontendMinionMetadata[] = [];
  const buckets: FrontendMinionMetadata[][] = AGE_THRESHOLDS_DAYS.map(() => []);

  for (const minion of minions) {
    const recencyTimestamp = minionRecency[minion.id] ?? 0;
    const age = now - recencyTimestamp;

    if (age < thresholdMs[0]) {
      recent.push(minion);
    } else {
      // Find which bucket this minion belongs to
      // buckets[i] contains minions older than threshold[i] but newer than threshold[i+1]
      let placed = false;
      for (let i = 0; i < thresholdMs.length - 1; i++) {
        if (age >= thresholdMs[i] && age < thresholdMs[i + 1]) {
          buckets[i].push(minion);
          placed = true;
          break;
        }
      }
      // Older than the last threshold
      if (!placed) {
        buckets[buckets.length - 1].push(minion);
      }
    }
  }

  // Always show at least one minion - move the most recent from first non-empty bucket
  if (recent.length === 0) {
    for (const bucket of buckets) {
      if (bucket.length > 0) {
        recent.push(bucket.shift()!);
        break;
      }
    }
  }

  return { recent, buckets };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crew-based minion grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of partitioning minions by crew.
 * - unsectioned: minions not assigned to any crew
 * - byCrewId: map of crew ID to minions in that crew
 */
export interface SectionPartitionResult {
  unsectioned: FrontendMinionMetadata[];
  byCrewId: Map<string, FrontendMinionMetadata[]>;
}

/**
 * Partition minions by their crewId.
 * Preserves input order within each partition.
 *
 * @param minions - All minions for the project (in display order)
 * @param crews - Crew configs for the project (used to validate crew IDs)
 * @returns Partitioned minions
 */
export function partitionMinionsByCrew(
  minions: FrontendMinionMetadata[],
  sections: CrewConfig[]
): SectionPartitionResult {
  const crewIds = new Set(sections.map((s) => s.id));
  const unsectioned: FrontendMinionMetadata[] = [];
  const byCrewId = new Map<string, FrontendMinionMetadata[]>();

  // Initialize all crews with empty arrays to ensure consistent ordering
  for (const section of sections) {
    byCrewId.set(section.id, []);
  }

  // Build minion lookup for parent resolution
  const byId = new Map<string, FrontendMinionMetadata>();
  for (const minion of minions) {
    byId.set(minion.id, minion);
  }

  // Resolve effective crew for a minion (inherit from parent if unset)
  const resolveSection = (minion: FrontendMinionMetadata): string | undefined => {
    if (minion.crewId && crewIds.has(minion.crewId)) {
      return minion.crewId;
    }
    // Inherit from parent if child has no crew
    if (minion.parentMinionId) {
      const parent = byId.get(minion.parentMinionId);
      if (parent) {
        return resolveSection(parent);
      }
    }
    return undefined;
  };

  for (const minion of minions) {
    const effectiveSectionId = resolveSection(minion);
    if (effectiveSectionId) {
      const list = byCrewId.get(effectiveSectionId)!;
      list.push(minion);
    } else {
      unsectioned.push(minion);
    }
  }

  return { unsectioned, byCrewId };
}

/**
 * Build the storage key for a crew's expanded state.
 */
export function getCrewExpandedKey(projectPath: string, crewId: string): string {
  return `section:${projectPath}:${crewId}`;
}

/**
 * Build the storage key for a crew's age tier expanded state.
 * This is separate from project-level tiers to allow per-crew age collapse.
 */
export function getCrewTierKey(
  projectPath: string,
  crewId: string,
  tierIndex: number
): string {
  return `section:${projectPath}:${crewId}:tier:${tierIndex}`;
}
