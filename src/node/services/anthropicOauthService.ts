/**
 * Anthropic OAuth service — PKCE authorization code flow.
 *
 * Enables Claude Pro/Max subscribers to authenticate with their Anthropic
 * account. The flow:
 *   1. Backend generates PKCE verifier/challenge + authorize URL
 *   2. User opens URL in browser, logs in to claude.ai
 *   3. Gets redirected to console.anthropic.com/oauth/code/callback showing a code
 *   4. User pastes code back into Lattice Settings UI
 *   5. Backend exchanges code for access + refresh tokens
 *   6. Access token is used as Anthropic API key (via x-api-key header)
 *
 * Follows the Codex OAuth service pattern for token storage, caching,
 * refresh, and cleanup.
 */
import * as crypto from "crypto";
import type { Result } from "@/common/types/result";
import { Err, Ok } from "@/common/types/result";
import {
  ANTHROPIC_OAUTH_CLIENT_ID,
  ANTHROPIC_OAUTH_AUTHORIZE_URL,
  ANTHROPIC_OAUTH_TOKEN_URL,
  ANTHROPIC_OAUTH_REDIRECT_URI,
  ANTHROPIC_OAUTH_SCOPES,
  isAnthropicOauthExpired,
  parseAnthropicOauthAuth,
  type AnthropicOauthAuth,
} from "@/common/constants/anthropicOAuth";
import type { Config } from "@/node/config";
import type { ProviderService } from "@/node/services/providerService";
import type { WindowService } from "@/node/services/windowService";
import { log } from "@/node/services/log";
import { AsyncMutex } from "@/node/utils/concurrency/asyncMutex";
import { createDeferred } from "@/node/utils/oauthUtils";
import { getErrorMessage } from "@/common/utils/errors";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const COMPLETED_FLOW_TTL_MS = 60 * 1000;

