import { createMCPClient, type OAuthClientProvider } from "@ai-sdk/mcp";
import type { Tool } from "ai";
import { log } from "@/node/services/log";
import { MCPStdioTransport } from "@/node/services/mcpStdioTransport";
import type {
  BearerChallenge,
  MCPHeaderValue,
  MCPServerInfo,
  MCPServerMap,
  MCPServerTransport,
  MCPTestResult,
  MinionMCPOverrides,
} from "@/common/types/mcp";
import type { Runtime } from "@/node/runtime/Runtime";
import type { PolicyService } from "@/node/services/policyService";
import type { MCPConfigService } from "@/node/services/mcpConfigService";
import { parseBearerWwwAuthenticate, type McpOauthService } from "@/node/services/mcpOauthService";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import { transformMCPResult, type MCPCallToolResult } from "@/node/services/mcpResultTransform";
import { buildMcpToolName } from "@/common/utils/tools/mcpToolName";
import { getErrorMessage } from "@/common/utils/errors";

const TEST_TIMEOUT_MS = 10_000;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

/**
 * Wrap MCP tools to transform their results to AI SDK format.
 * This ensures image content is properly converted to media type.
 */
function wrapMCPTools(tools: Record<string, Tool>, onActivity?: () => void): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    // Only wrap tools that have an execute function
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (args: Parameters<typeof originalExecute>[0], options) => {
        // Mark the MCP server set as active *before* execution, so failed tool
        // calls (including closed-client races) still count as activity.
        onActivity?.();

        const result: unknown = await originalExecute(args, options);
        return transformMCPResult(result as MCPCallToolResult);
      },
    };
  }
  return wrapped;
}

type ResolvedHeaders = Record<string, string> | undefined;

type ResolvedTransport = "stdio" | "http" | "sse";

function resolveHeaders(
  headers: Record<string, MCPHeaderValue> | undefined,
  projectSecrets: Record<string, string> | undefined
): { headers: ResolvedHeaders; usesSecretHeaders: boolean } {
  if (!headers) {
    return { headers: undefined, usesSecretHeaders: false };
  }

  const resolved: Record<string, string> = {};
  let usesSecretHeaders = false;

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      resolved[key] = value;
      continue;
    }

    usesSecretHeaders = true;
    const secretKey = value.secret;
    const secretValue = projectSecrets?.[secretKey];
    if (typeof secretValue !== "string") {
      throw new Error(`Missing project secret: ${secretKey}`);
    }
    resolved[key] = secretValue;
  }

  return { headers: resolved, usesSecretHeaders };
}

function extractHttpStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const obj = error as Record<string, unknown>;

  // A few common shapes across fetch libraries / AI SDK.
  const statusCode = obj.statusCode;
  if (typeof statusCode === "number") {
    return statusCode;
  }

  const status = obj.status;
  if (typeof status === "number") {
    return status;
  }

  const response = obj.response;
  if (response && typeof response === "object") {
    const responseStatus = (response as Record<string, unknown>).status;
    if (typeof responseStatus === "number") {
      return responseStatus;
    }
  }

  const cause = obj.cause;
  if (cause && typeof cause === "object") {
    const causeStatus = (cause as Record<string, unknown>).statusCode;
    if (typeof causeStatus === "number") {
      return causeStatus;
    }
  }

  // Best-effort fallback on message contents.
  const message = obj.message;
  if (typeof message === "string") {
    const re = /\b(400|401|403|404|405)\b/;
    const match = re.exec(message);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function shouldAutoFallbackToSse(error: unknown): boolean {
  const status = extractHttpStatusCode(error);
  return status === 400 || status === 404 || status === 405;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasHeaderGetter(value: unknown): value is { get: (name: string) => unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "get" in value &&
    typeof (value as { get: unknown }).get === "function"
  );
}

function extractHeaderValue(headers: unknown, name: string): string | null {
  if (!headers) {
    return null;
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name);
  }

  if (hasHeaderGetter(headers)) {
    const value = headers.get(name);
    return typeof value === "string" ? value : null;
  }

  if (isPlainObject(headers)) {
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== target) {
        continue;
      }

      if (typeof value === "string") {
        return value;
      }

      if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
        return value.join(", ");
      }
    }
  }

  return null;
}

