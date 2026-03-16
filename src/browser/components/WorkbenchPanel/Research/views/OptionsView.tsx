/**
 * OptionsView — Options chain display with calls/puts table.
 */

import React, { useState, useEffect } from "react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { cn } from "@/common/lib/utils";

interface OptionContract {
  contract_symbol?: string;
  strike?: number;
  bid?: number;
  ask?: number;
  last_price?: number;
  volume?: number;
  open_interest?: number;
  implied_volatility?: number;
  expiration?: string;
  option_type?: string;
}

interface OptionsViewProps {
  baseUrl: string;
}

export const OptionsView: React.FC<OptionsViewProps> = ({ baseUrl }) => {
  const { activeSymbol } = useResearch();
  const [symbol, setSymbol] = useState(activeSymbol);
  const [input, setInput] = useState(activeSymbol);
  const [showCalls, setShowCalls] = useState(true);

  // Sync with context when activeSymbol changes externally
  useEffect(() => {
    if (activeSymbol && activeSymbol !== symbol) {
      setSymbol(activeSymbol);
      setInput(activeSymbol);
    }
  }, [activeSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const chains = useOpenBBQuery<OptionContract[]>(
    "/derivatives/options/chains",
    { symbol, provider: "yfinance" },
    baseUrl,
    { enabled: !!symbol },
  );

  const calls = (chains.data ?? []).filter((c) => c.option_type === "call");
  const puts = (chains.data ?? []).filter((c) => c.option_type === "put");
  const display = showCalls ? calls : puts;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) setSymbol(trimmed);
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Symbol input */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Symbol..."
            className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
          />
          <button
            type="submit"
            className="rounded bg-[#00ACFF] px-2 py-1 text-xs font-medium text-black hover:opacity-90"
          >
            Load
          </button>
        </form>
        <div className="flex items-center gap-1 ml-4">
          <button
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              showCalls ? "bg-[#00ACFF] text-black" : "text-neutral-400 hover:bg-neutral-800",
            )}
            onClick={() => setShowCalls(true)}
          >
            Calls ({calls.length})
          </button>
          <button
            type="button"
            className={cn(
              "rounded px-2 py-1 text-xs font-medium transition-colors",
              !showCalls ? "bg-[#e4003a] text-white" : "text-neutral-400 hover:bg-neutral-800",
            )}
            onClick={() => setShowCalls(false)}
          >
            Puts ({puts.length})
          </button>
        </div>
        <span className="ml-auto text-[10px] text-neutral-500">
          {symbol} Options Chain
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {chains.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            Loading options chain...
          </div>
        ) : chains.error ? (
          <div className="flex h-full items-center justify-center text-xs text-red-600 dark:text-red-400">
            {chains.error}
          </div>
        ) : display.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            No {showCalls ? "call" : "put"} options found for {symbol}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
              <tr className="border-b border-neutral-800 text-left">
                <th className="px-2 py-1.5 font-mono font-medium text-neutral-400">Expiry</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Strike</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Bid</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Ask</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Last</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">Volume</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">OI</th>
                <th className="px-2 py-1.5 text-right font-mono font-medium text-neutral-400">IV</th>
              </tr>
            </thead>
            <tbody>
              {display.slice(0, 100).map((opt, i) => (
                <tr
                  key={opt.contract_symbol ?? i}
                  className="border-b border-neutral-800/50 hover:bg-neutral-800/30"
                >
                  <td className="px-2 py-1 text-neutral-300">
                    {opt.expiration ? new Date(opt.expiration).toLocaleDateString() : "--"}
                  </td>
                  <td className="px-2 py-1 text-right font-bold text-white">
                    {opt.strike != null ? `$${opt.strike.toFixed(2)}` : "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-300">
                    {opt.bid != null ? `$${opt.bid.toFixed(2)}` : "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-300">
                    {opt.ask != null ? `$${opt.ask.toFixed(2)}` : "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-white">
                    {opt.last_price != null ? `$${opt.last_price.toFixed(2)}` : "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-400">
                    {opt.volume?.toLocaleString() ?? "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-400">
                    {opt.open_interest?.toLocaleString() ?? "--"}
                  </td>
                  <td className="px-2 py-1 text-right text-neutral-400">
                    {opt.implied_volatility != null ? `${(opt.implied_volatility * 100).toFixed(1)}%` : "--"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
