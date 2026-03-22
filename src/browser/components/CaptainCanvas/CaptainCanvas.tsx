/**
 * CaptainCanvas — Infinite Canvas Thinking Interface
 *
 * Renders the Captain's cognitive process as an interactive node graph
 * using React Flow. Every thought, goal, worker, and decision is a visible
 * node that you can zoom into, inspect, and interact with.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  BackgroundVariant,
  Panel,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { captainNodeTypes } from "./nodes";
import { captainEdgeTypes } from "./edges/AnimatedEdge";
import { NodeDetailPanel } from "./panels/NodeDetailPanel";
import {
  applyMindMapLayout,
  applyTimelineLayout,
  applyGoalTreeLayout,
  applySwarmLayout,
} from "./layouts/dagreLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LayoutMode = "mindMap" | "timeline" | "goalTree" | "swarm";

interface CaptainCanvasProps {
  /** Initial identity data for the IdentityNode. */
  identity?: {
    name: string;
    traits: string[];
    values: string[];
    communicationStyle: string;
  };
  /** Whether the cognitive loop is running. */
  isRunning?: boolean;
  /** Current tick count. */
  tickCount?: number;
  /** Callback to enable the captain. */
  onEnable?: () => void;
  /** Callback to disable the captain. */
  onDisable?: () => void;
}

// ---------------------------------------------------------------------------
// Default nodes for initial render
// ---------------------------------------------------------------------------

function createInitialNodes(props: CaptainCanvasProps): Node[] {
  const { identity, isRunning = false, tickCount = 0 } = props;

  if (!identity) return [];

  return [
    {
      id: "identity",
      type: "identity",
      position: { x: 0, y: 0 },
      data: {
        name: identity.name,
        traits: identity.traits,
        values: identity.values,
        communicationStyle: identity.communicationStyle,
        isRunning,
        tickCount,
      },
      draggable: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Layout Application
// ---------------------------------------------------------------------------

const LAYOUT_FN: Record<LayoutMode, (nodes: Node[], edges: Edge[]) => Node[]> = {
  mindMap: applyMindMapLayout,
  timeline: applyTimelineLayout,
  goalTree: applyGoalTreeLayout,
  swarm: applySwarmLayout,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CaptainCanvas(props: CaptainCanvasProps) {
  const initialNodes = useMemo(() => createInitialNodes(props), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, _setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [layout, setLayout] = useState<LayoutMode>("mindMap");

  // Node click handler — open detail panel
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  // Close detail panel
  const onCloseDetail = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Apply layout
  const onApplyLayout = useCallback(
    (mode: LayoutMode) => {
      setLayout(mode);
      const layoutFn = LAYOUT_FN[mode];
      setNodes((currentNodes) => layoutFn(currentNodes, edges));
    },
    [edges, setNodes],
  );

  // MiniMap node color
  const miniMapNodeColor = useCallback((node: Node) => {
    switch (node.type) {
      case "identity": return "#8b5cf6";
      case "cognitiveTick": return "#3b82f6";
      case "goal": return "#eab308";
      case "worker": return "#22c55e";
      case "event": return "#a855f7";
      case "action": return "#f97316";
      case "memory": return "#14b8a6";
      case "message": return "#6366f1";
      default: return "#475569";
    }
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#020617" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={captainNodeTypes}
        edgeTypes={captainEdgeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: "animated",
          animated: true,
          style: { stroke: "#334155" },
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        <Controls
          showInteractive={false}
          style={{ background: "#1e293b", borderColor: "#334155" }}
        />
        <MiniMap
          nodeColor={miniMapNodeColor}
          style={{
            background: "#0f172a",
            border: "1px solid #1e293b",
          }}
          maskColor="rgba(0, 0, 0, 0.7)"
        />

        {/* Layout Switcher */}
        <Panel position="top-right">
          <div
            style={{
              display: "flex",
              gap: 4,
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              padding: 4,
            }}
          >
            {(["mindMap", "timeline", "goalTree", "swarm"] as LayoutMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onApplyLayout(mode)}
                style={{
                  background: layout === mode ? "#334155" : "transparent",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 10px",
                  color: layout === mode ? "#e2e8f0" : "#64748b",
                  fontSize: 11,
                  cursor: "pointer",
                  fontWeight: layout === mode ? 600 : 400,
                }}
              >
                {mode === "mindMap" ? "Mind Map" :
                 mode === "timeline" ? "Timeline" :
                 mode === "goalTree" ? "Goal Tree" : "Swarm"}
              </button>
            ))}
          </div>
        </Panel>

        {/* Captain Status */}
        <Panel position="top-left">
          <div
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              padding: "6px 12px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#94a3b8",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: props.isRunning ? "#22c55e" : "#ef4444",
              }}
            />
            <span>
              {props.isRunning ? `Thinking — Tick #${props.tickCount ?? 0}` : "Paused"}
            </span>
            <span style={{ color: "#475569" }}>|</span>
            <span>{nodes.length} nodes</span>
            <span style={{ color: "#475569" }}>|</span>
            <button
              onClick={() => props.isRunning ? props.onDisable?.() : props.onEnable?.()}
              style={{
                background: props.isRunning ? "#7f1d1d" : "#14532d",
                border: `1px solid ${props.isRunning ? "#ef4444" : "#22c55e"}`,
                borderRadius: 6,
                padding: "2px 10px",
                color: props.isRunning ? "#fca5a5" : "#86efac",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {props.isRunning ? "Stop" : "Start Captain"}
            </button>
          </div>
        </Panel>
      </ReactFlow>

      {/* Detail Panel */}
      <NodeDetailPanel node={selectedNode} onClose={onCloseDetail} />
    </div>
  );
}
