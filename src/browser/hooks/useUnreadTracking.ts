import { useEffect, useCallback, useRef } from "react";
import type { MinionSelection } from "@/browser/components/ProjectSidebar";
import { getMinionLastReadKey } from "@/common/constants/storage";
import { readPersistedState, updatePersistedState } from "./usePersistedState";

const LEGACY_LAST_READ_KEY = "minionLastRead";

/**
 * Track last-read timestamps for minions.
 * Individual MinionListItem components compute their own unread state
 * by comparing their recency timestamp with the last-read timestamp.
 *
 * This hook only manages the timestamps, not the unread computation.
 */
export function useUnreadTracking(
  selectedMinion: MinionSelection | null,
  currentMinionId: string | null
) {
  const didMigrateRef = useRef(false);

  useEffect(() => {
    if (didMigrateRef.current) return;
    didMigrateRef.current = true;

    const legacy = readPersistedState<Record<string, number>>(LEGACY_LAST_READ_KEY, {});
    const entries = Object.entries(legacy);
    if (entries.length === 0) return;

    for (const [minionId, timestamp] of entries) {
      if (!Number.isFinite(timestamp)) continue;
      const nextKey = getMinionLastReadKey(minionId);
      const existing = readPersistedState<number | undefined>(nextKey, undefined);
      if (existing === undefined) {
        updatePersistedState(nextKey, timestamp);
      }
    }

    updatePersistedState(LEGACY_LAST_READ_KEY, null);
  }, []);

  const markAsRead = useCallback((minionId: string) => {
    updatePersistedState(getMinionLastReadKey(minionId), Date.now());
  }, []);

  const selectedMinionId = selectedMinion?.minionId ?? null;
  const visibleSelectedMinionId =
    selectedMinionId != null && currentMinionId === selectedMinionId
      ? selectedMinionId
      : null;

  const markSelectedAsReadIfVisible = useCallback(() => {
    if (visibleSelectedMinionId == null) return;
    markAsRead(visibleSelectedMinionId);
  }, [visibleSelectedMinionId, markAsRead]);

  // Mark as read when visibility changes (minion selected + chat route active).
  useEffect(() => {
    markSelectedAsReadIfVisible();
  }, [markSelectedAsReadIfVisible]);

  // Mark as read when window regains focus — only when chat is visible.
  useEffect(() => {
    window.addEventListener("focus", markSelectedAsReadIfVisible);
    return () => window.removeEventListener("focus", markSelectedAsReadIfVisible);
  }, [markSelectedAsReadIfVisible]);
}
