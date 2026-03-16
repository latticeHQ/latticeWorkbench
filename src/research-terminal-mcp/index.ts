#!/usr/bin/env bun

/**
 * Research Terminal MCP Server — built-in MCP server for financial data.
 *
 * Auto-discovers ALL available tools from the OpenBB sidecar's /openapi.json
 * instead of hand-coding each endpoint. This gives 100+ tools covering equity,
 * crypto, currency, index, economy, derivatives, fixed income, ETF, commodity,
 * regulators, news, technical analysis, and more — with zero maintenance as
 * new OpenBB extensions are installed.
 *
 * Architecture:
 * 1. Lifecycle tools (status/start/stop) are always registered immediately
 * 2. On startup (or after `research_terminal_start`), fetches /openapi.json
 *    from the running sidecar and dynamically registers MCP tools for every
 *    GET endpoint under /api/v1/
 * 3. Composite convenience tools (market_snapshot, stock_analysis) are always
 *    registered since they orchestrate multiple API calls
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
  const envUrl = process.env.LATTICE_SERVER_URL;
  const envToken = process.env.LATTICE_SERVER_AUTH_TOKEN;
  if (envUrl) {
    return { baseUrl: envUrl, authToken: envToken };
  }

  try {
    const lockPath = path.join(getLatticeHome(), "server.lock");
    const content = await fs.readFile(lockPath, "utf-8");
    const data = JSON.parse(content);
    if (data?.baseUrl && data?.token) {
      try {
        process.kill(data.pid, 0);
        return { baseUrl: data.baseUrl, authToken: data.token };
      } catch {
        // Stale lockfile
      }
    }
  } catch {
    // No lockfile
  }

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

type Client = any;

function createOrpcClient(baseUrl: string, authToken?: string): Client {
  const link = new HTTPRPCLink({
    url: `${baseUrl}/orpc`,
    headers: authToken != null ? { Authorization: `Bearer ${authToken}` } : undefined,
  });
  return createORPCClient(link);
}

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

async function fetchData<T>(
  baseUrl: string,
  apiPath: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${baseUrl}${apiPath}`);
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
        `Endpoint not available: ${apiPath}. The required data extension may not be installed.`,
      );
    }
    if (res.status === 422) {
      throw new Error(
        sym
          ? `"${sym}" may not be a valid symbol. Try a different ticker.`
          : `Invalid parameters for ${apiPath}.`,
      );
    }
    throw new Error(`Data API ${res.status} ${res.statusText} — ${apiPath}`);
  }

  const text = await res.text();
  if (!text || text.trim().length === 0) {
    return [] as unknown as T;
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${apiPath}`);
  }

  return ((json as Record<string, unknown>)?.results ?? json) as T;
}

// ── OpenAPI → MCP Tool Auto-Generation ─────────────────────────────────────

interface OpenApiParam {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: {
    type?: string | null;
    anyOf?: Array<{ type?: string | null; enum?: string[]; format?: string }>;
    enum?: string[];
    default?: unknown;
    description?: string;
    title?: string;
    const?: unknown;
  };
}

interface OpenApiOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParam[];
}

interface OpenApiSpec {
  paths: Record<string, { get?: OpenApiOperation; post?: OpenApiOperation }>;
}

/**
 * Convert an OpenAPI path to an MCP tool name.
 * /api/v1/equity/price/quote → research_terminal_equity_price_quote
 */
