/**
 * ModelsTab — Local model management panel for RightSidebar.
 *
 * Provides pull/download, load/unload, delete, and benchmark controls
 * for on-device inference models directly in the sidebar.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Timer,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { useInference } from "@/browser/hooks/useInference";
import { cn } from "@/common/lib/utils";

interface ModelsTabProps {
  workspaceId: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SectionHeader({
  children,
  icon,
  action,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-muted flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest">
        {icon}
        {children}
      </div>
      {action}
    </div>
  );
}

export const ModelsTab: React.FC<ModelsTabProps> = () => {
  const {
    status: inferenceStatus,
    models: localModels,
    loading: localLoading,
    pulling,
    downloadProgress,
    poolStatus,
    lastError: inferenceError,
    lastSuccess: inferenceSuccess,
    pullModel,
    deleteModel: deleteLocalModel,
    loadModel,
    unloadModel,
    runBenchmark,
    clearMessages: clearInferenceMessages,
    refreshModels,
    refreshPoolStatus,
  } = useInference();

  const [modelIdInput, setModelIdInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<{
    tokensPerSecond: number;
    timeToFirstToken: number;
    totalTime: number;
  } | null>(null);

  // Auto-dismiss success messages after 4 seconds
  useEffect(() => {
    if (!inferenceSuccess) return;
    const timer = setTimeout(() => clearInferenceMessages(), 4000);
    return () => clearTimeout(timer);
  }, [inferenceSuccess, clearInferenceMessages]);

  const progressPercent =
    downloadProgress && downloadProgress.totalBytes > 0
      ? Math.round((downloadProgress.downloadedBytes / downloadProgress.totalBytes) * 100)
      : 0;

  const handlePullModel = async () => {
    const id = modelIdInput.trim();
    if (!id) return;
    await pullModel(id);
    setModelIdInput("");
  };

  const handleLoadModel = async (modelId: string) => {
    setActionLoading(modelId);
    try {
      await loadModel(modelId);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnloadModel = async () => {
    setActionLoading("__unload__");
    try {
      await unloadModel();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteLocalModel = async (modelId: string) => {
    setActionLoading(modelId);
    try {
      await deleteLocalModel(modelId);
    } finally {
      setActionLoading(null);
      setConfirmDelete(null);
    }
  };

  const handleRunBenchmark = async (modelId: string) => {
    setBenchmarking(true);
    setBenchmarkResult(null);
    try {
      const result = await runBenchmark(modelId);
      setBenchmarkResult({
        tokensPerSecond: result.tokens_per_second,
        timeToFirstToken: result.time_to_first_token_ms,
        totalTime: result.total_time_ms,
      });
    } catch {
      // Benchmark failed
    } finally {
      setBenchmarking(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="text-muted h-4 w-4" />
          <span className="text-foreground text-xs font-bold uppercase tracking-widest">
            Models
          </span>
        </div>
        <button
          type="button"
          className="text-muted hover:text-foreground transition-colors"
          onClick={() => {
            void refreshModels();
            void refreshPoolStatus();
          }}
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Status ────────────────────────────────────────────────── */}
      <div className="border-border-medium bg-background-secondary/30 flex items-center gap-2 rounded-lg border px-3 py-2">
        {inferenceStatus?.available ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-foreground text-[11px] font-semibold">Backend Ready</div>
              {inferenceStatus.loadedModelId && (
                <div className="text-muted text-[9px] truncate">
                  Active:{" "}
                  <span className="text-foreground font-medium">
                    {inferenceStatus.loadedModelId}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : inferenceStatus ? (
          <>
            <XCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            <div className="text-muted text-[10px]">
              Not available. Install Python 3 +{" "}
              <code className="bg-background rounded px-0.5 text-[9px]">mlx mlx-lm</code>
            </div>
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted shrink-0" />
            <span className="text-muted text-[10px]">Checking...</span>
          </>
        )}
      </div>

      {/* ── Error/Success Messages ────────────────────────────────── */}
      {inferenceError && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5">
          <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />
          <span className="min-w-0 flex-1 text-[10px] text-red-400">{inferenceError}</span>
          <button
            onClick={clearInferenceMessages}
            className="shrink-0 text-[10px] text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}
      {inferenceSuccess && !inferenceError && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-2.5 py-1.5">
          <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
          <span className="min-w-0 flex-1 text-[10px] text-green-400">{inferenceSuccess}</span>
        </div>
      )}

      {/* ── Pull Model ───────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <SectionHeader icon={<Download className="h-3 w-3" />}>Pull Model</SectionHeader>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={modelIdInput}
            onChange={(e) => setModelIdInput(e.target.value)}
            placeholder="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
            className="bg-background border-border-medium focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 font-mono text-[10px] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !pulling) void handlePullModel();
            }}
            disabled={pulling}
          />
          <Button
            size="sm"
            onClick={() => void handlePullModel()}
            disabled={pulling || !modelIdInput.trim()}
            className="h-6 shrink-0 gap-1 px-2 text-[10px]"
          >
            {pulling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Pull
          </Button>
        </div>

        {/* Download Progress */}
        {pulling && downloadProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] text-muted">
              <span className="truncate">{downloadProgress.fileName}</span>
              <span>
                {formatBytes(downloadProgress.downloadedBytes)} /{" "}
                {formatBytes(downloadProgress.totalBytes)} ({progressPercent}%)
              </span>
            </div>
            <div className="bg-background h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Local Models List ─────────────────────────────────────── */}
      <div className="space-y-1.5">
        <SectionHeader icon={<HardDrive className="h-3 w-3" />}>
          Local · {localModels.length}
        </SectionHeader>

        {localLoading ? (
          <div className="text-muted flex items-center gap-2 py-3 text-[10px]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading models...
          </div>
        ) : localModels.length > 0 ? (
          <div className="space-y-1">
            {localModels.map((model) => {
              const isActive = inferenceStatus?.loadedModelId === model.id;
              const isThisLoading = actionLoading === model.id;

              return (
                <div
                  key={model.id}
                  className={cn(
                    "border-border-medium rounded-lg border p-2",
                    isActive && "border-green-500/30 bg-green-500/5"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="text-muted h-3 w-3 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span
                          className="text-foreground text-[10px] font-medium truncate"
                          title={model.id}
                        >
                          {model.name}
                        </span>
                        {isActive && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                        )}
                      </div>
                      <div className="text-muted text-[8px]">
                        {model.format.toUpperCase()} · {formatBytes(model.sizeBytes)}
                        {model.quantization ? ` · ${model.quantization}` : ""}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {isActive ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => void handleUnloadModel()}
                          disabled={actionLoading === "__unload__"}
                          title="Unload model"
                        >
                          {actionLoading === "__unload__" ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Square className="h-2.5 w-2.5" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => void handleLoadModel(model.id)}
                          disabled={isThisLoading}
                          title="Load model"
                        >
                          {isThisLoading ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            <Play className="h-2.5 w-2.5" />
                          )}
                        </Button>
                      )}

                      {confirmDelete === model.id ? (
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-[8px] text-red-500 hover:text-red-600"
                            onClick={() => void handleDeleteLocalModel(model.id)}
                            disabled={isThisLoading}
                          >
                            Yes
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1 text-[8px]"
                            onClick={() => setConfirmDelete(null)}
                          >
                            No
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => setConfirmDelete(model.id)}
                          disabled={isActive}
                          title={isActive ? "Unload first" : "Delete model"}
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-muted border-border-medium rounded-lg border px-3 py-3 text-center text-[10px]">
            No local models. Pull from HuggingFace above.
          </div>
        )}
      </div>

      {/* ── Pool Status ──────────────────────────────────────────── */}
      {poolStatus && poolStatus.modelsLoaded > 0 && (
        <div className="space-y-1.5">
          <SectionHeader
            icon={<Cpu className="h-3 w-3" />}
            action={
              <span className="text-muted text-[9px]">
                {poolStatus.modelsLoaded}/{poolStatus.maxLoadedModels} loaded ·{" "}
                {formatBytes(poolStatus.estimatedVramBytes)} VRAM
              </span>
            }
          >
            Pool
          </SectionHeader>

          {/* VRAM bar */}
          {poolStatus.memoryBudgetBytes > 0 && (
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9px] text-muted">
                <span>VRAM</span>
                <span>
                  {Math.round((poolStatus.estimatedVramBytes / poolStatus.memoryBudgetBytes) * 100)}
                  %
                </span>
              </div>
              <div className="bg-background h-1.5 overflow-hidden rounded-full">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    poolStatus.estimatedVramBytes / poolStatus.memoryBudgetBytes > 0.9
                      ? "bg-red-500"
                      : poolStatus.estimatedVramBytes / poolStatus.memoryBudgetBytes > 0.7
                        ? "bg-yellow-500"
                        : "bg-blue-500"
                  )}
                  style={{
                    width: `${Math.min(100, Math.round((poolStatus.estimatedVramBytes / poolStatus.memoryBudgetBytes) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            {poolStatus.loadedModels.map((m) => (
              <div
                key={m.model_id}
                className="border-border-medium flex items-center gap-2 rounded border px-2 py-1 text-[9px]"
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                    m.alive ? "bg-green-500" : "bg-yellow-500"
                  )}
                />
                <span
                  className="text-foreground flex-1 truncate font-mono font-medium"
                  title={m.model_id}
                >
                  {m.model_id.split("/").pop() ?? m.model_id}
                </span>
                <span className="text-muted">{m.backend}</span>
                <span className="text-muted">{formatBytes(m.estimated_bytes)}</span>
                <span className="text-muted">×{m.use_count}</span>
                {m.last_used_at && <span className="text-muted">{timeAgo(m.last_used_at)}</span>}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 shrink-0 p-0"
                  onClick={() => {
                    setActionLoading(`__unload__${m.model_id}`);
                    void unloadModel(m.model_id).finally(() => setActionLoading(null));
                  }}
                  disabled={actionLoading === `__unload__${m.model_id}`}
                  title={`Unload ${m.model_id}`}
                >
                  {actionLoading === `__unload__${m.model_id}` ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Square className="h-2.5 w-2.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Benchmark ────────────────────────────────────────────── */}
      {inferenceStatus?.available && inferenceStatus.loadedModelId && (
        <div className="space-y-1.5">
          <SectionHeader
            icon={<Timer className="h-3 w-3" />}
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-5 gap-1 px-1.5 text-[9px]"
                onClick={() => void handleRunBenchmark(inferenceStatus.loadedModelId!)}
                disabled={benchmarking}
              >
                {benchmarking ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Play className="h-2.5 w-2.5" />
                )}
                {benchmarking ? "Running..." : "Run"}
              </Button>
            }
          >
            Benchmark
          </SectionHeader>

          {benchmarkResult && (
            <div className="grid grid-cols-3 gap-1.5">
              <div className="bg-background-secondary rounded-md px-2 py-1.5">
                <div className="text-[8px] text-muted uppercase">tok/s</div>
                <div className="text-foreground text-xs font-bold">
                  {benchmarkResult.tokensPerSecond.toFixed(1)}
                </div>
              </div>
              <div className="bg-background-secondary rounded-md px-2 py-1.5">
                <div className="text-[8px] text-muted uppercase">TTFT</div>
                <div className="text-foreground text-xs font-bold">
                  {benchmarkResult.timeToFirstToken.toFixed(0)}ms
                </div>
              </div>
              <div className="bg-background-secondary rounded-md px-2 py-1.5">
                <div className="text-[8px] text-muted uppercase">Total</div>
                <div className="text-foreground text-xs font-bold">
                  {(benchmarkResult.totalTime / 1000).toFixed(2)}s
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
