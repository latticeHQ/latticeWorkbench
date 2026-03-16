/**
 * Currency / FX domain hooks — thin wrappers around useOpenBBQuery.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurrencyOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CurrencySnapshot {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  change: number;
  change_percent: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCurrencyHistory(
  symbol: string | null,
  startDate?: string,
  baseUrl?: string | null,
): FetchState<CurrencyOHLCV[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (symbol) p.symbol = symbol;
    if (startDate) p.start_date = startDate;
    return p;
  }, [symbol, startDate]);

  return useOpenBBQuery<CurrencyOHLCV[]>(
    "/currency/price/historical",
    params,
    baseUrl ?? null,
    { enabled: !!symbol },
  );
}

export function useCurrencySnapshots(
  baseUrl: string | null,
): FetchState<CurrencySnapshot[]> {
  const params = useMemo(() => ({}), []);
  return useOpenBBQuery<CurrencySnapshot[]>(
    "/currency/snapshots",
    params,
    baseUrl,
  );
}
