/**
 * Lattice Inference — Local on-device inference for Lattice.
 *
 * Architecture: Node.js (UI/ORPC) → Go binary (pool/cluster/metrics) → Python workers (inference)
 *
 * Re-exports the public API for the inference subsystem.
 */

// Core service
export { InferenceService } from "./inferenceService";
export type { InferenceServiceEvents } from "./inferenceService";

// Go binary management
export { InferredProcessManager } from "./inferredProcessManager";
export { InferredHttpClient } from "./inferredHttpClient";
export { getInferredBinaryPath } from "./inferredBinaryPath";

// AI SDK bridge
export { LatticeLanguageModel } from "./latticeLanguageModel";

// Model management (still used for HF downloads)
export { HfDownloader } from "./hfDownloader";
export { ModelRegistry } from "./modelRegistry";

// Backend detection (Python path for Go binary --python flag)
export {
  detectPython,
  detectBackend,
  findWorkerScript,
  checkPythonDependencies,
} from "./backendDetection";

// Legacy: Python worker (kept for backward compat, not used in new architecture)
export { PythonWorkerManager } from "./workerManager";

// Types
export type {
  // Shared
  ChatMessage,
  GenerateParams,
  GenerateResult,
  StreamToken,
  ModelInfo,
  ModelManifest,
  DownloadProgress,
  // Go binary responses
  InferredHealthResponse,
  InferredStatusResponse,
  LoadedModelInfo,
  ClusterNode,
  ClusterState,
  // OpenAI-compatible
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  UsageInfo,
} from "./types";
