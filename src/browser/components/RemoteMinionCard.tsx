/**
 * Card component for a remote Lattice Runtime minion.
 * Shows name, template, and a status badge with color coding.
 */
import { Server } from "lucide-react";
import { cn } from "@/common/lib/utils";
import type { LatticeMinion, LatticeMinionStatus } from "@/common/orpc/schemas/lattice";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<LatticeMinionStatus, { label: string; dotClass: string }> = {
  running: { label: "Running", dotClass: "bg-green-500" },
  stopped: { label: "Stopped", dotClass: "bg-gray-400" },
  starting: { label: "Starting", dotClass: "bg-amber-500 animate-pulse" },
  stopping: { label: "Stopping", dotClass: "bg-amber-500" },
  failed: { label: "Failed", dotClass: "bg-red-500" },
  pending: { label: "Pending", dotClass: "bg-gray-400 animate-pulse" },
  canceling: { label: "Canceling", dotClass: "bg-amber-500" },
  canceled: { label: "Canceled", dotClass: "bg-gray-400" },
  deleting: { label: "Deleting", dotClass: "bg-red-500 animate-pulse" },
  deleted: { label: "Deleted", dotClass: "bg-gray-400" },
};

function StatusBadge({ status }: { status: LatticeMinionStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)} />
      <span className="text-muted-foreground text-[11px]">{config.label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface RemoteMinionCardProps {
  minion: LatticeMinion;
  onClick?: () => void;
}

export function RemoteMinionCard({ minion, onClick }: RemoteMinionCardProps) {
  const isConnectable = minion.status === "running";

  return (
    <button
      type="button"
      onClick={isConnectable ? onClick : undefined}
      disabled={!isConnectable}
      className={cn(
        "border-border-light bg-sidebar hover:bg-hover group flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
        isConnectable ? "cursor-pointer" : "cursor-default opacity-60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          <span className="text-foreground truncate text-sm font-medium">
            {minion.name}
          </span>
        </div>
        <StatusBadge status={minion.status} />
      </div>
      <div className="text-muted-foreground truncate text-xs">
        {minion.templateDisplayName}
      </div>
      {isConnectable && (
        <div className="text-accent text-xs opacity-0 transition-opacity group-hover:opacity-100">
          Click to connect
        </div>
      )}
    </button>
  );
}
