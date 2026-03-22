import { memo } from "react";
import type { Node } from "@xyflow/react";

interface NodeDetailPanelProps {
  node: Node | null;
  onClose: () => void;
}

export const NodeDetailPanel = memo(({ node, onClose }: NodeDetailPanelProps) => {
  if (!node) return null;

  const data = node.data as Record<string, unknown>;

  return (
    <div
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: "#0f172a",
        borderLeft: "1px solid #1e293b",
        padding: 16,
        overflow: "auto",
        zIndex: 10,
        color: "#e2e8f0",
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#94a3b8", textTransform: "uppercase" }}>
          {String(node.type ?? "node").replace(/([A-Z])/g, " $1")}
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#94a3b8",
            padding: "4px 8px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {Object.entries(data).map(([key, value]) => (
          <div key={key}>
            <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", marginBottom: 2 }}>
              {key.replace(/([A-Z])/g, " $1")}
            </div>
            <div
              style={{
                background: "#1e293b",
                padding: "8px 10px",
                borderRadius: 6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.5,
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "")}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, fontSize: 10, color: "#475569" }}>
        Node ID: {node.id}
      </div>
    </div>
  );
});

NodeDetailPanel.displayName = "NodeDetailPanel";
