/**
 * Technical analysis hooks — RSI, MACD, Bollinger, SMA, EMA.
 *
 * These call the /technical/* endpoints which compute indicators
 * server-side from price history.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RSIPoint {
  date: string;
  rsi: number;
}

export interface MACDPoint {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerPoint {
  date: string;
  lower: number;
  middle: number;
  upper: number;
}

export interface MAPoint {
  date: string;
  value: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useRSI(
  symbol: string | null,
  baseUrl: string | null,
  period: number = 14,
): FetchState<RSIPoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol, period: String(period) } : ({} as Record<string, string>)),
    [symbol, period],
  );
  return useOpenBBQuery<RSIPoint[]>(
    "/technical/rsi",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useMACD(
  symbol: string | null,
  baseUrl: string | null,
): FetchState<MACDPoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol } : ({} as Record<string, string>)),
    [symbol],
  );
  return useOpenBBQuery<MACDPoint[]>(
    "/technical/macd",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useBollinger(
  symbol: string | null,
  baseUrl: string | null,
  period: number = 20,
): FetchState<BollingerPoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol, period: String(period) } : ({} as Record<string, string>)),
    [symbol, period],
  );
  return useOpenBBQuery<BollingerPoint[]>(
    "/technical/bbands",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useSMA(
  symbol: string | null,
  baseUrl: string | null,
  period: number = 50,
): FetchState<MAPoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol, period: String(period) } : ({} as Record<string, string>)),
    [symbol, period],
  );
  return useOpenBBQuery<MAPoint[]>(
    "/technical/sma",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}

export function useEMA(
  symbol: string | null,
  baseUrl: string | null,
  period: number = 20,
): FetchState<MAPoint[]> {
  const params = useMemo(
    () => (symbol ? { symbol, period: String(period) } : ({} as Record<string, string>)),
    [symbol, period],
  );
  return useOpenBBQuery<MAPoint[]>(
    "/technical/ema",
    params,
    baseUrl,
    { enabled: !!symbol },
  );
}
