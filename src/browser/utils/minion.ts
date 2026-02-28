import type { FrontendMinionMetadata } from "@/common/types/minion";

/**
 * Generate a comparison key for minion sidebar display.
 * Used by useStableReference to detect when sidebar needs re-render.
 *
 * IMPORTANT: If you add a field to MinionMetadata that affects how
 * minions appear in the sidebar, add it here to ensure UI updates.
 */
export function getMinionSidebarKey(meta: FrontendMinionMetadata): string {
  const initKey = meta.isInitializing === true ? "initializing" : "";
  const removingKey = meta.isRemoving === true ? "removing" : "";

  return [
    meta.id,
    meta.name,
    meta.title ?? "", // Display title (falls back to name in UI)
    initKey,
    removingKey,
    meta.parentMinionId ?? "", // Nested sidebar indentation/order
    meta.agentType ?? "", // Agent preset badge/label (future)
    meta.crewId ?? "", // Section grouping for sidebar organization
  ].join("|");
}
