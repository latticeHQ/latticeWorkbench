/**
 * Crypto domain hooks — thin wrappers around useOpenBBQuery.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CryptoOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoSearchResult {
  symbol: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCryptoHistory(
  symbol: string | null,
  startDate?: string,
  baseUrl?: string | null,
): FetchState<CryptoOHLCV[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (symbol) p.symbol = symbol;
    if (startDate) p.start_date = startDate;
    return p;
  }, [symbol, startDate]);

  return useOpenBBQuery<CryptoOHLCV[]>(
    "/crypto/price/historical",
    params,
    baseUrl ?? null,
    { enabled: !!symbol },
  );
}

export function useCryptoSearch(
  query: string,
  baseUrl: string | null,
): FetchState<CryptoSearchResult[]> {
  const params = useMemo(() => ({ query }), [query]);
  return useOpenBBQuery<CryptoSearchResult[]>(
    "/crypto/search",
    params,
    baseUrl,
    { enabled: query.length > 0 },
  );
}