/** 5-minute buffer subtracted from expires_in so we refresh before actual expiry. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface AuthFlow {
  flowId: string;
  /** PKCE code verifier — needed for the token exchange. */
  codeVerifier: string;
  cancelled: boolean;
  timeout: ReturnType<typeof setTimeout>;
  cleanupTimeout: ReturnType<typeof setTimeout> | null;
  resultPromise: Promise<Result<void, string>>;
  resolveResult: (result: Result<void, string>) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function randomBase64Url(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function isInvalidGrantError(errorText: string): boolean {
  const trimmed = errorText.trim();
  if (trimmed.length === 0) return false;

  try {
    const json = JSON.parse(trimmed) as unknown;
    if (isPlainObject(json) && json.error === "invalid_grant") return true;
  } catch {
    // fall through
  }

  const lower = trimmed.toLowerCase();
  return lower.includes("invalid_grant") || lower.includes("revoked");
}

export class AnthropicOauthService {
  private readonly flows = new Map<string, AuthFlow>();
  private readonly refreshMutex = new AsyncMutex();

  // In-memory cache; invalidated on every write (exchange, refresh, disconnect).
  private cachedAuth: AnthropicOauthAuth | null = null;

  constructor(
    private readonly config: Config,
    private readonly providerService: ProviderService,
    private readonly windowService?: WindowService
  ) {}

  // ---------------------------------------------------------------------------
  // Public API: flow lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start a new OAuth flow.
   * Returns the authorize URL that the user must open in their browser.
   */
  startFlow(): Result<{ flowId: string; authorizeUrl: string }, string> {
    const flowId = randomBase64Url();
    const codeVerifier = randomBase64Url();
    const codeChallenge = sha256Base64Url(codeVerifier);

    const authParams = new URLSearchParams({
      code: "true",
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      response_type: "code",
      redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
      scope: ANTHROPIC_OAUTH_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: codeVerifier,
    });

    const authorizeUrl = `${ANTHROPIC_OAUTH_AUTHORIZE_URL}?${authParams.toString()}`;

    const { promise: resultPromise, resolve: resolveResult } =
      createDeferred<Result<void, string>>();

    const timeout = setTimeout(() => {
      this.finishFlow(flowId, Err("Timed out waiting for Anthropic authorization"));
    }, DEFAULT_TIMEOUT_MS);

    this.flows.set(flowId, {
      flowId,
      codeVerifier,
      cancelled: false,
      timeout,
      cleanupTimeout: null,
      resultPromise,
      resolveResult,
    });

    log.debug(`[Anthropic OAuth] Flow started (flowId=${flowId})`);

    return Ok({ flowId, authorizeUrl });
  }

  /**
   * Submit the authorization code the user copied from the Anthropic redirect page.
   * The code format is `<code>#<state>` as provided by Anthropic's callback.
   */
  async submitCode(flowId: string, rawCode: string): Promise<Result<void, string>> {
    const flow = this.flows.get(flowId);
    if (!flow) return Err("OAuth flow not found");
    if (flow.cancelled) return Err("OAuth flow already cancelled");

    // The Anthropic callback produces "code#state" format.
    const hashIdx = rawCode.indexOf("#");
    const code = hashIdx >= 0 ? rawCode.slice(0, hashIdx) : rawCode;
    const state = hashIdx >= 0 ? rawCode.slice(hashIdx + 1) : undefined;

    // state is the code verifier echoed back — optional validation
    if (state && state !== flow.codeVerifier) {
      log.debug("[Anthropic OAuth] State mismatch — proceeding anyway (best-effort)");
    }

    // Anthropic's token endpoint requires the `state` parameter alongside code_verifier.
    // state is echoed from the authorize redirect (= the verifier we sent).
    const exchangeState = state ?? flow.codeVerifier;
    const exchangeResult = await this.exchangeCodeForTokens(code, flow.codeVerifier, exchangeState);
    if (!exchangeResult.success) {
      this.finishFlow(flowId, Err(exchangeResult.error));
      return Err(exchangeResult.error);
    }

    const persistResult = this.persistAuth(exchangeResult.data);
    if (!persistResult.success) {
      this.finishFlow(flowId, Err(persistResult.error));
      return Err(persistResult.error);
    }

    log.debug(`[Anthropic OAuth] Exchange completed (flowId=${flowId})`);
    this.windowService?.focusMainWindow();
    this.finishFlow(flowId, Ok(undefined));
    return Ok(undefined);
  }

  /**
   * Wait for a flow to complete (blocks until submitCode resolves, timeout, or cancel).
   */
  async waitForFlow(flowId: string, opts?: { timeoutMs?: number }): Promise<Result<void, string>> {
    const flow = this.flows.get(flowId);
    if (!flow) return Err("OAuth flow not found");

    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<Result<void, string>>((resolve) => {
      timeoutHandle = setTimeout(() => {
        resolve(Err("Timed out waiting for Anthropic authorization"));
      }, timeoutMs);
    });

    const result = await Promise.race([flow.resultPromise, timeoutPromise]);

    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (!result.success) this.finishFlow(flowId, result);

    return result;
  }

  cancelFlow(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow || flow.cancelled) return;

    log.debug(`[Anthropic OAuth] Flow cancelled (flowId=${flowId})`);
    this.finishFlow(flowId, Err("OAuth flow cancelled"));
  }

  // ---------------------------------------------------------------------------
  // Public API: token access
  // ---------------------------------------------------------------------------

  /**
   * Get a valid access token, refreshing if expired.
   * The access token is usable as an Anthropic API key.
   */
  async getValidAuth(): Promise<Result<AnthropicOauthAuth, string>> {
    const stored = this.readStoredAuth();
    if (!stored) return Err("Anthropic OAuth is not configured");

    if (!isAnthropicOauthExpired(stored)) return Ok(stored);

    await using _lock = await this.refreshMutex.acquire();

    // Re-read after lock in case another caller refreshed first.
    const latest = this.readStoredAuth();
    if (!latest) return Err("Anthropic OAuth is not configured");
    if (!isAnthropicOauthExpired(latest)) return Ok(latest);

    return this.refreshTokens(latest);
  }

  disconnect(): Result<void, string> {
    this.cachedAuth = null;
    return this.providerService.setConfigValue("anthropic", ["anthropicOauth"], undefined);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    for (const flow of this.flows.values()) {
      clearTimeout(flow.timeout);
      if (flow.cleanupTimeout !== null) clearTimeout(flow.cleanupTimeout);
      flow.cancelled = true;
      try {
        flow.resolveResult(Err("App shutting down"));
      } catch {
        /* already resolved */
      }
    }
    this.flows.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private readStoredAuth(): AnthropicOauthAuth | null {
    if (this.cachedAuth) return this.cachedAuth;

    const providersConfig = this.config.loadProvidersConfig() ?? {};
    const anthropicConfig = providersConfig.anthropic as Record<string, unknown> | undefined;
    const auth = parseAnthropicOauthAuth(anthropicConfig?.anthropicOauth);
    this.cachedAuth = auth;
    return auth;
  }

  private persistAuth(auth: AnthropicOauthAuth): Result<void, string> {
    const result = this.providerService.setConfigValue("anthropic", ["anthropicOauth"], auth);
    // Invalidate cache so next read picks up the persisted value from disk.
    this.cachedAuth = null;
    return result;
  }

  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    state: string
  ): Promise<Result<AnthropicOauthAuth, string>> {
    try {
      const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: ANTHROPIC_OAUTH_CLIENT_ID,
          code,
          state,
          redirect_uri: ANTHROPIC_OAUTH_REDIRECT_URI,
          code_verifier: codeVerifier,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const prefix = `Anthropic OAuth exchange failed (${response.status})`;
        return Err(errorText ? `${prefix}: ${errorText}` : prefix);
      }

      const json = (await response.json()) as unknown;
      if (!isPlainObject(json)) {
        return Err("Anthropic OAuth exchange returned invalid JSON");
      }

      const accessToken = typeof json.access_token === "string" ? json.access_token : null;
      const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
      const expiresIn =
        typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
          ? json.expires_in
          : null;

      if (!accessToken) return Err("Anthropic OAuth exchange missing access_token");
      if (!refreshToken) return Err("Anthropic OAuth exchange missing refresh_token");
      if (expiresIn === null) return Err("Anthropic OAuth exchange missing expires_in");

      return Ok({
        type: "anthropic-oauth",
        access: accessToken,
        refresh: refreshToken,
        expires: Date.now() + Math.max(0, Math.floor(expiresIn * 1000)) - EXPIRY_BUFFER_MS,
      });
    } catch (error) {
      return Err(`Anthropic OAuth exchange failed: ${getErrorMessage(error)}`);
    }
  }

  private async refreshTokens(
    current: AnthropicOauthAuth
  ): Promise<Result<AnthropicOauthAuth, string>> {
    try {
      const response = await fetch(ANTHROPIC_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: ANTHROPIC_OAUTH_CLIENT_ID,
          refresh_token: current.refresh,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");

        // Auto-disconnect on revoked refresh tokens so subsequent requests
        // fall back to API key (if configured).
        if (isInvalidGrantError(errorText)) {
          log.debug("[Anthropic OAuth] Refresh token rejected; clearing stored auth");
          const disconnectResult = this.disconnect();
          if (!disconnectResult.success) {
            log.warn(
              `[Anthropic OAuth] Failed to clear auth after refresh failure: ${disconnectResult.error}`
            );
          }
        }

        const prefix = `Anthropic OAuth refresh failed (${response.status})`;
        return Err(errorText ? `${prefix}: ${errorText}` : prefix);
      }

      const json = (await response.json()) as unknown;
      if (!isPlainObject(json)) {
        return Err("Anthropic OAuth refresh returned invalid JSON");
      }

      const accessToken = typeof json.access_token === "string" ? json.access_token : null;
      const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : null;
      const expiresIn =
        typeof json.expires_in === "number" && Number.isFinite(json.expires_in)
          ? json.expires_in
          : null;

      if (!accessToken) return Err("Anthropic OAuth refresh missing access_token");
      if (expiresIn === null) return Err("Anthropic OAuth refresh missing expires_in");

      const next: AnthropicOauthAuth = {
        type: "anthropic-oauth",
        access: accessToken,
        refresh: refreshToken ?? current.refresh,
        expires: Date.now() + Math.max(0, Math.floor(expiresIn * 1000)) - EXPIRY_BUFFER_MS,
      };

      const persistResult = this.persistAuth(next);
      if (!persistResult.success) return Err(persistResult.error);

      return Ok(next);
    } catch (error) {
      return Err(`Anthropic OAuth refresh failed: ${getErrorMessage(error)}`);
    }
  }

  private finishFlow(flowId: string, result: Result<void, string>): void {
    const flow = this.flows.get(flowId);
    if (!flow || flow.cancelled) return;

    flow.cancelled = true;
    clearTimeout(flow.timeout);

    try {
      flow.resolveResult(result);
    } catch {
      /* already resolved */
    }

    if (flow.cleanupTimeout !== null) clearTimeout(flow.cleanupTimeout);
    flow.cleanupTimeout = setTimeout(() => {
      this.flows.delete(flowId);
    }, COMPLETED_FLOW_TTL_MS);
  }
}
