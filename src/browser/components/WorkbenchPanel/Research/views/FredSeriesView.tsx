/**
 * FredSeriesView — FRED data explorer with search and common series shortcuts.
 */

import React, { Suspense, useState, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { cn } from "@/common/lib/utils";

const LazyPlot = React.lazy(() => import("react-plotly.js"));

interface FredDataPoint {
  date: string;
  value?: number;
}

const COMMON_SERIES: Record<string, string> = {
  DGS10: "10Y Treasury Yield",
  UNRATE: "Unemployment Rate",
  CPIAUCSL: "Consumer Price Index",
  GDP: "Gross Domestic Product",
  M2SL: "M2 Money Supply",
  FEDFUNDS: "Federal Funds Rate",
  T10Y2Y: "10Y-2Y Spread",
  MORTGAGE30US: "30Y Mortgage Rate",
  DEXUSEU: "USD/EUR Exchange Rate",
  PAYEMS: "Total Nonfarm Payrolls",
};

interface FredSeriesViewProps {
  baseUrl: string;
}

export const FredSeriesView: React.FC<FredSeriesViewProps> = ({ baseUrl }) => {
  const [seriesId, setSeriesId] = useState("DGS10");
  const [input, setInput] = useState("DGS10");

  const data = useOpenBBQuery<FredDataPoint[]>(
    "/economy/fred_series",
    { symbol: seriesId, provider: "fred" },
    baseUrl,
    { provider: "fred", enabled: !!seriesId },
  );

  const plotData = useMemo(() => {
    if (!data.data || data.data.length === 0) return null;
    return [{
      x: data.data.map((d) => d.date),
      y: data.data.map((d) => d.value ?? 0),
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color: "#00ACFF", width: 1.5 },
      fill: "tozeroy" as const,
      fillcolor: "rgba(0, 172, 255, 0.08)",
      name: seriesId,
    }];
  }, [data.data, seriesId]);

  const layout = useMemo(() => ({
    title: { text: `${COMMON_SERIES[seriesId] ?? seriesId}`, font: { color: "#e0e0e0", size: 14, family: "monospace" }, x: 0.01, xanchor: "left" as const },
    paper_bgcolor: "#0a0a0a",
    plot_bgcolor: "#0a0a0a",
    font: { color: "#a0a0a0", size: 11, family: "monospace" },
    xaxis: { type: "date" as const, gridcolor: "#1a1a2e", linecolor: "#1a1a2e", tickfont: { color: "#888" } },
    yaxis: { gridcolor: "#1a1a2e", linecolor: "#1a1a2e", tickfont: { color: "#888" }, side: "right" as const },
    margin: { l: 10, r: 60, t: 35, b: 30 },
    showlegend: false,
    hovermode: "x unified" as const,
  }), [seriesId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) setSeriesId(trimmed);
  };

  const latestValue = data.data && data.data.length > 0 ? data.data[data.data.length - 1] : null;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Controls */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="FRED Series ID..."
            className="w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
          />
          <button type="submit" className="rounded bg-[#00ACFF] px-2 py-1 text-xs font-medium text-black hover:opacity-90">
            Load
          </button>
        </form>
        {latestValue && (
          <div className="ml-4 text-xs">
            <span className="text-neutral-500">Latest:</span>{" "}
            <span className="font-bold text-white">{latestValue.value?.toFixed(2)}</span>{" "}
            <span className="text-neutral-600">({latestValue.date})</span>
          </div>
        )}
      </div>

      {/* Series shortcuts */}
      <div className="flex flex-wrap gap-1 border-b border-neutral-800 px-3 py-1.5">
        {Object.entries(COMMON_SERIES).map(([sym, label]) => (
          <button
            key={sym}
            type="button"
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] transition-colors",
              seriesId === sym ? "bg-[#00ACFF] text-black font-medium" : "text-neutral-500 hover:bg-neutral-800 hover:text-white",
            )}
            onClick={() => { setSeriesId(sym); setInput(sym); }}
            title={label}
          >
            {sym}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="flex-1 overflow-hidden">
        {data.loading && !data.data ? (
          <div className="flex h-full items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
          </div>
        ) : data.error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-neutral-500">
            <p>{data.error}</p>
            <p className="text-[10px] text-neutral-600">FRED data requires an API key configured.</p>
          </div>
        ) : plotData ? (
          <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
            <LazyPlot
              data={plotData}
              layout={layout}
              config={{ displayModeBar: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] as any[], responsive: true }}
              useResizeHandler
              className="w-full"
              style={{ width: "100%", height: "100%" }}
            />
          </Suspense>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            Enter a FRED series ID to view data
          </div>
        )}
      </div>
    </div>
  );
};
