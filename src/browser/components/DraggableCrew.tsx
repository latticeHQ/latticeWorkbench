import React, { useEffect } from "react";
import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { cn } from "@/common/lib/utils";

const SECTION_DRAG_TYPE = "SECTION_REORDER";

export interface SectionDragItem {
  type: typeof SECTION_DRAG_TYPE;
  crewId: string;
  crewName: string;
  projectPath: string;
}

interface DraggableCrewProps {
  crewId: string;
  crewName: string;
  projectPath: string;
  /** Called when a crew is dropped onto this crew (reorder) */
  onReorder: (draggedSectionId: string, targetSectionId: string) => void;
  children: React.ReactNode;
}

/**
 * Wrapper that makes a crew draggable for reordering.
 * Crews can be dragged and dropped onto other crews within the same project.
 */
export const DraggableCrew: React.FC<DraggableCrewProps> = ({
  crewId,
  crewName,
  projectPath,
  onReorder,
  children,
}) => {
  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: SECTION_DRAG_TYPE,
      item: {
        type: SECTION_DRAG_TYPE,
        crewId,
        crewName,
        projectPath,
      } satisfies SectionDragItem,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [crewId, crewName, projectPath]
  );

  // Hide native drag preview
  useEffect(() => {
    dragPreview(getEmptyImage(), { captureDraggingState: true });
  }, [dragPreview]);

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: SECTION_DRAG_TYPE,
      canDrop: (item: SectionDragItem) => {
        // Can only drop if from same project and different crew
        return item.projectPath === projectPath && item.crewId !== crewId;
      },
      drop: (item: SectionDragItem) => {
        onReorder(item.crewId, crewId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [projectPath, crewId, onReorder]
  );

  return (
    <div
      ref={(node) => drag(drop(node))}
      data-crew-drag-id={crewId}
      className={cn(isDragging && "opacity-50", isOver && canDrop && "bg-accent/10")}
    >
      {children}
    </div>
  );
};

export { SECTION_DRAG_TYPE };
