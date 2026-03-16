import { useEffect, useState, useCallback, useRef } from "react";
import {
  Download,
  Play,
  Square,
  Trash2,
  Loader2,
  HardDrive,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Wrench,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";
import type { z } from "zod";
import type {
  LatticeInferenceStatusSchema,
  LatticeModelInfoSchema,
  LoadedModelInfoSchema,
  DownloadProgressSchema,
  InferenceSetupStatusSchema,
  SetupStreamEventSchema,
} from "@/common/orpc/schemas/latticeInference";

// ---------------------------------------------------------------------------
// Types inferred from Zod schemas
// ---------------------------------------------------------------------------

type InferenceStatus = z.infer<typeof LatticeInferenceStatusSchema>;
type ModelInfo = z.infer<typeof LatticeModelInfoSchema>;
type LoadedModel = z.infer<typeof LoadedModelInfoSchema>;
type DownloadProgress = z.infer<typeof DownloadProgressSchema>;
type SetupStatus = z.infer<typeof InferenceSetupStatusSchema>;
type SetupEvent = z.infer<typeof SetupStreamEventSchema>;

// ---------------------------------------------------------------------------
// Main Section
// ---------------------------------------------------------------------------

export function LatticeInferenceSection() {
  const { api } = useAPI();
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const result = await (api as any).latticeInference.getStatus();
      setStatus(result as InferenceStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get inference status");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8">
        <Loader2 className="text-muted h-4 w-4 animate-spin" />
        <span className="text-muted text-sm">Checking inference engine...</span>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="space-y-6">
        <div>
          <h3 className="text-foreground mb-4 text-sm font-medium">Local Inference</h3>
          <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
        <SetupSection onSetupComplete={refresh} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Engine Status */}
      <EngineStatusCard status={status!} onRefresh={refresh} />

      {/* Loaded Models */}
      {status!.loadedModels.length > 0 && (
        <LoadedModelsSection models={status!.loadedModels} onAction={refresh} />
      )}

      {/* Cached Models */}
      <CachedModelsSection
        models={status!.cachedModels}
        loadedModelIds={status!.loadedModels.map((m) => m.model_id)}
        onAction={refresh}
      />

      {/* Pull Model */}
      <PullModelSection onPulled={refresh} />

      {/* Setup (collapsed) */}
      <SetupSection onSetupComplete={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine Status Card
// ---------------------------------------------------------------------------

function EngineStatusCard({
  status,
  onRefresh,
}: {
  status: InferenceStatus;
  onRefresh: () => void;
}) {
  const vramPct =
    status.memoryBudgetBytes > 0
      ? (status.estimatedVramBytes / status.memoryBudgetBytes) * 100
      : 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-foreground text-sm font-medium">Local Inference</h3>
        <Button variant="ghost" size="icon" onClick={onRefresh} className="h-6 w-6" title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="border-border-medium overflow-hidden rounded-md border">
        <div className="bg-sidebar flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${status.available ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-foreground text-xs font-medium">
              {status.available ? "Engine Running" : "Engine Unavailable"}
            </span>
          </div>
          <span className="text-muted text-[10px]">
            {status.modelsLoaded}/{status.maxLoadedModels} models loaded
          </span>
        </div>
        {status.memoryBudgetBytes > 0 && (
          <div className="border-border-medium border-t px-3 py-2">
            <div className="mb-1 flex justify-between text-[10px]">
              <span className="text-muted">VRAM Usage</span>
              <span className="text-muted">
                {formatBytes(status.estimatedVramBytes)} / {formatBytes(status.memoryBudgetBytes)}
              </span>
            </div>
            <MemoryBar percent={vramPct} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loaded Models
// ---------------------------------------------------------------------------

function LoadedModelsSection({
  models,
  onAction,
}: {
  models: LoadedModel[];
  onAction: () => void;
}) {
  const { api } = useAPI();
  const [unloading, setUnloading] = useState<string | null>(null);

  const handleUnload = async (modelId: string) => {
    if (!api) return;
    setUnloading(modelId);
    try {
      await (api as any).latticeInference.unloadModel({ modelId });
      onAction();
    } catch (err) {
      console.error("Failed to unload model:", err);
    } finally {
      setUnloading(null);
    }
  };

  return (
    <div>
      <h3 className="text-foreground mb-2 text-sm font-medium">Loaded Models</h3>
      <div className="border-border-medium overflow-hidden rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-border-medium bg-sidebar border-b">
              <th className="text-muted px-3 py-1.5 text-left font-medium">Model</th>
              <th className="text-muted px-3 py-1.5 text-left font-medium">Backend</th>
              <th className="text-muted px-3 py-1.5 text-right font-medium">Memory</th>
              <th className="text-muted px-3 py-1.5 text-right font-medium">Uses</th>
              <th className="text-muted px-3 py-1.5 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.model_id} className="border-border-medium border-b last:border-0">
                <td className="text-foreground px-3 py-2 font-mono text-[11px]">
                  {model.model_id}
                </td>
                <td className="text-muted px-3 py-2">{model.backend}</td>
                <td className="text-muted px-3 py-2 text-right">
                  {formatBytes(model.estimated_bytes)}
                </td>
                <td className="text-muted px-3 py-2 text-right">{model.use_count}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => handleUnload(model.model_id)}
                    disabled={unloading === model.model_id}
                    className="text-muted hover:text-foreground"
                  >
                    {unloading === model.model_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Square className="h-3 w-3" />
                    )}
                    Unload
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cached Models Table
// ---------------------------------------------------------------------------

function CachedModelsSection({
  models,
  loadedModelIds,
  onAction,
}: {
  models: ModelInfo[];
  loadedModelIds: string[];
  onAction: () => void;
}) {
  const { api } = useAPI();
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleLoad = async (modelId: string) => {
    if (!api) return;
    setActionInProgress(modelId);
    try {
      await (api as any).latticeInference.loadModel({ modelId });
      onAction();
    } catch (err) {
      console.error("Failed to load model:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!api) return;
    setActionInProgress(modelId);
    try {
      await (api as any).latticeInference.deleteModel({ modelId });
      setConfirmDelete(null);
      onAction();
    } catch (err) {
      console.error("Failed to delete model:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div>
      <h3 className="text-foreground mb-2 text-sm font-medium">Cached Models</h3>
      {models.length === 0 ? (
        <div className="border-border-medium flex flex-col items-center gap-2 rounded-md border py-6 text-center">
          <HardDrive className="text-muted h-6 w-6" />
          <p className="text-muted text-xs">No models downloaded yet. Pull a model below.</p>
        </div>
      ) : (
        <div className="border-border-medium overflow-hidden rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-border-medium bg-sidebar border-b">
                <th className="text-muted px-3 py-1.5 text-left font-medium">Model</th>
                <th className="text-muted px-3 py-1.5 text-left font-medium">Format</th>
                <th className="text-muted px-3 py-1.5 text-right font-medium">Size</th>
                <th className="text-muted px-3 py-1.5 text-left font-medium">Quant</th>
                <th className="text-muted px-3 py-1.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {models.map((model) => {
                const isLoaded = loadedModelIds.includes(model.id);
                const isBusy = actionInProgress === model.id;
                return (
                  <tr key={model.id} className="border-border-medium border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {isLoaded && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                        )}
                        <span className="text-foreground font-mono text-[11px]">{model.id}</span>
                      </div>
                    </td>
                    <td className="text-muted px-3 py-2 uppercase">{model.format}</td>
                    <td className="text-muted px-3 py-2 text-right">
                      {formatBytes(model.sizeBytes)}
                    </td>
                    <td className="text-muted px-3 py-2">{model.quantization ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!isLoaded && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleLoad(model.id)}
                            disabled={isBusy}
                            className="text-muted hover:text-foreground"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                            Load
                          </Button>
                        )}
                        {confirmDelete === model.id ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="destructive"
                              size="xs"
                              onClick={() => handleDelete(model.id)}
                              disabled={isBusy}
                            >
                              {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setConfirmDelete(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setConfirmDelete(model.id)}
                            disabled={isBusy || isLoaded}
                            className="text-muted hover:text-red-400"
                            title={isLoaded ? "Unload model first" : "Delete model"}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pull Model Form
// ---------------------------------------------------------------------------

function PullModelSection({ onPulled }: { onPulled: () => void }) {
  const { api } = useAPI();
  const [modelId, setModelId] = useState("");
  const [pulling, setPulling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handlePull = async () => {
    if (!api || !modelId.trim() || pulling) return;
    setPulling(true);
    setPullError(null);
    setProgress(null);

    // Start progress subscription
    abortRef.current = new AbortController();
    const progressPromise = (async () => {
      try {
        const stream = await (api as any).latticeInference.onDownloadProgress(undefined, {
          signal: abortRef.current!.signal,
        });
        for await (const event of stream) {
          setProgress(event as DownloadProgress);
        }
      } catch {
        // Expected abort or stream end
      }
    })();

    // Start the pull
    try {
      await (api as any).latticeInference.pullModel({ modelId: modelId.trim() });
      setModelId("");
      onPulled();
    } catch (err) {
      setPullError(err instanceof Error ? err.message : "Failed to pull model");
    } finally {
      setPulling(false);
      setProgress(null);
      abortRef.current?.abort();
      await progressPromise.catch(() => {});
    }
  };

  const progressPct =
    progress && progress.totalBytes > 0
      ? (progress.downloadedBytes / progress.totalBytes) * 100
      : 0;

  return (
    <div>
      <h3 className="text-foreground mb-2 text-sm font-medium">Pull Model</h3>
      <div className="border-border-medium rounded-md border p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="e.g. mlx-community/Llama-3.2-1B-Instruct-4bit"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handlePull()}
            disabled={pulling}
            className="flex-1 font-mono text-xs"
          />
          <Button
            onClick={handlePull}
            disabled={!modelId.trim() || pulling}
            size="sm"
          >
            {pulling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Pull
          </Button>
        </div>

        {pulling && progress && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10px]">
              <span className="text-muted truncate pr-2">{progress.fileName}</span>
              <span className="text-muted shrink-0">
                {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)} (
                {progressPct.toFixed(0)}%)
              </span>
            </div>
            <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
              <div
                className="bg-accent h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
          </div>
        )}

        {pulling && !progress && (
          <div className="text-muted mt-2 flex items-center gap-2 text-[10px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Starting download...
          </div>
        )}

        {pullError && (
          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {pullError}
          </div>
        )}

        <p className="text-muted mt-2 text-[10px]">
          Enter a HuggingFace model ID. MLX-format models recommended for Apple Silicon.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Section (collapsible)
// ---------------------------------------------------------------------------

function SetupSection({ onSetupComplete }: { onSetupComplete: () => void }) {
  const { api } = useAPI();
  const [expanded, setExpanded] = useState(false);
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [setupLog, setSetupLog] = useState<string[]>([]);

  const checkStatus = useCallback(async () => {
    if (!api) return;
    setChecking(true);
    try {
      const result = await (api as any).inferenceSetup.checkStatus();
      setSetupStatus(result as SetupStatus);
    } catch {
      // Silently fail — setup check is optional
    } finally {
      setChecking(false);
    }
  }, [api]);

  useEffect(() => {
    if (expanded && !setupStatus && !checking) {
      void checkStatus();
    }
  }, [expanded, setupStatus, checking, checkStatus]);

  const handleRunSetup = async () => {
    if (!api || running) return;
    setRunning(true);
    setSetupLog([]);
    try {
      const stream = await (api as any).inferenceSetup.runSetup();
      for await (const event of stream as AsyncIterable<SetupEvent>) {
        if (event.type === "phase") {
          setSetupLog((prev) => [...prev, `[${event.phase}] ${event.message}`]);
        } else if (event.type === "stdout" || event.type === "stderr") {
          setSetupLog((prev) => [...prev, event.data]);
        } else if (event.type === "result") {
          setSetupLog((prev) => [
            ...prev,
            event.success ? `Done: ${event.message}` : `Failed: ${event.message}`,
          ]);
        }
      }
      onSetupComplete();
    } catch (err) {
      setSetupLog((prev) => [
        ...prev,
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    } finally {
      setRunning(false);
      void checkStatus();
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-muted hover:text-foreground flex items-center gap-1 text-xs font-medium transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" />
        Environment Setup
      </button>

      {expanded && (
        <div className="border-border-medium mt-2 rounded-md border p-3">
          {checking ? (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="text-muted h-3.5 w-3.5 animate-spin" />
              <span className="text-muted">Checking environment...</span>
            </div>
          ) : setupStatus ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <StatusRow label="Go Binary" ok={setupStatus.goBinaryFound} />
                <StatusRow label="Go Installed" ok={setupStatus.goInstalled} />
                <StatusRow label="Source Repo" ok={setupStatus.sourceRepoFound} />
                <StatusRow label="Python" ok={setupStatus.systemPythonFound} />
                <StatusRow label="Venv" ok={setupStatus.venvExists} />
                <StatusRow label="Dependencies" ok={setupStatus.depsInstalled} />
                <StatusRow
                  label="Platform"
                  ok={setupStatus.platform === "apple-silicon"}
                  text={setupStatus.platform === "apple-silicon" ? "Apple Silicon" : setupStatus.platform}
                />
                <StatusRow
                  label="Backend"
                  ok={!!setupStatus.detectedBackend}
                  text={setupStatus.detectedBackend ? setupStatus.detectedBackend.toUpperCase() : "Not detected"}
                />
              </div>

              {setupStatus.error && (
                <div className="flex items-center gap-1.5 text-[10px] text-red-400">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {setupStatus.error}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleRunSetup}
                  disabled={running}
                  variant={setupStatus.inferenceAvailable ? "secondary" : "default"}
                >
                  {running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5" />
                  )}
                  {setupStatus.inferenceAvailable ? "Re-run Setup" : "Run Setup"}
                </Button>
                <Button size="sm" variant="ghost" onClick={checkStatus}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Re-check
                </Button>
              </div>

              {setupLog.length > 0 && (
                <pre className="bg-sidebar text-muted max-h-40 overflow-auto rounded p-2 font-mono text-[10px] leading-tight">
                  {setupLog.join("\n")}
                </pre>
              )}
            </div>
          ) : (
            <p className="text-muted text-xs">Click to check environment status.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function StatusRow({ label, ok, text }: { label: string; ok: boolean; text?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {ok ? (
        <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
      ) : (
        <XCircle className="h-3 w-3 shrink-0 text-red-400" />
      )}
      <span className="text-muted">{label}</span>
      {text && <span className="text-muted">{text}</span>}
    </div>
  );
}

function MemoryBar({ percent }: { percent: number }) {
  return (
    <div className="bg-border h-1.5 w-full overflow-hidden rounded-full">
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  const kb = bytes / 1024;
  return `${kb.toFixed(0)} KB`;
}
