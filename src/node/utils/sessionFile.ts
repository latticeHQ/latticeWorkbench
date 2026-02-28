import * as fs from "fs/promises";
import * as path from "path";
import writeFileAtomic from "write-file-atomic";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import type { Config } from "@/node/config";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";
import { log } from "@/node/services/log";
import { getErrorMessage } from "@/common/utils/errors";

export interface SessionFileWriteOptions {
  /**
   * Optional guard that runs *after* the minion file lock is acquired but *before*
   * the session directory is created.
   *
   * If it returns false, the write is skipped.
   */
  shouldWrite?: () => boolean;
}

/**
 * Shared utility for managing JSON files in minion session directories.
 * Provides consistent file locking, error handling, and path resolution.
 *
 * Used by HistoryService partial persistence, InitStateManager, and other services that need
 * to persist state to ~/.lattice/sessions/{minionId}/.
 */
export class SessionFileManager<T> {
  private readonly config: Config;
  private readonly fileName: string;
  private readonly fileLocks = minionFileLocks;

  constructor(config: Config, fileName: string) {
    this.config = config;
    this.fileName = fileName;
  }

  private getFilePath(minionId: string): string {
    return path.join(this.config.getSessionDir(minionId), this.fileName);
  }

  /**
   * Read JSON file from minion session directory.
   * Returns null if file doesn't exist (not an error).
   */
  async read(minionId: string): Promise<T | null> {
    try {
      const filePath = this.getFilePath(minionId);
      const data = await fs.readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null; // File doesn't exist
      }
      // Log other errors but don't fail
      log.error(`Error reading ${this.fileName}:`, error);
      return null;
    }
  }

  /**
   * Write JSON file to minion session directory with file locking.
   * Creates session directory if it doesn't exist.
   *
   * If options.shouldWrite returns false, the write is skipped (and the session
   * directory is not created).
   */
  async write(
    minionId: string,
    data: T,
    options?: SessionFileWriteOptions
  ): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        if (options?.shouldWrite && !options.shouldWrite()) {
          return Ok(undefined);
        }

        const sessionDir = this.config.getSessionDir(minionId);
        await fs.mkdir(sessionDir, { recursive: true });
        const filePath = this.getFilePath(minionId);
        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
        return Ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to write ${this.fileName}: ${message}`);
      }
    });
  }

  /**
   * Delete JSON file from minion session directory with file locking.
   * Idempotent - no error if file doesn't exist.
   */
  async delete(minionId: string): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const filePath = this.getFilePath(minionId);
        await fs.unlink(filePath);
        return Ok(undefined);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return Ok(undefined); // Already deleted
        }
        const message = getErrorMessage(error);
        return Err(`Failed to delete ${this.fileName}: ${message}`);
      }
    });
  }
}
