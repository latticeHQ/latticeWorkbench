/**
 * Captain — Autonomous AI Mind + Swarm Commander
 *
 * The Captain is a special Workbench minion that extends AgentSession
 * with a continuous cognitive loop, persistent identity/memory,
 * goal decomposition, worker swarm management, and initiative.
 */

// Core service
export { CaptainService } from "./captainService";
export type { CaptainServiceEvents } from "./captainService";

// Cognitive loop
export { CaptainCognitiveLoop } from "./captainCognitiveLoop";
export type { CaptainLoopEvents } from "./captainCognitiveLoop";

// Sub-systems
export { CaptainMemory } from "./captainMemory";
export { CaptainPerception } from "./captainPerception";
export { CaptainGoalManager } from "./captainGoals";
export { CaptainInitiative, DEFAULT_TRIGGERS } from "./captainInitiative";
export { CaptainWorkerManager } from "./captainWorkers";
export { CaptainVoice, DEFAULT_VOICE_CONFIG } from "./captainVoice";

// Guardrails
export {
  CostGuardrail,
  DEFAULT_COST_BUDGET,
  InitiativeThrottle,
  ErrorRecovery,
} from "./captainGuardrails";

// Types
export * from "./types";
