import React from "react";
import { useDrop } from "react-dnd";
import { cn } from "@/common/lib/utils";

const MINION_DRAG_TYPE = "MINION_TO_SECTION";

export interface MinionDragItem {
  type: typeof MINION_DRAG_TYPE;
  minionId: string;
  projectPath: string;
  currentSectionId?: string;
}

interface MinionCrewDropZoneProps {
  projectPath: string;
  crewId: string | null; // null for unsectioned
  onDrop: (minionId: string, targetSectionId: string | null) => void;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Drop zone for dragging minions into/out of crews.
 */
export const MinionCrewDropZone: React.FC<MinionCrewDropZoneProps> = ({
  projectPath,
  crewId,
  onDrop,
  children,
  className,
  testId,
}) => {
  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: MINION_DRAG_TYPE,
      canDrop: (item: MinionDragItem) => {
        // Can only drop if from same project and moving to different crew
        return item.projectPath === projectPath && item.currentSectionId !== crewId;
      },
      drop: (item: MinionDragItem) => {
        onDrop(item.minionId, crewId);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [projectPath, crewId, onDrop]
  );

  return (
    <div
      ref={drop}
      className={cn(className, isOver && canDrop && "bg-accent/10")}
      data-testid={testId}
      data-drop-section-id={crewId ?? "unsectioned"}
    >
      {children}
    </div>
  );
};

export { MINION_DRAG_TYPE };
