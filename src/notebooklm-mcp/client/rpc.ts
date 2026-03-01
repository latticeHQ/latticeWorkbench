/**
 * Google batchexecute RPC protocol — encode requests, parse responses.
 *
 * NotebookLM uses Google's internal batchexecute protocol for all operations.
 * Requests are URL-encoded JSON payloads POSTed to a single endpoint.
 * Responses use an anti-XSSI prefix and chunked JSON format.
 *
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import { BATCHEXECUTE_URL, BL_FALLBACK, RPC_NAMES } from "./constants";

// ─── Request Building ───────────────────────────────────────────────────────

/**
 * Build a batchexecute request body for a single RPC call.
 *
 * Format: `f.req=<URL-encoded outer JSON>&at=<CSRF token>&`
 *
 * The outer structure is: `[[[rpcId, JSON.stringify(params), null, "generic"]]]`
 */
export function buildRpcRequestBody(
  rpcId: string,
  params: unknown[],
  csrfToken: string,
): string {
  const innerJson = JSON.stringify(params);
  const outerPayload = [[[rpcId, innerJson, null, "generic"]]];
  const outerJson = JSON.stringify(outerPayload);

  return `f.req=${encodeURIComponent(outerJson)}&at=${encodeURIComponent(csrfToken)}&`;
}

/**
 * Build the full URL with query parameters for a batchexecute call.
 */
export function buildRpcUrl(opts: {
  rpcId: string;
  sessionId?: string;
  buildLabel?: string;
  language?: string;
}): string {
  const params = new URLSearchParams({
    "rpcids": opts.rpcId,
    "source-path": "/",
    "f.sid": opts.sessionId ?? "",
    "bl": opts.buildLabel ?? BL_FALLBACK,
    "hl": opts.language ?? "en",
    "soc-app": "1",
    "soc-platform": "1",
    "soc-device": "1",
    "_reqid": String(Math.floor(Math.random() * 900000) + 100000),
    "rt": "c",
  });
  return `${BATCHEXECUTE_URL}?${params.toString()}`;
}

/**
 * Build request headers for a batchexecute call.
 */
export function buildRpcHeaders(cookieHeader: string): Record<string, string> {
  return {
    "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    "Cookie": cookieHeader,
    "Origin": "https://notebooklm.google.com",
    "Referer": "https://notebooklm.google.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    "X-Same-Domain": "1",
  };
}

// ─── Response Parsing ───────────────────────────────────────────────────────

/** Anti-XSSI prefix that Google prepends to all batchexecute responses. */
const ANTI_XSSI_PREFIX = ")]}'\n";

/**
 * Parse a batchexecute response body.
 *
 * Response format:
 * 1. Starts with anti-XSSI prefix `)]}'\n`
 * 2. Followed by one or more chunks: `<byte-count>\n<JSON array>\n`
 * 3. Each chunk is a JSON array; we collect all of them.
 *
 * Returns the parsed data arrays from all chunks.
 */
export function parseRpcResponse(raw: string): unknown[][] {
  // Strip anti-XSSI prefix
  let body = raw;
  if (body.startsWith(ANTI_XSSI_PREFIX)) {
    body = body.slice(ANTI_XSSI_PREFIX.length);
  }

  const results: unknown[][] = [];

  // Parse chunked format: each chunk is preceded by a byte-count line
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    i++;

    // Skip empty lines
    if (!line) continue;

    // If line is a number, the next line(s) contain that many bytes of JSON
    if (/^\d+$/.test(line)) {
      const byteCount = parseInt(line, 10);
      // Collect subsequent lines until we have enough content
      let content = "";
      while (i < lines.length && Buffer.byteLength(content, "utf-8") < byteCount) {
        content += (content ? "\n" : "") + lines[i];
        i++;
      }

      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          results.push(parsed);
        }
      } catch {
        // Skip unparseable chunks
      }
      continue;
    }

    // Try direct JSON parse (some responses don't use byte-count format)
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) {
        results.push(parsed);
      }
    } catch {
      // Not JSON — skip
    }
  }

  return results;
}

/**
 * Extract the result data for a specific RPC ID from parsed response chunks.
 *
 * Searches through all chunks for an entry matching the RPC ID.
 * The result is nested: `chunk[0][2]` contains a JSON string that must be parsed again.
 *
 * Returns the parsed inner result, or null if not found.
 */
export function extractRpcResult(
  chunks: unknown[][],
  rpcId: string,
): unknown | null {
  for (const chunk of chunks) {
    // Each chunk may contain multiple entries
    for (const entry of chunk) {
      if (!Array.isArray(entry)) continue;

      // Entry format: [rpcId, wrappedData, ...]
      // wrappedData format: [null, null, jsonString] or similar
      const entryRpcId = entry[0];
      if (entryRpcId !== rpcId) continue;

      // The result JSON string is typically at entry[2]
      const wrappedData = entry[2];
      if (typeof wrappedData === "string") {
        try {
          return JSON.parse(wrappedData);
        } catch {
          return wrappedData;
        }
      }

      // Sometimes the data is already parsed (not a string)
      if (wrappedData != null) {
        return wrappedData;
      }
    }
  }

  // Fallback: try first chunk's first entry position [2]
  if (chunks.length > 0 && chunks[0]!.length > 0) {
    const firstEntry = chunks[0]![0];
    if (Array.isArray(firstEntry) && firstEntry.length > 2) {
      const data = firstEntry[2];
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {
          return null;
        }
      }
      return data;
    }
  }

  return null;
}

/**
 * Check if an RPC response indicates an authentication error.
 * Google returns `[16]` in the error array for UNAUTHENTICATED.
 */
export function isAuthError(result: unknown): boolean {
  if (!Array.isArray(result)) return false;
  // Check for [16] pattern
  if (result.length === 1 && result[0] === 16) return true;
  // Check for nested auth error
  if (Array.isArray(result[0]) && result[0][0] === 16) return true;
  return false;
}

/**
 * Check if an HTTP status code indicates a retryable error.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Get the human-readable name for an RPC ID (for logging).
 */
export function getRpcName(rpcId: string): string {
  return RPC_NAMES[rpcId] ?? rpcId;
}
