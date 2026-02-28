import * as fs from "fs/promises";
import * as path from "path";
import writeFileAtomic from "write-file-atomic";
import assert from "node:assert";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import {
  isCompactionSummaryMetadata,
  type LatticeMessage,
  type LatticeMetadata,
} from "@/common/types/message";
import type { Config } from "@/node/config";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";
import { log } from "./log";
import { getTokenizerForModel } from "@/node/utils/main/tokenizer";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { safeStringifyForCounting } from "@/common/utils/tokens/safeStringifyForCounting";
import { normalizeLegacyLatticeMetadata } from "@/node/utils/messages/legacy";
import { isDurableCompactionBoundaryMarker } from "@/common/utils/messages/compactionBoundary";
import { getErrorMessage } from "@/common/utils/errors";

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  );
}

function hasDurableCompactedMarker(value: unknown): value is true | "user" | "idle" {
  return value === true || value === "user" || value === "idle";
}

function hasDurableCompactionBoundary(metadata: LatticeMetadata | undefined): boolean {
  if (metadata?.compactionBoundary !== true) {
    return false;
  }

  // Self-healing read path: malformed boundary markers should be ignored.
  if (!hasDurableCompactedMarker(metadata.compacted)) {
    return false;
  }

  return isPositiveInteger(metadata.compactionEpoch);
}

function getCompactionMetadataToPreserve(
  minionId: string,
  existingMessage: LatticeMessage,
  incomingMessage: LatticeMessage
): Partial<LatticeMetadata> | null {
  const existingMetadata = existingMessage.metadata;
  if (existingMetadata?.compactionBoundary !== true) {
    return null;
  }

  if (existingMessage.role !== "assistant") {
    // Self-healing read path: boundary metadata on non-assistant rows is invalid.
    log.warn("Skipping malformed persisted compaction boundary during history update", {
      minionId,
      messageId: existingMessage.id,
      reason: "compactionBoundary set on non-assistant message",
    });
    return null;
  }

  if (incomingMessage.role !== "assistant") {
    return null;
  }

  if (!hasDurableCompactionBoundary(existingMetadata)) {
    // Self-healing read path: malformed boundary metadata should not be propagated.
    log.warn("Skipping malformed persisted compaction boundary during history update", {
      minionId,
      messageId: existingMessage.id,
      reason: "compactionBoundary missing valid compacted+compactionEpoch metadata",
    });
    return null;
  }

  if (hasDurableCompactionBoundary(incomingMessage.metadata)) {
    return null;
  }

  const preserved: Partial<LatticeMetadata> = {
    compacted: existingMetadata.compacted,
    compactionBoundary: true,
    compactionEpoch: existingMetadata.compactionEpoch,
  };

  if (
    isCompactionSummaryMetadata(existingMetadata.latticeMetadata) &&
    !isCompactionSummaryMetadata(incomingMessage.metadata?.latticeMetadata)
  ) {
    preserved.latticeMetadata = existingMetadata.latticeMetadata;
  }

  return preserved;
}
/**
 * HistoryService - Manages chat history persistence and sequence numbering
 *
 * Responsibilities:
 * - Read/write chat history to disk (JSONL format)
 * - Read/write partial message staging state (partial.json)
 * - Assign sequence numbers to messages (single source of truth)
 * - Track next sequence number per minion
 */
export class HistoryService {
  private readonly CHAT_FILE = "chat.jsonl";
  private readonly PARTIAL_FILE = "partial.json";
  // Track next sequence number per minion in memory
  private sequenceCounters = new Map<string, number>();
  // Shared file operation lock across all minion file services
  // This prevents deadlocks when operations compose while touching the same minion files.
  private readonly fileLocks = minionFileLocks;
  private readonly config: Pick<Config, "getSessionDir">;

  constructor(config: Pick<Config, "getSessionDir">) {
    this.config = config;
  }

  private getChatHistoryPath(minionId: string): string {
    return path.join(this.config.getSessionDir(minionId), this.CHAT_FILE);
  }

  private getPartialPath(minionId: string): string {
    return path.join(this.config.getSessionDir(minionId), this.PARTIAL_FILE);
  }

  // ── Reverse-read infrastructure ─────────────────────────────────────────────
  // Reads chat.jsonl from the tail to avoid O(total-history) parsing on hot paths.
  // \n (0x0A) never appears inside multi-byte UTF-8 sequences, so chunked reverse
  // reading is byte-safe. JSON.stringify escapes prevent false positives for the
  // needle inside user-content strings.

  /** Size of each chunk when scanning the file in reverse (256KB covers typical post-compaction content). */
  private static readonly REVERSE_READ_CHUNK_SIZE = 256 * 1024;
  /** String-search needle for compaction boundary lines. */
  private static readonly BOUNDARY_NEEDLE = '"compactionBoundary":true';

  /**
   * Scan chat.jsonl in reverse to find the byte offset of a durable compaction boundary.
   * Returns `null` when no (matching) boundary exists.
   *
   * @param skip How many boundaries to skip before returning. 0 = last boundary,
   *             1 = second-to-last (penultimate), etc.
   *
   * Byte offsets are computed from raw \n positions in the buffer (not from decoded string
   * lengths) so that chunk boundaries splitting multi-byte UTF-8 sequences don't corrupt
   * the returned offset.
   */
  private async findLastBoundaryByteOffset(minionId: string, skip = 0): Promise<number | null> {
    const filePath = this.getChatHistoryPath(minionId);

    let fileSize: number;
    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
    } catch {
      return null;
    }
    if (fileSize === 0) return null;

