/**
 * Command bar — Bloomberg-style ticker search and command input.
 * Type a ticker to view its chart, or pick from the watchlist.
 *
 * Uses the dynamic watchlist from ResearchContext (not hardcoded).
 */

import React, { useState, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import { useResearch } from "./ResearchContext";
import { cn } from "@/common/lib/utils";

interface CommandBarProps {
  onSymbolSelect: (symbol: string) => void;
  activeSymbol: string | null;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  onSymbolSelect,
  activeSymbol,
}) => {
  const { watchlist } = useResearch();
  const [query, setQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = React.useMemo(() => {
    const entries = Object.entries(watchlist);
    if (!query.trim()) return entries;
    const q = query.toUpperCase();
    return entries.filter(
      ([symbol, name]) =>
        symbol.toUpperCase().includes(q) || name.toUpperCase().includes(q)
    );
  }, [query, watchlist]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim().toUpperCase();
    if (trimmed) {
      onSymbolSelect(trimmed);
      setQuery("");
      setShowSuggestions(false);
    }
  };

  const handleSelect = (symbol: string) => {
    onSymbolSelect(symbol);
    setQuery("");
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <form onSubmit={handleSubmit} className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder={activeSymbol ? `${activeSymbol} — Search symbol...` : "Search any symbol (AAPL, BTC-USD, GC=F...)"}
            className={cn(
              "w-full rounded bg-neutral-900 py-1 pl-7 pr-2 text-xs font-mono",
              "text-white placeholder-neutral-500",
              "border border-neutral-700 focus:border-[#00ACFF] focus:outline-none",
              "transition-colors"
            )}
          />
        </div>
      </form>

      {showSuggestions && (suggestions.length > 0 || query.trim()) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-auto rounded border border-neutral-700 bg-neutral-900 shadow-xl">
          {/* If user typed something not in watchlist, offer to search it */}
          {query.trim() && !suggestions.some(([s]) => s.toUpperCase() === query.trim().toUpperCase()) && (
            <button
              type="button"
              className="flex w-full items-center gap-2 border-b border-neutral-800 px-2 py-1.5 text-left text-xs transition-colors hover:bg-neutral-800"
              onClick={() => handleSelect(query.trim().toUpperCase())}
            >
              <Search className="h-3 w-3 shrink-0 text-neutral-500" />
              <span className="font-mono font-bold text-white">{query.trim().toUpperCase()}</span>
              <span className="text-neutral-500">— Look up this symbol</span>
            </button>
          )}
          {suggestions.map(([symbol, name]) => (
            <button
              key={symbol}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1 text-left text-xs transition-colors",
                "hover:bg-neutral-800",
                symbol === activeSymbol && "bg-[#00ACFF]/10"
              )}
              onClick={() => handleSelect(symbol)}
            >
              <span className="w-16 shrink-0 font-mono font-bold text-[#00ACFF]">{symbol}</span>
              <span className="truncate text-neutral-400">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
