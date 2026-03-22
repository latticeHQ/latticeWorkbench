import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface MemoryData {
  memoryType: string;
  content: string;
  importance: number;
}

export const MemoryNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as MemoryData;
  const opacity = 0.3 + d.importance * 0.7;

  return (
    <div
      style={{
        background: "#042f2e",
        border: "1.5px solid #14b8a6",
        borderRadius: 8,
        padding: "6px 10px",
        maxWidth: 180,
        color: "#99f6e4",
        fontSize: 10,
        opacity,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#14b8a6", width: 5, height: 5 }} />

      <div style={{ fontWeight: 600, fontSize: 9, color: "#5eead4", marginBottom: 2 }}>
        {d.memoryType.toUpperCase()} | {Math.round(d.importance * 100)}%
      </div>
      <div style={{ lineHeight: 1.3, maxHeight: 32, overflow: "hidden" }}>
        {d.content}
      </div>
    </div>
  );
});

MemoryNode.displayName = "MemoryNode";
