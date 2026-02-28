import { EventEmitter } from "events";
import * as fs from "fs/promises";
import { log } from "@/node/services/log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExoNode {
  id: string;
  name: string;
  host: string;
  port: number;
  gpuName: string;
  gpuMemoryTotal: number;
  gpuMemoryFree: number;
}

export interface ExoModel {
  modelId: string;
  status: string;
}

export interface ExoClusterState {
  nodes: ExoNode[];
  models: ExoModel[];
  apiEndpoint: string;
}

export type ExoStatus =
  | { status: "not_installed" }
  | { status: "installed_not_running"; commandPath: string }
  | { status: "running"; clusterState: ExoClusterState }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const EXO_API_BASE = "http://localhost:52415";
const POLL_INTERVAL_MS = 3_000;
const FETCH_TIMEOUT_MS = 2_000;

/**
 * ExoService — detects, polls, and exposes exo cluster state.
 *
 * Lifecycle: poll starts when a subscriber exists, stops when all unsubscribe.
 * Emits "change" whenever the state differs from the previous snapshot.
 */
export class ExoService {
  private readonly changeEmitter = new EventEmitter();
  private currentState: ExoStatus = { status: "not_installed" };
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Detect + fetch cluster state. Main entry point. */
  async getState(): Promise<ExoStatus> {
    try {
      // 1. Try to reach the running exo API
      const clusterState = await this.fetchClusterState();
      if (clusterState) {
        this.currentState = { status: "running", clusterState };
        return this.currentState;
      }
    } catch {
      // Not running — fall through to detection
    }

    // 2. Check if exo-explore/exo repo is cloned (installed from source)
    try {
      const home = process.env.HOME ?? "";
      const repoPath = `${home}/.exo-cluster`;
      const pyproject = `${repoPath}/pyproject.toml`;
      const stat = await fs.stat(pyproject);
      if (stat.isFile()) {
        // commandPath is the repo directory — used with `cd <path> && uv run exo`
        this.currentState = {
          status: "installed_not_running",
          commandPath: repoPath,
        };
        return this.currentState;
      }
    } catch {
      // Not found — fall through
    }

    // 3. Fallback: check if exo is available as a standalone binary in PATH
    try {
      const { findCommandWithAliases } = await import("@/node/utils/commandDiscovery");
      const detection = await findCommandWithAliases("exo", undefined, [
        `${process.env.HOME ?? ""}/.local/bin/exo`,
        "/opt/homebrew/bin/exo",
        "/usr/local/bin/exo",
      ]);
      if (detection.found) {
        this.currentState = {
          status: "installed_not_running",
          commandPath: detection.resolvedCommand ?? "exo",
        };
        return this.currentState;
      }
    } catch (error) {
      log.debug("[ExoService] Detection failed:", error);
    }

    this.currentState = { status: "not_installed" };
    return this.currentState;
  }

  /** Start periodic polling. Ref-counted — only polls when subscribers exist. */
  startPolling(): void {
    this.subscriberCount++;
    if (this.pollInterval) return;

    this.pollInterval = setInterval(async () => {
      const prevJson = JSON.stringify(this.currentState);
      await this.getState();
      const nextJson = JSON.stringify(this.currentState);
      if (prevJson !== nextJson) {
        this.changeEmitter.emit("change");
      }
    }, POLL_INTERVAL_MS);
  }

  /** Decrement subscriber count. Stops polling when count reaches 0. */
  stopPolling(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0 && this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /** Subscribe to state changes. Returns unsubscribe function. */
  onChange(handler: () => void): () => void {
    this.changeEmitter.on("change", handler);
    return () => this.changeEmitter.off("change", handler);
  }

  /** Cleanup on app shutdown. */
  dispose(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.changeEmitter.removeAllListeners();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  /** Fetch and parse exo's /state and /v1/models endpoints. */
  private async fetchClusterState(): Promise<ExoClusterState | null> {
    const [stateResp, modelsResp] = await Promise.all([
      fetch(`${EXO_API_BASE}/state`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      fetch(`${EXO_API_BASE}/v1/models`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(
        () => null,
      ),
    ]);

    if (!stateResp.ok) return null;

    const stateData = (await stateResp.json()) as Record<string, unknown>;
    const nodes = this.parseNodes(stateData);

    let models: ExoModel[] = [];
    if (modelsResp?.ok) {
      const modelsData = (await modelsResp.json()) as Record<string, unknown>;
      models = this.parseModels(modelsData);
    }

    return { nodes, models, apiEndpoint: EXO_API_BASE };
  }

  /**
   * Parse nodes from exo's /state response.
   * Exo returns topology info with peer profiles — shape may vary by version,
   * so we extract defensively.
   */
  private parseNodes(data: Record<string, unknown>): ExoNode[] {
    const nodes: ExoNode[] = [];

    // exo's /state returns a topology object with peer_profiles
    const topology = data.topology as Record<string, unknown> | undefined;
    const peerProfiles =
      (topology?.peer_profiles as Record<string, unknown>[]) ??
      (data.peer_profiles as Record<string, unknown>[]) ??
      [];

    if (Array.isArray(peerProfiles)) {
      for (const peer of peerProfiles) {
        nodes.push({
          id: String(peer.id ?? peer.peer_id ?? "unknown"),
          name: String(peer.name ?? peer.hostname ?? "unknown"),
          host: String(peer.host ?? peer.address ?? "localhost"),
          port: Number(peer.port ?? 0),
          gpuName: String(peer.gpu_name ?? peer.device_name ?? "Unknown GPU"),
          gpuMemoryTotal: Number(peer.gpu_memory_total ?? peer.total_memory ?? 0),
          gpuMemoryFree: Number(peer.gpu_memory_free ?? peer.free_memory ?? 0),
        });
      }
    }

    // If no peers found but API responded, infer at least one local node
    if (nodes.length === 0) {
      nodes.push({
        id: "local",
        name: "Local Node",
        host: "localhost",
        port: 52415,
        gpuName: "Unknown",
        gpuMemoryTotal: 0,
        gpuMemoryFree: 0,
      });
    }

    return nodes;
  }

  /** Parse models from exo's /v1/models response (OpenAI-compatible format).
   *  The /v1/models endpoint lists all models the cluster *can* serve, not
   *  ones actively loaded in memory. Mark them as "available" by default. */
  private parseModels(data: Record<string, unknown>): ExoModel[] {
    const models: ExoModel[] = [];
    const dataArray = (data.data as Array<Record<string, unknown>>) ?? [];

    if (Array.isArray(dataArray)) {
      for (const model of dataArray) {
        models.push({
          modelId: String(model.id ?? "unknown"),
          status: String(model.status ?? "available"),
        });
      }
    }

    return models;
  }
}
