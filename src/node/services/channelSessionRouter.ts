/**
 * ChannelSessionRouter — maps external channel peers to workspace sessions.
 *
 * Adopts OpenClaw's session-key routing pattern adapted for Lattice Workbench:
 * - Each external peer (Telegram user, Discord channel, etc.) gets mapped to a workspace
 * - Session keys follow the pattern: "{channelType}:{peerKind}:{peerId}"
 * - New workspaces are auto-created when an unknown peer sends a message
 * - Session mappings are persisted to `channel-sessions.json`
 *
 * This enables workbench-scoped channels: one Telegram bot serves the entire workbench,
 * with each user getting their own isolated workspace session.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";
import type { WorkspaceService } from "@/node/services/workspaceService";
import type { ProjectService } from "@/node/services/projectService";
import type {
  ChannelConfig,
  ChannelMessage,
  ChannelSessionEntry,
  ChannelSessionScope,
  ChannelPeerKind,
  ChannelType,
} from "@/common/orpc/schemas/channels";
import { ChannelSessionEntrySchema } from "@/common/orpc/schemas/channels";

// ── Types ──────────────────────────────────────────────────────────────

export interface ResolveResult {
  workspaceId: string;
  sessionKey: string;
  isNew: boolean;
}

// ── Service ────────────────────────────────────────────────────────────

export class ChannelSessionRouter {
  private readonly sessions = new Map<string, ChannelSessionEntry>();
  private readonly sessionsFile: string;

  constructor(
    private readonly config: Config,
    private readonly workspaceService: WorkspaceService,
    private readonly projectService: ProjectService
  ) {
    this.sessionsFile = path.join(config.rootDir, "channel-sessions.json");
  }

  // ── Session key generation (OpenClaw pattern) ──────────────────────

  /**
   * Build a deterministic session key from message context and scope configuration.
   *
   * Examples:
   * - per-peer:         "telegram:dm:123456"
   * - per-channel-peer: "telegram:dm:123456" (same — channels are already per-type)
   * - shared:           "telegram:shared"
   */
  buildSessionKey(
    channelType: ChannelType,
    peerKind: ChannelPeerKind,
    peerId: string,
    scope: ChannelSessionScope
  ): string {
    if (scope === "shared") {
      return `${channelType}:shared`;
    }
    // per-peer and per-channel-peer produce the same key
    // (our channels are already separated by type, unlike OpenClaw which has cross-platform identity)
    return `${channelType}:${peerKind}:${peerId}`;
  }

  /**
   * Determine peer kind from a ChannelMessage.
   * Telegram: positive chat IDs = DM, negative = group
   * Discord: uses channel kind from metadata
   * Default: DM
   */
  inferPeerKind(message: ChannelMessage): ChannelPeerKind {
    // Check metadata for explicit peer kind
    if (message.metadata?.peerKind) {
      return message.metadata.peerKind as ChannelPeerKind;
    }

    // Telegram heuristic: negative chat IDs are groups/supergroups
    if (message.channelType === "telegram") {
      const chatId = message.to.id;
      if (chatId.startsWith("-")) {
        return "group";
      }
      return "dm";
    }

    return "dm";
  }

  // ── Resolve: find or create workspace for a peer ───────────────────

  /**
   * Resolve an inbound message to a workspace. If no session exists for this peer,
   * auto-creates a new workspace in the channel's defaultProjectPath.
   */
  async resolve(message: ChannelMessage, channelConfig: ChannelConfig): Promise<ResolveResult> {
    const peerKind = this.inferPeerKind(message);
    const peerId = peerKind === "dm" ? message.from.id : message.to.id;
    const scope = channelConfig.sessionScope ?? "per-peer";

    const sessionKey = this.buildSessionKey(message.channelType, peerKind, peerId, scope);

    // Check existing session
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      // Update last message timestamp
      existing.lastMessageAt = Date.now();
      existing.displayName =
        message.from.displayName ?? message.from.username ?? existing.displayName;
      this.saveSessions();

      return {
        workspaceId: existing.workspaceId,
        sessionKey,
        isNew: false,
      };
    }

    // No existing session — create a new workspace
    const workspaceId = await this.createWorkspaceForPeer(channelConfig, message, peerKind, peerId);

    // Store the session mapping
    const entry: ChannelSessionEntry = {
      sessionKey,
      workspaceId,
      channelType: message.channelType,
      accountId: message.channelAccountId,
      peerId,
      peerKind,
      displayName: message.from.displayName ?? message.from.username,
      lastMessageAt: Date.now(),
      createdAt: Date.now(),
    };

    this.sessions.set(sessionKey, entry);
    this.saveSessions();

    return {
      workspaceId,
      sessionKey,
      isNew: true,
    };
  }

  // ── Workspace creation ─────────────────────────────────────────────

  /**
   * Create a new workspace for a channel peer conversation.
   * Uses the channel's defaultProjectPath as the parent project.
   */
  private async createWorkspaceForPeer(
    channelConfig: ChannelConfig,
    message: ChannelMessage,
    peerKind: ChannelPeerKind,
    peerId: string
  ): Promise<string> {
    const projectPath = channelConfig.defaultProjectPath;

    // Generate a human-readable branch name
    const peerLabel = (message.from.username ?? message.from.displayName ?? peerId)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30);
    const shortId = crypto.randomBytes(3).toString("hex");
    const branchName = `${channelConfig.type}-${peerLabel}-${shortId}`;

    // Generate a workspace title
    const displayName = message.from.displayName ?? message.from.username ?? peerId;
    const title = `${channelConfig.type}/${displayName} (${peerKind})`;

    // Detect the trunk branch for the project (needed for worktree/SSH runtimes)
    let trunkBranch: string | undefined;
    try {
      const branchInfo = await this.projectService.listBranches(projectPath);
      trunkBranch = branchInfo.recommendedTrunk ?? undefined;
    } catch (error) {
      log.warn("[ChannelSessionRouter] Could not detect trunk branch, will use default", { error });
    }

    log.info("[ChannelSessionRouter] Creating workspace for channel peer", {
      projectPath,
      branchName,
      trunkBranch,
      peerKind,
      peerId,
      channelType: channelConfig.type,
    });

    const result = await this.workspaceService.create(projectPath, branchName, trunkBranch, title);

    if (!result.success) {
      throw new Error(`Failed to create workspace for channel peer: ${result.error}`);
    }

    return result.data.metadata.id;
  }

  // ── Queries ────────────────────────────────────────────────────────

  /**
   * List all session entries, optionally filtered by account ID.
   */
  listSessions(accountId?: string): ChannelSessionEntry[] {
    const all = Array.from(this.sessions.values());
    if (accountId) {
      return all.filter((s) => s.accountId === accountId);
    }
    return all;
  }

  /**
   * Look up a session by its components (without creating a workspace).
   */
  lookupSession(
    channelType: ChannelType,
    accountId: string,
    peerId: string,
    peerKind: ChannelPeerKind
  ): { sessionKey: string; workspaceId?: string; exists: boolean } {
    // We need scope to build the key, but for lookup we just try per-peer (most common)
    const sessionKey = `${channelType}:${peerKind}:${peerId}`;
    const existing = this.sessions.get(sessionKey);

    return {
      sessionKey,
      workspaceId: existing?.workspaceId,
      exists: !!existing,
    };
  }

  /**
   * Delete a session by key. Used by /new command to reset a conversation.
   * Returns the deleted entry (if it existed) so the caller can clean up.
   */
  deleteSession(sessionKey: string): ChannelSessionEntry | undefined {
    const entry = this.sessions.get(sessionKey);
    if (entry) {
      this.sessions.delete(sessionKey);
      this.saveSessions();
      log.info("[ChannelSessionRouter] Deleted session", {
        sessionKey,
        workspaceId: entry.workspaceId,
      });
    }
    return entry;
  }

  /**
   * Delete a session by looking up from a workspace ID.
   */
  deleteByWorkspaceId(workspaceId: string): ChannelSessionEntry | undefined {
    for (const [key, entry] of this.sessions) {
      if (entry.workspaceId === workspaceId) {
        this.sessions.delete(key);
        this.saveSessions();
        log.info("[ChannelSessionRouter] Deleted session by workspaceId", {
          sessionKey: key,
          workspaceId,
        });
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Reverse lookup: find session entry by workspace ID.
   * Used by the response path to route workspace output back to the channel peer.
   */
  findByWorkspaceId(workspaceId: string): ChannelSessionEntry | undefined {
    for (const entry of this.sessions.values()) {
      if (entry.workspaceId === workspaceId) {
        return entry;
      }
    }
    return undefined;
  }

  // ── Persistence ────────────────────────────────────────────────────

  loadSessions(): void {
    try {
      if (!fs.existsSync(this.sessionsFile)) {
        return;
      }
      const raw = fs.readFileSync(this.sessionsFile, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        log.warn("[ChannelSessionRouter] channel-sessions.json is not an object, ignoring");
        return;
      }

      for (const [key, value] of Object.entries(parsed)) {
        const result = ChannelSessionEntrySchema.safeParse(value);
        if (result.success) {
          this.sessions.set(key, result.data);
        } else {
          log.warn("[ChannelSessionRouter] Invalid session entry, skipping", {
            key,
            error: result.error.message,
          });
        }
      }

      log.debug("[ChannelSessionRouter] Loaded session mappings", { count: this.sessions.size });
    } catch (error) {
      log.warn("[ChannelSessionRouter] Failed to load channel-sessions.json", { error });
    }
  }

  private saveSessions(): void {
    try {
      const data: Record<string, ChannelSessionEntry> = {};
      for (const [key, entry] of this.sessions) {
        data[key] = entry;
      }
      fs.writeFileSync(this.sessionsFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      log.error("[ChannelSessionRouter] Failed to save channel-sessions.json", { error });
    }
  }

  /**
   * Remove stale sessions older than maxAge milliseconds.
   */
  pruneStale(maxAgeMs: number): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.sessions) {
      if (now - entry.lastMessageAt > maxAgeMs) {
        this.sessions.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) {
      this.saveSessions();
      log.info("[ChannelSessionRouter] Pruned stale sessions", { pruned });
    }
    return pruned;
  }
}
