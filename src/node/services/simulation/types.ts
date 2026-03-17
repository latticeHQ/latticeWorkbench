/**
 * Lattice Simulation Engine — Type Definitions
 *
 * Full-fidelity multi-agent simulation system supporting multiple platforms,
 * multi-model agent tiers, ensemble runs, and autonomous orchestration.
 */

// ---------------------------------------------------------------------------
// Model Routing
// ---------------------------------------------------------------------------

export interface ModelRoute {
  provider: string;
  model: string;
}

/**
 * Model routing configuration — fully configurable via UI.
 * All routes are stored in config and can be changed at any time.
 * When new providers are added, they become available without code changes.
 *
 * Defaults are sensible starting points, not hardcoded limits:
 * - Claude Max plan = unlimited Anthropic usage
 * - Google APIs for embeddings + high-context work
 * - Lattice Inference (M3 Ultra MLX) for bulk local work
 */
export interface ModelRoutingConfig {
  routes: Record<string, ModelRoute>;
  /** User can define custom route keys beyond the defaults */
  customRoutes?: Record<string, ModelRoute>;
}

export const DEFAULT_MODEL_ROUTING: ModelRoutingConfig = {
  routes: {
    tier1_reasoning: { provider: "claude-code", model: "claude-opus-4-6" },
    tier2_agents: { provider: "claude-code", model: "claude-sonnet-4-6" },
    tier3_agents: { provider: "claude-code", model: "claude-haiku-4-5" },
    ontology: { provider: "claude-code", model: "claude-sonnet-4-6" },
    persona_generation: { provider: "claude-code", model: "claude-sonnet-4-6" },
    report_react: { provider: "claude-code", model: "claude-opus-4-6" },
    embeddings: { provider: "claude-code", model: "claude-haiku-4-5" },
    classification: { provider: "claude-code", model: "claude-haiku-4-5" },
  },
};

/**
 * Resolves a model route — checks user config first, then defaults.
 * This is the ONLY place model selection happens. Never hardcode a model elsewhere.
 */
export function resolveModelRoute(
  routeKey: string,
  userConfig?: ModelRoutingConfig,
): ModelRoute {
  // User overrides first
  if (userConfig?.routes[routeKey]) return userConfig.routes[routeKey];
  if (userConfig?.customRoutes?.[routeKey]) return userConfig.customRoutes[routeKey];
  // Then defaults
  const defaultRoute = DEFAULT_MODEL_ROUTING.routes[routeKey];
  if (defaultRoute) return defaultRoute;
  // Fallback for unknown keys
  return DEFAULT_MODEL_ROUTING.routes.tier2_agents;
}

// ---------------------------------------------------------------------------
// Agent Tiers
// ---------------------------------------------------------------------------

export enum AgentTier {
  /** Key decision-makers — Claude Opus. Max reasoning quality. */
  Tier1 = 1,
  /** Active participants — Gemini Flash. Fast, strong, high volume. */
  Tier2 = 2,
  /** Background actors — Local Llama 70B on M3 Ultra. Free, good enough. */
  Tier3 = 3,
  /** Statistical crowd — No LLM. Pure probability distributions. */
  Tier4 = 4,
}

// ---------------------------------------------------------------------------
// Ontology
// ---------------------------------------------------------------------------

export interface EntityAttribute {
  name: string;
  type: "text" | "number" | "boolean";
  description: string;
}

export interface EntityTypeDefinition {
  name: string;
  description: string;
  attributes: EntityAttribute[];
  examples: string[];
}

export interface EdgeTypeDefinition {
  name: string;
  description: string;
  sourceTargets: Array<{ source: string; target: string }>;
  attributes: EntityAttribute[];
}

export interface Ontology {
  entityTypes: EntityTypeDefinition[];
  edgeTypes: EdgeTypeDefinition[];
  analysisSummary: string;
}

/** Max entity types (Graphiti/knowledge graph constraint) */
export const MAX_ENTITY_TYPES = 10;
export const MAX_EDGE_TYPES = 10;

/** Reserved attribute names — cannot be used in ontology */
export const RESERVED_ATTRIBUTE_NAMES = new Set([
  "uuid", "name", "group_id", "name_embedding", "summary", "created_at",
]);

