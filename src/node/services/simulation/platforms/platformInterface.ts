/**
 * Platform Interface — abstract base for all simulation platforms.
 *
 * Each platform defines its own action space, state management,
 * and feed generation. Platforms are pluggable — add new ones
 * without changing the simulation runtime.
 */

import type {
  ActionType,
  AgentAction,
  AgentProfile,
  PlatformPost,
  PlatformSnapshot,
  PlatformType,
  SocialDynamicsConfig,
  SimulationEvent,
} from "../types";

export interface PlatformState {
  readonly type: PlatformType;
  readonly posts: PlatformPost[];
  readonly config: SocialDynamicsConfig;

  /** Get the available action types for this platform */
  getActionTypes(): ActionType[];

  /** Get a personalized feed for an agent */
  getFeed(agent: AgentProfile, currentRound: number, feedSize?: number): PlatformPost[];

  /** Apply an agent's action to the platform state */
  applyAction(action: AgentAction): ActionResult;

  /** Inject an external event into the platform */
  injectEvent(event: SimulationEvent, round: number): void;

  /** Get current trending topics */
  getTrending(topN?: number): string[];

  /** Get posts that have gone viral */
  getViralPosts(): PlatformPost[];

  /** Take a snapshot of current platform state for reporting */
  snapshot(): PlatformSnapshot;

  /** Run end-of-round maintenance (viral propagation, content decay) */
  endOfRound(currentRound: number): void;

  /** Format a post for display in an agent's prompt */
  formatPostForPrompt(post: PlatformPost): string;

  /** Format the available actions for an agent's system prompt */
  formatActionInstructions(): string;
}

export interface ActionResult {
  success: boolean;
  resultId?: string;
  message?: string;
}

/**
 * Generate a unique ID for platform objects.
 */
let _idCounter = 0;
export function generatePlatformId(prefix: string): string {
  return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`;
}

export function resetIdCounter(): void {
  _idCounter = 0;
}
