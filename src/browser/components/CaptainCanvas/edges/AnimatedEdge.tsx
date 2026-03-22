import { memo } from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export const AnimatedEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd } = props;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  return (
    <BaseEdge
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: "#475569",
        strokeWidth: 1.5,
        ...style,
      }}
    />
  );
});

AnimatedEdge.displayName = "AnimatedEdge";

export const captainEdgeTypes = {
  animated: AnimatedEdge,
} as const;
