import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface CognitiveTickData {
  tickNumber: number;
  eventsCount: number;
  skipped: boolean;
  reflection?: string;
}

export const CognitiveTickNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as CognitiveTickData;
  const bgColor = d.skipped ? "#1e293b" : "#1e3a5f";
  const borderColor = d.skipped ? "#334155" : "#3b82f6";

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${borderColor}`,
        borderRadius: 12,
        padding: "10px 14px",
        minWidth: 160,
        color: "#e2e8f0",
        fontSize: 12,
        fontFamily: "monospace",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: borderColor }} />

      <div style={{ fontWeight: 700, marginBottom: 4, color: "#93c5fd" }}>
        Tick #{d.tickNumber}
      </div>

      {d.skipped ? (
        <div style={{ color: "#64748b", fontStyle: "italic" }}>Idle — no events</div>
      ) : (
        <>
          <div style={{ color: "#94a3b8" }}>
            {d.eventsCount} event{d.eventsCount !== 1 ? "s" : ""} perceived
          </div>
          {d.reflection && (
            <div
              style={{
                marginTop: 6,
                padding: "6px 8px",
                background: "#0f172a",
                borderRadius: 6,
                color: "#cbd5e1",
                fontSize: 11,
                maxHeight: 60,
                overflow: "hidden",
                lineHeight: 1.4,
              }}
            >
              {d.reflection}
            </div>
          )}
        </>
      )}

      <Handle type="source" position={Position.Right} style={{ background: borderColor }} />
    </div>
  );
});

CognitiveTickNode.displayName = "CognitiveTickNode";