function extractWwwAuthenticateHeader(error: unknown): string | null {
  if (!isPlainObject(error)) {
    return null;
  }

  const direct =
    extractHeaderValue(error.responseHeaders, "www-authenticate") ??
    extractHeaderValue(error.headers, "www-authenticate");

  if (direct) {
    return direct;
  }

  const response = error.response;
  if (isPlainObject(response)) {
    const fromResponse = extractHeaderValue(response.headers, "www-authenticate");
    if (fromResponse) {
      return fromResponse;
    }
  }

  const data = error.data;
  if (isPlainObject(data)) {
    const fromData =
      extractHeaderValue(data.responseHeaders, "www-authenticate") ??
      extractHeaderValue(data.headers, "www-authenticate");

    if (fromData) {
      return fromData;
    }
  }

  const cause = error.cause;
  if (cause) {
    return extractWwwAuthenticateHeader(cause);
  }

  return null;
}

async function probeWwwAuthenticateHeader(url: string): Promise<string | null> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 3_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
      },
      redirect: "manual",
      signal: abortController.signal,
    });

    return response.headers.get("www-authenticate");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractBearerOauthChallenge(options: {
  error: unknown;
  serverUrl: string | null;
}): Promise<BearerChallenge | null> {
  const status = extractHttpStatusCode(options.error);
  if (status !== 401 && status !== 403) {
    return null;
  }

  let header = extractWwwAuthenticateHeader(options.error);
  if (!header && options.serverUrl) {
    header = await probeWwwAuthenticateHeader(options.serverUrl);
  }

  if (!header) {
    return null;
  }

  const challenge = parseBearerWwwAuthenticate(header);
  if (!challenge) {
    return null;
  }

  return {
    scope: challenge.scope,
    resourceMetadataUrl: challenge.resourceMetadataUrl?.toString(),
  };
}

export type { MCPTestResult } from "@/common/types/mcp";

/**
 * Run a test connection to an MCP server.
 * Connects, fetches tools, then closes.
 */
async function runServerTest(
  server:
    | { transport: "stdio"; command: string }
    | {
        transport: "http" | "sse" | "auto";
        url: string;
        headers?: ResolvedHeaders;
        authProvider?: OAuthClientProvider;
      },
  projectPath: string,
  logContext: string
): Promise<MCPTestResult> {
  const timeoutPromise = new Promise<MCPTestResult>((resolve) =>
    setTimeout(() => resolve({ success: false, error: "Connection timed out" }), TEST_TIMEOUT_MS)
  );

  const testPromise = (async (): Promise<MCPTestResult> => {
    let stdioTransport: MCPStdioTransport | null = null;
    let client: Awaited<ReturnType<typeof createMCPClient>> | null = null;

    try {
      if (server.transport === "stdio") {
        const runtime = createRuntime({ type: "local", srcBaseDir: projectPath });
        log.debug(`[MCP] Testing ${logContext}`, { transport: "stdio" });

        const execStream = await runtime.exec(server.command, {
          cwd: projectPath,
          timeout: TEST_TIMEOUT_MS / 1000,
        });

        stdioTransport = new MCPStdioTransport(execStream);
        await stdioTransport.start();
        client = await createMCPClient({ transport: stdioTransport });
      } else {
        log.debug(`[MCP] Testing ${logContext}`, { transport: server.transport });

        const transportBase = {
          url: server.url,
          headers: server.headers,
          ...(server.authProvider ? { authProvider: server.authProvider } : {}),
        };

        const tryHttp = async () =>
          createMCPClient({
            transport: {
              type: "http",
              ...transportBase,
            },
          });

        const trySse = async () =>
          createMCPClient({
            transport: {
              type: "sse",
              ...transportBase,
            },
          });

        if (server.transport === "http") {
          client = await tryHttp();
        } else if (server.transport === "sse") {
          client = await trySse();
        } else {
          // auto
          try {
            client = await tryHttp();
          } catch (error) {
            if (!shouldAutoFallbackToSse(error)) {
              throw error;
            }
            log.debug(`[MCP] ${logContext} auto-fallback http→sse`, {
              status: extractHttpStatusCode(error),
            });
            client = await trySse();
          }
        }
      }

      const tools = await client.tools();
      const toolNames = Object.keys(tools);

      await client.close();
      client = null;

      if (stdioTransport) {
        await stdioTransport.close();
        stdioTransport = null;
      }

      log.info(`[MCP] ${logContext} test successful`, { toolCount: toolNames.length });
      return { success: true, tools: toolNames };
    } catch (error) {
      const message = getErrorMessage(error);
      log.warn(`[MCP] ${logContext} test failed`, { error: message });

      if (client) {
        try {
          await client.close();
        } catch {
          // ignore cleanup errors
        }
      }

      if (stdioTransport) {
        try {
          await stdioTransport.close();
        } catch {
          // ignore cleanup errors
        }
      }

      const oauthChallenge = await extractBearerOauthChallenge({
        error,
        serverUrl: server.transport === "stdio" ? null : server.url,
      });

      return {
        success: false,
        error: message,
        ...(oauthChallenge ? { oauthChallenge } : {}),
      };
    }
  })();

  return Promise.race([testPromise, timeoutPromise]);
}

