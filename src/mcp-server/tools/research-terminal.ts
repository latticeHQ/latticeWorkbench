/**
 * Research Terminal MCP Tools — registered in the lattice MCP server for
 * progressive disclosure (search_tools / list_tool_categories).
 *
 * Auto-discovers ALL available tools from the OpenBB sidecar's /openapi.json
 * instead of hand-coding each endpoint. Lifecycle + composite tools are always
 * registered synchronously; dynamic tools are loaded when the sidecar is running.
 *
 * These same tools are also available via the standalone research-terminal-mcp
 * built-in server. Having them here ensures minions can discover them through
 * the lattice MCP server's tool catalog.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBaseUrl(client: RouterClient<AppRouter>): Promise<string> {
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

// ---------------------------------------------------------------------------
// OpenAPI → MCP Tool Auto-Generation
// ---------------------------------------------------------------------------

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

function resolveParamType(
  schema: OpenApiParam["schema"],
): { type: "string" | "number" | "boolean"; enumValues?: string[] } {
  if (!schema) return { type: "string" };

  if (schema.enum && schema.type === "string") {
    return { type: "string", enumValues: schema.enum };
  }

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

  if (schema.type === "integer" || schema.type === "number") {
    return { type: "number" };
  }
  if (schema.type === "boolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}

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

// Track registered tools to avoid duplicates
const registeredToolNames = new Set<string>();

function registerDynamicToolsFromSpec(
  server: McpServer,
  client: RouterClient<AppRouter>,
  spec: OpenApiSpec,
): number {
  let count = 0;

  for (const [apiPath, methods] of Object.entries(spec.paths)) {
    if (!apiPath.startsWith("/api/v1/")) continue;

    const operation = methods.get;
    if (!operation) continue;

    const toolName = pathToToolName(apiPath);
    if (registeredToolNames.has(toolName)) continue;

    const descParts = [operation.summary, operation.description].filter(Boolean);
    const description = descParts.join(". ").slice(0, 500) || `Query ${apiPath}`;

    const queryParams = (operation.parameters ?? []).filter(
      (p) => p.in === "query",
    );

    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const param of queryParams) {
      try {
        zodShape[param.name] = paramToZod(param);
      } catch {
        zodShape[param.name] = z.string().optional().describe(param.name);
      }
    }

    const relativePath = apiPath.replace(/^\/api\/v1/, "");

    server.tool(toolName, description, zodShape, (args) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
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

    registeredToolNames.add(toolName);
    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// Registration (exported for lattice MCP server)
// ---------------------------------------------------------------------------

/**
 * Register research terminal tools in the lattice MCP server.
 *
 * Always registers lifecycle + composite tools synchronously.
 * Attempts to auto-discover dynamic tools if the sidecar is running.
 */
