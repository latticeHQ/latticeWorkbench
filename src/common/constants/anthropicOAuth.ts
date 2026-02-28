/**
 * Anthropic OAuth constants and token utilities.
 *
 * Enables Claude Pro/Max plan subscribers to authenticate via their
 * Anthropic account. The OAuth flow uses PKCE authorization code grant:
 * user opens claude.ai in browser → logs in → gets redirected with a code →
 * pastes the code back → we exchange it for access + refresh tokens.
 *
 * The access token doubles as an Anthropic API key (set via x-api-key header).
 */

// Anthropic OAuth PKCE flow endpoints.
// Client ID sourced from the Anthropic OAuth application registration.
export const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
export const ANTHROPIC_OAUTH_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
export const ANTHROPIC_OAUTH_SCOPES = "org:create_api_key user:profile user:inference";

// --------------------------------------------------------------------------
// Token parsing & expiry
// --------------------------------------------------------------------------

export interface AnthropicOauthAuth {
  type: "anthropic-oauth";
  /** OAuth access token — also usable as the Anthropic API key. */
  access: string;
  /** OAuth refresh token for renewing expired access tokens. */
  refresh: string;
  /** Unix epoch milliseconds when the access token expires. */
  expires: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parse a persisted value into a typed AnthropicOauthAuth (or null). */
export function parseAnthropicOauthAuth(value: unknown): AnthropicOauthAuth | null {
  if (!isPlainObject(value)) return null;

  if (value.type !== "anthropic-oauth") return null;
  if (typeof value.access !== "string" || !value.access) return null;
  if (typeof value.refresh !== "string" || !value.refresh) return null;
  if (typeof value.expires !== "number" || !Number.isFinite(value.expires)) return null;

  return {
    type: "anthropic-oauth",
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
  };
}

/** Check whether the access token has expired (with a 30-second safety margin). */
export function isAnthropicOauthExpired(
  auth: AnthropicOauthAuth,
  opts?: { nowMs?: number; skewMs?: number }
): boolean {
  const now = opts?.nowMs ?? Date.now();
  const skew = opts?.skewMs ?? 30_000;
  return now + skew >= auth.expires;
}