interface MCPServerInstance {
  name: string;
  /** Resolved transport actually used (auto may fall back to sse). */
  resolvedTransport: ResolvedTransport;
  autoFallbackUsed: boolean;
  tools: Record<string, Tool>;
  /** True once the underlying MCP client/transport has been closed. */
  isClosed: boolean;
  close: () => Promise<void>;
}

export type MCPTransportMode = "none" | "stdio_only" | "http_only" | "sse_only" | "mixed";

export interface MCPMinionStats {
  enabledServerCount: number;
  startedServerCount: number;
  failedServerCount: number;
  autoFallbackCount: number;

  hasStdio: boolean;
  hasHttp: boolean;
  hasSse: boolean;
  transportMode: MCPTransportMode;
}

export interface MCPToolsForMinionResult {
  tools: Record<string, Tool>;
  stats: MCPMinionStats;
}
interface MinionServers {
  configSignature: string;
  instances: Map<string, MCPServerInstance>;
  stats: MCPMinionStats;
  lastActivity: number;
}

export interface MCPServerManagerOptions {
  /** Inline stdio servers to use (merged with config file servers by default) */
  inlineServers?: Record<string, string>;
  /** If true, ignore config file servers and use only inline servers */
  ignoreConfigFile?: boolean;
}

export class MCPServerManager {
  private readonly minionServers = new Map<string, MinionServers>();
  private readonly minionLeases = new Map<string, number>();
  private readonly idleCheckInterval: ReturnType<typeof setInterval>;
  private inlineServers: Record<string, string> = {};
  private readonly policyService: PolicyService | null;
  private mcpOauthService: McpOauthService | null = null;
  private ignoreConfigFile = false;

  setMcpOauthService(service: McpOauthService): void {
    this.mcpOauthService = service;
  }
  constructor(
    private readonly configService: MCPConfigService,
    options?: MCPServerManagerOptions,
    policyService?: PolicyService
  ) {
    this.policyService = policyService ?? null;
    this.idleCheckInterval = setInterval(() => this.cleanupIdleServers(), IDLE_CHECK_INTERVAL_MS);
    this.idleCheckInterval.unref?.();
    if (options?.inlineServers) {
      this.inlineServers = options.inlineServers;
    }
    if (options?.ignoreConfigFile) {
      this.ignoreConfigFile = options.ignoreConfigFile;
    }
  }

  /**
   * Get the set of built-in inline servers (name → command).
   * These are always enabled and cannot be disabled by config or minion overrides.
   */
  getInlineServers(): Record<string, string> {
    return { ...this.inlineServers };
  }

  /**
   * Stop the idle cleanup interval. Call when shutting down.
   */
  dispose(): void {
    clearInterval(this.idleCheckInterval);
  }

  private getLeaseCount(minionId: string): number {
    return this.minionLeases.get(minionId) ?? 0;
  }

  /**
   * Mark a minion's MCP servers as actively in-use.
   *
   * This prevents idle cleanup from shutting down MCP clients while a stream is
   * still running (which can otherwise surface as "Attempted to send a request
   * from a closed client").
   */
  acquireLease(minionId: string): void {
    const current = this.minionLeases.get(minionId) ?? 0;
    this.minionLeases.set(minionId, current + 1);
    this.markActivity(minionId);
  }

  /**
   * Release a previously-acquired lease.
   */
  releaseLease(minionId: string): void {
    const current = this.minionLeases.get(minionId) ?? 0;
    if (current <= 0) {
      log.debug("[MCP] releaseLease called without an active lease", { minionId });
      return;
    }

    if (current === 1) {
      this.minionLeases.delete(minionId);
      return;
    }

    this.minionLeases.set(minionId, current - 1);
  }

  private markActivity(minionId: string): void {
    const entry = this.minionServers.get(minionId);
    if (!entry) {
      return;
    }
    entry.lastActivity = Date.now();
  }

  private cleanupIdleServers(): void {
    const now = Date.now();
    for (const [minionId, entry] of this.minionServers) {
      if (entry.instances.size === 0) continue;

      // Never tear down a minion's MCP servers while a stream is running.
      if (this.getLeaseCount(minionId) > 0) {
        continue;
      }

      const idleMs = now - entry.lastActivity;
      if (idleMs >= IDLE_TIMEOUT_MS) {
        log.info("[MCP] Stopping idle servers", {
          minionId,
          idleMinutes: Math.round(idleMs / 60_000),
        });
        void this.stopServers(minionId);
      }
    }
  }

