/**
 * Determine if a minion is archived based on timestamps.
 * A minion is archived if archivedAt exists and is more recent than unarchivedAt.
 *
 * @param archivedAt - ISO timestamp when minion was archived
 * @param unarchivedAt - ISO timestamp when minion was unarchived
 * @returns true if minion is currently archived
 */
export function isMinionArchived(archivedAt?: string, unarchivedAt?: string): boolean {
  if (!archivedAt) return false;
  if (!unarchivedAt) return true;
  return new Date(archivedAt).getTime() > new Date(unarchivedAt).getTime();
}
