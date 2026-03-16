/**
 * Index domain hooks — index history and constituents.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndexConstituent {
  symbol: string;
  name: string;
  sector: string;
  weight: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useIndexHistory(
  symbol: string | null,
  startDate?: string,
  baseUrl?: string | null,
): FetchState<IndexOHLCV[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (symbol) p.symbol = symbol;
    if (startDate) p.start_date = startDate;
    return p;
  }, [symbol, startDate]);

  return useOpenBBQuery<IndexOHLCV[]>(
    "/index/price/historical",
    params,
    baseUrl ?? null,
    { enabled: !!symbol },
  );
}

export function useIndexConstituents(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<IndexConstituent[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<IndexConstituent[]>(
    "/index/constituents",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}
