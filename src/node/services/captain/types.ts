/**
 * Captain System Types
 *
 * Core type definitions for the autonomous AI captain:
 * identity, memory, goals, workers, cognitive loop, and initiative.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface CaptainPersonality {
  traits: string[];
  communication_style: string;
  values: string[];
  opinions: Record<string, string>;
}

export interface CaptainPreferences {
  default_model: string;
  thinking_depth: "shallow" | "medium" | "deep";
  proactivity_level: "low" | "medium" | "high";
  delegation_threshold: string;
}

export interface CaptainIdentity {
  name: string;
  personality: CaptainPersonality;
  preferences: CaptainPreferences;
  formed_at: string;
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export type MemoryType = "episodic" | "semantic" | "relational" | "procedural";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  importance: number; // 0-1
  metadata: Record<string, unknown>;
  createdAt: number;
  lastAccessedAt: number;
}

export interface RelationalMemory {
  entity: string;
  type: "relational";
  observations: string[];
  preferences: Record<string, string>;
  expertise: string[];
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export type GoalStatus =
  | "pending"
  | "active"
  | "decomposed"
  | "completed"
  | "failed"
  | "cancelled";

export type GoalSource = "user" | "self" | "event";

export interface Goal {
  id: string;
  parentId?: string;
  description: string;
  status: GoalStatus;
  priority: number; // 1 = highest, 10 = lowest
  source: GoalSource;
  subGoals: Goal[];
  workers: WorkerAssignment[];
  context: Record<string, unknown>;
  result?: unknown;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface GoalFile {
  goals: Goal[];
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export type WorkerStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

export type WorkerType = "local" | "remote";

export interface WorkerAssignment {
  id: string;
  goalId: string;
  type: WorkerType;
  minionId?: string; // For local sidekick workers
  agentId?: string; // For remote lattice agents
  agentName: string;
  taskDescription: string;
  status: WorkerStatus;
  result?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkerFile {
  workers: WorkerAssignment[];
  last_updated: string;
}

// ---------------------------------------------------------------------------
// Cognitive Loop
// ---------------------------------------------------------------------------

export type CognitivePhase = "perceive" | "reflect" | "decide" | "act";

export interface CognitiveTickResult {
  tickNumber: number;
  timestamp: number;
  events: PerceptionEvent[];
  reflection?: string;
  decisions: CaptainAction[];
  tokensUsed: number;
  skipped: boolean;
}

export type CaptainActionType =
  | "wait"
  | "message_user"
  | "decompose_goal"
  | "spawn_worker"
  | "aggregate_results"
  | "store_memory"
  | "research"
  | "cleanup_worker";

export interface CaptainAction {
  type: CaptainActionType;
  description: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Perception
// ---------------------------------------------------------------------------

export type PerceptionEventType =
  | "user_message"
  | "worker_complete"
  | "worker_failed"
  | "worker_progress"
  | "time_trigger"
  | "external_event"
  | "goal_stale"
  | "voice_transcript";

export interface PerceptionEvent {
  type: PerceptionEventType;
  source: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------------------

export type InitiativeTriggerType = "time" | "event" | "goal" | "curiosity";

export interface InitiativeTrigger {
  type: InitiativeTriggerType;
  condition: string;
  action: string;
  cooldownMs: number;
  lastFired?: number;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CaptainConfig {
  cognitiveInterval: number; // ms between cognitive ticks
  memoryConsolidation: number; // consolidate every N ticks
  initiativeEnabled: boolean;
  maxWorkers: number;
  workerTTL: number; // default worker TTL in ms
  skipIfNoInputs: boolean;
  maxConsecutiveSkips: number; // force reflection after N idle ticks
  tokenBudgetPerTick: number; // max tokens per cognitive cycle
}

export const DEFAULT_CAPTAIN_CONFIG: CaptainConfig = {
  cognitiveInterval: 10_000, // 10 seconds
  memoryConsolidation: 100, // every ~16 minutes
  initiativeEnabled: true,
  maxWorkers: 20,
  workerTTL: 3_600_000, // 1 hour
  skipIfNoInputs: true,
  maxConsecutiveSkips: 30, // force reflection after ~5 min idle
  tokenBudgetPerTick: 8_192,
};

// ---------------------------------------------------------------------------
// Canvas (for React Flow visualization)
// ---------------------------------------------------------------------------

export type CanvasNodeType =
  | "cognitiveTick"
  | "goal"
  | "worker"
  | "event"
  | "action"
  | "memory"
  | "identity"
  | "message";

export interface CaptainCanvasNode {
  id: string;
  type: CanvasNodeType;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface CaptainCanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
}

export type CanvasLayoutMode = "mindMap" | "timeline" | "goalTree" | "swarm";