// ---------------------------------------------------------------------------
// Knowledge Graph (Graphiti + FalkorDB)
// ---------------------------------------------------------------------------

export interface GraphEntity {
  uuid: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  embedding?: number[];
  createdAt: string;
}

export interface GraphEdge {
  uuid: string;
  sourceUuid: string;
  targetUuid: string;
  type: string;
  attributes: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
}

export interface GraphInfo {
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  entityTypes: string[];
  edgeTypes: string[];
}

// ---------------------------------------------------------------------------
// Agent Profiles & Belief System
// ---------------------------------------------------------------------------

export interface BeliefSystem {
  /** Topic → stance mapping. -1.0 = strongly against, +1.0 = strongly for */
  stances: Record<string, number>;
  /** Core values that don't change easily */
  coreValues: string[];
  /** Fears and concerns */
  fears: string[];
  /** Goals and motivations */
  goals: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  username: string;
  bio: string;
  persona: string;

  // Tier assignment
  tier: AgentTier;

  // Demographics
  age?: number;
  gender?: string;
  mbti?: string;
  country?: string;
  profession?: string;

  // Behavioral
  communicationStyle: string;
  interestedTopics: string[];
  currentMood: string;

  // Cognitive model
  beliefSystem: BeliefSystem;

  // Social dynamics
  activityLevel: number;       // 0.0-1.0
  postsPerHour: number;
  commentsPerHour: number;
  activeHours: number[];       // 0-23
  responseDelayMin: number;    // minutes
  responseDelayMax: number;
  sentimentBias: number;       // -1.0 to 1.0
  stance: "supportive" | "opposing" | "neutral" | "observer";
  influenceWeight: number;     // 1.0 = normal, 3.0 = high influence

  // Follower amplification — each LLM agent represents a cohort of followers
  // who amplify their behavior. A followerMultiplier of 1000 means this agent's
  // actions represent 1000 similar people in the population.
  followerMultiplier?: number;

  // Platform-specific
  karma?: number;
  friendCount?: number;
  followerCount?: number;
  statusesCount?: number;

  // Provenance
  sourceEntityUuid?: string;
  sourceEntityType?: string;
  createdAt: string;
}

/** Statistical agent — no LLM, probability-driven */
export interface StatisticalAgentProfile {
  id: string;
  archetype: string;
  sentimentDistribution: { positive: number; neutral: number; negative: number };
  activityProbability: number;
  preferredActions: Array<{ action: string; weight: number }>;
}

// ---------------------------------------------------------------------------
// Agent Memory
// ---------------------------------------------------------------------------

