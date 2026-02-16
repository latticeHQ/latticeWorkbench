import { useEffect, useState, useCallback, useRef } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { AgentHealthStatus } from "@/common/orpc/types";

const HEALTH_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Hook to check health of detected CLI agents.
 *
 * Calls checkAllHealth on mount and refreshes every 5 minutes.
 * Exposes per-slug health status and a manual refresh function.
 */
export function useCliAgentHealth(detectedSlugs: string[]) {
  const { api } = useAPI();
  const [healthMap, setHealthMap] = useState<Record<string, AgentHealthStatus>>({});
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshAll = useCallback(async () => {
    if (!api || detectedSlugs.length === 0) return;
    setLoading(true);
    try {
      const result = await api.cliAgents.checkAllHealth();
      setHealthMap(result);
    } catch {
      // Ignore health check errors
    } finally {
      setLoading(false);
    }
  }, [api, detectedSlugs.length]);

  const refreshOne = useCallback(
    async (slug: string) => {
      if (!api) return;
      try {
        const result = await api.cliAgents.checkHealth({ slug });
        setHealthMap((prev) => ({ ...prev, [slug]: result }));
      } catch {
        // Ignore
      }
    },
    [api]
  );

  // Initial check + periodic refresh
  useEffect(() => {
    if (detectedSlugs.length === 0) return;

    void refreshAll();

    intervalRef.current = setInterval(() => {
      void refreshAll();
    }, HEALTH_REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshAll, detectedSlugs.length]);

  return { healthMap, loading, refreshAll, refreshOne };
}
