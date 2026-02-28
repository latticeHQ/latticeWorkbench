import { useDroppable } from "@dnd-kit/core";
import type { KanbanCard as KanbanCardType, KanbanColumnId } from "@/common/types/kanban";
import { KANBAN_COLUMN_LABELS } from "@/common/types/kanban";
import { KanbanCard } from "./KanbanCard";

/** Columns that accept drops. */
const DROP_TARGETS = new Set<KanbanColumnId>(["queued", "archived"]);

/** Columns whose cards can be dragged out. */
const DRAG_SOURCES = new Set<KanbanColumnId>(["queued", "completed"]);

interface KanbanColumnProps {
  columnId: KanbanColumnId;
  cards: KanbanCardType[];
  onViewArchived?: (sessionId: string) => void;
}

export function KanbanColumn(props: KanbanColumnProps) {
  const isDropTarget = DROP_TARGETS.has(props.columnId);
  const isDragSource = DRAG_SOURCES.has(props.columnId);

  const { setNodeRef, isOver } = useDroppable({
    id: `kanban:column:${props.columnId}`,
    data: { columnId: props.columnId },
    disabled: !isDropTarget,
  });

  // Sort by createdAt descending (newest first)
  const sorted = [...props.cards].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[140px] flex-1 flex-col rounded-md border ${
        isOver
          ? "border-accent bg-accent/5"
          : "border-border-medium bg-background"
      }`}
    >
      {/* Column header */}
      <div className="border-border-medium flex items-center justify-between border-b px-2 py-1.5">
        <span className="text-foreground text-xs font-semibold">
          {KANBAN_COLUMN_LABELS[props.columnId]}
        </span>
        <span className="text-muted rounded-full bg-current/10 px-1.5 text-[10px] font-medium">
          {props.cards.length}
        </span>
      </div>

      {/* Card list */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
        {sorted.length === 0 ? (
          <div className="text-muted py-4 text-center text-[10px] italic">
            No sessions
          </div>
        ) : (
          sorted.map((card) => (
            <KanbanCard
              key={card.sessionId}
              card={card}
              isDraggable={isDragSource}
              onViewArchived={props.onViewArchived}
            />
          ))
        )}
      </div>
    </div>
  );
}
