/**
 * FixedIncomeView — Treasury rates and yield curve visualization.
 */

import React, { Suspense, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { cn } from "@/common/lib/utils";

const LazyPlot = React.lazy(() => import("react-plotly.js"));

interface FredDataPoint {
  date: string;
  value?: number;
}

const TREASURY_SERIES: Record<string, string> = {
  DGS1MO: "1 Month",
  DGS3MO: "3 Month",
  DGS6MO: "6 Month",
  DGS1: "1 Year",
  DGS2: "2 Year",
  DGS5: "5 Year",
  DGS7: "7 Year",
  DGS10: "10 Year",
  DGS20: "20 Year",
  DGS30: "30 Year",
};

interface FixedIncomeViewProps {
  baseUrl: string;
}

export const FixedIncomeView: React.FC<FixedIncomeViewProps> = ({ baseUrl }) => {
  const [selected, setSelected] = useState("DGS10");

  // Fetch the selected series for the time series chart
  const seriesData = useOpenBBQuery<FredDataPoint[]>(
    "/economy/fred_series",
    { symbol: selected, provider: "fred" },
    baseUrl,
    { provider: "fred" },
  );

  // Fetch latest values for all maturities to build yield curve
  // We fetch the common ones individually
  const yc1mo = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS1MO", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc3mo = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS3MO", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc1 = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS1", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc2 = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS2", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc5 = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS5", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc10 = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS10", provider: "fred" }, baseUrl, { provider: "fred" });
  const yc30 = useOpenBBQuery<FredDataPoint[]>("/economy/fred_series", { symbol: "DGS30", provider: "fred" }, baseUrl, { provider: "fred" });

  const lastVal = (d: FredDataPoint[] | null) => d && d.length > 0 ? d[d.length - 1].value ?? null : null;

  const yieldCurveData = useMemo(() => {
    const maturities = ["1M", "3M", "1Y", "2Y", "5Y", "10Y", "30Y"];
    const values = [lastVal(yc1mo.data), lastVal(yc3mo.data), lastVal(yc1.data), lastVal(yc2.data), lastVal(yc5.data), lastVal(yc10.data), lastVal(yc30.data)];
    const validX: string[] = [];
    const validY: number[] = [];
    maturities.forEach((m, i) => {
      if (values[i] != null) { validX.push(m); validY.push(values[i]!); }
    });
    if (validX.length === 0) return null;
    return [{ x: validX, y: validY, type: "scatter" as const, mode: "lines+markers" as const, line: { color: "#00ACFF", width: 2 }, marker: { size: 6, color: "#00ACFF" }, name: "Yield Curve" }];
  }, [yc1mo.data, yc3mo.data, yc1.data, yc2.data, yc5.data, yc10.data, yc30.data]);

  const seriesPlotData = useMemo(() => {
    if (!seriesData.data || seriesData.data.length === 0) return null;
    return [{ x: seriesData.data.map((d) => d.date), y: seriesData.data.map((d) => d.value ?? 0), type: "scatter" as const, mode: "lines" as const, line: { color: "#00ACFF", width: 1.5 }, name: selected }];
  }, [seriesData.data, selected]);

  const layoutBase = { paper_bgcolor: "#0a0a0a", plot_bgcolor: "#0a0a0a", font: { color: "#a0a0a0", size: 11, family: "monospace" }, margin: { l: 40, r: 20, t: 35, b: 30 }, showlegend: false, hovermode: "x unified" as const };

  return (
    <PanelGroup direction="vertical" className="h-full">
      {/* Yield Curve */}
      <Panel defaultSize={45} minSize={25}>
        <div className="h-full overflow-hidden">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              US Treasury Yield Curve
            </span>
          </div>
          {yieldCurveData ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
              <LazyPlot
                data={yieldCurveData}
                layout={{ ...layoutBase, title: { text: "Yield Curve", font: { color: "#e0e0e0", size: 14, family: "monospace" }, x: 0.01, xanchor: "left" as const }, xaxis: { gridcolor: "#1a1a2e" }, yaxis: { gridcolor: "#1a1a2e", ticksuffix: "%", side: "right" as const }, height: 250 }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                className="w-full"
                style={{ width: "100%", height: "100%" }}
              />
            </Suspense>
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-xs text-neutral-500">
              <p>{yc10.error ?? "Loading yield curve..."}</p>
              <p className="mt-1 text-[10px] text-neutral-600">Requires FRED API key configured.</p>
            </div>
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      {/* Selected series history */}
      <Panel defaultSize={55} minSize={25}>
        <div className="h-full overflow-hidden">
          <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Rate History</span>
            <div className="flex flex-wrap gap-1 ml-2">
              {Object.entries(TREASURY_SERIES).map(([sym, label]) => (
                <button
                  key={sym}
                  type="button"
                  className={cn("rounded px-1 py-0.5 text-[10px] transition-colors", selected === sym ? "bg-[#00ACFF] text-black font-medium" : "text-neutral-500 hover:bg-neutral-800 hover:text-white")}
                  onClick={() => setSelected(sym)}
                  title={label}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {seriesData.loading ? (
            <div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>
          ) : seriesPlotData ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
              <LazyPlot
                data={seriesPlotData}
                layout={{ ...layoutBase, title: { text: `${TREASURY_SERIES[selected]} Treasury Rate`, font: { color: "#e0e0e0", size: 14, family: "monospace" }, x: 0.01, xanchor: "left" as const }, xaxis: { type: "date" as const, gridcolor: "#1a1a2e" }, yaxis: { gridcolor: "#1a1a2e", ticksuffix: "%", side: "right" as const }, height: 300 }}
                config={{ displayModeBar: false, responsive: true }}
                useResizeHandler
                className="w-full"
                style={{ width: "100%", height: "100%" }}
              />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">{seriesData.error ?? "No data"}</div>
          )}
        </div>
      </Panel>
    </PanelGroup>
  );
};
