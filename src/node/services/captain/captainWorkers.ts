/**
 * Captain Worker Manager
 *
 * Manages the Captain's swarm of worker agents.
 * Two types:
 *   - Local workers: sidekick minions via minionService.create()
 *   - Remote workers: lattice agents via latticeService CLI
 *
 * Workers are ephemeral — created for a task, cleaned up after.
 */

import { readFile, writeFile } from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import { log } from "@/node/services/log";
import type { MinionService } from "@/node/services/minionService";
import type { LatticeService } from "@/node/services/latticeService";
import type { WorkerAssignment, WorkerFile } from "./types";

export class CaptainWorkerManager {
  private readonly projectDir: string;
  private readonly workersPath: string;
  private minionService: MinionService | null = null;
  private latticeService: LatticeService | null = null;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.workersPath = path.join(
      projectDir,
      ".lattice",
      "captain",
      "workers",
      "active.json",
    );
  }

  /** Inject services (called during wiring). */
  setServices(minionService: MinionService, latticeService?: LatticeService): void {
    this.minionService = minionService;
    this.latticeService = latticeService ?? null;
  }

  // ---------------------------------------------------------------------------
  // Spawn Workers
  // ---------------------------------------------------------------------------

  /**
   * Spawn a local worker (sidekick minion) for a task.
   */
  async spawnLocal(
    goalId: string,
    taskDescription: string,
    agentType: string = "exec",
  ): Promise<WorkerAssignment> {
    if (!this.minionService) {
      throw new Error("MinionService not wired");
    }

    const workerId = randomUUID();
    const workerName = `captain-worker-${workerId.slice(0, 8)}`;

    const worker: WorkerAssignment = {
      id: workerId,
      goalId,
      type: "local",
      agentName: workerName,
      taskDescription,
      status: "pending",
      createdAt: Date.now(),
    };

    const result = await this.minionService.create(
      this.projectDir,
      workerName,
      undefined,
      `Captain Worker: ${taskDescription.slice(0, 50)}`,
      { type: "local", srcBaseDir: this.projectDir },
      undefined,
      {
        circuitBreaker: { enabled: true, softLimit: 15, hardLimit: 25 },
      },
    );

    if (result.success) {
      worker.minionId = result.data.metadata.id;
      worker.status = "running";

      // Send the task to the worker
      const taskMessage = [
        `You are a worker agent spawned by the Captain for a specific task.`,
        `Complete this task and report your results clearly.`,
        ``,
        `## Task`,
        taskDescription,
        ``,
        `## Instructions`,
        `- Focus only on this task`,
        `- Be thorough but efficient`,
        `- Report your findings/results at the end`,
      ].join("\n");

      await this.minionService.sendMessage(
        worker.minionId,
        taskMessage,
        { agentId: agentType, model: "claude-sonnet-4-6" },
      );

      log.info(`[Captain Workers] Spawned local worker ${workerName} for goal ${goalId}`);
    } else {
      worker.status = "failed";
      log.error(`[Captain Workers] Failed to spawn local worker: ${result.error}`);
    }

    await this.saveWorker(worker);
    return worker;
  }

  /**
   * Spawn a remote worker on lattice runtime.
   */
  async spawnRemote(
    goalId: string,
    taskDescription: string,
    _template: string = "captain-worker",
  ): Promise<WorkerAssignment> {
    if (!this.latticeService) {
      throw new Error("LatticeService not wired — remote workers unavailable");
    }

    const workerId = randomUUID();
    const workerName = `captain-remote-${workerId.slice(0, 8)}`;

    const worker: WorkerAssignment = {
      id: workerId,
      goalId,
      type: "remote",
      agentName: workerName,
      taskDescription,
      status: "pending",
      createdAt: Date.now(),
    };

    try {
      const startResult = await this.latticeService.startMinion(workerName, {
        timeoutMs: 120_000,
      });

      if (startResult.success) {
        worker.agentId = workerName;
        worker.status = "running";
        log.info(`[Captain Workers] Spawned remote worker ${workerName} for goal ${goalId}`);
      } else {
        worker.status = "failed";
        log.error(`[Captain Workers] Failed to spawn remote worker: ${startResult.error}`);
      }
    } catch (error) {
      worker.status = "failed";
      log.error("[Captain Workers] Remote worker spawn error:", error);
    }

    await this.saveWorker(worker);
    return worker;
  }

  // ---------------------------------------------------------------------------
  // Monitor & Collect
  // ---------------------------------------------------------------------------

  async getActiveWorkers(): Promise<WorkerAssignment[]> {
    const file = await this.loadWorkers();
    return file.workers.filter(
      (w) => w.status === "pending" || w.status === "running",
    );
  }

  async getAllWorkers(): Promise<WorkerAssignment[]> {
    const file = await this.loadWorkers();
    return file.workers;
  }

  async completeWorker(workerId: string, result: string): Promise<void> {
    const file = await this.loadWorkers();
    const worker = file.workers.find((w) => w.id === workerId);
    if (!worker) return;

    worker.status = "completed";
    worker.result = result;
    worker.completedAt = Date.now();
    await this.saveWorkers(file);
    log.info(`[Captain Workers] Worker ${worker.agentName} completed`);
  }

  async failWorker(workerId: string, reason?: string): Promise<void> {
    const file = await this.loadWorkers();
    const worker = file.workers.find((w) => w.id === workerId);
    if (!worker) return;

    worker.status = "failed";
    worker.result = reason ?? "Unknown failure";
    worker.completedAt = Date.now();
    await this.saveWorkers(file);
    log.warn(`[Captain Workers] Worker ${worker.agentName} failed: ${reason}`);
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async cleanup(): Promise<number> {
    const file = await this.loadWorkers();
    const toClean = file.workers.filter(
      (w) => w.status === "completed" || w.status === "failed",
    );

    let cleaned = 0;
    for (const worker of toClean) {
      if (worker.type === "local" && worker.minionId && this.minionService) {
        try { await this.minionService.remove(worker.minionId); } catch { /* best effort */ }
      }
      if (worker.type === "remote" && worker.agentId && this.latticeService) {
        try { await this.latticeService.stopMinion(worker.agentId); } catch { /* best effort */ }
      }
      cleaned++;
    }

    file.workers = file.workers.filter(
      (w) => w.status !== "completed" && w.status !== "failed",
    );
    await this.saveWorkers(file);

    if (cleaned > 0) log.info(`[Captain Workers] Cleaned up ${cleaned} workers`);
    return cleaned;
  }

  async checkTimeouts(ttlMs: number): Promise<void> {
    const file = await this.loadWorkers();
    const now = Date.now();
    let changed = false;

    for (const worker of file.workers) {
      if (worker.status === "running" && now - worker.createdAt > ttlMs) {
        worker.status = "timeout";
        worker.completedAt = now;
        worker.result = `Timed out after ${Math.round(ttlMs / 60_000)} minutes`;
        changed = true;
        log.warn(`[Captain Workers] Worker ${worker.agentName} timed out`);
      }
    }

    if (changed) await this.saveWorkers(file);
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private async loadWorkers(): Promise<WorkerFile> {
    try {
      const raw = await readFile(this.workersPath, "utf-8");
      return JSON.parse(raw) as WorkerFile;
    } catch {
      return { workers: [], last_updated: new Date().toISOString() };
    }
  }

  private async saveWorkers(file: WorkerFile): Promise<void> {
    file.last_updated = new Date().toISOString();
    await writeFile(this.workersPath, JSON.stringify(file, null, 2), "utf-8");
  }

  private async saveWorker(worker: WorkerAssignment): Promise<void> {
    const file = await this.loadWorkers();
    const idx = file.workers.findIndex((w) => w.id === worker.id);
    if (idx >= 0) {
      file.workers[idx] = worker;
    } else {
      file.workers.push(worker);
    }
    await this.saveWorkers(file);
  }
}
