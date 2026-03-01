/**
 * BaseClient — core HTTP/RPC infrastructure for NotebookLM API.
 *
 * Handles authentication, request building, response parsing, automatic
 * auth recovery, and retry with exponential backoff.
 *
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import {
  BASE_URL,
  DEFAULT_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY,
  DEFAULT_MAX_DELAY,
  QUERY_ENDPOINT,
} from "./constants";
import {
  buildRpcRequestBody,
  buildRpcUrl,
  buildRpcHeaders,
  parseRpcResponse,
  extractRpcResult,
  isAuthError,
  isRetryableStatus,
  getRpcName,
} from "./rpc";
import { cookiesToHeader, loadDefaultProfile, loadProfile, saveProfile } from "../auth/cookieManager";
import { refreshTokens } from "../auth/tokenRefresh";
import { headlessRefresh } from "../auth/cdpExtractor";

// ─── Errors ─────────────────────────────────────────────────────────────────

export class NotebookLmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookLmAuthError";
  }
}

export class NotebookLmApiError extends Error {
  constructor(
    message: string,
    public readonly rpcId?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "NotebookLmApiError";
  }
}

// ─── BaseClient ─────────────────────────────────────────────────────────────

export interface BaseClientOptions {
  /** Cookie dict or profile name to load from disk. */
  cookies?: Record<string, string>;
  /** Pre-extracted CSRF token (auto-refreshed if empty). */
  csrfToken?: string;
  /** Session ID for f.sid param. */
  sessionId?: string;
  /** Build label for bl param. */
  buildLabel?: string;
  /** Profile name for disk persistence. */
  profileName?: string;
  /** Interface language. */
  language?: string;
  /** Request timeout in ms. */
  timeout?: number;
}

export class BaseClient {
  private cookies: Record<string, string>;
  private csrfToken: string;
  private sessionId: string;
  private buildLabel: string;
  private profileName: string;
  private language: string;
  private timeout: number;
  private conversationHistory: Array<{ query: string; answer: string }> = [];

