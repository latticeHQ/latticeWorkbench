/**
 * EquityView — Full equity deep-dive with chart, quote card, profile, and news.
 */

import React, { Suspense, useMemo } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { useResearch } from "../ResearchContext";
import { useOpenBBQuery } from "../hooks/useFetchOpenBB";
import { NewsFeed } from "../NewsFeed";
import { normalizeQuote, formatPrice, formatPercent, formatMarketCap, formatVolume } from "../utils/quoteUtils";
import type { OHLCVData, NewsItem } from "../useOpenBB";

const CandlestickChart = React.lazy(() =>
  import("../CandlestickChart").then((mod) => ({ default: mod.CandlestickChart }))
);

// QuoteResult removed — using normalizeQuote() from quoteUtils instead

interface ProfileResult {
  company_name?: string;
  sector?: string;
  industry?: string;
  description?: string;
  website?: string;
  employees?: number;
  country?: string;
}

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

interface EquityViewProps {
  baseUrl: string;
}

export const EquityView: React.FC<EquityViewProps> = ({ baseUrl }) => {
  const { activeSymbol, timeRange } = useResearch();
  const startDate = useMemo(() => getStartDate(timeRange), [timeRange]);

  const priceHistory = useOpenBBQuery<OHLCVData[]>(
    "/equity/price/historical",
    { symbol: activeSymbol, start_date: startDate, interval: "1d", provider: "yfinance" },
    baseUrl,
  );

  const quote = useOpenBBQuery<Record<string, unknown>[]>(
    "/equity/price/quote",
    { symbol: activeSymbol, provider: "yfinance" },
    baseUrl,
  );

  const profile = useOpenBBQuery<ProfileResult[]>(
    "/equity/profile",
    { symbol: activeSymbol, provider: "yfinance" },
    baseUrl,
  );

  const news = useOpenBBQuery<NewsItem[]>(
    "/news/company",
    { symbol: activeSymbol, provider: "yfinance", limit: "10" },
    baseUrl,
  );

  const nq = useMemo(() => {
    if (!quote.data?.[0]) return null;
    return normalizeQuote(quote.data[0], activeSymbol);
  }, [quote.data, activeSymbol]);
  const p = profile.data?.[0];

  return (
    <PanelGroup direction="vertical" className="h-full">
      {/* Top: Chart + Quote */}
      <Panel defaultSize={65} minSize={35}>
        <PanelGroup direction="horizontal">
          <Panel defaultSize={70} minSize={40}>
            <div className="h-full overflow-hidden">
              {priceHistory.loading && !priceHistory.data ? (
                <div className="flex h-full items-center justify-center">
                  <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
                </div>
              ) : priceHistory.data && priceHistory.data.length > 0 ? (
                <Suspense fallback={<div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>}>
                  <CandlestickChart data={priceHistory.data} symbol={activeSymbol} />
                </Suspense>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-neutral-500">
                  {priceHistory.error ?? "No data available"}
                </div>
              )}
            </div>
          </Panel>
          <PanelResizeHandle className="w-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
          <Panel defaultSize={30} minSize={20}>
            <div className="h-full overflow-auto p-3 font-mono text-xs">
              {/* Quote Card */}
              <div className="mb-4">
                <div className="text-lg font-bold text-[#00ACFF]">{activeSymbol}</div>
                <div className="mt-1 text-2xl font-bold text-white">
                  {quote.loading ? "---" : formatPrice(nq?.price ?? 0)}
                </div>
                <div className={`mt-0.5 text-sm font-medium ${(nq?.changePercent ?? 0) >= 0 ? "text-[#00ACFF]" : "text-[#e4003a]"}`}>
                  {quote.loading ? "---" : formatPercent(nq?.changePercent ?? 0)}
                </div>
              </div>
              {/* Stats */}
              <div className="space-y-1 border-t border-neutral-800 pt-2">
                <StatRow label="Market Cap" value={formatMarketCap(nq?.marketCap ?? 0)} loading={quote.loading} />
                <StatRow label="Volume" value={formatVolume(nq?.volume ?? 0)} loading={quote.loading} />
                <StatRow label="52W High" value={formatPrice(nq?.yearHigh ?? 0)} loading={quote.loading} />
                <StatRow label="52W Low" value={formatPrice(nq?.yearLow ?? 0)} loading={quote.loading} />
                <StatRow label="Prev Close" value={formatPrice(nq?.prevClose ?? 0)} loading={quote.loading} />
              </div>
              {/* Profile */}
              {p && (
                <div className="mt-4 space-y-1 border-t border-neutral-800 pt-2">
                  <div className="font-medium text-neutral-300">{p.company_name}</div>
                  {p.sector && <div className="text-neutral-500">Sector: <span className="text-neutral-300">{p.sector}</span></div>}
                  {p.industry && <div className="text-neutral-500">Industry: <span className="text-neutral-300">{p.industry}</span></div>}
                  {p.country && <div className="text-neutral-500">Country: <span className="text-neutral-300">{p.country}</span></div>}
                  {p.employees && <div className="text-neutral-500">Employees: <span className="text-neutral-300">{p.employees.toLocaleString()}</span></div>}
                  {p.description && (
                    <div className="mt-2 text-[10px] leading-relaxed text-neutral-500 line-clamp-6">{p.description}</div>
                  )}
                </div>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </Panel>
      <PanelResizeHandle className="h-px bg-neutral-800 hover:bg-[#00ACFF]/50" />
      {/* Bottom: News */}
      <Panel defaultSize={35} minSize={15}>
        <div className="h-full">
          <div className="border-b border-neutral-800 px-2 py-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              News — {activeSymbol}
            </span>
          </div>
          <NewsFeed data={news.data} loading={news.loading} error={news.error} />
        </div>
      </Panel>
    </PanelGroup>
  );
};

function StatRow({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{loading ? "---" : value}</span>
    </div>
  );
}

