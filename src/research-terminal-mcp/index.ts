#!/usr/bin/env bun

/**
 * Research Terminal MCP Server — built-in MCP server for financial data.
 *
 * Exposes 24+ tools for market data, economic indicators, technical analysis,
 * derivatives, and news via the OpenBB-powered data server sidecar.
 *
 * Tool categories:
 * - Lifecycle: status, start, stop
 * - Equity: quotes, history, profile, search, fundamentals, filings
 * - Crypto: historical prices, search
 * - Currency: FX historical, snapshots
 * - Index: historical, constituents
 * - Technical: RSI, MACD, Bollinger, SMA, EMA
 * - Economy: calendar, CPI, GDP, FRED series, treasury rates
 * - Derivatives: options chains, futures curve
 * - News: company news
 * - Composite: market snapshot, stock analysis
 *
 * Architecture:
 * - Connects to the Lattice backend via oRPC to resolve the data server URL
 * - Then fetches data directly from the financial data HTTP API
 *
 * Usage:
 *   bun run src/research-terminal-mcp/index.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RPCLink as HTTPRPCLink } from "@orpc/client/fetch";
import { createORPCClient } from "@orpc/client";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";

// ── Server Discovery (self-contained, no cross-module imports) ────────────

interface ServerConnection {
  baseUrl: string;
  authToken?: string;
}

function getLatticeHome(): string {
  if (process.env.LATTICE_ROOT) return process.env.LATTICE_ROOT;
  const suffix = process.env.NODE_ENV === "development" ? "-dev" : "";
  return path.join(homedir(), `.lattice${suffix}`);
}

async function discoverServer(): Promise<ServerConnection> {
  // 1. Explicit env vars (highest priority)
  const envUrl = process.env.LATTICE_SERVER_URL;
  const envToken = process.env.LATTICE_SERVER_AUTH_TOKEN;
  if (envUrl) {
    return { baseUrl: envUrl, authToken: envToken };
  }

  // 2. Lockfile discovery (~/.lattice/server.lock)
  try {
    const lockPath = path.join(getLatticeHome(), "server.lock");
    const content = await fs.readFile(lockPath, "utf-8");
    const data = JSON.parse(content);
    if (data?.baseUrl && data?.token) {
      // Validate PID is still alive
      try {
        process.kill(data.pid, 0);
        return { baseUrl: data.baseUrl, authToken: data.token };
      } catch {
        // Stale lockfile — fall through
      }
    }
  } catch {
    // No lockfile — fall through
  }

  // 3. Fallback
  return { baseUrl: "http://127.0.0.1:3000" };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function jsonContent(data: unknown): { type: "text"; text: string } {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

function withErrorHandling(
  fn: () => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  return fn().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(message);
  });
}

/** oRPC client type (kept generic to avoid cross-module @/ imports) */
type Client = any;

/**
 * Create an oRPC HTTP client for the Lattice backend.
 */