  /**
   * Get all servers from config (both enabled and disabled) + inline servers.
   * Returns full MCPServerInfo to preserve disabled state.
   */
  private async getAllServers(projectPath: string): Promise<Record<string, MCPServerInfo>> {
    const configServers = this.ignoreConfigFile
      ? {}
      : await this.configService.listServers(projectPath);
    // Inline servers override config file servers (always enabled, built-in)
    const inlineAsInfo: Record<string, MCPServerInfo> = {};
    for (const [name, command] of Object.entries(this.inlineServers)) {
      inlineAsInfo[name] = { transport: "stdio", command, disabled: false, builtin: true };
    }
    return { ...configServers, ...inlineAsInfo };
  }

  /**
   * List configured MCP servers for a project (name -> command).
   * Used to show server info in the system prompt.
   *
   * Applies both project-level disabled state and minion-level overrides:
   * - Project disabled + minion enabled => enabled
   * - Project enabled + minion disabled => disabled
   * - No minion override => use project state
   *
   * @param projectPath - Project path to get servers for
   * @param overrides - Optional minion-level overrides
   */
  async listServers(projectPath: string, overrides?: MinionMCPOverrides): Promise<MCPServerMap> {
    const allServers = await this.getAllServers(projectPath);
    const enabled = this.applyServerOverrides(allServers, overrides);
    return this.filterServersByPolicy(enabled);
  }

  /**
   * Filter servers based on the effective policy (e.g. disallow stdio/remote).
   */
  private filterServersByPolicy(servers: MCPServerMap): MCPServerMap {
    if (!this.policyService?.isEnforced()) {
      return servers;
    }

    const filtered: MCPServerMap = {};
    for (const [name, info] of Object.entries(servers)) {
      if (this.policyService.isMcpTransportAllowed(info.transport)) {
        filtered[name] = info;
      }
    }

    return filtered;
  }

  /**
   * Apply minion MCP overrides to determine final server enabled state.
   *
   * Logic:
   * - If server is in enabledServers: enabled (overrides project disabled)
   * - If server is in disabledServers: disabled (overrides project enabled)
   * - Otherwise: use project-level disabled state
   */
  private applyServerOverrides(
    servers: Record<string, MCPServerInfo>,
    overrides?: MinionMCPOverrides
  ): MCPServerMap {
    const enabledSet = new Set(overrides?.enabledServers ?? []);
    const disabledSet = new Set(overrides?.disabledServers ?? []);

    const result: MCPServerMap = {};
    for (const [name, info] of Object.entries(servers)) {
      // Minion overrides take precedence
      if (enabledSet.has(name)) {
        // Explicitly enabled at minion level (overrides project disabled)
        result[name] = { ...info, disabled: false };
        continue;
      }

      if (disabledSet.has(name)) {
        // Explicitly disabled at minion level - skip
        continue;
      }

      if (!info.disabled) {
        // Enabled at project level, no minion override
        result[name] = info;
      }
      // If disabled at project level with no minion override, skip
    }

    return result;
  }

  /**
   * Apply tool allowlists to filter tools from a server.
   * Project-level allowlist is applied first, then minion-level (intersection).
   *
   * @param serverName - Name of the MCP server (used for allowlist lookup)
   * @param tools - Record of tool name -> Tool (NOT namespaced)
   * @param projectAllowlist - Optional project-level tool allowlist (from .lattice/mcp.jsonc)
   * @param minionOverrides - Optional minion MCP overrides containing toolAllowlist
   * @returns Filtered tools record
   */
  private applyToolAllowlist(
    serverName: string,
    tools: Record<string, Tool>,
    projectAllowlist?: string[],
    minionOverrides?: MinionMCPOverrides
  ): Record<string, Tool> {
    const minionAllowlist = minionOverrides?.toolAllowlist?.[serverName];

    // Determine effective allowlist:
    // - If both exist: intersection (minion restricts further)
    // - If only project: use project
    // - If only minion: use minion
    // - If neither: no filtering
    let effectiveAllowlist: Set<string> | null = null;

    if (projectAllowlist && projectAllowlist.length > 0 && minionAllowlist) {
      // Intersection of both allowlists
      const projectSet = new Set(projectAllowlist);
      effectiveAllowlist = new Set(minionAllowlist.filter((t) => projectSet.has(t)));
    } else if (projectAllowlist && projectAllowlist.length > 0) {
      effectiveAllowlist = new Set(projectAllowlist);
    } else if (minionAllowlist) {
      effectiveAllowlist = new Set(minionAllowlist);
    }

    if (!effectiveAllowlist) {
      // No allowlist => return all tools
      return tools;
    }

    // Filter to only allowed tools
    const filtered: Record<string, Tool> = {};
    for (const [name, tool] of Object.entries(tools)) {
      if (effectiveAllowlist.has(name)) {
        filtered[name] = tool;
      }
    }

    log.debug("[MCP] Applied tool allowlist", {
      serverName,
      projectAllowlist,
      minionAllowlist,
      effectiveCount: effectiveAllowlist.size,
      originalCount: Object.keys(tools).length,
      filteredCount: Object.keys(filtered).length,
    });

    return filtered;
  }

