/**
 * Captain Goal Manager
 *
 * Manages hierarchical goals that the Captain pursues.
 * Goals can come from the user, from the Captain's own initiative, or from events.
 * Goals are decomposed into sub-goals and worker assignments via LLM.
 */

import { readFile, writeFile } from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { log } from "@/node/services/log";
import type { Goal, GoalFile, GoalSource, GoalStatus, WorkerAssignment } from "./types";

export class CaptainGoalManager {
  private readonly goalsPath: string;

  constructor(projectDir: string) {
    this.goalsPath = path.join(
      projectDir,
      ".lattice",
      "captain",
      "goals.json",
    );
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Create a new top-level or sub-goal. */
  async createGoal(
    description: string,
    source: GoalSource,
    priority: number = 5,
    parentId?: string,
  ): Promise<Goal> {
    const goal: Goal = {
      id: randomUUID(),
      parentId,
      description,
      status: "pending",
      priority: Math.max(1, Math.min(10, priority)),
      source,
      subGoals: [],
      workers: [],
      context: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const file = await this.loadGoals();
    if (parentId) {
      // Add as sub-goal to parent
      const parent = this.findGoal(file.goals, parentId);
      if (parent) {
        parent.subGoals.push(goal);
        parent.status = "decomposed";
        parent.updatedAt = Date.now();
      } else {
        // Parent not found, add as top-level
        file.goals.push(goal);
      }
    } else {
      file.goals.push(goal);
    }

    await this.saveGoals(file);
    log.info(
      `[Captain Goals] Created ${source} goal: "${description}" (priority: ${priority})`,
    );
    return goal;
  }

  /** Update a goal's status. */
  async updateStatus(
    goalId: string,
    status: GoalStatus,
    result?: unknown,
  ): Promise<void> {
    const file = await this.loadGoals();
    const goal = this.findGoal(file.goals, goalId);
    if (!goal) {
      log.warn(`[Captain Goals] Goal ${goalId} not found`);
      return;
    }

    goal.status = status;
    goal.updatedAt = Date.now();
    if (result !== undefined) goal.result = result;
    if (status === "completed" || status === "failed" || status === "cancelled") {
      goal.completedAt = Date.now();
    }

    await this.saveGoals(file);
    log.info(`[Captain Goals] Updated goal "${goal.description}" → ${status}`);
  }

  /** Assign a worker to a goal. */
  async assignWorker(goalId: string, worker: WorkerAssignment): Promise<void> {
    const file = await this.loadGoals();
    const goal = this.findGoal(file.goals, goalId);
    if (!goal) return;

    goal.workers.push(worker);
    goal.updatedAt = Date.now();
    await this.saveGoals(file);
  }

  /** Get all active goals (pending, active, decomposed). */
  async getActiveGoals(): Promise<Goal[]> {
    const file = await this.loadGoals();
    return this.flattenGoals(file.goals).filter(
      (g) => g.status === "pending" || g.status === "active" || g.status === "decomposed",
    );
  }

  /** Get all goals (flat list). */
  async getAllGoals(): Promise<Goal[]> {
    const file = await this.loadGoals();
    return file.goals;
  }

  /** Cancel a goal and its sub-goals. */
  async cancelGoal(goalId: string): Promise<void> {
    const file = await this.loadGoals();
    const goal = this.findGoal(file.goals, goalId);
    if (!goal) return;

    this.cancelRecursive(goal);
    await this.saveGoals(file);
    log.info(`[Captain Goals] Cancelled goal "${goal.description}" and sub-goals`);
  }

  // ---------------------------------------------------------------------------
  // Decomposition Prompt
  // ---------------------------------------------------------------------------

  /**
   * Build a prompt for the LLM to decompose a goal into sub-goals and worker tasks.
   * The cognitive loop will send this as an internal message.
   */
  buildDecompositionPrompt(goal: Goal): string {
    return [
      `Decompose this goal into 2-5 sub-goals that can be worked on in parallel.`,
      `For each sub-goal, specify whether it needs a "local" worker (sidekick) or "remote" worker (lattice agent).`,
      ``,
      `Goal: "${goal.description}"`,
      `Priority: ${goal.priority}`,
      `Source: ${goal.source}`,
      ``,
      `Respond with JSON:`,
      `{`,
      `  "subGoals": [`,
      `    {`,
      `      "description": "...",`,
      `      "priority": 1-10,`,
      `      "workerType": "local" | "remote",`,
      `      "workerAgent": "exec" | "explore" | "plan" | "research-analyst",`,
      `      "taskBrief": "Detailed instructions for the worker agent"`,
      `    }`,
      `  ],`,
      `  "reasoning": "Why I decomposed it this way"`,
      `}`,
    ].join("\n");
  }

  /** Build a context block of active goals for the cognitive loop prompt. */
  async buildGoalContextBlock(): Promise<string> {
    const active = await this.getActiveGoals();
    if (active.length === 0) return "## Active Goals\nNone.";

    const lines = ["## Active Goals"];
    for (const goal of active) {
      const workerCount = goal.workers.length;
      const completedWorkers = goal.workers.filter(
        (w) => w.status === "completed",
      ).length;
      lines.push(
        `- [${goal.status}] P${goal.priority} "${goal.description}" (${goal.source}) — ${completedWorkers}/${workerCount} workers done`,
      );
      for (const sub of goal.subGoals) {
        lines.push(`  - [${sub.status}] "${sub.description}"`);
      }
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadGoals(): Promise<GoalFile> {
    try {
      const raw = await readFile(this.goalsPath, "utf-8");
      return JSON.parse(raw) as GoalFile;
    } catch {
      return { goals: [], last_updated: new Date().toISOString() };
    }
  }

  private async saveGoals(file: GoalFile): Promise<void> {
    file.last_updated = new Date().toISOString();
    await writeFile(this.goalsPath, JSON.stringify(file, null, 2), "utf-8");
  }

  private findGoal(goals: Goal[], id: string): Goal | undefined {
    for (const g of goals) {
      if (g.id === id) return g;
      const sub = this.findGoal(g.subGoals, id);
      if (sub) return sub;
    }
    return undefined;
  }

  private flattenGoals(goals: Goal[]): Goal[] {
    const flat: Goal[] = [];
    for (const g of goals) {
      flat.push(g);
      flat.push(...this.flattenGoals(g.subGoals));
    }
    return flat;
  }

  private cancelRecursive(goal: Goal): void {
    goal.status = "cancelled";
    goal.completedAt = Date.now();
    goal.updatedAt = Date.now();
    for (const sub of goal.subGoals) {
      if (sub.status !== "completed") {
        this.cancelRecursive(sub);
      }
    }
  }
}