function pathToToolName(apiPath: string): string {
  return (
    "research_terminal_" +
    apiPath
      .replace(/^\/api\/v1\//, "")
      .replace(/\//g, "_")
      .replace(/[^a-z0-9_]/gi, "_")
      .replace(/_+/g, "_")
      .replace(/_$/, "")
  );
}

/**
 * Resolve the actual type from an OpenAPI schema, handling `anyOf` nullable patterns.
 */
function resolveParamType(
  schema: OpenApiParam["schema"],
): { type: "string" | "number" | "boolean"; enumValues?: string[] } {
  if (!schema) return { type: "string" };

  // Direct enum
  if (schema.enum && schema.type === "string") {
    return { type: "string", enumValues: schema.enum };
  }

  // anyOf with nullable — unwrap to the non-null type
  if (schema.anyOf) {
    for (const variant of schema.anyOf) {
      if (variant.type === null || variant.type === "null") continue;
      if (variant.enum) {
        return { type: "string", enumValues: variant.enum };
      }
      if (variant.type === "integer" || variant.type === "number") {
        return { type: "number" };
      }
      if (variant.type === "boolean") {
        return { type: "boolean" };
      }
      return { type: "string" };
    }
  }

  // Direct type
  if (schema.type === "integer" || schema.type === "number") {
    return { type: "number" };
  }
  if (schema.type === "boolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}

/**
 * Convert an OpenAPI parameter to a Zod schema.
 */
function paramToZod(param: OpenApiParam): z.ZodTypeAny {
  const desc =
    param.description || param.schema?.description || param.schema?.title || param.name;
  const { type, enumValues } = resolveParamType(param.schema);

  let zodType: z.ZodTypeAny;

  if (enumValues && enumValues.length > 0) {
    zodType = z.enum(enumValues as [string, ...string[]]);
  } else if (type === "number") {
    zodType = z.number();
  } else if (type === "boolean") {
    zodType = z.boolean();
  } else {
    zodType = z.string();
  }

  // Add description with default value hint if present
  const defaultVal = param.schema?.default;
  const descParts = [desc];
  if (defaultVal !== undefined && defaultVal !== null) {
    descParts.push(`(default: ${defaultVal})`);
  }
  zodType = zodType.describe(descParts.join(" "));

  if (!param.required) {
    zodType = zodType.optional();
  }

  return zodType;
}

/**
 * Track which tools have been registered to avoid duplicates.
 */
const registeredTools = new Set<string>();

/**
 * Parse the OpenAPI spec and register dynamic MCP tools.
 * Returns the count of tools registered.
 */
function registerDynamicToolsFromSpec(
  server: McpServer,
  client: Client,
  spec: OpenApiSpec,
): number {
  let count = 0;

  for (const [apiPath, methods] of Object.entries(spec.paths)) {
    // Only process /api/v1/ data endpoints
    if (!apiPath.startsWith("/api/v1/")) continue;

    const operation = methods.get;
    if (!operation) continue;

    const toolName = pathToToolName(apiPath);

    // Skip if already registered (lifecycle, composite, or duplicate)
    if (registeredTools.has(toolName)) continue;

    // Build description
    const descParts = [operation.summary, operation.description].filter(Boolean);
    const description = descParts.join(". ").slice(0, 500) || `Query ${apiPath}`;

    // Extract query parameters and build Zod shape
    const queryParams = (operation.parameters ?? []).filter(
      (p) => p.in === "query",
    );

    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const param of queryParams) {
      try {
        zodShape[param.name] = paramToZod(param);
      } catch {
        // Fall back to optional string for unparseable params
        zodShape[param.name] = z
          .string()
          .optional()
          .describe(param.name);
      }
    }

    // The API path relative to /api/v1
    const relativePath = apiPath.replace(/^\/api\/v1/, "");

    server.tool(toolName, description, zodShape, (args) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        // Convert all args to string for query params
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(args)) {
          if (value !== undefined && value !== null) {
            params[key] = String(value);
          }
        }
        const data = await fetchData(baseUrl, relativePath, params);
        return { content: [jsonContent(data)] };
      }),
    );

    registeredTools.add(toolName);
    count++;
  }

  return count;
}

/**
 * Fetch the OpenAPI spec from the running sidecar.
 */
