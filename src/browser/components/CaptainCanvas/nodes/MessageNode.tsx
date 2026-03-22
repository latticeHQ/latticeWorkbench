import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface MessageData {
  role: string;
  content: string;
  timestamp: number;
}

export const MessageNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as MessageData;
  const isUser = d.role === "user";

  return (
    <div
      style={{
        background: isUser ? "#1e293b" : "#1e1b4b",
        border: `1.5px solid ${isUser ? "#475569" : "#6366f1"}`,
        borderRadius: isUser ? "12px 12px 12px 2px" : "12px 12px 2px 12px",
        padding: "8px 12px",
        maxWidth: 220,
        color: "#e2e8f0",
        fontSize: 11,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: isUser ? "#475569" : "#6366f1", width: 5, height: 5 }} />

      <div style={{ fontSize: 9, color: isUser ? "#94a3b8" : "#a5b4fc", marginBottom: 3, fontWeight: 600 }}>
        {isUser ? "YOU" : "CAPTAIN"}
      </div>
      <div style={{ lineHeight: 1.4, maxHeight: 50, overflow: "hidden" }}>
        {d.content}
      </div>
      <div style={{ fontSize: 9, color: "#475569", marginTop: 3 }}>
        {new Date(d.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
});

MessageNode.displayName = "MessageNode";
