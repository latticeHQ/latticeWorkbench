/**
 * Captain Initiative Engine
 *
 * Decides when the Captain should act WITHOUT being asked.
 * Evaluates triggers based on time, events, goal state, and curiosity.
 * Each trigger has a cooldown to prevent spamming.
 */

import { log } from "@/node/services/log";
import type { InitiativeTrigger, PerceptionEvent } from "./types";

export const DEFAULT_TRIGGERS: InitiativeTrigger[] = [
  {
    type: "time",
    condition: "idle_30_min_with_pending_insights",
    action: "message_user_with_update",
    cooldownMs: 30 * 60 * 1000,
  },
  {
    type: "event",
    condition: "worker_completed_with_interesting_results",
    action: "synthesize_and_notify",
    cooldownMs: 5 * 60 * 1000,
  },
  {
    type: "goal",
    condition: "goal_stale_1_hour",
    action: "reevaluate_approach",
    cooldownMs: 60 * 60 * 1000,
  },
  {
    type: "curiosity",
    condition: "conversation_raised_open_question",
    action: "research_autonomously",
    cooldownMs: 15 * 60 * 1000,
  },
];

export class CaptainInitiative {
  private triggers: InitiativeTrigger[];
  private lastUserInteraction: number = Date.now();
  private openQuestions: string[] = [];

  constructor(triggers?: InitiativeTrigger[]) {
    this.triggers = triggers ?? [...DEFAULT_TRIGGERS];
  }

  /** Record that the user interacted. Resets idle timers. */
  recordUserInteraction(): void {
    this.lastUserInteraction = Date.now();
  }

  /** Record an open question from a conversation for curiosity triggers. */
  recordOpenQuestion(question: string): void {
    this.openQuestions.push(question);
    // Keep only the 10 most recent
    if (this.openQuestions.length > 10) {
      this.openQuestions = this.openQuestions.slice(-10);
    }
  }

  /**
   * Evaluate all triggers and return actions that should fire.
   * Called each cognitive tick.
   */
  evaluate(
    events: PerceptionEvent[],
    hasActiveGoals: boolean,
    hasPendingInsights: boolean,
  ): string[] {
    const now = Date.now();
    const actions: string[] = [];

    for (const trigger of this.triggers) {
      // Check cooldown
      if (trigger.lastFired && now - trigger.lastFired < trigger.cooldownMs) {
        continue;
      }

      let shouldFire = false;

      switch (trigger.condition) {
        case "idle_30_min_with_pending_insights":
          shouldFire =
            now - this.lastUserInteraction > 30 * 60 * 1000 &&
            hasPendingInsights;
          break;

        case "worker_completed_with_interesting_results":
          shouldFire = events.some((e) => e.type === "worker_complete");
          break;

        case "goal_stale_1_hour":
          shouldFire = events.some((e) => e.type === "goal_stale");
          break;

        case "conversation_raised_open_question":
          shouldFire = this.openQuestions.length > 0 && !hasActiveGoals;
          break;
      }

      if (shouldFire) {
        trigger.lastFired = now;
        actions.push(trigger.action);
        log.info(
          `[Captain Initiative] Trigger fired: ${trigger.condition} → ${trigger.action}`,
        );
      }
    }

    return actions;
  }

  /** Get the list of open questions for curiosity-driven research. */
  getOpenQuestions(): string[] {
    return [...this.openQuestions];
  }

  /** Clear an open question after it's been researched. */
  resolveQuestion(question: string): void {
    this.openQuestions = this.openQuestions.filter((q) => q !== question);
  }
}
