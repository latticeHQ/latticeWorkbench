import type { ProvidersConfigMap } from "@/common/orpc/types";

/**
 * Gateway feature has been removed. Returns an empty array.
 */
export function getEligibleGatewayModels(_config: ProvidersConfigMap | null): string[] {
  return [];
}
