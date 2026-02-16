/**
 * Gateway feature has been removed. These exports are stubs that preserve
 * the public API so existing imports continue to compile.
 */

// ============================================================================
// Stub utility functions
// ============================================================================

export function isProviderSupported(_modelId: string): boolean {
  return false;
}

export function isGatewayFormat(_modelId: string): boolean {
  return false;
}

export function formatAsGatewayModel(modelId: string): string {
  return modelId;
}

export function migrateGatewayModel(modelId: string): string {
  return modelId;
}

export function toGatewayModel(modelId: string): string {
  return modelId;
}

// ============================================================================
// Gateway state interface (returned by hook)
// ============================================================================

export interface GatewayState {
  isActive: boolean;
  isConfigured: boolean;
  isEnabled: boolean;
  toggleEnabled: () => void;
  modelUsesGateway: (modelId: string) => boolean;
  toggleModelGateway: (modelId: string) => void;
  canToggleModel: (modelId: string) => boolean;
  isModelRoutingThroughGateway: (modelId: string) => boolean;
}

const noop = () => {};
const alwaysFalse = (_modelId: string) => false;

/**
 * Stub hook -- gateway feature has been removed.
 */
export function useGateway(): GatewayState {
  return {
    isActive: false,
    isConfigured: false,
    isEnabled: false,
    toggleEnabled: noop,
    modelUsesGateway: alwaysFalse,
    toggleModelGateway: noop,
    canToggleModel: alwaysFalse,
    isModelRoutingThroughGateway: alwaysFalse,
  };
}
