import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Play,
  Cpu,
  Network,
  RefreshCw,
  Server,
  AlertCircle,
  Loader2,
  HardDrive,
  Trash2,
  Zap,
  BarChart3,
  Activity,
  Database,
  Settings,
  Box,
  Square,
  Terminal,
  Check,
  X,
  Wifi,
  MonitorSmartphone,
  Gauge,
  FolderOpen,
  Clock,
  History,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import type { z } from "zod";
import type { ExoStatusSchema, ExoClusterStateSchema, ExoNodeSchema, ExoModelSchema } from "@/common/orpc/schemas/inference";
import type {
  LatticeInferenceStatusSchema,
  LatticeModelInfoSchema,
  LoadedModelInfoSchema,
  ClusterNodeSchema,
  ClusterStateSchema,
  BenchmarkResultSchema,
  InferenceSetupStatusSchema,
  SetupStreamEventSchema,
  DownloadProgressSchema,
} from "@/common/orpc/schemas/latticeInference";
import type {
  LatticeInferenceClusterStatusSchema,
  LatticeInferenceClusterNodeSchema,
} from "@/common/orpc/schemas/latticeInferenceCluster";
import { InferenceSidebar } from "./InferenceSidebar";

// Infer types from Zod schemas
type ExoStatus = z.infer<typeof ExoStatusSchema>;
type ExoClusterState = z.infer<typeof ExoClusterStateSchema>;
type ExoNode = z.infer<typeof ExoNodeSchema>;
type ExoModel = z.infer<typeof ExoModelSchema>;

type LatticeInferenceStatus = z.infer<typeof LatticeInferenceStatusSchema>;
type LatticeModelInfo = z.infer<typeof LatticeModelInfoSchema>;
type LoadedModelInfo = z.infer<typeof LoadedModelInfoSchema>;
type ClusterNode = z.infer<typeof ClusterNodeSchema>;
type ClusterState = z.infer<typeof ClusterStateSchema>;
type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;
type InferenceSetupStatus = z.infer<typeof InferenceSetupStatusSchema>;
type SetupStreamEvent = z.infer<typeof SetupStreamEventSchema>;
type DownloadProgress = z.infer<typeof DownloadProgressSchema>;

type LatticeInferenceClusterStatus = z.infer<typeof LatticeInferenceClusterStatusSchema>;
type LatticeInferenceClusterNode = z.infer<typeof LatticeInferenceClusterNodeSchema>;

type InferenceProvider = "exo" | "lattice";

interface InferenceTabProps {
  minionId: string;
}

// ---------------------------------------------------------------------------
// Main component — provider toggle between Exo and Lattice Inference
// ---------------------------------------------------------------------------

