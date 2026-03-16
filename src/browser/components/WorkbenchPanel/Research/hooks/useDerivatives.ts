/**
 * Derivatives domain hooks — options chains and futures curves.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptionsContract {
  contract_symbol: string;
  strike: number;
  expiration: string;
  option_type: "call" | "put";
  last_price: number;
  bid: number;
  ask: number;
  volume: number;
  open_interest: number;
  implied_volatility: number;
}

export interface FuturesCurvePoint {
  expiration: string;
  price: number;
  symbol: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useOptionsChains(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<OptionsContract[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<OptionsContract[]>(
    "/derivatives/options/chains",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useFuturesCurve(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<FuturesCurvePoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<FuturesCurvePoint[]>(
    "/derivatives/futures/curve",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}
