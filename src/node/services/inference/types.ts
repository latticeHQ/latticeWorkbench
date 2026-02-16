/**
 * Shared types for the Lattice Inference engine.
 *
 * These mirror the JSON-RPC protocol spoken by the Python worker (worker.py)
 * and the Go worker manager that we're replacing with Node.js.
 */

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

// ─── Streaming ──────────────────────────────────────────────────────────

/** A single streaming token emitted by the Python worker. */
export interface StreamToken {
  token: string;
  done: boolean;
  error?: string;
}

// ─── Inference request / response ───────────────────────────────────────

export interface ChatMessage {
  role: string;
  content: string;
}

export interface GenerateParams {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface GenerateResult {
  text: string;
  finish_reason: string;
  prompt_tokens: number;
  completion_tokens: number;
}

// ─── Model registry ─────────────────────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  huggingFaceRepo?: string;
  format: "mlx" | "gguf" | "pytorch" | "unknown";
  sizeBytes: number;
  parameterCount?: number;
  quantization?: string;
  localPath: string;
  backend?: string;
  pulledAt?: string; // ISO date
}

/** Manifest written to .lattice-model.json after a successful pull. */
export interface ModelManifest {
  id: string;
  name: string;
  huggingface_repo: string;
  local_path: string;
  pulled_at: string; // ISO date
  parameter_count?: number;
  quantization?: string;
}

// ─── Download progress ──────────────────────────────────────────────────

export interface DownloadProgress {
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
}

// ─── Go binary (inferred) response types ────────────────────────────────

/** GET /healthz */
export interface InferredHealthResponse {
  status: string;
  active_model: string;
  worker_alive: boolean;
  models_loaded: number;
}

/** GET /inference/status */
export interface InferredStatusResponse {
  active_model: ModelInfo | null;
  loaded_models: LoadedModelInfo[];
  cached_models: ModelInfo[];
  worker_alive: boolean;
  models_loaded: number;
  python_path: string;
  model_dir: string;
  max_concurrency: number;
  max_loaded_models: number;
  memory_budget_bytes: number;
  estimated_vram_bytes: number;
  cluster?: ClusterState | null;
}

/** A model currently loaded in the Go worker pool. */
export interface LoadedModelInfo {
  model_id: string;
  model_path: string;
  backend: string;
  alive: boolean;
  estimated_bytes: number;
  loaded_at: string; // ISO date
  last_used_at: string; // ISO date
  use_count: number;
}

// ─── Cluster types ─────────────────────────────────────────────────────

export interface ClusterNode {
  id: string;
  name: string;
  address: string;
  joined_at: string;
  loaded_models: string[];
  backend: string;
  max_models: number;
  total_memory_bytes: number;
  used_memory_bytes: number;
  gpu_type: string;
  active_inferences: number;
  tokens_per_second_avg: number;
  last_heartbeat: string;
  status: string; // "online" | "busy" | "draining" | "offline"
}

export interface ClusterState {
  nodes: ClusterNode[];
  total_models: number;
  total_nodes: number;
  updated_at: string;
}

// ─── OpenAI-compatible types (from Go binary) ──────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage?: UsageInfo;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: { role?: string; content?: string };
  finish_reason: string | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ModelObject {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelListResponse {
  object: string;
  data: ModelObject[];
}

// ─── HuggingFace API ────────────────────────────────────────────────────

export interface HFFile {
  rfilename: string;
  size: number;
}

export interface HFRepoInfo {
  siblings: HFFile[];
}

// ─── RDMA / Transport (from Go binary) ────────────────────────────────

export interface RDMAConfig {
  available: boolean;
  mode: string; // "rdma-verbs" | "tcp-rdma-fallback" | "none"
  device: string;
  backend: string;
  bandwidth_gbps: number;
  latency_us: number;
  max_message_size: number;
  error?: string;
}

export interface TransportStat {
  peer_id: string;
  peer_name: string;
  transport: string; // "rdma-verbs" | "tcp-rdma-fallback" | "tcp"
  bandwidth_gbps: number;
  latency_us: number;
  connected: boolean;
}

export interface RDMATransportStats {
  bytes_sent: number;
  bytes_received: number;
  messages_sent: number;
  messages_received: number;
  errors: number;
}

export interface TransportStatus {
  rdma: RDMAConfig;
  peer_transports: TransportStat[];
  router_transports: Record<string, string>;
}