export interface AgentMemory {
  id: string;
  agentId: string;
  simulationId: string;
  round: number;
  memoryType: "action" | "observation" | "belief_change" | "interaction";
  content: string;
  embedding?: number[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Social Dynamics Configuration
// ---------------------------------------------------------------------------

export interface RecommendationConfig {
  recencyWeight: number;
  popularityWeight: number;
  relevanceWeight: number;
  echoChamberStrength: number;
}

export interface ViralConfig {
  viralThreshold: number;
  viralBoostMultiplier: number;
  viralDecayRate: number;
}

export interface ActivitySchedule {
  deadHours: number[];
  deadMultiplier: number;
  morningHours: number[];
  morningMultiplier: number;
  workHours: number[];
  workMultiplier: number;
  peakHours: number[];
  peakMultiplier: number;
  nightHours: number[];
  nightMultiplier: number;
}

export interface SocialDynamicsConfig {
  recommendation: RecommendationConfig;
  viral: ViralConfig;
  activitySchedule: ActivitySchedule;
}

export const DEFAULT_SOCIAL_DYNAMICS: SocialDynamicsConfig = {
  recommendation: {
    recencyWeight: 0.4,
    popularityWeight: 0.3,
    relevanceWeight: 0.3,
    echoChamberStrength: 0.5,
  },
  viral: {
    viralThreshold: 10,
    viralBoostMultiplier: 3.0,
    viralDecayRate: 0.1,
  },
  activitySchedule: {
    deadHours: [0, 1, 2, 3, 4, 5],
    deadMultiplier: 0.05,
    morningHours: [6, 7, 8],
    morningMultiplier: 0.4,
    workHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    workMultiplier: 0.7,
    peakHours: [19, 20, 21, 22],
    peakMultiplier: 1.5,
    nightHours: [23],
    nightMultiplier: 0.5,
  },
};

// ---------------------------------------------------------------------------
// Platform Types
// ---------------------------------------------------------------------------

export type PlatformType = "forum" | "chat" | "meeting" | "market";

export interface PlatformPost {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  votes: number;
  comments: PlatformComment[];
  createdAtRound: number;
  tags: string[];
  isViral: boolean;
  viralDecay: number;
}

export interface PlatformComment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  parentId: string;
  votes: number;
  createdAtRound: number;
}

// ---------------------------------------------------------------------------
// Agent Actions
// ---------------------------------------------------------------------------

export type ForumActionType =
  | "CREATE_POST"
  | "COMMENT"
  | "UPVOTE"
  | "DOWNVOTE"
  | "SEARCH"
  | "FOLLOW"
  | "MUTE"
  | "DO_NOTHING";

export type ChatActionType =
  | "SEND_MESSAGE"
  | "REPLY_THREAD"
  | "REACT"
  | "CREATE_CHANNEL"
  | "DO_NOTHING";

export type MeetingActionType =
  | "MAKE_STATEMENT"
  | "REBUT"
  | "ASK_QUESTION"
  | "VOTE_FOR"
  | "VOTE_AGAINST"
  | "ABSTAIN"
  | "CALL_VOTE"
  | "DO_NOTHING";

export type MarketActionType =
  | "BUY"
  | "SELL"
  | "HOLD"
  | "PUBLISH_ANALYSIS"
  | "REACT_TO_NEWS"
  | "DO_NOTHING";

export type ActionType = ForumActionType | ChatActionType | MeetingActionType | MarketActionType;

export interface AgentAction {
  round: number;
  timestamp: string;
  platform: PlatformType;
  agentId: string;
  agentName: string;
  actionType: ActionType;
  target?: string;
  content?: string;
  thinking?: string;
  result?: string;
  success: boolean;
}

export interface AgentDecision {
  agentId: string;
  thinking: string;
  action: ActionType;
  target?: string;
  content?: string;
}

// ---------------------------------------------------------------------------
// Simulation Configuration
// ---------------------------------------------------------------------------

export type Department = "marketing" | "engineering" | "sales" | "strategy" | "product";

export interface SimulationEvent {
  round: number;
  event: string;
  source: string;
  affects: string[] | "all";
}

export interface SimulationConfig {
  // Core
  totalRounds: number;
  minutesPerRound: number;
  totalSimulationHours: number;

  // Platforms
  platforms: PlatformType[];

  // Social dynamics
  socialDynamics: SocialDynamicsConfig;

  // Model routing overrides (optional, falls back to DEFAULT_MODEL_ROUTING)
  modelRouting?: Partial<Record<string, ModelRoute>>;

  // Events
  initialEvents: SimulationEvent[];
  scheduledEvents: SimulationEvent[];

  // Department template
  department?: Department;

  // Population scale — configurable target population size.
  // Each LLM agent acts as a "representative" for a cohort of followers.
  // The runtime multiplies each agent's actions by their followerMultiplier
  // to produce population-scale metrics without running 1M LLM calls.
  //
  // Example: populationScale=1_000_000 with 20 agents →
  //   tier1 agents represent ~5,000 people each
  //   tier2 agents represent ~20,000 people each
  //   tier3 agents represent ~50,000+ people each
  //
  // Set to 0 or omit to disable amplification (raw agent counts only).
  populationScale?: number;
}

// ---------------------------------------------------------------------------
// Simulation Scenario
// ---------------------------------------------------------------------------

export interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  projectId: string;

  // Knowledge
  graphId: string;
  ontology: Ontology;

  // Agents
  agents: AgentProfile[];
  statisticalAgents: StatisticalAgentProfile[];

  // Config
  config: SimulationConfig;

  // Metadata
  seedDocuments: string[];
  createdAt: string;
  status: ScenarioStatus;
}

