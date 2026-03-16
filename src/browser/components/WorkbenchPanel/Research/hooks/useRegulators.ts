/**
 * Regulators domain hooks — SEC filings.
 */

import { useMemo } from "react";
import { useOpenBBQuery, type FetchState } from "./useFetchOpenBB";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecFiling {
  symbol: string;
  cik: string;
  title: string;
  date: string;
  form_type: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useSecFilings(
  symbol: string | null,
  baseUrl: string | null,
  formType?: string,
  limit: number = 20,
): FetchState<SecFiling[]> {
  const params = useMemo(() => {
    const p: Record<string, string> = { limit: String(limit) };
    if (symbol) p.symbol = symbol;
    if (formType) p.form_type = formType;
    return p;
  }, [symbol, formType, limit]);

  return useOpenBBQuery<SecFiling[]>(
    "/equity/fundamental/filings",
    params,
    baseUrl,
    { enabled: !!symbol, provider: "sec" },
  );
}
