/**
 * Market Platform — Trading/market simulation environment.
 *
 * Supports: BUY, SELL, HOLD, PUBLISH_ANALYSIS, REACT_TO_NEWS, DO_NOTHING
 * State: Orders/trades (as PlatformPost), analyses (posts with "analysis" tag),
 *        market sentiment, portfolio tracking, price simulation.
 * Dynamics: Sentiment-driven price movement, viral propagation, echo chambers.
 */

import type {
  ActionType,
  AgentAction,
  AgentProfile,
  MarketActionType,
  PlatformComment,
  PlatformPost,
  PlatformSnapshot,
  SocialDynamicsConfig,
  SimulationEvent,
} from "../types";
import type { ActionResult, PlatformState } from "./platformInterface";
import { generatePlatformId } from "./platformInterface";
import {
  rankFeed,
  processViralContent,
  computeTrending,
  decayOldContent,
} from "../socialDynamics";

const MARKET_ACTIONS: MarketActionType[] = [
  "BUY", "SELL", "HOLD", "PUBLISH_ANALYSIS", "REACT_TO_NEWS", "DO_NOTHING",
];

interface PortfolioPosition {
  quantity: number;
  avgPrice: number;
}

export class MarketPlatformState implements PlatformState {
  readonly type = "market" as const;
  readonly posts: PlatformPost[] = [];
  readonly config: SocialDynamicsConfig;

  /** Agent portfolios: agentId → asset → position */
  private readonly portfolios = new Map<string, Map<string, PortfolioPosition>>();
  /** Simulated asset prices */
  private readonly prices = new Map<string, number>();
  /** Agent profiles for influence/belief lookups */
  private readonly agentProfiles: Map<string, AgentProfile>;

  constructor(
    config: SocialDynamicsConfig,
    agents: AgentProfile[],
  ) {
    this.config = config;
    this.agentProfiles = new Map(agents.map((a) => [a.id, a]));

    // Initialize empty portfolios for each agent
    for (const agent of agents) {
      this.portfolios.set(agent.id, new Map());
    }
  }

  getActionTypes(): ActionType[] {
    return [...MARKET_ACTIONS];
  }

  getFeed(
    agent: AgentProfile,
    currentRound: number,
    feedSize = 20,
  ): PlatformPost[] {
    return rankFeed(agent, this.posts, currentRound, this.config.recommendation, feedSize);
  }

  applyAction(action: AgentAction): ActionResult {
    switch (action.actionType as MarketActionType) {
      case "BUY":
        return this.handleTrade(action, "BUY");
      case "SELL":
        return this.handleTrade(action, "SELL");
      case "HOLD":
        return this.handleHold(action);
      case "PUBLISH_ANALYSIS":
        return this.handlePublishAnalysis(action);
      case "REACT_TO_NEWS":
        return this.handleReactToNews(action);
      case "DO_NOTHING":
        return { success: true, message: "Agent observed the market" };
      default:
        return { success: false, message: `Unknown action: ${action.actionType}` };
    }
  }

  private handleTrade(action: AgentAction, direction: "BUY" | "SELL"): ActionResult {
    if (!action.content) {
      return { success: false, message: `${direction} requires content describing the trade` };
    }

    const asset = extractAsset(action.content);
    const quantity = extractQuantity(action.content);
    const price = this.getPrice(asset);

    // Update portfolio
    const portfolio = this.getOrCreatePortfolio(action.agentId);
    const existing = portfolio.get(asset) ?? { quantity: 0, avgPrice: 0 };

    if (direction === "BUY") {
      const totalCost = existing.quantity * existing.avgPrice + quantity * price;
      const totalQuantity = existing.quantity + quantity;
      portfolio.set(asset, {
        quantity: totalQuantity,
        avgPrice: totalQuantity > 0 ? totalCost / totalQuantity : 0,
      });
    } else {
      // SELL
      if (existing.quantity < quantity) {
        return { success: false, message: `Insufficient ${asset} to sell (have ${existing.quantity}, want ${quantity})` };
      }
      portfolio.set(asset, {
        quantity: existing.quantity - quantity,
        avgPrice: existing.avgPrice,
      });
    }

    // Update price based on trade direction (sentiment-driven)
    this.applyPriceImpact(asset, direction, action.agentId);

    // Create a post representing the trade
    const postId = generatePlatformId("trade");
    const tags = [direction.toLowerCase(), asset.toLowerCase(), ...extractTags(action.content)];

    const post: PlatformPost = {
      id: postId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: action.content,
      votes: 0,
      comments: [],
      createdAtRound: action.round,
      tags,
      isViral: false,
      viralDecay: 0,
    };

    // High-influence traders start with base votes
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      post.votes = Math.floor(author.influenceWeight);
    }

