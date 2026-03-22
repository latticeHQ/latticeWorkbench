import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface ActionData {
  actionType: string;
  description: string;
}

const ACTION_COLORS: Record<string, string> = {
  spawn_worker: "#f97316",
  message_user: "#8b5cf6",
  decompose_goal: "#eab308",
  aggregate_results: "#22c55e",
  store_memory: "#06b6d4",
  research: "#ec4899",
  cleanup_worker: "#6b7280",
  wait: "#334155",
};

export const ActionNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as ActionData;
  const color = ACTION_COLORS[d.actionType] ?? "#f97316";

  return (
    <div
      style={{
        background: `${color}20`,
        border: `2px solid ${color}`,
        borderRadius: 8,
        padding: "8px 12px",
        minWidth: 140,
        maxWidth: 200,
        color: "#e2e8f0",
        fontSize: 11,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />

      <div style={{ fontWeight: 700, color, fontSize: 10, textTransform: "uppercase", marginBottom: 3 }}>
        {d.actionType.replace(/_/g, " ")}
      </div>
      <div style={{ color: "#cbd5e1", lineHeight: 1.3, maxHeight: 40, overflow: "hidden" }}>
        {d.description}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
});

ActionNode.displayName = "ActionNode";
