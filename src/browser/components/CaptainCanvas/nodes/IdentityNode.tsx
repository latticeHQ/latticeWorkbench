import { memo } from "react";
import { type NodeProps } from "@xyflow/react";

interface IdentityData {
  name: string;
  traits: string[];
  values: string[];
  communicationStyle: string;
  isRunning: boolean;
  tickCount: number;
}

export const IdentityNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as IdentityData;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
        border: `2px solid ${d.isRunning ? "#a78bfa" : "#4c1d95"}`,
        borderRadius: 16,
        padding: "14px 18px",
        minWidth: 220,
        color: "#e2e8f0",
        fontSize: 12,
        boxShadow: d.isRunning ? "0 0 20px rgba(139, 92, 246, 0.3)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: d.isRunning
              ? "linear-gradient(135deg, #7c3aed, #a78bfa)"
              : "#4c1d95",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 700,
          }}
        >
          {d.name.charAt(0)}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#c4b5fd" }}>
            {d.name}
          </div>
          <div style={{ fontSize: 10, color: d.isRunning ? "#86efac" : "#ef4444" }}>
            {d.isRunning ? `Thinking (tick #${d.tickCount})` : "Paused"}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: "#818cf8", textTransform: "uppercase", marginBottom: 2 }}>
          Traits
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {d.traits.map((trait) => (
            <span
              key={trait}
              style={{
                background: "#312e81",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 10,
                color: "#c4b5fd",
              }}
            >
              {trait}
            </span>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 9, color: "#818cf8", textTransform: "uppercase", marginBottom: 2 }}>
          Values
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {d.values.map((value) => (
            <span
              key={value}
              style={{
                background: "#1e1b4b",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 10,
                color: "#a5b4fc",
              }}
            >
              {value}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});

IdentityNode.displayName = "IdentityNode";