    this.posts.push(post);

    return {
      success: true,
      resultId: postId,
      message: `${direction} ${quantity} ${asset} @ $${price.toFixed(2)}`,
    };
  }

  private handleHold(action: AgentAction): ActionResult {
    const postId = generatePlatformId("hold");
    const content = action.content ?? "Holding current positions — no change in outlook.";
    const tags = ["hold", ...extractTags(content)];

    const post: PlatformPost = {
      id: postId,
      authorId: action.agentId,
      authorName: action.agentName,
      content,
      votes: 0,
      comments: [],
      createdAtRound: action.round,
      tags,
      isViral: false,
      viralDecay: 0,
    };

    this.posts.push(post);
    return { success: true, resultId: postId, message: "Holding positions" };
  }

  private handlePublishAnalysis(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Analysis requires content" };
    }

    const postId = generatePlatformId("analysis");
    const tags = ["analysis", ...extractTags(action.content)];

    const post: PlatformPost = {
      id: postId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: action.content,
      votes: 0,
      comments: [],
      createdAtRound: action.round,
      tags,
      isViral: false,
      viralDecay: 0,
    };

    // Analyses from high-influence agents start with credibility votes
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      post.votes = Math.floor(author.influenceWeight * 2);
    }

    this.posts.push(post);
    return { success: true, resultId: postId };
  }

  private handleReactToNews(action: AgentAction): ActionResult {
    if (!action.target || !action.content) {
      return { success: false, message: "REACT_TO_NEWS requires target post and content" };
    }

    const post = this.posts.find((p) => p.id === action.target);
    if (!post) {
      return { success: false, message: `Post ${action.target} not found` };
    }

    const commentId = generatePlatformId("reaction");
    const comment: PlatformComment = {
      id: commentId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: action.content,
      parentId: action.target,
      votes: 0,
      createdAtRound: action.round,
    };

    post.comments.push(comment);

    return { success: true, resultId: commentId };
  }

  /**
   * Get or initialize portfolio for an agent.
   */
  private getOrCreatePortfolio(agentId: string): Map<string, PortfolioPosition> {
    let portfolio = this.portfolios.get(agentId);
    if (!portfolio) {
      portfolio = new Map();
      this.portfolios.set(agentId, portfolio);
    }
    return portfolio;
  }

  /**
   * Get current simulated price for an asset. Initializes at $100 if unknown.
   */
  private getPrice(asset: string): number {
    const key = asset.toLowerCase();
    if (!this.prices.has(key)) {
      this.prices.set(key, 100.0);
    }
    return this.prices.get(key)!;
  }

  /**
   * Apply price impact from a trade. High-influence agents move prices more.
   * BUY pressure increases price, SELL pressure decreases price.
   */
  private applyPriceImpact(asset: string, direction: "BUY" | "SELL", agentId: string): void {
    const key = asset.toLowerCase();
    const currentPrice = this.getPrice(asset);

    const author = this.agentProfiles.get(agentId);
    const influence = author ? Math.min(3.0, author.influenceWeight) : 1.0;

    // Base impact: 0.1% per trade, scaled by influence
    const baseImpact = 0.001 * influence;

    // Add weighted sentiment from recent posts
    const sentimentBias = this.computeMarketSentiment(asset);
    const sentimentImpact = sentimentBias * 0.0005;

    const totalImpact = direction === "BUY"
      ? baseImpact + sentimentImpact
      : -(baseImpact + sentimentImpact);

    const newPrice = currentPrice * (1 + totalImpact);
    this.prices.set(key, Math.max(0.01, newPrice)); // Floor at $0.01
  }

  /**
   * Compute market sentiment for an asset from votes.
   * Upvotes = bullish, downvotes = bearish. Returns -1.0 to 1.0.
   */
  private computeMarketSentiment(asset: string): number {
    const key = asset.toLowerCase();
    const relevantPosts = this.posts.filter(
      (p) => p.tags.some((t) => t.toLowerCase() === key),
    );

    if (relevantPosts.length === 0) return 0;

    const totalVotes = relevantPosts.reduce((sum, p) => sum + p.votes, 0);
    const maxPossible = Math.max(1, relevantPosts.length * 10);

    return Math.max(-1.0, Math.min(1.0, totalVotes / maxPossible));
  }

  injectEvent(event: SimulationEvent, round: number): void {
    const postId = generatePlatformId("market_event");
    this.posts.push({
      id: postId,
      authorId: "__system__",
      authorName: `[${event.source}]`,
      content: event.event,
      votes: 10, // Events start with visibility boost
      comments: [],
      createdAtRound: round,
      tags: ["news", ...extractTags(event.event)],
      isViral: false,
      viralDecay: 0,
    });
  }

  getTrending(topN = 5): string[] {
    const currentRound = this.posts.length > 0
      ? Math.max(...this.posts.map((p) => p.createdAtRound))
      : 0;
    return computeTrending(this.posts, currentRound, topN);
  }

  getViralPosts(): PlatformPost[] {
    return this.posts.filter((p) => p.isViral);
  }

  snapshot(): PlatformSnapshot {
    const totalComments = this.posts.reduce((sum, p) => sum + p.comments.length, 0);
    const totalVotes = this.posts.reduce((sum, p) => sum + Math.abs(p.votes), 0);

    return {
      totalPosts: this.posts.length,
      totalComments,
      totalVotes,
      topPosts: [...this.posts]
        .sort((a, b) => b.votes - a.votes)
        .slice(0, 10),
      activeAgents: new Set(this.posts.map((p) => p.authorId)).size,
    };
  }

  endOfRound(currentRound: number): void {
    processViralContent(this.posts, this.config.viral);
    decayOldContent(this.posts, currentRound);
  }

  formatPostForPrompt(post: PlatformPost): string {
    // Determine display format based on tags
    const isAnalysis = post.tags.includes("analysis");
    const isBuy = post.tags.includes("buy");
    const isSell = post.tags.includes("sell");
    const isHold = post.tags.includes("hold");

    let label: string;
    if (isAnalysis) {
      label = "ANALYSIS";
    } else if (isBuy) {
      const asset = extractAssetFromTags(post.tags);
      label = `BUY ${asset}`;
    } else if (isSell) {
      const asset = extractAssetFromTags(post.tags);
      label = `SELL ${asset}`;
    } else if (isHold) {
      label = "HOLD";
    } else {
      label = "NEWS";
    }

    const commentSummary = post.comments.length > 0
      ? post.comments
          .slice(0, 3)
          .map((c) => `  └ @${c.authorName}: "${truncate(c.content, 100)}" (${c.votes > 0 ? "+" : ""}${c.votes})`)
          .join("\n")
      : "";

    const viralBadge = post.isViral ? " 🔥VIRAL" : "";
    const sentiment = post.votes > 0 ? "bullish" : post.votes < 0 ? "bearish" : "neutral";

    return [
      `[${label}] @${post.authorName}: "${truncate(post.content, 200)}" (${post.votes > 0 ? "+" : ""}${post.votes} ${sentiment}, ${post.comments.length} reactions${viralBadge})`,
      commentSummary,
    ].filter(Boolean).join("\n");
  }

  formatActionInstructions(): string {
    return `Available actions:
- BUY: Buy an asset. Provide "content" describing the trade (include asset name, quantity, and reasoning).
- SELL: Sell an asset. Provide "content" describing the trade (include asset name, quantity, and reasoning).
- HOLD: Hold current positions. Optionally provide "content" with reasoning.
- PUBLISH_ANALYSIS: Publish a detailed market analysis. Provide "content" with your analysis.
- REACT_TO_NEWS: React to an existing news post or analysis. Provide "target" (post_id) and "content" with your reaction.
- DO_NOTHING: Observe the market this round — no trades or commentary.

Market dynamics:
- BUY/SELL actions affect simulated prices via sentiment pressure.
- Upvotes on posts signal bullish sentiment, downvotes signal bearish.
- High-influence traders move prices more than low-influence traders.
- Published analyses from credible traders receive higher visibility.

Respond as JSON:
{
  "thinking": "your internal reasoning about market conditions and strategy",
  "action": "ACTION_TYPE",
  "target": "post_id or null",
  "content": "your trade details, analysis, or reaction"
}`;
  }

  // -------------------------------------------------------------------------
  // Market-specific accessors
  // -------------------------------------------------------------------------

  /** Get current simulated prices for all tracked assets. */
  getPrices(): Map<string, number> {
    return new Map(this.prices);
  }

  /** Get an agent's portfolio. */
  getPortfolio(agentId: string): Map<string, PortfolioPosition> | undefined {
    return this.portfolios.get(agentId);
  }

  /** Get overall market sentiment across all assets. */
  getOverallSentiment(): number {
    if (this.posts.length === 0) return 0;
    const totalVotes = this.posts.reduce((sum, p) => sum + p.votes, 0);
    const maxPossible = Math.max(1, this.posts.length * 10);
    return Math.max(-1.0, Math.min(1.0, totalVotes / maxPossible));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract an asset symbol from content. Looks for $TICKER or capitalized words
 * that resemble ticker symbols.
 */
function extractAsset(content: string): string {
  // Match $TICKER pattern
  const tickerMatch = content.match(/\$([A-Z]{1,10})/);
  if (tickerMatch) return tickerMatch[1];

  // Match common asset references
  const assetMatch = content.match(/\b([A-Z]{2,6})\b/);
  if (assetMatch) return assetMatch[1];

  return "UNKNOWN";
}

/**
 * Extract trade quantity from content. Looks for numeric values.
 */
function extractQuantity(content: string): number {
  const qtyMatch = content.match(/(\d+(?:\.\d+)?)\s*(?:shares?|units?|qty|quantity)?/i);
  if (qtyMatch) return parseFloat(qtyMatch[1]);
  return 1; // Default to 1 unit
}

/**
 * Extract an asset name from post tags, skipping action-type tags.
 */
function extractAssetFromTags(tags: string[]): string {
  const actionTags = new Set(["buy", "sell", "hold", "analysis", "news"]);
  const assetTag = tags.find((t) => !actionTags.has(t.toLowerCase()));
  return assetTag ? `$${assetTag.toUpperCase()}` : "";
}

/**
 * Extract topic tags from content using simple keyword extraction.
 */
function extractTags(content: string): string[] {
  const words = content.toLowerCase().split(/\s+/);
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "don", "t", "s", "and", "but", "or", "if", "this", "that", "these",
    "those", "i", "me", "my", "we", "our", "you", "your", "he", "him",
    "his", "she", "her", "it", "its", "they", "them", "their", "what",
    "which", "who", "whom",
  ]);

  const meaningful = words
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w.length > 3);

  const freq = new Map<string, number>();
  for (const word of meaningful) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
