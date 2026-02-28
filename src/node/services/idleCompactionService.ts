import assert from "@/common/utils/assert";
import type { Config } from "@/node/config";
import type { HistoryService } from "./historyService";
import type { ExtensionMetadataService } from "./ExtensionMetadataService";
import { computeRecencyFromMessages } from "@/common/utils/recency";
import { log } from "./log";

const INITIAL_CHECK_DELAY_MS = 60 * 1000; // 1 minute - let startup initialization settle
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const HOURS_TO_MS = 60 * 60 * 1000;

interface QueuedIdleCompaction {
  minionId: string;
  thresholdMs: number;
}

/**
 * IdleCompactionService monitors minions for idle time and executes
 * compaction directly through a backend callback.
 *
 * Compactions are globally serialized to avoid thundering herd behavior when
 * one check cycle finds many idle minions at once.
 */
export class IdleCompactionService {
  private readonly config: Config;
  private readonly historyService: HistoryService;
  private readonly extensionMetadata: ExtensionMetadataService;
  private readonly executeIdleCompaction: (minionId: string) => Promise<void>;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly queue: QueuedIdleCompaction[] = [];
  private readonly queuedMinionIds = new Set<string>();
  private readonly activeMinionIds = new Set<string>();
  private isProcessingQueue = false;
  private stopped = false;

  constructor(
    config: Config,
    historyService: HistoryService,
    extensionMetadata: ExtensionMetadataService,
    executeIdleCompaction: (minionId: string) => Promise<void>
  ) {
    this.config = config;
    this.historyService = historyService;
    this.extensionMetadata = extensionMetadata;
    this.executeIdleCompaction = executeIdleCompaction;
  }

  /**
   * Start the idle compaction checker.
   * First check after 1 minute, then every hour.
   */
  start(): void {
    this.stopped = false;

    // First check after delay to let startup settle.
    this.initialTimeout = setTimeout(() => {
      void this.checkAllMinions();
      // Then periodically.
      this.checkInterval = setInterval(() => {
        void this.checkAllMinions();
      }, CHECK_INTERVAL_MS);
    }, INITIAL_CHECK_DELAY_MS);
    log.info("IdleCompactionService started", {
      initialDelayMs: INITIAL_CHECK_DELAY_MS,
      intervalMs: CHECK_INTERVAL_MS,
    });
  }

  /**
   * Stop the idle compaction checker.
   */
  stop(): void {
    this.stopped = true;

    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Best-effort queue reset: do not start new compactions after stop().
    this.queue.length = 0;
    this.queuedMinionIds.clear();

    log.info("IdleCompactionService stopped");
  }

  /**
   * Check all minions across all projects for idle compaction eligibility.
   */
  async checkAllMinions(): Promise<void> {
    const projectsConfig = this.config.loadConfigOrDefault();
    const now = Date.now();

    for (const [projectPath, projectConfig] of projectsConfig.projects) {
      const idleHours = projectConfig.idleCompactionHours;
      if (idleHours == null || idleHours < 1) continue;

      const thresholdMs = idleHours * HOURS_TO_MS;

      for (const minion of projectConfig.minions) {
        const minionId = minion.id ?? minion.name;
        if (!minionId) continue;

        try {
          await this.checkMinion(minionId, projectPath, thresholdMs, now);
        } catch (error) {
          log.error("Idle compaction check failed", { minionId, error });
        }
      }
    }
  }

  private async checkMinion(
    minionId: string,
    _projectPath: string,
    thresholdMs: number,
    now: number
  ): Promise<void> {
    // Check eligibility.
    const eligibility = await this.checkEligibility(minionId, thresholdMs, now);
    if (!eligibility.eligible) {
      log.debug("Minion not eligible for idle compaction", {
        minionId,
        reason: eligibility.reason,
      });
      return;
    }

    this.enqueueCompaction(minionId, thresholdMs);
  }

  private enqueueCompaction(minionId: string, thresholdMs: number): void {
    assert(minionId.trim().length > 0, "Idle compaction queue requires a minionId");
    assert(thresholdMs > 0, "Idle compaction queue requires a positive threshold");

    if (this.queuedMinionIds.has(minionId) || this.activeMinionIds.has(minionId)) {
      log.debug("Skipping duplicate idle compaction queue entry", {
        minionId,
      });
      return;
    }

    this.queue.push({ minionId, thresholdMs });
    this.queuedMinionIds.add(minionId);

    log.info("Queued idle compaction", {
      minionId,
      queueLength: this.queue.length,
      idleHours: thresholdMs / HOURS_TO_MS,
    });

    // Fire and forget: processing is serialized internally.
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.stopped) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.queue.length > 0) {
        if (this.stopped) {
          return;
        }

        const next = this.queue.shift();
        if (!next) {
          continue;
        }

        const { minionId, thresholdMs } = next;
        this.queuedMinionIds.delete(minionId);
        this.activeMinionIds.add(minionId);

        try {
          // Re-check eligibility right before execution to avoid stale queue decisions.
          const eligibility = await this.checkEligibility(minionId, thresholdMs, Date.now());
          if (!eligibility.eligible) {
            log.info("Skipped queued idle compaction because minion became ineligible", {
              minionId,
              reason: eligibility.reason,
            });
            continue;
          }

          log.info("Executing idle compaction", {
            minionId,
            idleHours: thresholdMs / HOURS_TO_MS,
            remainingQueued: this.queue.length,
          });

          await this.executeIdleCompaction(minionId);
        } catch (error) {
          log.error("Idle compaction execution failed", { minionId, error });
        } finally {
          this.activeMinionIds.delete(minionId);
        }
      }
    } finally {
      this.isProcessingQueue = false;

      // If work arrived after we exited the loop and service is still running,
      // kick processing again.
      if (!this.stopped && this.queue.length > 0) {
        void this.processQueue();
      }
    }
  }

  /**
   * Check if a minion is eligible for idle compaction.
   */
  async checkEligibility(
    minionId: string,
    thresholdMs: number,
    now: number
  ): Promise<{ eligible: boolean; reason?: string }> {
    // 1. Has messages? Only need tail messages — recency + last-message checks don't need full history.
    const historyResult = await this.historyService.getLastMessages(minionId, 50);
    if (!historyResult.success || historyResult.data.length === 0) {
      return { eligible: false, reason: "no_messages" };
    }
    const messages = historyResult.data;

    // 2. Check recency from messages (single source of truth).
    const recency = computeRecencyFromMessages(messages);
    if (recency === null) {
      return { eligible: false, reason: "no_recency_data" };
    }
    const idleMs = now - recency;
    if (idleMs < thresholdMs) {
      return { eligible: false, reason: "not_idle_enough" };
    }

    // 3. Currently streaming?
    const activity = await this.extensionMetadata.getMetadata(minionId);
    if (activity?.streaming) {
      return { eligible: false, reason: "currently_streaming" };
    }

    // 4. Already compacted? (last message is compacted summary)
    const lastMessage = messages[messages.length - 1];
    // Support both new enum ("user"|"idle") and legacy boolean (true)
    if (lastMessage?.metadata?.compacted) {
      return { eligible: false, reason: "already_compacted" };
    }

    // 5. Last message is user message with no response? (incomplete conversation)
    if (lastMessage?.role === "user") {
      return { eligible: false, reason: "awaiting_response" };
    }

    return { eligible: true };
  }
}
