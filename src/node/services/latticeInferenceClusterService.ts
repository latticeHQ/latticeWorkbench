import { EventEmitter } from "events";
import { execFile } from "child_process";
import { promisify } from "util";
import { log } from "@/node/services/log";
import type { InferenceService } from "@/node/services/inference/inferenceService";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LatticeInferenceClusterNode {
  id: string;
  name: string;
  host: string;
  port: number;
  chipName: string;
  chipFamily: string;
  platform: string;
  gpuName: string;
  gpuMemoryTotal: number;
  gpuMemoryFree: number;
  gpuUtilization: number;
  temperature: number | null;
  powerWatts: number | null;
  cpuUtilization: number | null;
  connectionType: string;
  bandwidthBytesPerSec: number | null;
  tokensPerSecond: number;
  isLocal: boolean;
  online: boolean;
  lastSeen: string;
}

export interface LatticeInferenceClusterModel {
  modelId: string;
  status: string;
}

export interface LatticeInferenceClusterState {
  nodes: LatticeInferenceClusterNode[];
  models: LatticeInferenceClusterModel[];
  apiEndpoint: string;
}

export type LatticeInferenceClusterStatus =
  | { status: "not_installed" }
  | { status: "installed_not_running"; commandPath: string }
  | { status: "running"; clusterState: LatticeInferenceClusterState }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Real-time system metrics collection
// ---------------------------------------------------------------------------

interface SystemMetrics {
  cpuUtilization: number;
  gpuUtilization: number;
  temperature: number | null;
  powerWatts: number | null;
  memoryTotal: number;
  memoryFree: number;
  memoryPressure: number;
  chipName: string;
  chipFamily: string;
  gpuCores: number | null;
  cpuCores: number;
  uptime: number;
}

/** Snapshot of per-CPU idle ticks for delta computation */
let prevCpuTimes: Array<{ idle: number; total: number }> | null = null;
/** Timestamp of last CPU snapshot (ms) */
let prevCpuTimestamp = 0;
/** Cached last valid CPU utilization (returned while waiting for first delta) */
let lastCpuUtil = 0;

/**
 * Compute CPU utilization from os.cpus() deltas (0–100).
 * Requires at least 1 second between snapshots for accurate readings.
 * Returns cached value if called too soon after previous snapshot.
 */
function computeCpuUtilization(): number {
  const os = require("os") as typeof import("os");
  const now = Date.now();

  // Guard: if called within 1s of last snapshot, return cached value
  // This prevents inflated readings from rapid successive getState() calls
  if (prevCpuTimes && now - prevCpuTimestamp < 1000) {
    return lastCpuUtil;
  }

  const cpus = os.cpus();
  const current = cpus.map((c) => {
    const total = c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
    return { idle: c.times.idle, total };
  });

  if (!prevCpuTimes || prevCpuTimes.length !== current.length) {
    // First call — just store the snapshot, return 0 until we have a real delta
    prevCpuTimes = current;
    prevCpuTimestamp = now;
    return lastCpuUtil;
  }

  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i++) {
    idleDelta += current[i].idle - prevCpuTimes[i].idle;
    totalDelta += current[i].total - prevCpuTimes[i].total;
  }
  prevCpuTimes = current;
  prevCpuTimestamp = now;
  lastCpuUtil = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
  return lastCpuUtil;
}

/**
 * Get Apple Silicon chip details via sysctl.
 * Returns { chipName, chipFamily, gpuCores }.
 */
async function getAppleSiliconChipInfo(): Promise<{
  chipName: string;
  chipFamily: string;
  gpuCores: number | null;
}> {
  try {
    const { stdout: brand } = await execFileAsync("sysctl", ["-n", "machdep.cpu.brand_string"], { timeout: 2000 });
    const chipName = brand.trim(); // e.g. "Apple M3 Max"

    // Extract chip family
    const match = chipName.match(/\b(M[1-9]\d*)\b/i);
    const chipFamily = match ? match[1].toUpperCase() : "Apple Silicon";

    // Try to get GPU core count
    let gpuCores: number | null = null;
    try {
      const { stdout: gpuStr } = await execFileAsync("sysctl", ["-n", "hw.perflevel0.logicalcpu"], { timeout: 2000 });
      // On Apple Silicon, use ioreg for GPU cores
      const { stdout: ioregOut } = await execFileAsync("ioreg", ["-l", "-n", "AGXAccelerator"], { timeout: 3000 });
      const gpuMatch = ioregOut.match(/"gpu-core-count"\s*=\s*(\d+)/);
      if (gpuMatch) gpuCores = parseInt(gpuMatch[1], 10);
      // Fallback: try system_profiler (slower)
      if (!gpuCores) {
        // parse from the brand string if it contains Ultra/Max/Pro which have known core counts
        // This is just a best-effort fallback
        void gpuStr; // suppress unused
      }
    } catch {
      // GPU core detection failed, that's ok
    }

    return { chipName, chipFamily, gpuCores };
  } catch {
    return { chipName: "Apple Silicon", chipFamily: "Apple Silicon", gpuCores: null };
  }
}

