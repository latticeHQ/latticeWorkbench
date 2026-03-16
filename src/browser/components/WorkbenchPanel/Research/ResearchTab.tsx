/**
 * ResearchTab — Bloomberg Terminal-style financial research dashboard.
 *
 * Follows the same UX pattern as InferenceTab (Exo):
 * - Not installed → "Install" button
 * - Installed but not running → "Start Server" button (bootstraps first if needed)
 * - Starting → spinner
 * - Running → full Bloomberg dashboard with sidebar navigation to 16 views
 * - Error → error message
 */

import React, { useState, Suspense } from "react";
import {
  TrendingUp,
  RefreshCw,
  Download,
  Play,
  Square,
  Server,
  AlertCircle,
  Loader2,
  Database,
} from "lucide-react";
import { CommandBar } from "./CommandBar";
import { useOpenBBStatus } from "./useOpenBB";
import { ResearchProvider, useResearch, type TimeRange } from "./ResearchContext";
import { ResearchSidebar } from "./ResearchSidebar";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";

// ---------------------------------------------------------------------------
// Lazy-loaded views (code-split per view)
// ---------------------------------------------------------------------------

const DashboardView = React.lazy(() => import("./views/DashboardView").then((m) => ({ default: m.DashboardView })));
const EquityView = React.lazy(() => import("./views/EquityView").then((m) => ({ default: m.EquityView })));
const CryptoView = React.lazy(() => import("./views/CryptoView").then((m) => ({ default: m.CryptoView })));
const CurrencyView = React.lazy(() => import("./views/CurrencyView").then((m) => ({ default: m.CurrencyView })));
const CommodityView = React.lazy(() => import("./views/CommodityView").then((m) => ({ default: m.CommodityView })));
const IndicesView = React.lazy(() => import("./views/IndicesView").then((m) => ({ default: m.IndicesView })));
const OptionsView = React.lazy(() => import("./views/OptionsView").then((m) => ({ default: m.OptionsView })));
const FuturesView = React.lazy(() => import("./views/FuturesView").then((m) => ({ default: m.FuturesView })));
const EconomyView = React.lazy(() => import("./views/EconomyView").then((m) => ({ default: m.EconomyView })));
const FixedIncomeView = React.lazy(() => import("./views/FixedIncomeView").then((m) => ({ default: m.FixedIncomeView })));
const FredSeriesView = React.lazy(() => import("./views/FredSeriesView").then((m) => ({ default: m.FredSeriesView })));
const TechnicalView = React.lazy(() => import("./views/TechnicalView").then((m) => ({ default: m.TechnicalView })));
const FundamentalsView = React.lazy(() => import("./views/FundamentalsView").then((m) => ({ default: m.FundamentalsView })));
const EconometricsView = React.lazy(() => import("./views/EconometricsView").then((m) => ({ default: m.EconometricsView })));
const NewsView = React.lazy(() => import("./views/NewsView").then((m) => ({ default: m.NewsView })));
const SecFilingsView = React.lazy(() => import("./views/SecFilingsView").then((m) => ({ default: m.SecFilingsView })));
const WatchlistView = React.lazy(() => import("./views/WatchlistView").then((m) => ({ default: m.WatchlistView })));

interface ResearchTabProps {
  minionId: string;
}

const TIME_RANGES: TimeRange[] = ["1W", "1M", "3M", "6M", "1Y", "YTD"];

// ---------------------------------------------------------------------------
// Main component — switches on status like InferenceTab
// ---------------------------------------------------------------------------

const ResearchTabComponent: React.FC<ResearchTabProps> = ({ minionId }) => {
  const status = useOpenBBStatus();

  if (!status) {
    return <LoadingState />;
  }

  switch (status.status) {
    case "not_installed":
      return <NotInstalledView />;
    case "installed_not_running":
      return <NotRunningView minionId={minionId} bootstrapped={status.bootstrapped} />;
    case "starting":
      return <StartingView />;
    case "running":
      return (
        <ResearchProvider
          baseUrl={`${status.baseUrl}/api/v1`}
          port={status.port}
          endpointCount={status.endpointCount}
        >
          <DashboardShell />
        </ResearchProvider>
      );
    case "error":
      return <ErrorState message={status.message} />;
  }
};

export const ResearchTab = React.memo(ResearchTabComponent);

// ---------------------------------------------------------------------------
// Not Installed view
// ---------------------------------------------------------------------------

function NotInstalledView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-neutral-900 p-4">
        <Download className="h-8 w-8 text-neutral-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-neutral-200">Financial Data Platform Not Found</h3>
        <p className="mt-1 text-xs text-neutral-500">
          The financial data platform source is missing from{" "}
          <code className="rounded bg-neutral-800 px-1">tools/openbb-platform/</code>.
        </p>
      </div>
      <p className="max-w-sm text-[10px] text-neutral-600">
        Provides 271+ financial data API endpoints covering equities, commodities,
        crypto, forex, derivatives, economics, and more.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed but not running view
// ---------------------------------------------------------------------------

