import React from "react";

import { useDragLayer } from "react-dnd";
import { MINION_DRAG_TYPE, type MinionDragItem } from "./MinionCrewDropZone";
import { RuntimeBadge } from "./RuntimeBadge";
import { cn } from "@/common/lib/utils";
import type { RuntimeConfig } from "@/common/types/runtime";

/**
 * Custom drag layer for minion drag-drop.
 * Renders a clean preview of the minion being dragged.
 */
export const MinionDragLayer: React.FC = () => {
  const dragState = useDragLayer<{
    isDragging: boolean;
    item: unknown;
    itemType: string | symbol | null;
    currentOffset: { x: number; y: number } | null;
  }>((monitor) => ({
    isDragging: monitor.isDragging(),
    item: monitor.getItem(),
    itemType: monitor.getItemType(),
    currentOffset: monitor.getClientOffset(),
  }));

  const { isDragging, item, itemType, currentOffset } = dragState;

  // Only render for minion drags
  if (!isDragging || itemType !== MINION_DRAG_TYPE || !currentOffset) {
    return null;
  }

  const minionItem = item as MinionDragItem & {
    displayTitle?: string;
    runtimeConfig?: RuntimeConfig;
  };

  const displayTitle = minionItem.displayTitle ?? "Minion";

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      <div
        style={{
          transform: `translate(${currentOffset.x + 10}px, ${currentOffset.y + 10}px)`,
        }}
      >
        <div
          className={cn(
            "flex max-w-56 items-center gap-1.5 rounded-sm px-2 py-1.5",
            "bg-sidebar border-border border shadow-lg"
          )}
        >
          <RuntimeBadge runtimeConfig={minionItem.runtimeConfig} isWorking={false} />
          <span className="text-foreground truncate text-sm">{displayTitle}</span>
        </div>
      </div>
    </div>
  );
};
