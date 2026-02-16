import { useEffect, useState, useCallback } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { AllAgentPreferences, CliAgentPreferences } from "@/common/orpc/types";

const DEFAULT_PREFERENCES: CliAgentPreferences = {
  enabled: true,
};

/**
 * Hook to manage per-agent preferences (enable/disable, default flags, env vars).
 */
export function useCliAgentPreferences() {
  const { api } = useAPI();
  const [preferences, setPreferences] = useState<AllAgentPreferences>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.cliAgents.getPreferences();
      setPreferences(result);
    } catch {
      // Ignore errors — defaults are fine
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const getPrefs = useCallback(
    (slug: string): CliAgentPreferences => {
      return preferences[slug] ?? { ...DEFAULT_PREFERENCES };
    },
    [preferences]
  );

  const updatePrefs = useCallback(
    async (slug: string, prefs: CliAgentPreferences): Promise<boolean> => {
      if (!api) return false;
      try {
        // Optimistic update
        setPreferences((prev) => ({ ...prev, [slug]: prefs }));
        await api.cliAgents.setPreferences({ slug, preferences: prefs });
        return true;
      } catch {
        // Revert on failure
        void refresh();
        return false;
      }
    },
    [api, refresh]
  );

  const toggleEnabled = useCallback(
    async (slug: string): Promise<boolean> => {
      const current = getPrefs(slug);
      return updatePrefs(slug, { ...current, enabled: !current.enabled });
    },
    [getPrefs, updatePrefs]
  );

  const isEnabled = useCallback(
    (slug: string): boolean => {
      return getPrefs(slug).enabled;
    },
    [getPrefs]
  );

  return { preferences, loading, refresh, getPrefs, updatePrefs, toggleEnabled, isEnabled };
}
