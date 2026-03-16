/**
 * Economy domain hooks — calendar, CPI, GDP, FRED series, treasury rates.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EconomyCalendarItem {
  date: string;
  country: string;
  event: string;
  actual: number | null;
  consensus: number | null;
  previous: number | null;
}

export interface CPIDataPoint {
  date: string;
  value: number;
}

export interface GDPDataPoint {
  date: string;
  value: number;
}

export interface FredSeriesPoint {
  date: string;
  value: number;
}

export interface TreasuryRate {
  date: string;
  month_1: number;
  month_3: number;
  month_6: number;
  year_1: number;
  year_2: number;
  year_5: number;
  year_10: number;
  year_30: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useEconomyCalendar(
  baseUrl: string | null,
  startDate?: string,
  endDate?: string,
): FetchState<EconomyCalendarItem[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (startDate) p.start_date = startDate;
    if (endDate) p.end_date = endDate;
    return p;
  }, [startDate, endDate]);

  return useOpenBBQuery<EconomyCalendarItem[]>(
    "/economy/calendar",
    params,
    baseUrl,
  );
}

export function useCPI(
  baseUrl: string | null,
  country: string = "united_states",
): FetchState<CPIDataPoint[]> {
  const params = useMemo(() => ({ country }), [country]);
  return useOpenBBQuery<CPIDataPoint[]>(
    "/economy/cpi",
    params,
    baseUrl,
  );
}

export function useGDP(
  baseUrl: string | null,
  country: string = "united_states",
): FetchState<GDPDataPoint[]> {
  const params = useMemo(() => ({ country }), [country]);
  return useOpenBBQuery<GDPDataPoint[]>(
    "/economy/gdp/nominal",
    params,
    baseUrl,
  );
}

export function useFredSeries(
  seriesId: string | null,
  baseUrl: string | null,
  startDate?: string,
): FetchState<FredSeriesPoint[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (seriesId) p.symbol = seriesId;
    if (startDate) p.start_date = startDate;
    return p;
  }, [seriesId, startDate]);

  return useOpenBBQuery<FredSeriesPoint[]>(
    "/economy/fred_series",
    params,
    baseUrl,
    { enabled: !!seriesId, provider: "fred" },
  );
}

export function useTreasuryRates(
  baseUrl: string | null,
): FetchState<TreasuryRate[]> {
  const params = useMemo(() => ({}), []);
  return useOpenBBQuery<TreasuryRate[]>(
    "/fixedincome/government/treasury_rates",
    params,
    baseUrl,
  );
}
