import React, { useEffect } from "react";
import { useDrag, useDrop } from "react-dnd";
import { getEmptyImage } from "react-dnd-html5-backend";
import { cn } from "@/common/lib/utils";

const STAGE_DRAG_TYPE = "STAGE_REORDER";

export interface StageDragItem {
  type: typeof STAGE_DRAG_TYPE;
  stageId: string;
  stageName: string;
  projectPath: string;
}

interface DraggableStageProps {
  stageId: string;
  stageName: string;
  projectPath: string;
  /** Called when a stage is dropped onto this stage (reorder) */
  onReorder: (draggedStageId: string, targetStageId: string) => void;
  children: React.ReactNode;
}

/**
 * Wrapper that makes a stage draggable for reordering.
 * Stages can be dragged and dropped onto other stages within the same project.
 */
export const DraggableStage: React.FC<DraggableStageProps> = ({
  stageId,
  stageName,
  projectPath,
  onReorder,
  children,
}) => {
  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: STAGE_DRAG_TYPE,
      item: {
        type: STAGE_DRAG_TYPE,
        stageId,
        stageName,
        projectPath,
      } satisfies StageDragItem,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [stageId, stageName, projectPath]
  );

  // Hide native drag preview
  useEffect(() => {
    dragPreview(getEmptyImage(), { captureDraggingState: true });
  }, [dragPreview]);

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: STAGE_DRAG_TYPE,
      canDrop: (item: StageDragItem) => {
        // Can only drop if from same project and different stage
        return item.projectPath === projectPath && item.stageId !== stageId;
      },
      drop: (item: StageDragItem) => {
        onReorder(item.stageId, stageId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [projectPath, stageId, onReorder]
  );

  return (
    <div
      ref={(node) => drag(drop(node))}
      data-stage-drag-id={stageId}
      className={cn(isDragging && "opacity-50", isOver && canDrop && "bg-accent/10")}
    >
      {children}
    </div>
  );
};

export { STAGE_DRAG_TYPE };
