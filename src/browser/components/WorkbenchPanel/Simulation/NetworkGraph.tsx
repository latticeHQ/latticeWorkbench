/**
 * Force-directed network graph showing agent interactions.
 *
 * MiroFish-inspired: animated flow particles on edges, directional arrows,
 * pulsing active nodes, rich tooltips with stats, cluster grouping,
 * edge thickness by weight, node rings showing activity level.
 *
 * Uses D3.js forceSimulation with SVG rendering for full DOM interactivity.
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import * as d3 from "d3";
import { RefreshCw, Maximize2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  size: number;
  /** Number of actions this agent has taken */
  actionCount?: number;
  /** Agent's current sentiment (-1 to 1) */
  sentiment?: number;
  /** Platform the agent is most active on */
  platform?: string;
  /** Last action type */
  lastAction?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
  /** Timestamp of interaction */
  timestamp?: number;
}

interface NetworkGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (nodeId: string) => void;
  className?: string;
  showEdgeLabels?: boolean;
  /** Enable animated flow particles on edges */
  animated?: boolean;
}

// ---------------------------------------------------------------------------
// Color scheme by entity type
// ---------------------------------------------------------------------------

const NODE_COLORS: Record<string, string> = {
  tier1: "#a78bfa",
  tier2: "#60a5fa",
  tier3: "#34d399",
  tier4: "#f59e0b",
  influencer: "#f472b6",
  customer: "#22d3ee",
  executive: "#a78bfa",
  engineer: "#60a5fa",
  analyst: "#34d399",
  journalist: "#fb923c",
  skeptic: "#ef4444",
  default: "#94a3b8",
};

const EDGE_COLORS: Record<string, string> = {
  reply: "#818cf8",
  like: "#34d399",
  mention: "#60a5fa",
  share: "#f472b6",
  upvote: "#22c55e",
  downvote: "#ef4444",
  comment: "#fbbf24",
  create_post: "#a78bfa",
  follow: "#22d3ee",
  default: "#475569",
};

const EDGE_LABELS: Record<string, string> = {
  reply: "replied",
  like: "liked",
  mention: "mentioned",
  share: "shared",
  upvote: "↑",
  downvote: "↓",
  comment: "commented",
  create_post: "posted",
  follow: "followed",
  default: "→",
};

function nodeColor(type: string): string {
  return NODE_COLORS[type.toLowerCase()] ?? NODE_COLORS.default;
}

function edgeColor(type: string): string {
  return EDGE_COLORS[type.toLowerCase()] ?? EDGE_COLORS.default;
}

function edgeLabel(type: string): string {
  return EDGE_LABELS[type.toLowerCase()] ?? EDGE_LABELS.default;
}

function nodeRadius(size: number): number {
  return Math.max(5, Math.min(size * 2.5, 22));
}

