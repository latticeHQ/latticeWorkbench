/**
 * FundamentalsView — Equity fundamentals: income statement, balance sheet, cash flow.
 */

import React, { useState } from "react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { cn } from "@/common/lib/utils";

type FundamentalsTab = "income" | "balance" | "cash_flow";

const TAB_CONFIG: Record<FundamentalsTab, { label: string; path: string }> = {
  income: { label: "Income Statement", path: "/equity/fundamental/income" },
  balance: { label: "Balance Sheet", path: "/equity/fundamental/balance" },
  cash_flow: { label: "Cash Flow", path: "/equity/fundamental/cash" },
};

interface FundamentalsViewProps {
  baseUrl: string;
}

export const FundamentalsView: React.FC<FundamentalsViewProps> = ({ baseUrl }) => {
  const { activeSymbol } = useResearch();
  const [tab, setTab] = useState<FundamentalsTab>("income");

  const data = useOpenBBQuery<Record<string, unknown>[]>(
    TAB_CONFIG[tab].path,
    { symbol: activeSymbol, provider: "yfinance", period: "annual", limit: "5" },
    baseUrl,
  );

  // Extract column headers from data keys (excluding date/period fields)
  const rows = data.data ?? [];
  const columns = rows.length > 0
    ? Object.keys(rows[0]).filter((k) => k !== "symbol" && k !== "cik" && k !== "accepted_date")
    : [];

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Tab selector */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="text-sm font-bold text-[#00ACFF]">{activeSymbol}</span>
        <span className="text-[10px] text-neutral-500">Fundamentals</span>
        <div className="flex items-center gap-1 ml-4">
          {(Object.entries(TAB_CONFIG) as [FundamentalsTab, { label: string }][]).map(([key, { label }]) => (
            <button
              key={key}
              type="button"
              className={cn(
                "rounded px-2 py-1 text-xs font-medium transition-colors",
                tab === key ? "bg-[#00ACFF] text-black" : "text-neutral-400 hover:bg-neutral-800",
              )}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Data table */}
      <div className="flex-1 overflow-auto">
        {data.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            Loading {TAB_CONFIG[tab].label.toLowerCase()}...
          </div>
        ) : data.error ? (
          <div className="flex h-full items-center justify-center text-xs text-red-600 dark:text-red-400">
            {data.error}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            No fundamental data for {activeSymbol}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800">
                {columns.map((col) => (
                  <th
                    key={col}
                    className="whitespace-nowrap px-2 py-1.5 text-right font-mono font-medium text-neutral-400 first:text-left"
                  >
                    {formatColumnName(col)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  {columns.map((col) => {
                    const val = row[col];
                    return (
                      <td
                        key={col}
                        className="whitespace-nowrap px-2 py-1 text-right text-neutral-300 first:text-left first:font-medium first:text-white"
                      >
                        {formatValue(val)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

function formatColumnName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Ebitda/gi, "EBITDA")
    .replace(/Eps/gi, "EPS");
}

function formatValue(val: unknown): string {
  if (val == null) return "--";
  if (typeof val === "number") {
    if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
    if (Number.isInteger(val)) return val.toLocaleString();
    return val.toFixed(2);
  }
  return String(val);
}
