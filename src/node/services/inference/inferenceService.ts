/**
 * Inference Service — Top-level orchestrator for local on-device inference.
 *
 * Manages the `latticeinference` Go binary subprocess which in turn manages:
 * - Python worker pool (multi-model with LRU eviction)
 * - Cluster coordination (node discovery, heartbeat, routing)
 * - Prometheus metrics
 * - OpenAI-compatible HTTP API
 *
 * The Go binary is the source of truth for model state. This service
 * spawns it, health-checks it, and proxies requests from ORPC/UI.
 *
 * Architecture: Node.js (UI/ORPC) → Go binary (pool/cluster/metrics) → Python workers (inference)
 */

import { EventEmitter } from "events";
import * as os from "os";
import * as path from "path";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { InferredProcessManager } from "./inferredProcessManager";
import { InferredHttpClient } from "./inferredHttpClient";
import { HfDownloader } from "./hfDownloader";
import { LatticeLanguageModel } from "./latticeLanguageModel";
import { getInferredBinaryPath } from "./inferredBinaryPath";
import { detectPython } from "./backendDetection";
import type {
  DownloadProgress,
  ModelInfo,
  InferredStatusResponse,
  LoadedModelInfo,
  ClusterState,
  ClusterNode,
} from "./types";
import { log } from "@/node/services/log";

export interface InferenceServiceEvents {
  "model-loaded": [modelId: string];
  "model-unloaded": [];
  "download-progress": [progress: DownloadProgress];
  error: [error: Error];
}

export class InferenceService extends EventEmitter {
  private processManager: InferredProcessManager | null = null;
  private httpClient: InferredHttpClient | null = null;
  private downloader: HfDownloader;
  private languageModels: Map<string, LatticeLanguageModel> = new Map();
  private _available = false;
  private _loadedModelId: string | null = null;
  private rootDir: string;
  private appResourcesPath?: string;

  constructor(rootDir: string, appResourcesPath?: string) {
    super();
    this.setMaxListeners(500);
    this.rootDir = rootDir;
    this.appResourcesPath = appResourcesPath;
    const cacheDir = path.join(os.homedir(), ".lattice", "models");
    this.downloader = new HfDownloader(cacheDir);
  }

  /**
   * Initialize: spawn the Go binary and wait for it to become healthy.
   */
  async initialize(): Promise<void> {
    try {
      const binaryPath = getInferredBinaryPath(this.appResourcesPath);
      const pythonPath = detectPython();

      this.processManager = new InferredProcessManager(binaryPath, {
        pythonPath,
        modelDir: path.join(os.homedir(), ".lattice", "models"),
      });

      // Auto-restart on crash
      this.processManager.on("crashed", () => {
        log.warn("[inference] Go binary crashed, will restart on next request");
        this._available = false;
      });

      await this.processManager.start();
      this.httpClient = new InferredHttpClient(this.processManager.baseUrl);
      this._available = true;

      log.info(
        `[inference] initialized: binary=${binaryPath}, python=${pythonPath}, port=${this.processManager.port}`,
      );
    } catch (err) {
      this._available = false;
      log.warn(`[inference] Go binary not available: ${err}`);
    }
  }

  /**
   * Whether the Go inference binary is running and healthy.
   */
  get isAvailable(): boolean {
    return this._available && (this.processManager?.alive ?? false);
  }

  /**
   * The primary loaded model ID (for backward compat with single-model UI).
   * With the pool, multiple models can be loaded simultaneously.
   */
  get loadedModelId(): string | null {
    return this._loadedModelId;
  }

  // ─── Model Registry (via Go binary) ──────────────────────────────────

  /**
   * List all cached models (from Go binary's registry).
   */
  async listModels(): Promise<ModelInfo[]> {
    await this.ensureRunning();
    const status = await this.httpClient!.getStatus();
    return (status.cached_models ?? []).map(this.normalizeModelInfo);
  }

  /**
   * Delete a cached model.
   * Note: Go binary unloads it from pool automatically if loaded.
   */
  async deleteModel(id: string): Promise<void> {
    await this.ensureRunning();
    // Unload from pool if loaded
    const status = await this.httpClient!.getStatus();
    const isLoaded = status.loaded_models.some((m) => m.model_id === id);
    if (isLoaded) {
      await this.httpClient!.unloadModel(id);
    }
    // Delete from disk — delegate to Go binary or do it locally
    // For now, the Go registry handles this via the model dir
    // TODO: Add DELETE /inference/models/:id endpoint to Go binary
    this.languageModels.delete(id);

    if (this._loadedModelId === id) {
      this._loadedModelId = null;
      this.emit("model-unloaded");
    }
  }

  // ─── Model Download ─────────────────────────────────────────────────

  /**
   * Pull (download) a model from HuggingFace Hub.
   * Uses the Node.js downloader for better progress events.
   */
  async pullModel(modelID: string, signal?: AbortSignal): Promise<string> {
    const onProgress = (progress: DownloadProgress) => {
      this.emit("download-progress", progress);
    };

    this.downloader.on("progress", onProgress);

    try {
      const modelDir = await this.downloader.pull(modelID, signal);
      log.info(`[inference] pulled model ${modelID} → ${modelDir}`);
      return modelDir;
    } finally {
      this.downloader.off("progress", onProgress);
    }
  }

  // ─── Model Loading (via Go pool) ────────────────────────────────────

