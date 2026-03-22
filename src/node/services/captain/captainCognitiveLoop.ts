/**
 * Captain Cognitive Loop
 *
 * The heart of the autonomous mind. Runs on a configurable interval,
 * executing the Perceive → Reflect → Decide → Act cycle.
 *
 * Instead of reimplementing LLM calls and tool execution, we send
 * "internal messages" to the Captain's own AgentSession. This reuses
 * the entire existing pipeline: autonomy, tools, reflexion, streaming.
 *
 * The cognitive loop IS the Captain thinking to itself.
 */

import { EventEmitter } from "events";
import { log } from "@/node/services/log";
import { CaptainMemory } from "./captainMemory";
import { CaptainPerception } from "./captainPerception";
import { CaptainGoalManager } from "./captainGoals";
import { CaptainInitiative } from "./captainInitiative";
import type {
  CaptainConfig,
  CognitiveTickResult,
  PerceptionEvent,
  CaptainCanvasNode,
  CaptainCanvasEdge,
} from "./types";
import { DEFAULT_CAPTAIN_CONFIG } from "./types";

// ---------------------------------------------------------------------------
// Events emitted by the cognitive loop
// ---------------------------------------------------------------------------

export interface CaptainLoopEvents {
  /** Emitted after each cognitive tick with full result. */
  tick: (result: CognitiveTickResult) => void;
  /** Emitted when captain wants to message the user. */
  message: (content: string) => void;
  /** Emitted for canvas visualization updates. */
  canvasUpdate: (nodes: CaptainCanvasNode[], edges: CaptainCanvasEdge[]) => void;
  /** Emitted on start/stop. */
  stateChange: (running: boolean) => void;
  /** Emitted on error. */
  error: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Cognitive Loop
// ---------------------------------------------------------------------------

export class CaptainCognitiveLoop extends EventEmitter {
  private readonly config: CaptainConfig;

  // Sub-systems
  readonly memory: CaptainMemory;
  readonly perception: CaptainPerception;
  readonly goals: CaptainGoalManager;
  readonly initiative: CaptainInitiative;

  // State
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickCount: number = 0;
  private skipCount: number = 0;
  private running: boolean = false;
  private processing: boolean = false; // Lock to prevent overlapping ticks

  // Send function — injected by the wiring layer (connects to AgentSession)
  private sendInternalMessage:
    | ((message: string) => Promise<string | null>)
    | null = null;

  constructor(projectDir: string, config?: Partial<CaptainConfig>) {
    super();
    this.config = { ...DEFAULT_CAPTAIN_CONFIG, ...config };

    this.memory = new CaptainMemory(projectDir);
    this.perception = new CaptainPerception(projectDir);
    this.goals = new CaptainGoalManager(projectDir);
    this.initiative = new CaptainInitiative();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Wire the cognitive loop to an AgentSession's sendMessage function. */
  setSendFunction(fn: (message: string) => Promise<string | null>): void {
    this.sendInternalMessage = fn;
  }

  /** Start the cognitive loop. */
  start(): void {
    if (this.running) return;
    if (!this.sendInternalMessage) {
      throw new Error(
        "Cannot start cognitive loop: sendInternalMessage not wired. Call setSendFunction() first.",
      );
    }

    this.running = true;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.cognitiveInterval);

    this.emit("stateChange", true);
    log.info(
      `[Captain] Cognitive loop started (interval: ${this.config.cognitiveInterval}ms)`,
    );
  }

  /** Stop the cognitive loop. */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.emit("stateChange", false);
    log.info("[Captain] Cognitive loop stopped");
  }

  /** Check if the loop is running. */
  isRunning(): boolean {
    return this.running;
  }

  /** Get current tick count. */
  getTickCount(): number {
    return this.tickCount;
  }

  // ---------------------------------------------------------------------------
  // Core Tick
  // ---------------------------------------------------------------------------

