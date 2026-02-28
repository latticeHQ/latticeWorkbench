import { useDraggable } from "@dnd-kit/core";
import { Lock, Eye, GripVertical } from "lucide-react";
import type { KanbanCard as KanbanCardType } from "@/common/types/kanban";

/** Format relative time from epoch ms. */
function formatRelativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

/** Format duration from ms. */
function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1_000);
  return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
}

/** Status dot color per column — uses Lattice warm palette CSS vars. */
const COLUMN_DOT_COLORS: Record<string, string> = {
  queued: "var(--color-warning)",
  active: "var(--color-accent)",
  completed: "var(--color-muted)",
  archived: "var(--color-muted)",
};

interface KanbanCardProps {
  card: KanbanCardType;
  isDraggable: boolean;
  onViewArchived?: (sessionId: string) => void;
}

export function KanbanCard(props: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `kanban:card:${props.card.sessionId}`,
    data: { card: props.card },
    disabled: !props.isDraggable,
  });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  const duration = props.card.closedAt
    ? formatDuration(props.card.closedAt - props.card.createdAt)
    : formatDuration(Date.now() - props.card.createdAt);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border-border-medium bg-background-secondary rounded-md border p-2 text-xs transition-shadow ${
        isDragging ? "opacity-80 shadow-lg" : ""
      } ${props.isDraggable ? "cursor-grab active:cursor-grabbing" : ""}`}
      {...(props.isDraggable ? { ...attributes, ...listeners } : {})}
    >
      <div className="flex items-center gap-1.5">
        {props.isDraggable && (
          <GripVertical className="text-muted h-3 w-3 shrink-0 opacity-50" />
        )}
        {/* Status dot */}
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: COLUMN_DOT_COLORS[props.card.column] ?? "var(--color-muted)" }}
        />
        <span className="text-foreground truncate font-medium">
          {props.card.profileName}
        </span>
        {props.card.readOnly && (
          <Lock className="text-muted ml-auto h-3 w-3 shrink-0" />
        )}
      </div>

      <div className="text-muted mt-1 flex items-center justify-between gap-1">
        <span className="truncate font-mono text-[10px]">
          {props.card.sessionId.slice(-12)}
        </span>
        <span className="shrink-0">{formatRelativeTime(props.card.createdAt)}</span>
      </div>

      <div className="text-muted mt-0.5 flex items-center justify-between">
        <span>{duration}</span>
        {props.card.column === "archived" && props.onViewArchived && (
          <button
            type="button"
            className="text-accent hover:text-accent-hover inline-flex items-center gap-0.5 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              props.onViewArchived?.(props.card.sessionId);
            }}
          >
            <Eye className="h-3 w-3" />
            View
          </button>
        )}
      </div>
    </div>
  );
}
