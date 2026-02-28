import { dirname } from "path";
import { mkdir, readFile, access } from "fs/promises";
import { constants } from "fs";
import writeFileAtomic from "write-file-atomic";
import {
  type ExtensionAgentStatus,
  type ExtensionMetadata,
  type ExtensionMetadataFile,
  getExtensionMetadataPath,
} from "@/node/utils/extensionMetadata";
import type { MinionActivitySnapshot } from "@/common/types/minion";
import { log } from "@/node/services/log";

/**
 * Stateless service for managing minion metadata used by VS Code extension integration.
 *
 * This service tracks:
 * - recency: Unix timestamp (ms) of last user interaction
 * - streaming: Boolean indicating if minion has an active stream
 * - lastModel: Last model used in this minion
 * - lastThinkingLevel: Last thinking/reasoning level used in this minion
 * - agentStatus: Most recent status_set payload (for sidebar progress in background minions)
 *
 * File location: ~/.lattice/extensionMetadata.json
 *
 * Design:
 * - Stateless: reads from disk on every operation, no in-memory cache
 * - Atomic writes: uses write-file-atomic to prevent corruption
 * - Read-heavy workload: extension reads, main app writes on user interactions
 */

export interface ExtensionMinionMetadata extends ExtensionMetadata {
  minionId: string;
  updatedAt: number;
}

export class ExtensionMetadataService {
  private readonly filePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  /**
   * Serialize all mutating operations on the shared metadata file.
   * Prevents cross-minion read-modify-write races since all minions
   * share a single extensionMetadata.json file.
   */
  private async withSerializedMutation<T>(fn: () => Promise<T>): Promise<T> {
    let result!: T;
    const run = async () => {
      result = await fn();
    };
    const next = this.mutationQueue.catch(() => undefined).then(run);
    this.mutationQueue = next;
    await next;
    return result;
  }

  private coerceStatusUrl(url: unknown): string | null {
    return typeof url === "string" ? url : null;
  }

  private coerceAgentStatus(status: unknown): ExtensionAgentStatus | null {
    if (typeof status !== "object" || status === null) {
      return null;
    }

    const record = status as Record<string, unknown>;
    if (typeof record.emoji !== "string" || typeof record.message !== "string") {
      return null;
    }

    const url = this.coerceStatusUrl(record.url);
    return {
      emoji: record.emoji,
      message: record.message,
      ...(url ? { url } : {}),
    };
  }

  private toSnapshot(entry: ExtensionMetadata): MinionActivitySnapshot {
    return {
      recency: entry.recency,
      streaming: entry.streaming,
      lastModel: entry.lastModel ?? null,
      lastThinkingLevel: entry.lastThinkingLevel ?? null,
      agentStatus: this.coerceAgentStatus(entry.agentStatus),
    };
  }

  constructor(filePath?: string) {
    this.filePath = filePath ?? getExtensionMetadataPath();
  }

