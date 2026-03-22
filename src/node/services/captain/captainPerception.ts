/**
 * Captain Perception Service
 *
 * Gathers all inputs for each cognitive tick:
 * - New user messages
 * - Worker status changes
 * - Time-based triggers
 * - External events from lattice runtime
 */

import { readFile } from "fs/promises";
import * as path from "path";
import type {
  PerceptionEvent,
  WorkerFile,
  GoalFile,
} from "./types";

export class CaptainPerception {
  private readonly projectDir: string;
  private pendingUserMessages: PerceptionEvent[] = [];
  private lastWorkerPoll: number = 0;
  private lastGoalCheck: number = 0;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
  }

  // ---------------------------------------------------------------------------
  // Main Perception Cycle
  // ---------------------------------------------------------------------------

  /** Gather all inputs since last tick. Returns empty array if nothing happened. */
  async perceive(): Promise<PerceptionEvent[]> {
    const events: PerceptionEvent[] = [];

    // 1. Drain pending user messages
    events.push(...this.drainUserMessages());

    // 2. Check worker status changes
    const workerEvents = await this.checkWorkerStates();
    events.push(...workerEvents);

    // 3. Check for stale goals
    const goalEvents = await this.checkStaleGoals();
    events.push(...goalEvents);

    // 4. Time-based awareness
    const timeEvents = this.checkTimeTriggers();
    events.push(...timeEvents);

    return events;
  }

  // ---------------------------------------------------------------------------
  // User Messages
  // ---------------------------------------------------------------------------

  /** Queue a user message for the next cognitive tick. */
  enqueueUserMessage(content: string): void {
    this.pendingUserMessages.push({
      type: "user_message",
      source: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /** Drain and return all pending user messages. */
  private drainUserMessages(): PerceptionEvent[] {
    const messages = [...this.pendingUserMessages];
    this.pendingUserMessages = [];
    return messages;
  }

  // ---------------------------------------------------------------------------
  // Worker Status
  // ---------------------------------------------------------------------------

  /** Check for worker completion/failure since last poll. */
  private async checkWorkerStates(): Promise<PerceptionEvent[]> {
    const events: PerceptionEvent[] = [];
    const now = Date.now();

    // Don't poll more than once every 5 seconds
    if (now - this.lastWorkerPoll < 5000) return events;
    this.lastWorkerPoll = now;

    try {
      const workersPath = path.join(
        this.projectDir,
        ".lattice",
        "captain",
        "workers",
        "active.json",
      );
      const raw = await readFile(workersPath, "utf-8");
      const file = JSON.parse(raw) as WorkerFile;

      for (const worker of file.workers) {
        if (worker.status === "completed" && worker.completedAt) {
          // Only report if completed since our last poll
          if (worker.completedAt > this.lastWorkerPoll - 5000) {
            events.push({
              type: "worker_complete",
              source: `worker:${worker.id}`,
              content: `Worker "${worker.agentName}" completed task: ${worker.taskDescription}. Result: ${worker.result ?? "pending collection"}`,
              timestamp: worker.completedAt,
              metadata: { workerId: worker.id, goalId: worker.goalId },
            });
          }
        } else if (worker.status === "failed") {
          events.push({
            type: "worker_failed",
            source: `worker:${worker.id}`,
            content: `Worker "${worker.agentName}" failed task: ${worker.taskDescription}`,
            timestamp: now,
            metadata: { workerId: worker.id, goalId: worker.goalId },
          });
        }
      }
    } catch {
      // Workers file doesn't exist or is malformed
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Goal Staleness
  // ---------------------------------------------------------------------------

  /** Check for goals that haven't progressed in a while. */
  private async checkStaleGoals(): Promise<PerceptionEvent[]> {
    const events: PerceptionEvent[] = [];
    const now = Date.now();

    // Check every 60 seconds
    if (now - this.lastGoalCheck < 60_000) return events;
    this.lastGoalCheck = now;

    try {
      const goalsPath = path.join(
        this.projectDir,
        ".lattice",
        "captain",
        "goals.json",
      );
      const raw = await readFile(goalsPath, "utf-8");
      const file = JSON.parse(raw) as GoalFile;

      for (const goal of file.goals) {
        if (
          (goal.status === "active" || goal.status === "decomposed") &&
          now - goal.updatedAt > 60 * 60 * 1000 // 1 hour stale
        ) {
          events.push({
            type: "goal_stale",
            source: `goal:${goal.id}`,
            content: `Goal "${goal.description}" has been ${goal.status} for over 1 hour without progress`,
            timestamp: now,
            metadata: { goalId: goal.id, status: goal.status },
          });
        }
      }
    } catch {
      // Goals file doesn't exist
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Time Triggers
  // ---------------------------------------------------------------------------

  private lastTimeTrigger: number = 0;

  /** Simple time-based awareness events. */
  private checkTimeTriggers(): PerceptionEvent[] {
    const events: PerceptionEvent[] = [];
    const now = Date.now();

    // Check every 5 minutes
    if (now - this.lastTimeTrigger < 5 * 60 * 1000) return events;
    this.lastTimeTrigger = now;

    const hour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Morning check-in (9 AM on weekdays)
    if (hour === 9 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      events.push({
        type: "time_trigger",
        source: "clock",
        content: "Morning. Consider reviewing overnight goals and worker results.",
        timestamp: now,
      });
    }

    // End of day (6 PM on weekdays)
    if (hour === 18 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      events.push({
        type: "time_trigger",
        source: "clock",
        content: "End of workday approaching. Consider summarizing progress and planning tomorrow.",
        timestamp: now,
      });
    }

    return events;
  }

  // ---------------------------------------------------------------------------
  // Voice Transcripts
  // ---------------------------------------------------------------------------

  /** Queue a voice transcript from LiveKit. */
  enqueueVoiceTranscript(content: string): void {
    this.pendingUserMessages.push({
      type: "voice_transcript",
      source: "livekit",
      content,
      timestamp: Date.now(),
    });
  }
}
