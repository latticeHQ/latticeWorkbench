/**
 * Simulation Service — top-level orchestrator.
 *
 * Follows the OpenBBService pattern:
 * - Status detection via discriminated union
 * - Ref-counted polling with change events
 * - Lifecycle management (initialize, start, stop, dispose)
 *
 * Manages the full simulation pipeline:
 * 1. Graph layer (Graphiti + FalkorDB)
 * 2. Ontology generation (LLM-powered)
 * 3. Agent persona forge (LLM-powered)
 * 4. Simulation runtime (multi-model round loop)
 * 5. Report engine (ReACT analysis)
 * 6. Ensemble runner (multi-run statistics)
 * 7. Accuracy tracking (predicted vs actual)
 *
 * All settings are configurable via UI and persisted in config.
 */

import { EventEmitter } from "events";
import { log } from "@/node/services/log";
import { GraphLayer } from "./graphLayer";
import { SimulationRuntime } from "./simulationRuntime";
import type { LLMProvider, RuntimeCallbacks } from "./simulationRuntime";
import type {
  SimulationServiceStatus,
  SimulationSettings,
  SimulationScenario,
  SimulationConfig,
  RoundResult,
  CreateScenarioInput,
  EnsembleConfig,
  EnsembleResult,
  PredictionRecord,
  SimulationSetupStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;

// ---------------------------------------------------------------------------
// Simulation Service
// ---------------------------------------------------------------------------

export class SimulationService extends EventEmitter {
  private settings: SimulationSettings;
  private graphLayer: GraphLayer;
  private llmProvider: LLMProvider | null = null;

  // Active simulations
  private activeRuntimes: Map<string, SimulationRuntime> = new Map();
  private scenarios: Map<string, SimulationScenario> = new Map();
  private roundResults: Map<string, RoundResult[]> = new Map();

  // Accuracy tracking
  private predictions: Map<string, PredictionRecord> = new Map();

  // Ref-counted polling (like OpenBBService)
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;
  private lastStatusJson = "";

  constructor(settings: SimulationSettings) {
    super();
    this.settings = settings;
    this.graphLayer = new GraphLayer(settings);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the simulation service.
   * Startup-safe: catches all errors, logs, never crashes.
   */
  async initialize(): Promise<void> {
    try {
      // Initialize graph layer (connects to FalkorDB)
      await this.graphLayer.initialize();
      log.info("[simulation] Service initialized");
    } catch (err) {
      log.warn(`[simulation] Non-critical init failure: ${err}`);
    }
  }

  /**
   * Set the LLM provider — called during ServiceContainer wiring.
   * The provider bridges to Anthropic, Google, Lattice Inference, etc.
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Update settings from UI without restarting.
   */
  updateSettings(settings: Partial<SimulationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.graphLayer.updateSettings(this.settings);
    this.lastStatusJson = ""; // Force change event
    log.info("[simulation] Settings updated");
  }

  // ---------------------------------------------------------------------------
  // Status (discriminated union, like OpenBBService)
  // ---------------------------------------------------------------------------

  async getState(): Promise<SimulationServiceStatus> {
    if (!this.llmProvider) {
      return { status: "not_configured" };
    }

    const graphStatus = this.graphLayer.status;

    if (this.activeRuntimes.size > 0) {
      const firstRuntime = this.activeRuntimes.values().next().value!;
      const state = firstRuntime.runState;
      return {
        status: "running",
        simulationId: state.simulationId,
        progress: state.totalRounds > 0
          ? state.currentRound / state.totalRounds
          : 0,
      };
    }

    return {
      status: "ready",
      graphDbConnected: graphStatus.status === "connected",
      activeSimulations: this.activeRuntimes.size,
    };
  }

  // ---------------------------------------------------------------------------
  // Polling (like OpenBBService)
  // ---------------------------------------------------------------------------

  startPolling(): void {
    this.subscriberCount++;
    if (this.pollTimer) return;

    const poll = async () => {
      try {
        const state = await this.getState();
        const json = JSON.stringify(state);
        if (json !== this.lastStatusJson) {
          this.lastStatusJson = json;
          this.emit("change", state);
        }
      } catch (err) {
        log.error(`[simulation] poll error: ${err}`);
      }
    };

    void poll();
    this.pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  onChange(handler: (state: SimulationServiceStatus) => void): () => void {
    this.on("change", handler);
    return () => this.off("change", handler);
  }

  // ---------------------------------------------------------------------------
  // Setup / Dependency Check
  // ---------------------------------------------------------------------------

  /**
   * Check simulation engine dependencies.
   * Returns a requirements checklist for the setup UI.
   */
  async checkSetup(): Promise<SimulationSetupStatus> {
    // Check if provider can actually create models (has API keys configured)
    let providerAvailable = !!this.llmProvider;
    if (this.llmProvider?.checkAvailability) {
      try {
        providerAvailable = await this.llmProvider.checkAvailability();
      } catch {
        providerAvailable = false;
      }
    }

    const result: SimulationSetupStatus = {
      llmProviderConfigured: providerAvailable,
      graphDbConfigured: !!(this.settings.graphDb.host && this.settings.graphDb.port),
      graphDbConnected: false,
      graphDbHost: this.settings.graphDb.host,
      graphDbPort: this.settings.graphDb.port,
      dockerAvailable: false,
      falkorDbContainerRunning: false,
      ready: false,
    };

    // Check FalkorDB connectivity — attempt reconnect if not connected
    try {
      let graphStatus = this.graphLayer.status;
      if (graphStatus.status !== "connected") {
        // Try to reconnect — container may have started since last init
        await this.graphLayer.initialize();
        graphStatus = this.graphLayer.status;
      }
      result.graphDbConnected = graphStatus.status === "connected";
    } catch {
      // Not connected
    }

    // Check Docker availability
    try {
      const { execSync } = await import("child_process");
      execSync("docker info", { stdio: "ignore", timeout: 5000 });
      result.dockerAvailable = true;

      // Check if FalkorDB container is running
      const output = execSync("docker ps --filter ancestor=falkordb/falkordb --format '{{.Names}}'", {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      result.falkorDbContainerRunning = output.length > 0;
    } catch {
      // Docker not available or not running
    }

    // Ready if LLM provider is configured (graph DB is optional but recommended)
    result.ready = result.llmProviderConfigured;

    return result;
  }

  // ---------------------------------------------------------------------------
  // Scenario Management
  // ---------------------------------------------------------------------------

  async createScenario(input: CreateScenarioInput): Promise<SimulationScenario> {
    const id = `scenario_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Detect department from input or infer from description
    const department = input.department ?? this.inferDepartment(input.description);

    // Get template defaults
    const template = this.settings.departmentTemplates[department]
      ?? this.settings.departmentTemplates.marketing;

    const config: SimulationConfig = {
      totalRounds: input.rounds ?? template.defaultRounds,
      minutesPerRound: 60,
      totalSimulationHours: (input.rounds ?? template.defaultRounds) * 1,
      platforms: input.platforms ?? template.platforms,
      socialDynamics: this.settings.socialDynamics,
      modelRouting: input.modelRouting
        ? { routes: { ...this.settings.modelRouting.routes, ...input.modelRouting } } as any
        : undefined,
      initialEvents: [],
      scheduledEvents: [],
      department: department as any,
    };

    // Generate agents from template archetypes (rule-based, no LLM needed)
    const { generateTemplateAgents } = await import("./agentForge");
    const { agents, statisticalAgents } = generateTemplateAgents(
      template,
      input.description,
    );

    const scenario: SimulationScenario = {
      id,
      name: input.name,
      description: input.description,
      projectId: "",
      graphId: "",
      ontology: { entityTypes: [], edgeTypes: [], analysisSummary: "" },
      agents,
      statisticalAgents,
      config,
      seedDocuments: input.seedDocuments.map((d) => d.filename),
      createdAt: new Date().toISOString(),
      status: "created",
    };

    this.scenarios.set(id, scenario);
    log.info(`[simulation] Scenario created: ${id} (${department}) with ${agents.length} agents + ${statisticalAgents.length} statistical`);
    return scenario;
  }

  getScenario(id: string): SimulationScenario | undefined {
    return this.scenarios.get(id);
  }

  listScenarios(): SimulationScenario[] {
    return [...this.scenarios.values()];
  }

  // ---------------------------------------------------------------------------
  // Simulation Execution
  // ---------------------------------------------------------------------------

  /**
   * Run a simulation scenario. Returns an async generator for real-time streaming.
   */
  async *runSimulation(
    scenarioId: string,
    callbacks?: RuntimeCallbacks,
  ): AsyncGenerator<RoundResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);
    if (!this.llmProvider) throw new Error("LLM provider not configured");

    scenario.status = "running";

    const runtime = new SimulationRuntime(
      scenario,
      this.llmProvider,
      this.graphLayer,
      this.settings.modelRouting,
      {
        onRoundComplete: (result) => {
          this.emit("round", { scenarioId, result });
          callbacks?.onRoundComplete?.(result);
        },
        onStatusChange: (status) => {
          this.lastStatusJson = "";
          callbacks?.onStatusChange?.(status);
        },
        onError: callbacks?.onError,
        onModelLoadRequired: (provider, model, status) => {
          log.info(`[simulation] Model load event: ${provider}:${model} → ${status}`);
          this.emit("model-load", { provider, model, status });
          callbacks?.onModelLoadRequired?.(provider, model, status);
        },
      },
    );

    this.activeRuntimes.set(scenarioId, runtime);
    this.roundResults.set(scenarioId, []);

    try {
      for await (const result of runtime.execute()) {
        this.roundResults.get(scenarioId)!.push(result);
        yield result;
      }
      scenario.status = "completed";
    } catch (err) {
      scenario.status = "failed";
      throw err;
    } finally {
      this.activeRuntimes.delete(scenarioId);
      this.lastStatusJson = "";
    }
  }

  /**
   * Stop a running simulation.
   */
  stopSimulation(scenarioId: string): void {
    const runtime = this.activeRuntimes.get(scenarioId);
    if (runtime) {
      runtime.stop();
      log.info(`[simulation] Stopping simulation for scenario ${scenarioId}`);
    }
  }

  /**
   * Get results for a completed simulation.
   */
  getResults(scenarioId: string): RoundResult[] {
    return this.roundResults.get(scenarioId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Ensemble Runner
  // ---------------------------------------------------------------------------

  async runEnsemble(
    scenarioId: string,
    config?: EnsembleConfig,
  ): Promise<EnsembleResult> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    const ensembleConfig = config ?? this.settings.defaultEnsemble;
    const runSummaries: EnsembleResult["runSummaries"] = [];
    const sentiments: number[] = [];

    for (let run = 0; run < ensembleConfig.runs; run++) {
      // Create a variant scenario with personality variance
      const variantScenario = this.createVariantScenario(
        scenario,
        ensembleConfig.personalityVariance,
        ensembleConfig.initialConditionVariance,
      );

      // Run the variant
      let lastResult: RoundResult | undefined;
      const allActions: RoundResult[] = [];

      for await (const result of this.runSimulation(variantScenario.id)) {
        lastResult = result;
        allActions.push(result);
      }

      if (lastResult) {
        const finalSentiment =
          lastResult.sentimentDistribution.positive -
          lastResult.sentimentDistribution.negative;
        sentiments.push(finalSentiment);

        runSummaries.push({
          runIndex: run,
          finalSentiment,
          totalActions: allActions.reduce((sum, r) => sum + r.actions.length, 0),
          topPost: lastResult.platformSnapshot.topPosts[0]?.content ?? "",
          viralContentCount: lastResult.viralPosts.length,
          consensusReached: Math.abs(finalSentiment) > 0.6,
        });
      }
    }

    // Compute statistics
    const meanSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    const variance =
      sentiments.reduce((sum, s) => sum + (s - meanSentiment) ** 2, 0) /
      sentiments.length;
    const stdDev = Math.sqrt(variance);

    // 95% confidence interval
    const z = 1.96;
    const margin = z * (stdDev / Math.sqrt(sentiments.length));

    // Detect outliers (>2 std devs from mean)
    const outlierRuns = sentiments
      .map((s, i) => ({ sentiment: s, index: i }))
      .filter((s) => Math.abs(s.sentiment - meanSentiment) > 2 * stdDev)
      .map((s) => s.index);

    return {
      scenarioId,
      totalRuns: ensembleConfig.runs,
      completedRuns: runSummaries.length,
      meanSentiment,
      sentimentStdDev: stdDev,
      confidenceInterval95: {
        low: meanSentiment - margin,
        high: meanSentiment + margin,
      },
      runSummaries,
      outlierRuns,
      outlierReasons: outlierRuns.map(
        (i) => `Run ${i}: sentiment ${sentiments[i].toFixed(2)} deviates >2σ from mean`,
      ),
      convergenceRound: undefined, // TODO: detect convergence
      consensusPercentage:
        runSummaries.filter((r) => r.consensusReached).length / runSummaries.length,
    };
  }

  private createVariantScenario(
    base: SimulationScenario,
    personalityVariance: number,
    _conditionVariance: number,
  ): SimulationScenario {
    const variantId = `${base.id}_variant_${Date.now().toString(36)}`;

    // Create agents with personality variance
    const variantAgents = base.agents.map((agent) => ({
      ...agent,
      id: `${agent.id}_v${Math.random().toString(36).slice(2, 5)}`,
      sentimentBias: agent.sentimentBias + (Math.random() - 0.5) * personalityVariance,
      activityLevel: clamp(
        agent.activityLevel + (Math.random() - 0.5) * personalityVariance * 0.5,
        0.05,
        1.0,
      ),
      influenceWeight: clamp(
        agent.influenceWeight + (Math.random() - 0.5) * personalityVariance,
        0.1,
        5.0,
      ),
    }));

    const variant: SimulationScenario = {
      ...base,
      id: variantId,
      agents: variantAgents,
      status: "ready",
    };

    this.scenarios.set(variantId, variant);
    return variant;
  }

  // ---------------------------------------------------------------------------
  // Accuracy Tracking
  // ---------------------------------------------------------------------------

  recordPrediction(_scenarioId: string, prediction: Omit<PredictionRecord, "id">): void {
    const id = `pred_${Date.now().toString(36)}`;
    this.predictions.set(id, { ...prediction, id });
  }

  recordActualOutcome(
    predictionId: string,
    outcome: { actualSentiment: number; actualEngagement: "low" | "medium" | "high"; actualOutcome: string },
  ): void {
    const prediction = this.predictions.get(predictionId);
    if (!prediction) return;

    prediction.actualSentiment = outcome.actualSentiment;
    prediction.actualEngagement = outcome.actualEngagement;
    prediction.actualOutcome = outcome.actualOutcome;
    prediction.validatedAt = new Date().toISOString();

    // Compute accuracy
    if (prediction.actualSentiment !== undefined) {
      const sentimentAccuracy = 1 - Math.abs(prediction.predictedSentiment - prediction.actualSentiment);
      const engagementAccuracy = prediction.predictedEngagement === prediction.actualEngagement ? 1 : 0;
      prediction.accuracyScore = (sentimentAccuracy + engagementAccuracy) / 2;
    }
  }

  getAccuracyHistory(): PredictionRecord[] {
    return [...this.predictions.values()].filter((p) => p.validatedAt);
  }

  // ---------------------------------------------------------------------------
  // Department Inference
  // ---------------------------------------------------------------------------

  private inferDepartment(description: string): string {
    const lower = description.toLowerCase();

    for (const [dept, template] of Object.entries(this.settings.departmentTemplates)) {
      const matchCount = template.inferTriggers.filter((t) => lower.includes(t)).length;
      if (matchCount >= 2) return dept;
    }

    return "marketing"; // Default
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  async dispose(): Promise<void> {
    // Stop all active simulations
    for (const [_id, runtime] of this.activeRuntimes) {
      runtime.stop();
    }
    this.activeRuntimes.clear();

    // Clean up graph layer
    await this.graphLayer.dispose();

    // Clear polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.subscriberCount = 0;
    this.removeAllListeners();

    log.info("[simulation] Service disposed");
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
