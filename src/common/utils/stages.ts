import type { StageConfig } from "@/common/types/project";

/**
 * Sort stages by their linked-list order (nextId pointers).
 *
 * Finds the head (stage not referenced by any other's nextId),
 * then follows the chain. Orphaned stages are appended at the end.
 */
export function sortStagesByLinkedList(stages: StageConfig[]): StageConfig[] {
  if (stages.length === 0) return [];

  const byId = new Map(stages.map((s) => [s.id, s]));

  // Find head: stage not referenced by any other stage's nextId
  const referencedIds = new Set(stages.map((s) => s.nextId).filter(Boolean));
  const heads = stages.filter((s) => !referencedIds.has(s.id));

  // If no clear head (cycle or empty), fall back to first stage
  const head = heads[0] ?? stages[0];

  const sorted: StageConfig[] = [];
  const visited = new Set<string>();
  let current: StageConfig | undefined = head;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    sorted.push(current);
    current = current.nextId ? byId.get(current.nextId) : undefined;
  }

  // Append orphaned stages (not in linked list)
  for (const s of stages) {
    if (!visited.has(s.id)) {
      sorted.push(s);
    }
  }

  return sorted;
}
