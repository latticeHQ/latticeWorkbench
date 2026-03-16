/**
 * Equity domain hooks — thin wrappers around useOpenBBQuery.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquityQuote {
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

export interface EquityProfile {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  description: string;
  website: string;
  market_cap: number;
  employees: number;
}

export interface EquitySearchResult {
  symbol: string;
  name: string;
  exchange: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useEquityQuote(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<EquityQuote[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<EquityQuote[]>(
    "/equity/price/quote",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useEquityProfile(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<EquityProfile[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<EquityProfile[]>(
    "/equity/profile",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useEquitySearch(
  query: string,
  baseUrl: string | null,
): FetchState<EquitySearchResult[]> {
  const params = useMemo(() => ({ query }), [query]);
  return useOpenBBQuery<EquitySearchResult[]>(
    "/equity/search",
    params,
    baseUrl,
    { enabled: query.length > 0 },
  );
}
