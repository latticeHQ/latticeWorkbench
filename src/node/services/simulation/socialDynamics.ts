/**
 * Social Dynamics Engine — ported from OASIS validated algorithms.
 *
 * Five core systems that create realistic emergent behavior:
 * 1. Recommendation Engine — what each agent sees in their feed
 * 2. Viral Propagation — content amplification beyond normal reach
 * 3. Echo Chamber Effect — viewpoint-aligned content filtering
 * 4. Activity Scheduling — realistic agent activity patterns
 * 5. Influence Weighting — agent impact on content visibility
 *
 * All parameters are configurable via SimulationSettings (UI-driven).
 */

import type {
  AgentProfile,
  PlatformPost,
  RecommendationConfig,
  ViralConfig,
  ActivitySchedule,
  StatisticalAgentProfile,
  AgentAction,
  ActionType,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Recommendation Engine
// ---------------------------------------------------------------------------

/**
 * Ranks posts for an agent's feed based on recency, popularity, relevance,
 * and echo chamber dynamics. Each agent sees a personalized feed.
 */
export function rankFeed(
  agent: AgentProfile,
  allPosts: PlatformPost[],
  currentRound: number,
  config: RecommendationConfig,
  feedSize = 20,
): PlatformPost[] {
  if (allPosts.length === 0) return [];

  const scored = allPosts.map((post) => {
    const recency = computeRecencyScore(post, currentRound);
    const popularity = computePopularityScore(post, allPosts);
    const relevance = computeRelevanceScore(agent, post);
    const echoChamber = computeEchoChamberScore(agent, post);
    const viralBoost = post.isViral ? (1.0 - post.viralDecay) * 2.0 : 0;

    const score =
      config.recencyWeight * recency +
      config.popularityWeight * popularity +
      config.relevanceWeight * relevance +
      config.echoChamberStrength * echoChamber +
      viralBoost;

    return { post, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, feedSize)
    .map((s) => s.post);
}

/**
 * Recency score: newer posts rank higher.
 * Exponential decay — posts older than 10 rounds get minimal score.
 */
function computeRecencyScore(post: PlatformPost, currentRound: number): number {
  const age = currentRound - post.createdAtRound;
  if (age <= 0) return 1.0;
  return Math.exp(-age / 5.0); // Half-life of ~3.5 rounds
}

/**
 * Popularity score: normalized vote count relative to all posts.
 * Uses log scale to prevent runaway popular posts from dominating.
 */
function computePopularityScore(
  post: PlatformPost,
  allPosts: PlatformPost[],
): number {
  const maxVotes = Math.max(1, ...allPosts.map((p) => Math.abs(p.votes)));
  return Math.log(1 + Math.max(0, post.votes)) / Math.log(1 + maxVotes);
}

/**
 * Relevance score: topic overlap between agent interests and post tags.
 */
function computeRelevanceScore(
  agent: AgentProfile,
  post: PlatformPost,
): number {
  if (agent.interestedTopics.length === 0 || post.tags.length === 0) return 0.5;

  const agentTopics = new Set(agent.interestedTopics.map((t) => t.toLowerCase()));
  const matchCount = post.tags.filter((t) => agentTopics.has(t.toLowerCase())).length;

  return matchCount / Math.max(agent.interestedTopics.length, post.tags.length);
}

/**
 * Echo chamber score: agents preferentially see content aligned with their beliefs.
 * Higher echoChamberStrength in config = stronger filtering.
 */
function computeEchoChamberScore(
  agent: AgentProfile,
  post: PlatformPost,
): number {
  // Use agent's average stance across topics matching the post
  const relevantStances = post.tags
    .map((tag) => agent.beliefSystem.stances[tag.toLowerCase()])
    .filter((s): s is number => s !== undefined);

  if (relevantStances.length === 0) return 0.5; // Neutral if no stance overlap

  const avgStance =
    relevantStances.reduce((sum, s) => sum + s, 0) / relevantStances.length;

  // Post sentiment inferred from votes (positive votes = positive sentiment)
  const postSentiment = post.votes > 0 ? 0.5 : post.votes < 0 ? -0.5 : 0;

  // Score: 1.0 = perfect alignment, 0.0 = opposite viewpoints
  return 1.0 - Math.abs(avgStance - postSentiment) / 2.0;
}

// ---------------------------------------------------------------------------
// 2. Viral Propagation
// ---------------------------------------------------------------------------

/**
 * Check all posts for viral threshold crossing.
 * Viral posts get boosted in ALL agents' feeds regardless of relevance.
 * Viral status decays over time via viralDecayRate.
 */
export function processViralContent(
  posts: PlatformPost[],
  config: ViralConfig,
): void {
  for (const post of posts) {
    const interactions = post.votes + post.comments.length;

    // Check if post crosses viral threshold
    if (!post.isViral && interactions >= config.viralThreshold) {
      post.isViral = true;
      post.viralDecay = 0;
    }

    // Decay existing viral content
    if (post.isViral) {
      post.viralDecay += config.viralDecayRate;
      if (post.viralDecay >= 1.0) {
        post.isViral = false;
        post.viralDecay = 0;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Activity Scheduling
// ---------------------------------------------------------------------------

/**
 * Determine if an agent is active during a given simulated hour.
 * Uses activity schedule + agent's personal activity level + randomness.
 */
export function isAgentActive(
  agent: AgentProfile,
  simulatedHour: number,
  schedule: ActivitySchedule,
): boolean {
  const hourMultiplier = getActivityMultiplier(simulatedHour, schedule);
  const probability = agent.activityLevel * hourMultiplier;

  // Clamp to [0, 1] range
  return Math.random() < Math.min(1.0, Math.max(0, probability));
}

/**
 * Get the activity multiplier for a given hour based on the schedule.
 */
export function getActivityMultiplier(
  hour: number,
  schedule: ActivitySchedule,
): number {
  const normalizedHour = ((hour % 24) + 24) % 24; // Handle negative/overflow

  if (schedule.deadHours.includes(normalizedHour)) return schedule.deadMultiplier;
  if (schedule.morningHours.includes(normalizedHour)) return schedule.morningMultiplier;
  if (schedule.workHours.includes(normalizedHour)) return schedule.workMultiplier;
  if (schedule.peakHours.includes(normalizedHour)) return schedule.peakMultiplier;
  if (schedule.nightHours.includes(normalizedHour)) return schedule.nightMultiplier;

  return 0.5; // Fallback for uncategorized hours
}

/**
 * Compute the simulated hour from round number and minutes-per-round config.
 */
export function computeSimulatedHour(
  round: number,
  minutesPerRound: number,
  startHourOffset: number = 0,
): number {
  const totalMinutes = round * minutesPerRound;
  return ((totalMinutes / 60) + startHourOffset) % 24;
}

// ---------------------------------------------------------------------------
// 4. Influence Weighting
// ---------------------------------------------------------------------------

/**
 * Adjust post visibility based on author's influence weight.
 * High-influence agents (journalists, institutions) get more reach.
 * Low-influence agents (lurkers) get less.
 *
 * Applied as a multiplier to the post's score in the recommendation engine.
 */
export function getInfluenceMultiplier(agent: AgentProfile): number {
  return Math.max(0.1, agent.influenceWeight);
}

/**
 * Apply influence to a set of posts — boost scores for high-influence authors.
 * Called after initial recommendation ranking.
 */
export function applyInfluenceWeighting(
  posts: PlatformPost[],
  agentProfiles: Map<string, AgentProfile>,
): void {
  for (const post of posts) {
    const author = agentProfiles.get(post.authorId);
    if (author && author.influenceWeight > 1.0) {
      // Boost votes proportional to influence (simulates wider reach)
      post.votes = Math.round(post.votes * author.influenceWeight);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Trending Topics
// ---------------------------------------------------------------------------

/**
 * Extract trending topics from recent posts based on tag frequency
 * weighted by recency and engagement.
 */
export function computeTrending(
  posts: PlatformPost[],
  currentRound: number,
  topN = 5,
): string[] {
  const tagScores = new Map<string, number>();

  for (const post of posts) {
    const recency = computeRecencyScore(post, currentRound);
    const engagement = Math.log(1 + Math.max(0, post.votes) + post.comments.length);

    for (const tag of post.tags) {
      const key = tag.toLowerCase();
      const current = tagScores.get(key) ?? 0;
      tagScores.set(key, current + recency * engagement);
    }
  }

  return Array.from(tagScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag);
}

// ---------------------------------------------------------------------------
// 6. Content Decay
// ---------------------------------------------------------------------------

/**
 * Decay old content — reduce relevance of posts that are past their prime.
 * Posts older than `maxAgeRounds` are marked stale and deprioritized.
 */
export function decayOldContent(
  posts: PlatformPost[],
  currentRound: number,
  maxAgeRounds = 20,
): void {
  for (const post of posts) {
    const age = currentRound - post.createdAtRound;
    if (age > maxAgeRounds && post.votes < 5) {
      // Reduce visibility of old, low-engagement content
      post.votes = Math.max(0, post.votes - 1);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. Sentiment Distribution
// ---------------------------------------------------------------------------

/**
 * Compute aggregate sentiment distribution from recent actions.
 * Used for ensemble analysis and UI display.
 */
export function computeSentimentDistribution(
  actions: AgentAction[],
  agents: Map<string, AgentProfile>,
): { positive: number; neutral: number; negative: number } {
  let positive = 0;
  let neutral = 0;
  let negative = 0;

  for (const action of actions) {
    if (action.actionType === "DO_NOTHING") {
      neutral++;
      continue;
    }

    const agent = agents.get(action.agentId);
    if (!agent) {
      neutral++;
      continue;
    }

    if (agent.sentimentBias > 0.2) positive++;
    else if (agent.sentimentBias < -0.2) negative++;
    else neutral++;
  }

  const total = Math.max(1, positive + neutral + negative);
  return {
    positive: positive / total,
    neutral: neutral / total,
    negative: negative / total,
  };
}

// ---------------------------------------------------------------------------
// 8. Statistical Agent Actions (Tier 4 — no LLM)
// ---------------------------------------------------------------------------

/**
 * Generate actions for statistical agents based on probability distributions.
 * These agents don't use LLM — they react based on crowd behavior patterns
 * derived from higher-tier agent actions.
 */
export function generateStatisticalActions(
  statisticalAgents: StatisticalAgentProfile[],
  _activeAgentIds: Set<string>,
  currentRound: number,
  simulatedHour: number,
  schedule: ActivitySchedule,
  recentSentiment: { positive: number; neutral: number; negative: number },
): AgentAction[] {
  const actions: AgentAction[] = [];
  const hourMultiplier = getActivityMultiplier(simulatedHour, schedule);

  for (const agent of statisticalAgents) {
    // Activity check
    if (Math.random() > agent.activityProbability * hourMultiplier) continue;

    // Select action based on weighted probabilities
    const selectedAction = weightedRandomSelect(agent.preferredActions);
    if (!selectedAction || selectedAction === "DO_NOTHING") continue;

    // Determine sentiment alignment based on crowd sentiment
    const sentimentRoll = Math.random();
    let content: string | undefined;
    if (sentimentRoll < recentSentiment.positive) {
      content = `[Statistical: positive ${agent.archetype} reaction]`;
    } else if (sentimentRoll < recentSentiment.positive + recentSentiment.negative) {
      content = `[Statistical: negative ${agent.archetype} reaction]`;
    } else {
      content = `[Statistical: neutral ${agent.archetype} reaction]`;
    }

    actions.push({
      round: currentRound,
      timestamp: new Date().toISOString(),
      platform: "forum",
      agentId: agent.id,
      agentName: `stat_${agent.archetype}_${agent.id.slice(0, 4)}`,
      actionType: selectedAction as ActionType,
      content,
      success: true,
    });
  }

  return actions;
}

/**
 * Weighted random selection from action probabilities.
 */
function weightedRandomSelect(
  options: Array<{ action: string; weight: number }>,
): string | null {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
  if (totalWeight === 0) return null;

  let random = Math.random() * totalWeight;
  for (const option of options) {
    random -= option.weight;
    if (random <= 0) return option.action;
  }

  return options[options.length - 1]?.action ?? null;
}

// ---------------------------------------------------------------------------
// 9. Belief Updates
// ---------------------------------------------------------------------------

/**
 * Update an agent's beliefs based on what they saw and did this round.
 * Beliefs shift gradually — agents don't flip opinions instantly.
 *
 * Shift rate is influenced by:
 * - Source influence (high-influence posts shift beliefs more)
 * - Repetition (seeing the same stance multiple times reinforces it)
 * - Core value conflict (beliefs aligned with core values resist change)
 */
export function updateBeliefs(
  agent: AgentProfile,
  feedPosts: PlatformPost[],
  agentProfiles: Map<string, AgentProfile>,
  shiftRate = 0.05,
): void {
  for (const post of feedPosts) {
    const author = agentProfiles.get(post.authorId);
    if (!author) continue;

    // Higher influence authors shift beliefs more
    const influenceFactor = Math.min(2.0, author.influenceWeight) * shiftRate;

    for (const tag of post.tags) {
      const topic = tag.toLowerCase();
      const currentStance = agent.beliefSystem.stances[topic];
      if (currentStance === undefined) continue;

      // Infer post direction from author's stance
      const authorStance = author.beliefSystem.stances[topic];
      if (authorStance === undefined) continue;

      // Check if this topic is a core value (resists change)
      const isCoreValue = agent.beliefSystem.coreValues.some(
        (v) => v.toLowerCase().includes(topic),
      );
      const resistance = isCoreValue ? 0.2 : 1.0;

      // Shift toward the influence direction
      const shift = (authorStance - currentStance) * influenceFactor * resistance;
      agent.beliefSystem.stances[topic] = clamp(currentStance + shift, -1.0, 1.0);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
