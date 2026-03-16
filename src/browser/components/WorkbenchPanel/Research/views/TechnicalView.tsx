/**
 * TechnicalView — Technical analysis with candlestick chart and indicator overlays.
 *
 * All indicators (RSI, MACD, Bollinger Bands, SMA) are computed client-side
 * from OHLCV price data — no extra API calls needed.
 */

import React, { Suspense, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import type { OHLCVData } from "../useOpenBB";
import { cn } from "@/common/lib/utils";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);
const LazyPlot = React.lazy(() => import("react-plotly.js"));

// ---------------------------------------------------------------------------
// Client-side indicator calculations
// ---------------------------------------------------------------------------

function computeSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(sum / period);
    }
  }
  return result;
}

function computeEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeRSI(closes: number[], period: number = 14): (number | null)[] {
  if (closes.length < period + 1) return closes.map(() => null);
  const result: (number | null)[] = [];

  // Calculate initial gains/losses
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill nulls for the warmup period
  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Smoothed RSI
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function computeMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signal: number = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  if (closes.length < slow) {
    return { macd: closes.map(() => null), signal: closes.map(() => null), histogram: closes.map(() => null) };
  }
  const emaFast = computeEMA(closes, fast);
  const emaSlow = computeEMA(closes, slow);
  const macdLine = emaFast.map((f, i) => f - emaSlow[i]);

  // Signal line = EMA of MACD line
  const macdForSignal = macdLine.slice(slow - 1);
  const signalEma = computeEMA(macdForSignal, signal);

  const macdResult: (number | null)[] = [];
  const signalResult: (number | null)[] = [];
  const histResult: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      macdResult.push(null);
      signalResult.push(null);
      histResult.push(null);
    } else {
      const mi = i - (slow - 1);
      const m = macdLine[i];
      macdResult.push(m);
      if (mi < signal - 1) {
        signalResult.push(null);
        histResult.push(null);
      } else {
        const s = signalEma[mi];
        signalResult.push(s);
        histResult.push(m - s);
      }
    }
  }
  return { macd: macdResult, signal: signalResult, histogram: histResult };
}

function computeBollinger(
  closes: number[],
  period: number = 20,
  stdMult: number = 2,
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = computeSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const m = middle[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) {
        variance += (closes[j] - m) ** 2;
      }
      const std = Math.sqrt(variance / period);
      upper.push(m + stdMult * std);
      lower.push(m - stdMult * std);
    }
  }
  return { upper, middle, lower };
}

// ---------------------------------------------------------------------------
// Indicator type config
// ---------------------------------------------------------------------------

type IndicatorKey = "rsi" | "macd" | "bbands" | "sma20" | "sma50";

const INDICATOR_LABELS: Record<IndicatorKey, string> = {
  rsi: "RSI",
  macd: "MACD",
  bbands: "Bollinger",
  sma20: "SMA-20",
  sma50: "SMA-50",
};

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

interface TechnicalViewProps {
  baseUrl: string;
}