function NotRunningView({ minionId: _minionId, bootstrapped }: { minionId: string; bootstrapped: boolean }) {
  const { api } = useAPI();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    if (!api || starting) return;
    setStarting(true);
    setError(null);
    try {
      const result = await (api as any).openbb.start();
      if (result && result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-neutral-900 p-4">
        <Server className="h-8 w-8 text-neutral-500" />
      </div>
      <div>
        <h3 className="text-sm font-medium text-neutral-200">Financial Data Platform Ready</h3>
        <p className="mt-1 text-xs text-neutral-500">
          {bootstrapped
            ? "Python environment is set up. Start the financial data server."
            : "First start will set up the Python environment (~2 min), then start the server."}
        </p>
      </div>
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        className="inline-flex items-center gap-2 rounded-md bg-[#00ACFF] px-4 py-2 text-xs font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        {bootstrapped ? "Start Server" : "Install & Start"}
      </button>
      {error && (
        <p className="max-w-md text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Feature preview */}
      <div className="mt-4 w-full max-w-lg">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          Features
        </p>
        <div className="grid grid-cols-2 gap-1">
          {["Equities & ETFs", "Crypto", "Commodities & Futures", "FX Rates", "Market Indices", "Options Chains", "Economic Data", "SEC Filings", "Technical Analysis", "News"].map((feature) => (
            <div
              key={feature}
              className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1"
            >
              <span className="text-xs text-neutral-400">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="max-w-sm text-[10px] text-neutral-600">
        271+ API endpoints covering equities, commodities, crypto, forex, derivatives, economics, news, SEC filings, and more.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starting view
// ---------------------------------------------------------------------------

function StartingView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <RefreshCw className="h-10 w-10 animate-spin text-[#00ACFF]/40" />
      <div className="text-center">
        <h3 className="text-sm font-bold text-neutral-300">Starting Financial Data Server</h3>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-neutral-500">
          Financial data engine is initializing. First run sets up the Python environment (~2 min).
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running dashboard shell — sidebar + header + view router + status bar
// ---------------------------------------------------------------------------

function DashboardShell() {
  const { api } = useAPI();
  const {
    baseUrl,
    port,
    endpointCount,
    activeSymbol,
    setActiveSymbol,
    timeRange,
    setTimeRange,
    activeView,
    setActiveView,
    watchlist,
  } = useResearch();
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    if (!api || stopping) return;
    setStopping(true);
    try {
      await (api as any).openbb.stop();
    } catch (err) {
      console.error("Failed to stop OpenBB:", err);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#0a0a0a] font-mono text-white">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-[#00ACFF]" />
          <span className="text-sm font-bold text-[#00ACFF]">RESEARCH</span>
          <span className="text-xs text-neutral-500">Financial Data Terminal</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range selector */}
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range}
                type="button"
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                  timeRange === range
                    ? "bg-[#00ACFF] text-black"
                    : "text-neutral-400 hover:bg-neutral-800 hover:text-white"
                )}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </button>
            ))}
          </div>
          {/* Stop button */}
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-500 dark:text-neutral-400 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
            title="Stop data server"
          >
            {stopping ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            Stop
          </button>
        </div>
      </div>

      {/* Command bar */}
      <div className="border-b border-neutral-800 px-2 py-1">
        <CommandBar onSymbolSelect={setActiveSymbol} activeSymbol={activeSymbol} />
      </div>

      {/* Main content — sidebar + view */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar navigation */}
        <ResearchSidebar activeView={activeView} onViewChange={setActiveView} />

        {/* Active view */}
        <div className="min-h-0 min-w-0 flex-1">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <RefreshCw className="h-5 w-5 animate-spin text-neutral-600" />
              </div>
            }
          >
            <ViewRouter view={activeView} baseUrl={baseUrl} />
          </Suspense>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-neutral-800 px-2 py-0.5 text-[10px] text-neutral-600">
        <span>
          {activeSymbol && (
            <>
              <span className="text-[#00ACFF]">{activeSymbol}</span>
              <span className="mx-1">&middot;</span>
              <span>{watchlist[activeSymbol] ?? activeSymbol}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span>
            <Database className="mr-0.5 inline h-3 w-3" />
            {endpointCount} endpoints
          </span>
          <span>&middot;</span>
          <span>
            Lattice <span className="text-green-600">●</span> :{port}
          </span>
          <span>&middot;</span>
          <span>{timeRange}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View router — maps sidebar key to lazy-loaded view
// ---------------------------------------------------------------------------

function ViewRouter({ view, baseUrl }: { view: string; baseUrl: string }) {
  switch (view) {
    case "dashboard":
      return <DashboardView baseUrl={baseUrl} />;
    case "equity":
      return <EquityView baseUrl={baseUrl} />;
    case "crypto":
      return <CryptoView baseUrl={baseUrl} />;
    case "fx":
      return <CurrencyView baseUrl={baseUrl} />;
    case "commodities":
      return <CommodityView baseUrl={baseUrl} />;
    case "indices":
      return <IndicesView baseUrl={baseUrl} />;
    case "options":
      return <OptionsView baseUrl={baseUrl} />;
    case "futures":
      return <FuturesView baseUrl={baseUrl} />;
    case "economy":
      return <EconomyView baseUrl={baseUrl} />;
    case "fixed-income":
      return <FixedIncomeView baseUrl={baseUrl} />;
    case "fred":
      return <FredSeriesView baseUrl={baseUrl} />;
    case "technicals":
      return <TechnicalView baseUrl={baseUrl} />;
    case "fundamentals":
      return <FundamentalsView baseUrl={baseUrl} />;
    case "econometrics":
      return <EconometricsView baseUrl={baseUrl} />;
    case "news":
      return <NewsView baseUrl={baseUrl} />;
    case "sec-filings":
      return <SecFilingsView baseUrl={baseUrl} />;
    case "watchlist":
      return <WatchlistView baseUrl={baseUrl} />;
    default:
      return <DashboardView baseUrl={baseUrl} />;
  }
}

// ---------------------------------------------------------------------------
// Shared states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <RefreshCw className="h-5 w-5 animate-spin text-neutral-500" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertCircle className="h-6 w-6 text-red-500" />
      <p className="text-xs text-neutral-400">{message}</p>
    </div>
  );
}