function createOrpcClient(baseUrl: string, authToken?: string): Client {
  const link = new HTTPRPCLink({
    url: `${baseUrl}/orpc`,
    headers: authToken != null ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  return createORPCClient(link);
}

/**
 * Resolve the running data server base URL from the backend status.
 */
async function getBaseUrl(client: Client): Promise<string> {
  const status = await (client as any).openbb.getStatus();
  if (status?.status === "running") {
    return `${status.baseUrl}/api/v1`;
  }
  throw new Error(
    `Research terminal data server is not running (status: ${status?.status ?? "unknown"}). ` +
      `Use research_terminal_start to start it first.`,
  );
}

/**
 * Fetch data from the financial data HTTP API with standard error handling.
 */
async function fetchData<T>(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  if (!params?.provider) {
    url.searchParams.set("provider", "yfinance");
  }
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const sym = params?.symbol ?? "";
    if (res.status === 404) {
      throw new Error(
        `Endpoint not available: ${path}. The required data extension may not be installed.`,
      );
    }
    if (res.status === 422) {
      throw new Error(
        sym
          ? `"${sym}" may not be a valid symbol. Try a different ticker.`
          : `Invalid parameters for ${path}.`,
      );
    }
    throw new Error(`Data API ${res.status} ${res.statusText} — ${path}`);
  }

  const text = await res.text();
  if (!text || text.trim().length === 0) {
    return [] as unknown as T;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }

  return ((json as Record<string, unknown>)?.results ?? json) as T;
}

// ── Tool Registration ─────────────────────────────────────────────────────

function registerTools(server: McpServer, client: Client): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_status",
    "Get the current status of the Research Terminal data server. Returns running state, port, base URL, and endpoint count.",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await (client as any).openbb.getStatus();
        return { content: [jsonContent(status)] };
      }),
  );

  server.tool(
    "research_terminal_start",
    "Start the Research Terminal data server. Bootstraps the Python environment if needed. Returns the running status once healthy.",
    {},
    () =>
      withErrorHandling(async () => {
        await (client as any).openbb.start();
        const status = await (client as any).openbb.getStatus();
        return { content: [jsonContent(status)] };
      }),
  );

  server.tool(
    "research_terminal_stop",
    "Stop the Research Terminal data server.",
    {},
    () =>
      withErrorHandling(async () => {
        await (client as any).openbb.stop();
        return {
          content: [jsonContent({ message: "Research terminal data server stopped" })],
        };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // EQUITY TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_equity_quote",
    "Get real-time stock quote for one or more symbols. Returns price, change, volume, market cap, high, low, prev close, and more.",
    {
      symbol: z
        .string()
        .describe("Ticker symbol (e.g. AAPL, MSFT, NVDA). Comma-separated for multiple."),
      provider: z
        .string()
        .optional()
        .describe("Data provider (default: yfinance). Options: yfinance, fmp, polygon"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/equity/price/quote", {
          symbol: params.symbol,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_equity_historical",
    "Get OHLCV price history for a stock. Returns date, open, high, low, close, volume for each period.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      start_date: z.string().optional().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().optional().describe("End date in YYYY-MM-DD format"),
      interval: z.string().optional().describe("Candle interval: 1d, 1h, 5m, 1w, 1mo (default: 1d)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.start_date) p.start_date = params.start_date;
        if (params.end_date) p.end_date = params.end_date;
        if (params.interval) p.interval = params.interval;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/equity/price/historical", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_equity_profile",
    "Get company profile: sector, industry, description, website, employees, market cap, and more.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/equity/profile", {
          symbol: params.symbol,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_equity_search",
    "Search for stocks by name or ticker. Returns matching symbols, names, and exchanges.",
    {
      query: z.string().describe("Search query (e.g. 'apple', 'rare earth', 'lithium')"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/equity/search", {
          query: params.query,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_equity_fundamentals",
    "Get financial statements: income statement, balance sheet, or cash flow. Returns structured financial data with line items.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      statement: z.enum(["income", "balance", "cash"]).describe("Financial statement type: income, balance, or cash"),
      period: z.enum(["annual", "quarter"]).optional().describe("Reporting period (default: annual)"),
      limit: z.number().optional().describe("Number of periods to return (default: 5)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const pathMap = {
          income: "/equity/fundamental/income",
          balance: "/equity/fundamental/balance",
          cash: "/equity/fundamental/cash",
        };
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.period) p.period = params.period;
        if (params.limit) p.limit = String(params.limit);
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, pathMap[params.statement], p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_equity_filings",
    "Get SEC filings for a company: 10-K, 10-Q, 8-K, and more. Returns filing date, type, URL, and description.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      form_type: z.string().optional().describe("SEC form type filter (e.g. 10-K, 10-Q, 8-K)"),
      limit: z.number().optional().describe("Number of filings to return (default: 20)"),
      provider: z.string().optional().describe("Data provider (default: sec)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {
          symbol: params.symbol,
          provider: params.provider ?? "sec",
        };
        if (params.form_type) p.form_type = params.form_type;
        if (params.limit) p.limit = String(params.limit);
        const data = await fetchData(baseUrl, "/equity/fundamental/filings", p);
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CRYPTO TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_crypto_historical",
    "Get historical OHLCV price data for a cryptocurrency. Use BTC-USD, ETH-USD format for symbols.",
    {
      symbol: z.string().describe("Crypto symbol (e.g. BTC-USD, ETH-USD, SOL-USD)"),
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      interval: z.string().optional().describe("Candle interval: 1d, 1h (default: 1d)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.start_date) p.start_date = params.start_date;
        if (params.interval) p.interval = params.interval;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/crypto/price/historical", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_crypto_search",
    "Search for cryptocurrencies by name or symbol.",
    {
      query: z.string().describe("Search query (e.g. 'bitcoin', 'ethereum')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/crypto/search", {
          query: params.query,
        });
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // CURRENCY / FX TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_currency_historical",
    "Get historical exchange rate data for a currency pair. Use EURUSD=X or GBPUSD=X format.",
    {
      symbol: z.string().describe("FX pair symbol (e.g. EURUSD=X, GBPJPY=X, USDJPY=X)"),
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.start_date) p.start_date = params.start_date;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/currency/price/historical", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_currency_snapshots",
    "Get current exchange rate snapshots for major currency pairs. Returns latest bid/ask/mid rates.",
    {
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/currency/snapshots", {
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // INDEX TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_index_historical",
    "Get historical OHLCV data for a market index (S&P 500, Nasdaq, Dow, etc.).",
    {
      symbol: z.string().describe("Index symbol (e.g. ^GSPC for S&P 500, ^DJI for Dow, ^IXIC for Nasdaq)"),
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.start_date) p.start_date = params.start_date;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/index/price/historical", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_index_constituents",
    "Get the constituent stocks of a market index (e.g. S&P 500 components).",
    {
      symbol: z.string().describe("Index symbol (e.g. ^GSPC, ^DJI)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/index/constituents", {
          symbol: params.symbol,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // TECHNICAL ANALYSIS TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_technical_indicators",
    "Calculate technical indicators for a stock: RSI, MACD, Bollinger Bands, SMA, or EMA. Returns time series of indicator values.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      indicator: z
        .enum(["rsi", "macd", "bbands", "sma", "ema"])
        .describe("Indicator type: rsi, macd, bbands, sma, ema"),
      period: z.number().optional().describe("Lookback period (default: 14 for RSI, 20 for Bollinger/SMA/EMA)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.period) p.period = String(params.period);
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, `/technical/${params.indicator}`, p);
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ECONOMY / MACRO TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_economy_calendar",
    "Get the economic events calendar. Returns upcoming and recent economic releases (CPI, jobs, Fed decisions, etc.).",
    {
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
      provider: z.string().optional().describe("Data provider (default: fmp)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {
          provider: params.provider ?? "fmp",
        };
        if (params.start_date) p.start_date = params.start_date;
        if (params.end_date) p.end_date = params.end_date;
        const data = await fetchData(baseUrl, "/economy/calendar", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_economy_cpi",
    "Get Consumer Price Index (CPI) inflation data for a country.",
    {
      country: z.string().optional().describe("Country name (e.g. 'united_states', 'united_kingdom')"),
      provider: z.string().optional().describe("Data provider"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {};
        if (params.country) p.country = params.country;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/economy/cpi", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_economy_gdp",
    "Get nominal GDP data for a country.",
    {
      country: z.string().optional().describe("Country name (e.g. 'united_states')"),
      provider: z.string().optional().describe("Data provider"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {};
        if (params.country) p.country = params.country;
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/economy/gdp/nominal", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_fred_series",
    "Get FRED (Federal Reserve) economic data series. Access thousands of economic indicators.",
    {
      symbol: z.string().describe("FRED series ID (e.g. DGS10, FEDFUNDS, UNRATE, CPIAUCSL, GDP, T10Y2Y)"),
      start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
      provider: z.string().optional().describe("Data provider (default: fred). Requires FRED_API_KEY."),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {
          symbol: params.symbol,
          provider: params.provider ?? "fred",
        };
        if (params.start_date) p.start_date = params.start_date;
        const data = await fetchData(baseUrl, "/economy/fred_series", p);
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_treasury_rates",
    "Get current US Treasury yield curve rates across all maturities (1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, 30y).",
    {
      provider: z.string().optional().describe("Data provider"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = {};
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/fixedincome/government/treasury_rates", p);
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // DERIVATIVES TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_options_chains",
    "Get options chain data for a stock: strikes, expirations, bids, asks, implied volatility, open interest, and greeks.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL, SPY)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/derivatives/options/chains", {
          symbol: params.symbol,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  server.tool(
    "research_terminal_futures_curve",
    "Get the futures term structure / forward curve for a commodity or financial futures contract.",
    {
      symbol: z.string().describe("Futures symbol (e.g. GC=F for gold, CL=F for crude oil, ES=F for S&P 500)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const data = await fetchData(baseUrl, "/derivatives/futures/curve", {
          symbol: params.symbol,
          ...(params.provider && { provider: params.provider }),
        });
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // NEWS TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_news",
    "Get financial news articles for one or more symbols. Returns headlines, URLs, dates, and sources.",
    {
      symbol: z.string().describe("Ticker symbol(s), comma-separated (e.g. AAPL, AAPL,MSFT,NVDA)"),
      limit: z.number().optional().describe("Maximum articles to return (default: 20)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const p: Record<string, string> = { symbol: params.symbol };
        if (params.limit) p.limit = String(params.limit);
        if (params.provider) p.provider = params.provider;
        const data = await fetchData(baseUrl, "/news/company", p);
        return { content: [jsonContent(data)] };
      }),
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSITE / CONVENIENCE TOOLS
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_market_snapshot",
    "Get a comprehensive market snapshot: quotes for multiple symbols in a single call. Ideal for dashboards and watchlists.",
    {
      symbols: z.string().describe("Comma-separated ticker symbols (e.g. AAPL,MSFT,GOOGL,AMZN,SPY,QQQ)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const symbolList = params.symbols.split(",").map((s) => s.trim()).filter(Boolean);
        const results: Record<string, unknown>[] = [];

        for (const symbol of symbolList) {
          try {
            const quote = await fetchData<Record<string, unknown>[]>(
              baseUrl,
              "/equity/price/quote",
              {
                symbol,
                ...(params.provider && { provider: params.provider }),
              },
            );
            if (Array.isArray(quote) && quote.length > 0) {
              results.push(quote[0]);
            }
          } catch {
            results.push({ symbol, error: "Quote unavailable" });
          }
        }

        return {
          content: [
            jsonContent({
              count: results.length,
              quotes: results,
            }),
          ],
        };
      }),
  );

  server.tool(
    "research_terminal_stock_analysis",
    "Get a comprehensive analysis of a stock: quote, profile, and recent price history in a single call.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      days: z.number().optional().describe("Days of price history to include (default: 30)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const symbol = params.symbol;
        const days = params.days ?? 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startStr = startDate.toISOString().slice(0, 10);

        const [quote, profile, history] = await Promise.all([
          fetchData(baseUrl, "/equity/price/quote", { symbol }).catch(() => null),
          fetchData(baseUrl, "/equity/profile", { symbol }).catch(() => null),
          fetchData(baseUrl, "/equity/price/historical", {
            symbol,
            start_date: startStr,
            interval: "1d",
          }).catch(() => null),
        ]);

        return {
          content: [
            jsonContent({
              symbol,
              quote: Array.isArray(quote) && quote.length > 0 ? quote[0] : quote,
              profile: Array.isArray(profile) && profile.length > 0 ? profile[0] : profile,
              history: {
                days,
                data_points: Array.isArray(history) ? history.length : 0,
                data: history,
              },
            }),
          ],
        };
      }),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const connection = await discoverServer();

  process.stderr.write(
    `[research-terminal-mcp] Connecting to Lattice backend at ${connection.baseUrl}\n`,
  );

  const client = createOrpcClient(connection.baseUrl, connection.authToken);

  const mcpServer = new McpServer({
    name: "research-terminal",
    version: "1.0.0",
  });

  registerTools(mcpServer, client);

  process.stderr.write(
    `[research-terminal-mcp] Registered 26 financial data tools\n`,
  );

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  process.stderr.write("[research-terminal-mcp] MCP server running on stdio\n");
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[research-terminal-mcp] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
