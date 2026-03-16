/**
 * Meeting Platform — structured meeting/debate simulation environment.
 *
 * Supports: MAKE_STATEMENT, REBUT, ASK_QUESTION, VOTE_FOR, VOTE_AGAINST, ABSTAIN, CALL_VOTE, DO_NOTHING
 * State: Agenda items (as PlatformPost), statements (as comments), active votes with tallies.
 * Dynamics: Recommendation engine, viral propagation, echo chambers.
 */

import type {
  ActionType,
  AgentAction,
  AgentProfile,
  MeetingActionType,
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

const MEETING_ACTIONS: MeetingActionType[] = [
  "MAKE_STATEMENT", "REBUT", "ASK_QUESTION", "VOTE_FOR",
  "VOTE_AGAINST", "ABSTAIN", "CALL_VOTE", "DO_NOTHING",
];

export class MeetingPlatformState implements PlatformState {
  readonly type = "meeting" as const;
  readonly posts: PlatformPost[] = [];
  readonly config: SocialDynamicsConfig;

  /** Against-vote tallies per post (post.votes tracks "for" votes) */
  private readonly againstVotes = new Map<string, number>();
  /** Track which agents have voted on which items to prevent double-voting */
  private readonly voteRecords = new Map<string, Set<string>>();
  /** Agent profiles for influence/belief lookups */
  private readonly agentProfiles: Map<string, AgentProfile>;

  constructor(
    config: SocialDynamicsConfig,
    agents: AgentProfile[],
  ) {
    this.config = config;
    this.agentProfiles = new Map(agents.map((a) => [a.id, a]));
  }

  getActionTypes(): ActionType[] {
    return [...MEETING_ACTIONS];
  }

  getFeed(
    agent: AgentProfile,
    currentRound: number,
    feedSize = 20,
  ): PlatformPost[] {
    return rankFeed(agent, this.posts, currentRound, this.config.recommendation, feedSize);
  }

  applyAction(action: AgentAction): ActionResult {
    switch (action.actionType as MeetingActionType) {
      case "MAKE_STATEMENT":
        return this.handleMakeStatement(action);
      case "REBUT":
        return this.handleRebut(action);
      case "ASK_QUESTION":
        return this.handleAskQuestion(action);
      case "VOTE_FOR":
        return this.handleVote(action, "for");
      case "VOTE_AGAINST":
        return this.handleVote(action, "against");
      case "ABSTAIN":
        return this.handleVote(action, "abstain");
      case "CALL_VOTE":
        return this.handleCallVote(action);
      case "DO_NOTHING":
        return { success: true, message: "Agent observed silently" };
      default:
        return { success: false, message: `Unknown action: ${action.actionType}` };
    }
  }

  private handleMakeStatement(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Statement requires content" };
    }

    // Find the current (most recent) agenda item, or create one if none exists
    const agendaItem = this.getCurrentAgendaItem();
    if (!agendaItem) {
      return { success: false, message: "No active agenda item to make a statement on" };
    }

    const commentId = generatePlatformId("stmt");
    const comment: PlatformComment = {
      id: commentId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: action.content,
      parentId: agendaItem.id,
      votes: 0,
      createdAtRound: action.round,
    };

    agendaItem.comments.push(comment);

    // Boost agenda item engagement based on author influence
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      agendaItem.votes += 1;
    }

    return { success: true, resultId: commentId };
  }

  private handleRebut(action: AgentAction): ActionResult {
    if (!action.target || !action.content) {
      return { success: false, message: "Rebut requires target statement and content" };
    }

    // Find the parent statement across all agenda items
    for (const post of this.posts) {
      const targetComment = post.comments.find((c) => c.id === action.target);
      if (targetComment) {
        const commentId = generatePlatformId("rebut");
        const rebuttal: PlatformComment = {
          id: commentId,
          authorId: action.agentId,
          authorName: action.agentName,
          content: action.content,
          parentId: action.target,
          votes: 0,
          createdAtRound: action.round,
        };

        post.comments.push(rebuttal);
        return { success: true, resultId: commentId };
      }
    }

    return { success: false, message: `Statement ${action.target} not found` };
  }

  private handleAskQuestion(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Question requires content" };
    }

    const agendaItem = this.getCurrentAgendaItem();
    if (!agendaItem) {
      return { success: false, message: "No active agenda item to ask a question on" };
    }

    const commentId = generatePlatformId("question");
    const comment: PlatformComment = {
      id: commentId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: `[QUESTION] ${action.content}`,
      parentId: agendaItem.id,
      votes: 0,
      createdAtRound: action.round,
    };

    agendaItem.comments.push(comment);

    return { success: true, resultId: commentId };
  }

  private handleVote(action: AgentAction, direction: "for" | "against" | "abstain"): ActionResult {
    if (!action.target) {
      return { success: false, message: "Vote requires target vote item" };
    }

    const voteItem = this.posts.find((p) => p.id === action.target && p.tags.includes("vote"));
    if (!voteItem) {
      return { success: false, message: `Vote item ${action.target} not found` };
    }

    // Check for duplicate votes
    if (!this.voteRecords.has(voteItem.id)) {
      this.voteRecords.set(voteItem.id, new Set());
    }
    const voters = this.voteRecords.get(voteItem.id)!;
    if (voters.has(action.agentId)) {
      return { success: false, message: "Agent has already voted on this item" };
    }
    voters.add(action.agentId);

    // Record the vote as a comment for transparency
    const commentId = generatePlatformId("vote");
    const voteLabel = direction === "for" ? "FOR" : direction === "against" ? "AGAINST" : "ABSTAIN";
    const comment: PlatformComment = {
      id: commentId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: `[${voteLabel}]${action.content ? ` ${action.content}` : ""}`,
      parentId: voteItem.id,
      votes: 0,
      createdAtRound: action.round,
    };
    voteItem.comments.push(comment);

    // Update tallies
    if (direction === "for") {
      voteItem.votes += 1;
    } else if (direction === "against") {
      const current = this.againstVotes.get(voteItem.id) ?? 0;
      this.againstVotes.set(voteItem.id, current + 1);
    }
    // Abstain is recorded but does not change tallies

    return { success: true, resultId: commentId };
  }

  private handleCallVote(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Call vote requires content describing the motion" };
    }

    const postId = generatePlatformId("vote");
    const tags = ["vote", ...extractTags(action.content)];

    const voteItem: PlatformPost = {
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

    // Apply influence — high-influence agents' motions start with visibility
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      voteItem.votes = Math.floor(author.influenceWeight);
    }

    this.posts.push(voteItem);
    this.againstVotes.set(postId, 0);
    this.voteRecords.set(postId, new Set());

    return { success: true, resultId: postId };
  }

  private getCurrentAgendaItem(): PlatformPost | undefined {
    // Return the most recent non-vote agenda item
    for (let i = this.posts.length - 1; i >= 0; i--) {
      if (!this.posts[i].tags.includes("vote")) {
        return this.posts[i];
      }
    }
    // If all items are votes, return the most recent one
    return this.posts.length > 0 ? this.posts[this.posts.length - 1] : undefined;
  }

  injectEvent(event: SimulationEvent, round: number): void {
    const postId = generatePlatformId("agenda");
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
    const totalForVotes = this.posts
      .filter((p) => p.tags.includes("vote"))
      .reduce((sum, p) => sum + p.votes, 0);
    const totalAgainstVotes = Array.from(this.againstVotes.values())
      .reduce((sum, v) => sum + v, 0);

    return {
      totalPosts: this.posts.length,
      totalComments,
      totalVotes: totalForVotes + totalAgainstVotes,
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
    const isVote = post.tags.includes("vote");
    const againstCount = this.againstVotes.get(post.id) ?? 0;

    let header: string;
    if (isVote) {
      header = `[${post.id}] VOTE: "${truncate(post.content, 200)}" [For: ${post.votes}, Against: ${againstCount}]`;
    } else {
      header = `[${post.id}] AGENDA [round ${post.createdAtRound}]: "${truncate(post.content, 200)}" (${post.comments.length} statements)`;
    }

    const commentSummary = post.comments.length > 0
      ? post.comments
          .slice(0, 5)
          .map((c) => {
            const prefix = c.content.startsWith("[QUESTION]") ? "  ? " : "  > ";
            return `${prefix}@${c.authorName}: "${truncate(c.content, 120)}"`;
          })
          .join("\n")
      : "";

    const viralBadge = post.isViral ? " [HEATED]" : "";

    return [
      `${header}${viralBadge}`,
      commentSummary,
    ].filter(Boolean).join("\n");
  }

  formatActionInstructions(): string {
    return `Available actions:
- MAKE_STATEMENT: Make a statement on the current agenda item. Provide "content" field.
- REBUT: Rebut a previous statement. Provide "target" (statement_id) and "content" fields.
- ASK_QUESTION: Ask a question about the current agenda item. Provide "content" field.
- CALL_VOTE: Call a formal vote on a motion. Provide "content" describing the motion.
- VOTE_FOR: Vote in favor of a motion. Provide "target" (vote_item_id) and optional "content" for reasoning.
- VOTE_AGAINST: Vote against a motion. Provide "target" (vote_item_id) and optional "content" for reasoning.
- ABSTAIN: Abstain from a vote. Provide "target" (vote_item_id) and optional "content" for reasoning.
- DO_NOTHING: Observe silently this round — listen but don't speak.

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
 * Extract topic tags from content using simple keyword extraction.
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
