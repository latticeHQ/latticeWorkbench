/**
 * EconomyView — Macro dashboard with economic calendar and FRED series.
 */

import React, { Suspense, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { cn } from "@/common/lib/utils";

const LazyPlot = React.lazy(() => import("react-plotly.js"));

interface FredDataPoint {
  date: string;
  value?: number;
}

interface CalendarEvent {
  date?: string;
  event?: string;
  country?: string;
  actual?: number | string;
  previous?: number | string;
  consensus?: number | string;
}

const FRED_SHORTCUTS: Record<string, string> = {
  DGS10: "10Y Treasury Rate",
  CPIAUCSL: "CPI (All Urban)",
  UNRATE: "Unemployment Rate",
  GDP: "Gross Domestic Product",
  FEDFUNDS: "Fed Funds Rate",
};

interface EconomyViewProps {
  baseUrl: string;
}

export const EconomyView: React.FC<EconomyViewProps> = ({ baseUrl }) => {
  const [fredSymbol, setFredSymbol] = useState("DGS10");

  const fredData = useOpenBBQuery<FredDataPoint[]>(
    "/economy/fred_series",
    { symbol: fredSymbol, provider: "fred" },
    baseUrl,
    { provider: "fred" },
  );

  const calendar = useOpenBBQuery<CalendarEvent[]>(
    "/economy/calendar",
    { provider: "fmp" },
    baseUrl,
    { provider: "fmp" },
  );

  const plotData = useMemo(() => {
    if (!fredData.data || fredData.data.length === 0) return null;
    return [{
      x: fredData.data.map((d) => d.date),
      y: fredData.data.map((d) => d.value ?? 0),
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color: "#00ACFF", width: 1.5 },
      name: fredSymbol,
    }];
  }, [fredData.data, fredSymbol]);

  const plotLayout = useMemo(() => ({
    title: { text: `${FRED_SHORTCUTS[fredSymbol] ?? fredSymbol}`, font: { color: "#e0e0e0", size: 14, family: "monospace" }, x: 0.01, xanchor: "left" as const },
    paper_bgcolor: "#0a0a0a",
    plot_bgcolor: "#0a0a0a",
    font: { color: "#a0a0a0", size: 11, family: "monospace" },
    xaxis: { type: "date" as const, gridcolor: "#1a1a2e", linecolor: "#1a1a2e", tickfont: { color: "#888" } },
    yaxis: { gridcolor: "#1a1a2e", linecolor: "#1a1a2e", tickfont: { color: "#888" }, side: "right" as const },
    margin: { l: 10, r: 60, t: 35, b: 30 },
    height: 350,
    showlegend: false,
    hovermode: "x unified" as const,
  }), [fredSymbol]);

  return (
    <PanelGroup direction="vertical" className="h-full">
      {/* FRED Series Chart */}
      <Panel defaultSize={55} minSize={30}>
        <div className="h-full overflow-hidden">
          <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">FRED Series</span>
            <div className="flex items-center gap-1 ml-2">
              {Object.entries(FRED_SHORTCUTS).map(([sym, label]) => (
                <button
                  key={sym}
                  type="button"
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                    fredSymbol === sym ? "bg-[#00ACFF] text-black" : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
                  )}
                  onClick={() => setFredSymbol(sym)}
                  title={label}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[calc(100%-28px)]">
            {fredData.loading && !fredData.data ? (
              <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
              </div>
            ) : fredData.error ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-neutral-500">
                <p>{fredData.error}</p>
                <p className="text-[10px] text-neutral-600">FRED data may require an API key configured.</p>
              </div>
            ) : plotData ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
                <LazyPlot
                  data={plotData}
                  layout={plotLayout}
                  config={{ displayModeBar: false, responsive: true }}
                  useResizeHandler
                  className="w-full"
                  style={{ width: "100%", height: "100%" }}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                No FRED data available
              </div>
            )}
          </div>
        </div>
      </Panel>
      <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      {/* Economic Calendar */}
      <Panel defaultSize={45} minSize={20}>
        <div className="h-full overflow-auto">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Economic Calendar
            </span>
          </div>
          {calendar.loading ? (
            <div className="flex h-32 items-center justify-center text-xs text-neutral-500">Loading calendar...</div>
          ) : calendar.error ? (
            <div className="flex h-32 flex-col items-center justify-center gap-1 text-xs text-neutral-500">
              <p>Calendar unavailable</p>
              <p className="text-[10px] text-neutral-600">Economic calendar requires FMP API key.</p>
            </div>
          ) : (calendar.data ?? []).length === 0 ? (
            <div className="flex h-32 items-center justify-center text-xs text-neutral-500">No upcoming events</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
                <tr className="border-b border-neutral-800 text-left">
                  <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Date</th>
                  <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Event</th>
                  <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Country</th>
                  <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Actual</th>
                  <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Consensus</th>
                  <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Previous</th>
                </tr>
              </thead>
              <tbody>
                {(calendar.data ?? []).slice(0, 50).map((evt, i) => (
                  <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                    <td className="px-2 py-1 text-neutral-400">{evt.date ? new Date(evt.date).toLocaleDateString() : "--"}</td>
                    <td className="px-2 py-1 text-neutral-200">{evt.event ?? "--"}</td>
                    <td className="px-2 py-1 text-neutral-400">{evt.country ?? "--"}</td>
                    <td className="px-2 py-1 text-right text-white">{evt.actual ?? "--"}</td>
                    <td className="px-2 py-1 text-right text-neutral-400">{evt.consensus ?? "--"}</td>
                    <td className="px-2 py-1 text-right text-neutral-400">{evt.previous ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
};
