import * as fs from "fs/promises";
import * as path from "path";
import writeFileAtomic from "write-file-atomic";
import assert from "@/common/utils/assert";
import type { Config } from "@/node/config";
import type { HistoryService } from "./historyService";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";
import type { ChatUsageDisplay } from "@/common/utils/tokens/usageAggregator";
import { sumUsageHistory } from "@/common/utils/tokens/usageAggregator";
import { createDisplayUsage } from "@/common/utils/tokens/displayUsage";
import type { TokenConsumer } from "@/common/types/chatStats";
import type { LatticeMessage } from "@/common/types/message";
import { log } from "./log";

export interface SessionUsageTokenStatsCacheV1 {
  /**
   * Schema version for this cache block.
   * (Kept separate so we don't have to bump session-usage.json version for derived fields.)
   */
  version: 1;

  computedAt: number;

  /**
   * Stable fingerprint of provider config used when this cache was computed.
   * Optional for backward compatibility with pre-fingerprint cache entries.
   */
  providersConfigVersion?: number;

  /** Tokenization model (impacts tokenizer + tool definition counting) */
  model: string;

  /** e.g. "o200k_base", "claude" */
  tokenizerName: string;

  /** Cheap fingerprint to validate cache freshness against current message history */
  history: {
    messageCount: number;
    maxHistorySequence?: number;
  };

  consumers: TokenConsumer[];
  totalTokens: number;
  topFilePaths?: Array<{ path: string; tokens: number }>;
}

export interface SessionUsageFile {
  byModel: Record<string, ChatUsageDisplay>;
  lastRequest?: {
    model: string;
    usage: ChatUsageDisplay;
    timestamp: number;
  };

  /**
   * Idempotency ledger for rolled-up sidekick usage.
   *
   * When a child minion is deleted, we merge its byModel usage into the parent.
   * This tracks which children have already been merged to prevent double-counting
   * if removal is retried.
   */
  rolledUpFrom?: Record<string, true>;

  /** Cached token statistics (consumer/file breakdown) for Costs tab */
  tokenStatsCache?: SessionUsageTokenStatsCacheV1;

  version: 1;
}

/**
 * Service for managing cumulative session usage tracking.
 *
 * Replaces O(n) message iteration with a persistent JSON file that stores
 * per-model usage breakdowns. Usage is accumulated on stream-end, never
 * subtracted, making costs immune to message deletion.
 */
export class SessionUsageService {
  private readonly SESSION_USAGE_FILE = "session-usage.json";
  private readonly fileLocks = minionFileLocks;
  private readonly config: Config;
  private readonly historyService: HistoryService;

  constructor(config: Config, historyService: HistoryService) {
    this.config = config;
    this.historyService = historyService;
  }
  /**
   * Collect all messages from iterateFullHistory into an array.
   * Usage rebuild needs every epoch for accurate totals.
   */
  private async collectFullHistory(minionId: string): Promise<LatticeMessage[]> {
    const messages: LatticeMessage[] = [];
    const result = await this.historyService.iterateFullHistory(minionId, "forward", (chunk) => {
      messages.push(...chunk);
    });
    if (!result.success) {
      log.warn(`Failed to iterate history for ${minionId}: ${result.error}`);
      return [];
    }
    return messages;
  }

  private getFilePath(minionId: string): string {
    return path.join(this.config.getSessionDir(minionId), this.SESSION_USAGE_FILE);
  }