export type ScenarioStatus =
  | "created"
  | "building_graph"
  | "generating_ontology"
  | "generating_profiles"
  | "ready"
  | "running"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Simulation Runtime State
// ---------------------------------------------------------------------------

/**
 * Population-scale metrics — amplified numbers representing the full
 * simulated population, not just the LLM agents.
 * Only populated when `populationScale` is set in SimulationConfig.
 */
export interface PopulationMetrics {
  /** Total simulated population size (sum of all followerMultipliers) */
  totalPopulation: number;
  /** Number of real LLM agents producing the actions */
  realAgentCount: number;
  /** Amplified action counts (each action × agent's followerMultiplier) */
  amplifiedActions: number;
  /** Amplified engagement (votes, reactions weighted by multiplier) */
  amplifiedEngagement: number;
  /** Population-scale sentiment (weighted by followerMultiplier) */
  populationSentiment: { positive: number; neutral: number; negative: number };
  /** Per-tier breakdown */
  tierBreakdown: Array<{
    tier: number;
    agentCount: number;
    populationRepresented: number;
    amplifiedActions: number;
  }>;
}

export interface RoundResult {
  round: number;
  simulatedHour: number;
  activeAgentCount: number;
  actions: AgentAction[];
  trending: string[];
  viralPosts: PlatformPost[];
  sentimentDistribution: { positive: number; neutral: number; negative: number };
  platformSnapshot: PlatformSnapshot;
  /** Population-scale metrics (only when populationScale > 0) */
  populationMetrics?: PopulationMetrics;
}

export interface PlatformSnapshot {
  totalPosts: number;
  totalComments: number;
  totalVotes: number;
  topPosts: PlatformPost[];
  activeAgents: number;
}

export interface SimulationRunState {
  simulationId: string;
  scenarioId: string;
  status: RunStatus;

  // Progress
  currentRound: number;
  totalRounds: number;
  simulatedHours: number;
  totalSimulationHours: number;

  // Per-platform tracking
  platformProgress: Record<PlatformType, {
    currentRound: number;
    actionsCount: number;
    completed: boolean;
  }>;

  // Recent actions buffer (last 50)
  recentActions: AgentAction[];

  // Timestamps
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export type RunStatus =
  | "idle"
  | "starting"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

// ---------------------------------------------------------------------------
// Ensemble & Analysis
// ---------------------------------------------------------------------------

export interface EnsembleConfig {
  runs: number;
  personalityVariance: number;  // 0.0-1.0 how much agent personalities vary per run
  initialConditionVariance: number;
}

export interface EnsembleResult {
  scenarioId: string;
  totalRuns: number;
  completedRuns: number;

  // Aggregate metrics
  meanSentiment: number;
  sentimentStdDev: number;
  confidenceInterval95: { low: number; high: number };

  // Per-run summaries
  runSummaries: Array<{
    runIndex: number;
    finalSentiment: number;
    totalActions: number;
    topPost: string;
    viralContentCount: number;
    consensusReached: boolean;
  }>;

  // Outlier detection
  outlierRuns: number[];
  outlierReasons: string[];

  // Convergence
  convergenceRound?: number;
  consensusPercentage: number;
}

// ---------------------------------------------------------------------------
// Accuracy Tracking
// ---------------------------------------------------------------------------

export interface PredictionRecord {
  id: string;
  scenarioId: string;
  predictedAt: string;

  // What we predicted
  predictedSentiment: number;
  predictedEngagement: "low" | "medium" | "high";
  predictedRisks: string[];
  confidenceInterval: { low: number; high: number };

  // What actually happened (filled in later)
  actualSentiment?: number;
  actualEngagement?: "low" | "medium" | "high";
  actualOutcome?: string;
  validatedAt?: string;

