/**
 * Dagre-based auto-layout for the Captain canvas.
 * Positions nodes in a hierarchical directed graph.
 */

import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

export type LayoutDirection = "TB" | "LR" | "BT" | "RL";

interface LayoutOptions {
  direction?: LayoutDirection;
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

/**
 * Apply dagre layout to a set of nodes and edges.
 * Returns new nodes with updated positions.
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  const {
    direction = "LR",
    nodeWidth = 200,
    nodeHeight = 80,
    rankSep = 80,
    nodeSep = 40,
  } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });

  for (const node of nodes) {
    const width = (node.measured?.width ?? node.width ?? nodeWidth) as number;
    const height = (node.measured?.height ?? node.height ?? nodeHeight) as number;
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;

    const width = (node.measured?.width ?? node.width ?? nodeWidth) as number;
    const height = (node.measured?.height ?? node.height ?? nodeHeight) as number;

    return {
      ...node,
      position: {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
      },
    };
  });
}

/**
 * Mind Map layout — centered on identity node, organic spread.
 */
export function applyMindMapLayout(nodes: Node[], edges: Edge[]): Node[] {
  return applyDagreLayout(nodes, edges, {
    direction: "LR",
    rankSep: 120,
    nodeSep: 50,
  });
}

/**
 * Timeline layout — chronological left-to-right.
 */
export function applyTimelineLayout(nodes: Node[], edges: Edge[]): Node[] {
  return applyDagreLayout(nodes, edges, {
    direction: "LR",
    rankSep: 100,
    nodeSep: 30,
  });
}

/**
 * Goal Tree layout — hierarchical top-down.
 */
export function applyGoalTreeLayout(nodes: Node[], edges: Edge[]): Node[] {
  return applyDagreLayout(nodes, edges, {
    direction: "TB",
    rankSep: 80,
    nodeSep: 60,
  });
}

/**
 * Swarm layout — radial arrangement around center.
 * Identity in center, workers orbiting.
 */
export function applySwarmLayout(nodes: Node[], _edges: Edge[]): Node[] {
  const identityNode = nodes.find((n) => n.type === "identity");
  const otherNodes = nodes.filter((n) => n.type !== "identity");

  const centerX = 400;
  const centerY = 300;
  const radius = 250;

  const result: Node[] = [];

  if (identityNode) {
    result.push({
      ...identityNode,
      position: { x: centerX - 110, y: centerY - 50 },
    });
  }

  otherNodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / otherNodes.length;
    const r = radius + (node.type === "goal" ? 0 : 80);
    result.push({
      ...node,
      position: {
        x: centerX + Math.cos(angle) * r - 100,
        y: centerY + Math.sin(angle) * r - 40,
      },
    });
  });

  return result;
}
