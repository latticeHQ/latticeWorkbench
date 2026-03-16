/**
 * Simulation Runtime — the core round orchestrator.
 *
 * Executes multi-agent simulations with:
 * - Multi-model routing (Opus/Sonnet/Flash/local per agent tier)
 * - Parallel agent execution within rounds
 * - Social dynamics (recommendation, virality, echo chambers)
 * - Agent memory persistence (Graphiti)
 * - Event injection (mid-simulation shocks)
 * - Real-time progress streaming (via AsyncGenerator → ORPC → UI)
 *
 * All configuration is runtime-switchable via SimulationSettings.
 */

import { log } from "@/node/services/log";
import type {
  AgentAction,
  AgentDecision,
  AgentProfile,
  PlatformType,
  RoundResult,
  SimulationEvent,
  SimulationRunState,
  SimulationScenario,
  ModelRoutingConfig,
  RunStatus,
  ActionType,
} from "./types";
import { resolveModelRoute } from "./types";
import type { PlatformState } from "./platforms/platformInterface";
import { ForumPlatformState } from "./platforms/forumPlatform";
import { ChatPlatformState } from "./platforms/chatPlatform";
import { MeetingPlatformState } from "./platforms/meetingPlatform";
import { MarketPlatformState } from "./platforms/marketPlatform";
import {
  isAgentActive,
  computeSimulatedHour,
  computeSentimentDistribution,
  generateStatisticalActions,
  updateBeliefs,
} from "./socialDynamics";
import type { GraphLayer } from "./graphLayer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * LLM call interface — abstraction over provider-specific APIs.
 * The simulation runtime doesn't know about Anthropic, Google, or Lattice
 * Inference directly. It calls through this interface.
 */
export interface LLMProvider {
  chat(opts: {
    provider: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    responseFormat?: "json";
    temperature?: number;
  }): Promise<string>;

  /**
   * Check if the provider has at least one usable model configured.
   * Returns true if any provider (Anthropic, Google, etc.) has valid credentials.
   */
  checkAvailability?(): Promise<boolean>;
}

export interface RuntimeCallbacks {
  onRoundComplete?: (result: RoundResult) => void;
  onStatusChange?: (status: RunStatus) => void;
  onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Simulation Runtime
// ---------------------------------------------------------------------------

export class SimulationRuntime {
  private readonly scenario: SimulationScenario;
  private readonly llm: LLMProvider;
  private readonly graphLayer: GraphLayer;
  private readonly modelRouting: ModelRoutingConfig;
  private readonly callbacks: RuntimeCallbacks;

  private platforms: Map<PlatformType, PlatformState> = new Map();
  private agentProfiles: Map<string, AgentProfile>;
  private state: SimulationRunState;
  private aborted = false;

  constructor(
    scenario: SimulationScenario,
    llm: LLMProvider,
    graphLayer: GraphLayer,
    modelRouting: ModelRoutingConfig,
    callbacks: RuntimeCallbacks = {},
  ) {
    this.scenario = scenario;
    this.llm = llm;
    this.graphLayer = graphLayer;
    this.modelRouting = modelRouting;
    this.callbacks = callbacks;
    this.agentProfiles = new Map(scenario.agents.map((a) => [a.id, a]));

    this.state = {
      simulationId: generateId(),
      scenarioId: scenario.id,
      status: "idle",
      currentRound: 0,
      totalRounds: scenario.config.totalRounds,
      simulatedHours: 0,
      totalSimulationHours: scenario.config.totalSimulationHours,
      platformProgress: {} as SimulationRunState["platformProgress"],
      recentActions: [],
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    };

    // Initialize platforms
    this.initializePlatforms();
  }

  get runState(): SimulationRunState {
    return this.state;
  }

  /**
   * Execute the full simulation. Returns results as an async generator
   * that yields after each round — enabling real-time UI streaming.
   */
  async *execute(): AsyncGenerator<RoundResult> {
    this.state.status = "running";
    this.state.startedAt = new Date().toISOString();
    this.callbacks.onStatusChange?.("running");

    try {
      // Inject initial events
      for (const event of this.scenario.config.initialEvents) {
        this.injectEvent(event);
      }

      for (let round = 1; round <= this.scenario.config.totalRounds; round++) {
        if (this.aborted) {
          this.state.status = "stopped";
          this.callbacks.onStatusChange?.("stopped");
          return;
        }

        const result = await this.executeRound(round);

        // Update state
        this.state.currentRound = round;
        this.state.simulatedHours = Math.floor(
          (round * this.scenario.config.minutesPerRound) / 60,
        );
        this.state.recentActions = result.actions.slice(-50);

        this.callbacks.onRoundComplete?.(result);
        yield result;
      }

      this.state.status = "completed";
      this.state.completedAt = new Date().toISOString();
      this.callbacks.onStatusChange?.("completed");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.state.status = "failed";
      this.state.error = error.message;
      this.callbacks.onStatusChange?.("failed");
      this.callbacks.onError?.(error);
      throw err;
    }
  }

