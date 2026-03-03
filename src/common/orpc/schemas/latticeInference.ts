import { z } from "zod";

// ─── Model Info ─────────────────────────────────────────────────────

export const LatticeModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  huggingFaceRepo: z.string().optional(),
  format: z.enum(["mlx", "gguf", "pytorch", "unknown"]),
  sizeBytes: z.number(),
  parameterCount: z.number().optional(),
  quantization: z.string().optional(),
  localPath: z.string(),
  backend: z.string().optional(),
  pulledAt: z.string().optional(),
});

export const LoadedModelInfoSchema = z.object({
  model_id: z.string(),
  model_path: z.string(),
  backend: z.string(),
  alive: z.boolean(),
  estimated_bytes: z.number(),
  loaded_at: z.string(),
  last_used_at: z.string(),
  use_count: z.number(),
});

// ─── Status ─────────────────────────────────────────────────────────

export const LatticeInferenceStatusSchema = z.object({
  available: z.boolean(),
  loadedModelId: z.string().nullable(),
  cachedModels: z.array(LatticeModelInfoSchema),
  loadedModels: z.array(LoadedModelInfoSchema),
  modelsLoaded: z.number(),
  maxLoadedModels: z.number(),
  memoryBudgetBytes: z.number(),
  estimatedVramBytes: z.number(),
});

// ─── Download Progress ──────────────────────────────────────────────

export const DownloadProgressSchema = z.object({
  fileName: z.string(),
  downloadedBytes: z.number(),
  totalBytes: z.number(),
});

// ─── Cluster ────────────────────────────────────────────────────────

export const ClusterNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  joined_at: z.string(),
  loaded_models: z.array(z.string()),
  backend: z.string(),
  max_models: z.number(),
  total_memory_bytes: z.number(),
  used_memory_bytes: z.number(),
  gpu_type: z.string(),
  active_inferences: z.number(),
  tokens_per_second_avg: z.number(),
  last_heartbeat: z.string(),
  status: z.string(),
});

export const ClusterStateSchema = z.object({
  nodes: z.array(ClusterNodeSchema),
  total_models: z.number(),
  total_nodes: z.number(),
  updated_at: z.string(),
});

// ─── Benchmark ──────────────────────────────────────────────────────

export const BenchmarkResultSchema = z.object({
  model: z.string(),
  completion_tokens: z.number(),
  total_time_ms: z.number(),
  time_to_first_token_ms: z.number(),
  tokens_per_second: z.number(),
  peak_memory_bytes: z.number(),
});

// ─── Setup ──────────────────────────────────────────────────────────

export const InferenceSetupStatusSchema = z.object({
  venvExists: z.boolean(),
  venvPath: z.string(),
  systemPythonFound: z.boolean(),
  systemPythonPath: z.string().nullable(),
  systemPythonVersion: z.string().nullable(),
  pythonVersionOk: z.boolean(),
  platform: z.enum(["apple-silicon", "other"]),
  requiredPackages: z.array(z.string()),
  depsInstalled: z.boolean(),
  detectedBackend: z.string().nullable(),
  inferenceAvailable: z.boolean(),
  error: z.string().nullable(),
});

export const SetupStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("phase"), phase: z.string(), message: z.string() }),
  z.object({ type: z.literal("stdout"), data: z.string() }),
  z.object({ type: z.literal("stderr"), data: z.string() }),
  z.object({
    type: z.literal("result"),
    success: z.boolean(),
    message: z.string(),
    backend: z.string().optional(),
  }),
]);

// ─── Input schemas ──────────────────────────────────────────────────

export const PullModelInputSchema = z.object({
  modelId: z.string(),
});

export const LoadModelInputSchema = z.object({
  modelId: z.string(),
  backend: z.string().optional(),
});

export const UnloadModelInputSchema = z.object({
  modelId: z.string().optional(),
});

export const DeleteModelInputSchema = z.object({
  modelId: z.string(),
});

export const BenchmarkInputSchema = z.object({
  modelId: z.string().optional(),
});