  // Accuracy score (computed when validated)
  accuracyScore?: number;
}

// ---------------------------------------------------------------------------
// Report Engine
// ---------------------------------------------------------------------------

export interface ReportOutline {
  title: string;
  summary: string;
  sections: Array<{
    title: string;
    content: string;
  }>;
}

export type ReportStatus = "pending" | "planning" | "generating" | "completed" | "failed";

export interface ReportToolCall {
  tool: string;
  parameters: Record<string, unknown>;
  result: string;
  timestamp: string;
}

export interface SimulationReport {
  id: string;
  simulationId: string;
  scenarioId: string;
  status: ReportStatus;
  outline?: ReportOutline;
  toolCalls: ReportToolCall[];
  markdownContent?: string;
  generatedAt?: string;
}

// ---------------------------------------------------------------------------
// ReACT Loop
// ---------------------------------------------------------------------------

export const REACT_TOOLS = {
  insight_forge: {
    name: "insight_forge",
    description: "Deep semantic search — decomposes query into sub-questions for multi-dimensional retrieval",
    parameters: { query: "string", reportContext: "string" },
  },
  panorama_search: {
    name: "panorama_search",
    description: "Broad graph search — retrieves full scope including expired temporal edges",
    parameters: { query: "string", includeExpired: "boolean" },
  },
  quick_search: {
    name: "quick_search",
    description: "Simple fast search — direct keyword/semantic match",
    parameters: { query: "string", limit: "number" },
  },
  interview_agents: {
    name: "interview_agents",
    description: "Interview simulated agents — get responses from agents based on their simulation experience",
    parameters: { interviewTopic: "string", maxAgents: "number" },
  },
} as const;

export const REACT_CONSTRAINTS = {
  minToolCallsPerSection: 3,
  maxToolCallsPerSection: 5,
  maxIterationsPerSection: 5,
  minSections: 2,
  maxSections: 5,
  chatMaxIterations: 2,
  chatMaxToolCalls: 2,
  chatMaxContextChars: 15_000,
  toolResultMaxChars: 1_500,
} as const;

// ---------------------------------------------------------------------------
// Department Templates
// ---------------------------------------------------------------------------

export interface DepartmentTemplate {
  department: Department;
  platforms: PlatformType[];
  agentArchetypes: Array<{
    name: string;
    description: string;
    tier: AgentTier;
    defaultCount: number;
    stanceRange: [number, number];
    influenceRange: [number, number];
    /** Default follower multiplier for this archetype (used when populationScale is set) */
    defaultFollowerMultiplier?: number;
  }>;
  metrics: string[];
  enrichmentSources: string[];
  inferTriggers: string[];
  defaultRounds: number;
  defaultAgentCount: number;
  statisticalAgentCount: number;
  /** Default population scale for this department (0 = disabled) */
  defaultPopulationScale?: number;
}

/**
 * Department templates are defaults — fully configurable via UI.
 * Users can modify archetypes, add new departments, change trigger words,
 * adjust agent counts, and customize metrics without touching code.
 * Stored in config under simulation.departmentTemplates.
 */
export const DEFAULT_DEPARTMENT_TEMPLATES: Record<Department, DepartmentTemplate> = {
  marketing: {
    department: "marketing",
    platforms: ["forum"],
    agentArchetypes: [
      { name: "target_customer", description: "Potential buyer in target demographic", tier: AgentTier.Tier1, defaultCount: 3, stanceRange: [-0.5, 0.5], influenceRange: [0.5, 1.5] },
      { name: "influencer", description: "Industry thought leader with large following", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.3, 0.8], influenceRange: [2.0, 4.0] },
      { name: "competitor_marketer", description: "Marketing professional at competing company", tier: AgentTier.Tier2, defaultCount: 3, stanceRange: [-0.8, -0.2], influenceRange: [1.0, 2.0] },
      { name: "skeptic", description: "Critical community member, demands evidence", tier: AgentTier.Tier2, defaultCount: 5, stanceRange: [-0.9, -0.3], influenceRange: [0.8, 1.5] },
      { name: "early_adopter", description: "Enthusiastic about new products and ideas", tier: AgentTier.Tier2, defaultCount: 5, stanceRange: [0.3, 0.9], influenceRange: [0.5, 1.2] },
      { name: "journalist", description: "Tech/industry journalist covering the space", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-0.2, 0.2], influenceRange: [2.5, 4.0] },
      { name: "lurker", description: "Passive community member who occasionally comments or votes, representative of the silent majority", tier: AgentTier.Tier3, defaultCount: 8, stanceRange: [-0.5, 0.5], influenceRange: [0.1, 0.5] },
      { name: "casual_commenter", description: "Regular community participant who shares opinions but isn't deeply invested", tier: AgentTier.Tier3, defaultCount: 6, stanceRange: [-0.4, 0.4], influenceRange: [0.3, 0.8] },
      { name: "brand_advocate", description: "Existing loyal customer who defends the brand organically", tier: AgentTier.Tier3, defaultCount: 4, stanceRange: [0.5, 0.9], influenceRange: [0.5, 1.2] },
    ],
    metrics: ["engagement", "sentiment", "virality", "brand_mention", "share_of_voice"],
    enrichmentSources: ["arctic_reddit", "openbb_news"],
    inferTriggers: ["react", "engagement", "viral", "community", "reddit", "twitter", "post", "content", "audience", "marketing", "brand"],
    defaultRounds: 15,
    defaultAgentCount: 50,
    statisticalAgentCount: 0,
  },
  engineering: {
    department: "engineering",
    platforms: ["meeting", "chat"],
    agentArchetypes: [
      { name: "senior_engineer", description: "10+ years experience, strong opinions on architecture", tier: AgentTier.Tier1, defaultCount: 3, stanceRange: [-0.5, 0.5], influenceRange: [2.0, 3.0] },
      { name: "architect", description: "System architect focused on long-term maintainability", tier: AgentTier.Tier1, defaultCount: 1, stanceRange: [-0.3, 0.3], influenceRange: [3.0, 4.0] },
      { name: "junior_dev", description: "Early career developer, eager to learn", tier: AgentTier.Tier2, defaultCount: 4, stanceRange: [0.0, 0.7], influenceRange: [0.3, 0.8] },
      { name: "pm", description: "Product manager balancing scope, timeline, quality", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [0.2, 0.8], influenceRange: [1.5, 2.5] },
      { name: "security_reviewer", description: "Security-focused engineer, risk-averse", tier: AgentTier.Tier2, defaultCount: 1, stanceRange: [-0.7, -0.1], influenceRange: [2.0, 3.0] },
      { name: "devops", description: "Infrastructure/operations engineer, pragmatic", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-0.3, 0.3], influenceRange: [1.0, 2.0] },
    ],
    metrics: ["consensus", "risk_flags", "implementation_complexity", "security_concerns", "timeline_estimate"],
    enrichmentSources: ["github_issues", "architecture_docs"],
    inferTriggers: ["architecture", "design", "review", "technical", "migration", "refactor", "api", "breaking", "rfc", "engineering", "code"],
    defaultRounds: 8,
    defaultAgentCount: 13,
    statisticalAgentCount: 0,
  },
  sales: {
    department: "sales",
    platforms: ["meeting"],
    agentArchetypes: [
      { name: "enterprise_buyer", description: "VP/Director evaluating solutions for large org", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.5, 0.3], influenceRange: [3.0, 4.0] },
      { name: "technical_evaluator", description: "Engineer tasked with due diligence", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.7, 0.0], influenceRange: [2.0, 3.0] },
      { name: "budget_holder", description: "CFO/Finance person focused on ROI and cost", tier: AgentTier.Tier2, defaultCount: 1, stanceRange: [-0.8, -0.2], influenceRange: [3.0, 4.0] },
      { name: "end_user", description: "Day-to-day user of the product/service", tier: AgentTier.Tier2, defaultCount: 3, stanceRange: [-0.3, 0.5], influenceRange: [0.5, 1.5] },
      { name: "competitor_sales", description: "Sales rep from competing product", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-1.0, -0.5], influenceRange: [1.5, 2.5] },
      { name: "procurement", description: "Procurement officer, process-driven", tier: AgentTier.Tier2, defaultCount: 1, stanceRange: [-0.3, 0.0], influenceRange: [1.0, 2.0] },
    ],
    metrics: ["objection_count", "deal_progression", "competitive_risk", "champion_strength", "budget_alignment"],
    enrichmentSources: ["crm_data", "competitor_analysis"],
    inferTriggers: ["sales", "deal", "prospect", "objection", "pitch", "demo", "pricing", "close", "buyer", "customer"],
    defaultRounds: 6,
    defaultAgentCount: 11,
    statisticalAgentCount: 0,
  },
  strategy: {
    department: "strategy",
    platforms: ["market", "meeting", "forum"],
    agentArchetypes: [
      { name: "competitor_ceo", description: "CEO of primary competitor, strategic thinker", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.8, -0.3], influenceRange: [3.0, 5.0] },
      { name: "regulator", description: "Government/regulatory official", tier: AgentTier.Tier1, defaultCount: 1, stanceRange: [-0.5, 0.5], influenceRange: [4.0, 5.0] },
      { name: "investor", description: "VC/PE investor evaluating market dynamics", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.3, 0.7], influenceRange: [2.5, 4.0] },
      { name: "supply_chain_partner", description: "Key supplier or distribution partner", tier: AgentTier.Tier2, defaultCount: 3, stanceRange: [-0.2, 0.5], influenceRange: [1.5, 3.0] },
      { name: "industry_analyst", description: "Research analyst covering the sector", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-0.3, 0.3], influenceRange: [2.0, 3.5] },
      { name: "activist", description: "Advocacy group or activist organization", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-1.0, 1.0], influenceRange: [1.5, 3.0] },
      { name: "market_observer", description: "Retail investor or market watcher tracking developments", tier: AgentTier.Tier3, defaultCount: 4, stanceRange: [-0.3, 0.3], influenceRange: [0.3, 0.8] },
      { name: "downstream_buyer", description: "Manufacturer or company dependent on supply chain outcomes", tier: AgentTier.Tier3, defaultCount: 3, stanceRange: [-0.5, 0.5], influenceRange: [0.5, 1.5] },
    ],
    metrics: ["market_share_shift", "regulatory_risk", "partner_alignment", "competitive_response", "investor_sentiment"],
    enrichmentSources: ["openbb_market", "news_feeds", "sec_filings"],
    inferTriggers: ["strategy", "market", "competitor", "regulation", "invest", "acquisition", "partnership", "geopolitical", "supply chain"],
    defaultRounds: 12,
    defaultAgentCount: 19,
    statisticalAgentCount: 0,
  },
  product: {
    department: "product",
    platforms: ["forum", "meeting"],
    agentArchetypes: [
      { name: "power_user", description: "Heavy user who knows every feature, strong opinions", tier: AgentTier.Tier1, defaultCount: 3, stanceRange: [-0.3, 0.7], influenceRange: [1.5, 3.0] },
      { name: "churned_user", description: "Former user who left, has specific grievances", tier: AgentTier.Tier1, defaultCount: 2, stanceRange: [-0.9, -0.3], influenceRange: [1.0, 2.0] },
      { name: "new_user", description: "Recent adopter, forming first impressions", tier: AgentTier.Tier2, defaultCount: 5, stanceRange: [-0.2, 0.5], influenceRange: [0.3, 1.0] },
      { name: "enterprise_admin", description: "IT admin managing the product for their org", tier: AgentTier.Tier2, defaultCount: 2, stanceRange: [-0.5, 0.3], influenceRange: [1.5, 2.5] },
      { name: "accessibility_advocate", description: "User focused on accessibility and inclusion", tier: AgentTier.Tier2, defaultCount: 1, stanceRange: [-0.5, 0.5], influenceRange: [1.5, 2.5] },
      { name: "developer_integrator", description: "Developer building on top of the product's API", tier: AgentTier.Tier2, defaultCount: 3, stanceRange: [-0.3, 0.5], influenceRange: [1.0, 2.0] },
      { name: "competitor_user", description: "User of competing product evaluating alternatives", tier: AgentTier.Tier3, defaultCount: 3, stanceRange: [-0.6, 0.1], influenceRange: [0.3, 1.0] },
      { name: "community_member", description: "Active forum participant sharing experiences and tips", tier: AgentTier.Tier3, defaultCount: 4, stanceRange: [-0.3, 0.5], influenceRange: [0.3, 0.8] },
    ],
    metrics: ["feature_demand", "usability_score", "adoption_barrier", "satisfaction_delta", "competitive_gap"],
    enrichmentSources: ["support_tickets", "app_reviews", "user_interviews"],
    inferTriggers: ["feature", "user", "ux", "usability", "feedback", "adoption", "onboarding", "retention", "product", "roadmap"],
    defaultRounds: 10,
    defaultAgentCount: 23,
    statisticalAgentCount: 0,
  },
};

