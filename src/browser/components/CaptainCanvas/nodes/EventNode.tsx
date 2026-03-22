import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface EventData {
  eventType: string;
  source: string;
  content: string;
}

const EVENT_COLORS: Record<string, string> = {
  user_message: "#8b5cf6",
  worker_complete: "#22c55e",
  worker_failed: "#ef4444",
  worker_progress: "#3b82f6",
  time_trigger: "#f59e0b",
  external_event: "#06b6d4",
  goal_stale: "#f97316",
  voice_transcript: "#ec4899",
};

export const EventNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as EventData;
  const color = EVENT_COLORS[d.eventType] ?? "#6b7280";

  return (
    <div
      style={{
        background: `${color}15`,
        border: `1.5px solid ${color}`,
        borderRadius: 20,
        padding: "6px 12px",
        maxWidth: 200,
        color: "#e2e8f0",
        fontSize: 11,
      }}
    >
      <div style={{ fontWeight: 600, color, fontSize: 9, textTransform: "uppercase", marginBottom: 2 }}>
        {d.eventType.replace(/_/g, " ")}
      </div>
      <div style={{ color: "#cbd5e1", lineHeight: 1.3, maxHeight: 36, overflow: "hidden" }}>
        {d.content}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: color, width: 6, height: 6 }} />
    </div>
  );
});

EventNode.displayName = "EventNode";
