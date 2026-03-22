import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface GoalData {
  description: string;
  status: string;
  priority: number;
  source: string;
  subGoalCount: number;
  workerCount: number;
  completedWorkers: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#eab308",
  active: "#f59e0b",
  decomposed: "#8b5cf6",
  completed: "#22c55e",
  failed: "#ef4444",
  cancelled: "#6b7280",
};

export const GoalNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as GoalData;
  const statusColor = STATUS_COLORS[d.status] ?? "#6b7280";
  const progress = d.workerCount > 0 ? d.completedWorkers / d.workerCount : 0;

  return (
    <div
      style={{
        background: "#1c1917",
        border: `2px solid ${statusColor}`,
        borderRadius: 12,
        padding: "12px 16px",
        minWidth: 200,
        maxWidth: 280,
        color: "#e2e8f0",
        fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: statusColor }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusColor,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, color: "#fbbf24" }}>P{d.priority}</span>
        <span style={{ color: "#94a3b8", fontSize: 10, textTransform: "uppercase" }}>
          {d.status}
        </span>
      </div>

      <div style={{ marginBottom: 8, lineHeight: 1.4 }}>{d.description}</div>

      {d.workerCount > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div
            style={{
              background: "#292524",
              borderRadius: 4,
              height: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: statusColor,
                width: `${progress * 100}%`,
                height: "100%",
                borderRadius: 4,
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: "#78716c", marginTop: 2 }}>
            {d.completedWorkers}/{d.workerCount} workers
          </div>
        </div>
      )}

      <div style={{ fontSize: 10, color: "#78716c" }}>
        {d.source} | {d.subGoalCount} sub-goals
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: statusColor }} />
    </div>
  );
});

GoalNode.displayName = "GoalNode";