  constructor(opts: BaseClientOptions = {}) {
    this.cookies = opts.cookies ?? {};
    this.csrfToken = opts.csrfToken ?? "";
    this.sessionId = opts.sessionId ?? "";
    this.buildLabel = opts.buildLabel ?? "";
    this.profileName = opts.profileName ?? "default";
    this.language = opts.language ?? process.env.NOTEBOOKLM_HL ?? "en";
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Initialize the client — load auth from disk if no cookies provided,
   * then refresh tokens if needed.
   */
  async init(): Promise<void> {
    // If no cookies, try loading from disk
    if (Object.keys(this.cookies).length === 0) {
      const profile = this.profileName
        ? loadProfile(this.profileName) ?? loadDefaultProfile()
        : loadDefaultProfile();

      if (profile) {
        this.cookies = profile.cookies;
        this.csrfToken = profile.csrfToken;
        this.sessionId = profile.sessionId;
        this.buildLabel = profile.buildLabel;
        this.profileName = profile.name;
      }
    }

    // If still no cookies, check env vars
    if (Object.keys(this.cookies).length === 0) {
      const envCookies = process.env.NOTEBOOKLM_COOKIES;
      if (envCookies) {
        const { parseCookies } = await import("../auth/cookieManager");
        this.cookies = parseCookies(envCookies);
      }
      this.csrfToken = process.env.NOTEBOOKLM_CSRF_TOKEN ?? this.csrfToken;
      this.sessionId = process.env.NOTEBOOKLM_SESSION_ID ?? this.sessionId;
    }

    if (Object.keys(this.cookies).length === 0) {
      throw new NotebookLmAuthError(
        "No auth cookies found. Run the login flow first or provide cookies via env.",
      );
    }

    // Refresh tokens if CSRF is missing
    if (!this.csrfToken) {
      await this.refreshAuth();
    }
  }

  // ── Auth Recovery (3-layer) ─────────────────────────────────────────────

  /**
   * Layer 1: Refresh CSRF/session tokens by fetching the NotebookLM page.
   */
  private async refreshAuth(): Promise<void> {
    const tokens = await refreshTokens(this.cookies);
    this.csrfToken = tokens.csrfToken;
    this.sessionId = tokens.sessionId;
    this.buildLabel = tokens.buildLabel;

    // Persist refreshed tokens
    saveProfile({
      name: this.profileName,
      cookies: this.cookies,
      csrfToken: this.csrfToken,
      sessionId: this.sessionId,
      buildLabel: this.buildLabel,
      extractedAt: new Date().toISOString(),
    });
  }

  /**
   * Layer 2: Reload cookies from disk (user may have run login externally).
   */
  private reloadCookiesFromDisk(): boolean {
    const profile = loadProfile(this.profileName) ?? loadDefaultProfile();
    if (!profile) return false;

    this.cookies = profile.cookies;
    this.csrfToken = profile.csrfToken;
    this.sessionId = profile.sessionId;
    this.buildLabel = profile.buildLabel;
    return true;
  }

  /**
   * Layer 3: Attempt headless Chrome auth refresh.
   */
  private async headlessAuthRefresh(): Promise<boolean> {
    try {
      const cookies = await headlessRefresh(this.profileName);
      if (!cookies) return false;

      this.cookies = cookies;
      await this.refreshAuth();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Full 3-layer auth recovery: refresh tokens → reload disk → headless Chrome.
   */
  private async recoverAuth(): Promise<void> {
    // Layer 1: Refresh tokens
    try {
      await this.refreshAuth();
      return;
    } catch {
      // Fall through
    }

    // Layer 2: Reload from disk
    if (this.reloadCookiesFromDisk()) {
      try {
        await this.refreshAuth();
        return;
      } catch {
        // Fall through
      }
    }

    // Layer 3: Headless Chrome
    const recovered = await this.headlessAuthRefresh();
    if (!recovered) {
      throw new NotebookLmAuthError(
        "Authentication failed. All recovery methods exhausted. Please run the login flow again.",
      );
    }
  }

  // ── RPC Call ────────────────────────────────────────────────────────────

  /**
   * Execute an RPC call to NotebookLM's batchexecute endpoint.
   *
   * Handles:
   * - Request building (URL + body + headers)
   * - Response parsing (anti-XSSI, chunked JSON)
   * - Auth error detection and recovery
   * - Retry with exponential backoff on transient errors
   */
  async rpcCall(
    rpcId: string,
    params: unknown[],
    opts?: { timeout?: number; maxRetries?: number },
  ): Promise<unknown> {
    const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
    const callTimeout = opts?.timeout ?? this.timeout;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const url = buildRpcUrl({
        rpcId,
        sessionId: this.sessionId,
        buildLabel: this.buildLabel,
        language: this.language,
      });

      const body = buildRpcRequestBody(rpcId, params, this.csrfToken);
      const headers = buildRpcHeaders(cookiesToHeader(this.cookies));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeout);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw new NotebookLmApiError(
          `Network error calling ${getRpcName(rpcId)}: ${err instanceof Error ? err.message : String(err)}`,
          rpcId,
        );
      } finally {
        clearTimeout(timer);
      }

      // Auth error — try recovery
      if (response.status === 401 || response.status === 403) {
        if (attempt < maxRetries) {
          await this.recoverAuth();
          continue;
        }
        throw new NotebookLmAuthError("Authentication failed after recovery attempts");
      }

      // Retryable server error
      if (isRetryableStatus(response.status)) {
        if (attempt < maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw new NotebookLmApiError(
          `Server error ${response.status} calling ${getRpcName(rpcId)}`,
          rpcId,
          response.status,
        );
      }

      // Other non-200
      if (!response.ok) {
        throw new NotebookLmApiError(
          `HTTP ${response.status} calling ${getRpcName(rpcId)}`,
          rpcId,
          response.status,
        );
      }

      // Parse response
      const rawText = await response.text();
      const chunks = parseRpcResponse(rawText);
      const result = extractRpcResult(chunks, rpcId);

      // Check for auth error in result
      if (isAuthError(result)) {
        if (attempt < maxRetries) {
          await this.recoverAuth();
          continue;
        }
        throw new NotebookLmAuthError(
          "Authentication error in API response",
        );
      }

      return result;
    }

    throw new NotebookLmApiError(
      `Max retries exhausted for ${getRpcName(rpcId)}`,
      rpcId,
    );
  }

  // ── Streaming Query ────────────────────────────────────────────────────

  /**
   * Execute a streaming query to a notebook.
   *
   * Uses a different endpoint than batchexecute — the streaming gRPC-style
   * endpoint for GenerateFreeFormStreamed.
   */
  async streamQuery(
    notebookId: string,
    query: string,
    opts?: {
      sourceIds?: string[];
      conversationId?: string;
      timeout?: number;
    },
  ): Promise<{
    answer: string;
    citedSourceIds: string[];
  }> {
    const url = `${BASE_URL}${QUERY_ENDPOINT}`;
    const timeout = opts?.timeout ?? 120_000;

    // Build conversation history for follow-up queries
    const historyPayload = this.conversationHistory.map((turn) => [
      [turn.answer, null, 2],
      [turn.query, null, 1],
    ]);

    // Build compact JSON params
    const params: unknown[] = [
      null,                            // 0: unused
      null,                            // 1: unused
      query,                           // 2: query text
      null,                            // 3: unused
      null,                            // 4: unused
      notebookId,                      // 5: notebook ID
      null,                            // 6: unused
      opts?.sourceIds ?? [],           // 7: source IDs to query
      null,                            // 8: unused
      historyPayload.length > 0        // 9: conversation history
        ? historyPayload.flat()
        : null,
      null,                            // 10: unused
      opts?.conversationId ?? null,    // 11: conversation ID
    ];

    const body = JSON.stringify([params]);
    const cookieHeader = cookiesToHeader(this.cookies);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
          Origin: "https://notebooklm.google.com",
          Referer: "https://notebooklm.google.com/",
          "X-Same-Domain": "1",
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new NotebookLmApiError(
          `Query failed: HTTP ${response.status}`,
          "query",
          response.status,
        );
      }

      const rawText = await response.text();
      return this.parseQueryResponse(rawText, query);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Parse streaming query response.
   *
   * Response has anti-XSSI prefix, then line-delimited JSON arrays.
   * Type 1 entries = answer text, type 2 = thinking/status.
   */
  private parseQueryResponse(
    raw: string,
    query: string,
  ): { answer: string; citedSourceIds: string[] } {
    let body = raw;
    if (body.startsWith(")]}'\n")) {
      body = body.slice(5);
    }

    let answer = "";
    const citedSourceIds = new Set<string>();

    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (!Array.isArray(parsed)) continue;

        // Look for answer text in type-1 entries
        for (const entry of parsed) {
          if (!Array.isArray(entry)) continue;
          // entry[0] = text, entry[2] = type (1=answer, 2=thinking)
          if (entry.length >= 3 && entry[2] === 1 && typeof entry[0] === "string") {
            answer = entry[0];
          }
          // Extract citation source IDs
          if (Array.isArray(entry[1])) {
            for (const citation of entry[1]) {
              if (Array.isArray(citation) && typeof citation[0] === "string") {
                citedSourceIds.add(citation[0]);
              }
            }
          }
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    // Cache conversation turn for follow-up queries
    if (answer) {
      this.conversationHistory.push({ query, answer });
    }

    return {
      answer,
      citedSourceIds: [...citedSourceIds],
    };
  }

  // ── Conversation Management ────────────────────────────────────────────

  clearConversation(): void {
    this.conversationHistory = [];
  }

  getConversationHistory(): Array<{ query: string; answer: string }> {
    return [...this.conversationHistory];
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(
      DEFAULT_BASE_DELAY * Math.pow(2, attempt) + Math.random() * 1000,
      DEFAULT_MAX_DELAY,
    );
    await new Promise((r) => setTimeout(r, delay));
  }

  /** Check if the client has valid auth credentials loaded. */
  isAuthenticated(): boolean {
    return Object.keys(this.cookies).length > 0 && this.csrfToken !== "";
  }

  /** Get the current cookie header (for use by services that need raw HTTP). */
  getCookieHeader(): string {
    return cookiesToHeader(this.cookies);
  }

  /** Get current auth state (for manual token management). */
  getAuthState(): {
    cookies: Record<string, string>;
    csrfToken: string;
    sessionId: string;
    buildLabel: string;
  } {
    return {
      cookies: { ...this.cookies },
      csrfToken: this.csrfToken,
      sessionId: this.sessionId,
      buildLabel: this.buildLabel,
    };
  }

  /** Force a token refresh. */
  async forceRefresh(): Promise<void> {
    await this.refreshAuth();
  }

  /** Update cookies and tokens (e.g., from manual login). */
  setAuth(auth: {
    cookies: Record<string, string>;
    csrfToken?: string;
    sessionId?: string;
    buildLabel?: string;
  }): void {
    this.cookies = auth.cookies;
    if (auth.csrfToken) this.csrfToken = auth.csrfToken;
    if (auth.sessionId) this.sessionId = auth.sessionId;
    if (auth.buildLabel) this.buildLabel = auth.buildLabel;
  }
}