export function registerResearchTerminalTools(
  server: McpServer,
  client: RouterClient<AppRouter>,
): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE TOOLS (always available)
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
  registeredToolNames.add("research_terminal_status");

  server.tool(
    "research_terminal_start",
    "Start the Research Terminal data server. Bootstraps the Python environment if needed. After starting, auto-discovers all available financial data tools.",
    {},
    () =>
      withErrorHandling(async () => {
        await (client as any).openbb.start();
        const status = await (client as any).openbb.getStatus();

        // Auto-discover tools after start
        if (status?.status === "running") {
          try {
            const res = await fetch(`${status.baseUrl}/openapi.json`, {
              signal: AbortSignal.timeout(15_000),
            });
            if (res.ok) {
              const spec = (await res.json()) as OpenApiSpec;
              const count = registerDynamicToolsFromSpec(server, client, spec);
              return {
                content: [
                  jsonContent({
                    ...status,
                    dynamicToolsRegistered: count,
                    message:
                      count > 0
                        ? `Server started. ${count} financial data tools auto-discovered.`
                        : "Server started. Tools were already registered.",
                  }),
                ],
              };
            }
          } catch {
            // Spec fetch failed — return status without dynamic tools
          }
        }

        return { content: [jsonContent(status)] };
      }),
  );
  registeredToolNames.add("research_terminal_start");

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
  registeredToolNames.add("research_terminal_stop");

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPOSITE / CONVENIENCE TOOLS (always available, handle "not running" internally)
  // ═══════════════════════════════════════════════════════════════════════════

  server.tool(
    "research_terminal_market_snapshot",
    "Get quotes for multiple symbols in a single call. Ideal for dashboards and watchlists.",
    {
      symbols: z.string().describe("Comma-separated tickers (e.g. AAPL,MSFT,GOOGL,SPY,QQQ)"),
      provider: z.string().optional().describe("Data provider (default: yfinance)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const baseUrl = await getBaseUrl(client);
        const symbolList = params.symbols.split(",").map((s) => s.trim()).filter(Boolean);
        const results: Record<string, unknown>[] = [];
        for (const symbol of symbolList) {
          try {
            const quote = await fetchData<Record<string, unknown>[]>(baseUrl, "/equity/price/quote", {
              symbol,
              ...(params.provider && { provider: params.provider }),
            });
            if (Array.isArray(quote) && quote.length > 0) results.push(quote[0]);
          } catch {
            results.push({ symbol, error: "Quote unavailable" });
          }
        }
        return { content: [jsonContent({ count: results.length, quotes: results })] };
      }),
  );
  registeredToolNames.add("research_terminal_market_snapshot");

  server.tool(
    "research_terminal_stock_analysis",
    "Comprehensive stock analysis: quote, profile, and recent price history in one call.",
    {
      symbol: z.string().describe("Ticker symbol (e.g. AAPL)"),
      days: z.number().optional().describe("Days of price history (default: 30)"),
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
          fetchData(baseUrl, "/equity/price/historical", { symbol, start_date: startStr, interval: "1d" }).catch(() => null),
        ]);
        return {
          content: [jsonContent({
            symbol,
            quote: Array.isArray(quote) && quote.length > 0 ? quote[0] : quote,
            profile: Array.isArray(profile) && profile.length > 0 ? profile[0] : profile,
            history: { days, data_points: Array.isArray(history) ? history.length : 0, data: history },
          })],
        };
      }),
  );
  registeredToolNames.add("research_terminal_stock_analysis");

  server.tool(
    "research_terminal_discover_tools",
    "List all available Research Terminal tools by category. Shows what financial data endpoints are available.",
    {},
    () =>
      withErrorHandling(async () => {
        const categories: Record<string, string[]> = {};
        for (const toolName of registeredToolNames) {
          const parts = toolName.replace(/^research_terminal_/, "").split("_");
          const cat = parts[0] || "other";
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(toolName);
        }
        return {
          content: [jsonContent({
            totalTools: registeredToolNames.size,
            categories: Object.fromEntries(
              Object.entries(categories)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cat, tools]) => [cat, { count: tools.length, tools: tools.sort() }]),
            ),
            hint: "Call research_terminal_start if you see fewer tools than expected.",
          })],
        };
      }),
  );
  registeredToolNames.add("research_terminal_discover_tools");

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMIC TOOL DISCOVERY (async — attempts to load if sidecar is running)
  // ═══════════════════════════════════════════════════════════════════════════

  // Fire-and-forget: try to load dynamic tools in background
  // This won't block the synchronous registration call
  (async () => {
    try {
      const status = await (client as any).openbb.getStatus();
      if (status?.status === "running") {
        const res = await fetch(`${status.baseUrl}/openapi.json`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const spec = (await res.json()) as OpenApiSpec;
          const count = registerDynamicToolsFromSpec(server, client, spec);
          if (count > 0) {
            process.stderr?.write?.(
              `[lattice-mcp] Auto-discovered ${count} research-terminal tools from OpenAPI spec\n`,
            );
          }
        }
      }
    } catch {
      // Sidecar not running — dynamic tools will load on research_terminal_start
    }
  })();
}