  async getToolsForMinion(options: {
    minionId: string;
    projectPath: string;
    runtime: Runtime;
    minionPath: string;
    /** Per-minion MCP overrides (disabled servers, tool allowlists) */
    overrides?: MinionMCPOverrides;
    /** Project secrets, used for resolving {secret: "KEY"} header references. */
    projectSecrets?: Record<string, string>;
  }): Promise<MCPToolsForMinionResult> {
    const { minionId, projectPath, runtime, minionPath, overrides, projectSecrets } = options;

    // Fetch full server info for project-level allowlists and server filtering
    const fullServerInfo = await this.getAllServers(projectPath);

    // Apply server-level overrides (enabled/disabled) before caching
    const enabledServers = this.filterServersByPolicy(
      this.applyServerOverrides(fullServerInfo, overrides)
    );
    const enabledEntries = Object.entries(enabledServers).sort(([a], [b]) => a.localeCompare(b));

    // Signature is based on *start config* only (not tool allowlists), so changing allowlists
    // does not force a server restart.
    const signatureEntries: Record<string, unknown> = {};
    for (const [name, info] of enabledEntries) {
      if (info.transport === "stdio") {
        signatureEntries[name] = { transport: "stdio", command: info.command };
        continue;
      }

      // OAuth status affects whether we can attach authProvider during server start.
      // Include this (redacted) information in the signature so we retry starting
      // remote servers after a user logs in/out.
      let hasOauthTokens = false;
      if (this.mcpOauthService) {
        try {
          hasOauthTokens = await this.mcpOauthService.hasAuthTokens({
            serverUrl: info.url,
          });
        } catch (error) {
          log.debug("[MCP] Failed to resolve MCP OAuth status", { name, error });
        }
      }

      try {
        const { headers } = resolveHeaders(info.headers, projectSecrets);
        signatureEntries[name] = {
          transport: info.transport,
          url: info.url,
          headers,
          hasOauthTokens,
        };
      } catch {
        // Missing secrets or invalid header config. Keep signature stable but avoid leaking details.
        signatureEntries[name] = {
          transport: info.transport,
          url: info.url,
          headers: null,
          hasOauthTokens,
        };
      }
    }

    const signature = JSON.stringify(signatureEntries);

    const existing = this.minionServers.get(minionId);
    const leaseCount = this.getLeaseCount(minionId);

    const hasClosedInstance =
      existing && [...existing.instances.values()].some((instance) => instance.isClosed);

    if (existing?.configSignature === signature && !hasClosedInstance) {
      existing.lastActivity = Date.now();
      log.debug("[MCP] Using cached servers", {
        minionId,
        serverCount: enabledEntries.length,
      });

      return {
        tools: this.collectTools(existing.instances, fullServerInfo, overrides),
        stats: existing.stats,
      };
    }

    // If a stream is actively running, avoid closing MCP clients out from under it.
    //
    // Note: AIService may fetch tools before StreamManager interrupts an existing stream,
    // so closing servers here can hand out tool objects backed by a client that's about to close.
    if (existing && leaseCount > 0) {
      existing.lastActivity = Date.now();

      if (hasClosedInstance) {
        // One or more server instances died while another stream was still active.
        //
        // Critical: do NOT stop all servers here, or we'd close healthy clients that the
        // in-flight stream may still be using.
        const closedServerNames = [...existing.instances.values()]
          .filter((instance) => instance.isClosed)
          .map((instance) => instance.name);

        log.info("[MCP] Restarting closed server instances while stream is active", {
          minionId,
          closedServerNames,
        });

        const serversToRestart: MCPServerMap = {};
        for (const serverName of closedServerNames) {
          const info = enabledServers[serverName];
          if (info) {
            serversToRestart[serverName] = info;
          }
        }

        // Remove closed instances first so we don't hand out tools backed by a dead client.
        for (const serverName of closedServerNames) {
          const instance = existing.instances.get(serverName);
          if (!instance) {
            continue;
          }

          existing.instances.delete(serverName);

          try {
            await instance.close();
          } catch (error) {
            log.debug("[MCP] Error closing dead instance", { minionId, serverName, error });
          }
        }

        const restartedInstances = await this.startServers(
          serversToRestart,
          runtime,
          projectPath,
          minionPath,
          projectSecrets,
          () => this.markActivity(minionId)
        );

        for (const [serverName, instance] of restartedInstances) {
          existing.instances.set(serverName, instance);
        }
      }

      log.info("[MCP] Deferring MCP server restart while stream is active", {
        minionId,
      });

      // Even while deferring restarts, ensure new tool lists reflect the latest enabled/disabled
      // server set. We cannot revoke tools already captured by an in-flight stream, but we
      // can avoid exposing tools from newly-disabled servers to the next stream.
      const instancesForTools = new Map(
        [...existing.instances].filter(([serverName]) => enabledServers[serverName] !== undefined)
      );

      return {
        tools: this.collectTools(instancesForTools, fullServerInfo, overrides),
        stats: existing.stats,
      };
    }

    // Config changed, instance closed, or not started yet -> restart
    if (enabledEntries.length > 0) {
      log.info("[MCP] Starting servers", {
        minionId,
        servers: enabledEntries.map(([name]) => name),
      });
    }

    if (existing && hasClosedInstance) {
      log.info("[MCP] Restarting servers due to closed client", { minionId });
    }

    await this.stopServers(minionId);

    const instances = await this.startServers(
      enabledServers,
      runtime,
      projectPath,
      minionPath,
      projectSecrets,
      () => this.markActivity(minionId)
    );

    const resolvedTransports = new Set<ResolvedTransport>();
    for (const instance of instances.values()) {
      resolvedTransports.add(instance.resolvedTransport);
    }

    const hasStdio = resolvedTransports.has("stdio");
    const hasHttp = resolvedTransports.has("http");
    const hasSse = resolvedTransports.has("sse");

    const transportMode: MCPTransportMode =
      instances.size === 0
        ? "none"
        : resolvedTransports.size === 1 && hasStdio
          ? "stdio_only"
          : resolvedTransports.size === 1 && hasHttp
            ? "http_only"
            : resolvedTransports.size === 1 && hasSse
              ? "sse_only"
              : "mixed";

    const stats: MCPMinionStats = {
      enabledServerCount: enabledEntries.length,
      startedServerCount: instances.size,
      failedServerCount: Math.max(0, enabledEntries.length - instances.size),
      autoFallbackCount: [...instances.values()].filter((i) => i.autoFallbackUsed).length,
      hasStdio,
      hasHttp,
      hasSse,
      transportMode,
    };

    this.minionServers.set(minionId, {
      configSignature: signature,
      instances,
      stats,
      lastActivity: Date.now(),
    });

    return {
      tools: this.collectTools(instances, fullServerInfo, overrides),
      stats,
    };
  }