  /**
   * Initialize the service by ensuring directory exists and clearing stale streaming flags.
   * Call this once on app startup.
   */
  async initialize(): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.filePath);
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
    }

    // Clear stale streaming flags (from crashes)
    await this.clearStaleStreaming();
  }

  private async load(): Promise<ExtensionMetadataFile> {
    try {
      await access(this.filePath, constants.F_OK);
    } catch {
      return { version: 1, minions: {} };
    }

    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as ExtensionMetadataFile;

      // Validate structure
      if (typeof parsed !== "object" || parsed.version !== 1) {
        log.error("Invalid metadata file, resetting");
        return { version: 1, minions: {} };
      }

      parsed.minions ??= {};

      return parsed;
    } catch (error) {
      log.error("Failed to load metadata:", error);
      return { version: 1, minions: {} };
    }
  }

  private async save(data: ExtensionMetadataFile): Promise<void> {
    try {
      const content = JSON.stringify(data, null, 2);
      await writeFileAtomic(this.filePath, content, "utf-8");
    } catch (error) {
      log.error("Failed to save metadata:", error);
    }
  }

  /**
   * Update the recency timestamp for a minion.
   * Call this on user messages or other interactions.
   */
  async updateRecency(
    minionId: string,
    timestamp: number = Date.now()
  ): Promise<MinionActivitySnapshot> {
    return this.withSerializedMutation(async () => {
      const data = await this.load();

      if (!data.minions[minionId]) {
        data.minions[minionId] = {
          recency: timestamp,
          streaming: false,
          lastModel: null,
          lastThinkingLevel: null,
          agentStatus: null,
          lastStatusUrl: null,
        };
      } else {
        data.minions[minionId].recency = timestamp;
      }

      await this.save(data);
      const minion = data.minions[minionId];
      if (!minion) {
        throw new Error(`Minion ${minionId} metadata missing after update.`);
      }
      return this.toSnapshot(minion);
    });
  }

  /**
   * Set the streaming status for a minion.
   * Call this when streams start/end.
   */
  async setStreaming(
    minionId: string,
    streaming: boolean,
    model?: string,
    thinkingLevel?: ExtensionMetadata["lastThinkingLevel"]
  ): Promise<MinionActivitySnapshot> {
    return this.withSerializedMutation(async () => {
      const data = await this.load();
      const now = Date.now();

      if (!data.minions[minionId]) {
        data.minions[minionId] = {
          recency: now,
          streaming,
          lastModel: model ?? null,
          lastThinkingLevel: thinkingLevel ?? null,
          agentStatus: null,
          lastStatusUrl: null,
        };
      } else {
        data.minions[minionId].streaming = streaming;
        if (model) {
          data.minions[minionId].lastModel = model;
        }
        if (thinkingLevel !== undefined) {
          data.minions[minionId].lastThinkingLevel = thinkingLevel;
        }
      }

      await this.save(data);
      const minion = data.minions[minionId];
      if (!minion) {
        throw new Error(`Minion ${minionId} metadata missing after streaming update.`);
      }
      return this.toSnapshot(minion);
    });
  }

  /**
   * Update the latest status_set payload for a minion.
   */
  async setAgentStatus(
    minionId: string,
    agentStatus: ExtensionAgentStatus | null
  ): Promise<MinionActivitySnapshot> {
    return this.withSerializedMutation(async () => {
      const data = await this.load();
      const now = Date.now();

      if (!data.minions[minionId]) {
        const carriedUrl = agentStatus?.url;
        data.minions[minionId] = {
          recency: now,
          streaming: false,
          lastModel: null,
          lastThinkingLevel: null,
          agentStatus:
            agentStatus && carriedUrl !== undefined
              ? {
                  ...agentStatus,
                  url: carriedUrl,
                }
              : agentStatus,
          lastStatusUrl: carriedUrl ?? null,
        };
      } else {
        const minion = data.minions[minionId];
        const previousStatus = this.coerceAgentStatus(minion.agentStatus);
        const previousUrl =
          previousStatus?.url ?? this.coerceStatusUrl(minion.lastStatusUrl) ?? null;
        if (agentStatus) {
          const carriedUrl = agentStatus.url ?? previousUrl ?? undefined;
          minion.agentStatus =
            carriedUrl !== undefined
              ? {
                  ...agentStatus,
                  url: carriedUrl,
                }
              : agentStatus;
          minion.lastStatusUrl = carriedUrl ?? null;
        } else {
          minion.agentStatus = null;
          // Keep lastStatusUrl across clears so the next status_set without `url`
          // can still reuse the previous deep link.
          minion.lastStatusUrl = previousUrl;
        }
      }

      await this.save(data);
      const minion = data.minions[minionId];
      if (!minion) {
        throw new Error(`Minion ${minionId} metadata missing after agent status update.`);
      }
      return this.toSnapshot(minion);
    });
  }

  /**
   * Get metadata for a single minion.
   */
  async getMetadata(minionId: string): Promise<ExtensionMinionMetadata | null> {
    const data = await this.load();
    const entry = data.minions[minionId];
    if (!entry) return null;

    return {
      minionId,
      updatedAt: entry.recency, // Use recency as updatedAt for backwards compatibility
      ...entry,
    };
  }

  /**
   * Get all minion metadata, ordered by recency.
   * Used by VS Code extension to sort minion list.
   */
  async getAllMetadata(): Promise<Map<string, ExtensionMinionMetadata>> {
    const data = await this.load();
    const map = new Map<string, ExtensionMinionMetadata>();

    // Convert to array, sort by recency, then create map
    const entries = Object.entries(data.minions);
    entries.sort((a, b) => b[1].recency - a[1].recency);

    for (const [minionId, entry] of entries) {
      map.set(minionId, {
        minionId,
        updatedAt: entry.recency, // Use recency as updatedAt for backwards compatibility
        ...entry,
      });
    }

    return map;
  }

  /**
   * Delete metadata for a minion.
   * Call this when a minion is deleted.
   */
  async deleteMinion(minionId: string): Promise<void> {
    await this.withSerializedMutation(async () => {
      const data = await this.load();

      if (data.minions[minionId]) {
        delete data.minions[minionId];
        await this.save(data);
      }
    });
  }

  /**
   * Clear all streaming flags.
   * Call this on app startup to clean up stale streaming states from crashes.
   */
  async clearStaleStreaming(): Promise<void> {
    await this.withSerializedMutation(async () => {
      const data = await this.load();
      let modified = false;

      for (const entry of Object.values(data.minions)) {
        if (entry.streaming) {
          entry.streaming = false;
          modified = true;
        }
      }

      if (modified) {
        await this.save(data);
      }
    });
  }

  async getAllSnapshots(): Promise<Map<string, MinionActivitySnapshot>> {
    const data = await this.load();
    const map = new Map<string, MinionActivitySnapshot>();
    for (const [minionId, entry] of Object.entries(data.minions)) {
      map.set(minionId, this.toSnapshot(entry));
    }
    return map;
  }
}
