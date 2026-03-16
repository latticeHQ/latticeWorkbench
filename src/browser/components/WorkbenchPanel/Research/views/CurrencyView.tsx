/**
 * CurrencyView — FX dashboard with historical chart and rates table.
 * Uses per-symbol quote fetching for reliable FX data.
 */

import React, { Suspense, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { useQuotes } from "../useOpenBB";
import type { OHLCVData } from "../useOpenBB";
import { formatPercent } from "../utils/quoteUtils";
import { cn } from "@/common/lib/utils";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);

const FX_PAIRS: Record<string, string> = {
  "EURUSD=X": "EUR/USD",
  "GBPUSD=X": "GBP/USD",
  "USDJPY=X": "USD/JPY",
  "AUDUSD=X": "AUD/USD",
};

const FX_SYMBOLS = Object.keys(FX_PAIRS);

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
    default: d.setMonth(d.getMonth() - 3);
  }
  return d.toISOString().slice(0, 10);
}

interface CurrencyViewProps {
  baseUrl: string;
}

export const CurrencyView: React.FC<CurrencyViewProps> = ({ baseUrl }) => {
  const { timeRange } = useResearch();
  const [selected, setSelected] = useState("EURUSD=X");
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: selected, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  // Per-symbol fetching for reliable FX data
  const quotes = useQuotes(FX_SYMBOLS, baseUrl);

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={65} minSize={40}>
        <div className="h-full overflow-hidden">
          {priceHistory.loading && !priceHistory.data ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
            </div>
          ) : priceHistory.data && priceHistory.data.length > 0 ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
              <CandlestickChart data={priceHistory.data} symbol={FX_PAIRS[selected] ?? selected} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
              {priceHistory.error ?? "No data"}
            </div>
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      <Panel defaultSize={35} minSize={20}>
        <div className="h-full overflow-auto">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              FX Rates
            </span>
          </div>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Pair</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Rate</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Chg %</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">High</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Low</th>
              </tr>
            </thead>
            <tbody>
              {FX_SYMBOLS.map((sym) => {
                const label = FX_PAIRS[sym];
                const row = (quotes.data ?? []).find((r) => r.symbol === sym);
                const rate = row?.price ?? 0;
                const pct = row?.changePercent ?? 0;
                const isActive = sym === selected;
                return (
                  <tr
                    key={sym}
                    className={cn(
                      "cursor-pointer border-b border-neutral-800/50 transition-colors hover:bg-neutral-800/50",
                      isActive && "bg-[#00ACFF]/10",
                    )}
                    onClick={() => setSelected(sym)}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-mono font-bold text-white">{label}</div>
                      <div className="text-[10px] text-neutral-500">{sym}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-white">
                      {quotes.loading ? <span className="animate-pulse text-neutral-600">---</span> : rate > 0 ? rate.toFixed(4) : "--"}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right font-mono font-medium", pct >= 0 ? "text-[#00ACFF]" : "text-[#e4003a]")}>
                      {quotes.loading ? "---" : pct !== 0 ? formatPercent(pct) : "--"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-400">
                      {quotes.loading ? "---" : row?.high ? row.high.toFixed(4) : "--"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-400">
                      {quotes.loading ? "---" : row?.low ? row.low.toFixed(4) : "--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </PanelGroup>
  );
};
