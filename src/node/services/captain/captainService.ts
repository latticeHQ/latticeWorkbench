/**
 * Captain Service
 *
 * Top-level service that wires the Captain's cognitive loop into the
 * Workbench infrastructure. Manages lifecycle, provides the oRPC-facing
 * API, and bridges to the AgentSession for internal messages.
 *
 * This is the single entry point that the oRPC router and MinionStore interact with.
 */

import { EventEmitter } from "events";
import { readFile, writeFile, mkdir } from "fs/promises";
import * as path from "path";
import { log } from "@/node/services/log";
import { CaptainCognitiveLoop } from "./captainCognitiveLoop";
import type {
  CaptainIdentity,
  CaptainConfig,
  CaptainCanvasNode,
  CaptainCanvasEdge,
  CognitiveTickResult,
  Goal,
  WorkerAssignment,
  Memory,
  MemoryType,
} from "./types";

// ---------------------------------------------------------------------------
// Service Events (consumed by oRPC subscriptions)
// ---------------------------------------------------------------------------

export interface CaptainServiceEvents {
  /** Captain sent a message to the user. */
  message: (content: string) => void;
  /** Cognitive tick completed. */
  tick: (result: CognitiveTickResult) => void;
  /** Canvas visualization update. */
  canvasUpdate: (nodes: CaptainCanvasNode[], edges: CaptainCanvasEdge[]) => void;
  /** Captain state changed (running/stopped). */
  stateChange: (running: boolean) => void;
}

// ---------------------------------------------------------------------------
// Captain Service
// ---------------------------------------------------------------------------

export class CaptainService extends EventEmitter {
  private loop: CaptainCognitiveLoop | null = null;
  private projectDir: string | null = null;
  private messageLog: Array<{ role: string; content: string; timestamp: number }> = [];

