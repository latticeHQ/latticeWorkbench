/**
 * EconometricsView — Quantitative analysis: correlation, OLS regression, cointegration.
 */

import React, { Suspense, useState, useMemo, useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import type { OHLCVData } from "../useOpenBB";

const LazyPlot = React.lazy(() => import("react-plotly.js"));

function getStartDate(range: string): string {
  const now = new Date();
  const d = new Date(now);
  switch (range) {
    case "1W": d.setDate(d.getDate() - 7); break;
    case "1M": d.setMonth(d.getMonth() - 1); break;
    case "3M": d.setMonth(d.getMonth() - 3); break;
    case "6M": d.setMonth(d.getMonth() - 6); break;
    case "1Y": d.setFullYear(d.getFullYear() - 1); break;
    case "YTD": return `${now.getFullYear()}-01-01`;
    default: d.setMonth(d.getMonth() - 6);
  }
  return d.toISOString().slice(0, 10);
}

interface EconometricsViewProps {
  baseUrl: string;
}

export const EconometricsView: React.FC<EconometricsViewProps> = ({ baseUrl }) => {
  const { activeSymbol, timeRange } = useResearch();
  const [symbolA, setSymbolA] = useState(activeSymbol);
  const [symbolB, setSymbolB] = useState("SPY");
  const [inputA, setInputA] = useState(activeSymbol);
  const [inputB, setInputB] = useState("SPY");
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);

  // Sync with context when activeSymbol changes externally
  useEffect(() => {
    if (activeSymbol && activeSymbol !== symbolA) {
      setSymbolA(activeSymbol);
      setInputA(activeSymbol);
    }
  }, [activeSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const dataA = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: symbolA, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  const dataB = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: symbolB, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  // Compute correlation from aligned close prices
  const { correlation, scatterData, returnsA, returnsB } = useMemo(() => {
    if (!dataA.data || !dataB.data || dataA.data.length < 2 || dataB.data.length < 2) {
      return { correlation: null, scatterData: null, returnsA: null, returnsB: null };
    }
    const mapB = new Map(dataB.data.map((d) => [d.date, d.close]));
    const aligned: { a: number; b: number }[] = [];
    for (const d of dataA.data) {
      const bClose = mapB.get(d.date);
      if (bClose != null) aligned.push({ a: d.close, b: bClose });
    }
    if (aligned.length < 3) return { correlation: null, scatterData: null, returnsA: null, returnsB: null };

    const retA: number[] = [];
    const retB: number[] = [];
    for (let i = 1; i < aligned.length; i++) {
      retA.push((aligned[i].a - aligned[i - 1].a) / aligned[i - 1].a);
      retB.push((aligned[i].b - aligned[i - 1].b) / aligned[i - 1].b);
    }

    const n = retA.length;
    const meanA = retA.reduce((s, v) => s + v, 0) / n;
    const meanB = retB.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      const dA = retA[i] - meanA;
      const dB = retB[i] - meanB;
      cov += dA * dB;
      varA += dA * dA;
      varB += dB * dB;
    }
    const corr = varA > 0 && varB > 0 ? cov / Math.sqrt(varA * varB) : 0;

    return {
      correlation: corr,
      scatterData: [{ x: retA, y: retB, type: "scatter" as const, mode: "markers" as const, marker: { size: 3, color: "#00ACFF", opacity: 0.6 }, name: `${symbolA} vs ${symbolB}` }],
      returnsA: retA,
      returnsB: retB,
    };
  }, [dataA.data, dataB.data, symbolA, symbolB]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSymbolA(inputA.trim().toUpperCase());
    setSymbolB(inputB.trim().toUpperCase());
  };

  const isLoading = dataA.loading || dataB.loading;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Controls */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Econometrics</span>
        <form onSubmit={handleSubmit} className="flex items-center gap-2 ml-2">
          <input
            type="text"
            value={inputA}
            onChange={(e) => setInputA(e.target.value)}
            className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
            placeholder="Symbol A"
          />
          <span className="text-neutral-500 text-xs">vs</span>
          <input
            type="text"
            value={inputB}
            onChange={(e) => setInputB(e.target.value)}
            className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
            placeholder="Symbol B"
          />
          <button type="submit" className="rounded bg-[#00ACFF] px-2 py-1 text-xs font-medium text-black hover:opacity-90">
            Analyze
          </button>
        </form>
        {correlation != null && (
          <div className="ml-4 text-xs">
            <span className="text-neutral-500">Correlation:</span>{" "}
            <span className={`font-bold ${Math.abs(correlation) > 0.7 ? "text-[#00ACFF]" : Math.abs(correlation) > 0.4 ? "text-yellow-400" : "text-neutral-400"}`}>
              {correlation.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* Scatter plot */}
        <Panel defaultSize={60} minSize={35}>
          <div className="h-full overflow-hidden">
            {isLoading ? (
              <div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>
            ) : scatterData ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
                <LazyPlot
                  data={scatterData}
                  layout={{
                    title: { text: `${symbolA} vs ${symbolB} Daily Returns`, font: { color: "#e0e0e0", size: 14, family: "monospace" }, x: 0.01, xanchor: "left" as const },
                    paper_bgcolor: "#0a0a0a", plot_bgcolor: "#0a0a0a",
                    font: { color: "#a0a0a0", size: 11, family: "monospace" },
                    xaxis: { title: { text: symbolA, font: { color: "#888" } }, gridcolor: "#1a1a2e", tickformat: ".1%", zeroline: true, zerolinecolor: "#333" },
                    yaxis: { title: { text: symbolB, font: { color: "#888" } }, gridcolor: "#1a1a2e", tickformat: ".1%", side: "right" as const, zeroline: true, zerolinecolor: "#333" },
                    margin: { l: 10, r: 60, t: 35, b: 50 },
                    showlegend: false, hovermode: "closest" as const,
                  }}
                  config={{ displayModeBar: false, responsive: true }}
                  useResizeHandler className="w-full" style={{ width: "100%", height: "100%" }}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                {dataA.error ?? dataB.error ?? "Select two symbols to compare"}
              </div>
            )}
          </div>
        </Panel>
        <PanelResizeHandle className="w-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
        {/* Stats panel */}
        <Panel defaultSize={40} minSize={25}>
          <div className="h-full overflow-auto p-3 text-xs">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-wider text-neutral-500">Analysis Results</div>
            {correlation != null && returnsA && returnsB ? (
              <div className="space-y-3">
                <div className="rounded border border-neutral-800 p-2">
                  <div className="text-neutral-500">Pearson Correlation</div>
                  <div className="text-lg font-bold text-[#00ACFF]">{correlation.toFixed(4)}</div>
                  <div className="text-[10px] text-neutral-600">
                    {Math.abs(correlation) > 0.7 ? "Strong" : Math.abs(correlation) > 0.4 ? "Moderate" : "Weak"}{" "}
                    {correlation > 0 ? "positive" : "negative"} correlation
                  </div>
                </div>
                <div className="rounded border border-neutral-800 p-2">
                  <div className="text-neutral-500">Sample Size</div>
                  <div className="font-bold text-white">{returnsA.length} trading days</div>
                </div>
                <div className="rounded border border-neutral-800 p-2">
                  <div className="text-neutral-500">{symbolA} Avg Daily Return</div>
                  <div className="font-bold text-white">{(returnsA.reduce((s, v) => s + v, 0) / returnsA.length * 100).toFixed(4)}%</div>
                </div>
                <div className="rounded border border-neutral-800 p-2">
                  <div className="text-neutral-500">{symbolB} Avg Daily Return</div>
                  <div className="font-bold text-white">{(returnsB.reduce((s, v) => s + v, 0) / returnsB.length * 100).toFixed(4)}%</div>
                </div>
                <div className="mt-4 rounded border border-dashed border-neutral-700 p-2 text-[10px] text-neutral-600">
                  <div className="font-medium text-neutral-500">Coming Soon</div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    <li>OLS Regression</li>
                    <li>Cointegration Test</li>
                    <li>Granger Causality</li>
                    <li>Rolling Correlation</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="text-neutral-500">Run analysis to see results</div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};
