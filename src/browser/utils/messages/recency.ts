import type { LatticeMessage } from "@/common/types/message";
import { computeRecencyFromMessages } from "@/common/utils/recency";

/**
 * Compute recency timestamp for minion sorting.
 * Wrapper that handles string timestamp parsing for frontend use.
 *
 * Returns the maximum of:
 * - Minion creation timestamp (ensures newly created/forked minions appear at top)
 * - Minion unarchived timestamp (ensures restored minions appear at top)
 * - Last user message timestamp (most recent user interaction)
 * - Last compacted message timestamp (fallback for compacted histories)
 */
export function computeRecencyTimestamp(
  messages: LatticeMessage[],
  createdAt?: string,
  unarchivedAt?: string
): number | null {
  let createdTimestamp: number | undefined;
  if (createdAt) {
    const parsed = new Date(createdAt).getTime();
    createdTimestamp = !isNaN(parsed) ? parsed : undefined;
  }
  let unarchivedTimestamp: number | undefined;
  if (unarchivedAt) {
    const parsed = new Date(unarchivedAt).getTime();
    unarchivedTimestamp = !isNaN(parsed) ? parsed : undefined;
  }
  return computeRecencyFromMessages(messages, createdTimestamp, unarchivedTimestamp);
}