  /**
   * Load a model into the Go binary's worker pool.
   * The pool handles LRU eviction and multi-model management.
   */
  async loadModel(modelID: string, _backend?: string): Promise<void> {
    await this.ensureRunning();

    // Check if model exists locally, pull if not
    const status = await this.httpClient!.getStatus();
    const cached = status.cached_models?.find(
      (m) => m.id === modelID || m.name === modelID,
    );

    if (!cached) {
      log.info(`[inference] model ${modelID} not found locally, pulling...`);
      await this.pullModel(modelID);
    }

    await this.httpClient!.loadModel(modelID);
    this._loadedModelId = modelID;

    log.info(`[inference] model loaded: ${modelID}`);
    this.emit("model-loaded", modelID);
  }

  /**
   * Unload the current model from the Go binary's pool.
   */
  async unloadModel(modelId?: string): Promise<void> {
    const target = modelId ?? this._loadedModelId;
    if (!this.httpClient || !target) return;

    try {
      await this.httpClient.unloadModel(target);
    } catch {
      // May already be unloaded
    }

    this.languageModels.delete(target);
    if (this._loadedModelId === target) {
      this._loadedModelId = null;
    }

    log.info("[inference] model unloaded: %s", target);
    this.emit("model-unloaded");
  }

  // ─── Language Model (AI SDK bridge) ─────────────────────────────────

  /**
   * Get the LanguageModelV2 for the given model.
   * Uses the Go binary's OpenAI-compatible API under the hood.
   */
  getLanguageModel(modelId?: string): LanguageModelV2 {
    const id = modelId ?? this._loadedModelId;
    if (!id) {
      throw new Error("No model loaded. Call loadModel() first.");
    }

    if (!this.httpClient) {
      throw new Error("Inference service not initialized.");
    }

    // Cache language model instances
    let lm = this.languageModels.get(id);
    if (!lm) {
      lm = new LatticeLanguageModel(id, this.httpClient);
      this.languageModels.set(id, lm);
    }

    return lm;
  }

  // ─── Pool Status (Phase 2) ──────────────────────────────────────────

  /**
   * Get the worker pool status from the Go binary.
   */
  async getPoolStatus(): Promise<{
    loadedModels: LoadedModelInfo[];
    modelsLoaded: number;
    maxLoadedModels: number;
    memoryBudgetBytes: number;
    estimatedVramBytes: number;
  }> {
    await this.ensureRunning();
    const status = await this.httpClient!.getStatus();
    return {
      loadedModels: status.loaded_models,
      modelsLoaded: status.models_loaded,
      maxLoadedModels: status.max_loaded_models,
      memoryBudgetBytes: status.memory_budget_bytes,
      estimatedVramBytes: status.estimated_vram_bytes,
    };
  }

  // ─── Cluster (Phase 3) ──────────────────────────────────────────────

  async getClusterStatus(): Promise<ClusterState | null> {
    if (!this.httpClient) return null;
    return this.httpClient.getClusterStatus();
  }

  async getClusterNodes(): Promise<ClusterNode[]> {
    if (!this.httpClient) return [];
    return this.httpClient.getClusterNodes();
  }

  // ─── Metrics (Phase 2) ──────────────────────────────────────────────

  async getMetrics(): Promise<string> {
    if (!this.httpClient) return "";
    return this.httpClient.getMetrics();
  }

  // ─── RDMA / Transport (Phase 4+6) ──────────────────────────────────

  async getRdmaStatus() {
    if (!this.httpClient) return null;
    return this.httpClient.getRdmaStatus();
  }

  async getTransportStatus() {
    if (!this.httpClient) return null;
    return this.httpClient.getTransportStatus();
  }

  // ─── Benchmark ─────────────────────────────────────────────────────

  async runBenchmark(modelId?: string): Promise<{
    model: string;
    completion_tokens: number;
    total_time_ms: number;
    time_to_first_token_ms: number;
    tokens_per_second: number;
    peak_memory_bytes: number;
  }> {
    if (!this.httpClient) {
      throw new Error("Inference service not available");
    }
    return this.httpClient.runBenchmark(modelId);
  }

  // ─── Internal Helpers ───────────────────────────────────────────────

  private async ensureRunning(): Promise<void> {
    if (!this.processManager) {
      throw new Error("InferenceService not initialized. Call initialize() first.");
    }
    if (!this.processManager.alive) {
      await this.processManager.start();
      this.httpClient = new InferredHttpClient(this.processManager.baseUrl);
      this._available = true;
    }
  }

  private normalizeModelInfo(m: ModelInfo): ModelInfo {
    return {
      id: m.id ?? m.name,
      name: m.name ?? m.id,
      huggingFaceRepo: m.huggingFaceRepo,
      format: m.format ?? "unknown",
      sizeBytes: m.sizeBytes ?? 0,
      parameterCount: m.parameterCount,
      quantization: m.quantization,
      localPath: m.localPath ?? "",
      backend: m.backend,
      pulledAt: m.pulledAt,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Dispose all resources. Called on app shutdown.
   */
  async dispose(): Promise<void> {
    if (this.processManager) {
      await this.processManager.stop();
      this.processManager = null;
    }
    this.httpClient = null;
    this._available = false;
    this._loadedModelId = null;
    this.languageModels.clear();
    log.info("[inference] service disposed");
  }
}