/**
 * Get thermal, power, and GPU metrics via macOS system tools.
 * No sudo required — uses ioreg and sysctl.
 */
async function getThermalMetrics(): Promise<{
  temperature: number | null;
  powerWatts: number | null;
  gpuUtilization: number;
}> {
  let temperature: number | null = null;
  let powerWatts: number | null = null;
  let gpuUtilization = 0;

  // Collect GPU + thermal data in parallel
  const [gpuResult, thermalResult] = await Promise.allSettled([
    // GPU utilization via ioreg AGXAccelerator
    (async () => {
      try {
        const { stdout } = await execFileAsync("ioreg", ["-r", "-c", "AGXAccelerator"], { timeout: 3000 });
        // "gpu-busy-percent" or "Device Utilization %" in AGX stats
        const busyMatch = stdout.match(/"gpu-busy-percent"\s*=\s*(\d+)/i);
        if (busyMatch) return parseInt(busyMatch[1], 10);
        // Fallback: "Device Utilization %"
        const utilMatch = stdout.match(/"Device Utilization %"\s*=\s*(\d+)/i);
        if (utilMatch) return parseInt(utilMatch[1], 10);
        // Fallback: "gpu-active-residency" as a percentage
        const residMatch = stdout.match(/"gpu-active-residency"\s*=\s*(\d+)/i);
        if (residMatch) return Math.min(100, parseInt(residMatch[1], 10));
      } catch { /* no GPU data */ }
      return 0;
    })(),
    // Temperature + power via ioreg and sysctl
    (async () => {
      let temp: number | null = null;
      let power: number | null = null;

      // Try ioreg thermal sensors
      try {
        const { stdout } = await execFileAsync("ioreg", ["-r", "-n", "AppleARMIODevice", "-l"], { timeout: 3000 });
        const tempMatch = stdout.match(/"Temperature"\s*=\s*(\d+)/);
        if (tempMatch) {
          const raw = parseInt(tempMatch[1], 10);
          temp = raw > 1000 ? raw / 100 : raw;
        }
      } catch { /* */ }

      // Try sysctl thermal level as fallback
      if (temp == null) {
        try {
          const { stdout } = await execFileAsync("sysctl", ["-n", "machdep.xcpm.cpu_thermal_level"], { timeout: 2000 });
          const level = parseInt(stdout.trim(), 10);
          if (!isNaN(level)) temp = 35 + (level * 0.5);
        } catch { /* */ }
      }

      return { temp, power };
    })(),
  ]);

  if (gpuResult.status === "fulfilled") gpuUtilization = gpuResult.value;
  if (thermalResult.status === "fulfilled") {
    temperature = thermalResult.value.temp;
    powerWatts = thermalResult.value.power;
  }

  return { temperature, powerWatts, gpuUtilization };
}

/**
 * Get memory pressure on macOS (percentage of memory under pressure).
 */
async function getMemoryPressure(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("memory_pressure", [], { timeout: 3000 });
    // Output: "System-wide memory free percentage: 42%"
    const match = stdout.match(/free percentage:\s*(\d+)%/);
    if (match) return 100 - parseInt(match[1], 10); // convert free→used pressure
  } catch {
    // Fallback: compute from os
  }
  const os = require("os") as typeof import("os");
  const total = os.totalmem();
  const free = os.freemem();
  return total > 0 ? Math.round(((total - free) / total) * 100) : 0;
}

/** Cached chip info (doesn't change between polls) */
let cachedChipInfo: { chipName: string; chipFamily: string; gpuCores: number | null } | null = null;

/**
 * Collect all real-time system metrics for the local machine.
 */
