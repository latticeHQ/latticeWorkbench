/**
 * Shared utilities for the MCP server.
 *
 * - Server discovery: resolves the running Lattice backend URL + auth token
 *   via env vars, lockfile, or fallback default.
 * - Result unwrapping: extracts data from oRPC Result<T> discriminated unions.
 */

import { ServerLockfile } from "@/node/services/serverLockfile";
import { getLatticeHome } from "@/common/constants/paths";

export interface ServerConnection {
  baseUrl: string;
  authToken?: string;
}

/**
 * Discover the running Lattice backend.
 *
 * Resolution order:
 * 1. Env vars: LATTICE_SERVER_URL / LATTICE_SERVER_AUTH_TOKEN
 * 2. Lockfile at ~/.lattice/server.lock (auto-discovery)
 * 3. Fallback: http://127.0.0.1:3000
 */
export async function discoverServer(): Promise<ServerConnection> {
  // 1. Explicit env vars (highest priority)
  const envUrl = process.env.LATTICE_SERVER_URL;
  const envToken = process.env.LATTICE_SERVER_AUTH_TOKEN;
  if (envUrl) {
    return { baseUrl: envUrl, authToken: envToken };
  }

  // 2. Lockfile discovery (same pattern as ACP in src/node/acp/serverConnection.ts)
  try {
    const lockfile = new ServerLockfile(getLatticeHome());
    const lockData = await lockfile.read();
    if (lockData != null) {
      return { baseUrl: lockData.baseUrl, authToken: lockData.token };
    }
  } catch {
    // Lockfile read failed — fall through to default
  }

  // 3. Fallback
  return { baseUrl: "http://127.0.0.1:3000" };
}

/**
 * Unwrap an oRPC Result discriminated union.
 *
 * Many oRPC procedures return `{ success: true, data } | { success: false, error }`.
 * This helper extracts the data or throws with the error message.
 */
export function unwrapResult<T>(result: {
  success: boolean;
  data?: T;
  error?: unknown;
}): T {
  if (!result.success) {
    const errorMsg =
      typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error ?? "Unknown error");
    throw new Error(errorMsg);
  }
  return result.data as T;
}

/**
 * Format a value as JSON text content for MCP tool responses.
 */
export function jsonContent(data: unknown): { type: "text"; text: string } {
  return { type: "text" as const, text: JSON.stringify(data, null, 2) };
}

/**
 * Create an MCP error response.
 */
export function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

/**
 * Wrap an async tool handler with standardized error handling.
 * Catches exceptions and returns MCP-formatted error responses.
 */
export function withErrorHandling(
  fn: () => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  return fn().catch((err: unknown) => {
    const message =
      err instanceof Error ? err.message : String(err);
    return errorResponse(message);
  });
}
