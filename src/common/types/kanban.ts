/** Kanban board column identifiers for terminal session lifecycle tracking. */
export type KanbanColumnId = "queued" | "active" | "completed" | "archived";

/** All valid kanban columns in display order. */
export const KANBAN_COLUMNS: readonly KanbanColumnId[] = [
  "queued",
  "active",
  "completed",
  "archived",
] as const;

/** Display labels for each kanban column. */
export const KANBAN_COLUMN_LABELS: Record<KanbanColumnId, string> = {
  queued: "Queued",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};

/**
 * A single kanban card representing a terminal session.
 *
 * Cards track the full lifecycle of a terminal session from creation through
 * archival. The sessionId matches the PTY session ID so we can correlate
 * with live terminal state.
 */
export interface KanbanCard {
  /** Same as the terminal session ID (e.g., "ws123-1704567890-a1b2c3d4") */
  sessionId: string;
  minionId: string;
  /** Current column placement — source of truth for board position */
  column: KanbanColumnId;
  /** Profile display name (e.g., "Claude Code", "Default Terminal") */
  profileName: string;
  /** Profile ID from TerminalProfileService, if any */
  profileId?: string;
  /** When the session was first created (epoch ms) */
  createdAt: number;
  /** When the session process exited or was closed by user (epoch ms). null if still running. */
  closedAt?: number;
  /** When the session was moved to archived (epoch ms). null if not yet archived. */
  archivedAt?: number;
  /** Whether this session is read-only (archived sessions are always read-only) */
  readOnly: boolean;
  /**
   * Serialized xterm screen buffer snapshot at time of close/archive.
   * Excluded from list API responses to keep payloads small — fetched
   * separately via kanban.getArchivedBuffer.
   */
  screenBuffer?: string;
  /** Terminal dimensions at time of close */
  cols?: number;
  rows?: number;
}

/**
 * Root shape of ~/.lattice/sessions/{minionId}/kanban.json.
 * Stores every terminal session ever created for this minion
 * as an audit trail.
 */
export interface PersistedKanbanState {
  version: 1;
  cards: KanbanCard[];
}

/** Max archived cards per minion before oldest-first eviction. */
export const MAX_ARCHIVED_CARDS = 200;
