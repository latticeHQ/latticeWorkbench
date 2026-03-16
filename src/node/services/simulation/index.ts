/**
 * Lattice Simulation Engine
 *
 * Multi-agent prediction system with:
 * - Graphiti + FalkorDB knowledge graph
 * - Multi-model agent tiers (Opus/Sonnet/Flash/Local)
 * - Pluggable platforms (forum, chat, meeting, market)
 * - OASIS-validated social dynamics
 * - Ensemble runs with statistical analysis
 * - Autonomous orchestration via TaskService
 * - All configurable via UI (no hardcoded values)
 */

export { SimulationService } from "./simulationService";
export { SimulationRuntime } from "./simulationRuntime";
export type { LLMProvider, RuntimeCallbacks } from "./simulationRuntime";
export { GraphLayer } from "./graphLayer";
export { generateOntology, splitTextIntoChunks } from "./ontologyGenerator";
export { forgeAgentProfiles, generateTemplateAgents } from "./agentForge";
export { generateReport } from "./reportEngine";
export * from "./types";
export * from "./socialDynamics";
export { ForumPlatformState } from "./platforms/forumPlatform";
export { ChatPlatformState } from "./platforms/chatPlatform";
export { MeetingPlatformState } from "./platforms/meetingPlatform";
export { MarketPlatformState } from "./platforms/marketPlatform";
export type { PlatformState, ActionResult } from "./platforms/platformInterface";