export function InferenceTab(props: InferenceTabProps) {
  const [provider, setProvider] = useState<InferenceProvider>("lattice");

  return (
    <div className="flex h-full flex-col">
      {/* Provider toggle bar */}
      <div className="flex items-center gap-0.5 border-b border-[var(--color-border)] px-2 py-1">
        <span className="mr-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Engine</span>
        <div className="flex rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0.5">
          <button
            type="button"
            onClick={() => setProvider("lattice")}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              provider === "lattice"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-fg)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            Lattice Inference
          </button>
          <button
            type="button"
            onClick={() => setProvider("exo")}
            className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              provider === "exo"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-fg)] shadow-sm"
                : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            Exo
          </button>
        </div>
      </div>

      {/* Provider content */}
      <div className="flex-1 overflow-hidden">
        {provider === "exo" ? (
          <ExoClusterView minionId={props.minionId} />
        ) : (
          <LatticeClusterView minionId={props.minionId} />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//
//  LATTICE INFERENCE — Full-featured inference management UI
//
// ===========================================================================

type LatticeViewStatus =
  | { kind: "loading" }
  | { kind: "not_installed"; setupStatus: InferenceSetupStatus | null }
  | { kind: "installed_not_running"; setupStatus: InferenceSetupStatus | null }
  | { kind: "running"; status: LatticeInferenceStatus }
  | { kind: "error"; message: string };

function LatticeClusterView({ minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [viewStatus, setViewStatus] = useState<LatticeViewStatus>({ kind: "loading" });

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const status = await (api as any).latticeInference.getStatus();
      if (status.available) {
        setViewStatus({ kind: "running", status });
      } else {
        // Not available — check setup status to determine why
        try {
          const setupStatus = await (api as any).inferenceSetup.checkStatus();
          if (setupStatus.inferenceAvailable) {
            setViewStatus({ kind: "installed_not_running", setupStatus });
          } else if (setupStatus.goBinaryFound || setupStatus.sourceRepoFound) {
            setViewStatus({ kind: "installed_not_running", setupStatus });
          } else {
            setViewStatus({ kind: "not_installed", setupStatus });
          }
        } catch {
          setViewStatus({ kind: "not_installed", setupStatus: null });
        }
      }
    } catch (err) {
      setViewStatus({ kind: "error", message: String(err) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  switch (viewStatus.kind) {
    case "loading":
      return <LoadingState />;
    case "error":
      return <ErrorState message={viewStatus.message} />;
    case "not_installed":
      return <LatticeNotInstalledView setupStatus={viewStatus.setupStatus} onRefresh={refresh} />;
    case "installed_not_running":
      return <LatticeNotRunningView minionId={minionId} setupStatus={viewStatus.setupStatus} onRefresh={refresh} />;
    case "running":
      return <LatticeRunningDashboard initialStatus={viewStatus.status} />;
  }
}

// ---------------------------------------------------------------------------
// Lattice: Not Installed
// ---------------------------------------------------------------------------

function LatticeNotInstalledView({
  setupStatus,
  onRefresh,
}: {
  setupStatus: InferenceSetupStatus | null;
  onRefresh: () => void;
}) {
  const { api } = useAPI();
  const [checking, setChecking] = useState(false);
  const [localSetup, setLocalSetup] = useState<InferenceSetupStatus | null>(setupStatus);

  const handleCheck = async () => {
    if (!api || checking) return;
    setChecking(true);
    try {
      const result = await (api as any).inferenceSetup.checkStatus();
      setLocalSetup(result);
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Download className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Lattice Inference Not Installed</h3>
        <p className="text-muted mt-1 text-xs">
          Run AI models locally with on-device inference. Requires Python 3.10+ and Go.
        </p>
      </div>

      {/* System requirements */}
      {localSetup && (
        <div className="w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left">
          <h4 className="text-muted mb-2 text-[10px] font-semibold uppercase tracking-wider">System Requirements</h4>
          <div className="space-y-1">
            <RequirementRow label="Python 3.10+" ok={localSetup.pythonVersionOk} detail={localSetup.systemPythonVersion || "not found"} />
            <RequirementRow label="Go binary" ok={localSetup.goBinaryFound} detail={localSetup.goBinaryPath || "not found"} />
            <RequirementRow label="Source repo" ok={localSetup.sourceRepoFound} />
            <RequirementRow label="Virtual env" ok={localSetup.venvExists} detail={localSetup.venvPath} />
            <RequirementRow label="Dependencies" ok={localSetup.depsInstalled} />
            <RequirementRow label="Platform" ok={true} detail={formatPlatform(localSetup.platform)} />
            {localSetup.detectedBackend && (
              <RequirementRow label="Backend" ok={true} detail={formatBackend(localSetup.detectedBackend)} />
            )}
            {localSetup.error && (
              <p className="mt-1 text-[10px] text-red-500">{localSetup.error}</p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings className="h-3 w-3" />}
          Check Status
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lattice: Installed but not running
// ---------------------------------------------------------------------------

function LatticeNotRunningView({
  minionId,
  setupStatus,
  onRefresh,
}: {
  minionId: string;
  setupStatus: InferenceSetupStatus | null;
  onRefresh: () => void;
}) {
  const { api } = useAPI();
  const [starting, setStarting] = useState(false);
  const [runningSetup, setRunningSetup] = useState(false);
  const [setupLog, setSetupLog] = useState<string[]>([]);

  const handleStart = async () => {
    if (!api || starting) return;
    setStarting(true);
    try {
      await api.terminal.create({
        minionId,
        cols: 120,
        rows: 30,
        initialCommand: "lattice-inference start",
      });
    } catch (err) {
      console.error("Failed to start lattice inference:", err);
    } finally {
      setStarting(false);
    }
  };

  const handleRunSetup = async () => {
    if (!api || runningSetup) return;
    setRunningSetup(true);
    setSetupLog([]);
    try {
      const stream = await (api as any).inferenceSetup.runSetup();
      for await (const event of stream as AsyncIterable<SetupStreamEvent>) {
        if (event.type === "phase") {
          setSetupLog((prev) => [...prev, `[${event.phase}] ${event.message}`]);
        } else if (event.type === "stdout") {
          setSetupLog((prev) => [...prev, event.data]);
        } else if (event.type === "stderr") {
          setSetupLog((prev) => [...prev, `ERR: ${event.data}`]);
        } else if (event.type === "result") {
          setSetupLog((prev) => [
            ...prev,
            event.success ? `Done: ${event.message}` : `FAILED: ${event.message}`,
          ]);
        }
      }
    } catch (err) {
      setSetupLog((prev) => [...prev, `Setup error: ${String(err)}`]);
    } finally {
      setRunningSetup(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Server className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Lattice Inference Installed</h3>
        <p className="text-muted mt-1 text-xs">
          The inference engine is installed but not currently running.
        </p>
      </div>

      {/* Setup status summary */}
      {setupStatus && (
        <div className="w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left">
          <h4 className="text-muted mb-2 text-[10px] font-semibold uppercase tracking-wider">Setup Status</h4>
          <div className="space-y-1">
            <RequirementRow label="Python" ok={setupStatus.pythonVersionOk} detail={setupStatus.systemPythonVersion || "n/a"} />
            <RequirementRow label="Go" ok={setupStatus.goBinaryFound} />
            <RequirementRow label="Deps" ok={setupStatus.depsInstalled} />
            <RequirementRow label="Backend" ok={!!setupStatus.detectedBackend} detail={formatBackend(setupStatus.detectedBackend)} />
            <RequirementRow label="Ready" ok={setupStatus.inferenceAvailable} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleStart}
          disabled={starting}
          className="inline-flex items-center gap-2 rounded-md bg-[var(--color-success)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start Inference
        </button>
        <button
          type="button"
          onClick={handleRunSetup}
          disabled={runningSetup}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {runningSetup ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
          Run Setup
        </button>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>

      {/* Setup log output */}
      {setupLog.length > 0 && (
        <div className="w-full max-w-lg">
          <SetupLogDisplay lines={setupLog} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup log display
// ---------------------------------------------------------------------------

function SetupLogDisplay({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--color-border)] bg-black/80 p-2 text-left font-mono text-[10px] text-green-400">
      {lines.map((line, i) => (
        <div key={i} className={line.startsWith("ERR:") || line.startsWith("FAILED:") ? "text-red-400" : ""}>
          {line}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requirement row (for setup status)
// ---------------------------------------------------------------------------

function RequirementRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {ok ? <Check className="h-3 w-3 text-green-500" /> : <X className="h-3 w-3 text-red-500" />}
      <span className="font-medium">{label}</span>
      {detail && <span className="text-muted truncate">{detail}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lattice: Running Dashboard — sidebar + content layout like Research terminal
// ---------------------------------------------------------------------------

type InferenceView = "dashboard" | "models" | "pool" | "machines" | "network" | "benchmark" | "metrics" | "setup" | "config";

function LatticeRunningDashboard({
  initialStatus,
}: {
  initialStatus: LatticeInferenceStatus;
}) {
  const [activeView, setActiveView] = useState<InferenceView>("dashboard");
  const { api } = useAPI();
  const [status, setStatus] = useState<LatticeInferenceStatus>(initialStatus);
  const [refreshing, setRefreshing] = useState(false);
  const [pollIntervalMs, setPollIntervalMs] = useState(5_000);
  const [lastBenchmark, setLastBenchmark] = useState<BenchmarkResult | null>(null);
  const [modelHistory, setModelHistory] = useState<Array<{ modelId: string; action: "loaded" | "unloaded"; timestamp: string }>>([]);

  // Load polling interval from server config
  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const cfg = await (api as any).latticeInference.getInferenceConfig();
        if (cfg?.pollIntervalMs) setPollIntervalMs(cfg.pollIntervalMs);
      } catch { /* use default */ }
    })();
  }, [api]);

  const refreshAll = useCallback(async () => {
    if (!api) return;
    setRefreshing(true);
    try {
      const prevLoaded = new Set(status.loadedModels.map(m => m.model_id));
      const statusRes = await (api as any).latticeInference.getStatus() as LatticeInferenceStatus;
      // Track model load/unload events
      const newLoaded = new Set(statusRes.loadedModels.map(m => m.model_id));
      const now = new Date().toISOString();
      for (const id of newLoaded) {
        if (!prevLoaded.has(id)) {
          setModelHistory(prev => [{ modelId: id, action: "loaded" as const, timestamp: now }, ...prev].slice(0, 50));
        }
      }
      for (const id of prevLoaded) {
        if (!newLoaded.has(id)) {
          setModelHistory(prev => [{ modelId: id, action: "unloaded" as const, timestamp: now }, ...prev].slice(0, 50));
        }
      }
      setStatus(statusRes);
    } catch { /* keep existing */ }
    setRefreshing(false);
  }, [api, status.loadedModels]);

  // Auto-refresh with configurable interval
  useEffect(() => {
    if (!api) return;
    const interval = setInterval(() => {
      void refreshAll();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [api, refreshAll, pollIntervalMs]);

  return (
    <div className="flex h-full bg-[#0a0a0a] text-neutral-200">
      {/* Sidebar */}
      <InferenceSidebar activeView={activeView} onViewChange={(v) => setActiveView(v as InferenceView)} />

      {/* Content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-neutral-800 px-3 py-1.5">
          <span className="inline-flex items-center gap-1 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            <span className="font-medium text-neutral-200">Running</span>
          </span>
          <DarkStat icon={<Box className="h-3 w-3" />} label="Loaded" value={`${status.modelsLoaded}/${status.maxLoadedModels}`} />
          <DarkStat icon={<Database className="h-3 w-3" />} label="Cached" value={String(status.cachedModels.length)} />
          <DarkStat icon={<HardDrive className="h-3 w-3" />} label="Memory" value={`${formatBytes(status.estimatedVramBytes)} / ${formatBytes(status.memoryBudgetBytes)}`} />
          <button
            type="button"
            onClick={() => { void refreshAll(); }}
            disabled={refreshing}
            className="ml-auto text-neutral-500 hover:text-neutral-300"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* View content */}
        <div className="flex-1 overflow-y-auto">
          {activeView === "dashboard" && <DashboardOverview status={status} lastBenchmark={lastBenchmark} modelHistory={modelHistory} />}
          {activeView === "models" && <DarkModelsView initialStatus={status} />}
          {activeView === "pool" && <DarkPoolView status={status} />}
          {activeView === "machines" && <DarkMachinesView />}
          {activeView === "network" && <DarkNetworkView />}
          {activeView === "benchmark" && <DarkBenchmarkView onResult={setLastBenchmark} />}
          {activeView === "metrics" && <DarkMetricsView />}
          {activeView === "setup" && <DarkSetupView />}
          {activeView === "config" && <DarkConfigView />}
        </div>
      </div>
    </div>
  );
}

/** Dark-themed stat for the status bar */
function DarkStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px]">
      <span className="text-neutral-600">{icon}</span>
      <span className="text-neutral-500">{label}:</span>
      <span className="font-medium text-neutral-300">{value}</span>
    </span>
  );
}

/** Dashboard overview — summary of all sections */
function DashboardOverview({
  status,
  lastBenchmark,
  modelHistory,
}: {
  status: LatticeInferenceStatus;
  lastBenchmark: BenchmarkResult | null;
  modelHistory: Array<{ modelId: string; action: "loaded" | "unloaded"; timestamp: string }>;
}) {
  const { api } = useAPI();
  const [clusterNodes, setClusterNodes] = useState<LatticeInferenceClusterNode[]>([]);
  const vramPct = status.memoryBudgetBytes > 0
    ? (status.estimatedVramBytes / status.memoryBudgetBytes) * 100 : 0;

  // Fetch cluster nodes for memory pressure data
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const stream = await (api as any).latticeInferenceCluster.subscribe(undefined, { signal: ac.signal });
        for await (const snapshot of stream as AsyncIterable<LatticeInferenceClusterStatus>) {
          if (cancelled) break;
          if (snapshot.status === "running") {
            setClusterNodes(snapshot.clusterState.nodes);
          }
        }
      } catch { /* ended */ }
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [api]);

  const localNode = clusterNodes.find(n => n.isLocal);
  const memPressure = localNode?.memoryPressure ?? null;
  const cpuUtil = localNode?.cpuUtilization ?? null;
  const gpuUtil = localNode?.gpuUtilization ?? null;

  return (
    <div className="p-4">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-neutral-400">Inference Dashboard</h2>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DarkCard title="Models Loaded" value={`${status.modelsLoaded}/${status.maxLoadedModels}`} />
        <DarkCard title="Cached Models" value={String(status.cachedModels.length)} />
        <DarkCard title="VRAM Usage" value={`${vramPct.toFixed(0)}%`} accent={vramPct > 80} />
        <DarkCard title="Memory Budget" value={formatBytes(status.memoryBudgetBytes)} />
      </div>

      {/* System metrics row — CPU, GPU, Memory Pressure */}
      {localNode && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3 w-3 text-neutral-600" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-600">CPU</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-neutral-200">{cpuUtil ?? 0}%</div>
            <DarkMemoryBar percent={cpuUtil ?? 0} />
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="flex items-center gap-1.5">
              <Gauge className="h-3 w-3 text-neutral-600" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-600">GPU</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-neutral-200">{gpuUtil ?? 0}%</div>
            <DarkMemoryBar percent={gpuUtil ?? 0} />
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-neutral-600" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-neutral-600">Mem Pressure</span>
            </div>
            <div className={`mt-1 text-lg font-bold tabular-nums ${
              memPressure != null && memPressure > 80 ? "text-red-500"
                : memPressure != null && memPressure > 50 ? "text-yellow-500"
                : "text-green-500"
            }`}>
              {memPressure != null ? `${memPressure}%` : "—"}
            </div>
            {memPressure != null && <DarkMemoryBar percent={memPressure} />}
            {memPressure != null && (
              <div className="mt-1 text-[9px] text-neutral-500">
                {memPressure <= 30 ? "Nominal" : memPressure <= 60 ? "Moderate" : memPressure <= 80 ? "Warning" : "Critical"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VRAM bar */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-[10px]">
          <span className="text-neutral-500">VRAM</span>
          <span className="text-neutral-400 tabular-nums">
            {formatBytes(status.estimatedVramBytes)} / {formatBytes(status.memoryBudgetBytes)}
          </span>
        </div>
        <DarkMemoryBar percent={vramPct} />
      </div>

      {/* Last Benchmark Result (inline widget) */}
      {lastBenchmark && (
        <div className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <Zap className="h-3 w-3" />
            Last Benchmark
          </h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-neutral-600">Model</span><div className="font-medium text-neutral-200">{lastBenchmark.model}</div></div>
            <div><span className="text-neutral-600">Speed</span><div className="font-bold text-[#00ACFF] tabular-nums">{lastBenchmark.tokens_per_second.toFixed(1)} tok/s</div></div>
            <div><span className="text-neutral-600">TTFT</span><div className="font-medium text-neutral-200 tabular-nums">{lastBenchmark.time_to_first_token_ms.toFixed(0)}ms</div></div>
          </div>
        </div>
      )}

      {/* Loaded models quick list */}
      {status.loadedModels.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">Active Models</h3>
          <div className="space-y-1">
            {status.loadedModels.map((lm) => (
              <div key={lm.model_id} className="flex items-center gap-2 rounded bg-neutral-900 px-2 py-1.5 text-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${lm.alive ? "bg-green-500" : "bg-red-500"}`} />
                <span className="font-medium text-neutral-200">{lm.model_id}</span>
                <span className="text-neutral-600">·</span>
                <span className="text-neutral-500">{lm.backend}</span>
                <span className="ml-auto text-neutral-600 tabular-nums">{formatBytes(lm.estimated_bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Load/Unload History */}
      {modelHistory.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <History className="h-3 w-3" />
            Recent Activity
          </h3>
          <div className="max-h-32 space-y-0.5 overflow-y-auto">
            {modelHistory.slice(0, 10).map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px]">
                <span className={`h-1.5 w-1.5 rounded-full ${entry.action === "loaded" ? "bg-green-500" : "bg-yellow-500"}`} />
                <span className="text-neutral-400">{entry.action === "loaded" ? "Loaded" : "Unloaded"}</span>
                <span className="font-medium text-neutral-300">{entry.modelId}</span>
                <span className="ml-auto text-neutral-600">{formatRelativeTime(entry.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DarkCard({ title, value, accent }: { title: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-neutral-600">{title}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${accent ? "text-yellow-500" : "text-neutral-200"}`}>{value}</div>
    </div>
  );
}

function DarkMemoryBar({ percent }: { percent: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-sm bg-neutral-800">
      <div
        className="h-full rounded-sm transition-all duration-500"
        style={{
          width: `${Math.min(100, percent)}%`,
          background: percent > 90 ? "#ef4444" : percent > 70 ? "#eab308" : "#00ACFF",
        }}
      />
    </div>
  );
}

/** Dark-themed models view */
function DarkModelsView({ initialStatus }: { initialStatus: LatticeInferenceStatus }) {
  const { api } = useAPI();
  const [models, setModels] = useState<LatticeModelInfo[]>(initialStatus.cachedModels);
  const [pullInput, setPullInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [modelActionLoading, setModelActionLoading] = useState<Record<string, string>>({});
  const loadedModelIds = new Set(initialStatus.loadedModels.map((m) => m.model_id));

  const refreshModels = useCallback(async () => {
    if (!api) return;
    try {
      const result = await (api as any).latticeInference.listModels() as LatticeModelInfo[];
      setModels(result);
    } catch { /* keep */ }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const stream = await (api as any).latticeInference.onDownloadProgress(undefined, { signal: ac.signal });
        for await (const progress of stream as AsyncIterable<DownloadProgress>) {
          if (cancelled) break;
          setDownloadProgress(progress);
        }
      } catch { /* ended */ }
      if (!cancelled) setDownloadProgress(null);
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [api]);

  const handlePull = async () => {
    if (!api || !pullInput.trim() || pulling) return;
    setPulling(true); setPullError(null);
    try {
      await (api as any).latticeInference.pullModel({ modelId: pullInput.trim() });
      setPullInput(""); await refreshModels();
    } catch (err) { setPullError(String(err)); }
    finally { setPulling(false); }
  };

  const handleAction = async (modelId: string, action: "loading" | "unloading" | "deleting") => {
    if (!api) return;
    setModelActionLoading((prev) => ({ ...prev, [modelId]: action }));
    try {
      if (action === "loading") await (api as any).latticeInference.loadModel({ modelId });
      else if (action === "unloading") await (api as any).latticeInference.unloadModel({ modelId });
      else await (api as any).latticeInference.deleteModel({ modelId });
      await refreshModels();
    } catch { /* ignore */ }
    finally { setModelActionLoading((prev) => { const n = { ...prev }; delete n[modelId]; return n; }); }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Models</h2>

      {/* Pull input */}
      <div className="mb-3 flex gap-1">
        <input type="text" value={pullInput} onChange={(e) => setPullInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handlePull(); }}
          placeholder="HuggingFace model ID (e.g. mlx-community/Llama-3.2-3B-4bit)"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#00ACFF]"
        />
        <button type="button" onClick={() => void handlePull()} disabled={pulling || !pullInput.trim()}
          className="inline-flex items-center gap-1 rounded bg-[#00ACFF] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Pull
        </button>
      </div>
      {pullError && <p className="mb-2 text-xs text-red-500">{pullError}</p>}

      {downloadProgress && (
        <div className="mb-3 rounded border border-neutral-700 bg-neutral-900 p-2">
          <div className="mb-1 flex justify-between text-[10px]">
            <span className="truncate text-neutral-500">{downloadProgress.fileName}</span>
            <span className="text-neutral-500">{formatBytes(downloadProgress.downloadedBytes)} / {formatBytes(downloadProgress.totalBytes)}</span>
          </div>
          <DarkMemoryBar percent={downloadProgress.totalBytes > 0 ? (downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100 : 0} />
        </div>
      )}

      {models.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-600">No cached models. Pull one to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-neutral-500">
                <th className="pb-1.5 pr-2 font-medium">Name</th>
                <th className="pb-1.5 pr-2 font-medium">Storage</th>
                <th className="pb-1.5 pr-2 font-medium">Format</th>
                <th className="pb-1.5 pr-2 font-medium">Size</th>
                <th className="pb-1.5 pr-2 font-medium">Quant</th>
                <th className="pb-1.5 pr-2 font-medium">Backend</th>
                <th className="pb-1.5 pr-2 font-medium">Pulled</th>
                <th className="pb-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const isLoaded = loadedModelIds.has(model.id);
                const actionState = modelActionLoading[model.id];
                const storageType = (model as any).storageLocation ?? "local";
                const storageLabel = (model as any).storageLabel ?? "Local";
                const storageBadgeColor = storageType === "nas"
                  ? "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                  : storageType === "external"
                    ? "bg-orange-500/20 text-orange-600 dark:text-orange-400"
                    : "bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400";
                return (
                  <tr key={model.id} className="border-b border-neutral-800/50">
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        {isLoaded && <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Loaded" />}
                        <span className="font-medium text-neutral-200">{model.name}</span>
                      </div>
                      {model.huggingFaceRepo && <div className="truncate text-[10px] text-neutral-600">{model.huggingFaceRepo}</div>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${storageBadgeColor}`}>
                        {storageType === "nas" ? <Network className="h-2.5 w-2.5" /> : <HardDrive className="h-2.5 w-2.5" />}
                        {storageLabel}
                        {storageType === "nas" && (
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="NAS Connected" />
                        )}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2"><span className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-400">{model.format}</span></td>
                    <td className="py-1.5 pr-2 text-neutral-300">{formatBytes(model.sizeBytes)}</td>
                    <td className="py-1.5 pr-2 text-neutral-400">{model.quantization || "—"}</td>
                    <td className="py-1.5 pr-2 text-neutral-400">{model.backend || "—"}</td>
                    <td className="py-1.5 pr-2 text-neutral-500">{model.pulledAt ? formatRelativeTime(model.pulledAt) : "—"}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        {actionState ? <Loader2 className="h-3 w-3 animate-spin text-neutral-600" /> : (
                          <>
                            {!isLoaded && <ActionButton icon={<Play className="h-3 w-3" />} title="Load" onClick={() => void handleAction(model.id, "loading")} color="text-green-500" />}
                            {isLoaded && <ActionButton icon={<Square className="h-3 w-3" />} title="Unload" onClick={() => void handleAction(model.id, "unloading")} color="text-yellow-500" />}
                            <ActionButton icon={<Trash2 className="h-3 w-3" />} title="Delete" onClick={() => void handleAction(model.id, "deleting")} color="text-red-500" />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ModelStorageFooter />
    </div>
  );
}

/** Dark pool view */
function DarkPoolView({ status }: { status: LatticeInferenceStatus }) {
  const { api } = useAPI();
  const vramPct = status.memoryBudgetBytes > 0
    ? (status.estimatedVramBytes / status.memoryBudgetBytes) * 100 : 0;

  const handleUnload = async (modelId: string) => {
    if (!api) return;
    try { await (api as any).latticeInference.unloadModel({ modelId }); } catch { /* ignore */ }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Model Pool</h2>
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-[10px]">
          <span className="text-neutral-500">VRAM Usage</span>
          <span className="text-neutral-400 tabular-nums">{formatBytes(status.estimatedVramBytes)} / {formatBytes(status.memoryBudgetBytes)} ({vramPct.toFixed(1)}%)</span>
        </div>
        <DarkMemoryBar percent={vramPct} />
      </div>
      <div className="mb-3 flex gap-4 text-xs">
        <span className="text-neutral-500">Max: <span className="font-medium text-neutral-300">{status.maxLoadedModels}</span></span>
        <span className="text-neutral-500">Loaded: <span className="font-medium text-neutral-300">{status.modelsLoaded}</span></span>
      </div>
      {status.loadedModels.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-600">No models currently loaded.</p>
      ) : (
        <div className="space-y-1.5">
          {status.loadedModels.map((lm) => (
            <div key={lm.model_id} className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/50 px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${lm.alive ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="truncate text-xs font-medium text-neutral-200">{lm.model_id}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-neutral-500">
                  <span>backend: {lm.backend}</span>
                  <span>mem: {formatBytes(lm.estimated_bytes)}</span>
                  <span>uses: {lm.use_count}</span>
                </div>
              </div>
              <ActionButton icon={<Square className="h-3 w-3" />} title="Unload" onClick={() => void handleUnload(lm.model_id)} color="text-yellow-500" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dark machines view — live streaming */
function DarkMachinesView() {
  const { api } = useAPI();
  const [nodes, setNodes] = useState<LatticeInferenceClusterNode[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);
    (async () => {
      try {
        const stream = await (api as any).latticeInferenceCluster.subscribe(undefined, { signal: ac.signal });
        for await (const snapshot of stream as AsyncIterable<LatticeInferenceClusterStatus>) {
          if (cancelled) break;
          if (snapshot.status === "running") {
            setNodes(snapshot.clusterState.nodes);
            setEndpoint(snapshot.clusterState.apiEndpoint);
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && (err as DOMException).name === "AbortError")) {
          console.error("Machines subscription error:", err);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [api]);

  if (loading && nodes.length === 0) {
    return <div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">Machines</h2>
        {endpoint && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              <span className="font-medium text-green-500">Live</span>
            </span>
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-500">{endpoint}</code>
          </div>
        )}
      </div>

      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <MonitorSmartphone className="h-6 w-6 text-neutral-700" />
          <p className="text-xs text-neutral-600">No machines detected.</p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {nodes.map((node) => (
            <MachineCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Dark network view — cluster topology */
function DarkNetworkView() {
  const { api } = useAPI();
  const [clusterState, setClusterState] = useState<ClusterState | null>(null);
  const [clusterNodes, setClusterNodes] = useState<ClusterNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      (api as any).latticeInference.getClusterStatus() as Promise<ClusterState | null>,
      (api as any).latticeInference.getClusterNodes() as Promise<ClusterNode[]>,
    ]).then(([cs, cn]) => {
      if (!cancelled) { setClusterState(cs); setClusterNodes(cn); }
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api]);

  if (loading) return <div className="flex h-full items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-neutral-600" /></div>;

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Network</h2>
      {clusterState && (
        <div className="mb-3 flex gap-4 text-xs">
          <span className="text-neutral-500">Nodes: <span className="font-medium text-neutral-300">{clusterState.total_nodes}</span></span>
          <span className="text-neutral-500">Models: <span className="font-medium text-neutral-300">{clusterState.total_models}</span></span>
          <span className="text-neutral-500">Updated: <span className="text-neutral-400">{formatRelativeTime(clusterState.updated_at)}</span></span>
        </div>
      )}
      {clusterNodes.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-600">Single-node mode — no cluster peers.</p>
      ) : (
        <div className="space-y-1.5">
          {clusterNodes.map((node) => (
            <LatticeNodeCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Dark benchmark view */
function DarkBenchmarkView({ onResult }: { onResult?: (result: BenchmarkResult) => void }) {
  const { api } = useAPI();
  const [modelId, setModelId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    if (!api || running) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await (api as any).latticeInference.runBenchmark({ modelId: modelId.trim() || undefined });
      setResult(res);
      onResult?.(res);
    } catch (err) { setError(String(err)); }
    finally { setRunning(false); }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Benchmark</h2>
      <div className="mb-3 flex gap-1">
        <input type="text" value={modelId} onChange={(e) => setModelId(e.target.value)}
          placeholder="Model ID (optional)"
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#00ACFF]"
        />
        <button type="button" onClick={() => void handleRun()} disabled={running}
          className="inline-flex items-center gap-1 rounded bg-[#00ACFF] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
          Run
        </button>
      </div>
      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}
      {result && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div><div className="text-neutral-600">Model</div><div className="font-medium text-neutral-200">{result.model}</div></div>
            <div><div className="text-neutral-600">Tokens/sec</div><div className="font-bold text-[#00ACFF] tabular-nums">{result.tokens_per_second.toFixed(1)}</div></div>
            <div><div className="text-neutral-600">TTFT</div><div className="font-medium text-neutral-200 tabular-nums">{result.time_to_first_token_ms.toFixed(0)}ms</div></div>
            <div><div className="text-neutral-600">Total time</div><div className="font-medium text-neutral-200 tabular-nums">{(result.total_time_ms / 1000).toFixed(2)}s</div></div>
            <div><div className="text-neutral-600">Tokens</div><div className="font-medium text-neutral-200 tabular-nums">{result.completion_tokens}</div></div>
            <div><div className="text-neutral-600">Peak mem</div><div className="font-medium text-neutral-200 tabular-nums">{formatBytes(result.peak_memory_bytes)}</div></div>
          </div>
        </div>
      )}
      {!result && !error && !running && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Zap className="h-6 w-6 text-neutral-700" />
          <p className="text-xs text-neutral-600">Run a benchmark to measure inference speed.</p>
        </div>
      )}
    </div>
  );
}

/** Dark metrics view */
function DarkMetricsView() {
  const { api } = useAPI();
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoad = async () => {
    if (!api || loading) return;
    setLoading(true);
    try { const text = await (api as any).latticeInference.getMetrics(); setMetricsText(text); }
    catch { setMetricsText("Failed to load metrics"); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Prometheus Metrics</h2>
      <button type="button" onClick={() => void handleLoad()} disabled={loading}
        className="mb-3 inline-flex items-center gap-1.5 rounded border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 disabled:opacity-50 hover:bg-neutral-800">
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {metricsText ? "Refresh" : "Load"} Metrics
      </button>
      {metricsText !== null ? (
        <pre className="max-h-[calc(100vh-200px)] overflow-auto rounded-lg border border-neutral-800 bg-black p-3 font-mono text-[11px] text-green-400">
          {metricsText}
        </pre>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Activity className="h-6 w-6 text-neutral-700" />
          <p className="text-xs text-neutral-600">Load Prometheus metrics from the inference engine.</p>
        </div>
      )}
    </div>
  );
}

/** Dark setup view placeholder */
function DarkSetupView() {
  return (
    <div className="p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-neutral-400">Setup</h2>
      <p className="text-xs text-neutral-500">Setup and installation controls. Use the Cluster tab to install or start inference.</p>
    </div>
  );
}

/** Dark config view — storage location, polling interval, and system info */
function DarkConfigView() {
  const { api } = useAPI();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelDir, setModelDir] = useState("~/.lattice/models");
  const [pollInterval, setPollInterval] = useState(5000);
  const [storagePaths, setStoragePaths] = useState<Array<{
    path: string; label: string; type: "local" | "nas" | "external"; available: boolean; freeSpaceBytes: number;
  }>>([]);
  const [customPath, setCustomPath] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const cfg = await (api as any).latticeInference.getInferenceConfig();
        setModelDir(cfg.modelDir);
        setPollInterval(cfg.pollIntervalMs);
        setStoragePaths(cfg.availableStoragePaths);
      } catch { /* use defaults */ }
      finally { setLoading(false); }
    })();
  }, [api]);

  const handleSave = async (newDir?: string, newInterval?: number) => {
    if (!api) return;
    setSaving(true);
    setSaveStatus("idle");
    try {
      await (api as any).latticeInference.setInferenceConfig({
        modelDir: newDir ?? modelDir,
        pollIntervalMs: newInterval ?? pollInterval,
      });
      if (newDir) setModelDir(newDir);
      if (newInterval) setPollInterval(newInterval);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const handleCustomPathSubmit = () => {
    if (!customPath.trim()) return;
    void handleSave(customPath.trim());
    setShowCustom(false);
    setCustomPath("");
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-neutral-600" /></div>;
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-400">Configuration</h2>
        {saveStatus === "saved" && (
          <span className="flex items-center gap-1 text-[10px] text-green-500">
            <CheckCircle2 className="h-3 w-3" /> Saved
          </span>
        )}
        {saveStatus === "error" && (
          <span className="flex items-center gap-1 text-[10px] text-red-500">
            <AlertTriangle className="h-3 w-3" /> Failed to save
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Model Storage Location */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <FolderOpen className="h-3 w-3" />
            Model Storage Location
          </label>
          <div className="space-y-1.5">
            {storagePaths.map((sp) => (
              <button
                key={sp.path}
                type="button"
                onClick={() => void handleSave(sp.path)}
                disabled={saving || !sp.available}
                className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                  modelDir === sp.path
                    ? "border-[#00ACFF] bg-[#00ACFF]/10 text-neutral-200"
                    : sp.available
                      ? "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700"
                      : "border-neutral-800/50 bg-neutral-900/30 text-neutral-600 opacity-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {sp.type === "nas" ? <Network className="h-3.5 w-3.5 text-purple-400" /> :
                   sp.type === "external" ? <HardDrive className="h-3.5 w-3.5 text-orange-400" /> :
                   <FolderOpen className="h-3.5 w-3.5 text-neutral-500" />}
                  <div>
                    <div className="font-medium">{sp.label}</div>
                    <div className="text-[10px] text-neutral-600">{sp.path}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sp.available && sp.freeSpaceBytes > 0 && (
                    <span className="text-[10px] text-neutral-500">{formatBytes(sp.freeSpaceBytes)} free</span>
                  )}
                  {!sp.available && (
                    <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                      <AlertTriangle className="h-2.5 w-2.5" /> Offline
                    </span>
                  )}
                  {modelDir === sp.path && <Check className="h-3.5 w-3.5 text-[#00ACFF]" />}
                </div>
              </button>
            ))}

            {/* Custom path */}
            {showCustom ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomPathSubmit()}
                  placeholder="/path/to/models"
                  className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[#00ACFF]"
                  autoFocus
                />
                <button type="button" onClick={handleCustomPathSubmit} disabled={!customPath.trim()}
                  className="rounded bg-[#00ACFF] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  Set
                </button>
                <button type="button" onClick={() => { setShowCustom(false); setCustomPath(""); }}
                  className="rounded border border-neutral-700 px-2 py-1.5 text-xs text-neutral-400">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustom(true)}
                className="flex w-full items-center gap-2 rounded-md border border-dashed border-neutral-700 px-3 py-2 text-xs text-neutral-500 hover:border-neutral-600 hover:text-neutral-400"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Custom path...
              </button>
            )}
          </div>
          <p className="mt-1 text-[10px] text-neutral-600">
            Select where downloaded models are stored. Requires restart to take effect.
          </p>
        </div>

        {/* Polling Interval */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <Clock className="h-3 w-3" />
            Metrics Refresh Interval
          </label>
          <div className="flex gap-1">
            {[
              { label: "1s", value: 1000 },
              { label: "3s", value: 3000 },
              { label: "5s", value: 5000 },
              { label: "10s", value: 10000 },
              { label: "30s", value: 30000 },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => void handleSave(undefined, opt.value)}
                disabled={saving}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  pollInterval === opt.value
                    ? "bg-[#00ACFF] text-white"
                    : "border border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-neutral-600">
            How often CPU, GPU, and memory metrics are refreshed in the dashboard.
          </p>
        </div>

        {/* Static info */}
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
            <Settings className="h-3 w-3" />
            System
          </label>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between rounded bg-neutral-900 px-3 py-2">
              <span className="text-neutral-500">Model storage</span>
              <code className="text-neutral-300">{modelDir}</code>
            </div>
            <div className="flex justify-between rounded bg-neutral-900 px-3 py-2">
              <span className="text-neutral-500">API endpoint</span>
              <code className="text-neutral-300">http://localhost:8392</code>
            </div>
            <div className="flex justify-between rounded bg-neutral-900 px-3 py-2">
              <span className="text-neutral-500">Binary</span>
              <code className="text-neutral-300">~/.lattice/bin/latticeinference</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lattice Node Card (detailed)
// ---------------------------------------------------------------------------

function LatticeNodeCard({ node }: { node: ClusterNode }) {
  const memPct = node.total_memory_bytes > 0
    ? (node.used_memory_bytes / node.total_memory_bytes) * 100
    : 0;

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Server className="h-3 w-3 text-[var(--color-muted)]" />
          <span className="text-xs font-medium">{node.name}</span>
          <StatusBadge status={node.status} />
        </div>
        <span className="text-muted text-[10px]">{node.address}</span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
        <span className="text-muted">GPU: <span className="text-[var(--color-fg)]">{node.gpu_type}</span></span>
        <span className="text-muted">Backend: <span className="text-[var(--color-fg)]">{node.backend}</span></span>
        <span className="text-muted">Max: <span className="text-[var(--color-fg)]">{node.max_models}</span></span>
        <span className="text-muted">Active: <span className="text-[var(--color-fg)]">{node.active_inferences}</span></span>
        <span className="text-muted">tok/s: <span className="text-[var(--color-fg)]">{node.tokens_per_second_avg.toFixed(1)}</span></span>
        <span className="text-muted">HB: <span className="text-[var(--color-fg)]">{formatRelativeTime(node.last_heartbeat)}</span></span>
      </div>

      {/* Memory bar */}
      {node.total_memory_bytes > 0 && (
        <div className="mt-1.5">
          <div className="mb-0.5 flex justify-between text-[10px]">
            <span className="text-muted">Memory</span>
            <span className="text-muted">
              {formatBytes(node.used_memory_bytes)} / {formatBytes(node.total_memory_bytes)}
            </span>
          </div>
          <MemoryBar percent={memPct} />
        </div>
      )}

      {/* Loaded models */}
      {node.loaded_models.length > 0 && (
        <div className="mt-1.5">
          <span className="text-muted text-[10px]">Models: </span>
          {node.loaded_models.map((m) => (
            <span key={m} className="mr-1 inline-block rounded bg-[var(--color-bg-primary)] px-1 py-0.5 text-[10px]">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Machine Card — visual hardware monitoring card (inspired by macmon/iStat)
// ---------------------------------------------------------------------------

function MachineCard({ node }: { node: LatticeInferenceClusterNode }) {
  const memTotal = node.gpuMemoryTotal ?? 0;
  const memFree = node.gpuMemoryFree ?? 0;
  const memUsed = memTotal - memFree;
  const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
  const gpuPct = node.gpuUtilization ?? 0;
  const temp = node.temperature;
  const power = node.powerWatts;
  const cpu = node.cpuUtilization;
  const chipFamily = node.chipFamily || node.chipName || "unknown";
  const tempColor = temp != null
    ? temp > 80 ? "text-red-500" : temp > 60 ? "text-yellow-500" : "text-green-500"
    : "text-muted";
  const powerColor = power != null
    ? power > 100 ? "text-red-500" : power > 50 ? "text-yellow-500" : "text-green-500"
    : "text-muted";

  return (
    <div className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/50">
      {/* ── Header: chip name + status ── */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${node.online ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" : "bg-red-500"}`} />
          <span className="text-sm font-bold tracking-tight text-[#00ACFF]">
            {chipFamily}
          </span>
          {node.isLocal && (
            <span className="rounded bg-[#00ACFF]/10 px-1 py-0.5 text-[9px] font-medium text-[#00ACFF]">
              LOCAL
            </span>
          )}
        </div>
        <span className="text-[10px] text-neutral-500">{node.name}</span>
      </div>

      {/* ── Visual chip block + side gauges ── */}
      <div className="flex items-stretch px-3 pb-2">
        {/* Chip visual — rounded rectangle with subtle gradient */}
        <div className="relative flex flex-1 items-center justify-center">
          <div
            className="relative flex h-[80px] w-full items-center justify-center overflow-hidden rounded-lg border border-neutral-800/60"
            style={{
              background: "linear-gradient(135deg, #0a0a0a 0%, #151515 100%)",
            }}
          >
            {/* CPU utilization fill overlay */}
            <div
              className="absolute bottom-0 left-0 right-0 transition-all duration-700 ease-out"
              style={{
                height: `${cpu ?? 0}%`,
                background: (cpu ?? 0) > 80
                  ? "linear-gradient(to top, rgba(239,68,68,0.2), rgba(239,68,68,0.05))"
                  : (cpu ?? 0) > 40
                    ? "linear-gradient(to top, rgba(234,179,8,0.2), rgba(234,179,8,0.05))"
                    : "linear-gradient(to top, rgba(0,172,255,0.2), rgba(0,172,255,0.05))",
              }}
            />
            {/* Center text — CPU utilization as the hero metric */}
            <div className="z-10 text-center">
              <div className="text-[10px] font-medium text-neutral-600">CPU</div>
              <div className="text-lg font-bold tabular-nums text-neutral-200">
                {cpu ?? 0}%
              </div>
            </div>
            {/* Connection type badge bottom-left */}
            <div className="absolute bottom-1 left-1.5">
              <span className="inline-flex items-center gap-0.5 rounded bg-neutral-900/80 px-1 py-0.5 text-[8px] font-medium text-neutral-500">
                <Wifi className="h-2 w-2" />
                {node.connectionType}
              </span>
            </div>
            {/* Tokens/sec badge bottom-right */}
            {node.tokensPerSecond > 0 && (
              <div className="absolute bottom-1 right-1.5">
                <span className="rounded bg-neutral-900/80 px-1 py-0.5 text-[8px] font-bold tabular-nums text-[#00ACFF]">
                  {node.tokensPerSecond.toFixed(1)} tok/s
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Side metrics — labeled stats */}
        <div className="ml-2.5 flex w-[60px] flex-col justify-center gap-1.5 py-0.5">
          {/* GPU */}
          <div className="flex flex-col">
            <span className="text-[8px] font-medium uppercase tracking-wider text-neutral-600">GPU</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: gpuPct > 80 ? "#ef4444" : gpuPct > 40 ? "#eab308" : "#22c55e" }}>
              {gpuPct}%
            </span>
          </div>
          {/* Temperature */}
          {temp != null && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase tracking-wider text-neutral-600">TEMP</span>
              <span className={`text-[11px] font-bold tabular-nums ${tempColor}`}>
                {Math.round(temp)}°C
              </span>
            </div>
          )}
          {/* Power */}
          {power != null && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase tracking-wider text-neutral-600">POWER</span>
              <span className={`text-[11px] font-bold tabular-nums ${powerColor}`}>
                {Math.round(power)}W
              </span>
            </div>
          )}
          {/* Memory Pressure */}
          {(node as any).memoryPressure != null && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase tracking-wider text-neutral-600">MEM.P</span>
              <span className={`text-[11px] font-bold tabular-nums ${
                (node as any).memoryPressure > 80 ? "text-red-500"
                  : (node as any).memoryPressure > 50 ? "text-yellow-500"
                  : "text-green-500"
              }`}>
                {Math.round((node as any).memoryPressure)}%
              </span>
            </div>
          )}
          {/* Fallback: show tok/s if no thermal data */}
          {temp == null && power == null && (node as any).memoryPressure == null && node.tokensPerSecond > 0 && (
            <div className="flex flex-col">
              <span className="text-[8px] font-medium uppercase tracking-wider text-neutral-600">SPEED</span>
              <span className="text-[11px] font-bold tabular-nums text-[#00ACFF]">
                {node.tokensPerSecond.toFixed(1)} t/s
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Memory bar ── */}
      <div className="px-3 pb-2.5">
        <div className="mb-1 flex items-center justify-between text-[10px]">
          <span className="font-medium text-neutral-500">Memory</span>
          <span className="tabular-nums text-neutral-300">
            {formatBytes(memUsed)}<span className="text-neutral-500">/{formatBytes(memTotal)}</span>
            <span className="ml-1 text-neutral-500">({memPct.toFixed(0)}%)</span>
          </span>
        </div>
        {/* Thick memory bar like the reference */}
        <div className="relative h-3 w-full overflow-hidden rounded-sm bg-neutral-800">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-700 ease-out"
            style={{
              width: `${Math.min(100, memPct)}%`,
              background: memPct > 90
                ? "linear-gradient(90deg, #ef4444, #dc2626)"
                : memPct > 70
                  ? "linear-gradient(90deg, #eab308, #ca8a04)"
                  : "linear-gradient(90deg, #00ACFF, #0088cc)",
            }}
          />
        </div>
      </div>

      {/* ── Footer: chip details ── */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-neutral-800/50 px-3 py-1.5 text-[9px] text-neutral-500">
        <span>{node.chipName || chipFamily}</span>
        <span>·</span>
        <span>{node.platform || "Unknown"}</span>
        {!node.isLocal && (
          <>
            <span>·</span>
            <span>{node.host}{node.port > 0 ? `:${node.port}` : ""}</span>
          </>
        )}
        {node.gpuName && node.gpuName !== "Unknown" && node.gpuName !== "Unified Memory" && (
          <>
            <span>·</span>
            <span>{node.gpuName}</span>
          </>
        )}
        {node.isLocal && node.gpuName === "Unified Memory" && (
          <>
            <span>·</span>
            <span>Unified Memory</span>
          </>
        )}
        {node.bandwidthBytesPerSec != null && node.bandwidthBytesPerSec > 0 && (
          <>
            <span>·</span>
            <span>{formatBytes(node.bandwidthBytesPerSec)}/s</span>
          </>
        )}
        {node.connectionType && node.connectionType !== "local" && (
          <>
            <span>·</span>
            <span>{node.connectionType}</span>
          </>
        )}
        {!node.isLocal && (
          <span className="ml-auto text-[8px]">{formatRelativeTime(node.lastSeen)}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loaded Model Card (pool section)
// ---------------------------------------------------------------------------

function LoadedModelCard({ model, onUnload }: { model: LoadedModelInfo; onUnload: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${model.alive ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-xs font-medium truncate">{model.model_id}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--color-muted)]">
          <span>backend: {model.backend}</span>
          <span>mem: {formatBytes(model.estimated_bytes)}</span>
          <span>uses: {model.use_count}</span>
          <span>loaded: {formatRelativeTime(model.loaded_at)}</span>
          <span>last: {formatRelativeTime(model.last_used_at)}</span>
        </div>
      </div>
      <ActionButton
        icon={<Square className="h-3 w-3" />}
        title="Unload"
        onClick={onUnload}
        color="text-yellow-500"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action Button (icon-only)
// ---------------------------------------------------------------------------

function ActionButton({
  icon,
  title,
  onClick,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded p-0.5 transition-opacity hover:opacity-70 ${color}`}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Benchmark stat (used by standalone tabs)
// ---------------------------------------------------------------------------

function BenchmarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted">{label}</div>
      <div className="font-medium text-[var(--color-fg)]">{value}</div>
    </div>
  );
}

/** Shows current model storage path with NAS connectivity indicator */
function ModelStorageFooter() {
  const { api } = useAPI();
  const [storageInfo, setStorageInfo] = useState<{
    modelDir: string;
    type: "local" | "nas" | "external";
    available: boolean;
    freeSpaceBytes: number;
  } | null>(null);

  useEffect(() => {
    if (!api) return;
    (async () => {
      try {
        const cfg = await (api as any).latticeInference.getInferenceConfig();
        const currentPath = cfg.modelDir;
        const match = cfg.availableStoragePaths.find((p: any) => p.path === currentPath);
        setStorageInfo({
          modelDir: currentPath,
          type: match?.type ?? "local",
          available: match?.available ?? true,
          freeSpaceBytes: match?.freeSpaceBytes ?? 0,
        });
      } catch { /* ignore */ }
    })();
  }, [api]);

  if (!storageInfo) return null;

  return (
    <div className="mt-3 flex items-center gap-2 text-[10px] text-neutral-600">
      {storageInfo.type === "nas" ? (
        <>
          <Network className="h-3 w-3" />
          <span>NAS storage:</span>
          <code className="rounded bg-neutral-800 px-1 text-neutral-400">{storageInfo.modelDir}</code>
          <span className={`flex items-center gap-0.5 ${storageInfo.available ? "text-green-500" : "text-red-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${storageInfo.available ? "bg-green-500" : "bg-red-500"}`} />
            {storageInfo.available ? "Connected" : "Disconnected"}
          </span>
        </>
      ) : (
        <>
          <HardDrive className="h-3 w-3" />
          <span>Model storage:</span>
          <code className="rounded bg-neutral-800 px-1 text-neutral-400">{storageInfo.modelDir}</code>
        </>
      )}
      {storageInfo.freeSpaceBytes > 0 && (
        <span className="text-neutral-500">({formatBytes(storageInfo.freeSpaceBytes)} free)</span>
      )}
    </div>
  );
}

// ===========================================================================
//
//  EXO CLUSTER — existing components (untouched)
//
// ===========================================================================

function ExoClusterView({ minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [status, setStatus] = useState<ExoStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const abortController = new AbortController();

    async function load() {
      try {
        const result = await (api as any).inference.getStatus();
        if (!cancelled) {
          setStatus(result as ExoStatus);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError("Failed to check exo status");
      }
    }

    async function subscribe() {
      try {
        const stream = await (api as any).inference.subscribe(
          undefined,
          { signal: abortController.signal },
        );
        for await (const snapshot of stream) {
          if (cancelled) break;
          setStatus(snapshot as ExoStatus);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
          console.error("InferenceTab: subscription error:", err);
        }
      }
    }

    void load();
    void subscribe();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [api]);

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!status) {
    return <LoadingState />;
  }

  switch (status.status) {
    case "not_installed":
      return <NotInstalledView minionId={minionId} />;
    case "installed_not_running":
      return <NotRunningView minionId={minionId} commandPath={status.commandPath} />;
    case "running":
      return <ClusterDashboard state={status.clusterState} />;
    case "error":
      return <ErrorState message={status.message} />;
  }
}

// ---------------------------------------------------------------------------
// Exo: Not Installed view
// ---------------------------------------------------------------------------

const EXO_INSTALL_CMD = [
  'echo "Installing exo prerequisites..."',
  "brew install uv macmon node cmake 2>/dev/null || true",
  "xcodebuild -downloadComponent MetalToolchain 2>/dev/null || true",
  'command -v rustc >/dev/null || { echo "Installing Rust..."; curl --proto \'=https\' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"; }',
  'rustup toolchain install nightly 2>/dev/null || true',
  'echo "Cloning exo..."',
  "git clone https://github.com/exo-explore/exo.git ~/.exo-cluster 2>/dev/null || { cd ~/.exo-cluster && git pull; }",
  'echo "Building dashboard..."',
  "cd ~/.exo-cluster/dashboard && npm install && npm run build",
  'echo ""',
  'echo "exo installed -- click Start Cluster to begin"',
].join(" && ");

function NotInstalledView({ minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [installing, setInstalling] = useState(false);

  const handleInstall = async () => {
    if (!api || installing) return;
    setInstalling(true);
    try {
      await api.terminal.create({
        minionId,
        cols: 120,
        rows: 30,
        initialCommand: EXO_INSTALL_CMD,
      });
    } catch (err) {
      console.error("Failed to create terminal for install:", err);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Download className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Exo Not Installed</h3>
        <p className="text-muted mt-1 text-xs">
          Run AI models locally with distributed inference across your devices.
        </p>
      </div>
      <button
        type="button"
        onClick={handleInstall}
        disabled={installing}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {installing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        Install exo
      </button>
      <p className="text-muted text-[10px]">
        Clones <a href="https://github.com/exo-explore/exo" target="_blank" rel="noopener" className="underline">exo-explore/exo</a>, installs prereqs via brew, and builds the dashboard.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exo: Installed but not running view
// ---------------------------------------------------------------------------

function NotRunningView({ minionId, commandPath }: { minionId: string; commandPath: string }) {
  const { api } = useAPI();
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!api || starting) return;
    setStarting(true);
    try {
      await api.terminal.create({
        minionId,
        cols: 120,
        rows: 30,
        initialCommand: `cd ${commandPath} && uv run exo`,
      });
    } catch (err) {
      console.error("Failed to start exo:", err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="rounded-full bg-[var(--color-bg-secondary)] p-4">
        <Server className="h-8 w-8 text-[var(--color-muted)]" />
      </div>
      <div>
        <h3 className="text-sm font-medium">Exo Installed</h3>
        <p className="text-muted mt-1 text-xs">
          Start the inference cluster to run models locally.
        </p>
      </div>
      <button
        type="button"
        onClick={handleStart}
        disabled={starting}
        className="inline-flex items-center gap-2 rounded-md bg-[var(--color-success)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {starting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5" />
        )}
        Start Cluster
      </button>
      <p className="text-muted text-[10px]">
        Runs: <code className="rounded bg-[var(--color-bg-secondary)] px-1">cd {commandPath} && uv run exo</code>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exo: Cluster Dashboard
// ---------------------------------------------------------------------------

function ClusterDashboard({ state }: { state: ExoClusterState }) {
  const [iframeError, setIframeError] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5">
        <span className="inline-flex items-center gap-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          <span className="font-medium">{state.nodes.length} node{state.nodes.length !== 1 ? "s" : ""}</span>
          <span className="text-muted">·</span>
          <span>{state.models.length} model{state.models.length !== 1 ? "s" : ""}</span>
        </span>
        <span className="ml-auto">
          <code className="text-muted rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[10px]">
            {state.apiEndpoint}
          </code>
        </span>
      </div>

      {!iframeError ? (
        <iframe
          src={state.apiEndpoint}
          title="Exo Cluster Dashboard"
          className="flex-1 border-0"
          style={{ width: "100%", height: "100%", colorScheme: "normal" }}
          onError={() => setIframeError(true)}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
          <section>
            <h4 className="text-muted mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
              <Network className="h-3 w-3" />
              Nodes
            </h4>
            <div className="flex flex-col gap-1.5">
              {state.nodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          </section>

          {state.models.length > 0 && (
            <section>
              <h4 className="text-muted mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider">
                <Cpu className="h-3 w-3" />
                Models
              </h4>
              <div className="flex flex-col gap-1">
                {state.models.map((model) => (
                  <ModelRow key={model.modelId} model={model} />
                ))}
              </div>
            </section>
          )}

          <section className="border-t border-[var(--color-border)] pt-2">
            <p className="text-muted text-[10px]">
              OpenAI-compatible API available at{" "}
              <code className="rounded bg-[var(--color-bg-secondary)] px-1">
                {state.apiEndpoint}/v1/chat/completions
              </code>
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exo: Node card
// ---------------------------------------------------------------------------

function NodeCard({ node }: { node: ExoNode }) {
  const memUsed = node.gpuMemoryTotal - node.gpuMemoryFree;
  const memPct = node.gpuMemoryTotal > 0 ? (memUsed / node.gpuMemoryTotal) * 100 : 0;

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{node.name}</span>
        <span className="text-muted text-[10px]">{node.host}:{node.port}</span>
      </div>
      <div className="text-muted mt-0.5 text-[10px]">{node.gpuName}</div>
      {node.gpuMemoryTotal > 0 && (
        <div className="mt-1.5">
          <div className="mb-0.5 flex justify-between text-[10px]">
            <span className="text-muted">Memory</span>
            <span className="text-muted">
              {formatBytes(memUsed)} / {formatBytes(node.gpuMemoryTotal)}
            </span>
          </div>
          <MemoryBar percent={memPct} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exo: Model row
// ---------------------------------------------------------------------------

function ModelRow({ model }: { model: ExoModel }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5">
      <span className="text-xs font-medium">{model.modelId}</span>
      <StatusBadge status={model.status} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function MemoryBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{
          width: `${Math.min(100, percent)}%`,
          background: percent > 90 ? "var(--color-destructive)" : "var(--color-accent)",
        }}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorClass =
    status === "running" || status === "healthy"
      ? "bg-green-500/10 text-green-500"
      : status === "loading" || status === "busy"
        ? "bg-yellow-500/10 text-yellow-500"
        : status === "available" || status === "idle"
          ? "bg-blue-500/10 text-blue-500"
          : "bg-red-500/10 text-red-500";

  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <RefreshCw className="text-muted h-5 w-5 animate-spin" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <AlertCircle className="h-6 w-6 text-[var(--color-destructive)]" />
      <p className="text-muted text-xs">{message}</p>
    </div>
  );
}

/** Map raw platform enum to human-readable label */
function formatPlatform(platform: string): string {
  const map: Record<string, string> = {
    "apple-silicon": "Apple Silicon",
    "other": "Other",
  };
  return map[platform] ?? platform;
}

/** Map raw backend string to human-readable label */
function formatBackend(backend: string | null | undefined): string {
  if (!backend) return "Not detected";
  const map: Record<string, string> = {
    mlx: "MLX",
    gguf: "GGUF (llama.cpp)",
    pytorch: "PyTorch",
    none: "Not detected",
  };
  return map[backend] ?? backend;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(bytes) || bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const then = new Date(isoString).getTime();
    if (isNaN(then)) return "—";
    const now = Date.now();
    const diffMs = now - then;
    if (diffMs < 0) return "just now";
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "—";
  }
}

// ===========================================================================
//
//  STANDALONE TAB COMPONENTS — each inference section as its own sidebar tab
//
// ===========================================================================

/** Wrapper that checks if inference is running and renders content or a placeholder */
function InferenceGate({ children }: { children: (status: LatticeInferenceStatus) => React.ReactNode }) {
  const { api } = useAPI();
  const [status, setStatus] = useState<LatticeInferenceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await (api as any).latticeInference.getStatus();
        if (!cancelled) setStatus(result);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [api]);

  if (error) return <ErrorState message={error} />;
  if (!status) return <LoadingState />;
  if (!status.available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Server className="h-6 w-6 text-[var(--color-muted)]" />
        <p className="text-muted text-xs">Lattice Inference is not running. Start it from the Cluster tab.</p>
      </div>
    );
  }
  return <>{children(status)}</>;
}

/** Models tab — standalone */
export function InfModelsTab({ minionId: _minionId }: { minionId: string }) {
  return (
    <InferenceGate>
      {(status) => <ModelsSection initialStatus={status} />}
    </InferenceGate>
  );
}

function ModelsSection({ initialStatus }: { initialStatus: LatticeInferenceStatus }) {
  const { api } = useAPI();
  const [models, setModels] = useState<LatticeModelInfo[]>(initialStatus.cachedModels);
  const [pullInput, setPullInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [modelActionLoading, setModelActionLoading] = useState<Record<string, string>>({});

  const loadedModelIds = new Set(initialStatus.loadedModels.map((m) => m.model_id));

  const refreshModels = useCallback(async () => {
    if (!api) return;
    try {
      const result = await (api as any).latticeInference.listModels() as LatticeModelInfo[];
      setModels(result);
    } catch { /* keep existing */ }
  }, [api]);

  // Subscribe to download progress
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ac = new AbortController();
    (async () => {
      try {
        const stream = await (api as any).latticeInference.onDownloadProgress(undefined, { signal: ac.signal });
        for await (const progress of stream as AsyncIterable<DownloadProgress>) {
          if (cancelled) break;
          setDownloadProgress(progress);
        }
      } catch { /* ended */ }
      if (!cancelled) setDownloadProgress(null);
    })();
    return () => { cancelled = true; ac.abort(); };
  }, [api]);

  const handlePull = async () => {
    if (!api || !pullInput.trim() || pulling) return;
    setPulling(true);
    setPullError(null);
    try {
      await (api as any).latticeInference.pullModel({ modelId: pullInput.trim() });
      setPullInput("");
      await refreshModels();
    } catch (err) { setPullError(String(err)); }
    finally { setPulling(false); }
  };

  const handleModelAction = async (modelId: string, action: "loading" | "unloading" | "deleting") => {
    if (!api) return;
    setModelActionLoading((prev) => ({ ...prev, [modelId]: action }));
    try {
      if (action === "loading") await (api as any).latticeInference.loadModel({ modelId });
      else if (action === "unloading") await (api as any).latticeInference.unloadModel({ modelId });
      else await (api as any).latticeInference.deleteModel({ modelId });
      await refreshModels();
    } catch { /* ignore */ }
    finally { setModelActionLoading((prev) => { const n = { ...prev }; delete n[modelId]; return n; }); }
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* Pull model input */}
      <div className="mb-3 flex gap-1">
        <input
          type="text"
          value={pullInput}
          onChange={(e) => setPullInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handlePull(); }}
          placeholder="HuggingFace model ID (e.g. mlx-community/Llama-3.2-3B-4bit)"
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={() => void handlePull()}
          disabled={pulling || !pullInput.trim()}
          className="inline-flex items-center gap-1 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Pull
        </button>
      </div>
      {pullError && <p className="mb-2 text-xs text-red-500">{pullError}</p>}

      {/* Download progress */}
      {downloadProgress && (
        <div className="mb-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2">
          <div className="mb-1 flex justify-between text-[10px]">
            <span className="text-muted truncate">{downloadProgress.fileName}</span>
            <span className="text-muted">{formatBytes(downloadProgress.downloadedBytes)} / {formatBytes(downloadProgress.totalBytes)}</span>
          </div>
          <MemoryBar percent={downloadProgress.totalBytes > 0 ? (downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100 : 0} />
        </div>
      )}

      {/* Models table */}
      {models.length === 0 ? (
        <p className="text-muted py-4 text-center text-xs">No cached models. Pull one to get started.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-[var(--color-border)] text-left">
                <th className="pb-1.5 pr-2 font-medium">Name</th>
                <th className="pb-1.5 pr-2 font-medium">Format</th>
                <th className="pb-1.5 pr-2 font-medium">Size</th>
                <th className="pb-1.5 pr-2 font-medium">Quant</th>
                <th className="pb-1.5 pr-2 font-medium">Backend</th>
                <th className="pb-1.5 pr-2 font-medium">Pulled</th>
                <th className="pb-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const isLoaded = loadedModelIds.has(model.id);
                const actionState = modelActionLoading[model.id];
                return (
                  <tr key={model.id} className="border-b border-[var(--color-border)]/50">
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        {isLoaded && <span className="h-1.5 w-1.5 rounded-full bg-green-500" title="Loaded" />}
                        <span className="font-medium">{model.name}</span>
                      </div>
                      {model.huggingFaceRepo && <div className="text-muted truncate text-[10px]">{model.huggingFaceRepo}</div>}
                    </td>
                    <td className="py-1.5 pr-2"><span className="rounded bg-[var(--color-bg-secondary)] px-1 py-0.5">{model.format}</span></td>
                    <td className="py-1.5 pr-2">{formatBytes(model.sizeBytes)}</td>
                    <td className="py-1.5 pr-2">{model.quantization || "—"}</td>
                    <td className="py-1.5 pr-2">{model.backend || "—"}</td>
                    <td className="py-1.5 pr-2">{model.pulledAt ? formatRelativeTime(model.pulledAt) : "—"}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        {actionState ? (
                          <Loader2 className="h-3 w-3 animate-spin text-[var(--color-muted)]" />
                        ) : (
                          <>
                            {!isLoaded && <ActionButton icon={<Play className="h-3 w-3" />} title="Load" onClick={() => void handleModelAction(model.id, "loading")} color="text-green-500" />}
                            {isLoaded && <ActionButton icon={<Square className="h-3 w-3" />} title="Unload" onClick={() => void handleModelAction(model.id, "unloading")} color="text-yellow-500" />}
                            <ActionButton icon={<Trash2 className="h-3 w-3" />} title="Delete" onClick={() => void handleModelAction(model.id, "deleting")} color="text-red-500" />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-muted mt-3 text-[10px]">
        <HardDrive className="mr-0.5 inline h-3 w-3" />
        Model storage: <code className="rounded bg-[var(--color-bg-secondary)] px-1">~/.lattice/models</code>
      </p>
    </div>
  );
}

/** Pool tab — standalone */
export function InfPoolTab({ minionId: _minionId }: { minionId: string }) {
  return (
    <InferenceGate>
      {(status) => <PoolSection status={status} />}
    </InferenceGate>
  );
}

function PoolSection({ status }: { status: LatticeInferenceStatus }) {
  const { api } = useAPI();
  const vramPct = status.memoryBudgetBytes > 0
    ? (status.estimatedVramBytes / status.memoryBudgetBytes) * 100 : 0;

  const handleUnload = async (modelId: string) => {
    if (!api) return;
    try { await (api as any).latticeInference.unloadModel({ modelId }); } catch { /* ignore */ }
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted">VRAM Usage</span>
          <span className="text-muted tabular-nums">
            {formatBytes(status.estimatedVramBytes)} / {formatBytes(status.memoryBudgetBytes)} ({vramPct.toFixed(1)}%)
          </span>
        </div>
        <MemoryBar percent={vramPct} />
      </div>

      <div className="mb-3 flex gap-4 text-xs">
        <span className="text-muted">Max loaded: <span className="font-medium text-[var(--color-fg)]">{status.maxLoadedModels}</span></span>
        <span className="text-muted">Currently: <span className="font-medium text-[var(--color-fg)]">{status.modelsLoaded}</span></span>
      </div>

      {status.loadedModels.length === 0 ? (
        <p className="text-muted py-4 text-center text-xs">No models currently loaded.</p>
      ) : (
        <div className="space-y-1.5">
          {status.loadedModels.map((lm) => (
            <LoadedModelCard key={lm.model_id} model={lm} onUnload={() => void handleUnload(lm.model_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Machines tab — standalone with live subscription */
export function InfMachinesTab({ minionId: _minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [nodes, setNodes] = useState<LatticeInferenceClusterNode[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const ac = new AbortController();
    setLoading(true);

    async function subscribeLive() {
      try {
        const stream = await (api as any).latticeInferenceCluster.subscribe(
          undefined,
          { signal: ac.signal },
        );
        for await (const snapshot of stream as AsyncIterable<LatticeInferenceClusterStatus>) {
          if (cancelled) break;
          if (snapshot.status === "running") {
            setNodes(snapshot.clusterState.nodes);
            setEndpoint(snapshot.clusterState.apiEndpoint);
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled && !(err instanceof DOMException && (err as DOMException).name === "AbortError")) {
          console.error("Machines tab subscription error:", err);
        }
      }
      if (!cancelled) setLoading(false);
    }

    void subscribeLive();
    return () => { cancelled = true; ac.abort(); };
  }, [api]);

  if (loading && nodes.length === 0) return <LoadingState />;

  return (
    <div className="h-full overflow-y-auto p-3">
      {/* Live indicator + endpoint */}
      {endpoint && (
        <div className="mb-3 flex items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
            <span className="font-medium text-green-500">Live</span>
          </span>
          <code className="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[var(--color-muted)]">{endpoint}</code>
          <span className="text-muted ml-auto">
            {nodes.filter(n => n.online).length} of {nodes.length} online
          </span>
        </div>
      )}

      {nodes.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <MonitorSmartphone className="h-6 w-6 text-[var(--color-muted)]" />
          <p className="text-muted text-xs">No machines detected. Start inference or connect cluster peers.</p>
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {nodes.map((node) => (
            <MachineCard key={node.id} node={node} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Benchmark tab — standalone */
export function InfBenchmarkTab({ minionId: _minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [modelId, setModelId] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBenchmark = async () => {
    if (!api || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await (api as any).latticeInference.runBenchmark({ modelId: modelId.trim() || undefined });
      setResult(res);
    } catch (err) { setError(String(err)); }
    finally { setRunning(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex gap-1">
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="Model ID (optional, uses default)"
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        <button
          type="button"
          onClick={() => void handleBenchmark()}
          disabled={running}
          className="inline-flex items-center gap-1 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3 w-3" />}
          Run Benchmark
        </button>
      </div>

      {error && <p className="mb-3 text-xs text-red-500">{error}</p>}

      {result && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
          <h4 className="mb-2 text-xs font-medium">Results — {result.model}</h4>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <BenchmarkStat label="Tokens/sec" value={result.tokens_per_second.toFixed(1)} />
            <BenchmarkStat label="TTFT" value={`${result.time_to_first_token_ms.toFixed(0)}ms`} />
            <BenchmarkStat label="Total time" value={`${(result.total_time_ms / 1000).toFixed(2)}s`} />
            <BenchmarkStat label="Tokens" value={String(result.completion_tokens)} />
            <BenchmarkStat label="Peak memory" value={formatBytes(result.peak_memory_bytes)} />
          </div>
        </div>
      )}

      {!result && !error && !running && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Zap className="h-6 w-6 text-[var(--color-muted)]" />
          <p className="text-muted text-xs">Run a benchmark to measure inference performance.</p>
        </div>
      )}
    </div>
  );
}

/** Metrics tab — standalone */
export function InfMetricsTab({ minionId: _minionId }: { minionId: string }) {
  const { api } = useAPI();
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoad = async () => {
    if (!api || loading) return;
    setLoading(true);
    try {
      const text = await (api as any).latticeInference.getMetrics();
      setMetricsText(text);
    } catch { setMetricsText("Failed to load metrics"); }
    finally { setLoading(false); }
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      <button
        type="button"
        onClick={() => void handleLoad()}
        disabled={loading}
        className="mb-3 inline-flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        {metricsText ? "Refresh" : "Load"} Metrics
      </button>

      {metricsText !== null ? (
        <pre className="max-h-[calc(100vh-200px)] overflow-auto rounded-lg border border-[var(--color-border)] bg-black/80 p-3 font-mono text-[11px] text-green-400">
          {metricsText}
        </pre>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <Activity className="h-6 w-6 text-[var(--color-muted)]" />
          <p className="text-muted text-xs">Load Prometheus metrics from the inference engine.</p>
        </div>
      )}
    </div>
  );
}
