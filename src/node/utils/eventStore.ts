import { SessionFileManager, type SessionFileWriteOptions } from "@/node/utils/sessionFile";
import type { Config } from "@/node/config";
import { log } from "@/node/services/log";

/**
 * EventStore - Generic state management with persistence and replay for minion events.
 *
 * This abstraction captures the common pattern between InitStateManager and StreamManager:
 * 1. In-memory Map for active state
 * 2. Disk persistence for crash recovery / page reload
 * 3. Replay by serializing state into events and emitting them
 *
 * Type parameters:
 * - TState: The state object stored in memory/disk (e.g., InitStatus, MinionStreamInfo)
 * - TEvent: The event type emitted (e.g., MinionInitEvent)
 *
 * Design pattern:
 * - Composition over inheritance (doesn't extend EventEmitter directly)
 * - Subclasses provide serialization logic (state → events)
 * - Handles common operations (get/set/delete state, persist, replay)
 *
 * Example usage:
 *
 * class InitStateManager {
 *   private store = new EventStore<InitStatus, MinionInitEvent>(
 *     config,
 *     "init-status.json",
 *     (state) => this.serializeInitEvents(state),
 *     (event) => this.emit(event.type, event)
 *   );
 *
 *   async replayInit(minionId: string) {
 *     await this.store.replay(minionId);
 *   }
 * }
 */
export class EventStore<TState, TEvent> {
  private stateMap = new Map<string, TState>();
  private readonly fileManager: SessionFileManager<TState>;
  private readonly serializeState: (state: TState) => TEvent[];
  private readonly emitEvent: (event: TEvent) => void;
  private readonly storeName: string;

  /**
   * Create a new EventStore.
   *
   * @param config - Config object for SessionFileManager
   * @param filename - Filename for persisted state (e.g., "init-status.json")
   * @param serializeState - Function to convert state into array of events for replay
   * @param emitEvent - Function to emit a single event (typically wraps EventEmitter.emit)
   * @param storeName - Name for logging (e.g., "InitStateManager")
   */
  constructor(
    config: Config,
    filename: string,
    serializeState: (state: TState) => TEvent[],
    emitEvent: (event: TEvent) => void,
    storeName = "EventStore"
  ) {
    this.fileManager = new SessionFileManager<TState>(config, filename);
    this.serializeState = serializeState;
    this.emitEvent = emitEvent;
    this.storeName = storeName;
  }

  /**
   * Get in-memory state for a minion.
   * Returns undefined if no state exists.
   */
  getState(minionId: string): TState | undefined {
    return this.stateMap.get(minionId);
  }

  /**
   * Set in-memory state for a minion.
   */
  setState(minionId: string, state: TState): void {
    this.stateMap.set(minionId, state);
  }

  /**
   * Delete in-memory state for a minion.
   * Does NOT delete the persisted file (use deletePersisted for that).
   */
  deleteState(minionId: string): void {
    this.stateMap.delete(minionId);
  }

  /**
   * Check if in-memory state exists for a minion.
   */
  hasState(minionId: string): boolean {
    return this.stateMap.has(minionId);
  }

  /**
   * Read persisted state from disk.
   * Returns null if no file exists.
   */
  async readPersisted(minionId: string): Promise<TState | null> {
    return this.fileManager.read(minionId);
  }

  /**
   * Write state to disk.
   * Logs errors but doesn't throw (fire-and-forget pattern).
   */
  async persist(
    minionId: string,
    state: TState,
    options?: SessionFileWriteOptions
  ): Promise<void> {
    const result = await this.fileManager.write(minionId, state, options);
    if (!result.success) {
      log.error(`[${this.storeName}] Failed to persist state for ${minionId}: ${result.error}`);
    }
  }

  /**
   * Delete persisted state from disk.
   * Does NOT clear in-memory state (use deleteState for that).
   */
  async deletePersisted(minionId: string): Promise<void> {
    const result = await this.fileManager.delete(minionId);
    if (!result.success) {
      log.error(
        `[${this.storeName}] Failed to delete persisted state for ${minionId}: ${result.error}`
      );
    }
  }

  /**
   * Replay events for a minion.
   * Checks in-memory state first, falls back to disk.
   * Emits events using the provided emitEvent function.
   *
   * @param minionId - Minion ID to replay events for
   * @param context - Optional context to pass to serializeState (e.g., minionId)
   */
  async replay(minionId: string, context?: Record<string, unknown>): Promise<void> {
    // Try in-memory state first (most recent)
    let state: TState | undefined = this.stateMap.get(minionId);

    // Fall back to disk if not in memory
    if (!state) {
      const diskState = await this.fileManager.read(minionId);
      if (!diskState) {
        return; // No state to replay
      }
      state = diskState;
    }

    // Augment state with context for serialization
    const augmentedState = { ...state, ...context };

    // Serialize state into events and emit them
    const events = this.serializeState(augmentedState);
    for (const event of events) {
      this.emitEvent(event);
    }
  }

  /**
   * Get all minion IDs with in-memory state.
   * Useful for debugging or cleanup.
   */
  getActiveMinionIds(): string[] {
    return Array.from(this.stateMap.keys());
  }
}

/**
 * FUTURE REFACTORING: StreamManager Pattern
 *
 * StreamManager (src/services/streamManager.ts) follows a similar pattern to InitStateManager
 * but has NOT been refactored to use EventStore yet due to:
 * 1. Complexity: StreamManager is 1332 LoC with intricate state machine logic
 * 2. Risk: Heavily tested streaming infrastructure (40+ integration tests)
 * 3. Lifecycle differences: Streams auto-cleanup on completion, init logs persist forever
 *
 * Future refactoring could extract:
 * - MinionStreamInfo state management (minionStreams Map)
 * - Replay logic (replayStream method at line 1244)
 * - Partial persistence (currently on HistoryService partial methods)
 *
 * Key differences to handle:
 * - StreamManager has complex throttling (partialWriteTimer, PARTIAL_WRITE_THROTTLE_MS)
 * - Different persistence strategy (partial.json → chat.jsonl → delete partial)
 * - AbortController integration for stream cancellation
 * - Token tracking and usage statistics
 *
 * Pattern for adoption:
 * 1. Extract MinionStreamInfo → MessagePart[] serialization into helper
 * 2. Create EventStore instance for stream state (similar to InitStateManager)
 * 3. Replace manual replay loop (line 1270-1272) with store.replay()
 * 4. Keep existing throttling and persistence strategies (out of scope for EventStore)
 *
 * See InitStateManager refactor (this PR) for reference implementation.
 */
