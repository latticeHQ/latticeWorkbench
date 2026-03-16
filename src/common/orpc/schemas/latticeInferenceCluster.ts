import { z } from "zod";

export const LatticeInferenceClusterNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  /** Chip / accelerator name (e.g. "Apple M3 Ultra", "NVIDIA A100") */
  chipName: z.string(),
  /** Short chip family (e.g. "m3", "a100") for display badges */
  chipFamily: z.string(),
  /** Platform identifier (e.g. "macOS", "Linux") */
  platform: z.string(),
  gpuName: z.string(),
  gpuMemoryTotal: z.number(),
  gpuMemoryFree: z.number(),
  /** GPU utilization 0-100 */
  gpuUtilization: z.number(),
  /** GPU temperature in °C, null if unavailable */
  temperature: z.number().nullable(),
  /** Power draw in watts, null if unavailable */
  powerWatts: z.number().nullable(),
  /** CPU utilization 0-100, null if unavailable */
  cpuUtilization: z.number().nullable(),
  /** Connection type (e.g. "thunderbolt", "ethernet", "local", "rdma") */
  connectionType: z.string(),
  /** Network bandwidth in bytes/sec, null if unavailable */
  bandwidthBytesPerSec: z.number().nullable(),
  /** Tokens per second throughput */
  tokensPerSecond: z.number(),
  /** Whether this node is the local/self node */
  isLocal: z.boolean(),
  /** Memory pressure percentage 0-100 */
  memoryPressure: z.number().nullable(),
  /** Online status */
  online: z.boolean(),
  /** Last seen timestamp ISO */
  lastSeen: z.string(),
});

export const LatticeInferenceClusterModelSchema = z.object({
  modelId: z.string(),
  status: z.string(),
});

export const LatticeInferenceClusterStateSchema = z.object({
  nodes: z.array(LatticeInferenceClusterNodeSchema),
  models: z.array(LatticeInferenceClusterModelSchema),
  apiEndpoint: z.string(),
});

export const LatticeInferenceClusterStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("installed_not_running"), commandPath: z.string() }),
  z.object({ status: z.literal("running"), clusterState: LatticeInferenceClusterStateSchema }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
