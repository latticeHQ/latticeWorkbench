/**
 * Auth types for NotebookLM cookie-based authentication.
 */

/** Required Google auth cookies for NotebookLM access. */
export const REQUIRED_COOKIES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
] as const;

/** Auth profile stored on disk. */
export interface AuthProfile {
  name: string;
  email?: string;
  cookies: Record<string, string>;
  csrfToken: string;
  sessionId: string;
  buildLabel: string;
  extractedAt: string;
}

/** Result of a token refresh attempt. */
export interface TokenRefreshResult {
  csrfToken: string;
  sessionId: string;
  buildLabel: string;
}

/** CDP connection target. */
export interface CdpTarget {
  host: string;
  port: number;
  wsUrl?: string;
}
