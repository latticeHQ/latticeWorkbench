/**
 * Token refresh — extract CSRF, session ID, and build label from NotebookLM page HTML.
 *
 * These tokens are needed for every API call and refresh periodically.
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import { BASE_URL, PAGE_FETCH_HEADERS } from "../client/constants";
import { cookiesToHeader } from "./cookieManager";
import type { TokenRefreshResult } from "./types";

// ─── Regex patterns for token extraction ────────────────────────────────────

/** CSRF token (SNlM0e) — required for all batchexecute calls */
const CSRF_REGEX = /"SNlM0e":"([^"]+)"/;

/** Session ID (FdrFJe) — used in f.sid parameter */
const SESSION_ID_REGEX = /"FdrFJe":"([^"]+)"/;

/** Build label (cfb2h) — used in bl parameter */
const BUILD_LABEL_REGEX = /"cfb2h":"([^"]+)"/;

/** Email extraction — for profile metadata */
const EMAIL_REGEX = /"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/;

// ─── Token Refresh ──────────────────────────────────────────────────────────

/**
 * Fetch the NotebookLM page and extract fresh tokens.
 *
 * This performs a full page fetch (as if navigating in a browser),
 * then extracts the CSRF token, session ID, and build label from
 * the server-rendered HTML.
 */
export async function refreshTokens(
  cookies: Record<string, string>,
): Promise<TokenRefreshResult> {
  const cookieHeader = cookiesToHeader(cookies);

  const response = await fetch(BASE_URL, {
    method: "GET",
    headers: {
      ...PAGE_FETCH_HEADERS,
      Cookie: cookieHeader,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Token refresh failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();

  const csrfMatch = html.match(CSRF_REGEX);
  if (!csrfMatch) {
    throw new Error(
      "Could not extract CSRF token from page. Cookies may be expired.",
    );
  }

  const sessionMatch = html.match(SESSION_ID_REGEX);
  const buildMatch = html.match(BUILD_LABEL_REGEX);

  return {
    csrfToken: csrfMatch[1]!,
    sessionId: sessionMatch?.[1] ?? "",
    buildLabel: buildMatch?.[1] ?? "",
  };
}

/**
 * Extract the user's email from the NotebookLM page HTML.
 */
export function extractEmail(html: string): string | null {
  const match = html.match(EMAIL_REGEX);
  return match?.[1] ?? null;
}
