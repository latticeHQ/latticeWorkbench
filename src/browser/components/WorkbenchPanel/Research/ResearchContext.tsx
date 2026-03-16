/**
 * ResearchContext — shared state for the expanded Research tab.
 *
 * Provides connection info (baseUrl, port, endpointCount) and UI state
 * (activeSymbol, timeRange, activeView, watchlist) to all child components
 * so they don't need prop-drilling.
 *
 * The watchlist is persisted in localStorage so user customizations survive
 * across sessions.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { DEFAULT_WATCHLIST } from "./useOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TimeRange = "1W" | "1M" | "3M" | "6M" | "1Y" | "YTD";

/** A single watchlist entry: ticker → display name. */
export type Watchlist = Record<string, string>;

export interface ResearchContextValue {
  /** OpenBB API base URL (e.g. http://localhost:6900/api/v1). */
  baseUrl: string;
  /** Port the OpenBB server is running on. */
  port: number;
  /** Number of registered API endpoints. */
  endpointCount: number;

  /** Currently-selected ticker symbol. */
  activeSymbol: string;
  setActiveSymbol: (symbol: string) => void;

  /** Selected time range for charts. */
  timeRange: TimeRange;
  setTimeRange: (range: TimeRange) => void;

  /** Active sidebar view / page key. */
  activeView: string;
  setActiveView: (view: string) => void;

  /** User-configurable watchlist (persisted to localStorage). */
  watchlist: Watchlist;
  addToWatchlist: (symbol: string, name?: string) => void;
  removeFromWatchlist: (symbol: string) => void;
  /** Replace the entire watchlist (for bulk import). */
  setWatchlist: (wl: Watchlist) => void;
}

const ResearchCtx = createContext<ResearchContextValue | null>(null);

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const WATCHLIST_KEY = "lattice:research:watchlist";

function loadWatchlist(): Watchlist {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Watchlist;
      }
    }
  } catch { /* ignore */ }
  // Return defaults on first use
  return { ...DEFAULT_WATCHLIST };
}

function saveWatchlist(wl: Watchlist): void {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(wl));
  } catch { /* ignore quota errors */ }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ResearchProviderProps {
  baseUrl: string;
  port: number;
  endpointCount: number;
  children: React.ReactNode;
}

export const ResearchProvider: React.FC<ResearchProviderProps> = ({
  baseUrl,
  port,
  endpointCount,
  children,
}) => {
  const [watchlist, setWatchlistState] = useState<Watchlist>(loadWatchlist);
  const [activeSymbol, setActiveSymbol] = useState<string>(() => {
    const symbols = Object.keys(loadWatchlist());
    return symbols[0] ?? "MP";
  });
  const [timeRange, setTimeRange] = useState<TimeRange>("3M");
  const [activeView, setActiveView] = useState<string>("dashboard");

  const addToWatchlist = useCallback((symbol: string, name?: string) => {
    setWatchlistState((prev) => {
      const next = { ...prev, [symbol.toUpperCase()]: name ?? symbol.toUpperCase() };
      saveWatchlist(next);
      return next;
    });
  }, []);

  const removeFromWatchlist = useCallback((symbol: string) => {
    setWatchlistState((prev) => {
      const next = { ...prev };
      delete next[symbol];
      saveWatchlist(next);
      return next;
    });
  }, []);

  const setWatchlist = useCallback((wl: Watchlist) => {
    setWatchlistState(wl);
    saveWatchlist(wl);
  }, []);

  const value = useMemo<ResearchContextValue>(
    () => ({
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
      addToWatchlist,
      removeFromWatchlist,
      setWatchlist,
    }),
    [baseUrl, port, endpointCount, activeSymbol, timeRange, activeView, watchlist, addToWatchlist, removeFromWatchlist, setWatchlist],
  );

  return <ResearchCtx.Provider value={value}>{children}</ResearchCtx.Provider>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useResearch(): ResearchContextValue {
  const ctx = useContext(ResearchCtx);
  if (!ctx) {
    throw new Error("useResearch must be used within a <ResearchProvider>");
  }
  return ctx;
}
