/**
 * OpenBB Financial Data SDK — Typed functions for code execution with MCP.
 *
 * Enables agents to write code that calls OpenBB tools programmatically:
 *
 *   import { getClient } from './client';
 *   import * as openbb from './openbb';
 *
 *   const c = await getClient();
 *   const quote = await openbb.equityQuote(c, 'AAPL');
 *   const history = await openbb.equityHistorical(c, 'AAPL', { start_date: '2025-01-01' });
 *   const news = await openbb.news(c, 'AAPL,MSFT', { limit: 10 });
 *
 * Following Anthropic's "Code Execution with MCP" pattern for context efficiency:
 * - Agents load only the tools they need
 * - Data processing happens in code, not context
 * - Composable functions enable complex workflows
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  name?: string;
  last_price?: number;
  price?: number;
  change?: number;
  change_percent?: number;
  volume?: number;
  market_cap?: number;
  high?: number;
  low?: number;
  prev_close?: number;
  [key: string]: unknown;
}

export interface NewsItem {
  title: string;
  url: string;
  date: string;
  source: string;
  symbols?: string[];
}

export interface CompanyProfile {
  symbol: string;
  name?: string;
  sector?: string;
  industry?: string;
  description?: string;
  website?: string;
  market_cap?: number;
  employees?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBaseUrl(c: RouterClient<AppRouter>): Promise<string> {
  const status = await (c as any).openbb.getStatus();
  if (status?.status === "running") {
    return `${status.baseUrl}/api/v1`;
  }
  throw new Error(
    `OpenBB not running (status: ${status?.status}). Call start() first.`,
  );
}

async function fetchAPI<T>(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  if (!params?.provider) url.searchParams.set("provider", "yfinance");
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenBB ${res.status} ${res.statusText} — ${path}`);
  const text = await res.text();
  if (!text?.trim()) return [] as unknown as T;
  const json = JSON.parse(text);
  return ((json as Record<string, unknown>)?.results ?? json) as T;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Get OpenBB server status. */
export async function status(c: RouterClient<AppRouter>) {
  return (c as any).openbb.getStatus();
}

/** Start the OpenBB server. */
export async function start(c: RouterClient<AppRouter>) {
  await (c as any).openbb.start();
  return (c as any).openbb.getStatus();
}

/** Stop the OpenBB server. */
export async function stop(c: RouterClient<AppRouter>) {
  return (c as any).openbb.stop();
}

// ---------------------------------------------------------------------------
// Equity
// ---------------------------------------------------------------------------

/** Get real-time quote for a stock. */
export async function equityQuote(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { provider?: string },
): Promise<QuoteData[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/equity/price/quote", {
    symbol,
    ...(opts?.provider && { provider: opts.provider }),
  });
}

/** Get OHLCV price history. */
export async function equityHistorical(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { start_date?: string; end_date?: string; interval?: string; provider?: string },
): Promise<OHLCVData[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol };
  if (opts?.start_date) p.start_date = opts.start_date;
  if (opts?.end_date) p.end_date = opts.end_date;
  if (opts?.interval) p.interval = opts.interval;
  if (opts?.provider) p.provider = opts.provider;
  return fetchAPI(baseUrl, "/equity/price/historical", p);
}

/** Get company profile. */
export async function equityProfile(
  c: RouterClient<AppRouter>,
  symbol: string,
): Promise<CompanyProfile[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/equity/profile", { symbol });
}

/** Search for stocks. */
export async function equitySearch(
  c: RouterClient<AppRouter>,
  query: string,
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/equity/search", { query });
}

/** Get financial statements. */
export async function equityFundamentals(
  c: RouterClient<AppRouter>,
  symbol: string,
  statement: "income" | "balance" | "cash",
  opts?: { period?: "annual" | "quarter"; limit?: number; provider?: string },
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  const pathMap = {
    income: "/equity/fundamental/income",
    balance: "/equity/fundamental/balance",
    cash: "/equity/fundamental/cash",
  };
  const p: Record<string, string> = { symbol };
  if (opts?.period) p.period = opts.period;
  if (opts?.limit) p.limit = String(opts.limit);
  if (opts?.provider) p.provider = opts.provider;
  return fetchAPI(baseUrl, pathMap[statement], p);
}