// ---------------------------------------------------------------------------
// Master Simulation Configuration (all user-configurable, persisted in config)
// ---------------------------------------------------------------------------

/**
 * Top-level simulation settings — everything is configurable via UI.
 * Stored in config under `simulation` key.
 * No hardcoded values anywhere in the engine — resolveModelRoute(),
 * resolveDepartmentTemplate(), resolveSocialDynamics() all check
 * this config first, then fall back to defaults.
 */
export interface SimulationSettings {
  /** Model routing — which provider/model for each task */
  modelRouting: ModelRoutingConfig;

  /** Social dynamics defaults — can be overridden per-scenario */
  socialDynamics: SocialDynamicsConfig;

  /** Department templates — can be modified, extended with new departments */
  departmentTemplates: Record<string, DepartmentTemplate>;

  /** Graphiti + FalkorDB connection */
  graphDb: {
    host: string;
    port: number;
    protocol: "bolt" | "redis" | "http";
  };

  /** DuckDB path for analytics/ensemble data */
  analyticsDbPath: string;

  /** Default ensemble config */
  defaultEnsemble: EnsembleConfig;

  /** Accuracy tracking enabled */
  accuracyTrackingEnabled: boolean;

  /** Auto-start FalkorDB container if not running */
  autoStartGraphDb: boolean;