async function fetchOpenApiSpec(dataServerBaseUrl: string): Promise<OpenApiSpec> {
  const res = await fetch(`${dataServerBaseUrl}/openapi.json`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OpenApiSpec;
}

// ── Spec cache ─────────────────────────────────────────────────────────────

let specCached = false;
let specFetchInFlight: Promise<number> | null = null;

/**
 * Fetch the spec and register dynamic tools (with dedup).
 */
async function ensureDynamicTools(
  server: McpServer,
  client: Client,
): Promise<number> {
  if (specCached) return 0;

  if (specFetchInFlight) return specFetchInFlight;

  specFetchInFlight = (async () => {
    try {
      const status = await (client as any).openbb.getStatus();
      if (status?.status !== "running") return 0;

      const spec = await fetchOpenApiSpec(status.baseUrl);
      const count = registerDynamicToolsFromSpec(server, client, spec);
      specCached = true;

      process.stderr.write(
        `[research-terminal-mcp] Auto-discovered ${count} tools from OpenAPI spec\n`,
      );

      return count;
    } catch (err) {
      process.stderr.write(
        `[research-terminal-mcp] Failed to fetch OpenAPI spec: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return 0;
    } finally {
      specFetchInFlight = null;
    }
  })();

  return specFetchInFlight;
}

// ── Tool Registration ─────────────────────────────────────────────────────

function registerLifecycleTools(server: McpServer, client: Client): void {
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
  registeredTools.add("research_terminal_status");

  server.tool(
    "research_terminal_start",
    "Start the Research Terminal data server. Bootstraps the Python environment if needed. After starting, auto-discovers all available financial data tools from the server's API.",
    {},
    () =>
      withErrorHandling(async () => {
        await (client as any).openbb.start();
        const status = await (client as any).openbb.getStatus();

        // After successful start, fetch spec and register dynamic tools
        if (status?.status === "running") {
          const count = await ensureDynamicTools(server, client);
          return {
            content: [
              jsonContent({
                ...status,
                dynamicToolsRegistered: count,
                message:
                  count > 0
                    ? `Server started. ${count} financial data tools auto-discovered and ready to use.`
                    : "Server started. Tools were already registered.",
              }),
            ],
          };
        }

        return { content: [jsonContent(status)] };
      }),
  );
  registeredTools.add("research_terminal_start");

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
  registeredTools.add("research_terminal_stop");
}

function registerCompositeTools(server: McpServer, client: Client): void {
  server.tool(
    "research_terminal_market_snapshot",
    "Get a comprehensive market snapshot: quotes for multiple symbols in a single call. Ideal for dashboards and watchlists.",
    {
      symbols: z
        .string()
        .describe("Comma-separated ticker symbols (e.g. AAPL,MSFT,GOOGL,AMZN,SPY,QQQ)"),
      provider: z
        .string()
        .optional()
        .describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const symbolList = params.symbols
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
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
          content: [jsonContent({ count: results.length, quotes: results })],
        };
      }),
  );
  registeredTools.add("research_terminal_market_snapshot");

  server.tool(
    "research_terminal_stock_analysis",
    "Get a comprehensive analysis of a stock: quote, profile, and recent price history in a single call.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      days: z
        .number()
        .optional()
        .describe("Days of price history to include (default: 30)"),
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
          fetchData(baseUrl, "/equity/price/quote", { symbol }).catch(
            () => null,
          ),
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
              quote:
                Array.isArray(quote) && quote.length > 0 ? quote[0] : quote,
              profile:
                Array.isArray(profile) && profile.length > 0
                  ? profile[0]
                  : profile,
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
  registeredTools.add("research_terminal_stock_analysis");

  server.tool(
    "research_terminal_discover_tools",
    "List all available Research Terminal tools by category. Useful when you need to find what financial data endpoints are available.",
    {},
    () =>
      withErrorHandling(async () => {
        // Group registered tools by category
        const categories: Record<string, string[]> = {};
        for (const toolName of registeredTools) {
          // research_terminal_equity_price_quote → equity
          const parts = toolName.replace(/^research_terminal_/, "").split("_");
          const cat = parts[0] || "other";
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(toolName);
        }

        return {
          content: [
            jsonContent({
              totalTools: registeredTools.size,
              categories: Object.fromEntries(
                Object.entries(categories)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cat, tools]) => [cat, { count: tools.length, tools: tools.sort() }]),
              ),
              hint: "Call research_terminal_start if you see fewer tools than expected — dynamic tools are loaded from the running data server.",
            }),
          ],
        };
      }),
  );
  registeredTools.add("research_terminal_discover_tools");
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
    version: "2.0.0",
  });

  // Always register lifecycle + composite tools immediately
  registerLifecycleTools(mcpServer, client);
  registerCompositeTools(mcpServer, client);

  process.stderr.write(
    `[research-terminal-mcp] Registered ${registeredTools.size} base tools (lifecycle + composite)\n`,
  );

  // Try to auto-discover dynamic tools if sidecar is already running
  await ensureDynamicTools(mcpServer, client);

  process.stderr.write(
    `[research-terminal-mcp] Total tools: ${registeredTools.size}\n`,
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
