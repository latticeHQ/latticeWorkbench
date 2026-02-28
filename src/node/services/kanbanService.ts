import { EventEmitter } from "events";
import type { Config } from "@/node/config";
import { SessionFileManager } from "@/node/utils/sessionFile";
import { log } from "@/node/services/log";
import type {
  KanbanCard,
  KanbanColumnId,
  PersistedKanbanState,
} from "@/common/types/kanban";
import { MAX_ARCHIVED_CARDS } from "@/common/types/kanban";
/** Max screen buffer size per archived card (1MB, matches terminal persistence guard). */
const MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * KanbanService — manages the kanban board state for terminal session lifecycle tracking.
 *
 * Cards are created when a terminal session starts and move through columns:
 *   active → completed (process exit) → archived (user closes tab)
 *
 * All state is persisted to ~/.lattice/sessions/{minionId}/kanban.json so the
 * audit trail survives app restarts. Screen buffers are stored on archived cards
 * for read-only replay.
 */
export class KanbanService {
  private readonly sessionFileManager: SessionFileManager<PersistedKanbanState>;
  /** In-memory cache keyed by minionId. Lazy-loaded from disk on first access. */
  private readonly cards = new Map<string, KanbanCard[]>();
  /** Tracks which minions have been loaded from disk. */
  private readonly loadedMinions = new Set<string>();
  /** Emits (minionId: string) when cards change — used by oRPC subscription. */
  private readonly changeEmitter = new EventEmitter();