  /** Default population scale for new scenarios (0 = disabled, 1000000 = 1M) */
  defaultPopulationScale: number;

  /** Agent processing batch size — how many LLM agents call in parallel per round */
  agentBatchSize: number;

  /** Timeout per agent LLM decision in milliseconds */
  agentTimeoutMs: number;
}

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  modelRouting: DEFAULT_MODEL_ROUTING,
  socialDynamics: DEFAULT_SOCIAL_DYNAMICS,
  departmentTemplates: DEFAULT_DEPARTMENT_TEMPLATES,
  graphDb: {
    host: "127.0.0.1",
    port: 6379,
    protocol: "bolt",
  },
  analyticsDbPath: "~/.lattice/simulation-analytics.duckdb",
  defaultEnsemble: {
    runs: 10,
    personalityVariance: 0.2,
    initialConditionVariance: 0.1,
  },
  accuracyTrackingEnabled: true,
  autoStartGraphDb: true,
  defaultPopulationScale: 0,
  agentBatchSize: 3,
  agentTimeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Service Status (follows OpenBBService discriminated union pattern)
// ---------------------------------------------------------------------------

export type SimulationServiceStatus =
  | { status: "not_configured" }
  | { status: "initializing" }
  | { status: "ready"; graphDbConnected: boolean; activeSimulations: number }
  | { status: "running"; simulationId: string; progress: number }
  | { status: "error"; message: string };

export interface SimulationSetupStatus {
  llmProviderConfigured: boolean;
  graphDbConfigured: boolean;
  graphDbConnected: boolean;
  graphDbHost: string;
  graphDbPort: number;
  dockerAvailable: boolean;
  falkorDbContainerRunning: boolean;
  ready: boolean;
}

// ---------------------------------------------------------------------------
// ORPC Schema Shapes (for router integration)
// ---------------------------------------------------------------------------

export interface CreateScenarioInput {
  name: string;
  description: string;
  seedDocuments: Array<{ filename: string; content: string }>;
  department?: Department;
  platforms?: PlatformType[];
  rounds?: number;
  modelRouting?: Partial<Record<string, ModelRoute>>;
  /** Population scale — configurable target population (e.g., 1_000_000 for 1M simulation) */
  populationScale?: number;
  /** When true and seedDocuments have content, extract entities from docs instead of using templates */
  useDocumentDrivenGeneration?: boolean;
}

export interface SimulationProgress {
  scenarioId: string;
  simulationId: string;
  status: ScenarioStatus;
  round: number;
  totalRounds: number;
  ensembleRun: number;
  totalEnsembleRuns: number;
  recentActions: AgentAction[];
  metrics: Record<string, number>;
}
