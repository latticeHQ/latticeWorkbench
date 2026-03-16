/**
 * Generic OpenBB fetch helper and React hook.
 *
 * Centralises all OpenBB REST calls so domain hooks are thin wrappers.
 * Every request appends `provider=yfinance` unless the caller overrides it.
 */

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseOpenBBQueryOptions {
  /** When false the request is skipped (default true). */
  enabled?: boolean;
  /** Override the default provider (yfinance). */
  provider?: string;
}

// ---------------------------------------------------------------------------
// Low-level fetch helper
// ---------------------------------------------------------------------------

export async function fetchOpenBB<T>(
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${baseUrl}${path}`);
  // Default provider
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
  const res = await fetch(url.toString(), { signal });

  // Extract the symbol param for user-friendly errors
  const sym = params?.symbol ?? "";

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Endpoint not available: ${path}. Check that the required extension is installed.`);
    }
    if (res.status === 422) {
      throw new Error(sym
        ? `"${sym}" may not be a valid ticker symbol. Try a different symbol (e.g. AAPL, BTC-USD).`
        : `Invalid request parameters for ${path}.`);
    }
    if (res.status === 500) {
      throw new Error(sym
        ? `No data found for "${sym}". The symbol may be delisted or not supported by this provider.`
        : `Server error fetching ${path}. Try again.`);
    }
    throw new Error(`API ${res.status} ${res.statusText} — ${path}`);
  }

  // Handle empty responses gracefully (204, empty body, etc.)
  const text = await res.text();
  if (!text || text.trim().length === 0) {
    return [] as unknown as T;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(sym
      ? `No data returned for "${sym}". The symbol may not be recognized. Try a standard ticker like AAPL or MSFT.`
      : `No data returned from ${path}.`);
  }
  const result = (json as Record<string, unknown>)?.results ?? json;

  // If the API returns an empty results array, give a helpful message
  if (Array.isArray(result) && result.length === 0 && sym) {
    throw new Error(`No data found for "${sym}". Verify the ticker symbol is correct.`);
  }

  return result as T;
}

// ---------------------------------------------------------------------------
// Generic query hook
// ---------------------------------------------------------------------------

/**
 * Generic data-fetching hook for any OpenBB endpoint.
 *
 * Re-fetches automatically when `path`, `params`, or `baseUrl` change.
 * Supports an AbortController so in-flight requests are cancelled on
 * dependency change or unmount.
 */
export function useOpenBBQuery<T>(
  path: string,
  params: Record<string, string>,
  baseUrl: string | null,
  options?: UseOpenBBQueryOptions,
): FetchState<T> {
  const enabled = options?.enabled ?? true;
  const provider = options?.provider ?? "yfinance";

  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  // Serialise params for the dependency array
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!baseUrl || !enabled) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const merged = { ...params, provider };

    fetchOpenBB<T>(baseUrl, path, merged, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({ data, loading: false, error: null });
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setState({
            data: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, path, paramsKey, enabled, provider]);

  return state;
}
