import type { CrewConfig } from "@/common/types/project";

/**
 * Sort crews by their linked-list order (nextId pointers).
 *
 * Finds the head (crew not referenced by any other's nextId),
 * then follows the chain. Orphaned crews are appended at the end.
 */
export function sortCrewsByLinkedList(sections: CrewConfig[]): CrewConfig[] {
  if (sections.length === 0) return [];

  const byId = new Map(sections.map((s) => [s.id, s]));

  // Find head: crew not referenced by any other crew's nextId
  const referencedIds = new Set(sections.map((s) => s.nextId).filter(Boolean));
  const heads = sections.filter((s) => !referencedIds.has(s.id));

  // If no clear head (cycle or empty), fall back to first crew
  const head = heads[0] ?? sections[0];

  const sorted: CrewConfig[] = [];
  const visited = new Set<string>();
  let current: CrewConfig | undefined = head;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    sorted.push(current);
    current = current.nextId ? byId.get(current.nextId) : undefined;
  }

  // Append orphaned crews (not in linked list)
  for (const s of sections) {
    if (!visited.has(s.id)) {
      sorted.push(s);
    }
  }

  return sorted;
}