  private async readFile(minionId: string): Promise<SessionUsageFile> {
    try {
      const data = await fs.readFile(this.getFilePath(minionId), "utf-8");
      return JSON.parse(data) as SessionUsageFile;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { byModel: {}, version: 1 };
      }
      throw error;
    }
  }

  private async writeFile(minionId: string, data: SessionUsageFile): Promise<void> {
    const filePath = this.getFilePath(minionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Record usage from a completed stream. Accumulates with existing usage
   * AND updates lastRequest in a single atomic write.
   * Model should already be in canonical form.
   */
  async recordUsage(minionId: string, model: string, usage: ChatUsageDisplay): Promise<void> {
    return this.fileLocks.withLock(minionId, async () => {
      const current = await this.readFile(minionId);
      const existing = current.byModel[model];
      // CRITICAL: Accumulate, don't overwrite
      current.byModel[model] = existing ? sumUsageHistory([existing, usage])! : usage;
      current.lastRequest = { model, usage, timestamp: Date.now() };
      await this.writeFile(minionId, current);
    });
  }

  /**
   * Persist derived token stats (consumer + file breakdown) as a cache.
   *
   * This is intentionally treated as a replaceable cache: if the cache is stale,
   * the next tokenizer.calculateStats call will overwrite it.
   */
  async setTokenStatsCache(
    minionId: string,
    cache: SessionUsageTokenStatsCacheV1
  ): Promise<void> {
    assert(minionId.trim().length > 0, "setTokenStatsCache: minionId empty");
    assert(cache.version === 1, "setTokenStatsCache: cache.version must be 1");
    assert(cache.totalTokens >= 0, "setTokenStatsCache: totalTokens must be >= 0");
    assert(
      cache.history.messageCount >= 0,
      "setTokenStatsCache: history.messageCount must be >= 0"
    );
    for (const consumer of cache.consumers) {
      assert(
        typeof consumer.tokens === "number" && consumer.tokens >= 0,
        `setTokenStatsCache: consumer tokens must be >= 0 (${consumer.name})`
      );
    }

    return this.fileLocks.withLock(minionId, async () => {
      // Defensive: don't create new session dirs for already-deleted minions.
      if (!this.config.findMinion(minionId)) {
        return;
      }

      let current: SessionUsageFile;
      try {
        current = await this.readFile(minionId);
      } catch {
        // Parse errors or other read failures - best-effort rebuild.
        log.warn(
          `session-usage.json unreadable for ${minionId}, rebuilding before token stats cache update`
        );
        const messages = await this.collectFullHistory(minionId);
        if (messages.length > 0) {
          await this.rebuildFromMessagesInternal(minionId, messages);
          current = await this.readFile(minionId);
        } else {
          current = { byModel: {}, version: 1 };
        }
      }

      current.tokenStatsCache = cache;
      await this.writeFile(minionId, current);
    });
  }

  /**
   * Merge child usage into the parent minion.
   *
   * Used to preserve sidekick costs when the child minion is deleted.
   *
   * IMPORTANT:
   * - Does not update parent's lastRequest
   * - Uses an on-disk idempotency ledger (rolledUpFrom) to prevent double-counting
   */
  async rollUpUsageIntoParent(
    parentMinionId: string,
    childMinionId: string,
    childUsageByModel: Record<string, ChatUsageDisplay>
  ): Promise<{ didRollUp: boolean }> {
    assert(parentMinionId.trim().length > 0, "rollUpUsageIntoParent: parentMinionId empty");
    assert(childMinionId.trim().length > 0, "rollUpUsageIntoParent: childMinionId empty");
    assert(
      parentMinionId !== childMinionId,
      "rollUpUsageIntoParent: parentMinionId must differ from childMinionId"
    );

    // Defensive: don't create new session dirs for already-deleted parents.
    if (!this.config.findMinion(parentMinionId)) {
      return { didRollUp: false };
    }

    const entries = Object.entries(childUsageByModel);
    if (entries.length === 0) {
      return { didRollUp: false };
    }

    return this.fileLocks.withLock(parentMinionId, async () => {
      let current: SessionUsageFile;
      try {
        current = await this.readFile(parentMinionId);
      } catch {
        // Parse errors or other read failures - best-effort rebuild.
        log.warn(
          `session-usage.json unreadable for ${parentMinionId}, rebuilding before roll-up`
        );
        const messages = await this.collectFullHistory(parentMinionId);
        if (messages.length > 0) {
          await this.rebuildFromMessagesInternal(parentMinionId, messages);
          current = await this.readFile(parentMinionId);
        } else {
          current = { byModel: {}, version: 1 };
        }
      }

      if (current.rolledUpFrom?.[childMinionId]) {
        return { didRollUp: false };
      }

      for (const [model, usage] of entries) {
        const existing = current.byModel[model];
        current.byModel[model] = existing ? sumUsageHistory([existing, usage])! : usage;
      }

      current.rolledUpFrom = { ...(current.rolledUpFrom ?? {}), [childMinionId]: true };
      await this.writeFile(parentMinionId, current);

      return { didRollUp: true };
    });
  }

  /**
   * Read current session usage. Returns undefined if file missing/corrupted
   * and no messages to rebuild from.
   */
  async getSessionUsage(minionId: string): Promise<SessionUsageFile | undefined> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const filePath = this.getFilePath(minionId);
        const data = await fs.readFile(filePath, "utf-8");
        return JSON.parse(data) as SessionUsageFile;
      } catch (error) {
        // File missing or corrupted - try to rebuild from messages
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          const messages = await this.collectFullHistory(minionId);
          if (messages.length > 0) {
            await this.rebuildFromMessagesInternal(minionId, messages);
            return this.readFile(minionId);
          }
          return undefined; // Truly empty session
        }
        // Parse error - try rebuild
        log.warn(`session-usage.json corrupted for ${minionId}, rebuilding`);
        const messages = await this.collectFullHistory(minionId);
        if (messages.length > 0) {
          await this.rebuildFromMessagesInternal(minionId, messages);
          return this.readFile(minionId);
        }
        return undefined;
      }
    });
  }

  /**
   * Batch fetch session usage for multiple minions.
   * Optimized for displaying costs in archived minions list.
   */
  async getSessionUsageBatch(
    minionIds: string[]
  ): Promise<Record<string, SessionUsageFile | undefined>> {
    const results: Record<string, SessionUsageFile | undefined> = {};
    // Read files in parallel without rebuilding from messages (archived minions
    // should already have session-usage.json; skip rebuild to keep batch fast)
    await Promise.all(
      minionIds.map(async (minionId) => {
        try {
          const filePath = this.getFilePath(minionId);
          const data = await fs.readFile(filePath, "utf-8");
          results[minionId] = JSON.parse(data) as SessionUsageFile;
        } catch {
          results[minionId] = undefined;
        }
      })
    );
    return results;
  }

  /**
   * Rebuild session usage from messages (for migration/recovery).
   * Internal version - called within lock.
   */
  private async rebuildFromMessagesInternal(
    minionId: string,
    messages: LatticeMessage[]
  ): Promise<void> {
    const result: SessionUsageFile = { byModel: {}, version: 1 };
    let lastAssistantUsage: { model: string; usage: ChatUsageDisplay } | undefined;

    for (const msg of messages) {
      if (msg.role === "assistant") {
        // Include historicalUsage from legacy compaction summaries.
        // This field was removed from LatticeMetadata but may exist in persisted data.
        // It's a ChatUsageDisplay representing all pre-compaction costs (model-agnostic).
        const historicalUsage = (msg.metadata as { historicalUsage?: ChatUsageDisplay })
          ?.historicalUsage;
        if (historicalUsage) {
          const existing = result.byModel.historical;
          result.byModel.historical = existing
            ? sumUsageHistory([existing, historicalUsage])!
            : historicalUsage;
        }

        // Extract current message's usage
        if (msg.metadata?.usage) {
          const rawModel = msg.metadata.model ?? "unknown";
          const model = rawModel;
          const usage = createDisplayUsage(
            msg.metadata.usage,
            rawModel,
            msg.metadata.providerMetadata
          );

          if (usage) {
            const existing = result.byModel[model];
            result.byModel[model] = existing ? sumUsageHistory([existing, usage])! : usage;
            lastAssistantUsage = { model, usage };
          }
        }
      }
    }

    if (lastAssistantUsage) {
      result.lastRequest = {
        model: lastAssistantUsage.model,
        usage: lastAssistantUsage.usage,
        timestamp: Date.now(),
      };
    }

    await this.writeFile(minionId, result);
    log.info(`Rebuilt session-usage.json for ${minionId} from ${messages.length} messages`);
  }

  /**
   * Public rebuild method (acquires lock).
   */
  async rebuildFromMessages(minionId: string, messages: LatticeMessage[]): Promise<void> {
    return this.fileLocks.withLock(minionId, async () => {
      await this.rebuildFromMessagesInternal(minionId, messages);
    });
  }

  /**
   * Delete session usage file (when minion is deleted).
   */
  async deleteSessionUsage(minionId: string): Promise<void> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        await fs.unlink(this.getFilePath(minionId));
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    });
  }
}