export const TechnicalView: React.FC<TechnicalViewProps> = ({ baseUrl }) => {
  const { activeSymbol, timeRange } = useResearch();
  const [enabled, setEnabled] = useState<Set<IndicatorKey>>(new Set(["rsi"]));
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: activeSymbol, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  const toggle = (key: IndicatorKey) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Compute all indicators from price data
  const dates = useMemo(() => priceHistory.data?.map((d) => d.date) ?? [], [priceHistory.data]);
  const closes = useMemo(() => priceHistory.data?.map((d) => d.close) ?? [], [priceHistory.data]);

  const rsiValues = useMemo(() => closes.length > 14 ? computeRSI(closes, 14) : [], [closes]);
  const macdValues = useMemo(() => closes.length > 26 ? computeMACD(closes, 12, 26, 9) : null, [closes]);
  const bbandsValues = useMemo(() => closes.length > 20 ? computeBollinger(closes, 20, 2) : null, [closes]);
  const sma20Values = useMemo(() => closes.length > 20 ? computeSMA(closes, 20) : [], [closes]);
  const sma50Values = useMemo(() => closes.length > 50 ? computeSMA(closes, 50) : [], [closes]);

  // Build plot data for each indicator
  const rsiPlotData = useMemo(() => {
    if (rsiValues.length === 0) return null;
    return [{
      x: dates,
      y: rsiValues,
      type: "scatter" as const,
      mode: "lines" as const,
      line: { color: "#00ACFF", width: 1.5 },
      name: "RSI(14)",
      connectgaps: false,
    }];
  }, [dates, rsiValues]);

  const macdPlotData = useMemo(() => {
    if (!macdValues) return null;
    return [
      { x: dates, y: macdValues.macd, type: "scatter" as const, mode: "lines" as const, line: { color: "#00ACFF", width: 1.5 }, name: "MACD", connectgaps: false },
      { x: dates, y: macdValues.signal, type: "scatter" as const, mode: "lines" as const, line: { color: "#e4003a", width: 1.5 }, name: "Signal", connectgaps: false },
      { x: dates, y: macdValues.histogram, type: "bar" as const, marker: { color: macdValues.histogram.map((v) => (v ?? 0) >= 0 ? "rgba(0,172,255,0.4)" : "rgba(228,0,58,0.4)") }, name: "Histogram" },
    ];
  }, [dates, macdValues]);

  // Bollinger and SMA are overlaid on the main chart — build overlay traces
  const overlayTraces = useMemo(() => {
    const traces: any[] = [];
    if (enabled.has("bbands") && bbandsValues) {
      traces.push({ x: dates, y: bbandsValues.upper, type: "scatter", mode: "lines", line: { color: "rgba(255,200,0,0.5)", width: 1, dash: "dot" }, name: "BB Upper", connectgaps: false });
      traces.push({ x: dates, y: bbandsValues.middle, type: "scatter", mode: "lines", line: { color: "rgba(255,200,0,0.7)", width: 1 }, name: "BB Middle", connectgaps: false });
      traces.push({ x: dates, y: bbandsValues.lower, type: "scatter", mode: "lines", line: { color: "rgba(255,200,0,0.5)", width: 1, dash: "dot" }, name: "BB Lower", connectgaps: false });
    }
    if (enabled.has("sma20") && sma20Values.length > 0) {
      traces.push({ x: dates, y: sma20Values, type: "scatter", mode: "lines", line: { color: "#22c55e", width: 1.5 }, name: "SMA-20", connectgaps: false });
    }
    if (enabled.has("sma50") && sma50Values.length > 0) {
      traces.push({ x: dates, y: sma50Values, type: "scatter", mode: "lines", line: { color: "#f97316", width: 1.5 }, name: "SMA-50", connectgaps: false });
    }
    return traces;
  }, [dates, enabled, bbandsValues, sma20Values, sma50Values]);

  // Build candlestick + overlay plot data for the main chart
  const mainPlotData = useMemo(() => {
    if (!priceHistory.data || priceHistory.data.length === 0) return null;
    const candlestick = {
      x: dates,
      open: priceHistory.data.map((d) => d.open),
      high: priceHistory.data.map((d) => d.high),
      low: priceHistory.data.map((d) => d.low),
      close: priceHistory.data.map((d) => d.close),
      type: "candlestick" as const,
      name: activeSymbol,
      increasing: { line: { color: "#00ACFF" } },
      decreasing: { line: { color: "#e4003a" } },
    };
    return [candlestick, ...overlayTraces];
  }, [priceHistory.data, dates, activeSymbol, overlayTraces]);

  const hasOverlays = enabled.has("bbands") || enabled.has("sma20") || enabled.has("sma50");

  const indicatorLayout = (title: string, extra?: Record<string, unknown>) => ({
    paper_bgcolor: "#0a0a0a",
    plot_bgcolor: "#0a0a0a",
    font: { color: "#a0a0a0", size: 10, family: "monospace" },
    title: { text: title, font: { color: "#e0e0e0", size: 12, family: "monospace" }, x: 0.01, xanchor: "left" as const },
    xaxis: { type: "date" as const, gridcolor: "#1a1a2e", showticklabels: false },
    yaxis: { gridcolor: "#1a1a2e", side: "right" as const },
    margin: { l: 10, r: 50, t: 25, b: 10 },
    showlegend: false,
    hovermode: "x unified" as const,
    ...extra,
  });

  const mainLayout = useMemo(() => ({
    paper_bgcolor: "#0a0a0a",
    plot_bgcolor: "#0a0a0a",
    font: { color: "#a0a0a0", size: 10, family: "monospace" },
    title: { text: `${activeSymbol} — Technical Analysis`, font: { color: "#e0e0e0", size: 13, family: "monospace" }, x: 0.01, xanchor: "left" as const },
    xaxis: { type: "date" as const, gridcolor: "#1a1a2e", rangeslider: { visible: false } },
    yaxis: { gridcolor: "#1a1a2e", side: "right" as const },
    margin: { l: 10, r: 60, t: 30, b: 30 },
    showlegend: hasOverlays,
    legend: { x: 0.01, y: 0.99, bgcolor: "rgba(0,0,0,0)", font: { color: "#888", size: 10 } },
    hovermode: "x unified" as const,
  }), [activeSymbol, hasOverlays]);

  // Determine dynamic panel sizes
  const subPanelCount = (enabled.has("rsi") ? 1 : 0) + (enabled.has("macd") ? 1 : 0);
  const mainSize = subPanelCount === 0 ? 100 : subPanelCount === 1 ? 70 : 55;
  const subSize = subPanelCount === 1 ? 30 : 22;

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Indicator toggles */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Indicators</span>
        {(Object.keys(INDICATOR_LABELS) as IndicatorKey[]).map((key) => (
          <button
            key={key}
            type="button"
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              enabled.has(key) ? "bg-[#00ACFF] text-black" : "text-neutral-400 hover:bg-neutral-800",
            )}
            onClick={() => toggle(key)}
          >
            {INDICATOR_LABELS[key]}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-neutral-500">{activeSymbol}</span>
      </div>

      {/* Main chart + sub-indicator panels */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={mainSize} minSize={30}>
          <div className="h-full overflow-hidden">
            {priceHistory.loading && !priceHistory.data ? (
              <div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>
            ) : mainPlotData ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
                {hasOverlays ? (
                  <LazyPlot
                    data={mainPlotData}
                    layout={mainLayout}
                    config={{ displayModeBar: false, responsive: true }}
                    useResizeHandler
                    className="w-full"
                    style={{ width: "100%", height: "100%" }}
                  />
                ) : (
                  <CandlestickChart data={priceHistory.data!} symbol={activeSymbol} />
                )}
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500">{priceHistory.error ?? "No data"}</div>
            )}
          </div>
        </Panel>
        {enabled.has("rsi") && rsiPlotData && (
          <>
            <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
            <Panel defaultSize={subSize} minSize={10}>
              <Suspense fallback={null}>
                <LazyPlot
                  data={rsiPlotData}
                  layout={indicatorLayout("RSI(14)", {
                    yaxis: { gridcolor: "#1a1a2e", side: "right" as const, range: [0, 100] },
                    shapes: [
                      { type: "line", x0: 0, x1: 1, xref: "paper", y0: 70, y1: 70, line: { color: "rgba(228,0,58,0.3)", width: 1, dash: "dot" } },
                      { type: "line", x0: 0, x1: 1, xref: "paper", y0: 30, y1: 30, line: { color: "rgba(0,172,255,0.3)", width: 1, dash: "dot" } },
                    ],
                  })}
                  config={{ displayModeBar: false, responsive: true }}
                  useResizeHandler
                  className="w-full"
                  style={{ width: "100%", height: "100%" }}
                />
              </Suspense>
            </Panel>
          </>
        )}
        {enabled.has("macd") && macdPlotData && (
          <>
            <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
            <Panel defaultSize={subSize} minSize={10}>
              <Suspense fallback={null}>
                <LazyPlot
                  data={macdPlotData}
                  layout={indicatorLayout("MACD (12, 26, 9)", {
                    showlegend: true,
                    legend: { x: 0.01, y: 0.99, bgcolor: "rgba(0,0,0,0)", font: { color: "#888", size: 9 }, orientation: "h" as const },
                    barmode: "overlay" as const,
                  })}
                  config={{ displayModeBar: false, responsive: true }}
                  useResizeHandler
                  className="w-full"
                  style={{ width: "100%", height: "100%" }}
                />
              </Suspense>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
};
