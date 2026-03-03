/**
 * Lattice Inference — Local on-device LLM inference engine.
 *
 * Re-exports the public API for the inference module.
 */

export { InferenceService } from "./inferenceService";
export { InferenceSetupService } from "./inferenceSetupService";
export { LatticeLanguageModel } from "./latticeLanguageModel";
export { InferredHttpClient } from "./inferredHttpClient";
export { InferredProcessManager } from "./inferredProcessManager";
export { HfDownloader } from "./hfDownloader";
export { ModelRegistry } from "./modelRegistry";

export type {
  InferenceSetupStatus,
  SetupPhase,
  SetupStreamEvent,
} from "./inferenceSetupService";

export type {
  ModelInfo,
  DownloadProgress,
  InferredStatusResponse,
  LoadedModelInfo,
  ClusterState,
  ClusterNode,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  RDMAConfig,
  TransportStatus,
} from "./types";
