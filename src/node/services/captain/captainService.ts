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
// LLM Provider (injected by ServiceContainer, same pattern as SimulationService)
// ---------------------------------------------------------------------------

export interface CaptainLLMProvider {
  /** Call the LLM with a system prompt and user prompt, return text response. */
  chat(opts: {
    provider: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Captain Service
// ---------------------------------------------------------------------------

export class CaptainService extends EventEmitter {
  private loop: CaptainCognitiveLoop | null = null;
  private projectDir: string | null = null;
  private llmProvider: CaptainLLMProvider | null = null;
  private messageLog: Array<{ role: string; content: string; timestamp: number }> = [];

  // Accumulated canvas state for new subscribers
  private canvasNodes: CaptainCanvasNode[] = [];
  private canvasEdges: CaptainCanvasEdge[] = [];

  /** Set the LLM provider (called by ServiceContainer during wiring). */
  setLLMProvider(provider: CaptainLLMProvider): void {
    this.llmProvider = provider;
  }

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

  /**
   * Auto-wire LLM provider as the send function.
   * Uses the same AIService.createModel + generateText pattern as SimulationService.
   * This bypasses AgentSession for simplicity — the Captain calls the LLM directly.
   */
  private autoWireLLM(): void {
    if (!this.loop || !this.llmProvider) return;

    const provider = this.llmProvider;
    this.loop.setSendFunction(async (cognitivePrompt: string) => {
      try {
        const identity = await this.getIdentity();
        const systemPrompt = [
          `You are ${identity.name}, an autonomous AI captain.`,
          `Traits: ${identity.personality.traits.join(", ")}`,
          `Values: ${identity.personality.values.join(", ")}`,
          `Style: ${identity.personality.communication_style}`,
          "",
          "You think independently. Each message is one cognitive cycle.",
          "Analyze the events, reflect, decide what to do, and act.",
          'If you want to message the user, prefix with "USER: ".',
          'If you want to store a memory, prefix with "MEMORY: ".',
          "Otherwise, just think and plan.",
        ].join("\n");

        const response = await provider.chat({
          provider: "anthropic",
          model: identity.preferences.default_model ?? "claude-sonnet-4-6",
          systemPrompt,
          userPrompt: cognitivePrompt,
          temperature: 0.7,
        });

        // Parse response for user messages and memories
        this.processLLMResponse(response);

        return response;
      } catch (error) {
        log.error("[Captain] LLM call failed:", error);
        return null;
      }
    });
  }

  /** Parse LLM response for user messages (USER:) and memories (MEMORY:). */
  private processLLMResponse(response: string): void {
    const lines = response.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("USER:")) {
        const message = trimmed.slice(5).trim();
        if (message) {
          this.messageLog.push({ role: "captain", content: message, timestamp: Date.now() });
          this.emit("message", message);
          log.info(`[Captain] → User: ${message.slice(0, 80)}...`);
        }
      } else if (trimmed.startsWith("MEMORY:")) {
        const content = trimmed.slice(7).trim();
        if (content && this.loop) {
          void this.loop.memory.store("episodic", content, 0.7, { source: "self_reflection" });
          log.info(`[Captain] Stored memory: ${content.slice(0, 60)}...`);
        }
      }
    }
  }

  /** Start the cognitive loop. Auto-wires LLM if available. */
  enable(): void {
    if (!this.loop) throw new Error("Captain not initialized");
    // Auto-wire LLM provider if no send function was manually set
    if (this.llmProvider) {
      this.autoWireLLM();
    }
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
