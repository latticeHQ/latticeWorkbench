import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAPI } from "./API";

interface TelemetryEnabledContextValue {
  /**
   * Whether link sharing should be enabled.
   * True unless user explicitly set LATTICE_DISABLE_TELEMETRY=1 or disabled in Settings.
   * Null while loading.
   */
  linkSharingEnabled: boolean | null;

  /**
   * Re-query the backend for current telemetry status.
   * Call this after toggling telemetry in Settings so the rest of the app updates.
   */
  refresh: () => void;
}

const TelemetryEnabledContext = createContext<TelemetryEnabledContextValue | null>(null);

interface TelemetryEnabledProviderProps {
  children: React.ReactNode;
}

/**
 * Provider that queries the backend to determine if telemetry is enabled.
 * This is used to conditionally hide features that require network access to lattice services.
 */
export function TelemetryEnabledProvider({ children }: TelemetryEnabledProviderProps) {
  const { api } = useAPI();
  const [linkSharingEnabled, setLinkSharingEnabled] = useState<boolean | null>(null);

  const fetchStatus = useCallback(() => {
    if (!api) return;

    void api.telemetry
      .status()
      .then((result) => {
        // Link sharing is enabled unless user explicitly disabled telemetry
        setLinkSharingEnabled(!result.explicit);
      })
      .catch((err) => {
        console.error("[TelemetryEnabledContext] Failed to check telemetry status:", err);
        // Default to enabled on error so share button still shows
        setLinkSharingEnabled(true);
      });
  }, [api]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const refresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <TelemetryEnabledContext.Provider value={{ linkSharingEnabled, refresh }}>
      {children}
    </TelemetryEnabledContext.Provider>
  );
}

/**
 * Hook to check if link sharing is enabled.
 * Returns null while loading, then true/false once known.
 * Link sharing is disabled only when user explicitly sets LATTICE_DISABLE_TELEMETRY=1
 * or disables telemetry in Settings.
 */
export function useLinkSharingEnabled(): boolean | null {
  const context = useContext(TelemetryEnabledContext);
  if (!context) {
    throw new Error("useLinkSharingEnabled must be used within a TelemetryEnabledProvider");
  }
  return context.linkSharingEnabled;
}

/**
 * Hook to get the refresh function for re-querying telemetry status.
 * Use this in Settings after toggling telemetry to update the rest of the app.
 */
export function useTelemetryRefresh(): () => void {
  const context = useContext(TelemetryEnabledContext);
  if (!context) {
    throw new Error("useTelemetryRefresh must be used within a TelemetryEnabledProvider");
  }
  return context.refresh;
}