  async stopServers(minionId: string): Promise<void> {
    const entry = this.minionServers.get(minionId);
    if (!entry) return;

    // Remove from cache immediately so callers can't re-use tools backed by a
    // client that is in the middle of closing.
    this.minionServers.delete(minionId);

    for (const instance of entry.instances.values()) {
      try {
        await instance.close();
      } catch (error) {
        log.warn("Failed to stop MCP server", { error, name: instance.name });
      }
    }
  }

  /**
   * Test an MCP server.
   *
   * Provide either:
   * - `name` to test a configured server by looking up its config, OR
   * - `command` to test an arbitrary stdio command, OR
   * - `url`+`transport` to test an arbitrary HTTP/SSE endpoint.
   */
  async test(options: {
    projectPath: string;
    name?: string;
    command?: string;
    transport?: MCPServerTransport;
    url?: string;
    headers?: Record<string, MCPHeaderValue>;
    projectSecrets?: Record<string, string>;
  }): Promise<MCPTestResult> {
    const isTransportAllowed = (t: MCPServerTransport): boolean => {
      return !this.policyService?.isEnforced() || this.policyService.isMcpTransportAllowed(t);
    };
    const { projectPath, name, command, transport, url, headers, projectSecrets } = options;
    const trimmedName = name?.trim();

    if (trimmedName && !command?.trim() && !url?.trim()) {
      // Check both config servers and built-in inline servers
      const allServers = await this.getAllServers(projectPath);
      const server = allServers[trimmedName];
      if (!server) {
        return { success: false, error: `Server "${trimmedName}" not found in configuration` };
      }

      if (!isTransportAllowed(server.transport)) {
        return { success: false, error: "MCP transport is disabled by policy" };
      }

      if (server.transport === "stdio") {
        return runServerTest(
          { transport: "stdio", command: server.command },
          projectPath,
          `server "${trimmedName}"`
        );
      }

      try {
        const resolved = resolveHeaders(server.headers, projectSecrets);

        const authProvider = await this.mcpOauthService?.getAuthProviderForServer({
          serverName: trimmedName,
          serverUrl: server.url,
        });

        return runServerTest(
          {
            transport: server.transport,
            url: server.url,
            headers: resolved.headers,
            ...(authProvider ? { authProvider } : {}),
          },
          projectPath,
          `server "${trimmedName}"`
        );
      } catch (error) {
        const message = getErrorMessage(error);
        return { success: false, error: message };
      }
    }

    if (command?.trim()) {
      if (!isTransportAllowed("stdio")) {
        return { success: false, error: "MCP transport is disabled by policy" };
      }
      return runServerTest({ transport: "stdio", command }, projectPath, "command");
    }

    if (url?.trim()) {
      const serverUrl = url.trim();

      if (transport !== "http" && transport !== "sse" && transport !== "auto") {
        return { success: false, error: "transport must be http|sse|auto when testing by url" };
      }

      if (!isTransportAllowed(transport)) {
        return { success: false, error: "MCP transport is disabled by policy" };
      }

      try {
        const resolved = resolveHeaders(headers, projectSecrets);

        const authProvider = trimmedName
          ? await this.mcpOauthService?.getAuthProviderForServer({
              serverName: trimmedName,
              serverUrl,
            })
          : undefined;
        return runServerTest(
          {
            transport,
            url: serverUrl,
            headers: resolved.headers,
            ...(authProvider ? { authProvider } : {}),
          },
          projectPath,
          trimmedName ? `server "${trimmedName}" (url)` : "url"
        );
      } catch (error) {
        const message = getErrorMessage(error);
        return { success: false, error: message };
      }
    }

    return { success: false, error: "Either name, command, or url is required" };
  }