  /**
   * Stop the simulation gracefully after the current round completes.
   */
  stop(): void {
    this.aborted = true;
  }

  /**
   * Inject an event mid-simulation.
   */
  injectEvent(event: SimulationEvent): void {
    for (const [, platform] of this.platforms) {
      if (event.affects === "all" || event.affects.includes(platform.type)) {
        platform.injectEvent(event, this.state.currentRound);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Round Execution
  // ---------------------------------------------------------------------------

  private async executeRound(round: number): Promise<RoundResult> {
    // Offset to start at 9am (work hours) so agents are active from round 1
    const simulatedHour = computeSimulatedHour(
      round,
      this.scenario.config.minutesPerRound,
      9, // startHourOffset — begin at 9am
    );

    const allActions: AgentAction[] = [];

    // Process each platform
    for (const [platformType, platform] of this.platforms) {
      // 1. Check for scheduled events
      const scheduledEvents = this.scenario.config.scheduledEvents.filter(
        (e) => e.round === round,
      );
      for (const event of scheduledEvents) {
        platform.injectEvent(event, round);
      }

      // 2. Determine active agents this round
      const activeAgents = this.scenario.agents.filter((agent) =>
        isAgentActive(agent, simulatedHour, this.scenario.config.socialDynamics.activitySchedule),
      );

      // 3. Generate personalized feeds
      const feeds = new Map<string, ReturnType<PlatformState["getFeed"]>>();
      for (const agent of activeAgents) {
        feeds.set(agent.id, platform.getFeed(agent, round));
      }

      // 4. LLM agents decide in small batches (avoid spawning too many subprocesses)
      const llmAgents = activeAgents.filter((a) => a.tier !== 4);
      log.info(`[simulation:runtime] Round ${round}: ${llmAgents.length} LLM agents, ${activeAgents.length - llmAgents.length} stat agents`);

      const BATCH_SIZE = 3; // Process 3 agents at a time to avoid overwhelming the system
      const AGENT_TIMEOUT_MS = 120_000; // 2 minutes per agent decision

      for (let batchStart = 0; batchStart < llmAgents.length; batchStart += BATCH_SIZE) {
        if (this.aborted) break;
        const batch = llmAgents.slice(batchStart, batchStart + BATCH_SIZE);
        log.info(`[simulation:runtime] Round ${round}: processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1} (${batch.map(a => a.name).join(", ")})`);

        const decisions = await Promise.allSettled(
          batch.map((agent) => {
            // Wrap each agent decision in a timeout
            return Promise.race([
              this.decideAction(agent, platform, feeds.get(agent.id)!, round),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${AGENT_TIMEOUT_MS}ms`)), AGENT_TIMEOUT_MS),
              ),
            ]);
          }),
        );

        // 5. Process decisions and apply actions
        for (let i = 0; i < batch.length; i++) {
          const decision = decisions[i];
          const agent = batch[i];

          if (decision.status === "rejected") {
            const reason = decision.reason instanceof Error ? decision.reason.stack ?? decision.reason.message : String(decision.reason);
            log.warn(`[simulation:runtime] Agent ${agent.name} decision FAILED:\n${reason}`);
            continue;
          }

          log.info(`[simulation:runtime] Agent ${agent.name} decided: ${decision.value.action}${decision.value.content ? ` — "${decision.value.content.slice(0, 60)}..."` : ""}`);

          const action: AgentAction = {
            round,
            timestamp: new Date().toISOString(),
            platform: platformType,
            agentId: agent.id,
            agentName: agent.name,
            actionType: decision.value.action,
            target: decision.value.target,
            content: decision.value.content,
            thinking: decision.value.thinking,
            success: true,
          };

          const result = platform.applyAction(action);
          action.success = result.success;
          action.result = result.message;
          allActions.push(action);

          // 6. Store memory in graph
          await this.storeAgentMemory(agent, action, round).catch((err) => {
            log.warn(`[simulation:runtime] Memory storage failed for ${agent.name}: ${err}`);
          });
        }
      }

      // 7. Update beliefs based on what agents saw
      for (const agent of activeAgents) {
        const feed = feeds.get(agent.id);
        if (feed && feed.length > 0) {
          updateBeliefs(agent, feed, this.agentProfiles);
        }
      }

      // 8. Statistical agents (tier 4) — no LLM calls
      const recentSentiment = computeSentimentDistribution(allActions, this.agentProfiles);
      const statActions = generateStatisticalActions(
        this.scenario.statisticalAgents,
        new Set(activeAgents.map((a) => a.id)),
        round,
        simulatedHour,
        this.scenario.config.socialDynamics.activitySchedule,
        recentSentiment,
      );
      for (const action of statActions) {
        platform.applyAction(action);
        allActions.push(action);
      }

      // 9. End-of-round platform maintenance
      platform.endOfRound(round);

      // 10. Update platform progress
      this.state.platformProgress[platformType] = {
        currentRound: round,
        actionsCount: allActions.filter((a) => a.platform === platformType).length,
        completed: round >= this.scenario.config.totalRounds,
      };
    }

    // Build round result
    const primaryPlatform = this.platforms.values().next().value!;
    const sentiment = computeSentimentDistribution(allActions, this.agentProfiles);

    return {
      round,
      simulatedHour,
      activeAgentCount: allActions.filter((a) => a.actionType !== "DO_NOTHING").length,
      actions: allActions,
      trending: primaryPlatform.getTrending(),
      viralPosts: primaryPlatform.getViralPosts(),
      sentimentDistribution: sentiment,
      platformSnapshot: primaryPlatform.snapshot(),
    };
  }

  // ---------------------------------------------------------------------------
  // Agent Decision (LLM Call)
  // ---------------------------------------------------------------------------

  private async decideAction(
    agent: AgentProfile,
    platform: PlatformState,
    feed: ReturnType<PlatformState["getFeed"]>,
    round: number,
  ): Promise<AgentDecision> {
    // Route to correct model based on agent tier
    const routeKey = `tier${agent.tier}_${agent.tier === 1 ? "reasoning" : "agents"}`;
    const modelRoute = resolveModelRoute(routeKey, this.modelRouting);

    // Get agent memories from graph
    let memories: string[] = [];
    try {
      const agentMemories = await this.graphLayer.getAgentMemories(
        agent.id,
        this.state.simulationId,
        10,
      );
      memories = agentMemories.map(
        (m) => `Round ${m.round}: ${m.content}`,
      );
    } catch {
      // Memory retrieval is best-effort
    }

    const systemPrompt = this.buildAgentSystemPrompt(agent, platform);
    const userPrompt = this.buildRoundPrompt(agent, platform, feed, round, memories);

    log.info(`[simulation:runtime] Agent ${agent.name} (tier ${agent.tier}) → ${modelRoute.provider}:${modelRoute.model}`);

    const startTime = Date.now();
    let response: string;
    try {
      response = await this.llm.chat({
        provider: modelRoute.provider,
        model: modelRoute.model,
        systemPrompt,
        userPrompt,
        responseFormat: "json",
        temperature: 0.7,
      });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      log.error(`[simulation:runtime] LLM call FAILED for ${agent.name} after ${elapsed}ms: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      throw err;
    }

    const elapsed = Date.now() - startTime;
    log.info(`[simulation:runtime] Agent ${agent.name} responded in ${elapsed}ms (${response.length} chars): ${response.slice(0, 200)}`);

    if (!response || response.trim().length === 0) {
      log.warn(`[simulation:runtime] Agent ${agent.name} returned EMPTY response`);
      return { agentId: agent.id, thinking: "Empty LLM response", action: "DO_NOTHING" as ActionType };
    }

    return this.parseDecision(agent.id, response);
  }

  private buildAgentSystemPrompt(
    agent: AgentProfile,
    platform: PlatformState,
  ): string {
    const stances = Object.entries(agent.beliefSystem.stances)
      .map(([topic, value]) => {
        const label = value > 0.3 ? "supports" : value < -0.3 ? "opposes" : "neutral on";
        return `  ${label} ${topic} (${value.toFixed(1)})`;
      })
      .join("\n");

    return `You are ${agent.name}, ${agent.age ?? "unknown age"} years old, ${agent.profession ?? "professional"}.
MBTI: ${agent.mbti ?? "unknown"}. ${agent.persona}

BELIEFS & STANCES:
${stances}

CORE VALUES: ${agent.beliefSystem.coreValues.join(", ")}
FEARS: ${agent.beliefSystem.fears.join(", ")}
GOALS: ${agent.beliefSystem.goals.join(", ")}

COMMUNICATION STYLE: ${agent.communicationStyle}
CURRENT MOOD: ${agent.currentMood}
INTERESTED IN: ${agent.interestedTopics.join(", ")}
INFLUENCE: ${agent.influenceWeight > 2 ? "HIGH — your posts get significant attention" : agent.influenceWeight > 1 ? "MODERATE" : "NORMAL"}

${platform.formatActionInstructions()}`;
  }

  private buildRoundPrompt(
    _agent: AgentProfile,
    platform: PlatformState,
    feed: ReturnType<PlatformState["getFeed"]>,
    round: number,
    memories: string[],
  ): string {
    const feedText = feed.length > 0
      ? feed.map((p) => platform.formatPostForPrompt(p)).join("\n\n")
      : "(No posts in your feed yet — consider creating the first post)";

    const memoryText = memories.length > 0
      ? `\nYOUR MEMORY (what you did previously):\n${memories.join("\n")}`
      : "";

    const trending = platform.getTrending();
    const trendingText = trending.length > 0
      ? `\nTRENDING: ${trending.join(", ")}`
      : "";

    return `=== ROUND ${round} of ${this.scenario.config.totalRounds} ===

YOUR FEED:
${feedText}
${trendingText}
${memoryText}

What do you do this round?`;
  }

  private parseDecision(agentId: string, response: string): AgentDecision {
    const json = this.extractJSON(response);
    try {
      const parsed = JSON.parse(json);
      return {
        agentId,
        thinking: parsed.thinking ?? "",
        action: (parsed.action ?? "DO_NOTHING") as ActionType,
        target: parsed.target ?? undefined,
        content: parsed.content ?? undefined,
      };
    } catch {
      log.warn(`[simulation:runtime] Failed to parse agent decision, response was: ${response.slice(0, 300)}`);
      return {
        agentId,
        thinking: "Failed to parse response",
        action: "DO_NOTHING",
      };
    }
  }

  /**
   * Extract JSON from LLM response that may be wrapped in markdown code fences,
   * conversational text, or other non-JSON content.
   */
  private extractJSON(text: string): string {
    // 1. Try direct parse first (already valid JSON)
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      return trimmed;
    }

    // 2. Extract from markdown code fences: ```json ... ``` or ``` ... ```
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // 3. Find the first { ... } block (greedy — finds outermost braces)
    const braceStart = trimmed.indexOf("{");
    if (braceStart !== -1) {
      // Walk forward to find matching closing brace
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = braceStart; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            return trimmed.slice(braceStart, i + 1);
          }
        }
      }
      // Fallback: just take from first brace to last brace
      const lastBrace = trimmed.lastIndexOf("}");
      if (lastBrace > braceStart) {
        return trimmed.slice(braceStart, lastBrace + 1);
      }
    }

    // 4. Return as-is — will fail JSON.parse and hit the catch block
    return trimmed;
  }

  // ---------------------------------------------------------------------------
  // Memory Storage
  // ---------------------------------------------------------------------------

  private async storeAgentMemory(
    agent: AgentProfile,
    action: AgentAction,
    round: number,
  ): Promise<void> {
    if (action.actionType === "DO_NOTHING") return;

    const content = action.content
      ? `${action.actionType}: "${action.content.slice(0, 200)}"`
      : `${action.actionType} on ${action.target ?? "unknown"}`;

    await this.graphLayer.storeMemory({
      agentId: agent.id,
      simulationId: this.state.simulationId,
      round,
      memoryType: "action",
      content,
    });
  }

  // ---------------------------------------------------------------------------
  // Platform Initialization
  // ---------------------------------------------------------------------------

  private initializePlatforms(): void {
    for (const platformType of this.scenario.config.platforms) {
      switch (platformType) {
        case "forum":
          this.platforms.set(
            "forum",
            new ForumPlatformState(
              this.scenario.config.socialDynamics,
              this.scenario.agents,
            ),
          );
          break;
        case "chat":
          this.platforms.set(
            "chat",
            new ChatPlatformState(
              this.scenario.config.socialDynamics,
              this.scenario.agents,
            ),
          );
          break;
        case "meeting":
          this.platforms.set(
            "meeting",
            new MeetingPlatformState(
              this.scenario.config.socialDynamics,
              this.scenario.agents,
            ),
          );
          break;
        case "market":
          this.platforms.set(
            "market",
            new MarketPlatformState(
              this.scenario.config.socialDynamics,
              this.scenario.agents,
            ),
          );
          break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function generateId(): string {
  return `sim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
