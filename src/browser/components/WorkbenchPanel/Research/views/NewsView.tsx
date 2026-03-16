/**
 * NewsView — Expanded full-page news feed for multiple symbols with filtering.
 */

import React, { useState, useMemo } from "react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import type { NewsItem } from "../useOpenBB";
import { cn } from "@/common/lib/utils";

interface NewsViewProps {
  baseUrl: string;
}

export const NewsView: React.FC<NewsViewProps> = ({ baseUrl }) => {
  const { watchlist } = useResearch();
  const [filterSymbol, setFilterSymbol] = useState("ALL");
  const [customSymbol, setCustomSymbol] = useState("");

  const quickFilters = useMemo(() => ["ALL", ...Object.keys(watchlist)], [watchlist]);
  const allSymbols = useMemo(() => Object.keys(watchlist).join(","), [watchlist]);
  const news = useOpenBBQuery<NewsItem[]>(
    "/news/company",
    { symbol: allSymbols, provider: "yfinance", limit: "50" },
    baseUrl,
  );

  const filteredNews = useMemo(() => {
    if (!news.data) return [];
    if (filterSymbol === "ALL") return news.data;
    return news.data.filter(
      (item) => item.symbols?.some((s) => s.toUpperCase() === filterSymbol.toUpperCase()) ?? false,
    );
  }, [news.data, filterSymbol]);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customSymbol.trim().toUpperCase();
    if (trimmed) setFilterSymbol(trimmed);
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Filter bar */}
      <div className="border-b border-neutral-800 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Filter</span>
          <div className="flex flex-wrap items-center gap-1">
            {quickFilters.map((sym) => (
              <button
                key={sym}
                type="button"
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  filterSymbol === sym ? "bg-[#00ACFF] text-black" : "text-neutral-400 hover:bg-neutral-800 hover:text-white",
                )}
                onClick={() => setFilterSymbol(sym)}
              >
                {sym}
              </button>
            ))}
          </div>
          <form onSubmit={handleCustomSubmit} className="ml-2 flex items-center gap-1">
            <input
              type="text"
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value)}
              placeholder="Custom..."
              className="w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] text-white placeholder-neutral-500 focus:border-[#00ACFF] focus:outline-none"
            />
          </form>
          <span className="ml-auto text-[10px] text-neutral-600">
            {filteredNews.length} articles
          </span>
        </div>
      </div>

      {/* News list */}
      <div className="flex-1 overflow-auto">
        {news.loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse space-y-1">
                <div className="h-3 w-3/4 rounded bg-neutral-800" />
                <div className="h-2 w-1/3 rounded bg-neutral-800" />
              </div>
            ))}
          </div>
        ) : news.error ? (
          <div className="flex h-full items-center justify-center text-xs text-red-600 dark:text-red-400">
            {news.error}
          </div>
        ) : filteredNews.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-neutral-500">
            No news found {filterSymbol !== "ALL" ? `for ${filterSymbol}` : ""}
          </div>
        ) : (
          filteredNews.map((item, i) => (
            <a
              key={`${item.url}-${i}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block border-b border-neutral-800/50 px-3 py-2 transition-colors hover:bg-neutral-800/30"
            >
              <div className="text-xs leading-tight text-neutral-200">{item.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
                <span className="font-medium text-[#00ACFF]">{item.source}</span>
                {item.date && <span>{new Date(item.date).toLocaleDateString()}</span>}
                {item.symbols && item.symbols.length > 0 && (
                  <span className="text-neutral-400">
                    {item.symbols.map((s) => `$${s}`).join(" ")}
                  </span>
                )}
              </div>
            </a>
          ))
        )}
      </div>
    </div>
  );
};
