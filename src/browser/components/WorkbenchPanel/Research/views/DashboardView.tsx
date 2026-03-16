/**
 * DashboardView — Default Bloomberg-style dashboard.
 * Chart + watchlist + news in resizable panels.
 *
 * Uses per-symbol quote fetching (useQuotes) for reliable data across
 * equities, ETFs, and any other symbol types.
 */

import React, { Suspense, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { MarketTable } from "../MarketTable";
import { NewsFeed } from "../NewsFeed";
import { WatchlistManager } from "../components/WatchlistManager";
import { useQuotes } from "../useOpenBB";
import type { OHLCVData, NewsItem } from "../useOpenBB";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);

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

interface DashboardViewProps {
  baseUrl: string;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ baseUrl }) => {
  const { activeSymbol, setActiveSymbol, timeRange, watchlist } = useResearch();
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);
  const symbols = useMemo(() => Object.keys(watchlist), [watchlist]);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: activeSymbol, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  const news = useOpenBBQuery<NewsItem[]>(
    "/news/company",
    { symbol: symbols.slice(0, 3).join(","), provider: "yfinance", limit: "15" },
    baseUrl,
  );

  // Fetch quotes per-symbol for reliable results across equities, ETFs, etc.
  const quotes = useQuotes(symbols, baseUrl);

  return (
    <PanelGroup direction="horizontal" className="h-full">
      {/* Left: Chart + News */}
      <Panel defaultSize={65} minSize={40}>
        <PanelGroup direction="vertical">
          <Panel defaultSize={70} minSize={30}>
            <div className="h-full overflow-hidden">
              {priceHistory.loading && !priceHistory.data ? (
                <div className="flex h-full items-center justify-center">
                  <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
                </div>
              ) : priceHistory.error ? (
                <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                  {priceHistory.error}
                </div>
              ) : priceHistory.data && priceHistory.data.length > 0 ? (
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center">
                      <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
                    </div>
                  }
                >
                  <CandlestickChart data={priceHistory.data} symbol={activeSymbol} />
                </Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                  Select a symbol to view chart
                </div>
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
          <Panel defaultSize={30} minSize={15}>
            <div className="h-full">
              <div className="border-b border-neutral-800 px-2 py-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                  News Feed
                </span>
              </div>
              <NewsFeed data={news.data} loading={news.loading} error={news.error} />
            </div>
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className="w-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      {/* Right: Watchlist */}
      <Panel defaultSize={35} minSize={20}>
        <div className="flex h-full flex-col">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Watchlist
            </span>
          </div>
          <WatchlistManager />
          <div className="min-h-0 flex-1">
            <MarketTable
              data={quotes.data}
              loading={quotes.loading}
              error={quotes.error}
              onSymbolClick={setActiveSymbol}
              activeSymbol={activeSymbol}
              watchlist={watchlist}
            />
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
};
