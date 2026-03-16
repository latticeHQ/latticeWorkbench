/**
 * Quote data normalization utilities.
 *
 * yfinance / OpenBB returns different field names depending on the endpoint
 * and provider. This module normalises any raw quote object into a consistent
 * shape so views never have to guess at field names.
 */

// ---------------------------------------------------------------------------
// Normalised quote shape
// ---------------------------------------------------------------------------

/** Where the price came from — so the UI can label it honestly. */
export type PriceSource = "realtime" | "close" | "none";

export interface NormalizedQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: number;
  high: number;
  low: number;
  prevClose: number;
  yearHigh: number;
  yearLow: number;
  open: number;
  /** Where the price came from: "realtime" (quote endpoint), "close" (historical fallback), "none" (no data). */
  priceSource: PriceSource;
}

// ---------------------------------------------------------------------------
// Smart number extraction — tolerant of all field types
// ---------------------------------------------------------------------------

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

// ---------------------------------------------------------------------------
// Smart price formatter — more decimals for cheap assets
// ---------------------------------------------------------------------------

export function formatPrice(n: number): string {
  if (n === 0) return "--";
  if (n < 0.001) return `$${n.toFixed(8)}`;
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 0.1) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 10) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(n: number): string {
  if (n === 0) return "0.00%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function formatVolume(v: number): string {
  if (v === 0) return "--";
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

export function formatMarketCap(v: number): string {
  if (v === 0) return "--";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Normalise a raw API quote object
// ---------------------------------------------------------------------------

/**
 * Extract a normalised quote from any raw quote object returned by OpenBB.
 *
 * Handles all known field name variations:
 * - yfinance: last_price / regularMarketPrice, prev_close / regularMarketPreviousClose
 * - FMP: price, changesPercentage, mktCap
 * - Generic: close, change_percent, market_cap
 */
export function normalizeQuote(raw: Record<string, unknown>, fallbackSymbol?: string): NormalizedQuote {
  const symbol = str(raw.symbol) || fallbackSymbol || "";
  const name = str(raw.name || raw.shortName || raw.longName || raw.company_name || raw.short_name || raw.long_name || "");

  // Price: try all known field name variations across providers.
  // yfinance via OpenBB returns snake_case (regular_market_price), direct yfinance uses camelCase.
  // NOTE: For ETFs (REMX, PICK, LIT), yfinance quote endpoint may omit price/last_price/close.
  // We do NOT fall back to open/prev_close here — that would be misleading.
  // Instead, useQuotes() fetches the actual last close from the historical endpoint.
  const prevClose = num(
    raw.prev_close ?? raw.previous_close ?? raw.regularMarketPreviousClose ??
    raw.regular_market_previous_close ?? raw.previousClose ?? raw.prevClose ?? 0
  );

  const price = num(
    raw.last_price ?? raw.price ?? raw.regularMarketPrice ?? raw.regular_market_price ??
    raw.close ?? raw.lastPrice ?? raw.current_price ?? raw.last ??
    raw.nav_price ?? raw.navPrice ?? 0
  );

  // Change: compute if not provided — guard against price=0 to avoid bogus -100%
  const rawChange = num(
    raw.change ?? raw.regularMarketChange ?? raw.regular_market_change ?? 0
  );
  const change = price > 0 && rawChange !== 0
    ? rawChange
    : (price > 0 && prevClose > 0 ? price - prevClose : 0);

  const rawChangePct = num(
    raw.change_percent ?? raw.changesPercentage ?? raw.regularMarketChangePercent ??
    raw.regular_market_change_percent ?? raw.changePercent ?? raw.percent_change ?? 0
  );
  const changePercent = price > 0 && rawChangePct !== 0
    ? rawChangePct
    : (price > 0 && prevClose > 0 ? (change / prevClose) * 100 : 0);

  return {
    symbol,
    name,
    price,
    change,
    changePercent,
    volume: num(
      raw.volume ?? raw.regularMarketVolume ?? raw.regular_market_volume ?? raw.avg_volume ?? 0
    ),
    marketCap: num(
      raw.market_cap ?? raw.mktCap ?? raw.marketCap ?? raw.market_capitalization ??
      raw.regular_market_cap ?? 0
    ),
    high: num(
      raw.high ?? raw.regularMarketDayHigh ?? raw.regular_market_day_high ?? raw.day_high ?? 0
    ),
    low: num(
      raw.low ?? raw.regularMarketDayLow ?? raw.regular_market_day_low ?? raw.day_low ?? 0
    ),
    prevClose,
    yearHigh: num(
      raw.year_high ?? raw.yearHigh ?? raw.fiftyTwoWeekHigh ?? raw.fifty_two_week_high ?? 0
    ),
    yearLow: num(
      raw.year_low ?? raw.yearLow ?? raw.fiftyTwoWeekLow ?? raw.fifty_two_week_low ?? 0
    ),
    open: num(
      raw.open ?? raw.regularMarketOpen ?? raw.regular_market_open ?? 0
    ),
    priceSource: price > 0 ? "realtime" : "none",
  };
}

/**
 * Normalise an array of raw quote results, matching them to expected symbols.
 *
 * Strategy:
 * 1. Try matching by `symbol` field in the response (case-insensitive).
 * 2. Fall back to positional matching (response[i] → expectedSymbols[i]).
 * 3. If neither works, return an empty placeholder.
 *
 * This handles all yfinance edge cases:
 * - Some results have `symbol`, others don't
 * - Batch responses where symbol field is missing for ETFs
 * - Responses returned in a different order
 */
export function normalizeQuotes(
  rawArray: Record<string, unknown>[] | null | undefined,
  expectedSymbols: string[],
): NormalizedQuote[] {
  if (!rawArray || !Array.isArray(rawArray)) return [];

  // Pass 1: Build a map of normalised quotes keyed by symbol (case-insensitive)
  const bySymbol = new Map<string, NormalizedQuote>();
  for (const raw of rawArray) {
    const nq = normalizeQuote(raw);
    if (nq.symbol) {
      bySymbol.set(nq.symbol.toUpperCase(), nq);
    }
  }

  // Track which raw entries have been consumed by symbol-match
  const consumed = new Set<number>();
  const result: NormalizedQuote[] = [];

  for (let i = 0; i < expectedSymbols.length; i++) {
    const sym = expectedSymbols[i];
    const symUpper = sym.toUpperCase();

    // Strategy 1: exact symbol match from the map
    const found = bySymbol.get(symUpper);
    if (found && found.price > 0) {
      result.push(found);
      // Mark the raw index consumed (find which raw entry this was)
      for (let j = 0; j < rawArray.length; j++) {
        if (!consumed.has(j) && str(rawArray[j].symbol).toUpperCase() === symUpper) {
          consumed.add(j);
          break;
        }
      }
      continue;
    }

    // Strategy 2: positional fallback — use index i if that raw entry wasn't consumed
    if (i < rawArray.length && !consumed.has(i)) {
      consumed.add(i);
      const nq = normalizeQuote(rawArray[i], sym);
      // Override symbol to expected since the raw entry might not have one
      result.push({ ...nq, symbol: sym });
      continue;
    }

    // Strategy 3: try any unconsumed raw entry
    let matched = false;
    for (let j = 0; j < rawArray.length; j++) {
      if (!consumed.has(j)) {
        consumed.add(j);
        const nq = normalizeQuote(rawArray[j], sym);
        result.push({ ...nq, symbol: sym });
        matched = true;
        break;
      }
    }

    // Strategy 4: empty placeholder
    if (!matched) {
      result.push({
        symbol: sym, name: "", price: 0, change: 0, changePercent: 0,
        volume: 0, marketCap: 0, high: 0, low: 0, prevClose: 0,
        yearHigh: 0, yearLow: 0, open: 0, priceSource: "none",
      });
    }
  }

  return result;
}


