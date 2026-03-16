/**
 * CryptoView — Crypto dashboard with price chart and watchlist table.
 *
 * Default symbols shown as quick-picks, but user can type any crypto ticker.
 * Uses per-symbol quote fetching for reliable data across all crypto pairs.
 */

import React, { Suspense, useState, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { useQuotes } from "../useOpenBB";
import { formatPrice, formatPercent, formatVolume } from "../utils/quoteUtils";
import type { OHLCVData } from "../useOpenBB";
import { cn } from "@/common/lib/utils";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);

/** Default crypto quick-picks. Users can search for any symbol. */
const DEFAULT_CRYPTO: Record<string, string> = {
  "BTC-USD": "Bitcoin",
  "ETH-USD": "Ethereum",
  "SOL-USD": "Solana",
  "DOGE-USD": "Dogecoin",
  "XRP-USD": "Ripple",
  "ADA-USD": "Cardano",
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
    default: d.setMonth(d.getMonth() - 3);
  }
  return d.toISOString().slice(0, 10);
}

interface CryptoViewProps {
  baseUrl: string;
}

export const CryptoView: React.FC<CryptoViewProps> = ({ baseUrl }) => {
  const { timeRange } = useResearch();
  const [selected, setSelected] = useState("BTC-USD");
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);
  const symbols = useMemo(() => Object.keys(DEFAULT_CRYPTO), []);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: selected, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  // Per-symbol fetching for reliable data across all crypto pairs
  const quotes = useQuotes(symbols, baseUrl);

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
              <CandlestickChart data={priceHistory.data} symbol={selected} />
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
              Crypto Watchlist
            </span>
          </div>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Symbol</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Price</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Chg %</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Volume</th>
              </tr>
            </thead>
            <tbody>
              {(quotes.data ?? []).map((nq) => {
                const isActive = nq.symbol === selected;
                return (
                  <tr
                    key={nq.symbol}
                    className={cn(
                      "cursor-pointer border-b border-neutral-800/50 transition-colors hover:bg-neutral-800/50",
                      isActive && "bg-[#00ACFF]/10",
                    )}
                    onClick={() => setSelected(nq.symbol)}
                  >
                    <td className="px-2 py-1.5">
                      <div className="font-mono font-bold text-white">{nq.symbol}</div>
                      <div className="text-[10px] text-neutral-500">{nq.name || DEFAULT_CRYPTO[nq.symbol] || ""}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-white">
                      {quotes.loading ? <span className="animate-pulse text-neutral-600">---</span> : formatPrice(nq.price)}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right font-mono font-medium", nq.changePercent >= 0 ? "text-[#00ACFF]" : "text-[#e4003a]")}>
                      {quotes.loading ? "---" : formatPercent(nq.changePercent)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-neutral-400">
                      {quotes.loading ? "---" : formatVolume(nq.volume)}
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
