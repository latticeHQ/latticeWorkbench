import React from "react";
import { useDrop } from "react-dnd";
import { cn } from "@/common/lib/utils";

const MINION_DRAG_TYPE = "MINION_TO_SECTION";

export interface MinionDragItem {
  type: typeof MINION_DRAG_TYPE;
  minionId: string;
  projectPath: string;
  currentStageId?: string;
}

interface MinionStageDropZoneProps {
  projectPath: string;
  stageId: string | null; // null for unstaged
  onDrop: (minionId: string, targetStageId: string | null) => void;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Drop zone for dragging minions into/out of stages.
 */
export const MinionStageDropZone: React.FC<MinionStageDropZoneProps> = ({
  projectPath,
  stageId,
  onDrop,
  children,
  className,
  testId,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: MINION_DRAG_TYPE,
      canDrop: (item: MinionDragItem) => {
        // Can only drop if from same project and moving to different stage
        return item.projectPath === projectPath && item.currentStageId !== stageId;
      },
      drop: (item: MinionDragItem) => {
        onDrop(item.minionId, stageId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [projectPath, stageId, onDrop]
  );

  return (
    <div
      ref={drop}
      className={cn(className, isOver && canDrop && "bg-accent/10")}
      data-testid={testId}
      data-drop-stage-id={stageId ?? "unstaged"}
    >
      {children}
    </div>
  );
};

export { MINION_DRAG_TYPE };
