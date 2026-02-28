import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { useMinionSidebarState } from "@/browser/stores/MinionStore";
import { getMinionLastReadKey } from "@/common/constants/storage";

/**
 * Hook to determine if a minion has unread messages.
 * Returns { isUnread, lastReadTimestamp, recencyTimestamp } for flexibility.
 */
export function useMinionUnread(minionId: string): {
  isUnread: boolean;
  lastReadTimestamp: number | null;
  recencyTimestamp: number | null;
} {
  // Missing lastRead means this minion has no persisted read baseline yet.
  // Treat that as "implicitly read" until we observe an explicit read event,
  // instead of coercing to epoch (0) which marks legacy minions unread forever.
  const [lastReadTimestamp] = usePersistedState<number | null>(
    getMinionLastReadKey(minionId),
    null,
    {
      listener: true,
    }
  );
  const { recencyTimestamp } = useMinionSidebarState(minionId);
  const isUnread =
    recencyTimestamp !== null && lastReadTimestamp !== null && recencyTimestamp > lastReadTimestamp;

  return { isUnread, lastReadTimestamp, recencyTimestamp };
}