/** Get SEC filings. */
export async function equityFilings(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { form_type?: string; limit?: number },
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol, provider: "sec" };
  if (opts?.form_type) p.form_type = opts.form_type;
  if (opts?.limit) p.limit = String(opts.limit);
  return fetchAPI(baseUrl, "/equity/fundamental/filings", p);
}

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------

/** Get crypto price history. */
export async function cryptoHistorical(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { start_date?: string; interval?: string },
): Promise<OHLCVData[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol };
  if (opts?.start_date) p.start_date = opts.start_date;
  if (opts?.interval) p.interval = opts.interval;
  return fetchAPI(baseUrl, "/crypto/price/historical", p);
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/** Get FX pair historical data. */
export async function currencyHistorical(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { start_date?: string },
): Promise<OHLCVData[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol };
  if (opts?.start_date) p.start_date = opts.start_date;
  return fetchAPI(baseUrl, "/currency/price/historical", p);
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/** Get index historical data. */
export async function indexHistorical(
  c: RouterClient<AppRouter>,
  symbol: string,
  opts?: { start_date?: string },
): Promise<OHLCVData[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol };
  if (opts?.start_date) p.start_date = opts.start_date;
  return fetchAPI(baseUrl, "/index/price/historical", p);
}

// ---------------------------------------------------------------------------
// Technical Analysis
// ---------------------------------------------------------------------------

/** Get a technical indicator for a stock. */
export async function technicalIndicator(
  c: RouterClient<AppRouter>,
  symbol: string,
  indicator: "rsi" | "macd" | "bbands" | "sma" | "ema",
  opts?: { period?: number },
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol };
  if (opts?.period) p.period = String(opts.period);
  return fetchAPI(baseUrl, `/technical/${indicator}`, p);
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

/** Get FRED economic data series. */
export async function fredSeries(
  c: RouterClient<AppRouter>,
  seriesId: string,
  opts?: { start_date?: string },
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol: seriesId, provider: "fred" };
  if (opts?.start_date) p.start_date = opts.start_date;
  return fetchAPI(baseUrl, "/economy/fred_series", p);
}

/** Get treasury yield curve rates. */
export async function treasuryRates(
  c: RouterClient<AppRouter>,
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/fixedincome/government/treasury_rates", {});
}

/** Get economic calendar events. */
export async function economyCalendar(
  c: RouterClient<AppRouter>,
  opts?: { start_date?: string; end_date?: string },
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { provider: "fmp" };
  if (opts?.start_date) p.start_date = opts.start_date;
  if (opts?.end_date) p.end_date = opts.end_date;
  return fetchAPI(baseUrl, "/economy/calendar", p);
}

// ---------------------------------------------------------------------------
// Derivatives
// ---------------------------------------------------------------------------

/** Get options chain for a stock. */
export async function optionsChains(
  c: RouterClient<AppRouter>,
  symbol: string,
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/derivatives/options/chains", { symbol });
}

/** Get futures curve. */
export async function futuresCurve(
  c: RouterClient<AppRouter>,
  symbol: string,
): Promise<unknown[]> {
  const baseUrl = await getBaseUrl(c);
  return fetchAPI(baseUrl, "/derivatives/futures/curve", { symbol });
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

/** Get financial news for symbols. */
export async function news(
  c: RouterClient<AppRouter>,
  symbols: string,
  opts?: { limit?: number },
): Promise<NewsItem[]> {
  const baseUrl = await getBaseUrl(c);
  const p: Record<string, string> = { symbol: symbols };
  if (opts?.limit) p.limit = String(opts.limit);
  return fetchAPI(baseUrl, "/news/company", p);
}
