/**
 * Component to display the PR badge in the minion header.
 * PR is detected from the minion's current branch via `gh pr view`.
 */

import { useMinionPR } from "@/browser/stores/PRStatusStore";
import { PRLinkBadge } from "./PRLinkBadge";

interface MinionLinksProps {
  minionId: string;
}

export function MinionLinks({ minionId }: MinionLinksProps) {
  const minionPR = useMinionPR(minionId);

  if (!minionPR) {
    return null;
  }

  return <PRLinkBadge prLink={minionPR} />;
}
