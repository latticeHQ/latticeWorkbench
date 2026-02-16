/**
 * Provider requirements — Agent-only architecture stub.
 *
 * SDK credential resolution has been removed. CLI agents handle their own authentication.
 * This file is kept as a minimal stub for backward compatibility with any remaining imports.
 */

import type { ProvidersConfig } from "@/node/config";

/**
 * @deprecated No longer used in agent-only architecture.
 */
export function hasAnyConfiguredProvider(_providers: ProvidersConfig | null | undefined): boolean {
  // In agent-only architecture, providers don't need API keys.
  // CLI agents handle their own authentication.
  return true;
}
