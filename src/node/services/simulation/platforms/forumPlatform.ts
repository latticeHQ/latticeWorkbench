/**
 * Forum Platform — Reddit-like simulation environment.
 *
 * Supports: CREATE_POST, COMMENT, UPVOTE, DOWNVOTE, SEARCH, FOLLOW, MUTE, DO_NOTHING
 * State: Posts with nested comments, vote counts, karma tracking.
 * Dynamics: Recommendation engine, viral propagation, echo chambers.
 */

import type {
  ActionType,
  AgentAction,
  AgentProfile,
  ForumActionType,
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

const FORUM_ACTIONS: ForumActionType[] = [
  "CREATE_POST", "COMMENT", "UPVOTE", "DOWNVOTE",
  "SEARCH", "FOLLOW", "MUTE", "DO_NOTHING",
];

export class ForumPlatformState implements PlatformState {
  readonly type = "forum" as const;
  readonly posts: PlatformPost[] = [];
  readonly config: SocialDynamicsConfig;

  /** Agent-to-agent relationships */
  private readonly following = new Map<string, Set<string>>();
  private readonly muted = new Map<string, Set<string>>();
  /** Per-agent karma tracking */
  private readonly karma = new Map<string, number>();
  /** Agent profiles for influence/belief lookups */
  private readonly agentProfiles: Map<string, AgentProfile>;

  constructor(
    config: SocialDynamicsConfig,
    agents: AgentProfile[],
  ) {
    this.config = config;
    this.agentProfiles = new Map(agents.map((a) => [a.id, a]));

    // Initialize karma from agent profiles
    for (const agent of agents) {
      this.karma.set(agent.id, agent.karma ?? 1000);
    }
  }

  getActionTypes(): ActionType[] {
    return [...FORUM_ACTIONS];
  }

  getFeed(
    agent: AgentProfile,
    currentRound: number,
    feedSize = 20,
  ): PlatformPost[] {
    // Filter out posts by muted agents
    const mutedAuthors = this.muted.get(agent.id);
    let eligiblePosts = this.posts;
    if (mutedAuthors && mutedAuthors.size > 0) {
      eligiblePosts = this.posts.filter((p) => !mutedAuthors.has(p.authorId));
    }

    // Boost posts from followed agents
    const followedAuthors = this.following.get(agent.id);
    if (followedAuthors && followedAuthors.size > 0) {
      eligiblePosts = eligiblePosts.map((p) => {
        if (followedAuthors.has(p.authorId)) {
          return { ...p, votes: p.votes + 3 }; // Boost followed content
        }
        return p;
      });
    }

    return rankFeed(agent, eligiblePosts, currentRound, this.config.recommendation, feedSize);
  }

  applyAction(action: AgentAction): ActionResult {
    switch (action.actionType as ForumActionType) {
      case "CREATE_POST":
        return this.handleCreatePost(action);
      case "COMMENT":
        return this.handleComment(action);
      case "UPVOTE":
        return this.handleVote(action, 1);
      case "DOWNVOTE":
        return this.handleVote(action, -1);
      case "FOLLOW":
        return this.handleFollow(action);
      case "MUTE":
        return this.handleMute(action);
      case "SEARCH":
        return { success: true, message: "Search completed" };
      case "DO_NOTHING":
        return { success: true, message: "Agent lurked" };
      default:
        return { success: false, message: `Unknown action: ${action.actionType}` };
    }
  }

  private handleCreatePost(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Post requires content" };
    }

    const postId = generatePlatformId("post");
    const tags = extractTags(action.content);

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

    // Apply influence — high-influence agents start with base votes
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      post.votes = Math.floor(author.influenceWeight);
    }

    this.posts.push(post);
    this.addKarma(action.agentId, 1);

    return { success: true, resultId: postId };
  }

  private handleComment(action: AgentAction): ActionResult {
    if (!action.target || !action.content) {
      return { success: false, message: "Comment requires target post and content" };
    }

    const post = this.posts.find((p) => p.id === action.target);
    if (!post) {
      return { success: false, message: `Post ${action.target} not found` };
    }

    const commentId = generatePlatformId("comment");
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
    this.addKarma(action.agentId, 1);
    this.addKarma(post.authorId, 1); // OP gets karma from comments

    return { success: true, resultId: commentId };
  }

  private handleVote(action: AgentAction, direction: 1 | -1): ActionResult {
    if (!action.target) {
      return { success: false, message: "Vote requires target" };
    }

    const post = this.posts.find((p) => p.id === action.target);
    if (post) {
      post.votes += direction;
      this.addKarma(post.authorId, direction);
      return { success: true };
    }

    // Check comments
    for (const p of this.posts) {
      const comment = p.comments.find((c) => c.id === action.target);
      if (comment) {
        comment.votes += direction;
        this.addKarma(comment.authorId, direction);
        return { success: true };
      }
    }

    return { success: false, message: `Target ${action.target} not found` };
  }

  private handleFollow(action: AgentAction): ActionResult {
    if (!action.target) return { success: false, message: "Follow requires target agent" };
    if (!this.following.has(action.agentId)) {
      this.following.set(action.agentId, new Set());
    }
    this.following.get(action.agentId)!.add(action.target);
    return { success: true };
  }

  private handleMute(action: AgentAction): ActionResult {
    if (!action.target) return { success: false, message: "Mute requires target agent" };
    if (!this.muted.has(action.agentId)) {
      this.muted.set(action.agentId, new Set());
    }
    this.muted.get(action.agentId)!.add(action.target);
    return { success: true };
  }

  private addKarma(agentId: string, amount: number): void {
    this.karma.set(agentId, (this.karma.get(agentId) ?? 0) + amount);
  }

  injectEvent(event: SimulationEvent, round: number): void {
    const postId = generatePlatformId("event");
    this.posts.push({
      id: postId,
      authorId: "__system__",
      authorName: `[${event.source}]`,
      content: event.event,
      votes: 10, // Events start with visibility boost
      comments: [],
      createdAtRound: round,
      tags: extractTags(event.event),
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
    const commentSummary = post.comments.length > 0
      ? post.comments
          .slice(0, 3)
          .map((c) => `  └ @${c.authorName}: "${truncate(c.content, 100)}" (${c.votes > 0 ? "+" : ""}${c.votes})`)
          .join("\n")
      : "";

    const viralBadge = post.isViral ? " 🔥VIRAL" : "";
    return [
      `[${post.id}] @${post.authorName}: "${truncate(post.content, 200)}" (${post.votes > 0 ? "+" : ""}${post.votes} votes, ${post.comments.length} comments${viralBadge})`,
      commentSummary,
    ].filter(Boolean).join("\n");
  }

  formatActionInstructions(): string {
    return `Available actions:
- CREATE_POST: Write a new post to the forum. Provide "content" field.
- COMMENT: Reply to an existing post. Provide "target" (post_id) and "content" fields.
- UPVOTE: Upvote a post or comment. Provide "target" (post_id or comment_id).
- DOWNVOTE: Downvote a post or comment. Provide "target" (post_id or comment_id).
- FOLLOW: Follow another user to see more of their content. Provide "target" (agent_id).
- MUTE: Mute a user to hide their content. Provide "target" (agent_id).
- DO_NOTHING: Lurk this round — read but don't act.

Respond as JSON:
{
  "thinking": "your internal reasoning about what to do",
  "action": "ACTION_TYPE",
  "target": "id or null",
  "content": "your text or null"
}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract topic tags from post content using simple keyword extraction.
 * In production, this would use the LLM classification route.
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

  // Return unique, most frequent words as tags
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
