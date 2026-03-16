/**
 * Commodity domain hooks — thin wrappers around useOpenBBQuery.
 *
 * Uses futures tickers (GC=F gold, SI=F silver, CL=F crude) via yfinance.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommodityQuote {
  symbol: string;
  name: string;
  last_price: number;
  change: number;
  change_percent: number;
  volume: number;
  high: number;
  low: number;
}

/** Well-known commodity futures tickers for yfinance. */
export const COMMODITY_TICKERS: Record<string, string> = {
  "GC=F": "Gold",
  "SI=F": "Silver",
  "CL=F": "Crude Oil (WTI)",
  "HG=F": "Copper",
  "PL=F": "Platinum",
  "PA=F": "Palladium",
  "NG=F": "Natural Gas",
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Fetch a quote for a single commodity futures ticker.
 * Uses the equity/price/quote endpoint since yfinance treats futures tickers
 * identically to equities.
 */
export function useCommoditySpot(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<CommodityQuote[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<CommodityQuote[]>(
    "/equity/price/quote",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}