  constructor(config: Config) {
    this.sessionFileManager = new SessionFileManager<PersistedKanbanState>(config, "kanban.json");
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks — called by TerminalService
  // ---------------------------------------------------------------------------

  /**
   * Called by TerminalService.create() after a PTY session is successfully created.
   * Adds a new card in the "active" column.
   */
  async onSessionCreated(params: {
    sessionId: string;
    minionId: string;
    profileName: string;
    profileId?: string;
  }): Promise<void> {
    try {
      const cards = await this.ensureLoaded(params.minionId);

      // Avoid duplicates (e.g., if session restored from persistence)
      if (cards.some((c) => c.sessionId === params.sessionId)) {
        return;
      }

      const card: KanbanCard = {
        sessionId: params.sessionId,
        minionId: params.minionId,
        column: "active",
        profileName: params.profileName,
        profileId: params.profileId,
        createdAt: Date.now(),
        readOnly: false,
      };

      cards.push(card);
      await this.persist(params.minionId);
      this.emitChange(params.minionId);
    } catch (error) {
      log.error("KanbanService.onSessionCreated failed:", error);
    }
  }

  /**
   * Called by TerminalService when a session's activity state changes.
   * Currently a no-op for column movement — activity is metadata only.
   * Could be extended to show running/idle indicators on cards.
   */
  onSessionActivityChanged(
    _sessionId: string,
    _minionId: string,
    _isRunning: boolean,
  ): void {
    // No column movement on activity change — cards stay in their
    // current column. Activity state can be read from the live
    // terminal service's sessionActivity map by the frontend.
  }

  /**
  /**
   * Called after terminal session restoration to reconcile stale "active" cards.
   * Any card in "active" whose sessionId is NOT in the live set gets moved to
   * "completed" — the PTY failed to restore or was never persisted.
   */
  async reconcileActiveCards(minionId: string, liveSessionIds: string[]): Promise<void> {
    try {
      const cards = await this.ensureLoaded(minionId);
      const liveSet = new Set(liveSessionIds);
      let changed = false;
      for (const card of cards) {
        if (card.column === "active" && !liveSet.has(card.sessionId)) {
          card.column = "completed";
          card.closedAt ??= Date.now();
          changed = true;
        }
      }
      if (changed) {
        await this.persist(minionId);
        this.emitChange(minionId);
      }
    } catch (error) {
      log.error("KanbanService.reconcileActiveCards failed:", error);
    }
  }

  /**
   * Bidirectional sync: reconcile stale active cards AND create missing cards
   * for live sessions that have no kanban entry at all.
   *
   * This is the primary sync method — ensures the board always reflects reality.
   * Called by kanban.list and kanban.subscribe before returning cards.
   */
  async syncWithLiveSessions(
    minionId: string,
    liveSessions: Array<{ sessionId: string; profileId?: string; profileName: string }>,
  ): Promise<void> {
    try {
      const cards = await this.ensureLoaded(minionId);
      const liveSet = new Set(liveSessions.map((s) => s.sessionId));
      const cardSet = new Set(cards.map((c) => c.sessionId));
      let changed = false;

      // 1. Move stale "active" cards to "completed" (session is dead)
      for (const card of cards) {
        if (card.column === "active" && !liveSet.has(card.sessionId)) {
          card.column = "completed";
          card.closedAt ??= Date.now();
          changed = true;
        }
      }

      // 2. Resurrect completed/archived cards back to "active" if session is alive again
      //    (e.g., session restored with same ID after app restart)
      for (const card of cards) {
        if (card.column !== "active" && liveSet.has(card.sessionId)) {
          card.column = "active";
          card.closedAt = undefined;
          card.archivedAt = undefined;
          card.readOnly = false;
          card.screenBuffer = undefined;
          changed = true;
        }
      }

      // 3. Create new cards for live sessions that have no kanban entry at all
      //    (e.g., onSessionCreated was missed due to race condition or service init order)
      for (const session of liveSessions) {
        if (!cardSet.has(session.sessionId)) {
          cards.push({
            sessionId: session.sessionId,
            minionId,
            column: "active",
            profileName: session.profileName,
            profileId: session.profileId,
            createdAt: Date.now(),
            readOnly: false,
          });
          changed = true;
        }
      }

      if (changed) {
        await this.persist(minionId);
        this.emitChange(minionId);
      }
    } catch (error) {
      log.error("KanbanService.syncWithLiveSessions failed:", error);
    }
  }

  /**
   * Called by TerminalService's onExit callback when a terminal process exits.
   * Moves the card from "active" to "completed".
   */
  async onSessionExited(sessionId: string, minionId: string): Promise<void> {
    try {
      const cards = await this.ensureLoaded(minionId);
      const card = cards.find((c) => c.sessionId === sessionId);
      if (!card) return;

      // Only move to completed if currently active (not already archived)
      if (card.column === "active") {
        card.column = "completed";
        card.closedAt = Date.now();
        await this.persist(minionId);
        this.emitChange(minionId);
      }
    } catch (error) {
      log.error("KanbanService.onSessionExited failed:", error);
    }
  }

  /**
   * Called by TerminalService.close() when the user closes a terminal tab.
   * Captures the screen buffer and moves the card to "archived" with readOnly=true.
   */
  async onSessionArchived(params: {
    sessionId: string;
    minionId: string;
    screenBuffer?: string;
    cols?: number;
    rows?: number;
  }): Promise<void> {
    try {
      const cards = await this.ensureLoaded(params.minionId);
      const card = cards.find((c) => c.sessionId === params.sessionId);
      if (!card) return;

      card.column = "archived";
      card.readOnly = true;
      card.archivedAt = Date.now();
      card.closedAt ??= Date.now();

      // Store screen buffer if within size limit
      if (params.screenBuffer && params.screenBuffer.length <= MAX_BUFFER_BYTES) {
        card.screenBuffer = params.screenBuffer;
      }
      card.cols = params.cols;
      card.rows = params.rows;

      // Evict oldest archived cards if over limit
      this.evictOldArchivedCards(cards);

      await this.persist(params.minionId);
      this.emitChange(params.minionId);
    } catch (error) {
      log.error("KanbanService.onSessionArchived failed:", error);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — called by oRPC procedures
  // ---------------------------------------------------------------------------

  /**
   * Get all cards for a minion. Excludes screenBuffer from returned cards
   * to keep payloads small — use getArchivedBuffer for that.
   */
  async getCards(minionId: string): Promise<KanbanCard[]> {
    const cards = await this.ensureLoaded(minionId);
    // Strip screenBuffer from list response to keep payloads small
    return cards.map((c) => {
      const { screenBuffer: _, ...rest } = c;
      return rest;
    });
  }

  /** Move a card to a target column (user drag-drop). */
  async moveCard(
    minionId: string,
    sessionId: string,
    targetColumn: KanbanColumnId,
  ): Promise<void> {
    const cards = await this.ensureLoaded(minionId);
    const card = cards.find((c) => c.sessionId === sessionId);
    if (!card) return;

    // Validate allowed moves:
    // - Can't drag out of "active" (system-managed)
    // - Can't drag out of "archived" (read-only)
    if (card.column === "active" || card.column === "archived") {
      return;
    }

    card.column = targetColumn;
    if (targetColumn === "archived") {
      card.readOnly = true;
      card.archivedAt = Date.now();
    }

    await this.persist(minionId);
    this.emitChange(minionId);
  }

  /** Get the screen buffer for an archived session. */
  async getArchivedBuffer(
    minionId: string,
    sessionId: string,
  ): Promise<string | null> {
    const cards = await this.ensureLoaded(minionId);
    const card = cards.find((c) => c.sessionId === sessionId);
    return card?.screenBuffer ?? null;
  }

  /** Subscribe to changes for a minion. Returns unsubscribe function. */
  onChange(callback: (minionId: string) => void): () => void {
    this.changeEmitter.on("change", callback);
    return () => this.changeEmitter.off("change", callback);
  }

  /** Persist all loaded minions to disk. Called on app shutdown. */
  async saveAll(): Promise<void> {
    const promises: Array<Promise<void>> = [];
    for (const minionId of this.loadedMinions) {
      promises.push(this.persist(minionId));
    }
    await Promise.allSettled(promises);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure cards for a minion are loaded into memory.
   * Self-healing: corrupted files return empty array.
   */
  private async ensureLoaded(minionId: string): Promise<KanbanCard[]> {
    if (!this.loadedMinions.has(minionId)) {
      this.loadedMinions.add(minionId);
      try {
        const persisted = await this.sessionFileManager.read(minionId);
        if (persisted?.version === 1 && Array.isArray(persisted.cards)) {
          // Self-healing: filter out malformed cards
          const valid = persisted.cards.filter(
            (c) =>
              typeof c.sessionId === "string" &&
              typeof c.minionId === "string" &&
              typeof c.column === "string" &&
              typeof c.createdAt === "number",
          );
          this.cards.set(minionId, valid);
        } else {
          this.cards.set(minionId, []);
        }
      } catch (error) {
        log.error("KanbanService: failed to load kanban.json, starting fresh:", error);
        this.cards.set(minionId, []);
      }
    }
    return this.cards.get(minionId) ?? [];
  }

  /** Persist current in-memory state to disk for a minion. */
  private async persist(minionId: string): Promise<void> {
    const cards = this.cards.get(minionId) ?? [];
    const state: PersistedKanbanState = { version: 1, cards };
    const result = await this.sessionFileManager.write(minionId, state);
    if (!result.success) {
      log.error("KanbanService: failed to persist:", result.error);
    }
  }

  /** Emit change event for oRPC subscription. */
  private emitChange(minionId: string): void {
    this.changeEmitter.emit("change", minionId);
  }

  /**
   * Evict oldest archived cards if count exceeds MAX_ARCHIVED_CARDS.
   * Drops screenBuffer from oldest first, then removes entirely.
   */
  private evictOldArchivedCards(cards: KanbanCard[]): void {
    const archived = cards
      .filter((c) => c.column === "archived")
      .sort((a, b) => (a.archivedAt ?? a.createdAt) - (b.archivedAt ?? b.createdAt));

    if (archived.length <= MAX_ARCHIVED_CARDS) return;

    // First pass: drop screen buffers from oldest to reclaim space
    const excess = archived.length - MAX_ARCHIVED_CARDS;
    for (let i = 0; i < excess; i++) {
      const old = archived[i];
      if (old) {
        // Remove the entire card from the array
        const idx = cards.indexOf(old);
        if (idx !== -1) {
          cards.splice(idx, 1);
        }
      }
    }
  }
}