// ---------------------------------------------------------------------------
// Simulation node/link types for D3 (mutable copies)
// ---------------------------------------------------------------------------

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  size: number;
  actionCount: number;
  sentiment: number;
  platform: string;
  lastAction: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  weight: number;
  type: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const NetworkGraph: React.FC<NetworkGraphProps> = ({
  nodes,
  edges,
  onNodeClick,
  className = "",
  showEdgeLabels = false,
  animated = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const animFrameRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [, setSelectedNode] = useState<string | null>(null);

  // Entity type legend data
  const nodeTypes = useMemo(() => {
    const types = new Set(nodes.map((n) => n.type));
    return Array.from(types);
  }, [nodes]);

  // Graph stats
  const stats = useMemo(() => {
    const activeNodes = nodes.filter((n) => (n.actionCount ?? 0) > 0).length;
    const totalInteractions = edges.reduce((sum, e) => sum + e.weight, 0);
    return { activeNodes, totalInteractions };
  }, [nodes, edges]);

  // Observe container size
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Main D3 effect
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || nodes.length === 0) return;

    const { width, height } = dimensions;

    // Clear previous content
    const root = d3.select(svg);
    root.selectAll("*").remove();
    cancelAnimationFrame(animFrameRef.current);

    // Stop any previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    // Create mutable copies
    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      size: n.size,
      actionCount: n.actionCount ?? 0,
      sentiment: n.sentiment ?? 0,
      platform: n.platform ?? "",
      lastAction: n.lastAction ?? "",
    }));

    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = edges
      .filter((e) => nodeById.has(e.source) && nodeById.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        type: e.type,
      }));

    // --------------- Container group with zoom ---------------
    const g = root.append("g").attr("class", "graph-root");

    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 6])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    root.call(zoomBehavior);

    // Auto-fit if many nodes
    const initialScale = nodes.length > 50 ? 0.7 : nodes.length > 20 ? 0.85 : 1;
    root.call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(width * (1 - initialScale) / 2, height * (1 - initialScale) / 2).scale(initialScale),
    );

    // --------------- Defs ---------------
    const defs = root.append("defs");

    // Glow filter for hovered/selected nodes
    const glowFilter = defs
      .append("filter")
      .attr("id", "node-glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    glowFilter.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
    const feMerge = glowFilter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "blur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Pulse animation filter for active nodes
    const pulseFilter = defs
      .append("filter")
      .attr("id", "node-pulse")
      .attr("x", "-100%")
      .attr("y", "-100%")
      .attr("width", "300%")
      .attr("height", "300%");
    pulseFilter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
    const pulseMerge = pulseFilter.append("feMerge");
    pulseMerge.append("feMergeNode").attr("in", "blur");
    pulseMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // Arrow markers for directed edges
    const markerTypes = [...new Set(simLinks.map((l) => l.type))];
    markerTypes.forEach((type) => {
      defs
        .append("marker")
        .attr("id", `arrow-${type}`)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 20)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("fill", edgeColor(type))
        .attr("fill-opacity", 0.6)
        .attr("d", "M0,-4L10,0L0,4Z");
    });

    // Gradient for edge flow animation
    if (animated) {
      simLinks.forEach((_, i) => {
        const grad = defs
          .append("linearGradient")
          .attr("id", `flow-grad-${i}`)
          .attr("gradientUnits", "userSpaceOnUse");
        grad.append("stop").attr("offset", "0%").attr("stop-color", "transparent");
        grad.append("stop").attr("offset", "40%").attr("stop-color", "transparent");
        grad.append("stop").attr("class", `flow-stop-${i}`).attr("offset", "50%").attr("stop-opacity", 0.8);
        grad.append("stop").attr("offset", "60%").attr("stop-color", "transparent");
        grad.append("stop").attr("offset", "100%").attr("stop-color", "transparent");
      });
    }

    // --------------- Edges ---------------
    const linkGroup = g.append("g").attr("class", "links");

    const linkSel = linkGroup
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", (d) => edgeColor(d.type))
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", (d) => Math.max(0.8, Math.min(d.weight * 0.8, 4)))
      .attr("marker-end", (d) => `url(#arrow-${d.type})`);

    // Flow particles layer (animated dots traveling along edges)
    let flowGroup: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    let flowParticles: d3.Selection<SVGCircleElement, { link: SimLink; progress: number; speed: number }, SVGGElement, unknown> | null = null;

    if (animated && simLinks.length > 0) {
      flowGroup = g.append("g").attr("class", "flow-particles");

      // Create particles for edges with weight > 0
      const particleData = simLinks
        .filter((l) => l.weight > 0)
        .flatMap((link, _i) => {
          const count = Math.min(Math.ceil(link.weight * 0.5), 3);
          return Array.from({ length: count }, (_, j) => ({
            link,
            progress: j / count,
            speed: 0.003 + Math.random() * 0.004,
          }));
        });

      flowParticles = flowGroup
        .selectAll<SVGCircleElement, (typeof particleData)[0]>("circle")
        .data(particleData)
        .join("circle")
        .attr("r", 2)
        .attr("fill", (d) => edgeColor(d.link.type))
        .attr("opacity", 0.7);
    }

    // Edge labels (interaction type)
    let edgeLabelSel: d3.Selection<SVGTextElement, SimLink, SVGGElement, unknown> | null = null;
    if (showEdgeLabels) {
      edgeLabelSel = linkGroup
        .selectAll<SVGTextElement, SimLink>("text")
        .data(simLinks.filter((l) => l.weight > 1))
        .join("text")
        .attr("font-size", "7px")
        .attr("fill", "#64748b")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("pointer-events", "none")
        .text((d) => edgeLabel(d.type));
    }

    // --------------- Nodes ---------------
    const nodeGroup = g.append("g").attr("class", "nodes");

    const nodeSel = nodeGroup
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(simNodes, (d) => (d as SimNode).id)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer");

    // Outer activity ring (shows how active the agent is)
    nodeSel
      .append("circle")
      .attr("class", "activity-ring")
      .attr("r", (d) => nodeRadius(d.size) + 4)
      .attr("fill", "none")
      .attr("stroke", (d) => nodeColor(d.type))
      .attr("stroke-opacity", (d) => d.actionCount > 0 ? 0.3 : 0)
      .attr("stroke-width", (d) => Math.min(d.actionCount * 0.3, 2.5))
      .attr("stroke-dasharray", (d) => {
        const r = nodeRadius(d.size) + 4;
        const circumference = 2 * Math.PI * r;
        const filled = Math.min(d.actionCount / 10, 1) * circumference;
        return `${filled} ${circumference - filled}`;
      });

    // Node circles
    nodeSel
      .append("circle")
      .attr("class", "node-circle")
      .attr("r", (d) => nodeRadius(d.size))
      .attr("fill", (d) => nodeColor(d.type))
      .attr("stroke", (d) => {
        // Sentiment ring: green for positive, red for negative
        if (d.sentiment > 0.3) return "#22c55e";
        if (d.sentiment < -0.3) return "#ef4444";
        return "rgba(0,0,0,0.4)";
      })
      .attr("stroke-width", (d) => Math.abs(d.sentiment) > 0.3 ? 2 : 1)
      .attr("opacity", (d) => d.actionCount > 0 ? 1 : 0.6);

    // Node initials (inside the circle for larger nodes)
    nodeSel
      .append("text")
      .attr("class", "node-initial")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", (d) => `${Math.max(7, nodeRadius(d.size) * 0.7)}px`)
      .attr("font-weight", "700")
      .attr("fill", "rgba(255,255,255,0.9)")
      .attr("pointer-events", "none")
      .text((d) => {
        if (nodeRadius(d.size) < 8) return "";
        const parts = d.label.split(/[\s_]+/);
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return d.label.slice(0, 2).toUpperCase();
      });

    // Always-visible labels for larger nodes
    nodeSel
      .append("text")
      .attr("class", "node-label-always")
      .attr("dy", (d) => nodeRadius(d.size) + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", "8px")
      .attr("fill", "rgba(226, 232, 240, 0.7)")
      .attr("pointer-events", "none")
      .text((d) => {
        if (nodeRadius(d.size) < 7) return "";
        // Truncate long names
        const name = d.label.replace(/^stat_/, "");
        return name.length > 14 ? name.slice(0, 12) + "…" : name;
      });

    // Hover-only labels
    nodeSel
      .append("text")
      .attr("class", "node-label-hover")
      .attr("dy", (d) => nodeRadius(d.size) + 14)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", "#f8fafc")
      .attr("pointer-events", "none")
      .attr("opacity", 0)
      .text((d) => d.label.replace(/^stat_/, ""));

    // Action count badge
    nodeSel
      .filter((d) => d.actionCount > 0)
      .append("circle")
      .attr("cx", (d) => nodeRadius(d.size) * 0.7)
      .attr("cy", (d) => -nodeRadius(d.size) * 0.7)
      .attr("r", 6)
      .attr("fill", "#3b82f6")
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 1);

    nodeSel
      .filter((d) => d.actionCount > 0)
      .append("text")
      .attr("x", (d) => nodeRadius(d.size) * 0.7)
      .attr("y", (d) => -nodeRadius(d.size) * 0.7)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "7px")
      .attr("font-weight", "700")
      .attr("fill", "#fff")
      .attr("pointer-events", "none")
      .text((d) => d.actionCount > 99 ? "99+" : String(d.actionCount));

    // --------------- Tooltip ---------------
    const tooltip = d3
      .select(containerRef.current)
      .append("div")
      .attr("class", "network-graph-tooltip")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("background", "rgba(15, 23, 42, 0.95)")
      .style("backdrop-filter", "blur(12px)")
      .style("border", "1px solid rgba(100, 116, 139, 0.3)")
      .style("border-radius", "8px")
      .style("padding", "10px 14px")
      .style("font-size", "11px")
      .style("color", "#e2e8f0")
      .style("z-index", "50")
      .style("display", "none")
      .style("min-width", "160px")
      .style("box-shadow", "0 8px 32px rgba(0,0,0,0.4)");

    // --------------- Hover interactions ---------------
    nodeSel
      .on("mouseenter", function (_event, d) {
        // Glow effect
        d3.select(this).select(".node-circle")
          .attr("filter", "url(#node-glow)")
          .attr("stroke", "#fff")
          .attr("stroke-width", 2.5);

        // Scale up slightly
        d3.select(this)
          .transition()
          .duration(150)
          .attr("transform", `translate(${d.x},${d.y}) scale(1.15)`);

        // Show hover label, hide always label
        d3.select(this).select(".node-label-hover").attr("opacity", 1);
        d3.select(this).select(".node-label-always").attr("opacity", 0);

        // Highlight connected edges & show flow direction
        const connectedNodes = new Set<string>();
        connectedNodes.add(d.id);

        linkSel
          .attr("stroke-opacity", (l) => {
            const src = (l.source as SimNode).id ?? l.source;
            const tgt = (l.target as SimNode).id ?? l.target;
            const connected = src === d.id || tgt === d.id;
            if (connected) {
              connectedNodes.add(src);
              connectedNodes.add(tgt);
            }
            return connected ? 0.85 : 0.06;
          })
          .attr("stroke-width", (l) => {
            const src = (l.source as SimNode).id ?? l.source;
            const tgt = (l.target as SimNode).id ?? l.target;
            return src === d.id || tgt === d.id
              ? Math.max(2, Math.min(l.weight, 5))
              : Math.max(0.5, Math.min(l.weight * 0.6, 3));
          });

        // Fade non-connected nodes
        nodeSel.each(function (n) {
          const isConnected = connectedNodes.has(n.id);
          d3.select(this).select(".node-circle").attr("opacity", isConnected ? 1 : 0.15);
          d3.select(this).select(".activity-ring").attr("opacity", isConnected ? 1 : 0.1);
          d3.select(this).select(".node-initial").attr("opacity", isConnected ? 1 : 0.15);
          d3.select(this).select(".node-label-always").attr("opacity", isConnected && n.id !== d.id ? 0.7 : 0);
        });

        // Rich tooltip
        const connections = simLinks.filter((l) => {
          const src = (l.source as SimNode).id ?? l.source;
          const tgt = (l.target as SimNode).id ?? l.target;
          return src === d.id || tgt === d.id;
        });
        const outgoing = connections.filter((l) => ((l.source as SimNode).id ?? l.source) === d.id);
        const incoming = connections.filter((l) => ((l.target as SimNode).id ?? l.target) === d.id);

        const sentimentBar = d.sentiment !== 0
          ? `<div style="margin-top:4px;display:flex;align-items:center;gap:6px">
               <span style="color:#64748b;font-size:10px">Sentiment</span>
               <div style="flex:1;height:4px;background:#1e293b;border-radius:2px;overflow:hidden">
                 <div style="width:${Math.abs(d.sentiment) * 100}%;height:100%;background:${d.sentiment > 0 ? '#22c55e' : '#ef4444'};border-radius:2px"></div>
               </div>
               <span style="font-size:10px;color:${d.sentiment > 0 ? '#22c55e' : '#ef4444'}">${d.sentiment > 0 ? '+' : ''}${d.sentiment.toFixed(2)}</span>
             </div>`
          : "";

        tooltip
          .style("display", "block")
          .html(
            `<div style="font-weight:700;font-size:13px;margin-bottom:4px">${d.label.replace(/^stat_/, "")}</div>` +
            `<div style="display:flex;gap:8px;margin-bottom:6px">` +
            `<span style="color:#94a3b8;text-transform:capitalize;font-size:10px;background:rgba(100,116,139,0.15);padding:1px 6px;border-radius:3px">${d.type}</span>` +
            (d.platform ? `<span style="color:#60a5fa;font-size:10px;background:rgba(96,165,250,0.1);padding:1px 6px;border-radius:3px">${d.platform}</span>` : "") +
            `</div>` +
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:10px;margin-bottom:4px">` +
            `<div><span style="color:#64748b">Actions</span> <span style="font-weight:600">${d.actionCount}</span></div>` +
            `<div><span style="color:#64748b">Connections</span> <span style="font-weight:600">${connections.length}</span></div>` +
            `<div><span style="color:#64748b">Outgoing</span> <span style="font-weight:600;color:#22c55e">${outgoing.length}</span></div>` +
            `<div><span style="color:#64748b">Incoming</span> <span style="font-weight:600;color:#3b82f6">${incoming.length}</span></div>` +
            `</div>` +
            (d.lastAction ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">Last: <span style="color:#e2e8f0">${d.lastAction}</span></div>` : "") +
            sentimentBar,
          );
      })
      .on("mousemove", function (event) {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        const x = event.clientX - containerRect.left;
        const y = event.clientY - containerRect.top;
        // Keep tooltip inside container
        const flipX = x > containerRect.width * 0.65;
        const flipY = y > containerRect.height * 0.7;
        tooltip
          .style("left", flipX ? `${x - 180}px` : `${x + 16}px`)
          .style("top", flipY ? `${y - 100}px` : `${y - 10}px`);
      })
      .on("mouseleave", function (_event, d) {
        const strokeColor = d.sentiment > 0.3 ? "#22c55e" : d.sentiment < -0.3 ? "#ef4444" : "rgba(0,0,0,0.4)";
        const strokeWidth = Math.abs(d.sentiment) > 0.3 ? 2 : 1;
        d3.select(this).select(".node-circle")
          .attr("filter", null)
          .attr("stroke", strokeColor)
          .attr("stroke-width", strokeWidth);

        // Reset scale
        d3.select(this)
          .transition()
          .duration(150)
          .attr("transform", `translate(${d.x},${d.y})`);

        d3.select(this).select(".node-label-hover").attr("opacity", 0);
        d3.select(this).select(".node-label-always").attr("opacity", 1);

        linkSel
          .attr("stroke-opacity", 0.35)
          .attr("stroke-width", (l) => Math.max(0.8, Math.min(l.weight * 0.8, 4)));

        nodeSel.each(function (n) {
          d3.select(this).select(".node-circle").attr("opacity", n.actionCount > 0 ? 1 : 0.6);
          d3.select(this).select(".activity-ring").attr("opacity", 1);
          d3.select(this).select(".node-initial").attr("opacity", 1);
          d3.select(this).select(".node-label-always").attr("opacity", 1);
        });

        tooltip.style("display", "none");
      });

    // --------------- Click ---------------
    nodeSel.on("click", (_event, d) => {
      setSelectedNode((prev) => (prev === d.id ? null : d.id));
      onNodeClick?.(d.id);
    });

    // --------------- Drag ---------------
    const dragBehavior = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeSel.call(dragBehavior);

    // --------------- Force simulation ---------------
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => 60 + (1 / Math.max(d.weight, 0.1)) * 30)
          .strength((d) => Math.min(d.weight * 0.12, 0.7)),
      )
      .force("charge", d3.forceManyBody().strength(-180).distanceMax(400))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force(
        "collide",
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d.size) + 6).strength(0.8),
      )
      // Group nodes by type
      .force("x", d3.forceX<SimNode>((d) => {
        const types = Array.from(new Set(simNodes.map((n) => n.type)));
        const idx = types.indexOf(d.type);
        const angle = (idx / types.length) * Math.PI * 2;
        return width / 2 + Math.cos(angle) * Math.min(width, height) * 0.2;
      }).strength(0.03))
      .force("y", d3.forceY<SimNode>((d) => {
        const types = Array.from(new Set(simNodes.map((n) => n.type)));
        const idx = types.indexOf(d.type);
        const angle = (idx / types.length) * Math.PI * 2;
        return height / 2 + Math.sin(angle) * Math.min(width, height) * 0.2;
      }).strength(0.03))
      .alpha(1)
      .alphaDecay(0.018);

    simulationRef.current = simulation;

    // Tick handler
    simulation.on("tick", () => {
      linkSel
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => (d.target as SimNode).x!)
        .attr("y2", (d) => (d.target as SimNode).y!);

      if (edgeLabelSel) {
        edgeLabelSel
          .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
          .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);
      }

      nodeSel.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // --------------- Animated flow particles ---------------
    if (animated && flowParticles) {
      let lastTime = performance.now();
      const animate = (time: number) => {
        const dt = Math.min(time - lastTime, 50); // cap delta
        lastTime = time;

        flowParticles!.each(function (d) {
          d.progress = (d.progress + d.speed * dt) % 1;
          const src = d.link.source as SimNode;
          const tgt = d.link.target as SimNode;
          if (src.x != null && src.y != null && tgt.x != null && tgt.y != null) {
            const x = src.x + (tgt.x - src.x) * d.progress;
            const y = src.y + (tgt.y - src.y) * d.progress;
            d3.select(this).attr("cx", x).attr("cy", y);
          }
        });

        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);
    }

    // Cleanup
    return () => {
      simulation.stop();
      simulationRef.current = null;
      cancelAnimationFrame(animFrameRef.current);
      tooltip.remove();
    };
  }, [nodes, edges, dimensions, showEdgeLabels, onNodeClick, refreshKey, animated]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // --------------- Empty state ---------------
  if (nodes.length === 0 && edges.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full text-muted-foreground/40 ${className}`}>
        <div className="text-center">
          <Maximize2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-xs">Run a simulation to see the agent network</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      {/* Top-right controls */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground bg-background/80 backdrop-blur-sm border border-border rounded px-2 py-1 select-none">
          {nodes.length} nodes · {edges.length} edges
          {stats.activeNodes > 0 && (
            <span className="text-emerald-400 ml-1">· {stats.activeNodes} active</span>
          )}
        </span>
        <button
          onClick={handleRefresh}
          className="p-1.5 bg-background/80 border border-border rounded hover:bg-muted transition-colors"
          title="Refresh layout"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-x-3 gap-y-1 bg-background/80 backdrop-blur-sm rounded px-2 py-1.5 border border-border/50 max-w-[80%]">
        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider mr-1">
          Agents
        </span>
        {nodeTypes.map((type) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full inline-block flex-shrink-0"
              style={{ backgroundColor: nodeColor(type) }}
            />
            <span className="text-[9px] text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
        {edges.length > 0 && (
          <>
            <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider ml-2 mr-1">
              Flow
            </span>
            {[...new Set(edges.map((e) => e.type))].slice(0, 5).map((type) => (
              <div key={type} className="flex items-center gap-1">
                <span
                  className="w-3 h-0.5 inline-block flex-shrink-0 rounded"
                  style={{ backgroundColor: edgeColor(type) }}
                />
                <span className="text-[9px] text-muted-foreground capitalize">{type}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Interaction stats overlay */}
      {stats.totalInteractions > 0 && (
        <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm border border-border/50 rounded px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground">{stats.totalInteractions}</span> interactions
          </div>
        </div>
      )}

      {/* SVG */}
      <svg
        ref={svgRef}
        width={dimensions.width}
        height={dimensions.height}
        className="block"
        style={{ background: "transparent" }}
      />
    </div>
  );
};
