import { useState, useEffect } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useAPI } from "@/browser/contexts/API";
import type { KanbanCard as KanbanCardType, KanbanColumnId } from "@/common/types/kanban";
import { KANBAN_COLUMNS } from "@/common/types/kanban";
import { KanbanColumn } from "./KanbanColumn";
import { ArchivedTerminalViewer } from "./ArchivedTerminalViewer";

/** Strip nulls from oRPC response to match KanbanCard interface (nullish → undefined). */
function normalizeCard(raw: Record<string, unknown>): KanbanCardType {
  return {
    sessionId: raw.sessionId as string,
    minionId: raw.minionId as string,
    column: raw.column as KanbanColumnId,
    profileName: raw.profileName as string,
    profileId: (raw.profileId as string) ?? undefined,
    createdAt: raw.createdAt as number,
    closedAt: (raw.closedAt as number) ?? undefined,
    archivedAt: (raw.archivedAt as number) ?? undefined,
    readOnly: raw.readOnly as boolean,
    cols: (raw.cols as number) ?? undefined,
    rows: (raw.rows as number) ?? undefined,
  };
}

interface KanbanBoardProps {
  minionId: string;
}

export function KanbanBoard(props: KanbanBoardProps) {
  const { api } = useAPI();
  const [cards, setCards] = useState<KanbanCardType[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewingSession, setViewingSession] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Fetch cards and subscribe to live updates
  useEffect(() => {
    if (!api) return;

    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await api!.kanban.list({ minionId: props.minionId });
        if (!cancelled) {
          setCards(result.map((r) => normalizeCard(r as unknown as Record<string, unknown>)));
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load board");
          console.error("KanbanBoard: failed to load cards:", err);
        }
      }
    }

    async function subscribe() {
      try {
        const stream = await api!.kanban.subscribe(
          { minionId: props.minionId },
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setCards(
            (snapshot as unknown as Array<Record<string, unknown>>).map(normalizeCard),
          );
          setError(null);
        }
      } catch (err) {
        // AbortError is expected on cleanup
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("KanbanBoard: subscription error:", err);
        }
      }
    }

    load();
    subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api, props.minionId]);

  function handleDragEnd(event: DragEndEvent) {
    if (!api) return;

    const { active, over } = event;
    if (!over) return;

    const overId = String(over.id);
    if (!overId.startsWith("kanban:column:")) return;

    const targetColumn = overId.replace("kanban:column:", "") as KanbanColumnId;
    const card = (active.data.current as { card?: KanbanCardType })?.card;
    if (!card) return;

    // Don't move if same column
    if (card.column === targetColumn) return;

    // Optimistic update
    setCards((prev) =>
      prev.map((c) =>
        c.sessionId === card.sessionId
          ? { ...c, column: targetColumn, readOnly: targetColumn === "archived" }
          : c,
      ),
    );

    // Persist to backend
    api.kanban
      .moveCard({
        minionId: props.minionId,
        sessionId: card.sessionId,
        targetColumn,
      })
      .catch((err) => {
        console.error("KanbanBoard: failed to move card:", err);
        // Revert on failure
        setCards((prev) =>
          prev.map((c) =>
            c.sessionId === card.sessionId ? { ...c, column: card.column } : c,
          ),
        );
      });
  }

  function handleViewArchived(sessionId: string) {
    setViewingSession(sessionId);
  }

  // Group cards by column
  const cardsByColumn = new Map<KanbanColumnId, KanbanCardType[]>();
  for (const col of KANBAN_COLUMNS) {
    cardsByColumn.set(col, []);
  }
  for (const card of cards) {
    const bucket = cardsByColumn.get(card.column);
    if (bucket) {
      bucket.push(card);
    }
  }

  // When viewing an archived session, replace columns with inline terminal pane
  if (viewingSession != null) {
    const card = cards.find((c) => c.sessionId === viewingSession);
    return (
      <ArchivedTerminalViewer
        minionId={props.minionId}
        sessionId={viewingSession}
        profileName={card?.profileName ?? "Archived Session"}
        onBack={() => setViewingSession(null)}
      />
    );
  }

  if (error) {
    return (
      <div className="text-danger flex h-full items-center justify-center p-4 text-xs">
        {error}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-1.5 overflow-x-auto p-2">
        {KANBAN_COLUMNS.map((col) => (
          <KanbanColumn
            key={col}
            columnId={col}
            cards={cardsByColumn.get(col) ?? []}
            onViewArchived={handleViewArchived}
          />
        ))}
      </div>
    </DndContext>
  );
}