  /**
   * Collect tools from all server instances, applying tool allowlists.
   *
   * @param instances - Map of server instances
   * @param serverInfo - Project-level server info (for project-level tool allowlists)
   * @param minionOverrides - Optional minion MCP overrides for tool allowlists
   * @returns Aggregated tools record with provider-safe namespaced names
   */
  private collectTools(
    instances: Map<string, MCPServerInstance>,
    serverInfo: Record<string, MCPServerInfo>,
    minionOverrides?: MinionMCPOverrides
  ): Record<string, Tool> {
    const aggregated: Record<string, Tool> = {};
    const usedNames = new Set<string>();

    // Sort for determinism so collision handling yields stable tool keys.
    const sortedInstances = [...instances.values()].sort((a, b) => a.name.localeCompare(b.name));

    for (const instance of sortedInstances) {
      // Get project-level allowlist for this server
      const projectAllowlist = serverInfo[instance.name]?.toolAllowlist;
      // Apply tool allowlist filtering (project-level + minion-level)
      const filteredTools = this.applyToolAllowlist(
        instance.name,
        instance.tools,
        projectAllowlist,
        minionOverrides
      );

      const sortedTools = Object.entries(filteredTools).sort(([a], [b]) => a.localeCompare(b));

      for (const [toolName, tool] of sortedTools) {
        const originalName = `${instance.name}_${toolName}`;

        // Namespace tools with server name to prevent collisions.
        //
        // Important: provider SDKs can validate tool names strictly (regex + 64-char max).
        // User-configured MCP server names may contain spaces or other invalid characters,
        // so we normalize keys here instead of forcing a config migration.
        const result = buildMcpToolName({
          serverName: instance.name,
          toolName,
          usedNames,
        });

        if (!result) {
          log.error("[MCP] Failed to build provider-safe tool name", {
            serverName: instance.name,
            toolName,
          });
          continue;
        }

        if (result.wasSuffixed) {
          log.warn("[MCP] Normalized MCP tool name required hash suffix", {
            serverName: instance.name,
            toolName,
            originalName,
            normalizedName: result.toolName,
            baseName: result.baseName,
          });
        } else if (result.toolName !== originalName) {
          log.debug("[MCP] Normalized MCP tool name", {
            serverName: instance.name,
            toolName,
            originalName,
            normalizedName: result.toolName,
          });
        }

        aggregated[result.toolName] = tool;
      }
    }

    return aggregated;
  }

  private async startServers(
    servers: MCPServerMap,
    runtime: Runtime,
    projectPath: string,
    minionPath: string,
    projectSecrets: Record<string, string> | undefined,
    onActivity: () => void
  ): Promise<Map<string, MCPServerInstance>> {
    const result = new Map<string, MCPServerInstance>();
    const entries = Object.entries(servers);

    for (const [name, info] of entries) {
      try {
        const instance = await this.startSingleServer(
          name,
          info,
          runtime,
          projectPath,
          minionPath,
          projectSecrets,
          onActivity
        );
        if (instance) {
          result.set(name, instance);
        }
      } catch (error) {
        const message = getErrorMessage(error);
        log.error("Failed to start MCP server", { name, error: message });
      }
    }

    return result;
  }

