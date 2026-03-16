/**
 * Chat Platform — Slack/Discord-like simulation environment.
 *
 * Supports: SEND_MESSAGE, REPLY_THREAD, REACT, CREATE_CHANNEL, DO_NOTHING
 * State: Messages in channels, threaded replies, emoji reactions, channels.
 * Dynamics: Recommendation engine, viral propagation, echo chambers.
 */

import type {
  ActionType,
  AgentAction,
  AgentProfile,
  ChatActionType,
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

const CHAT_ACTIONS: ChatActionType[] = [
  "SEND_MESSAGE", "REPLY_THREAD", "REACT",
  "CREATE_CHANNEL", "DO_NOTHING",
];

const DEFAULT_CHANNELS = ["general", "random", "announcements"];

export class ChatPlatformState implements PlatformState {
  readonly type = "chat" as const;
  readonly posts: PlatformPost[] = [];
  readonly config: SocialDynamicsConfig;

  /** Channel set — messages are tagged by channel via the tags field */
  private readonly channels: Set<string>;
  /** Agent profiles for influence/belief lookups */
  private readonly agentProfiles: Map<string, AgentProfile>;

  constructor(
    config: SocialDynamicsConfig,
    agents: AgentProfile[],
  ) {
    this.config = config;
    this.agentProfiles = new Map(agents.map((a) => [a.id, a]));
    this.channels = new Set(DEFAULT_CHANNELS);
  }

  getActionTypes(): ActionType[] {
    return [...CHAT_ACTIONS];
  }

  getChannels(): string[] {
    return Array.from(this.channels);
  }

  getFeed(
    agent: AgentProfile,
    currentRound: number,
    feedSize = 20,
  ): PlatformPost[] {
    return rankFeed(agent, this.posts, currentRound, this.config.recommendation, feedSize);
  }

  applyAction(action: AgentAction): ActionResult {
    switch (action.actionType as ChatActionType) {
      case "SEND_MESSAGE":
        return this.handleSendMessage(action);
      case "REPLY_THREAD":
        return this.handleReplyThread(action);
      case "REACT":
        return this.handleReact(action);
      case "CREATE_CHANNEL":
        return this.handleCreateChannel(action);
      case "DO_NOTHING":
        return { success: true, message: "Agent lurked" };
      default:
        return { success: false, message: `Unknown action: ${action.actionType}` };
    }
  }

  private handleSendMessage(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "Message requires content" };
    }

    const channel = action.target ?? "general";
    if (!this.channels.has(channel)) {
      return { success: false, message: `Channel #${channel} does not exist` };
    }

    const messageId = generatePlatformId("msg");
    const tags = [channel, ...extractTags(action.content)];

    const message: PlatformPost = {
      id: messageId,
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

    // Apply influence — high-influence agents start with base reactions
    const author = this.agentProfiles.get(action.agentId);
    if (author && author.influenceWeight > 1.5) {
      message.votes = Math.floor(author.influenceWeight);
    }

    this.posts.push(message);

    return { success: true, resultId: messageId };
  }

  private handleReplyThread(action: AgentAction): ActionResult {
    if (!action.target || !action.content) {
      return { success: false, message: "Thread reply requires target message and content" };
    }

    const parentMessage = this.posts.find((p) => p.id === action.target);
    if (!parentMessage) {
      return { success: false, message: `Message ${action.target} not found` };
    }

    const replyId = generatePlatformId("reply");
    const reply: PlatformComment = {
      id: replyId,
      authorId: action.agentId,
      authorName: action.agentName,
      content: action.content,
      parentId: action.target,
      votes: 0,
      createdAtRound: action.round,
    };

    parentMessage.comments.push(reply);

    return { success: true, resultId: replyId };
  }

  private handleReact(action: AgentAction): ActionResult {
    if (!action.target) {
      return { success: false, message: "React requires target message" };
    }

    // Check top-level messages
    const message = this.posts.find((p) => p.id === action.target);
    if (message) {
      message.votes += 1;
      return { success: true };
    }

    // Check thread replies
    for (const p of this.posts) {
      const reply = p.comments.find((c) => c.id === action.target);
      if (reply) {
        reply.votes += 1;
        return { success: true };
      }
    }

    return { success: false, message: `Target ${action.target} not found` };
  }

  private handleCreateChannel(action: AgentAction): ActionResult {
    if (!action.content) {
      return { success: false, message: "CREATE_CHANNEL requires channel name in content" };
    }

    const channelName = action.content
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    if (!channelName) {
      return { success: false, message: "Invalid channel name" };
    }

    if (this.channels.has(channelName)) {
      return { success: false, message: `Channel #${channelName} already exists` };
    }

    this.channels.add(channelName);

    return { success: true, resultId: channelName, message: `Created channel #${channelName}` };
  }

  injectEvent(event: SimulationEvent, round: number): void {
    const messageId = generatePlatformId("event");
    this.posts.push({
      id: messageId,
      authorId: "__system__",
      authorName: `[${event.source}]`,
      content: event.event,
      votes: 10, // Events start with visibility boost
      comments: [],
      createdAtRound: round,
      tags: ["announcements", ...extractTags(event.event)],
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
    // First tag is the channel name
    const channel = post.tags[0] ?? "general";

    const threadSummary = post.comments.length > 0
      ? post.comments
          .slice(0, 3)
          .map((c) => `  └ @${c.authorName}: "${truncate(c.content, 100)}" (${c.votes} reaction${c.votes !== 1 ? "s" : ""})`)
          .join("\n")
      : "";

    const viralBadge = post.isViral ? " 🔥VIRAL" : "";
    return [
      `[${post.id}] #${channel} | @${post.authorName}: "${truncate(post.content, 200)}" (${post.votes} reaction${post.votes !== 1 ? "s" : ""}, ${post.comments.length} replies${viralBadge})`,
      threadSummary,
    ].filter(Boolean).join("\n");
  }

  formatActionInstructions(): string {
    const channelList = Array.from(this.channels).map((c) => `#${c}`).join(", ");
    return `Available actions:
- SEND_MESSAGE: Send a message to a channel. Provide "target" (channel name, e.g. "general") and "content" fields.
- REPLY_THREAD: Reply to an existing message thread. Provide "target" (message_id) and "content" fields.
- REACT: Add a reaction to a message or reply. Provide "target" (message_id or reply_id).
- CREATE_CHANNEL: Create a new channel. Provide "content" (channel name).
- DO_NOTHING: Lurk this round — read but don't act.

Active channels: ${channelList}

Respond as JSON:
{
  "thinking": "your internal reasoning about what to do",
  "action": "ACTION_TYPE",
  "target": "channel name, message_id, or null",
  "content": "your text or null"
}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract topic tags from message content using simple keyword extraction.
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
