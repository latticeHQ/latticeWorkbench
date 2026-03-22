import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface WorkerData {
  agentName: string;
  taskDescription: string;
  status: string;
  type: string;
  result?: string;
}

const STATUS_CONFIG: Record<string, { color: string; pulse: boolean }> = {
  pending: { color: "#94a3b8", pulse: false },
  running: { color: "#22c55e", pulse: true },
  completed: { color: "#3b82f6", pulse: false },
  failed: { color: "#ef4444", pulse: false },
  timeout: { color: "#f59e0b", pulse: false },
};

export const WorkerNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as WorkerData;
  const config = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.pending;

  return (
    <div
      style={{
        background: "#0f172a",
        border: `2px solid ${config.color}`,
        borderRadius: 10,
        padding: "8px 12px",
        minWidth: 150,
        maxWidth: 220,
        color: "#e2e8f0",
        fontSize: 11,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: config.color }} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: config.color,
            animation: config.pulse ? "pulse 1.5s ease-in-out infinite" : undefined,
          }}
        />
        <span style={{ fontWeight: 600, color: "#a5f3fc" }}>{d.agentName}</span>
        <span
          style={{
            fontSize: 9,
            color: "#64748b",
            background: "#1e293b",
            padding: "1px 4px",
            borderRadius: 3,
          }}
        >
          {d.type}
        </span>
      </div>

      <div
        style={{
          color: "#94a3b8",
          lineHeight: 1.3,
          maxHeight: 40,
          overflow: "hidden",
        }}
      >
        {d.taskDescription}
      </div>

      {d.result && d.status === "completed" && (
        <div
          style={{
            marginTop: 4,
            padding: "4px 6px",
            background: "#1e293b",
            borderRadius: 4,
            fontSize: 10,
            color: "#86efac",
            maxHeight: 30,
            overflow: "hidden",
          }}
        >
          {d.result}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: config.color }} />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
});

WorkerNode.displayName = "WorkerNode";
