/**
 * DOM-based minion navigation utilities.
 *
 * Reads the rendered sidebar to determine minion ordering. This is the
 * canonical source of truth for "next/previous minion" because it reflects
 * the exact visual order the user sees (respecting sort, crews, collapsed
 * projects, etc.).
 *
 * Shared by Ctrl+J/K navigation and the archive-then-navigate behaviour.
 */

/** Compound selector that targets only minion *row* elements. */
const MINION_ROW_SELECTOR = "[data-minion-id][data-minion-path]";

/** Return all visible minion IDs in DOM (sidebar) order. */
export function getVisibleMinionIds(): string[] {
  const els = document.querySelectorAll(MINION_ROW_SELECTOR);
  return Array.from(els).map((el) => el.getAttribute("data-minion-id")!);
}

/**
 * Given a minion that is about to be removed (archived / deleted), return
 * the ID of the minion the user should land on next.
 *
 * Prefers the item immediately *after* {@link currentMinionId} (so the list
 * feels like it scrolled up to fill the gap), falling back to the item before
 * it.  When the current minion isn't rendered at all (e.g. its project or
 * crew is collapsed), returns the first visible minion — matching how
 * Ctrl+J picks a target when the selection is off-screen.
 *
 * Returns `null` only when no other minions are visible in the sidebar.
 */
export function findAdjacentMinionId(currentMinionId: string): string | null {
  const ids = getVisibleMinionIds();
  const idx = ids.indexOf(currentMinionId);

  if (idx === -1) {
    // Current minion not rendered (collapsed project/crew) — pick the
    // first visible minion that isn't the one being removed.
    return ids.find((id) => id !== currentMinionId) ?? null;
  }

  // Prefer next (below), then previous (above).
  if (idx + 1 < ids.length) return ids[idx + 1];
  if (idx - 1 >= 0) return ids[idx - 1];
  return null;
}
