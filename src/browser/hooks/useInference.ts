import { useEffect, useState, useCallback } from "react";
import { useAPI } from "@/browser/contexts/API";

interface ModelInfo {
  id: string;
  name: string;
  huggingFaceRepo?: string;
  format: "mlx" | "gguf" | "pytorch" | "unknown";
  sizeBytes: number;
  parameterCount?: number;
  quantization?: string;
  localPath: string;
  backend?: string;
  pulledAt?: string;
}

interface InferenceStatus {
  available: boolean;
  loadedModelId: string | null;
}

interface DownloadProgress {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
}

interface LoadedModelInfo {
  model_id: string;
  model_path: string;
  backend: string;
  alive: boolean;
  estimated_bytes: number;
  loaded_at: string;
  last_used_at: string;
  use_count: number;
}

interface PoolStatus {
  loadedModels: LoadedModelInfo[];
  modelsLoaded: number;
  maxLoadedModels: number;
  memoryBudgetBytes: number;
  estimatedVramBytes: number;
}

interface ClusterNode {
  id: string;
  name: string;
  address: string;
  status: string;
  loaded_models: string[];
  active_inferences: number;
  used_memory_bytes: number;
  total_memory_bytes: number;
  gpu_type: string;
  tokens_per_second_avg: number;
  last_heartbeat: string;
}

interface ClusterStatus {
  nodes: ClusterNode[];
  total_nodes: number;
  total_models: number;
}

interface RDMAConfig {
  available: boolean;
  mode: string;
  device: string;
  backend: string;
  bandwidth_gbps: number;
  latency_us: number;
  max_message_size: number;
  error?: string;
}

interface TransportStat {
  peer_id: string;
  peer_name: string;
  transport: string;
  bandwidth_gbps: number;
  latency_us: number;
  connected: boolean;
}

interface TransportStatus {
  rdma: RDMAConfig;
  peer_transports: TransportStat[];
  router_transports: Record<string, string>;
}

interface SystemInfo {
  hostname: string;
  username: string;
  platform: string;
  arch: string;
  osType: string;
  osRelease: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  uptime: number;
  nodeVersion: string;
  pid: number;
}

