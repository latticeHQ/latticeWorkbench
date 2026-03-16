/**
 * Force-directed network graph showing agent interactions.
 *
 * Uses D3.js forceSimulation with SVG rendering for full DOM interactivity.
 * Nodes colored by tier/role, edges by interaction type.
 * Supports zoom, pan, drag, hover tooltips, and responsive resizing.
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
}

interface NetworkGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (nodeId: string) => void;
  className?: string;
  showEdgeLabels?: boolean;
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
  default: "#94a3b8",
};

const EDGE_COLORS: Record<string, string> = {
  reply: "#64748b",
  like: "#34d399",
  mention: "#60a5fa",
  share: "#f472b6",
  default: "#475569",
};

function nodeColor(type: string): string {
  return NODE_COLORS[type] ?? NODE_COLORS.default;
}

function edgeColor(type: string): string {
  return EDGE_COLORS[type] ?? EDGE_COLORS.default;
}

function nodeRadius(size: number): number {
  return Math.max(4, Math.min(size * 2.5, 18));
}

// ---------------------------------------------------------------------------
// Simulation node/link types for D3 (mutable copies)
// ---------------------------------------------------------------------------

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  size: number;
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [refreshKey, setRefreshKey] = useState(0);

  // Entity type legend data
  const nodeTypes = useMemo(() => {
    const types = new Set(nodes.map((n) => n.type));
    return Array.from(types);
  }, [nodes]);

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

  // Main D3 effect — builds simulation + bindsto SVG
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || nodes.length === 0) return;

    const { width, height } = dimensions;

    // Clear previous content
    const root = d3.select(svg);
    root.selectAll("*").remove();

    // Stop any previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    // Create mutable copies so we never mutate props
    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      size: n.size,
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
      .scaleExtent([0.15, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });

    root.call(zoomBehavior);

    // Start centered
    root.call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(0, 0).scale(1),
    );

    // --------------- Defs (arrow markers, glow filter) ---------------
    const defs = root.append("defs");

    // Glow filter for hovered nodes
    const filter = defs
      .append("filter")
      .attr("id", "node-glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "4")
      .attr("result", "blur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "blur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    // --------------- Edges ---------------
    const linkGroup = g.append("g").attr("class", "links");

    const linkSel = linkGroup
      .selectAll<SVGLineElement, SimLink>("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", (d) => edgeColor(d.type))
      .attr("stroke-opacity", 0.45)
      .attr("stroke-width", (d) => Math.max(0.5, Math.min(d.weight * 0.6, 3.5)));

    // Edge labels (midpoint)
    let edgeLabelSel: d3.Selection<SVGTextElement, SimLink, SVGGElement, unknown> | null = null;
    if (showEdgeLabels) {
      edgeLabelSel = linkGroup
        .selectAll<SVGTextElement, SimLink>("text")
        .data(simLinks.filter((l) => l.weight > 1))
        .join("text")
        .attr("font-size", "8px")
        .attr("fill", "#64748b")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("pointer-events", "none")
        .text((d) => d.type);
    }

    // --------------- Nodes ---------------
    const nodeGroup = g.append("g").attr("class", "nodes");

    const nodeSel = nodeGroup
      .selectAll<SVGGElement, SimNode>("g.node")
      .data(simNodes, (d) => (d as SimNode).id)
      .join("g")
      .attr("class", "node")
      .style("cursor", "pointer");

    // Node circles
    nodeSel
      .append("circle")
      .attr("r", (d) => nodeRadius(d.size))
      .attr("fill", (d) => nodeColor(d.type))
      .attr("stroke", "rgba(0,0,0,0.4)")
      .attr("stroke-width", 1);

    // Always-visible labels for larger nodes
    nodeSel
      .append("text")
      .attr("class", "node-label-always")
      .attr("dy", (d) => nodeRadius(d.size) + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", "9px")
      .attr("fill", "rgba(226, 232, 240, 0.85)")
      .attr("pointer-events", "none")
      .text((d) => (nodeRadius(d.size) > 6 ? d.label : ""));

    // Hover-only labels for small nodes
    nodeSel
      .append("text")
      .attr("class", "node-label-hover")
      .attr("dy", (d) => nodeRadius(d.size) + 12)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "600")
      .attr("fill", "#f8fafc")
      .attr("pointer-events", "none")
      .attr("opacity", 0)
      .text((d) => d.label);

    // --------------- Tooltip ---------------
    const tooltip = d3
      .select(containerRef.current)
      .append("div")
      .attr("class", "network-graph-tooltip")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("background", "rgba(15, 23, 42, 0.92)")
      .style("backdrop-filter", "blur(8px)")
      .style("border", "1px solid rgba(100, 116, 139, 0.4)")
      .style("border-radius", "6px")
      .style("padding", "6px 10px")
      .style("font-size", "11px")
      .style("color", "#e2e8f0")
      .style("z-index", "50")
      .style("display", "none")
      .style("white-space", "nowrap");

    // --------------- Hover interactions ---------------
    nodeSel
      .on("mouseenter", function (_event, d) {
        // Glow effect
        d3.select(this).select("circle").attr("filter", "url(#node-glow)").attr("stroke", "#fff").attr("stroke-width", 2);

        // Show hover label, hide always label
        d3.select(this).select(".node-label-hover").attr("opacity", 1);
        d3.select(this).select(".node-label-always").attr("opacity", 0);

        // Highlight connected edges
        linkSel
          .attr("stroke-opacity", (l) => {
            const src = (l.source as SimNode).id ?? l.source;
            const tgt = (l.target as SimNode).id ?? l.target;
            return src === d.id || tgt === d.id ? 0.85 : 0.12;
          })
          .attr("stroke-width", (l) => {
            const src = (l.source as SimNode).id ?? l.source;
            const tgt = (l.target as SimNode).id ?? l.target;
            return src === d.id || tgt === d.id
              ? Math.max(1.5, Math.min(l.weight * 0.8, 4))
              : Math.max(0.5, Math.min(l.weight * 0.6, 3.5));
          });

        // Fade non-connected nodes
        nodeSel.select("circle").attr("opacity", (n) => {
          if (n.id === d.id) return 1;
          const connected = simLinks.some((l) => {
            const src = (l.source as SimNode).id ?? l.source;
            const tgt = (l.target as SimNode).id ?? l.target;
            return (src === d.id && tgt === n.id) || (tgt === d.id && src === n.id);
          });
          return connected ? 1 : 0.25;
        });

        // Tooltip
        tooltip
          .style("display", "block")
          .html(
            `<div style="font-weight:600;margin-bottom:2px">${d.label}</div>` +
            `<div style="color:#94a3b8;text-transform:capitalize">${d.type}</div>`,
          );
      })
      .on("mousemove", function (event) {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;
        tooltip
          .style("left", `${event.clientX - containerRect.left + 14}px`)
          .style("top", `${event.clientY - containerRect.top - 10}px`);
      })
      .on("mouseleave", function () {
        d3.select(this).select("circle").attr("filter", null).attr("stroke", "rgba(0,0,0,0.4)").attr("stroke-width", 1);
        d3.select(this).select(".node-label-hover").attr("opacity", 0);
        d3.select(this).select(".node-label-always").attr("opacity", 1);
        linkSel.attr("stroke-opacity", 0.45).attr("stroke-width", (d) => Math.max(0.5, Math.min(d.weight * 0.6, 3.5)));
        nodeSel.select("circle").attr("opacity", 1);
        tooltip.style("display", "none");
      });

    // --------------- Click ---------------
    nodeSel.on("click", (_event, d) => {
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
          .distance(80)
          .strength((d) => Math.min(d.weight * 0.15, 0.8)),
      )
      .force("charge", d3.forceManyBody().strength(-220).distanceMax(350))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force(
        "collide",
        d3.forceCollide<SimNode>().radius((d) => nodeRadius(d.size) + 4).strength(0.7),
      )
      .alpha(1)
      .alphaDecay(0.02);

    simulationRef.current = simulation;

    // Tick handler — update positions
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

    // Cleanup
    return () => {
      simulation.stop();
      simulationRef.current = null;
      tooltip.remove();
    };
  }, [nodes, edges, dimensions, showEdgeLabels, onNodeClick, refreshKey]);

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
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {/* Stats */}
        <span className="text-[10px] text-muted-foreground bg-background/80 backdrop-blur-sm border border-border rounded px-2 py-1 mr-1 select-none">
          {nodes.length} nodes &middot; {edges.length} edges
        </span>
        <button
          onClick={handleRefresh}
          className="p-1 bg-background/80 border border-border rounded hover:bg-muted transition-colors"
          title="Refresh layout"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-x-3 gap-y-1 bg-background/80 backdrop-blur-sm rounded px-2 py-1.5 border border-border/50">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-1">
          Entity Types
        </span>
        {nodeTypes.map((type) => (
          <div key={type} className="flex items-center gap-1">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
              style={{ backgroundColor: nodeColor(type) }}
            />
            <span className="text-[10px] text-muted-foreground capitalize">{type}</span>
          </div>
        ))}
      </div>

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