  private async startSingleServer(
    name: string,
    info: MCPServerInfo,
    runtime: Runtime,
    _projectPath: string,
    minionPath: string,
    projectSecrets: Record<string, string> | undefined,
    onActivity: () => void
  ): Promise<MCPServerInstance | null> {
    if (info.transport === "stdio") {
      log.debug("[MCP] Spawning stdio server", { name });
      const execStream = await runtime.exec(info.command, {
        cwd: minionPath,
        timeout: 60 * 60 * 24, // 24 hours
      });

      const transport = new MCPStdioTransport(execStream);

      const instanceRef: { current: MCPServerInstance | null } = { current: null };
      let transportClosed = false;
      const markClosed = () => {
        if (transportClosed) {
          return;
        }
        transportClosed = true;
        if (instanceRef.current) {
          instanceRef.current.isClosed = true;
        }
      };

      transport.onclose = markClosed;

      transport.onerror = (error) => {
        log.error("[MCP] Transport error", { name, error });
      };

      await transport.start();
      const client = await createMCPClient({ transport });
      const rawTools = await client.tools();
      const tools = wrapMCPTools(rawTools as unknown as Record<string, Tool>, onActivity);

      log.info("[MCP] Server ready", {
        name,
        transport: "stdio",
        toolCount: Object.keys(tools).length,
      });

      const instance: MCPServerInstance = {
        name,
        resolvedTransport: "stdio",
        autoFallbackUsed: false,
        tools,
        isClosed: transportClosed,
        close: async () => {
          // Mark closed first to prevent any new tool calls from being treated as
          // valid by higher-level caching logic.
          markClosed();

          try {
            await client.close();
          } catch (error) {
            log.debug("[MCP] Error closing client", { name, error });
          }
          try {
            await transport.close();
          } catch (error) {
            log.debug("[MCP] Error closing transport", { name, error });
          }
        },
      };

      instanceRef.current = instance;
      return instance;
    }

    const { headers } = resolveHeaders(info.headers, projectSecrets);

    // Only attach authProvider when we have stored OAuth tokens for this server.
    // Passing an authProvider with no tokens can trigger user-interactive auth flows
    // on background MCP calls (undesirable).
    const authProvider = await this.mcpOauthService?.getAuthProviderForServer({
      serverName: name,
      serverUrl: info.url,
    });

    const transportBase = {
      url: info.url,
      headers,
      ...(authProvider ? { authProvider } : {}),
    };

    const tryHttp = async () =>
      createMCPClient({
        transport: {
          type: "http",
          ...transportBase,
        },
      });

    const trySse = async () =>
      createMCPClient({
        transport: {
          type: "sse",
          ...transportBase,
        },
      });

    let client: Awaited<ReturnType<typeof createMCPClient>>;
    let resolvedTransport: ResolvedTransport;
    let autoFallbackUsed = false;

    if (info.transport === "http") {
      resolvedTransport = "http";
      client = await tryHttp();
    } else if (info.transport === "sse") {
      resolvedTransport = "sse";
      client = await trySse();
    } else {
      // auto
      try {
        resolvedTransport = "http";
        client = await tryHttp();
      } catch (error) {
        if (!shouldAutoFallbackToSse(error)) {
          throw error;
        }
        autoFallbackUsed = true;
        resolvedTransport = "sse";
        log.debug("[MCP] Auto-fallback http→sse", { name, status: extractHttpStatusCode(error) });
        client = await trySse();
      }
    }

    let clientClosed = false;

    const rawTools = await client.tools();
    const tools = wrapMCPTools(rawTools as unknown as Record<string, Tool>, onActivity);

    log.info("[MCP] Server ready", {
      name,
      transport: resolvedTransport,
      toolCount: Object.keys(tools).length,
      autoFallbackUsed,
    });

    const instance: MCPServerInstance = {
      name,
      resolvedTransport,
      autoFallbackUsed,
      tools,
      isClosed: clientClosed,
      close: async () => {
        // Mark closed first to prevent any new tool calls from being treated as
        // valid by higher-level caching logic.
        if (!clientClosed) {
          clientClosed = true;
          instance.isClosed = true;
        }

        try {
          await client.close();
        } catch (error) {
          log.debug("[MCP] Error closing client", { name, error });
        }
      },
    };

    return instance;
  }
}