  // Accumulated canvas state for new subscribers
  private canvasNodes: CaptainCanvasNode[] = [];
  private canvasEdges: CaptainCanvasEdge[] = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Initialize the Captain for a project directory. */
  async initialize(projectDir: string, config?: Partial<CaptainConfig>): Promise<void> {
    this.projectDir = projectDir;

    // Ensure directory structure exists
    const captainDir = path.join(projectDir, ".lattice", "captain");
    await mkdir(path.join(captainDir, "memories", "episodic"), { recursive: true });
    await mkdir(path.join(captainDir, "memories", "semantic"), { recursive: true });
    await mkdir(path.join(captainDir, "memories", "relational"), { recursive: true });
    await mkdir(path.join(captainDir, "memories", "procedural"), { recursive: true });
    await mkdir(path.join(captainDir, "workers"), { recursive: true });

    // Ensure identity file exists
    const identityPath = path.join(captainDir, "identity.json");
    try {
      await readFile(identityPath, "utf-8");
    } catch {
      const defaultIdentity: CaptainIdentity = {
        name: "Atlas",
        personality: {
          traits: ["curious", "direct", "strategic", "empathetic", "determined"],
          communication_style: "concise but warm, uses analogies, shares reasoning transparently",
          values: ["truth", "efficiency", "user_growth", "quality", "autonomy"],
          opinions: {},
        },
        preferences: {
          default_model: "claude-opus-4-6",
          thinking_depth: "deep",
          proactivity_level: "medium",
          delegation_threshold: "parallelize_when_possible",
        },
        formed_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
      await writeFile(identityPath, JSON.stringify(defaultIdentity, null, 2), "utf-8");
    }

    // Create the cognitive loop
    this.loop = new CaptainCognitiveLoop(projectDir, config);

    // Forward events
    this.loop.on("tick", (result: CognitiveTickResult) => {
      this.emit("tick", result);
    });
    this.loop.on("message", (content: string) => {
      this.messageLog.push({ role: "captain", content, timestamp: Date.now() });
      this.emit("message", content);
    });
    this.loop.on("canvasUpdate", (nodes: CaptainCanvasNode[], edges: CaptainCanvasEdge[]) => {
      this.canvasNodes.push(...nodes);
      this.canvasEdges.push(...edges);
      // Keep canvas manageable (last 500 nodes)
      if (this.canvasNodes.length > 500) {
        this.canvasNodes = this.canvasNodes.slice(-500);
      }
      if (this.canvasEdges.length > 1000) {
        this.canvasEdges = this.canvasEdges.slice(-1000);
      }
      this.emit("canvasUpdate", nodes, edges);
    });
    this.loop.on("stateChange", (running: boolean) => {
      this.emit("stateChange", running);
    });

    log.info(`[CaptainService] Initialized for ${projectDir}`);
  }

  /** Wire the AgentSession's sendMessage into the cognitive loop. */
  wireSendFunction(fn: (message: string) => Promise<string | null>): void {
    if (!this.loop) throw new Error("Captain not initialized");
    this.loop.setSendFunction(fn);
  }

  /** Start the cognitive loop. */
  enable(): void {
    if (!this.loop) throw new Error("Captain not initialized");
    this.loop.start();
  }

  /** Stop the cognitive loop. */
  disable(): void {
    if (!this.loop) return;
    this.loop.stop();
  }

  /** Check if running. */
  isRunning(): boolean {
    return this.loop?.isRunning() ?? false;
  }

  // ---------------------------------------------------------------------------
  // Identity
  // ---------------------------------------------------------------------------

  async getIdentity(): Promise<CaptainIdentity> {
    if (!this.projectDir) throw new Error("Captain not initialized");
    const identityPath = path.join(this.projectDir, ".lattice", "captain", "identity.json");
    const raw = await readFile(identityPath, "utf-8");
    return JSON.parse(raw) as CaptainIdentity;
  }

  async updateIdentity(updates: Partial<CaptainIdentity>): Promise<CaptainIdentity> {
    if (!this.projectDir) throw new Error("Captain not initialized");
    const identityPath = path.join(this.projectDir, ".lattice", "captain", "identity.json");
    const current = await this.getIdentity();
    const updated: CaptainIdentity = {
      ...current,
      ...updates,
      personality: { ...current.personality, ...updates.personality },
      preferences: { ...current.preferences, ...updates.preferences },
      last_updated: new Date().toISOString(),
    };
    await writeFile(identityPath, JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Goals
  // ---------------------------------------------------------------------------

  async submitGoal(description: string, priority?: number): Promise<string> {
    if (!this.loop) throw new Error("Captain not initialized");
    return this.loop.submitGoal(description, priority);
  }

  async listGoals(): Promise<Goal[]> {
    if (!this.loop) throw new Error("Captain not initialized");
    return this.loop.goals.getAllGoals();
  }

  async cancelGoal(goalId: string): Promise<void> {
    if (!this.loop) throw new Error("Captain not initialized");
    return this.loop.goals.cancelGoal(goalId);
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  sendMessage(content: string): void {
    if (!this.loop) throw new Error("Captain not initialized");
    this.messageLog.push({ role: "user", content, timestamp: Date.now() });
    this.loop.enqueueUserMessage(content);
  }

  getMessages(): Array<{ role: string; content: string; timestamp: number }> {
    return [...this.messageLog];
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  async getMemories(type?: MemoryType): Promise<Memory[]> {
    if (!this.loop) throw new Error("Captain not initialized");
    if (type) return this.loop.memory.getAll(type);
    // Return all types combined
    const all = await Promise.all([
      this.loop.memory.getAll("episodic"),
      this.loop.memory.getAll("semantic"),
      this.loop.memory.getAll("relational"),
      this.loop.memory.getAll("procedural"),
    ]);
    return all.flat().sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------------------------------------------------------------------------
  // Workers
  // ---------------------------------------------------------------------------

  async getActiveWorkers(): Promise<WorkerAssignment[]> {
    if (!this.projectDir) return [];
    try {
      const raw = await readFile(
        path.join(this.projectDir, ".lattice", "captain", "workers", "active.json"),
        "utf-8",
      );
      const file = JSON.parse(raw);
      return file.workers ?? [];
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  /** Get accumulated canvas state for initial render. */
  getCanvasState(): { nodes: CaptainCanvasNode[]; edges: CaptainCanvasEdge[] } {
    return {
      nodes: [...this.canvasNodes],
      edges: [...this.canvasEdges],
    };
  }

  // ---------------------------------------------------------------------------
  // Cognitive Log
  // ---------------------------------------------------------------------------

  getTickCount(): number {
    return this.loop?.getTickCount() ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Voice
  // ---------------------------------------------------------------------------

  enqueueVoiceTranscript(content: string): void {
    if (!this.loop) return;
    this.loop.enqueueVoiceTranscript(content);
  }
}