    const fh = await fs.open(filePath, "r");
    try {
      let readEnd = fileSize;
      // Raw bytes of the incomplete first line from the previous (rightward) chunk.
      // Kept as Buffer (not string) so multi-byte chars split at chunk boundaries
      // don't corrupt byte offsets via UTF-8 replacement characters.
      let carryoverBytes = Buffer.alloc(0);
      let skipped = 0;

      while (readEnd > 0) {
        const readStart = Math.max(0, readEnd - HistoryService.REVERSE_READ_CHUNK_SIZE);
        const chunkSize = readEnd - readStart;
        const rawChunk = Buffer.alloc(chunkSize);
        await fh.read(rawChunk, 0, chunkSize, readStart);

        // Combine with carryover (the start of a line whose tail was in the previous chunk).
        // The combined buffer represents contiguous file bytes [readStart, readStart + buffer.length).
        const buffer =
          carryoverBytes.length > 0 ? Buffer.concat([rawChunk, carryoverBytes]) : rawChunk;

        // Find \n byte positions in the raw buffer for accurate byte offsets.
        // 0x0A never appears inside multi-byte UTF-8 sequences, so this is byte-safe
        // even when a chunk boundary splits a multibyte character.
        const newlinePositions: number[] = [];
        for (let b = 0; b < buffer.length; b++) {
          if (buffer[b] === 0x0a) {
            newlinePositions.push(b);
          }
        }

        if (newlinePositions.length === 0) {
          // No newlines — entire buffer is one partial line, carry it all forward
          carryoverBytes = Buffer.from(buffer);
          readEnd = readStart;
          continue;
        }

        // Bytes before the first \n are an incomplete line — carry forward
        carryoverBytes = Buffer.from(buffer.subarray(0, newlinePositions[0]));

        // Scan complete lines in reverse. Each line occupies
        // [newlinePositions[nl] + 1, nextNewline) in the buffer.
        for (let nl = newlinePositions.length - 1; nl >= 0; nl--) {
          const lineStart = newlinePositions[nl] + 1;
          const lineEnd =
            nl < newlinePositions.length - 1 ? newlinePositions[nl + 1] : buffer.length;
          if (lineEnd <= lineStart) continue; // empty line

          const line = buffer.subarray(lineStart, lineEnd).toString("utf-8");
          if (line.includes(HistoryService.BOUNDARY_NEEDLE)) {
            try {
              const msg = JSON.parse(line) as LatticeMessage;
              if (isDurableCompactionBoundaryMarker(msg)) {
                if (skipped < skip) {
                  skipped++;
                } else {
                  return readStart + lineStart;
                }
              }
            } catch {
              // Malformed line — not a real boundary, skip
            }
          }
        }

        readEnd = readStart;
      }

      // Check the very first line (accumulated in carryover)
      if (carryoverBytes.length > 0) {
        const line = carryoverBytes.toString("utf-8");
        if (line.includes(HistoryService.BOUNDARY_NEEDLE)) {
          try {
            const msg = JSON.parse(line) as LatticeMessage;
            if (isDurableCompactionBoundaryMarker(msg)) {
              if (skipped < skip) {
                // Not enough boundaries in the file to satisfy skip
                return null;
              }
              return 0;
            }
          } catch {
            // skip
          }
        }
      }

      return null;
    } finally {
      await fh.close();
    }
  }

  /**
   * Read and parse messages from a byte offset to the end of chat.jsonl.
   * Self-healing: skips malformed JSON lines the same way readChatHistory does.
   */
  private async readHistoryFromOffset(
    minionId: string,
    byteOffset: number
  ): Promise<LatticeMessage[]> {
    const filePath = this.getChatHistoryPath(minionId);
    const stat = await fs.stat(filePath);
    const tailSize = stat.size - byteOffset;
    if (tailSize <= 0) return [];

    const fh = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(tailSize);
      await fh.read(buffer, 0, tailSize, byteOffset);
      const lines = buffer
        .toString("utf-8")
        .split("\n")
        .filter((l) => l.trim());
      const messages: LatticeMessage[] = [];
      for (const line of lines) {
        try {
          messages.push(normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage));
        } catch {
          // Skip malformed lines — same self-healing behavior as readChatHistory
        }
      }
      return messages;
    } finally {
      await fh.close();
    }
  }

  /**
   * Read the last N messages from chat.jsonl by scanning the file in reverse.
   * Much cheaper than a full read when only the tail is needed.
   *
   * Uses raw byte scanning for \n positions (same approach as findLastBoundaryByteOffset)
   * so that chunk boundaries splitting multi-byte UTF-8 sequences don't corrupt lines.
   */
  private async readLastMessages(minionId: string, n: number): Promise<LatticeMessage[]> {
    const filePath = this.getChatHistoryPath(minionId);

    let fileSize: number;
    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
    } catch {
      return [];
    }
    if (fileSize === 0) return [];

    const fh = await fs.open(filePath, "r");
    try {
      const collected: LatticeMessage[] = [];
      let readEnd = fileSize;
      let carryoverBytes = Buffer.alloc(0);

      while (readEnd > 0 && collected.length < n) {
        const readStart = Math.max(0, readEnd - HistoryService.REVERSE_READ_CHUNK_SIZE);
        const chunkSize = readEnd - readStart;
        const rawChunk = Buffer.alloc(chunkSize);
        await fh.read(rawChunk, 0, chunkSize, readStart);

        const buffer =
          carryoverBytes.length > 0 ? Buffer.concat([rawChunk, carryoverBytes]) : rawChunk;

        const newlinePositions: number[] = [];
        for (let b = 0; b < buffer.length; b++) {
          if (buffer[b] === 0x0a) {
            newlinePositions.push(b);
          }
        }

        if (newlinePositions.length === 0) {
          carryoverBytes = Buffer.from(buffer);
          readEnd = readStart;
          continue;
        }

        carryoverBytes = Buffer.from(buffer.subarray(0, newlinePositions[0]));

        // Parse complete lines in reverse, stopping once we have enough
        for (let nl = newlinePositions.length - 1; nl >= 0 && collected.length < n; nl--) {
          const lineStart = newlinePositions[nl] + 1;
          const lineEnd =
            nl < newlinePositions.length - 1 ? newlinePositions[nl + 1] : buffer.length;
          if (lineEnd <= lineStart) continue;

          const line = buffer.subarray(lineStart, lineEnd).toString("utf-8").trim();
          if (line.length === 0) continue;
          try {
            collected.push(normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage));
          } catch {
            // Skip malformed lines
          }
        }

        readEnd = readStart;
      }

      // Check the very first line if we still need more
      if (collected.length < n && carryoverBytes.length > 0) {
        const line = carryoverBytes.toString("utf-8").trim();
        if (line.length > 0) {
          try {
            collected.push(normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage));
          } catch {
            // skip
          }
        }
      }

      // Reverse to restore chronological order
      collected.reverse();
      return collected;
    } finally {
      await fh.close();
    }
  }

  /**
   * Read raw messages from chat.jsonl (does not include partial.json)
   * Returns empty array if file doesn't exist
   * Skips malformed JSON lines to prevent data loss from corruption
   */
  private async readChatHistory(minionId: string): Promise<LatticeMessage[]> {
    try {
      const chatHistoryPath = this.getChatHistoryPath(minionId);
      const data = await fs.readFile(chatHistoryPath, "utf-8");
      if (data.length > 5 * 1024 * 1024) {
        log.warn("chat.jsonl exceeds 5MB — full read may be slow, consider compaction", {
          minionId,
          sizeBytes: data.length,
        });
      }
      const lines = data.split("\n").filter((line) => line.trim());
      const messages: LatticeMessage[] = [];

      for (let i = 0; i < lines.length; i++) {
        try {
          const message = JSON.parse(lines[i]) as LatticeMessage;
          messages.push(normalizeLegacyLatticeMetadata(message));
        } catch (parseError) {
          // Skip malformed lines but log error for debugging
          log.warn(
            `Skipping malformed JSON at line ${i + 1} in ${minionId}/chat.jsonl:`,
            getErrorMessage(parseError),
            "\nLine content:",
            lines[i].substring(0, 100) + (lines[i].length > 100 ? "..." : "")
          );
        }
      }

      return messages;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return []; // No history yet
      }
      throw error; // Re-throw non-ENOENT errors
    }
  }

  // ── Forward/backward iteration infrastructure ────────────────────────────
  // Chunked iteration over chat.jsonl that yields messages to a visitor callback.
  // Supports early exit (return false) and reduces memory pressure vs. loading
  // the entire file into an array.

  /**
   * Read chat.jsonl from start to end in chunks, calling visitor with each
   * batch of parsed messages. Uses raw byte scanning for \n to handle
   * multi-byte UTF-8 safely at chunk boundaries.
   */
  private async iterateForward(
    minionId: string,
    visitor: (messages: LatticeMessage[]) => boolean | void | Promise<boolean | void>
  ): Promise<void> {
    const filePath = this.getChatHistoryPath(minionId);

    let fileSize: number;
    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return; // No history
      }
      throw error;
    }
    if (fileSize === 0) return;

    const fh = await fs.open(filePath, "r");
    try {
      let readPos = 0;
      // Incomplete last line from the previous chunk, kept as Buffer to
      // preserve split multi-byte UTF-8 sequences.
      let carryoverBytes = Buffer.alloc(0);

      while (readPos < fileSize) {
        const remaining = fileSize - readPos;
        const toRead = Math.min(HistoryService.REVERSE_READ_CHUNK_SIZE, remaining);
        const rawChunk = Buffer.alloc(toRead);
        await fh.read(rawChunk, 0, toRead, readPos);
        readPos += toRead;

        const buffer =
          carryoverBytes.length > 0 ? Buffer.concat([carryoverBytes, rawChunk]) : rawChunk;

        // Find the last \n to split complete lines from the trailing incomplete line.
        // 0x0A is byte-safe (never inside multi-byte UTF-8 sequences).
        let lastNewline = -1;
        for (let b = buffer.length - 1; b >= 0; b--) {
          if (buffer[b] === 0x0a) {
            lastNewline = b;
            break;
          }
        }

        if (lastNewline === -1) {
          // No newline in entire buffer — carry everything forward
          carryoverBytes = Buffer.from(buffer);
          continue;
        }

        // Decode only complete lines (up to and including the last \n)
        const completeText = buffer.subarray(0, lastNewline).toString("utf-8");
        carryoverBytes = Buffer.from(buffer.subarray(lastNewline + 1));

        const messages: LatticeMessage[] = [];
        for (const line of completeText.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          try {
            messages.push(normalizeLegacyLatticeMetadata(JSON.parse(trimmed) as LatticeMessage));
          } catch {
            // Skip malformed lines — same self-healing behavior as readChatHistory
          }
        }

        if (messages.length > 0) {
          const shouldContinue = await visitor(messages);
          if (shouldContinue === false) return;
        }
      }

      // Handle remaining carryover (last line without trailing newline)
      if (carryoverBytes.length > 0) {
        const line = carryoverBytes.toString("utf-8").trim();
        if (line.length > 0) {
          try {
            const msg = normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage);
            await visitor([msg]);
          } catch {
            // Skip malformed line
          }
        }
      }
    } finally {
      await fh.close();
    }
  }

  /**
   * Read chat.jsonl from end to start in chunks, calling visitor with each
   * batch of parsed messages (newest first within each chunk). Uses the same
   * raw-byte \n scanning as findLastBoundaryByteOffset.
   */
  private async iterateBackward(
    minionId: string,
    visitor: (messages: LatticeMessage[]) => boolean | void | Promise<boolean | void>
  ): Promise<void> {
    const filePath = this.getChatHistoryPath(minionId);

    let fileSize: number;
    try {
      const stat = await fs.stat(filePath);
      fileSize = stat.size;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return; // No history
      }
      throw error;
    }
    if (fileSize === 0) return;

    const fh = await fs.open(filePath, "r");
    try {
      let readEnd = fileSize;
      let carryoverBytes = Buffer.alloc(0);

      while (readEnd > 0) {
        const readStart = Math.max(0, readEnd - HistoryService.REVERSE_READ_CHUNK_SIZE);
        const chunkSize = readEnd - readStart;
        const rawChunk = Buffer.alloc(chunkSize);
        await fh.read(rawChunk, 0, chunkSize, readStart);

        const buffer =
          carryoverBytes.length > 0 ? Buffer.concat([rawChunk, carryoverBytes]) : rawChunk;

        const newlinePositions: number[] = [];
        for (let b = 0; b < buffer.length; b++) {
          if (buffer[b] === 0x0a) {
            newlinePositions.push(b);
          }
        }

        if (newlinePositions.length === 0) {
          carryoverBytes = Buffer.from(buffer);
          readEnd = readStart;
          continue;
        }

        carryoverBytes = Buffer.from(buffer.subarray(0, newlinePositions[0]));

        // Parse complete lines in reverse (newest → oldest for backward iteration)
        const messages: LatticeMessage[] = [];
        for (let nl = newlinePositions.length - 1; nl >= 0; nl--) {
          const lineStart = newlinePositions[nl] + 1;
          const lineEnd =
            nl < newlinePositions.length - 1 ? newlinePositions[nl + 1] : buffer.length;
          if (lineEnd <= lineStart) continue;

          const line = buffer.subarray(lineStart, lineEnd).toString("utf-8").trim();
          if (line.length === 0) continue;
          try {
            messages.push(normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage));
          } catch {
            // Skip malformed lines
          }
        }

        if (messages.length > 0) {
          const shouldContinue = await visitor(messages);
          if (shouldContinue === false) return;
        }

        readEnd = readStart;
      }

      // Check the very first line (accumulated in carryover)
      if (carryoverBytes.length > 0) {
        const line = carryoverBytes.toString("utf-8").trim();
        if (line.length > 0) {
          try {
            const msg = normalizeLegacyLatticeMetadata(JSON.parse(line) as LatticeMessage);
            await visitor([msg]);
          } catch {
            // Skip malformed line
          }
        }
      }
    } finally {
      await fh.close();
    }
  }

  /**
   * Iterate over ALL messages in chat.jsonl — O(file-size) I/O + parse.
   *
   * ⚠️  Prefer targeted alternatives for hot paths:
   *   - getHistoryFromLatestBoundary() — for provider-request assembly
   *   - getLastMessages(n)            — when only the tail matters
   *   - hasHistory()                  — for emptiness checks
   *
   * Yields chunks of parsed messages to the visitor callback. The visitor may
   * return `false` to stop iteration early (e.g., after finding a target message).
   *
   * @param direction - 'forward' reads oldest→newest, 'backward' reads newest→oldest
   * @param visitor - Called with each chunk of messages. Return false to stop early.
   */
  async iterateFullHistory(
    minionId: string,
    direction: "forward" | "backward",
    visitor: (messages: LatticeMessage[]) => boolean | void | Promise<boolean | void>
  ): Promise<Result<void>> {
    try {
      if (direction === "forward") {
        await this.iterateForward(minionId, visitor);
      } else {
        await this.iterateBackward(minionId, visitor);
      }
      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to iterate history: ${message}`);
    }
  }

  private getOldestHistorySequence(messages: readonly LatticeMessage[]): number | undefined {
    let oldest: number | undefined;

    for (const message of messages) {
      const sequence = message.metadata?.historySequence;
      if (!isNonNegativeInteger(sequence)) {
        continue;
      }

      if (oldest === undefined || sequence < oldest) {
        oldest = sequence;
      }
    }

    return oldest;
  }

  async hasHistoryBeforeSequence(
    minionId: string,
    beforeHistorySequence: number
  ): Promise<boolean> {
    assert(
      typeof minionId === "string" && minionId.trim().length > 0,
      "minionId is required"
    );
    assert(
      isNonNegativeInteger(beforeHistorySequence),
      "hasHistoryBeforeSequence requires a non-negative integer"
    );

    let hasOlder = false;
    await this.iterateBackward(minionId, (messages) => {
      for (const message of messages) {
        const sequence = message.metadata?.historySequence;
        if (!isNonNegativeInteger(sequence)) {
          continue;
        }

        if (sequence < beforeHistorySequence) {
          hasOlder = true;
          return false;
        }
      }
    });

    return hasOlder;
  }

  /**
   * Read one compaction-epoch history window older than `beforeHistorySequence`.
   *
   * Returns messages whose historySequence is strictly less than `beforeHistorySequence`
   * and belong to the nearest-older boundary window.
   */
  async getHistoryBoundaryWindow(
    minionId: string,
    beforeHistorySequence: number
  ): Promise<Result<{ messages: LatticeMessage[]; hasOlder: boolean }>> {
    assert(
      typeof minionId === "string" && minionId.trim().length > 0,
      "minionId is required"
    );
    assert(
      isNonNegativeInteger(beforeHistorySequence),
      "getHistoryBoundaryWindow requires beforeHistorySequence to be a non-negative integer"
    );

    try {
      // Scan boundaries newest→oldest and pick the first window that has rows older than the cursor.
      for (let skip = 0; ; skip++) {
        const boundaryOffset = await this.findLastBoundaryByteOffset(minionId, skip);
        if (boundaryOffset === null) {
          break;
        }

        const tailMessages = await this.readHistoryFromOffset(minionId, boundaryOffset);
        const windowMessages = tailMessages.filter((message) => {
          const sequence = message.metadata?.historySequence;
          return isNonNegativeInteger(sequence) && sequence < beforeHistorySequence;
        });

        if (windowMessages.length === 0) {
          continue;
        }

        const oldestWindowSequence = this.getOldestHistorySequence(windowMessages);
        assert(
          oldestWindowSequence !== undefined,
          "window messages filtered by historySequence must include a sequence"
        );

        const hasOlder = await this.hasHistoryBeforeSequence(minionId, oldestWindowSequence);
        return Ok({ messages: windowMessages, hasOlder });
      }

      // No older boundary window found. Fall back to pre-boundary rows (or empty on uncompacted history).
      const allMessages = await this.readChatHistory(minionId);
      const preBoundaryMessages = allMessages.filter((message) => {
        const sequence = message.metadata?.historySequence;
        return isNonNegativeInteger(sequence) && sequence < beforeHistorySequence;
      });

      if (preBoundaryMessages.length === 0) {
        return Ok({ messages: [], hasOlder: false });
      }

      const oldestWindowSequence = this.getOldestHistorySequence(preBoundaryMessages);
      assert(
        oldestWindowSequence !== undefined,
        "pre-boundary messages filtered by historySequence must include a sequence"
      );

      const hasOlder = await this.hasHistoryBeforeSequence(minionId, oldestWindowSequence);
      return Ok({ messages: preBoundaryMessages, hasOlder });
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to read history boundary window: ${message}`);
    }
  }

  /**
   * Read messages from a compaction boundary onward.
   * Falls back to full history if no boundary exists (new/uncompacted minion).
   *
   * @param skip How many boundaries to skip (counting from the latest). 0 = read
   *             from the latest boundary, 1 = from the penultimate, etc. When the
   *             requested boundary doesn't exist, falls back to the next-available
   *             boundary, then to full history.
   *
   * Prefer this over iterateFullHistory() for provider-request assembly and any path
   * that only needs the active compaction epoch.
   */
  async getHistoryFromLatestBoundary(minionId: string, skip = 0): Promise<Result<LatticeMessage[]>> {
    try {
      // Try the requested boundary, falling back to less-skipped boundaries
      for (let s = skip; s >= 0; s--) {
        const offset = await this.findLastBoundaryByteOffset(minionId, s);
        if (offset !== null) {
          const messages = await this.readHistoryFromOffset(minionId, offset);
          return Ok(messages);
        }
      }

      // No boundaries at all — minion is uncompacted, full read is the only option
      const messages = await this.readChatHistory(minionId);
      return Ok(messages);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to read history from boundary: ${message}`);
    }
  }

  /**
   * Read the last N messages from chat.jsonl by reading the file in reverse.
   * Much cheaper than iterateFullHistory() when only the tail is needed.
   */
  async getLastMessages(minionId: string, n: number): Promise<Result<LatticeMessage[]>> {
    try {
      const messages = await this.readLastMessages(minionId, n);
      return Ok(messages);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to read last ${n} messages: ${message}`);
    }
  }

  /**
   * Check if a minion has any chat history without parsing the file.
   * Much cheaper than iterateFullHistory() when only an emptiness check is needed.
   */
  async hasHistory(minionId: string): Promise<boolean> {
    const filePath = this.getChatHistoryPath(minionId);
    try {
      const stat = await fs.stat(filePath);
      return stat.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Read the partial message for a minion, if it exists.
   */
  async readPartial(minionId: string): Promise<LatticeMessage | null> {
    try {
      const partialPath = this.getPartialPath(minionId);
      const data = await fs.readFile(partialPath, "utf-8");
      const message = JSON.parse(data) as LatticeMessage;
      return normalizeLegacyLatticeMetadata(message);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }

      log.error("Error reading partial:", error);
      return null;
    }
  }

  /**
   * Write a partial message to disk.
   */
  async writePartial(minionId: string, message: LatticeMessage): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const minionDir = this.config.getSessionDir(minionId);
        await fs.mkdir(minionDir, { recursive: true });
        const partialPath = this.getPartialPath(minionId);

        const partialMessage: LatticeMessage = {
          ...message,
          metadata: {
            ...message.metadata,
            partial: true,
          },
        };

        // Atomic write: writes to temp file then renames, preventing corruption
        // if app crashes mid-write (prevents "Unexpected end of JSON input" on read)
        await writeFileAtomic(partialPath, JSON.stringify(partialMessage, null, 2));
        return Ok(undefined);
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        return Err(`Failed to write partial: ${errorMessage}`);
      }
    });
  }

  /**
   * Delete the partial message file for a minion.
   */
  async deletePartial(minionId: string): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const partialPath = this.getPartialPath(minionId);
        await fs.unlink(partialPath);
        return Ok(undefined);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          return Ok(undefined);
        }
        const errorMessage = getErrorMessage(error);
        return Err(`Failed to delete partial: ${errorMessage}`);
      }
    });
  }

  /**
   * Commit any existing partial message to chat history and delete partial.json.
   *
   * This is idempotent:
   * - If the partial has already been finalized in history, it is not committed again.
   * - After committing (or if already finalized), partial.json is deleted.
   */
  async commitPartial(minionId: string): Promise<Result<void>> {
    try {
      let partial = await this.readPartial(minionId);
      if (!partial) {
        return Ok(undefined);
      }

      // Strip transient error metadata, but persist accumulated content.
      if (partial.metadata?.error) {
        const { error, errorType, ...cleanMetadata } = partial.metadata;
        partial = { ...partial, metadata: cleanMetadata };
      }

      const partialSeq = partial.metadata?.historySequence;
      if (partialSeq === undefined) {
        return Err("Partial message has no historySequence");
      }

      const historyResult = await this.getHistoryFromLatestBoundary(minionId);
      if (!historyResult.success) {
        return Err(`Failed to read history: ${historyResult.error}`);
      }

      const existingMessages = historyResult.data;
      const hasCommitWorthyParts = (partial.parts ?? []).some((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return part.text.trim().length > 0;
        }

        if (part.type === "file") {
          return true;
        }

        if (part.type === "dynamic-tool") {
          // Incomplete tool calls (input-available) are dropped during provider request
          // conversion. Persisting tool-only incomplete partials can brick future requests.
          return part.state === "output-available";
        }

        return false;
      });

      const existingMessage = existingMessages.find(
        (message) => message.metadata?.historySequence === partialSeq
      );

      const shouldCommit =
        (!existingMessage || (partial.parts?.length ?? 0) > (existingMessage.parts?.length ?? 0)) &&
        hasCommitWorthyParts;

      if (shouldCommit) {
        if (existingMessage) {
          const updateResult = await this.updateHistory(minionId, partial);
          if (!updateResult.success) {
            return updateResult;
          }
        } else {
          const appendResult = await this.appendToHistory(minionId, partial);
          if (!appendResult.success) {
            return appendResult;
          }
        }
      }

      return this.deletePartial(minionId);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return Err(`Failed to commit partial: ${errorMessage}`);
    }
  }

  /**
   * Get or initialize the next history sequence number for a minion
   */
  private async getNextHistorySequence(minionId: string): Promise<number> {
    // Check if we already have it in memory
    if (this.sequenceCounters.has(minionId)) {
      return this.sequenceCounters.get(minionId)!;
    }

    // Initialize from history — sequence numbers are monotonically increasing,
    // so the last message always holds the max. Use getLastMessages(1) to avoid
    // reading the entire file.
    const lastResult = await this.getLastMessages(minionId, 1);
    if (lastResult.success && lastResult.data.length > 0) {
      const lastMsg = lastResult.data[0];
      const seqNum = lastMsg.metadata?.historySequence;
      if (isNonNegativeInteger(seqNum)) {
        const nextSeqNum = seqNum + 1;
        this.sequenceCounters.set(minionId, nextSeqNum);
        return nextSeqNum;
      }
      // Last message has no valid sequence — fall back to scanning backward
      // through all messages to find the max (handles legacy data).
      let maxSeqNum = -1;
      const scanResult = await this.iterateFullHistory(minionId, "backward", (chunk) => {
        for (const msg of chunk) {
          const seq = msg.metadata?.historySequence;
          if (isNonNegativeInteger(seq)) {
            maxSeqNum = Math.max(maxSeqNum, seq);
            // Found a valid sequence — it's the max since we're scanning backward
            return false;
          }
        }
      });
      if (scanResult.success) {
        const nextSeqNum = maxSeqNum + 1;
        assert(
          isNonNegativeInteger(nextSeqNum),
          "next history sequence counter must be a non-negative integer"
        );
        this.sequenceCounters.set(minionId, nextSeqNum);
        return nextSeqNum;
      }
    }

    // No history yet, start from 0
    this.sequenceCounters.set(minionId, 0);
    return 0;
  }

  /**
   * Internal helper for appending to history without acquiring lock.
   */
  private async _appendToHistoryUnlocked(
    minionId: string,
    message: LatticeMessage
  ): Promise<Result<void>> {
    try {
      const minionDir = this.config.getSessionDir(minionId);
      await fs.mkdir(minionDir, { recursive: true });
      const historyPath = this.getChatHistoryPath(minionId);

      // DEBUG: Log message append with caller stack trace
      const stack = new Error().stack?.split("\n").slice(2, 6).join("\n") ?? "no stack";
      log.debug(
        `[HISTORY APPEND] minionId=${minionId} role=${message.role} id=${message.id}`
      );
      log.debug(`[HISTORY APPEND] Call stack:\n${stack}`);

      // Ensure message has a history sequence number
      if (!message.metadata) {
        // Create metadata with history sequence
        const nextSeqNum = await this.getNextHistorySequence(minionId);
        assert(
          isNonNegativeInteger(nextSeqNum),
          "getNextHistorySequence must return a non-negative integer"
        );
        message.metadata = {
          historySequence: nextSeqNum,
        };
        this.sequenceCounters.set(minionId, nextSeqNum + 1);
      } else {
        // Message already has metadata, but may need historySequence assigned
        const existingSeqNum = message.metadata.historySequence;
        if (existingSeqNum !== undefined) {
          assert(
            isNonNegativeInteger(existingSeqNum),
            "appendToHistory requires historySequence to be a non-negative integer when provided"
          );

          // Already has history sequence, update counter if needed
          const currentCounter = this.sequenceCounters.get(minionId) ?? 0;
          assert(
            isNonNegativeInteger(currentCounter),
            "history sequence counter must remain a non-negative integer"
          );
          if (existingSeqNum >= currentCounter) {
            this.sequenceCounters.set(minionId, existingSeqNum + 1);
          }
        } else {
          // Has metadata but no historySequence, assign one
          const nextSeqNum = await this.getNextHistorySequence(minionId);
          assert(
            isNonNegativeInteger(nextSeqNum),
            "getNextHistorySequence must return a non-negative integer"
          );
          message.metadata = {
            ...message.metadata,
            historySequence: nextSeqNum,
          };
          this.sequenceCounters.set(minionId, nextSeqNum + 1);
        }
      }

      // Store the message with minion context
      const historyEntry = {
        ...message,
        minionId,
      };

      // DEBUG: Log assigned sequence number
      log.debug(
        `[HISTORY APPEND] Assigned historySequence=${message.metadata.historySequence ?? "unknown"} role=${message.role}`
      );

      await fs.appendFile(historyPath, JSON.stringify(historyEntry) + "\n");
      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to append to history: ${message}`);
    }
  }

  async appendToHistory(minionId: string, message: LatticeMessage): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      return this._appendToHistoryUnlocked(minionId, message);
    });
  }

  /**
   * Update an existing message in history by historySequence
   * Reads entire history, replaces the matching message, and rewrites the file
   */
  async updateHistory(minionId: string, message: LatticeMessage): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const historyPath = this.getChatHistoryPath(minionId);

        // Read all messages — structural rewrite requires full file content
        const messages = await this.readChatHistory(minionId);
        const targetSequence = message.metadata?.historySequence;

        if (targetSequence === undefined) {
          return Err("Cannot update message without historySequence");
        }

        assert(
          isNonNegativeInteger(targetSequence),
          "updateHistory requires historySequence to be a non-negative integer"
        );

        // Find and replace the message with matching historySequence
        let found = false;
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].metadata?.historySequence === targetSequence) {
            const existingMessage = messages[i];
            assert(existingMessage, "updateHistory matched message must exist");

            // Preserve compaction boundary metadata during late in-place rewrites.
            // Compaction may update an assistant row first, then a late stream rewrite can
            // update that same historySequence and accidentally drop compaction markers.
            const preservedCompactionMetadata = getCompactionMetadataToPreserve(
              minionId,
              existingMessage,
              message
            );

            // Preserve the historySequence, update everything else.
            messages[i] = {
              ...message,
              metadata: {
                ...message.metadata,
                ...(preservedCompactionMetadata ?? {}),
                historySequence: targetSequence,
              },
            };
            found = true;
            break;
          }
        }

        if (!found) {
          return Err(`No message found with historySequence ${targetSequence}`);
        }

        // Rewrite entire file
        const historyEntries = messages
          .map((msg) => JSON.stringify({ ...msg, minionId }) + "\n")
          .join("");

        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(historyPath, historyEntries);
        return Ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to update history: ${message}`);
      }
    });
  }

  /**
   * Delete a single message by ID while preserving the rest of the history.
   *
   * This is safer than truncateAfterMessage for cleanup paths where subsequent
   * messages may already have been appended.
   */
  async deleteMessage(minionId: string, messageId: string): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        // Structural rewrite requires full file content
        const messages = await this.readChatHistory(minionId);
        const filteredMessages = messages.filter((msg) => msg.id !== messageId);

        if (filteredMessages.length === messages.length) {
          return Err(`Message with ID ${messageId} not found in history`);
        }

        const historyPath = this.getChatHistoryPath(minionId);
        const historyEntries = filteredMessages
          .map((msg) => JSON.stringify({ ...msg, minionId }) + "\n")
          .join("");

        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(historyPath, historyEntries);

        // Keep the in-memory sequence counter monotonic. It's okay to reuse deleted sequence
        // numbers on restart, but we must not regress within a running process.
        const maxSeq = filteredMessages.reduce((max, msg) => {
          const seq = msg.metadata?.historySequence;
          if (seq === undefined) {
            return max;
          }

          if (!isNonNegativeInteger(seq)) {
            log.warn(
              "Ignoring malformed persisted historySequence while updating sequence counter after delete",
              {
                minionId,
                messageId: msg.id,
                historySequence: seq,
              }
            );
            return max;
          }

          return seq > max ? seq : max;
        }, -1);
        const nextSeq = maxSeq + 1;
        assert(
          isNonNegativeInteger(nextSeq),
          "next history sequence counter after delete must be a non-negative integer"
        );
        const currentCounter = this.sequenceCounters.get(minionId);
        if (currentCounter === undefined || currentCounter < nextSeq) {
          this.sequenceCounters.set(minionId, nextSeq);
        }

        return Ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to delete message: ${message}`);
      }
    });
  }

  /**
   * Truncate history after a specific message ID
   * Removes the message with the given ID and all subsequent messages
   */
  async truncateAfterMessage(minionId: string, messageId: string): Promise<Result<void>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        // Structural rewrite requires full file content
        const messages = await this.readChatHistory(minionId);
        const messageIndex = messages.findIndex((msg) => msg.id === messageId);

        if (messageIndex === -1) {
          return Err(`Message with ID ${messageId} not found in history`);
        }

        // Keep only messages before the target message
        const truncatedMessages = messages.slice(0, messageIndex);

        // Rewrite the history file with truncated messages
        const historyPath = this.getChatHistoryPath(minionId);
        const historyEntries = truncatedMessages
          .map((msg) => JSON.stringify({ ...msg, minionId }) + "\n")
          .join("");

        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(historyPath, historyEntries);

        // Update sequence counter to continue from where we truncated.
        // Self-healing read path: skip malformed persisted historySequence values.
        const maxTruncatedSeq = truncatedMessages.reduce((max, msg) => {
          const seq = msg.metadata?.historySequence;
          if (seq === undefined) {
            return max;
          }

          if (!isNonNegativeInteger(seq)) {
            log.warn(
              "Ignoring malformed persisted historySequence while updating sequence counter after truncation",
              {
                minionId,
                messageId: msg.id,
                historySequence: seq,
              }
            );
            return max;
          }

          return seq > max ? seq : max;
        }, -1);
        const nextSeq = maxTruncatedSeq + 1;
        assert(
          isNonNegativeInteger(nextSeq),
          "next history sequence counter after truncation must be a non-negative integer"
        );
        this.sequenceCounters.set(minionId, nextSeq);

        return Ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to truncate history: ${message}`);
      }
    });
  }

  /**
   * Truncate history by removing approximately the given percentage of tokens from the beginning
   * @param minionId The minion ID
   * @param percentage Percentage to truncate (0.0 to 1.0). 1.0 = delete all
   * @returns Result containing array of deleted historySequence numbers
   */
  async truncateHistory(
    minionId: string,
    percentage: number
  ): Promise<Result<number[], string>> {
    return this.fileLocks.withLock(minionId, async () => {
      try {
        const historyPath = this.getChatHistoryPath(minionId);

        // Fast path: 100% truncation = delete entire file
        if (percentage >= 1.0) {
          // Need sequence numbers for return value before deleting
          const messages = await this.readChatHistory(minionId);
          const deletedSequences = messages
            .map((msg) => msg.metadata?.historySequence)
            .filter((s): s is number => isNonNegativeInteger(s));

          try {
            await fs.unlink(historyPath);
          } catch (error) {
            // Ignore ENOENT - file already deleted
            if (
              !(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
            ) {
              throw error;
            }
          }

          // Reset sequence counter when clearing history
          this.sequenceCounters.set(minionId, 0);
          return Ok(deletedSequences);
        }

        // Structural rewrite requires full file content
        const messages = await this.readChatHistory(minionId);
        if (messages.length === 0) {
          return Ok([]); // Nothing to truncate
        }

        // Get tokenizer for counting (use a default model)
        const tokenizer = await getTokenizerForModel(KNOWN_MODELS.SONNET.id);

        // Count tokens for each message
        // We stringify the entire message for simplicity - only relative weights matter
        const messageTokens: Array<{ message: LatticeMessage; tokens: number }> = await Promise.all(
          messages.map(async (msg) => {
            const tokens = await tokenizer.countTokens(safeStringifyForCounting(msg));
            return { message: msg, tokens };
          })
        );

        // Calculate total tokens and target to remove
        const totalTokens = messageTokens.reduce((sum, mt) => sum + mt.tokens, 0);
        const tokensToRemove = Math.floor(totalTokens * percentage);

        // Remove messages from beginning until we've removed enough tokens
        let tokensRemoved = 0;
        let removeCount = 0;
        for (const mt of messageTokens) {
          if (tokensRemoved >= tokensToRemove) {
            break;
          }
          tokensRemoved += mt.tokens;
          removeCount++;
        }

        // If we're removing all messages, use fast path
        if (removeCount >= messages.length) {
          try {
            await fs.unlink(historyPath);
          } catch (error) {
            // Ignore ENOENT
            if (
              !(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
            ) {
              throw error;
            }
          }
          this.sequenceCounters.set(minionId, 0);
          const deletedSequences = messages
            .map((msg) => msg.metadata?.historySequence)
            .filter((s): s is number => isNonNegativeInteger(s));
          return Ok(deletedSequences);
        }

        // Keep messages after removeCount
        const remainingMessages = messages.slice(removeCount);
        const deletedMessages = messages.slice(0, removeCount);
        const deletedSequences = deletedMessages
          .map((msg) => msg.metadata?.historySequence)
          .filter((s): s is number => isNonNegativeInteger(s));

        // Rewrite the history file with remaining messages
        const historyEntries = remainingMessages
          .map((msg) => JSON.stringify({ ...msg, minionId }) + "\n")
          .join("");

        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(historyPath, historyEntries);

        // Update sequence counter to continue from where we are.
        // Self-healing read path: skip malformed persisted historySequence values.
        const maxRemainingSeq = remainingMessages.reduce((max, msg) => {
          const seq = msg.metadata?.historySequence;
          if (seq === undefined) {
            return max;
          }

          if (!isNonNegativeInteger(seq)) {
            log.warn(
              "Ignoring malformed persisted historySequence while updating sequence counter after truncateHistory",
              {
                minionId,
                messageId: msg.id,
                historySequence: seq,
              }
            );
            return max;
          }

          return seq > max ? seq : max;
        }, -1);
        const nextSeq = maxRemainingSeq + 1;
        assert(
          isNonNegativeInteger(nextSeq),
          "next history sequence counter after truncateHistory must be a non-negative integer"
        );
        this.sequenceCounters.set(minionId, nextSeq);

        return Ok(deletedSequences);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to truncate history: ${message}`);
      }
    });
  }

  async clearHistory(minionId: string): Promise<Result<number[], string>> {
    const result = await this.truncateHistory(minionId, 1.0);
    if (!result.success) {
      return Err(result.error);
    }
    return Ok(result.data);
  }

  /**
   * Migrate all messages in chat.jsonl to use a new minion ID
   * This is used during minion rename to update the minionId field in all historical messages
   * IMPORTANT: Should be called AFTER the session directory has been renamed
   */
  async migrateMinionId(oldMinionId: string, newMinionId: string): Promise<Result<void>> {
    return this.fileLocks.withLock(newMinionId, async () => {
      try {
        // Read messages from the NEW minion location (directory was already renamed).
        // Structural rewrite requires full file content.
        const messages = await this.readChatHistory(newMinionId);
        if (messages.length === 0) {
          // No messages to migrate, just transfer sequence counter
          const oldCounter = this.sequenceCounters.get(oldMinionId) ?? 0;
          this.sequenceCounters.set(newMinionId, oldCounter);
          this.sequenceCounters.delete(oldMinionId);
          return Ok(undefined);
        }

        // Rewrite all messages with new minion ID
        const newHistoryPath = this.getChatHistoryPath(newMinionId);
        const historyEntries = messages
          .map((msg) => JSON.stringify({ ...msg, minionId: newMinionId }) + "\n")
          .join("");

        // Atomic write prevents corruption if app crashes mid-write
        await writeFileAtomic(newHistoryPath, historyEntries);

        // Transfer sequence counter to new minion ID
        const oldCounter = this.sequenceCounters.get(oldMinionId) ?? 0;
        this.sequenceCounters.set(newMinionId, oldCounter);
        this.sequenceCounters.delete(oldMinionId);

        log.debug(
          `Migrated ${messages.length} messages from ${oldMinionId} to ${newMinionId}`
        );

        return Ok(undefined);
      } catch (error) {
        const message = getErrorMessage(error);
        return Err(`Failed to migrate minion ID: ${message}`);
      }
    });
  }
}
