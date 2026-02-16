/**
 * TerminalScrollbackService — disk-backed scrollback buffer for terminal sessions.
 *
 * Persists raw PTY output per session to `~/.lattice/terminal-scrollback/`.
 * On reconnect the browser reads the stored buffer, writes it into the terminal
 * emulator to fill the scrollback, then receives a fresh screenState from the
 * backend to restore the visible screen.
 *
 * Design decisions:
 *   - File-based (not localStorage) so there's no browser storage quota issue.
 *     At 100 concurrent agents × 8 MB cap = 800 MB max, fully on disk.
 *   - Writes are atomic (write-file-atomic) to avoid torn files on crash.
 *   - append() trims from the front when the buffer exceeds MAX_BYTES so
 *     users always see the most recent output on reload.
 *   - clear() deletes the file; the directory persists (cheap to recreate).
 */

import * as fs from "fs";
import * as path from "path";
import * as fsPromises from "fs/promises";
import writeFileAtomic from "write-file-atomic";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";

/** Maximum bytes stored per session. Trimmed from the front when exceeded. */
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

/** Sanitise a session ID to a safe filename component. */
function toSafeFilename(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class TerminalScrollbackService {
  private readonly scrollbackDir: string;

  constructor(config: Config) {
    this.scrollbackDir = path.join(config.rootDir, "terminal-scrollback");
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Ensure the scrollback directory exists. Called lazily on first write. */
  private async ensureDir(): Promise<void> {
    await fsPromises.mkdir(this.scrollbackDir, { recursive: true });
  }

  private filePath(sessionId: string): string {
    return path.join(this.scrollbackDir, `${toSafeFilename(sessionId)}.bin`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Load the full stored buffer for a session.
   * Returns an empty string if no buffer exists yet.
   */
  async load(sessionId: string): Promise<string> {
    const p = this.filePath(sessionId);
    try {
      const buf = await fsPromises.readFile(p);
      return buf.toString("utf8");
    } catch (err: unknown) {
      if (isNotFoundError(err)) return "";
      log.warn("[TerminalScrollback] load error", { sessionId, error: err });
      return "";
    }
  }

  /**
   * Append `data` to the stored buffer for a session.
   * If the resulting buffer exceeds MAX_BYTES, the oldest bytes are dropped.
   * Creates the file (and directory) if they don't exist yet.
   */
  async append(sessionId: string, data: string): Promise<void> {
    if (!data) return;

    const p = this.filePath(sessionId);
    try {
      await this.ensureDir();

      // Read existing content
      let existing = "";
      try {
        const buf = await fsPromises.readFile(p);
        existing = buf.toString("utf8");
      } catch (err: unknown) {
        if (!isNotFoundError(err)) throw err;
        // No file yet — start empty
      }

      let combined = existing + data;

      // Trim from the front if we've exceeded the cap
      if (combined.length > MAX_BYTES) {
        combined = combined.slice(combined.length - MAX_BYTES);
      }

      await writeFileAtomic(p, combined, "utf8");
    } catch (err) {
      // Non-fatal: missing scrollback is recoverable
      log.warn("[TerminalScrollback] append error", { sessionId, error: err });
    }
  }

  /**
   * Delete the stored buffer for a session (call when session exits or is closed).
   */
  async clear(sessionId: string): Promise<void> {
    const p = this.filePath(sessionId);
    try {
      await fsPromises.unlink(p);
    } catch (err: unknown) {
      if (!isNotFoundError(err)) {
        log.warn("[TerminalScrollback] clear error", { sessionId, error: err });
      }
    }
  }

  /**
   * Delete all stored scrollback files.
   * Called on application startup to prune stale files from crashed sessions.
   */
  async clearAll(): Promise<void> {
    try {
      if (!fs.existsSync(this.scrollbackDir)) return;
      const entries = await fsPromises.readdir(this.scrollbackDir);
      await Promise.all(
        entries.map((entry) =>
          fsPromises.unlink(path.join(this.scrollbackDir, entry)).catch(() => undefined)
        )
      );
    } catch (err) {
      log.warn("[TerminalScrollback] clearAll error", { error: err });
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "ENOENT"
  );
}
