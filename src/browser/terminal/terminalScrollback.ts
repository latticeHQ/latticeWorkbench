/**
 * Terminal scrollback persistence — ORPC-backed, file-stored on the node process.
 *
 * Architecture:
 *   - All data lives in ~/.lattice/terminal-scrollback/{sessionId}.bin (8 MB cap, node side).
 *   - The browser keeps only the DELTA since the last flush in memory.
 *     100 active agents × maybe 64 KB in-flight = ~6 MB peak renderer memory.
 *   - Flushes are debounced: every FLUSH_INTERVAL_MS or when the delta hits FLUSH_THRESHOLD_BYTES.
 *     This keeps the IPC call rate low during heavy output (e.g. Codex compiling a project).
 *   - On reload: one async `load()` call fills the terminal scrollback buffer before subscribing.
 *   - On exit / explicit close: immediate flush + clear.
 *
 * Usage (inside TerminalView):
 *   const sb = useMemo(() => createScrollbackClient(api, sessionId), [api, sessionId]);
 *   useEffect(() => sb.dispose, [sb]);  // cleanup on unmount
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

type APIClient = RouterClient<AppRouter>;

/** Maximum bytes held in the in-memory delta before a forced flush. */
const FLUSH_THRESHOLD_BYTES = 64 * 1024; // 64 KB
/** Idle flush interval — flush even if delta < threshold. */
const FLUSH_INTERVAL_MS = 2_000; // 2 s

export interface ScrollbackClient {
  /** Load the full stored buffer from disk. Call before subscribing to the terminal router. */
  load(): Promise<string>;
  /**
   * Append a chunk to the in-memory delta and schedule a debounced flush.
   * Safe to call from a hot output path — no I/O on every call.
   */
  onOutput(data: string): void;
  /**
   * Immediately flush the in-memory delta to disk, then delete the file.
   * Call when the session exits so the next session starts clean.
   */
  onExit(): Promise<void>;
  /**
   * Explicitly delete the stored buffer (e.g. user closed the tab).
   * Also cancels any pending flush.
   */
  clear(): Promise<void>;
  /**
   * Cancel the debounce timer and flush any remaining delta.
   * Call in a React effect cleanup when the component unmounts.
   */
  dispose(): void;
}

export function createScrollbackClient(api: APIClient, sessionId: string): ScrollbackClient {
  let delta = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function cancelTimer() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  async function flush(): Promise<void> {
    cancelTimer();
    const chunk = delta;
    delta = "";
    if (!chunk || disposed) return;
    try {
      await api.terminal.scrollback.append({ sessionId, data: chunk });
    } catch {
      // Non-fatal: scrollback is best-effort
    }
  }

  function scheduleFlush() {
    if (disposed) return;
    if (delta.length >= FLUSH_THRESHOLD_BYTES) {
      void flush();
      return;
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  return {
    async load(): Promise<string> {
      try {
        return await api.terminal.scrollback.load({ sessionId });
      } catch {
        return "";
      }
    },

    onOutput(data: string): void {
      if (disposed) return;
      delta += data;
      scheduleFlush();
    },

    async onExit(): Promise<void> {
      // Flush remaining delta first, then wipe — guarantees no data loss on graceful exit
      await flush();
      disposed = true;
      try {
        await api.terminal.scrollback.clear({ sessionId });
      } catch {
        // ignore
      }
    },

    async clear(): Promise<void> {
      cancelTimer();
      delta = "";
      disposed = true;
      try {
        await api.terminal.scrollback.clear({ sessionId });
      } catch {
        // ignore
      }
    },

    dispose(): void {
      // Best-effort sync flush is not possible here (React cleanup is synchronous).
      // Schedule a flush before tearing down so the most recent output is persisted.
      if (!disposed && delta) {
        const chunk = delta;
        delta = "";
        cancelTimer();
        // Fire-and-forget: flush is not awaited but will complete before GC
        void api.terminal.scrollback.append({ sessionId, data: chunk }).catch(() => undefined);
      } else {
        cancelTimer();
      }
      disposed = true;
    },
  };
}
