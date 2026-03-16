/**
 * FuturesView — Common futures contracts chart and table.
 * Uses per-symbol quote fetching for reliable futures data.
 */

import React, { Suspense, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { useQuotes } from "../useOpenBB";
import type { OHLCVData } from "../useOpenBB";
import { formatPrice, formatPercent, formatVolume } from "../utils/quoteUtils";
import { cn } from "@/common/lib/utils";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);

const FUTURES_SYMBOLS: Record<string, string> = {
  "ES=F": "E-mini S&P 500",
  "NQ=F": "E-mini Nasdaq 100",
  "YM=F": "E-mini Dow",
  "RTY=F": "E-mini Russell 2000",
  "GC=F": "Gold",
  "SI=F": "Silver",
  "CL=F": "Crude Oil",
  "NG=F": "Natural Gas",
  "ZB=F": "30Y Treasury Bond",
  "ZN=F": "10Y Treasury Note",
};

const FUTURES_KEYS = Object.keys(FUTURES_SYMBOLS);

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

interface FuturesViewProps {
  baseUrl: string;
}

export const FuturesView: React.FC<FuturesViewProps> = ({ baseUrl }) => {
  const { timeRange } = useResearch();
  const [selected, setSelected] = useState("ES=F");
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: selected, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  // Per-symbol fetching for reliable futures data
  const quotes = useQuotes(FUTURES_KEYS, baseUrl);

  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={60} minSize={35}>
        <div className="h-full overflow-hidden">
          {priceHistory.loading && !priceHistory.data ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
            </div>
          ) : priceHistory.data && priceHistory.data.length > 0 ? (
            <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
              <CandlestickChart data={priceHistory.data} symbol={FUTURES_SYMBOLS[selected] ?? selected} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">
              {priceHistory.error ?? "No data"}
            </div>
          )}
        </div>
      </Panel>
      <PanelResizeHandle className="w-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      <Panel defaultSize={40} minSize={25}>
        <div className="h-full overflow-auto">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Futures Contracts
            </span>
          </div>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Contract</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Price</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Chg %</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Volume</th>
              </tr>
            </thead>
            <tbody>
              {FUTURES_KEYS.map((sym) => {
                const name = FUTURES_SYMBOLS[sym];
                const row = (quotes.data ?? []).find((r) => r.symbol === sym);
                const price = row?.price ?? 0;
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
                      <div className="font-mono font-bold text-white">{name}</div>
                      <div className="text-[10px] text-neutral-500">{sym}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-white">
                      {quotes.loading ? <span className="animate-pulse text-neutral-600">---</span> : formatPrice(price)}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right font-mono font-medium", pct >= 0 ? "text-[#00ACFF]" : "text-[#e4003a]")}>
                      {quotes.loading ? "---" : pct !== 0 ? formatPercent(pct) : "--"}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-400">
                      {quotes.loading ? "---" : formatVolume(row?.volume ?? 0)}
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