export function useInference() {
  const { api } = useAPI();
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [pulling, setPulling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [poolStatus, setPoolStatus] = useState<PoolStatus | null>(null);
  const [clusterStatus, setClusterStatus] = useState<ClusterStatus | null>(null);
  const [metrics, setMetrics] = useState<string>("");
  const [transportStatus, setTransportStatus] = useState<TransportStatus | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    if (!api) return;
    try {
      const list = await api.inference.listModels();
      setModels(list);
    } catch {
      // Service may not be available
    }
  }, [api]);

  const refreshPoolStatus = useCallback(async () => {
    if (!api) return;
    try {
      const pool = await api.inference.getPoolStatus();
      setPoolStatus(pool);
    } catch {
      // Unavailable
    }
  }, [api]);

  const refreshClusterStatus = useCallback(async () => {
    if (!api) return;
    try {
      const cluster = await api.inference.getClusterStatus();
      setClusterStatus(cluster);
    } catch {
      // Unavailable
    }
  }, [api]);

  const refreshMetrics = useCallback(async () => {
    if (!api) return;
    try {
      const m = await api.inference.getMetrics();
      setMetrics(m);
    } catch {
      // Unavailable
    }
  }, [api]);

  const refreshTransportStatus = useCallback(async () => {
    if (!api) return;
    try {
      const ts = await api.inference.getTransportStatus();
      setTransportStatus(ts);
    } catch {
      // Unavailable
    }
  }, [api]);

  const refreshSystemInfo = useCallback(async () => {
    if (!api) return;
    try {
      const info = await api.inference.getSystemInfo();
      setSystemInfo(info);
    } catch {
      // Unavailable
    }
  }, [api]);

  // Initial fetch + subscriptions
  useEffect(() => {
    if (!api) return;
    const ac = new AbortController();

    void Promise.all([
      refreshModels(),
      refreshPoolStatus(),
      refreshClusterStatus(),
      refreshTransportStatus(),
      refreshSystemInfo(),
    ]).finally(() => setLoading(false));

    // Subscribe to status changes (yields initial value)
    void (async () => {
      try {
        const iter = await api.inference.onStatusChanged(undefined, { signal: ac.signal });
        for await (const s of iter) {
          if (ac.signal.aborted) break;
          setStatus(s);
          // Refresh pool on status change
          void refreshPoolStatus();
        }
      } catch {
        // Aborted or unavailable
      }
    })();

    // Subscribe to download progress
    void (async () => {
      try {
        const iter = await api.inference.onDownloadProgress(undefined, { signal: ac.signal });
        for await (const p of iter) {
          if (ac.signal.aborted) break;
          setDownloadProgress(p);
        }
      } catch {
        // Aborted or unavailable
      }
    })();

    return () => ac.abort();
  }, [api, refreshModels, refreshPoolStatus, refreshClusterStatus, refreshTransportStatus, refreshSystemInfo]);

  const clearMessages = useCallback(() => {
    setLastError(null);
    setLastSuccess(null);
  }, []);

  const pullModel = useCallback(
    async (modelId: string) => {
      if (!api) return;
      clearMessages();
      setPulling(true);
      setDownloadProgress(null);
      try {
        await api.inference.pullModel({ modelId });
        await refreshModels();
        setLastSuccess(`Model "${modelId}" pulled successfully`);
      } catch (e) {
        setLastError(`Failed to pull model: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setPulling(false);
        setDownloadProgress(null);
      }
    },
    [api, refreshModels, clearMessages],
  );

  const deleteModel = useCallback(
    async (modelId: string) => {
      if (!api) return;
      clearMessages();
      try {
        await api.inference.deleteModel({ modelId });
        await refreshModels();
        await refreshPoolStatus();
        setLastSuccess(`Model "${modelId}" deleted`);
      } catch (e) {
        setLastError(`Failed to delete model: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [api, refreshModels, refreshPoolStatus, clearMessages],
  );

  const loadModel = useCallback(
    async (modelId: string, backend?: string) => {
      if (!api) return;
      clearMessages();
      try {
        await api.inference.loadModel({ modelId, backend });
        await refreshPoolStatus();
        setLastSuccess(`Model "${modelId}" loaded`);
      } catch (e) {
        setLastError(`Failed to load model: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [api, refreshPoolStatus, clearMessages],
  );

  const unloadModel = useCallback(async (modelId?: string) => {
    if (!api) return;
    clearMessages();
    try {
      await api.inference.unloadModel({ modelId });
      await refreshPoolStatus();
      setLastSuccess(modelId ? `Model "${modelId}" unloaded` : "Model unloaded");
    } catch (e) {
      setLastError(`Failed to unload model: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api, refreshPoolStatus, clearMessages]);

  const discoverNodes = useCallback(async () => {
    if (!api) return;
    clearMessages();
    try {
      const nodes = await api.inference.getClusterNodes();
      await refreshClusterStatus();
      setLastSuccess(`Discovered ${nodes.length} node${nodes.length !== 1 ? "s" : ""} on LAN`);
    } catch (e) {
      setLastError(`LAN discovery failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [api, refreshClusterStatus, clearMessages]);

  const runBenchmark = useCallback(
    async (modelId?: string) => {
      if (!api) throw new Error("API not available");
      return api.inference.runBenchmark({ modelId });
    },
    [api],
  );

  return {
    status,
    models,
    loading,
    pulling,
    downloadProgress,
    poolStatus,
    clusterStatus,
    metrics,
    transportStatus,
    systemInfo,
    lastError,
    lastSuccess,
    pullModel,
    deleteModel,
    loadModel,
    unloadModel,
    discoverNodes,
    runBenchmark,
    clearMessages,
    refreshModels,
    refreshPoolStatus,
    refreshClusterStatus,
    refreshMetrics,
    refreshTransportStatus,
    refreshSystemInfo,
  };
}
