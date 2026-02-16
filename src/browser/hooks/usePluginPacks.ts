import { useCallback, useEffect, useRef, useState } from "react";
import { useAPI } from "@/browser/contexts/API";
import type { PluginPackDescriptor } from "@/common/types/pluginPack";

export function usePluginPacks(projectPath?: string) {
  const { api } = useAPI();
  const [packs, setPacks] = useState<PluginPackDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!api) return;
    const myVersion = ++fetchVersionRef.current;
    try {
      const list = await api.pluginPacks.list({ projectPath });
      if (myVersion === fetchVersionRef.current) {
        setPacks(list);
      }
    } catch {
      // Keep existing state on error
    } finally {
      if (myVersion === fetchVersionRef.current) {
        setLoading(false);
      }
    }
  }, [api, projectPath]);

  useEffect(() => {
    if (!api) return;
    setLoading(true);
    void refresh();
  }, [api, refresh]);

  const setEnabled = useCallback(
    async (name: string, enabled: boolean) => {
      if (!api) return;

      // Optimistic update
      fetchVersionRef.current++;
      setPacks((prev) =>
        prev.map((p) => (p.name === name ? { ...p, enabled } : p))
      );

      try {
        await api.pluginPacks.setEnabled({ projectPath, name, enabled });
      } catch {
        // Revert on error
        void refresh();
      }
    },
    [api, projectPath, refresh]
  );

  const getMcpServers = useCallback(
    async (name: string) => {
      if (!api) return {};
      return api.pluginPacks.getMcpServers({ name });
    },
    [api]
  );

  return { packs, loading, refresh, setEnabled, getMcpServers };
}