async function collectLocalMetrics(): Promise<SystemMetrics> {
  const os = require("os") as typeof import("os");
  const isDarwinArm = process.platform === "darwin" && process.arch === "arm64";

  // Get chip info (cached after first call)
  if (!cachedChipInfo) {
    cachedChipInfo = isDarwinArm
      ? await getAppleSiliconChipInfo()
      : { chipName: process.arch, chipFamily: process.arch, gpuCores: null };
  }

  // Collect metrics in parallel
  const cpuUtilization = computeCpuUtilization();

  const [thermalMetrics, memPressure] = await Promise.all([
    isDarwinArm ? getThermalMetrics() : Promise.resolve({ temperature: null, powerWatts: null, gpuUtilization: 0 }),
    isDarwinArm ? getMemoryPressure() : Promise.resolve(0),
  ]);

  return {
    cpuUtilization,
    gpuUtilization: thermalMetrics.gpuUtilization,
    temperature: thermalMetrics.temperature,
    powerWatts: thermalMetrics.powerWatts,
    memoryTotal: os.totalmem(),
    memoryFree: os.freemem(),
    memoryPressure: memPressure,
    chipName: cachedChipInfo.chipName,
    chipFamily: cachedChipInfo.chipFamily,
    gpuCores: cachedChipInfo.gpuCores,
    cpuCores: os.cpus().length,
    uptime: os.uptime(),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;

/**
 * LatticeInferenceClusterService — alternate clustering provider that wraps the
 * existing InferenceService's cluster capabilities (latticeinference Go binary).
 *
 * Mirrors ExoService's public API so the UI can treat both clustering backends
 * interchangeably.
 *
 * Lifecycle: poll starts when a subscriber exists, stops when all unsubscribe.
 * Emits "change" whenever the state differs from the previous snapshot.
 */
export class LatticeInferenceClusterService {
  private readonly changeEmitter = new EventEmitter();
  private currentState: LatticeInferenceClusterStatus = { status: "not_installed" };
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;

  constructor(private readonly inferenceService: InferenceService) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Detect + fetch cluster state. Main entry point. */
  async getState(): Promise<LatticeInferenceClusterStatus> {
    try {
      // 1. If inference service is available and running, query cluster state
      if (this.inferenceService.isAvailable) {
        const clusterNodes = await this.inferenceService.getClusterNodes();
        const models = await this.inferenceService.listModels();

        // Collect real-time local metrics for enriching nodes
        const localMetrics = await collectLocalMetrics();

        const nodes: LatticeInferenceClusterNode[] = clusterNodes.map((n) => {
          // Extended fields may be present from Go binary but not in TS ClusterNode type
          const ext = n as unknown as Record<string, unknown>;
          const chipName = (ext.chip_name as string) ?? n.gpu_type ?? localMetrics.chipName;
          const isLocal = (ext.is_local as boolean) ?? (n.address.startsWith("127.") || n.address.startsWith("localhost"));
          return {
            id: n.id,
            name: n.name,
            host: n.address.split(":")[0] || "localhost",
            port: parseInt(n.address.split(":")[1] || "0", 10),
            chipName,
            chipFamily: inferChipFamily(chipName),
            platform: (ext.platform as string) ?? (process.platform === "darwin" ? "macOS" : "Linux"),
            gpuName: n.gpu_type || (process.arch === "arm64" ? "Unified Memory" : "Unknown"),
            gpuMemoryTotal: n.total_memory_bytes || (isLocal ? localMetrics.memoryTotal : 0),
            gpuMemoryFree: n.total_memory_bytes
              ? n.total_memory_bytes - n.used_memory_bytes
              : isLocal ? localMetrics.memoryFree : 0,
            gpuUtilization: (ext.gpu_utilization as number) ?? (isLocal ? localMetrics.gpuUtilization : 0),
            temperature: (ext.temperature as number) ?? (isLocal ? localMetrics.temperature : null),
            powerWatts: (ext.power_watts as number) ?? (isLocal ? localMetrics.powerWatts : null),
            cpuUtilization: (ext.cpu_utilization as number) ?? (isLocal ? localMetrics.cpuUtilization : null),
            connectionType: (ext.connection_type as string) ?? "local",
            bandwidthBytesPerSec: (ext.bandwidth_bytes_per_sec as number) ?? null,
            tokensPerSecond: n.tokens_per_second_avg ?? 0,
            isLocal,
            online: !n.status || n.status === "healthy" || n.status === "running" || n.status === "idle" || n.status === "active" || n.status === "ok",
            lastSeen: n.last_heartbeat ?? new Date().toISOString(),
          };
        });

        const clusterModels: LatticeInferenceClusterModel[] = models.map((m) => ({
          modelId: m.id,
          status: "available",
        }));

        // If no nodes from cluster API, add self as local node with real metrics
        if (nodes.length === 0) {
          const os = require("os") as typeof import("os");
          nodes.push({
            id: "local",
            name: os.hostname(),
            host: "localhost",
            port: 0,
            chipName: localMetrics.chipName,
            chipFamily: localMetrics.chipFamily,
            platform: process.platform === "darwin" ? "macOS" : "Linux",
            gpuName: process.arch === "arm64" ? "Unified Memory" : "Unknown",
            gpuMemoryTotal: localMetrics.memoryTotal,
            gpuMemoryFree: localMetrics.memoryFree,
            gpuUtilization: localMetrics.gpuUtilization,
            temperature: localMetrics.temperature,
            powerWatts: localMetrics.powerWatts,
            cpuUtilization: localMetrics.cpuUtilization,
            connectionType: "local",
            bandwidthBytesPerSec: null,
            tokensPerSecond: 0,
            isLocal: true,
            online: true,
            lastSeen: new Date().toISOString(),
          });
        }

        this.currentState = {
          status: "running",
          clusterState: {
            nodes,
            models: clusterModels,
            apiEndpoint: "http://localhost:8392",
          },
        };
        return this.currentState;
      }
    } catch {
      // Not running — fall through to detection
    }

    // 2. Check if binary exists but service isn't running
    try {
      const { getInferredBinaryPath } = await import(
        "@/node/services/inference/inferredBinaryPath"
      );
      const binaryPath = getInferredBinaryPath();
      if (binaryPath) {
        this.currentState = {
          status: "installed_not_running",
          commandPath: binaryPath,
        };
        return this.currentState;
      }
    } catch {
      // Not found — fall through
    }

    // 3. Fallback: check common paths
    try {
      const fs = await import("fs/promises");
      const home = process.env.HOME ?? "";
      const paths = [
        `${home}/.lattice/bin/latticeinference`,
        "/opt/homebrew/bin/latticeinference",
        "/usr/local/bin/latticeinference",
      ];
      for (const p of paths) {
        try {
          const stat = await fs.stat(p);
          if (stat.isFile()) {
            this.currentState = {
              status: "installed_not_running",
              commandPath: p,
            };
            return this.currentState;
          }
        } catch {
          continue;
        }
      }
    } catch {
      log.debug("[LatticeInferenceCluster] Detection failed");
    }

    this.currentState = { status: "not_installed" };
    return this.currentState;
  }

  /** Start periodic polling. Ref-counted — only polls when subscribers exist. */
  startPolling(): void {
    this.subscriberCount++;
    if (this.pollInterval) return;

    // Emit immediately on first poll
    void this.getState().then(() => this.changeEmitter.emit("change"));

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
    prevCpuTimes = null;
    prevCpuTimestamp = 0;
    lastCpuUtil = 0;
    cachedChipInfo = null;
  }
}

/** Derive a short chip family string from a full chip name. */
function inferChipFamily(chipName: string): string {
  if (!chipName) return "unknown";
  const lower = chipName.toLowerCase();
  // Apple Silicon with specific chip (M1, M2, M3, M4, etc.)
  const appleMatch = lower.match(/\b(m[1-9]\d*)\b/);
  if (appleMatch) return appleMatch[1].toUpperCase();
  // Generic "Apple Silicon" without specific chip number
  if (lower.includes("apple")) return "Apple Silicon";
  // NVIDIA
  const nvidiaMatch = lower.match(/\b(a100|h100|h200|l40s?|rtx\s*\d+|v100|t4|a[46]000)\b/);
  if (nvidiaMatch) return nvidiaMatch[1].replace(/\s+/g, "").toUpperCase();
  // AMD
  const amdMatch = lower.match(/\b(mi\d+x?|rx\s*\d+)\b/);
  if (amdMatch) return amdMatch[1].replace(/\s+/g, "").toUpperCase();
  // Fallback: use full name if short, otherwise first word
  if (chipName.length <= 12) return chipName;
  return chipName.split(/\s+/)[0];
}
