/**
 * OpenBB API data hooks for the Research tab.
 *
 * Follows the same pattern as InferenceTab (Exo):
 * - useOpenBBStatus() — subscribes to status changes via oRPC
 * - Data hooks use the dynamic baseUrl from the running service
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { z } from "zod";
import type { OpenBBStatusSchema } from "@/common/orpc/schemas/api";
import { normalizeQuote } from "./utils/quoteUtils";
import type { NormalizedQuote } from "./utils/quoteUtils";
import { fetchOpenBB } from "./hooks/useFetchOpenBB";

export type OpenBBStatus = z.infer<typeof OpenBBStatusSchema>;

export interface OHLCVData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteData {
  symbol: string;
  name: string;
  last_price: number;
  change: number;
  change_percent: number;
  volume: number;
  market_cap?: number;
  high: number;
  low: number;
  prev_close: number;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string;
  source: string;
  symbols?: string[];
}

// Default watchlist symbols (shown on first use before user customizes)
export const DEFAULT_WATCHLIST: Record<string, string> = {
  AAPL: "Apple Inc",
  MSFT: "Microsoft",
  GOOGL: "Alphabet",
  AMZN: "Amazon",
  NVDA: "NVIDIA",
  SPY: "S&P 500 ETF",
  QQQ: "Nasdaq 100 ETF",
};

/** @deprecated Use DEFAULT_WATCHLIST instead */
export const ALL_TRACKED_SYMBOLS = DEFAULT_WATCHLIST;

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Status hook (like InferenceTab's useEffect for Exo)
// ---------------------------------------------------------------------------

/**
 * Subscribe to OpenBB service status changes.
 * Returns the current status (discriminated union) exactly like Exo.
 */
export function useOpenBBStatus(): OpenBBStatus | null {
  const { api } = useAPI();
  const [status, setStatus] = useState<OpenBBStatus | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await (api as any).openbb.getStatus();
        if (!cancelled) setStatus(result as OpenBBStatus);
      } catch (err) {
        if (!cancelled) setStatus({ status: "error", message: String(err) });
      }
    }

    async function subscribe() {
      try {
        const stream = await (api as any).openbb.subscribe(
          undefined,
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setStatus(snapshot as OpenBBStatus);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Research: OpenBB subscription error:", err);
        }
      }
    }

    void load();
    void subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api]);

  return status;
}

/**
 * Get the OpenBB API base URL if running, or null.
 */
export function useOpenBBBaseUrl(status: OpenBBStatus | null): string | null {
  if (status?.status === "running") {
    return `${status.baseUrl}/api/v1`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Data fetching — uses shared fetchOpenBB from hooks/useFetchOpenBB
// ---------------------------------------------------------------------------

/**
 * Fetch OHLCV price history for a symbol.
 */
export function usePriceHistory(
  symbol: string | null,
  startDate?: string,
  endDate?: string,
  interval: string = "1d",
  baseUrl: string | null = null,
): FetchState<OHLCVData[]> {
  const [state, setState] = useState<FetchState<OHLCVData[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!symbol || !baseUrl) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params: Record<string, string> = { symbol, interval, provider: "yfinance" };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;

    fetchOpenBB<OHLCVData[]>(baseUrl, "/equity/price/historical", params)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({ data: null, loading: false, error: err.message });
        }
      });

    return () => controller.abort();
  }, [symbol, startDate, endDate, interval, baseUrl]);

  return state;
}

/**
 * Fetch quotes for multiple symbols.
 * Uses normalizeQuote() to handle all yfinance field-name variations.
 */
export function useQuotes(symbols: string[], baseUrl: string | null = null): FetchState<NormalizedQuote[]> {
  const [state, setState] = useState<FetchState<NormalizedQuote[]>>({
    data: null,
    loading: false,
    error: null,
  });

  const symbolsKey = symbols.join(",");

  const refresh = useCallback(async () => {
    if (symbols.length === 0 || !baseUrl) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const quotes: NormalizedQuote[] = [];
      for (const symbol of symbols) {
        try {
          const result = await fetchOpenBB<Record<string, unknown>[]>(baseUrl, "/equity/price/quote", { symbol, provider: "yfinance" });
          if (Array.isArray(result) && result.length > 0) {
            let nq = normalizeQuote(result[0], symbol);

            // yfinance quote endpoint omits price/last_price/close for some ETFs/futures.
            // When price is missing, fetch the last close from historical data and mark it
            // as priceSource="close" so the UI can display it honestly (not as real-time).
            if (nq.price === 0) {
              try {
                const today = new Date();
                const weekAgo = new Date(today);
                weekAgo.setDate(weekAgo.getDate() - 7);
                const startDate = weekAgo.toISOString().slice(0, 10);
                const hist = await fetchOpenBB<OHLCVData[]>(baseUrl, "/equity/price/historical", {
                  symbol,
                  provider: "yfinance",
                  interval: "1d",
                  start_date: startDate,
                });
                if (Array.isArray(hist) && hist.length > 0) {
                  const latest = hist[hist.length - 1];
                  const closePrice = latest.close;
                  if (closePrice > 0) {
                    const prevCl = nq.prevClose > 0 ? nq.prevClose : (hist.length > 1 ? hist[hist.length - 2].close : 0);
                    const chg = prevCl > 0 ? closePrice - prevCl : 0;
                    const chgPct = prevCl > 0 ? (chg / prevCl) * 100 : 0;
                    nq = {
                      ...nq,
                      price: closePrice,
                      change: chg,
                      changePercent: chgPct,
                      prevClose: prevCl || nq.prevClose,
                      high: nq.high || latest.high,
                      low: nq.low || latest.low,
                      open: nq.open || latest.open,
                      priceSource: "close", // Mark as historical close, NOT real-time
                    };
                  }
                }
              } catch {
                // Historical fallback failed — keep quote data as-is
              }
            }

            quotes.push(nq);
          } else {
            quotes.push({
              symbol,
              name: "",
              price: 0, change: 0, changePercent: 0, volume: 0,
              marketCap: 0, high: 0, low: 0, prevClose: 0,
              yearHigh: 0, yearLow: 0, open: 0, priceSource: "none",
            });
          }
        } catch {
          quotes.push({
            symbol,
            name: "",
            price: 0, change: 0, changePercent: 0, volume: 0,
            marketCap: 0, high: 0, low: 0, prevClose: 0,
            yearHigh: 0, yearLow: 0, open: 0, priceSource: "none",
          });
        }
      }
      setState({ data: quotes, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [symbolsKey, baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return state;
}

/**
 * Fetch financial news for a set of symbols.
 */
export function useFinancialNews(
  symbols: string[] = [],
  limit: number = 15,
  baseUrl: string | null = null,
): FetchState<NewsItem[]> {
  const [state, setState] = useState<FetchState<NewsItem[]>>({
    data: null,
    loading: false,
    error: null,
  });

  const symbolsKey = symbols.slice(0, 3).join(",");

  useEffect(() => {
    if (!baseUrl || !symbolsKey) return;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetchOpenBB<NewsItem[]>(baseUrl, "/news/company", {
      symbol: symbolsKey,
      provider: "yfinance",
      limit: String(limit),
    })
      .then((data) => setState({ data, loading: false, error: null }))
      .catch((err) =>
        setState({ data: null, loading: false, error: err.message })
      );
  }, [symbolsKey, limit, baseUrl]);

  return state;
}
