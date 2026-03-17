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
  PopulationMetrics,
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

  /**
   * Try to load a model in the local inference engine.
   * Returns true if the model was loaded, false if not available.
   */
  tryLoadModel?(model: string): Promise<boolean>;

  /**
   * Discover all available providers that can handle chat requests.
   * Returns an array of { provider, model } pairs that are ready to use.
   * Used for dynamic fallback — no hardcoded provider list.
   */
  discoverFallbackProviders?(): Promise<Array<{ provider: string; model: string }>>;
}

export interface RuntimeCallbacks {
  onRoundComplete?: (result: RoundResult) => void;
  onStatusChange?: (status: RunStatus) => void;
  onError?: (error: Error) => void;
  /** Called when the runtime detects a model needs loading (UI can show notification) */
  onModelLoadRequired?: (provider: string, model: string, status: "loading" | "loaded" | "failed") => void;
}

/** Configurable runtime parameters — all settable via Settings UI */
export interface RuntimeOptions {
  /** How many LLM agents to process in parallel per round (default: 3) */
  agentBatchSize: number;
  /** Timeout per agent LLM decision in ms (default: 120000) */
  agentTimeoutMs: number;
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
  private readonly options: RuntimeOptions;

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
    options: Partial<RuntimeOptions> = {},
  ) {
    this.scenario = scenario;
    this.llm = llm;
    this.graphLayer = graphLayer;
    this.modelRouting = modelRouting;
    this.callbacks = callbacks;
    this.options = {
      agentBatchSize: options.agentBatchSize ?? 3,
      agentTimeoutMs: options.agentTimeoutMs ?? 120_000,
    };
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

      // Configurable via Settings UI — no hardcoded values
      const { agentBatchSize, agentTimeoutMs } = this.options;

      for (let batchStart = 0; batchStart < llmAgents.length; batchStart += agentBatchSize) {
        if (this.aborted) break;
        const batch = llmAgents.slice(batchStart, batchStart + agentBatchSize);
        log.info(`[simulation:runtime] Round ${round}: processing batch ${Math.floor(batchStart / agentBatchSize) + 1} (${batch.map(a => a.name).join(", ")})`);

        const decisions = await Promise.allSettled(
          batch.map((agent) => {
            // Wrap each agent decision in a timeout
            return Promise.race([
              this.decideAction(agent, platform, feeds.get(agent.id)!, round),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${agentTimeoutMs}ms`)), agentTimeoutMs),
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

      // 8. Statistical agents (tier 4) — legacy rule-based agents (disabled by default)
      // Only runs if scenario has statistical agents configured
      if (this.scenario.statisticalAgents.length > 0) {
        const recentSentiment = computeSentimentDistribution(allActions, this.agentProfiles);
        const statActions = generateStatisticalActions(
          this.scenario.statisticalAgents,
          new Set(activeAgents.map((a) => a.id)),
          round,
          simulatedHour,
          this.scenario.config.socialDynamics.activitySchedule,
          recentSentiment,
          allActions,
        );
        for (const action of statActions) {
          platform.applyAction(action);
          allActions.push(action);
        }
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

    // Compute population-scale metrics if populationScale is configured
    const populationMetrics = this.computePopulationMetrics(allActions, sentiment);

    return {
      round,
      simulatedHour,
      activeAgentCount: allActions.filter((a) => a.actionType !== "DO_NOTHING").length,
      actions: allActions,
      trending: primaryPlatform.getTrending(),
      viralPosts: primaryPlatform.getViralPosts(),
      sentimentDistribution: sentiment,
      platformSnapshot: primaryPlatform.snapshot(),
      populationMetrics,
    };
  }

  // ---------------------------------------------------------------------------
  // Population Scale Amplification
  // ---------------------------------------------------------------------------

  /**
   * Compute population-scale metrics by amplifying each agent's actions
   * by their followerMultiplier. This turns 20-50 LLM agents into a
   * simulation representing 1M+ people without additional LLM calls.
   *
   * The amplification is configurable via SimulationConfig.populationScale.
   * If populationScale is 0 or not set, returns undefined (raw metrics only).
   */
  private computePopulationMetrics(
    actions: AgentAction[],
    _rawSentiment: { positive: number; neutral: number; negative: number },
  ): PopulationMetrics | undefined {
    const targetPopulation = this.scenario.config.populationScale;
    if (!targetPopulation || targetPopulation <= 0) return undefined;

    // Build multiplier map from agent profiles
    // If agents don't have followerMultiplier set yet, auto-compute from populationScale
    const multiplierMap = this.getOrComputeFollowerMultipliers(targetPopulation);

    let amplifiedActions = 0;
    let amplifiedEngagement = 0;
    let totalPopulation = 0;
    let weightedPositive = 0;
    let weightedNeutral = 0;
    let weightedNegative = 0;

    // Per-tier accumulation
    const tierData = new Map<number, { agentCount: number; population: number; actions: number }>();

    // Calculate total population from multipliers
    for (const [agentId, multiplier] of multiplierMap) {
      totalPopulation += multiplier;
      const agent = this.agentProfiles.get(agentId);
      const tier = agent?.tier ?? 2;
      const existing = tierData.get(tier) ?? { agentCount: 0, population: 0, actions: 0 };
      existing.agentCount++;
      existing.population += multiplier;
      tierData.set(tier, existing);
    }

    // Amplify each action by the agent's follower multiplier
    for (const action of actions) {
      if (action.actionType === "DO_NOTHING") continue;

      const multiplier = multiplierMap.get(action.agentId) ?? 1;
      amplifiedActions += multiplier;

      // Engagement actions get higher amplification
      const engagementWeight = this.getEngagementWeight(action.actionType);
      amplifiedEngagement += multiplier * engagementWeight;

      // Weighted sentiment
      const sentimentValue = this.getActionSentimentWeight(action.actionType);
      if (sentimentValue > 0) weightedPositive += multiplier * sentimentValue;
      else if (sentimentValue < 0) weightedNegative += multiplier * Math.abs(sentimentValue);
      else weightedNeutral += multiplier;

      // Per-tier action count
      const agent = this.agentProfiles.get(action.agentId);
      const tier = agent?.tier ?? 2;
      const existing = tierData.get(tier);
      if (existing) existing.actions += multiplier;
    }

    // Normalize population sentiment
    const sentimentTotal = weightedPositive + weightedNeutral + weightedNegative || 1;

    return {
      totalPopulation,
      realAgentCount: this.agentProfiles.size,
      amplifiedActions,
      amplifiedEngagement: Math.round(amplifiedEngagement),
      populationSentiment: {
        positive: weightedPositive / sentimentTotal,
        neutral: weightedNeutral / sentimentTotal,
        negative: weightedNegative / sentimentTotal,
      },
      tierBreakdown: Array.from(tierData.entries())
        .sort(([a], [b]) => a - b)
        .map(([tier, data]) => ({
          tier,
          agentCount: data.agentCount,
          populationRepresented: data.population,
          amplifiedActions: data.actions,
        })),
    };
  }

  /**
   * Get or auto-compute followerMultiplier for each agent based on tier and populationScale.
   *
   * Distribution heuristic (configurable):
   * - Tier 1 (key decision-makers): ~5% of population, high individual influence
   * - Tier 2 (active participants): ~20% of population, moderate cohort size
   * - Tier 3 (crowd/background): ~75% of population, large cohort each
   *
   * These percentages mean each Tier 3 agent represents more people than a Tier 1 agent.
   */
  private getOrComputeFollowerMultipliers(targetPopulation: number): Map<string, number> {
    const map = new Map<string, number>();
    const agentsByTier = new Map<number, AgentProfile[]>();

    for (const [, agent] of this.agentProfiles) {
      const tier = agent.tier ?? 2;
      const list = agentsByTier.get(tier) ?? [];
      list.push(agent);
      agentsByTier.set(tier, list);
    }

    // Check if agents already have followerMultiplier set
    let anySet = false;
    for (const [, agent] of this.agentProfiles) {
      if (agent.followerMultiplier && agent.followerMultiplier > 1) {
        anySet = true;
        break;
      }
    }

    if (anySet) {
      // Use existing multipliers, scale to match target population
      let currentTotal = 0;
      for (const [, agent] of this.agentProfiles) {
        currentTotal += agent.followerMultiplier ?? 1;
      }
      const scaleFactor = targetPopulation / (currentTotal || 1);
      for (const [, agent] of this.agentProfiles) {
        map.set(agent.id, Math.round((agent.followerMultiplier ?? 1) * scaleFactor));
      }
    } else {
      // Auto-compute from tier distribution
      const tierWeights: Record<number, number> = {
        1: 0.05,   // 5% of population — key leaders
        2: 0.20,   // 20% of population — active participants
        3: 0.70,   // 70% of population — background crowd
        4: 0.05,   // 5% of population — statistical (if any remain)
      };

      for (const [tier, agents] of agentsByTier) {
        const weight = tierWeights[tier] ?? 0.1;
        const tierPopulation = targetPopulation * weight;
        const perAgent = Math.max(1, Math.round(tierPopulation / (agents.length || 1)));

        for (const agent of agents) {
          map.set(agent.id, perAgent);
          // Also persist back to the agent profile for downstream use
          agent.followerMultiplier = perAgent;
        }
      }
    }

    return map;
  }

  /** Weight engagement actions differently for amplified metrics */
  private getEngagementWeight(actionType: ActionType): number {
    switch (actionType) {
      case "CREATE_POST": case "PUBLISH_ANALYSIS": return 3.0;
      case "COMMENT": case "REPLY_THREAD": case "SEND_MESSAGE": return 2.0;
      case "MAKE_STATEMENT": case "REBUT": case "ASK_QUESTION": return 2.0;
      case "UPVOTE": case "DOWNVOTE": case "REACT": case "VOTE_FOR": case "VOTE_AGAINST": return 1.0;
      case "BUY": case "SELL": return 5.0;
      case "FOLLOW": case "MUTE": return 0.5;
      default: return 1.0;
    }
  }

  /** Sentiment weight for amplification — positive/negative/neutral */
  private getActionSentimentWeight(actionType: ActionType): number {
    switch (actionType) {
      case "UPVOTE": case "VOTE_FOR": case "BUY": case "FOLLOW": return 1.0;
      case "DOWNVOTE": case "VOTE_AGAINST": case "SELL": case "MUTE": return -1.0;
      default: return 0;
    }
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

    // Dynamic fallback chain: configured provider first, then discover available alternatives
    const primaryRoute = { provider: modelRoute.provider, model: modelRoute.model };

    log.info(`[simulation:runtime] Agent ${agent.name} (tier ${agent.tier}) → ${primaryRoute.provider}:${primaryRoute.model}`);

    const startTime = Date.now();
    let response: string | undefined;
    let lastError: unknown;

    // --- Attempt 1: Primary configured provider ---
    try {
      response = await this.tryProviderWithAutoLoad(agent.name, primaryRoute, systemPrompt, userPrompt);
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      log.warn(`[simulation:runtime] Primary provider ${primaryRoute.provider}:${primaryRoute.model} failed for ${agent.name}: ${errMsg.slice(0, 150)}`);
    }

    // --- Attempt 2: Dynamic fallback — discover all available providers ---
    if (!response || response.trim().length === 0) {
      const fallbacks = await this.llm.discoverFallbackProviders?.() ?? [];
      // Filter out the primary (already tried) and deduplicate
      const alternates = fallbacks.filter(
        (f) => !(f.provider === primaryRoute.provider && f.model === primaryRoute.model),
      );

      if (alternates.length > 0) {
        log.info(`[simulation:runtime] Trying ${alternates.length} fallback provider(s) for ${agent.name}: ${alternates.map(a => `${a.provider}:${a.model}`).join(", ")}`);

        for (const alt of alternates) {
          try {
            response = await this.tryProviderWithAutoLoad(agent.name, alt, systemPrompt, userPrompt);
            if (response && response.trim().length > 0) {
              log.info(`[simulation:runtime] Agent ${agent.name} succeeded via fallback ${alt.provider}:${alt.model}`);
              break;
            }
          } catch (err) {
            lastError = err;
            log.warn(`[simulation:runtime] Fallback ${alt.provider}:${alt.model} also failed for ${agent.name}`);
          }
        }
      }
    }

    // --- All providers exhausted ---
    if (!response || response.trim().length === 0) {
      const elapsed = Date.now() - startTime;
      if (lastError) {
        log.error(`[simulation:runtime] LLM call FAILED for ${agent.name} after ${elapsed}ms — all providers exhausted. Configure a working provider in Settings.`);
        // Signal to UI that no providers are working
        this.callbacks.onModelLoadRequired?.("none", "none", "failed");
        throw lastError;
      }
      log.warn(`[simulation:runtime] Agent ${agent.name} returned EMPTY response`);
      return { agentId: agent.id, thinking: "Empty LLM response", action: "DO_NOTHING" as ActionType };
    }

    const elapsed = Date.now() - startTime;
    log.info(`[simulation:runtime] Agent ${agent.name} responded in ${elapsed}ms (${response.length} chars): ${response.slice(0, 200)}`);

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
   * Try a single provider, with auto-load support for lattice-inference.
   * Returns the response text or throws on failure.
   */
  private async tryProviderWithAutoLoad(
    _agentName: string,
    route: { provider: string; model: string },
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    try {
      const response = await this.llm.chat({
        provider: route.provider,
        model: route.model,
        systemPrompt,
        userPrompt,
        responseFormat: "json",
        temperature: 0.7,
      });
      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Auto-load support for lattice-inference "model_not_loaded" errors
      if (route.provider === "lattice-inference" && errMsg.includes("model_not_loaded") && this.llm.tryLoadModel) {
        log.info(`[simulation:runtime] Model not loaded — attempting auto-load of ${route.model}...`);
        this.callbacks.onModelLoadRequired?.(route.provider, route.model, "loading");

        try {
          const loaded = await this.llm.tryLoadModel(route.model);
          if (loaded) {
            log.info(`[simulation:runtime] Auto-loaded ${route.model} successfully, retrying...`);
            this.callbacks.onModelLoadRequired?.(route.provider, route.model, "loaded");
            return await this.llm.chat({
              provider: route.provider,
              model: route.model,
              systemPrompt,
              userPrompt,
              responseFormat: "json",
              temperature: 0.7,
            });
          } else {
            this.callbacks.onModelLoadRequired?.(route.provider, route.model, "failed");
          }
        } catch (loadErr) {
          log.warn(`[simulation:runtime] Auto-load threw: ${loadErr instanceof Error ? loadErr.message : String(loadErr)}`);
          this.callbacks.onModelLoadRequired?.(route.provider, route.model, "failed");
        }
      }

      throw err;
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
