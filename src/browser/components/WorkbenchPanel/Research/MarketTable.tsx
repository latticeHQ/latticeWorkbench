/**
 * Market data table — Bloomberg-style watchlist for tracked equities and ETFs.
 * Uses NormalizedQuote for consistent data across all providers.
 */

import React from "react";
import type { NormalizedQuote } from "./utils/quoteUtils";
import { formatPrice, formatPercent, formatVolume } from "./utils/quoteUtils";
import { cn } from "@/common/lib/utils";

interface MarketTableProps {
  data: NormalizedQuote[] | null;
  loading: boolean;
  error: string | null;
  onSymbolClick: (symbol: string) => void;
  activeSymbol: string | null;
  /** User-configurable watchlist for name lookups and placeholder rows. */
  watchlist?: Record<string, string>;
}

export const MarketTable: React.FC<MarketTableProps> = ({
  data,
  loading,
  error,
  onSymbolClick,
  activeSymbol,
  watchlist = {},
}) => {
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <p className="text-sm text-red-600 dark:text-red-400">Data API unavailable</p>
          <p className="text-muted mt-1 text-xs">
            Start the financial data server first.
          </p>
        </div>
      </div>
    );
  }

  // Show placeholder data when loading or no data
  const rows: NormalizedQuote[] = data ?? Object.entries(watchlist).map(([symbol, name]) => ({
    symbol,
    name,
    price: 0,
    change: 0,
    changePercent: 0,
    volume: 0,
    marketCap: 0,
    high: 0,
    low: 0,
    prevClose: 0,
    yearHigh: 0,
    yearLow: 0,
    open: 0,
  }));

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
          <tr className="border-b border-neutral-800 text-left">
            <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Symbol</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Last</th>
            <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Chg %</th>
            <th className="hidden px-2 py-1.5 text-right font-mono font-medium text-neutral-400 @[400px]:table-cell">
              Volume
            </th>
            <th className="hidden px-2 py-1.5 text-right font-mono font-medium text-neutral-400 @[500px]:table-cell">
              High
            </th>
            <th className="hidden px-2 py-1.5 text-right font-mono font-medium text-neutral-400 @[500px]:table-cell">
              Low
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isActive = row.symbol === activeSymbol;
            const isPositive = row.changePercent >= 0;
            return (
              <tr
                key={row.symbol}
                className={cn(
                  "cursor-pointer border-b border-neutral-800/50 transition-colors hover:bg-neutral-800/50",
                  isActive && "bg-[#00ACFF]/10"
                )}
                onClick={() => onSymbolClick(row.symbol)}
              >
                <td className="px-2 py-1.5">
                  <div className="font-mono font-bold text-white">{row.symbol}</div>
                  <div className="text-muted truncate text-[10px]">
                    {watchlist[row.symbol] ?? row.name}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-white">
                  {loading ? (
                    <span className="text-muted animate-pulse">---</span>
                  ) : row.price > 0 ? (
                    formatPrice(row.price)
                  ) : (
                    <span className="text-muted">--</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-2 py-1.5 text-right font-mono font-medium",
                    loading
                      ? "text-muted"
                      : isPositive
                        ? "text-[#00ACFF]"
                        : "text-[#e4003a]"
                  )}
                >
                  {loading ? (
                    <span className="animate-pulse">---</span>
                  ) : row.changePercent !== 0 ? (
                    formatPercent(row.changePercent)
                  ) : (
                    "--"
                  )}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono text-neutral-400 @[400px]:table-cell">
                  {loading ? "---" : row.volume > 0 ? formatVolume(row.volume) : "--"}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono text-neutral-400 @[500px]:table-cell">
                  {loading ? "---" : row.high > 0 ? formatPrice(row.high) : "--"}
                </td>
                <td className="hidden px-2 py-1.5 text-right font-mono text-neutral-400 @[500px]:table-cell">
                  {loading ? "---" : row.low > 0 ? formatPrice(row.low) : "--"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