  /** Execute one cognitive cycle: Perceive → Reflect → Decide → Act */
  private async tick(): Promise<void> {
    // Prevent overlapping ticks (previous one might still be processing)
    if (this.processing) return;
    this.processing = true;

    try {
      // 1. PERCEIVE
      const events = await this.perception.perceive();

      // Cost control: skip LLM if nothing happened
      if (
        this.config.skipIfNoInputs &&
        events.length === 0 &&
        this.skipCount < this.config.maxConsecutiveSkips
      ) {
        this.skipCount++;
        const result: CognitiveTickResult = {
          tickNumber: this.tickCount++,
          timestamp: Date.now(),
          events: [],
          decisions: [],
          tokensUsed: 0,
          skipped: true,
        };
        this.emit("tick", result);
        return;
      }
      this.skipCount = 0;

      // 2-4. REFLECT → DECIDE → ACT
      // Build the cognitive prompt and send to AgentSession
      const prompt = await this.buildCognitivePrompt(events);

      if (this.sendInternalMessage) {
        const response = await this.sendInternalMessage(prompt);
        // The AgentSession handles tool execution, streaming, etc.
        // Response comes back as text (the Captain's thoughts/actions)

        const result: CognitiveTickResult = {
          tickNumber: this.tickCount,
          timestamp: Date.now(),
          events,
          reflection: response ?? undefined,
          decisions: [], // Parsed from response by the caller if needed
          tokensUsed: 0, // Will be tracked by the AgentSession's metrics
          skipped: false,
        };

        this.emit("tick", result);
        this.emitCanvasUpdate(result);
      }

      // Periodic memory consolidation
      if (this.tickCount % this.config.memoryConsolidation === 0) {
        const consolidationPrompt = await this.memory.buildConsolidationPrompt();
        if (consolidationPrompt && this.sendInternalMessage) {
          await this.sendInternalMessage(consolidationPrompt);
          log.info("[Captain] Memory consolidation cycle completed");
        }
      }

      // Periodic memory pruning (every 1000 ticks ≈ ~3 hours)
      if (this.tickCount % 1000 === 0) {
        await this.memory.forget(0.3, 30);
      }

      this.tickCount++;
    } catch (error) {
      log.error("[Captain] Cognitive tick error:", error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.processing = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt Construction
  // ---------------------------------------------------------------------------

  /** Build the cognitive prompt for a tick. */
  private async buildCognitivePrompt(
    events: PerceptionEvent[],
  ): Promise<string> {
    const sections: string[] = [];

    // Memory context
    const memoryContext = await this.memory.buildContextBlock();
    if (memoryContext) sections.push(memoryContext);

    // Goal context
    const goalContext = await this.goals.buildGoalContextBlock();
    sections.push(goalContext);

    // Events
    if (events.length > 0) {
      sections.push("## New Events This Cycle");
      for (const event of events) {
        sections.push(
          `- [${event.type}] (${event.source}): ${event.content}`,
        );
      }
    } else {
      sections.push("## No New Events");
      sections.push("Nothing has changed. You may reflect on current state or pursue your own interests.");
    }

    // Initiative triggers
    const activeGoals = await this.goals.getActiveGoals();
    const initiativeActions = this.initiative.evaluate(
      events,
      activeGoals.length > 0,
      events.length > 0,
    );
    if (initiativeActions.length > 0) {
      sections.push("## Initiative Triggers");
      for (const action of initiativeActions) {
        sections.push(`- Consider: ${action}`);
      }
    }

    // Instructions
    sections.push(
      "",
      "## Your Turn",
      "Run your cognitive cycle: Perceive the events above, Reflect on what they mean,",
      "Decide what to do, then Act.",
      "",
      "Available actions:",
      "- Use tools to spawn workers, research topics, or manage agents",
      '- Respond with a message for the user (prefix with "USER: ")',
      '- Store a memory (prefix with "MEMORY: ")',
      "- Take no action if nothing needs your attention",
      "",
      "Think step by step. Be the Captain.",
    );

    return sections.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Canvas Visualization
  // ---------------------------------------------------------------------------

  /** Emit canvas nodes/edges for the React Flow visualization. */
  private emitCanvasUpdate(result: CognitiveTickResult): void {
    const nodes: CaptainCanvasNode[] = [];
    const edges: CaptainCanvasEdge[] = [];

    // Cognitive tick node
    const tickNodeId = `tick-${result.tickNumber}`;
    nodes.push({
      id: tickNodeId,
      type: "cognitiveTick",
      data: {
        tickNumber: result.tickNumber,
        eventsCount: result.events.length,
        skipped: result.skipped,
        reflection: result.reflection?.slice(0, 200),
      },
      timestamp: result.timestamp,
    });

    // Event nodes
    for (const event of result.events) {
      const eventNodeId = `event-${result.tickNumber}-${event.type}-${event.timestamp}`;
      nodes.push({
        id: eventNodeId,
        type: "event",
        data: {
          eventType: event.type,
          source: event.source,
          content: event.content.slice(0, 150),
        },
        timestamp: event.timestamp,
      });
      edges.push({
        id: `edge-${eventNodeId}-${tickNodeId}`,
        source: eventNodeId,
        target: tickNodeId,
        animated: true,
      });
    }

    this.emit("canvasUpdate", nodes, edges);
  }

  // ---------------------------------------------------------------------------
  // External API
  // ---------------------------------------------------------------------------

  /** Submit a user message to the captain. */
  enqueueUserMessage(content: string): void {
    this.perception.enqueueUserMessage(content);
    this.initiative.recordUserInteraction();
  }

  /** Submit a voice transcript. */
  enqueueVoiceTranscript(content: string): void {
    this.perception.enqueueVoiceTranscript(content);
    this.initiative.recordUserInteraction();
  }

  /** Submit a new goal. */
  async submitGoal(
    description: string,
    priority: number = 5,
  ): Promise<string> {
    const goal = await this.goals.createGoal(description, "user", priority);
    return goal.id;
  }
}
