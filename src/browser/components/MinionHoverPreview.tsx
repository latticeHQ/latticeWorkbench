import { cn } from "@/common/lib/utils";
import { RuntimeBadge } from "./RuntimeBadge";
import { BranchSelector } from "./BranchSelector";
import { MinionLinks } from "./MinionLinks";
import type { RuntimeConfig } from "@/common/types/runtime";

interface MinionHoverPreviewProps {
  minionId: string;
  projectName: string;
  minionName: string;
  namedMinionPath: string;
  runtimeConfig?: RuntimeConfig;
  isWorking: boolean;
  className?: string;
}

/**
 * Dense minion info preview for hover cards.
 * Shows runtime badge, project name, branch selector, git status, and PR link.
 */
export function MinionHoverPreview({
  minionId,
  projectName,
  minionName,
  namedMinionPath,
  runtimeConfig,
  isWorking,
  className,
}: MinionHoverPreviewProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 text-[11px]", className)}>
      <RuntimeBadge
        runtimeConfig={runtimeConfig}
        isWorking={isWorking}
        minionPath={namedMinionPath}
        minionName={minionName}
        tooltipSide="bottom"
      />
      <span className="min-w-0 truncate font-mono text-[11px]">{projectName}</span>
      <div className="flex items-center gap-1">
        <BranchSelector minionId={minionId} minionName={minionName} />
        <MinionLinks minionId={minionId} />
      </div>
    </div>
  );
}
