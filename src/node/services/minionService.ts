import { EventEmitter } from "events";
import * as path from "path";
import * as fsPromises from "fs/promises";
import assert from "@/common/utils/assert";
import { isMinionArchived } from "@/common/utils/archive";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { getLatticeHelpChatProjectPath } from "@/node/constants/latticeChat";
import type { Config } from "@/node/config";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import { askUserQuestionManager } from "@/node/services/askUserQuestionManager";
import { delegatedToolCallManager } from "@/node/services/delegatedToolCallManager";
import { log } from "@/node/services/log";
import { AgentSession } from "@/node/services/agentSession";
import type { HistoryService } from "@/node/services/historyService";
import type { AIService } from "@/node/services/aiService";
import type { InitStateManager } from "@/node/services/initStateManager";
import type { ExtensionMetadataService } from "@/node/services/ExtensionMetadataService";
import type { TelemetryService } from "@/node/services/telemetryService";
import type { ExperimentsService } from "@/node/services/experimentsService";
import { EXPERIMENT_IDS, EXPERIMENTS } from "@/common/constants/experiments";
import type { PolicyService } from "@/node/services/policyService";
import type { MCPServerManager } from "@/node/services/mcpServerManager";
import {
  createRuntime,
  IncompatibleRuntimeError,
  runBackgroundInit,
} from "@/node/runtime/runtimeFactory";
import { createRuntimeForMinion } from "@/node/runtime/runtimeHelpers";
import { validateMinionName } from "@/common/utils/validation/minionValidation";
import { getPlanFilePath, getLegacyPlanFilePath } from "@/common/utils/planStorage";
import { listLocalBranches } from "@/node/git";
import { shellQuote } from "@/node/runtime/backgroundCommands";
import { extractEditedFilePaths } from "@/common/utils/messages/extractEditedFiles";
import { buildCompactionMessageText } from "@/common/utils/compaction/compactionPrompt";
import { fileExists } from "@/node/utils/runtime/fileExists";
import { orchestrateFork } from "@/node/services/utils/forkOrchestrator";
import { generateMinionIdentity } from "@/node/services/minionTitleGenerator";
import { NAME_GEN_PREFERRED_MODELS } from "@/common/constants/nameGeneration";
import type { DevcontainerRuntime } from "@/node/runtime/DevcontainerRuntime";
import { getDevcontainerContainerName } from "@/node/runtime/devcontainerCli";
import { expandTilde, expandTildeForSSH } from "@/node/runtime/tildeExpansion";

import type { PostCompactionExclusions } from "@/common/types/attachment";
import type {
  SendMessageOptions,
  DeleteMessage,
  FilePart,
  MinionChatMessage,
} from "@/common/orpc/types";

import type { z } from "zod";
import type { SendMessageError } from "@/common/types/errors";
import type {
  FrontendMinionMetadata,
  MinionActivitySnapshot,
  MinionMetadata,
} from "@/common/types/minion";
import { isDynamicToolPart } from "@/common/types/toolParts";
import { buildAskUserQuestionSummary } from "@/common/utils/tools/askUserQuestionSummary";
import {
  AskUserQuestionToolArgsSchema,
  AskUserQuestionToolResultSchema,
} from "@/common/utils/tools/toolDefinitions";
import type { UIMode } from "@/common/types/mode";
import type { LatticeMessageMetadata, LatticeMessage } from "@/common/types/message";
import type { RuntimeConfig } from "@/common/types/runtime";
import {
  hasSrcBaseDir,
  getSrcBaseDir,
  isSSHRuntime,
  isDockerRuntime,
} from "@/common/types/runtime";
import { isValidModelFormat } from "@/common/utils/ai/models";
import { coerceThinkingLevel, type ThinkingLevel } from "@/common/types/thinking";
import { enforceThinkingPolicy } from "@/common/utils/thinking/policy";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import type { StreamEndEvent, StreamAbortEvent, ToolCallEndEvent } from "@/common/types/stream";
import type { TerminalService } from "@/node/services/terminalService";
import type { MinionAISettingsSchema } from "@/common/orpc/schemas";
import type { SessionTimingService } from "@/node/services/sessionTimingService";
import type { SessionUsageService } from "@/node/services/sessionUsageService";
import type { BackgroundProcessManager } from "@/node/services/backgroundProcessManager";
import type { MinionLifecycleHooks } from "@/node/services/minionLifecycleHooks";
import type { TaskService } from "@/node/services/taskService";

import { DisposableTempDir } from "@/node/services/tempDir";
import { createBashTool } from "@/node/services/tools/bash";
import type { AskUserQuestionToolSuccessResult, BashToolResult } from "@/common/types/tools";
import { secretsToRecord } from "@/common/types/secrets";

import {
  copyPlanFileAcrossRuntimes,
  execBuffered,
  movePlanFile,
} from "@/node/utils/runtime/helpers";
import {
  buildFileCompletionsIndex,
  EMPTY_FILE_COMPLETIONS_INDEX,
  searchFileCompletions,
  type FileCompletionsIndex,
} from "@/node/services/fileCompletionsIndex";
import { taskQueueDebug } from "@/node/services/taskQueueDebug";
import {
  getSidekickGitPatchMboxPath,
  readSidekickGitPatchArtifactsFile,
  updateSidekickGitPatchArtifactsFile,
} from "@/node/services/sidekickGitPatchArtifacts";
import {
  getSidekickReportArtifactPath,
  readSidekickReportArtifactsFile,
  updateSidekickReportArtifactsFile,
} from "@/node/services/sidekickReportArtifacts";
import {
  getSidekickTranscriptChatPath,
  getSidekickTranscriptPartialPath,
  readSidekickTranscriptArtifactsFile,
  updateSidekickTranscriptArtifactsFile,
  upsertSidekickTranscriptArtifactIndexEntry,
} from "@/node/services/sidekickTranscriptArtifacts";
import { getErrorMessage } from "@/common/utils/errors";

/** Maximum number of retry attempts when minion name collides */
const MAX_MINION_NAME_COLLISION_RETRIES = 3;

// Keep short to feel instant, but debounce bursts of file_edit_* tool calls.

// Shared type for minion-scoped AI settings (model + thinking)
type MinionAISettings = z.infer<typeof MinionAISettingsSchema>;
type MinionAgentStatus = NonNullable<MinionActivitySnapshot["agentStatus"]>;
const POST_COMPACTION_METADATA_REFRESH_DEBOUNCE_MS = 100;

interface FileCompletionsCacheEntry {
  index: FileCompletionsIndex;
  fetchedAt: number;
  refreshing?: Promise<void>;
}

interface ArchiveMergedInProjectResult {
  archivedMinionIds: string[];
  skippedMinionIds: string[];
  errors: Array<{ minionId: string; error: string }>;
}

/**
 * Checks if an error indicates a minion name collision
 */
function isMinionNameCollision(error: string | undefined): boolean {
  return error?.includes("Minion already exists") ?? false;
}

/**
 * Generates a unique minion name by appending a random suffix
 */
function appendCollisionSuffix(baseName: string): string {
  const suffix = Math.random().toString(36).substring(2, 6);
  return `${baseName}-${suffix}`;
}

const MAX_REGENERATE_TITLE_RECENT_TURNS = 3;

interface MinionTitleContextTurn {
  role: "user" | "assistant";
  text: string;
}

interface MinionTitleConversationContext {
  conversationContext: string | undefined;
  latestUserText: string | undefined;
}

function extractLatticeMessageText(message: LatticeMessage): string {
  const text =
    message.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter((partText) => partText.length > 0)
      .join("\n") ?? "";
  return text;
}

function collectMinionTitleContextTurns(
  messages: readonly LatticeMessage[]
): MinionTitleContextTurn[] {
  const turns: MinionTitleContextTurn[] = [];

  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }

    const text = extractLatticeMessageText(message);
    if (!text) {
      continue;
    }

    turns.push({ role: message.role, text });
  }

  return turns;
}

function formatMinionTitleContextTurns(turns: readonly MinionTitleContextTurn[]): string {
  return turns
    .map(
      (turn, index) =>
        `Turn ${index + 1} (${turn.role === "user" ? "User" : "Assistant"}):\n${turn.text}`
    )
    .join("\n\n");
}

function buildMinionTitleConversationContext(
  turns: readonly MinionTitleContextTurn[]
): MinionTitleConversationContext {
  const firstUserIndex = turns.findIndex((turn) => turn.role === "user");

  let latestUserText: string | undefined;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") {
      latestUserText = turns[i].text;
      break;
    }
  }

  const selectedIndexes = new Set<number>();
  if (firstUserIndex >= 0) {
    selectedIndexes.add(firstUserIndex);
  }
  const recentStartIndex = Math.max(0, turns.length - MAX_REGENERATE_TITLE_RECENT_TURNS);
  for (let i = recentStartIndex; i < turns.length; i++) {
    selectedIndexes.add(i);
  }

  const selectedTurns = [...selectedIndexes].sort((a, b) => a - b).map((index) => turns[index]);
  const omittedTurns = turns.length - selectedTurns.length;

  // If there is only the first user message, avoid adding a redundant conversation block.
  if (selectedTurns.length <= 1 && omittedTurns === 0) {
    return { conversationContext: undefined, latestUserText };
  }

  const formattedTurns = formatMinionTitleContextTurns(selectedTurns);
  const omissionSummary =
    omittedTurns > 0
      ? `Note: ${omittedTurns} earlier conversation turn${omittedTurns === 1 ? "" : "s"} omitted for brevity.`
      : undefined;

  return {
    conversationContext: omissionSummary
      ? `${omissionSummary}\n\n${formattedTurns}`
      : formattedTurns,
    latestUserText,
  };
}

/**
 * Generate a unique fork branch name from the parent minion name.
 * Scans existing minion names for the `{parentName}-fork-N` pattern
 * and picks N+1, guaranteeing a valid git-safe branch name.
 */
export function generateForkBranchName(parentName: string, existingNames: string[]): string {
  const prefix = `${parentName}-fork-`;
  let max = 0;
  for (const name of existingNames) {
    if (!name.startsWith(prefix)) {
      continue;
    }

    const suffix = name.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) {
      continue;
    }

    const n = Number(suffix);
    if (n > max) {
      max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

/**
 * Generate a forked minion title by appending a " (N)" suffix to the parent title.
 * Scans existing titles in the same project to pick the next available number.
 */
export function generateForkTitle(parentTitle: string, existingTitles: string[]): string {
  // Strip any existing " (N)" suffix from the parent title to get the base
  const base = parentTitle.replace(/ \(\d+\)$/, "");
  const prefix = `${base} (`;

  let max = 0;
  for (const title of existingTitles) {
    if (!title.startsWith(prefix) || !title.endsWith(")")) {
      continue;
    }

    const suffix = title.slice(prefix.length, -1);
    if (!/^\d+$/.test(suffix)) {
      continue;
    }

    const n = Number(suffix);
    if (n > max) {
      max = n;
    }
  }
  // If parent title itself exists in the list (without suffix), start at (1)
  // Otherwise continue from the highest found suffix
  return `${base} (${max + 1})`;
}

function isErrnoWithCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

async function copyIfExists(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await fsPromises.copyFile(sourcePath, destinationPath);
  } catch (error) {
    if (!isErrnoWithCode(error, "ENOENT")) {
      throw error;
    }
  }
}

function isPathInsideDir(dirPath: string, filePath: string): boolean {
  const resolvedDir = path.resolve(dirPath);
  const resolvedFile = path.resolve(filePath);
  const relative = path.relative(resolvedDir, resolvedFile);

  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

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

function getOldestSequencedMessage(
  messages: readonly LatticeMessage[]
): { message: LatticeMessage; historySequence: number } | null {
  let oldest: { message: LatticeMessage; historySequence: number } | null = null;

  for (const message of messages) {
    const historySequence = message.metadata?.historySequence;
    if (!isNonNegativeInteger(historySequence)) {
      continue;
    }

    if (oldest === null || historySequence < oldest.historySequence) {
      oldest = { message, historySequence };
    }
  }

  return oldest;
}

interface MinionHistoryLoadMoreCursor {
  beforeHistorySequence: number;
  beforeMessageId?: string | null;
}

interface MinionHistoryLoadMoreResult {
  messages: MinionChatMessage[];
  nextCursor: MinionHistoryLoadMoreCursor | null;
  hasOlder: boolean;
}

function hasDurableCompactedMarker(value: unknown): value is true | "user" | "idle" {
  return value === true || value === "user" || value === "idle";
}

function isCompactedSummaryMessage(message: LatticeMessage): boolean {
  return hasDurableCompactedMarker(message.metadata?.compacted);
}

function getNextCompactionEpochForAppendBoundary(
  minionId: string,
  messages: LatticeMessage[]
): number {
  let epochCursor = 0;

  for (const message of messages) {
    const metadata = message.metadata;
    if (!metadata) {
      continue;
    }

    const isCompactedSummary = isCompactedSummaryMessage(message);
    const hasBoundaryMarker = metadata.compactionBoundary === true;
    const epoch = metadata.compactionEpoch;

    if (hasBoundaryMarker && !isCompactedSummary) {
      // Self-healing read path: skip malformed persisted boundary markers.
      // Boundary markers are only valid on compacted summaries.
      log.warn("Skipping malformed compaction boundary while deriving next epoch", {
        minionId,
        messageId: message.id,
        reason: "compactionBoundary set on non-compacted message",
      });
      continue;
    }

    if (!isCompactedSummary) {
      continue;
    }

    if (hasBoundaryMarker) {
      if (!isPositiveInteger(epoch)) {
        // Self-healing read path: invalid boundary metadata should not brick compaction.
        log.warn("Skipping malformed compaction boundary while deriving next epoch", {
          minionId,
          messageId: message.id,
          reason: "compactionBoundary missing positive integer compactionEpoch",
        });
        continue;
      }
      epochCursor = Math.max(epochCursor, epoch);
      continue;
    }

    if (epoch === undefined) {
      // Legacy compacted summaries predate compactionEpoch metadata.
      epochCursor += 1;
      continue;
    }

    if (!isPositiveInteger(epoch)) {
      // Self-healing read path: malformed compactionEpoch should not crash compaction.
      log.warn("Skipping malformed compactionEpoch while deriving next epoch", {
        minionId,
        messageId: message.id,
        reason: "compactionEpoch must be a positive integer when present",
      });
      continue;
    }

    epochCursor = Math.max(epochCursor, epoch);
  }

  const nextEpoch = epochCursor + 1;
  assert(nextEpoch > 0, "next compaction epoch must be positive");
  return nextEpoch;
}

async function copyFileBestEffort(params: {
  srcPath: string;
  destPath: string;
  logContext: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await fsPromises.mkdir(path.dirname(params.destPath), { recursive: true });
    await fsPromises.copyFile(params.srcPath, params.destPath);
    return true;
  } catch (error: unknown) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return false;
    }

    log.error("Failed to copy session artifact file", {
      ...params.logContext,
      srcPath: params.srcPath,
      destPath: params.destPath,
      error: getErrorMessage(error),
    });
    return false;
  }
}

async function copyDirIfMissingBestEffort(params: {
  srcDir: string;
  destDir: string;
  logContext: Record<string, unknown>;
}): Promise<void> {
  try {
    try {
      const stat = await fsPromises.stat(params.destDir);
      if (stat.isDirectory()) {
        return;
      }
      // If it's a file, fall through and try to copy (will likely fail).
    } catch (error: unknown) {
      if (!isErrnoWithCode(error, "ENOENT")) {
        throw error;
      }
    }

    await fsPromises.mkdir(path.dirname(params.destDir), { recursive: true });
    await fsPromises.cp(params.srcDir, params.destDir, { recursive: true });
  } catch (error: unknown) {
    if (isErrnoWithCode(error, "ENOENT")) {
      return;
    }

    log.error("Failed to copy session artifact directory", {
      ...params.logContext,
      srcDir: params.srcDir,
      destDir: params.destDir,
      error: getErrorMessage(error),
    });
  }
}

function coerceUpdatedAtMs(entry: { createdAtMs?: number; updatedAtMs?: number }): number {
  if (typeof entry.updatedAtMs === "number" && Number.isFinite(entry.updatedAtMs)) {
    return entry.updatedAtMs;
  }

  if (typeof entry.createdAtMs === "number" && Number.isFinite(entry.createdAtMs)) {
    return entry.createdAtMs;
  }

  return 0;
}

function rollUpAncestorMinionIds(params: {
  ancestorMinionIds: string[];
  removedMinionId: string;
  newParentMinionId: string;
}): string[] {
  const filtered = params.ancestorMinionIds.filter((id) => id !== params.removedMinionId);

  // Ensure the roll-up target is first (parent-first ordering).
  if (filtered[0] === params.newParentMinionId) {
    return filtered;
  }

  return [
    params.newParentMinionId,
    ...filtered.filter((id) => id !== params.newParentMinionId),
  ];
}

async function archiveChildSessionArtifactsIntoParentSessionDir(params: {
  parentMinionId: string;
  parentSessionDir: string;
  childMinionId: string;
  childSessionDir: string;
  /** Task-level model string for the child minion (optional; persists into transcript artifacts). */
  childTaskModelString?: string;
  /** Task-level thinking/reasoning level for the child minion (optional; persists into transcript artifacts). */
  childTaskThinkingLevel?: ThinkingLevel;
}): Promise<void> {
  if (params.parentMinionId.length === 0) {
    return;
  }

  if (params.childMinionId.length === 0) {
    return;
  }

  if (params.parentSessionDir.length === 0 || params.childSessionDir.length === 0) {
    return;
  }

  // 1) Archive the child session transcript (chat.jsonl + partial.json) into the parent session dir
  // BEFORE deleting ~/.lattice/sessions/<childMinionId>.
  try {
    const childChatPath = path.join(params.childSessionDir, "chat.jsonl");
    const childPartialPath = path.join(params.childSessionDir, "partial.json");

    const archivedChatPath = getSidekickTranscriptChatPath(
      params.parentSessionDir,
      params.childMinionId
    );
    const archivedPartialPath = getSidekickTranscriptPartialPath(
      params.parentSessionDir,
      params.childMinionId
    );

    // Defensive: avoid path traversal in minion IDs.
    if (!isPathInsideDir(params.parentSessionDir, archivedChatPath)) {
      log.error("Refusing to archive session transcript outside parent session dir", {
        parentMinionId: params.parentMinionId,
        childMinionId: params.childMinionId,
        parentSessionDir: params.parentSessionDir,
        archivedChatPath,
      });
    } else {
      const didCopyChat = await copyFileBestEffort({
        srcPath: childChatPath,
        destPath: archivedChatPath,
        logContext: {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          artifact: "chat.jsonl",
        },
      });

      const didCopyPartial = await copyFileBestEffort({
        srcPath: childPartialPath,
        destPath: archivedPartialPath,
        logContext: {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          artifact: "partial.json",
        },
      });

      if (didCopyChat || didCopyPartial) {
        const nowMs = Date.now();

        const model =
          typeof params.childTaskModelString === "string" &&
          params.childTaskModelString.trim().length > 0
            ? params.childTaskModelString.trim()
            : undefined;
        const thinkingLevel = coerceThinkingLevel(params.childTaskThinkingLevel);

        await upsertSidekickTranscriptArtifactIndexEntry({
          minionId: params.parentMinionId,
          minionSessionDir: params.parentSessionDir,
          childTaskId: params.childMinionId,
          updater: (existing) => ({
            childTaskId: params.childMinionId,
            parentMinionId: params.parentMinionId,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
            model: model ?? existing?.model,
            thinkingLevel: thinkingLevel ?? existing?.thinkingLevel,
            chatPath: didCopyChat ? archivedChatPath : existing?.chatPath,
            partialPath: didCopyPartial ? archivedPartialPath : existing?.partialPath,
          }),
        });
      }
    }
  } catch (error: unknown) {
    log.error("Failed to archive child transcript into parent session dir", {
      parentMinionId: params.parentMinionId,
      childMinionId: params.childMinionId,
      error: getErrorMessage(error),
    });
  }

  // 2) Roll up nested sidekick artifacts from the child session dir into the parent session dir.
  // This preserves grandchild artifacts when intermediate sidekick minions are cleaned up.

  // --- sidekick-patches.json + sidekick-patches/<taskId>/...
  try {
    const childArtifacts = await readSidekickGitPatchArtifactsFile(params.childSessionDir);
    const childEntries = Object.entries(childArtifacts.artifactsByChildTaskId);

    for (const [taskId] of childEntries) {
      if (!taskId) continue;

      const srcDir = path.dirname(getSidekickGitPatchMboxPath(params.childSessionDir, taskId));
      const destDir = path.dirname(getSidekickGitPatchMboxPath(params.parentSessionDir, taskId));

      if (!isPathInsideDir(params.childSessionDir, srcDir)) {
        log.error("Refusing to roll up patch artifact outside child session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          childSessionDir: params.childSessionDir,
          srcDir,
        });
        continue;
      }

      if (!isPathInsideDir(params.parentSessionDir, destDir)) {
        log.error("Refusing to roll up patch artifact outside parent session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          parentSessionDir: params.parentSessionDir,
          destDir,
        });
        continue;
      }

      await copyDirIfMissingBestEffort({
        srcDir,
        destDir,
        logContext: {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          artifact: "sidekick-patches",
          taskId,
        },
      });
    }

    if (childEntries.length > 0) {
      await updateSidekickGitPatchArtifactsFile({
        minionId: params.parentMinionId,
        minionSessionDir: params.parentSessionDir,
        update: (parentFile) => {
          for (const [taskId, childEntry] of childEntries) {
            if (!taskId) continue;
            const existing = parentFile.artifactsByChildTaskId[taskId] ?? null;

            const childUpdated = coerceUpdatedAtMs(childEntry);
            const existingUpdated = existing ? coerceUpdatedAtMs(existing) : -1;

            if (!existing || childUpdated > existingUpdated) {
              parentFile.artifactsByChildTaskId[taskId] = {
                ...childEntry,
                childTaskId: taskId,
                parentMinionId: params.parentMinionId,
                mboxPath: getSidekickGitPatchMboxPath(params.parentSessionDir, taskId),
              };
            }
          }
        },
      });
    }
  } catch (error: unknown) {
    log.error("Failed to roll up sidekick patch artifacts into parent", {
      parentMinionId: params.parentMinionId,
      childMinionId: params.childMinionId,
      error: getErrorMessage(error),
    });
  }

  // --- sidekick-reports.json + sidekick-reports/<taskId>/...
  try {
    const childArtifacts = await readSidekickReportArtifactsFile(params.childSessionDir);
    const childEntries = Object.entries(childArtifacts.artifactsByChildTaskId);

    for (const [taskId] of childEntries) {
      if (!taskId) continue;

      const srcDir = path.dirname(getSidekickReportArtifactPath(params.childSessionDir, taskId));
      const destDir = path.dirname(getSidekickReportArtifactPath(params.parentSessionDir, taskId));

      if (!isPathInsideDir(params.childSessionDir, srcDir)) {
        log.error("Refusing to roll up report artifact outside child session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          childSessionDir: params.childSessionDir,
          srcDir,
        });
        continue;
      }

      if (!isPathInsideDir(params.parentSessionDir, destDir)) {
        log.error("Refusing to roll up report artifact outside parent session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          parentSessionDir: params.parentSessionDir,
          destDir,
        });
        continue;
      }

      await copyDirIfMissingBestEffort({
        srcDir,
        destDir,
        logContext: {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          artifact: "sidekick-reports",
          taskId,
        },
      });
    }

    if (childEntries.length > 0) {
      await updateSidekickReportArtifactsFile({
        minionId: params.parentMinionId,
        minionSessionDir: params.parentSessionDir,
        update: (parentFile) => {
          for (const [taskId, childEntry] of childEntries) {
            if (!taskId) continue;

            const existing = parentFile.artifactsByChildTaskId[taskId] ?? null;
            const childUpdated = coerceUpdatedAtMs(childEntry);
            const existingUpdated = existing ? coerceUpdatedAtMs(existing) : -1;

            if (!existing || childUpdated > existingUpdated) {
              parentFile.artifactsByChildTaskId[taskId] = {
                ...childEntry,
                childTaskId: taskId,
                parentMinionId: params.parentMinionId,
                ancestorMinionIds: rollUpAncestorMinionIds({
                  ancestorMinionIds: childEntry.ancestorMinionIds,
                  removedMinionId: params.childMinionId,
                  newParentMinionId: params.parentMinionId,
                }),
              };
            }
          }
        },
      });
    }
  } catch (error: unknown) {
    log.error("Failed to roll up sidekick report artifacts into parent", {
      parentMinionId: params.parentMinionId,
      childMinionId: params.childMinionId,
      error: getErrorMessage(error),
    });
  }

  // --- sidekick-transcripts.json + sidekick-transcripts/<taskId>/...
  try {
    const childArtifacts = await readSidekickTranscriptArtifactsFile(params.childSessionDir);
    const childEntries = Object.entries(childArtifacts.artifactsByChildTaskId);

    for (const [taskId] of childEntries) {
      if (!taskId) continue;

      const srcDir = path.dirname(getSidekickTranscriptChatPath(params.childSessionDir, taskId));
      const destDir = path.dirname(getSidekickTranscriptChatPath(params.parentSessionDir, taskId));

      if (!isPathInsideDir(params.childSessionDir, srcDir)) {
        log.error("Refusing to roll up transcript artifact outside child session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          childSessionDir: params.childSessionDir,
          srcDir,
        });
        continue;
      }

      if (!isPathInsideDir(params.parentSessionDir, destDir)) {
        log.error("Refusing to roll up transcript artifact outside parent session dir", {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          taskId,
          parentSessionDir: params.parentSessionDir,
          destDir,
        });
        continue;
      }

      await copyDirIfMissingBestEffort({
        srcDir,
        destDir,
        logContext: {
          parentMinionId: params.parentMinionId,
          childMinionId: params.childMinionId,
          artifact: "sidekick-transcripts",
          taskId,
        },
      });
    }

    if (childEntries.length > 0) {
      await updateSidekickTranscriptArtifactsFile({
        minionId: params.parentMinionId,
        minionSessionDir: params.parentSessionDir,
        update: (parentFile) => {
          for (const [taskId, childEntry] of childEntries) {
            if (!taskId) continue;

            const existing = parentFile.artifactsByChildTaskId[taskId] ?? null;
            const childUpdated = coerceUpdatedAtMs(childEntry);
            const existingUpdated = existing ? coerceUpdatedAtMs(existing) : -1;

            if (!existing || childUpdated > existingUpdated) {
              parentFile.artifactsByChildTaskId[taskId] = {
                ...childEntry,
                childTaskId: taskId,
                parentMinionId: params.parentMinionId,
                chatPath: childEntry.chatPath
                  ? getSidekickTranscriptChatPath(params.parentSessionDir, taskId)
                  : undefined,
                partialPath: childEntry.partialPath
                  ? getSidekickTranscriptPartialPath(params.parentSessionDir, taskId)
                  : undefined,
              };
            }
          }
        },
      });
    }
  } catch (error: unknown) {
    log.error("Failed to roll up sidekick transcript artifacts into parent", {
      parentMinionId: params.parentMinionId,
      childMinionId: params.childMinionId,
      error: getErrorMessage(error),
    });
  }
}

async function forEachWithConcurrencyLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  assert(Number.isInteger(limit) && limit > 0, "Concurrency limit must be a positive integer");

  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) {
        return;
      }
      await fn(items[index]);
    }
  });

  await Promise.all(workers);
}

export interface MinionServiceEvents {
  chat: (event: { minionId: string; message: MinionChatMessage }) => void;
  metadata: (event: { minionId: string; metadata: FrontendMinionMetadata | null }) => void;
  activity: (event: { minionId: string; activity: MinionActivitySnapshot | null }) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface MinionService {
  on<U extends keyof MinionServiceEvents>(event: U, listener: MinionServiceEvents[U]): this;
  emit<U extends keyof MinionServiceEvents>(
    event: U,
    ...args: Parameters<MinionServiceEvents[U]>
  ): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class MinionService extends EventEmitter {
  private readonly sessions = new Map<string, AgentSession>();
  private readonly sessionSubscriptions = new Map<
    string,
    { chat: () => void; metadata: () => void }
  >();

  // Debounce post-compaction metadata refreshes (file_edit_* can fire rapidly)
  private readonly postCompactionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Tracks minions currently being renamed to prevent streaming during rename
  private readonly renamingMinions = new Set<string>();

  // Cache for @file mention autocomplete (git ls-files output).
  private readonly fileCompletionsCache = new Map<string, FileCompletionsCacheEntry>();
  // Tracks minions currently being removed to prevent new sessions/streams during deletion.
  private readonly removingMinions = new Set<string>();

  // Tracks minions currently being archived to prevent runtime-affecting operations (e.g. SSH)
  // from waking a dedicated minion during archive().
  private readonly archivingMinions = new Set<string>();

  // Tracks minions undergoing idle (background) compaction so the activity snapshot
  // can tag the stream, letting the frontend suppress notifications for maintenance work.
  private readonly idleCompactingMinions = new Set<string>();

  // AbortControllers for in-progress minion initialization (postCreateSetup + initMinion).
  //
  // Why this lives here: archive/remove are the user-facing lifecycle operations that should
  // cancel any fire-and-forget init work to avoid orphaned processes (e.g., SSH sync, .lattice/init).
  private readonly initAbortControllers = new Map<string, AbortController>();

  // ExtensionMetadataService now serializes all mutations globally because every
  // minion shares the same extensionMetadata.json file.

  /** Check if a minion is currently being removed. */
  isRemoving(minionId: string): boolean {
    return this.removingMinions.has(minionId);
  }

  constructor(
    private readonly config: Config,
    private readonly historyService: HistoryService,
    private readonly aiService: AIService,
    private readonly initStateManager: InitStateManager,
    private readonly extensionMetadata: ExtensionMetadataService,
    private readonly backgroundProcessManager: BackgroundProcessManager,
    private readonly sessionUsageService?: SessionUsageService,
    policyService?: PolicyService,
    telemetryService?: TelemetryService,
    experimentsService?: ExperimentsService,
    sessionTimingService?: SessionTimingService
  ) {
    super();
    this.policyService = policyService;
    this.telemetryService = telemetryService;
    this.experimentsService = experimentsService;
    this.sessionTimingService = sessionTimingService;
    this.setupMetadataListeners();
    this.setupInitMetadataListeners();
  }

  private readonly policyService?: PolicyService;
  private readonly telemetryService?: TelemetryService;
  private readonly experimentsService?: ExperimentsService;
  private mcpServerManager?: MCPServerManager;
  // Optional terminal service for cleanup on minion removal
  private terminalService?: TerminalService;
  private readonly sessionTimingService?: SessionTimingService;
  private minionLifecycleHooks?: MinionLifecycleHooks;
  private taskService?: TaskService;

  /**
   * Set the MCP server manager for tool access.
   * Called after construction due to circular dependency.
   */
  setMCPServerManager(manager: MCPServerManager): void {
    this.mcpServerManager = manager;
  }

  /**
   * Set the terminal service for cleanup on minion removal.
   */
  setTerminalService(terminalService: TerminalService): void {
    this.terminalService = terminalService;
  }

  setMinionLifecycleHooks(hooks: MinionLifecycleHooks): void {
    this.minionLifecycleHooks = hooks;
  }

  /**
   * Set the task service for auto-resume counter resets.
   * Called after construction due to circular dependency.
   */
  setTaskService(taskService: TaskService): void {
    this.taskService = taskService;
  }

  /**
   * DEBUG ONLY: Trigger an artificial stream error for testing.
   * This is used by integration tests to simulate network errors mid-stream.
   * @returns true if an active stream was found and error was triggered
   */
  debugTriggerStreamError(minionId: string, errorMessage?: string): Promise<boolean> {
    return this.aiService.debugTriggerStreamError(minionId, errorMessage);
  }

  /**
   * Setup listeners to update metadata store based on AIService events.
   * This tracks minion recency and streaming status for VS Code extension integration.
   */
  private setupMetadataListeners(): void {
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
    const isMinionEvent = (v: unknown): v is { minionId: string } =>
      isObj(v) && "minionId" in v && typeof v.minionId === "string";
    const isStreamStartEvent = (
      v: unknown
    ): v is { minionId: string; model: string; agentId?: string } =>
      isMinionEvent(v) && "model" in v && typeof v.model === "string";
    const isStreamEndEvent = (v: unknown): v is StreamEndEvent =>
      isMinionEvent(v) &&
      (!("metadata" in (v as Record<string, unknown>)) || isObj((v as StreamEndEvent).metadata));
    const isStreamAbortEvent = (v: unknown): v is StreamAbortEvent => isMinionEvent(v);
    const isErrorEvent = (v: unknown): v is { minionId: string; error: string } =>
      isMinionEvent(v) && "error" in v && typeof (v as { error: unknown }).error === "string";
    const isToolCallEndEvent = (v: unknown): v is ToolCallEndEvent =>
      isMinionEvent(v) &&
      "toolName" in v &&
      typeof (v as { toolName: unknown }).toolName === "string" &&
      "result" in v;
    const extractStatusSetResult = (result: unknown): MinionAgentStatus | null => {
      if (!isObj(result)) {
        return null;
      }

      if (
        result.success !== true ||
        typeof result.emoji !== "string" ||
        typeof result.message !== "string"
      ) {
        return null;
      }

      if (result.url !== undefined && typeof result.url !== "string") {
        return null;
      }

      return {
        emoji: result.emoji,
        message: result.message,
        ...(typeof result.url === "string" ? { url: result.url } : {}),
      };
    };
    const extractTimestamp = (event: StreamEndEvent | { metadata?: { timestamp?: number } }) => {
      const raw = event.metadata?.timestamp;
      return typeof raw === "number" && Number.isFinite(raw) ? raw : Date.now();
    };

    // Update streaming status and recency on stream start
    this.aiService.on("stream-start", (data: unknown) => {
      if (isStreamStartEvent(data)) {
        void this.updateStreamingStatus(data.minionId, true, data.model, data.agentId);
      }
    });

    this.aiService.on("stream-end", (data: unknown) => {
      if (isStreamEndEvent(data)) {
        void this.handleStreamCompletion(data.minionId, extractTimestamp(data));
      }
    });

    this.aiService.on("stream-abort", (data: unknown) => {
      if (isStreamAbortEvent(data)) {
        void this.updateStreamingStatus(data.minionId, false);
      }
    });

    this.aiService.on("error", (data: unknown) => {
      if (isErrorEvent(data)) {
        void this.updateStreamingStatus(data.minionId, false);
      }
    });

    this.aiService.on("tool-call-end", (data: unknown) => {
      if (!isToolCallEndEvent(data) || data.replay === true || data.toolName !== "status_set") {
        return;
      }

      const agentStatus = extractStatusSetResult(data.result);
      if (!agentStatus) {
        return;
      }

      void this.updateAgentStatus(data.minionId, agentStatus);
    });
  }

  private setupInitMetadataListeners(): void {
    const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
    const isMinionEvent = (v: unknown): v is { minionId: string } =>
      isObj(v) && "minionId" in v && typeof v.minionId === "string";

    // When init completes, refresh metadata so the UI can clear isInitializing and swap
    // "Cancel creation" back to the normal archive affordance.
    this.initStateManager.on("init-end", (event: unknown) => {
      if (!isMinionEvent(event)) {
        return;
      }
      void this.refreshAndEmitMetadata(event.minionId);
    });
  }

  private emitMinionActivity(
    minionId: string,
    snapshot: MinionActivitySnapshot | null
  ): void {
    this.emit("activity", { minionId, activity: snapshot });
  }

  private async updateRecencyTimestamp(minionId: string, timestamp?: number): Promise<void> {
    try {
      const snapshot = await this.extensionMetadata.updateRecency(
        minionId,
        timestamp ?? Date.now()
      );
      this.emitMinionActivity(minionId, snapshot);
    } catch (error) {
      log.error("Failed to update minion recency", { minionId, error });
    }
  }

  public async updateAgentStatus(
    minionId: string,
    agentStatus: MinionAgentStatus | null
  ): Promise<void> {
    try {
      const snapshot = await this.extensionMetadata.setAgentStatus(minionId, agentStatus);
      this.emitMinionActivity(minionId, snapshot);
    } catch (error) {
      log.error("Failed to update minion agent status", { minionId, error });
    }
  }

  private async updateStreamingStatus(
    minionId: string,
    streaming: boolean,
    model?: string,
    agentId?: string
  ): Promise<void> {
    try {
      let thinkingLevel: MinionAISettings["thinkingLevel"] | undefined;
      if (model) {
        const found = this.config.findMinion(minionId);
        if (found) {
          const config = this.config.loadConfigOrDefault();
          const project = config.projects.get(found.projectPath);
          const minion =
            project?.minions.find((w) => w.id === minionId) ??
            project?.minions.find((w) => w.path === found.minionPath);
          const normalizedAgentId =
            typeof agentId === "string" && agentId.trim().length > 0
              ? agentId.trim().toLowerCase()
              : MINION_DEFAULTS.agentId;
          const aiSettings =
            minion?.aiSettingsByAgent?.[normalizedAgentId] ?? minion?.aiSettings;
          thinkingLevel = aiSettings?.thinkingLevel;
        }
      }
      const snapshot = await this.extensionMetadata.setStreaming(
        minionId,
        streaming,
        model,
        thinkingLevel
      );
      // Idle compaction tagging is stop-snapshot only. Never tag streaming=true updates,
      // otherwise fast follow-up turns can inherit stale idle metadata before cleanup runs.
      const shouldTagIdleCompaction = !streaming && this.idleCompactingMinions.has(minionId);
      this.emitMinionActivity(
        minionId,
        shouldTagIdleCompaction ? { ...snapshot, isIdleCompaction: true } : snapshot
      );
    } catch (error) {
      log.error("Failed to update minion streaming status", { minionId, error });
    } finally {
      // Idle compaction marker is turn-scoped. Always clear on streaming=false transitions,
      // even when metadata writes fail, so stale state cannot leak into future user streams.
      if (!streaming) {
        this.idleCompactingMinions.delete(minionId);
      }
    }
  }

  private async handleStreamCompletion(minionId: string, timestamp: number): Promise<void> {
    await this.updateRecencyTimestamp(minionId, timestamp);
    await this.updateStreamingStatus(minionId, false);
  }

  private createInitLogger(minionId: string) {
    const hasInitState = () => this.initStateManager.getInitState(minionId) !== undefined;

    return {
      logStep: (message: string) => {
        if (!hasInitState()) {
          return;
        }
        this.initStateManager.appendOutput(minionId, message, false);
      },
      logStdout: (line: string) => {
        if (!hasInitState()) {
          return;
        }
        this.initStateManager.appendOutput(minionId, line, false);
      },
      logStderr: (line: string) => {
        if (!hasInitState()) {
          return;
        }
        this.initStateManager.appendOutput(minionId, line, true);
      },
      logComplete: (exitCode: number) => {
        this.initAbortControllers.delete(minionId);

        // MinionService.remove() clears in-memory init state early so waiters/tools can bail out.
        // If init completes after deletion, avoid noisy logs (endInit() would report missing state).
        if (!hasInitState()) {
          return;
        }

        void this.initStateManager.endInit(minionId, exitCode);
      },
      enterHookPhase: () => {
        if (!hasInitState()) {
          return;
        }
        this.initStateManager.enterHookPhase(minionId);
      },
    };
  }

  private schedulePostCompactionMetadataRefresh(minionId: string): void {
    assert(typeof minionId === "string", "minionId must be a string");
    const trimmed = minionId.trim();
    assert(trimmed.length > 0, "minionId must not be empty");

    const existing = this.postCompactionRefreshTimers.get(trimmed);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.postCompactionRefreshTimers.delete(trimmed);
      void this.emitPostCompactionMetadata(trimmed);
    }, POST_COMPACTION_METADATA_REFRESH_DEBOUNCE_MS);

    this.postCompactionRefreshTimers.set(trimmed, timer);
  }

  private async emitPostCompactionMetadata(minionId: string): Promise<void> {
    try {
      const session = this.sessions.get(minionId);
      if (!session) {
        return;
      }

      const metadata = await this.getInfo(minionId);
      if (!metadata) {
        return;
      }

      const postCompaction = await this.getPostCompactionState(minionId);
      const enrichedMetadata = { ...metadata, postCompaction };
      session.emitMetadata(enrichedMetadata);
    } catch (error) {
      // Minion runtime unavailable (e.g., SSH unreachable) - skip emitting post-compaction state.
      log.debug("Failed to emit post-compaction metadata", { minionId, error });
    }
  }

  // Clear persisted sidebar status only after the user turn is accepted and emitted.
  // sendMessage can fail before acceptance (for example invalid_model_string), so
  // clearing inside sendMessage would drop status for turns that never entered history.
  private shouldClearAgentStatusFromChatMessage(message: MinionChatMessage): boolean {
    return (
      message.type === "message" && message.role === "user" && message.metadata?.synthetic !== true
    );
  }

  public getOrCreateSession(minionId: string): AgentSession {
    assert(typeof minionId === "string", "minionId must be a string");
    const trimmed = minionId.trim();
    assert(trimmed.length > 0, "minionId must not be empty");

    let session = this.sessions.get(trimmed);
    if (session) {
      return session;
    }

    session = new AgentSession({
      minionId: trimmed,
      config: this.config,
      historyService: this.historyService,
      aiService: this.aiService,
      telemetryService: this.telemetryService,
      initStateManager: this.initStateManager,
      backgroundProcessManager: this.backgroundProcessManager,
      onCompactionComplete: () => {
        this.schedulePostCompactionMetadataRefresh(trimmed);
      },
      onPostCompactionStateChange: () => {
        this.schedulePostCompactionMetadataRefresh(trimmed);
      },
    });

    const chatUnsubscribe = session.onChatEvent((event) => {
      this.emit("chat", { minionId: event.minionId, message: event.message });
      if (this.shouldClearAgentStatusFromChatMessage(event.message)) {
        void this.updateAgentStatus(event.minionId, null);
      }
    });

    const metadataUnsubscribe = session.onMetadataEvent((event) => {
      this.emit("metadata", {
        minionId: event.minionId,
        metadata: event.metadata!,
      });
    });

    this.sessions.set(trimmed, session);
    this.sessionSubscriptions.set(trimmed, {
      chat: chatUnsubscribe,
      metadata: metadataUnsubscribe,
    });

    return session;
  }

  /**
   * Register an externally-created AgentSession so that MinionService
   * operations (sendMessage, resumeStream, remove, etc.) reuse it instead of
   * creating a duplicate. Used by `lattice run` CLI to keep a single session
   * instance for the parent minion.
   */
  public registerSession(minionId: string, session: AgentSession): void {
    minionId = minionId.trim();
    assert(minionId.length > 0, "minionId must not be empty");
    assert(!this.sessions.has(minionId), `session already registered for ${minionId}`);

    this.sessions.set(minionId, session);

    const chatUnsubscribe = session.onChatEvent((event) => {
      this.emit("chat", { minionId: event.minionId, message: event.message });
      if (this.shouldClearAgentStatusFromChatMessage(event.message)) {
        void this.updateAgentStatus(event.minionId, null);
      }
    });

    const metadataUnsubscribe = session.onMetadataEvent((event) => {
      this.emit("metadata", {
        minionId: event.minionId,
        metadata: event.metadata!,
      });
    });

    this.sessionSubscriptions.set(minionId, {
      chat: chatUnsubscribe,
      metadata: metadataUnsubscribe,
    });
  }

  public disposeSession(minionId: string): void {
    const trimmed = minionId.trim();
    const session = this.sessions.get(trimmed);
    const refreshTimer = this.postCompactionRefreshTimers.get(trimmed);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      this.postCompactionRefreshTimers.delete(trimmed);
    }

    if (!session) {
      return;
    }

    const subscriptions = this.sessionSubscriptions.get(trimmed);
    if (subscriptions) {
      subscriptions.chat();
      subscriptions.metadata();
      this.sessionSubscriptions.delete(trimmed);
    }

    session.dispose();
    this.sessions.delete(trimmed);
  }

  private async getPersistedPostCompactionDiffPaths(minionId: string): Promise<string[] | null> {
    const postCompactionPath = path.join(
      this.config.getSessionDir(minionId),
      "post-compaction.json"
    );

    try {
      const raw = await fsPromises.readFile(postCompactionPath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      const diffsRaw = (parsed as { diffs?: unknown }).diffs;
      if (!Array.isArray(diffsRaw)) {
        return null;
      }

      const result: string[] = [];
      for (const diff of diffsRaw) {
        if (!diff || typeof diff !== "object") continue;
        const p = (diff as { path?: unknown }).path;
        if (typeof p !== "string") continue;
        const trimmed = p.trim();
        if (trimmed.length === 0) continue;
        result.push(trimmed);
      }

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get post-compaction context state for a minion.
   * Returns info about what will be injected after compaction.
   * Prefers cached paths from pending compaction, falls back to history extraction.
   */
  public async getPostCompactionState(minionId: string): Promise<{
    planPath: string | null;
    trackedFilePaths: string[];
    excludedItems: string[];
  }> {
    // Get minion metadata to create runtime for plan file check
    const metadata = await this.getInfo(minionId);
    if (!metadata) {
      // Can't get metadata, return empty state
      const exclusions = await this.getPostCompactionExclusions(minionId);
      return { planPath: null, trackedFilePaths: [], excludedItems: exclusions.excludedItems };
    }

    const runtime = createRuntimeForMinion(metadata);
    const latticeHome = runtime.getLatticeHome();
    const planPath = getPlanFilePath(metadata.name, metadata.projectName, latticeHome);
    // For local/SSH: expand tilde for comparison with message history paths
    // For Docker: paths are already absolute (/var/lattice/...), no expansion needed
    const expandedPlanPath = latticeHome.startsWith("~") ? expandTilde(planPath) : planPath;
    // Legacy plan path (stored by minion ID) for filtering
    const legacyPlanPath = getLegacyPlanFilePath(minionId);
    const expandedLegacyPlanPath = expandTilde(legacyPlanPath);

    // Check both new and legacy plan paths, prefer new path
    const newPlanExists = await fileExists(runtime, planPath);
    const legacyPlanExists = !newPlanExists && (await fileExists(runtime, legacyPlanPath));
    // Resolve plan path via runtime to get correct absolute path for deep links.
    // Local: expands ~ to local home. SSH: expands ~ on remote host.
    const activePlanPath = newPlanExists
      ? await runtime.resolvePath(planPath)
      : legacyPlanExists
        ? await runtime.resolvePath(legacyPlanPath)
        : null;

    // Load exclusions
    const exclusions = await this.getPostCompactionExclusions(minionId);

    // Helper to check if a path is a plan file (new or legacy format)
    const isPlanPath = (p: string) =>
      p === planPath ||
      p === expandedPlanPath ||
      p === legacyPlanPath ||
      p === expandedLegacyPlanPath;

    // If session has pending compaction attachments, use cached paths
    // (history is cleared after compaction, but cache survives)
    const session = this.sessions.get(minionId);
    const pendingPaths = session?.getPendingTrackedFilePaths();
    if (pendingPaths) {
      // Filter out both new and legacy plan file paths
      const trackedFilePaths = pendingPaths.filter((p) => !isPlanPath(p));
      return {
        planPath: activePlanPath,
        trackedFilePaths,
        excludedItems: exclusions.excludedItems,
      };
    }

    // Fallback (crash-safe): if a post-compaction snapshot exists on disk, use it.
    const persistedPaths = await this.getPersistedPostCompactionDiffPaths(minionId);
    if (persistedPaths !== null) {
      const trackedFilePaths = persistedPaths.filter((p) => !isPlanPath(p));
      return {
        planPath: activePlanPath,
        trackedFilePaths,
        excludedItems: exclusions.excludedItems,
      };
    }

    // Fallback: compute tracked files from message history (survives reloads).
    // Only the current compaction epoch matters — post-compaction files are from
    // the active epoch only.
    const historyResult = await this.historyService.getHistoryFromLatestBoundary(minionId);
    const messages = historyResult.success ? historyResult.data : [];
    const allPaths = extractEditedFilePaths(messages);

    // Exclude plan file from tracked files since it has its own crew
    // Filter out both new and legacy plan file paths
    const trackedFilePaths = allPaths.filter((p) => !isPlanPath(p));
    return {
      planPath: activePlanPath,
      trackedFilePaths,
      excludedItems: exclusions.excludedItems,
    };
  }

  /**
   * Get post-compaction exclusions for a minion.
   * Returns empty exclusions if file doesn't exist.
   */
  public async getPostCompactionExclusions(minionId: string): Promise<PostCompactionExclusions> {
    const exclusionsPath = path.join(this.config.getSessionDir(minionId), "exclusions.json");
    try {
      const data = await fsPromises.readFile(exclusionsPath, "utf-8");
      return JSON.parse(data) as PostCompactionExclusions;
    } catch {
      return { excludedItems: [] };
    }
  }

  /**
   * Set whether an item is excluded from post-compaction context.
   * Item IDs: "plan" for plan file, "file:<path>" for tracked files.
   */
  public async setPostCompactionExclusion(
    minionId: string,
    itemId: string,
    excluded: boolean
  ): Promise<Result<void>> {
    try {
      const exclusions = await this.getPostCompactionExclusions(minionId);
      const set = new Set(exclusions.excludedItems);

      if (excluded) {
        set.add(itemId);
      } else {
        set.delete(itemId);
      }

      const sessionDir = this.config.getSessionDir(minionId);
      await fsPromises.mkdir(sessionDir, { recursive: true });
      const exclusionsPath = path.join(sessionDir, "exclusions.json");
      await fsPromises.writeFile(
        exclusionsPath,
        JSON.stringify({ excludedItems: [...set] }, null, 2)
      );
      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to set exclusion: ${message}`);
    }
  }

  async create(
    projectPath: string,
    branchName: string,
    trunkBranch: string | undefined,
    title?: string,
    runtimeConfig?: RuntimeConfig,
    crewId?: string
  ): Promise<Result<{ metadata: FrontendMinionMetadata }>> {
    // Chat with Lattice is a built-in system minion; it cannot host additional minions.
    if (projectPath === getLatticeHelpChatProjectPath(this.config.rootDir)) {
      return Err("Cannot create minions in the Chat with Lattice system project");
    }

    // Validate minion name
    const validation = validateMinionName(branchName);
    if (!validation.valid) {
      return Err(validation.error ?? "Invalid minion name");
    }

    // Generate stable minion ID
    const minionId = this.config.generateStableId();

    // Create runtime for minion creation
    // Default to worktree runtime for backward compatibility
    let finalRuntimeConfig: RuntimeConfig = runtimeConfig ?? {
      type: "worktree",
      srcBaseDir: this.config.srcDir,
    };

    if (this.policyService?.isEnforced()) {
      if (!this.policyService.isRuntimeAllowed(finalRuntimeConfig)) {
        return Err("Selected runtime is not allowed by policy");
      }
    }

    // Local runtime doesn't need a trunk branch; worktree/SSH runtimes require it
    const isLocalRuntime = finalRuntimeConfig.type === "local";
    const normalizedTrunkBranch = trunkBranch?.trim() ?? "";
    if (!isLocalRuntime && normalizedTrunkBranch.length === 0) {
      return Err("Trunk branch is required for worktree and SSH runtimes");
    }

    let runtime;
    try {
      runtime = createRuntime(finalRuntimeConfig, { projectPath });

      // Resolve srcBaseDir path if the config has one.
      // Skip if runtime has deferredRuntimeAccess flag (runtime doesn't exist yet, e.g., Lattice).
      const srcBaseDir = getSrcBaseDir(finalRuntimeConfig);
      if (srcBaseDir && !runtime.createFlags?.deferredRuntimeAccess) {
        const resolvedSrcBaseDir = await runtime.resolvePath(srcBaseDir);
        if (resolvedSrcBaseDir !== srcBaseDir && hasSrcBaseDir(finalRuntimeConfig)) {
          finalRuntimeConfig = {
            ...finalRuntimeConfig,
            srcBaseDir: resolvedSrcBaseDir,
          };
          runtime = createRuntime(finalRuntimeConfig, { projectPath });
        }
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      return Err(errorMsg);
    }

    const session = this.getOrCreateSession(minionId);
    this.initStateManager.startInit(minionId, projectPath);

    // Create abort controller immediately so minion lifecycle operations (e.g., cancel/remove)
    // can reliably interrupt init even if the UI deletes the minion during create().
    const initAbortController = new AbortController();
    this.initAbortControllers.set(minionId, initAbortController);

    const initLogger = this.createInitLogger(minionId);

    try {
      // Create minion with automatic collision retry
      let finalBranchName = branchName;
      let createResult: { success: boolean; minionPath?: string; error?: string };

      // If runtime uses config-level collision detection (e.g., Lattice - can't reach host),
      // check against existing minion names before createMinion.
      if (runtime.createFlags?.configLevelCollisionDetection) {
        const existingNames = new Set(
          (this.config.loadConfigOrDefault().projects.get(projectPath)?.minions ?? []).map(
            (w) => w.name
          )
        );
        for (
          let i = 0;
          i < MAX_MINION_NAME_COLLISION_RETRIES && existingNames.has(finalBranchName);
          i++
        ) {
          log.debug(`Minion name collision for "${finalBranchName}", adding suffix`);
          finalBranchName = appendCollisionSuffix(branchName);
        }
      }

      for (let attempt = 0; attempt <= MAX_MINION_NAME_COLLISION_RETRIES; attempt++) {
        createResult = await runtime.createMinion({
          projectPath,
          branchName: finalBranchName,
          trunkBranch: normalizedTrunkBranch,
          directoryName: finalBranchName,
          initLogger,
          abortSignal: initAbortController.signal,
        });

        if (createResult.success) break;

        // If collision and not last attempt, retry with suffix
        if (
          isMinionNameCollision(createResult.error) &&
          attempt < MAX_MINION_NAME_COLLISION_RETRIES
        ) {
          log.debug(`Minion name collision for "${finalBranchName}", retrying with suffix`);
          finalBranchName = appendCollisionSuffix(branchName);
          continue;
        }
        break;
      }

      if (!createResult!.success || !createResult!.minionPath) {
        initLogger.logComplete(-1);
        return Err(createResult!.error ?? "Failed to summon minion");
      }

      // Let runtime finalize config (e.g., derive names, compute host) after collision handling
      if (runtime.finalizeConfig) {
        const finalizeResult = await runtime.finalizeConfig(finalBranchName, finalRuntimeConfig);
        if (!finalizeResult.success) {
          initLogger.logComplete(-1);
          return Err(finalizeResult.error);
        }
        finalRuntimeConfig = finalizeResult.data;
        runtime = createRuntime(finalRuntimeConfig, { projectPath });
      }

      // Let runtime validate before persisting (e.g., external collision checks)
      if (runtime.validateBeforePersist) {
        const validateResult = await runtime.validateBeforePersist(
          finalBranchName,
          finalRuntimeConfig
        );
        if (!validateResult.success) {
          initLogger.logComplete(-1);
          return Err(validateResult.error);
        }
      }

      const projectName =
        projectPath.split("/").pop() ?? projectPath.split("\\").pop() ?? "unknown";

      const metadata = {
        id: minionId,
        name: finalBranchName,
        title,
        projectName,
        projectPath,
        createdAt: new Date().toISOString(),
      };

      await this.config.editConfig((config) => {
        let projectConfig = config.projects.get(projectPath);
        if (!projectConfig) {
          projectConfig = { minions: [] };
          config.projects.set(projectPath, projectConfig);
        }
        projectConfig.minions.push({
          path: createResult!.minionPath!,
          id: minionId,
          name: finalBranchName,
          title,
          createdAt: metadata.createdAt,
          runtimeConfig: finalRuntimeConfig,
          crewId,
        });
        return config;
      });

      const allMetadata = await this.config.getAllMinionMetadata();
      const completeMetadata = allMetadata.find((m) => m.id === minionId);
      if (!completeMetadata) {
        initLogger.logComplete(-1);
        return Err("Failed to retrieve minion metadata");
      }

      session.emitMetadata(this.enrichFrontendMetadata(completeMetadata));

      // Background init: run postCreateSetup (if present) then initMinion
      const secrets = secretsToRecord(this.config.getEffectiveSecrets(projectPath));
      // Background init: postCreateSetup (provisioning) + initMinion (sync/checkout/hook)
      //
      // If the user cancelled creation while create() was still in flight, avoid spawning
      // additional background work for a minion that's already being removed.
      if (!this.removingMinions.has(minionId) && !initAbortController.signal.aborted) {
        runBackgroundInit(
          runtime,
          {
            projectPath,
            branchName: finalBranchName,
            trunkBranch: normalizedTrunkBranch,
            minionPath: createResult!.minionPath,
            initLogger,
            env: secrets,
            abortSignal: initAbortController.signal,
          },
          minionId,
          log
        );
      } else {
        initAbortController.abort();
        this.initAbortControllers.delete(minionId);

        // Background init will never run, so init-end won’t fire.
        // Clear init state + re-emit metadata so the sidebar doesn’t stay stuck on isInitializing.
        this.initStateManager.clearInMemoryState(minionId);
        session.emitMetadata(this.enrichFrontendMetadata(completeMetadata));
      }

      return Ok({ metadata: this.enrichFrontendMetadata(completeMetadata) });
    } catch (error) {
      initLogger.logComplete(-1);
      const message = getErrorMessage(error);
      return Err(`Failed to summon minion: ${message}`);
    }
  }

  async remove(minionId: string, force = false): Promise<Result<void>> {
    if (minionId === LATTICE_HELP_CHAT_MINION_ID) {
      return Err("Cannot remove the Chat with Lattice system minion");
    }

    // Idempotent: if already removing, return success to prevent race conditions
    if (this.removingMinions.has(minionId)) {
      return Ok(undefined);
    }
    this.removingMinions.add(minionId);

    // If this minion is mid-init, cancel the fire-and-forget init work (postCreateSetup,
    // sync/checkout, .lattice/init hook, etc.) so removal doesn't leave orphaned background work.
    const initAbortController = this.initAbortControllers.get(minionId);
    if (initAbortController) {
      initAbortController.abort();
      this.initAbortControllers.delete(minionId);
    }

    // Try to remove from runtime (filesystem)
    try {
      // Stop any active stream before deleting metadata/config to avoid tool calls racing with removal.
      //
      // IMPORTANT: AIService forwards "stream-abort" asynchronously after partial cleanup. If we roll up
      // session timing (or delete session files) immediately after stopStream(), we can race the final
      // abort timing write.
      const wasStreaming = this.aiService.isStreaming(minionId);
      const streamStoppedEvent: Promise<"abort" | "end" | undefined> | undefined = wasStreaming
        ? new Promise((resolve) => {
            const aiService = this.aiService;
            const targetMinionId = minionId;
            const timeoutMs = 5000;

            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = (result: "abort" | "end" | undefined) => {
              if (settled) return;
              settled = true;
              if (timer) {
                clearTimeout(timer);
                timer = undefined;
              }
              aiService.off("stream-abort", onAbort);
              aiService.off("stream-end", onEnd);
              resolve(result);
            };

            function onAbort(data: StreamAbortEvent): void {
              if (data.minionId !== targetMinionId) return;
              cleanup("abort");
            }

            function onEnd(data: StreamEndEvent): void {
              if (data.minionId !== targetMinionId) return;
              cleanup("end");
            }

            aiService.on("stream-abort", onAbort);
            aiService.on("stream-end", onEnd);

            timer = setTimeout(() => cleanup(undefined), timeoutMs);
          })
        : undefined;

      try {
        const stopResult = await this.aiService.stopStream(minionId, { abandonPartial: true });
        if (!stopResult.success) {
          log.debug("Failed to stop stream during minion removal", {
            minionId,
            error: stopResult.error,
          });
        }
      } catch (error: unknown) {
        log.debug("Failed to stop stream during minion removal (threw)", { minionId, error });
      }

      if (streamStoppedEvent) {
        const stopEvent = await streamStoppedEvent;
        if (!stopEvent) {
          log.debug("Timed out waiting for stream to stop during minion removal", {
            minionId,
          });
        }

        // If session timing is enabled, make sure no pending writes can recreate session files after
        // we delete the session directory.
        if (this.sessionTimingService) {
          await this.sessionTimingService.waitForIdle(minionId);
        }
      }

      let parentMinionId: string | null = null;
      let childTaskModelString: string | undefined;
      let childTaskThinkingLevel: ThinkingLevel | undefined;

      const metadataResult = await this.aiService.getMinionMetadata(minionId);
      if (metadataResult.success) {
        const metadata = metadataResult.data;
        const projectPath = metadata.projectPath;

        const runtime = createRuntime(metadata.runtimeConfig, {
          projectPath,
          minionName: metadata.name,
        });

        // Delete minion from runtime first - if this fails with force=false, we abort
        // and keep minion in config so user can retry. This prevents orphaned directories.
        const deleteResult = await runtime.deleteMinion(
          projectPath,
          metadata.name, // use branch name
          force
        );

        if (!deleteResult.success) {
          // If force is true, we continue to remove from config even if fs removal failed
          if (!force) {
            return Err(deleteResult.error ?? "Failed to delete minion from disk");
          }
          log.error(
            `Failed to delete minion from disk, but force=true. Removing from config. Error: ${deleteResult.error}`
          );
        }

        // Note: Lattice minion deletion is handled by LatticeSSHRuntime.deleteMinion()

        parentMinionId = metadata.parentMinionId ?? null;
        childTaskModelString = metadata.taskModelString;
        childTaskThinkingLevel = coerceThinkingLevel(metadata.taskThinkingLevel);

        // If this minion is a sidekick/task, roll its accumulated timing into the parent BEFORE
        // deleting ~/.lattice/sessions/<minionId>/session-timing.json.
        if (parentMinionId && this.sessionTimingService) {
          try {
            // Flush any last timing write (e.g. from stream-abort) before reading.
            await this.sessionTimingService.waitForIdle(minionId);
            await this.sessionTimingService.rollUpTimingIntoParent(parentMinionId, minionId);
          } catch (error: unknown) {
            log.error("Failed to roll up child session timing into parent", {
              minionId,
              parentMinionId,
              error: getErrorMessage(error),
            });
          }
        }

        // If this minion is a sidekick/task, roll its accumulated usage into the parent BEFORE
        // deleting ~/.lattice/sessions/<minionId>/session-usage.json.
        if (parentMinionId && this.sessionUsageService) {
          try {
            const childUsage = await this.sessionUsageService.getSessionUsage(minionId);
            if (childUsage && Object.keys(childUsage.byModel).length > 0) {
              const rollup = await this.sessionUsageService.rollUpUsageIntoParent(
                parentMinionId,
                minionId,
                childUsage.byModel
              );

              if (rollup.didRollUp) {
                // Live UI update (best-effort): only emit if the parent session is already active.
                this.sessions.get(parentMinionId)?.emitChatEvent({
                  type: "session-usage-delta",
                  minionId: parentMinionId,
                  sourceMinionId: minionId,
                  byModelDelta: childUsage.byModel,
                  timestamp: Date.now(),
                });
              }
            }
          } catch (error: unknown) {
            log.error("Failed to roll up child session usage into parent", {
              minionId,
              parentMinionId,
              error: getErrorMessage(error),
            });
          }
        }
      } else {
        log.error(`Could not find metadata for minion ${minionId}, creating phantom cleanup`);
      }

      // Avoid leaking init waiters/logs after minion deletion.
      // Must happen before deleting the session directory so queued init-status writes don't
      // recreate ~/.lattice/sessions/<minionId>/ after removal.
      //
      // Intentionally deferred until we're committed to removal: if runtime deletion fails with
      // force=false we return early and keep init state intact so init-end can refresh metadata.
      this.initStateManager.clearInMemoryState(minionId);
      // Remove session data
      try {
        const sessionDir = this.config.getSessionDir(minionId);

        if (parentMinionId) {
          try {
            const parentSessionDir = this.config.getSessionDir(parentMinionId);
            await archiveChildSessionArtifactsIntoParentSessionDir({
              parentMinionId,
              parentSessionDir,
              childMinionId: minionId,
              childSessionDir: sessionDir,
              childTaskModelString,
              childTaskThinkingLevel,
            });
          } catch (error: unknown) {
            log.error("Failed to roll up child session artifacts into parent", {
              minionId,
              parentMinionId,
              error: getErrorMessage(error),
            });
          }
        }

        await fsPromises.rm(sessionDir, { recursive: true, force: true });
      } catch (error) {
        log.error(`Failed to remove session directory for ${minionId}:`, error);
      }

      // Stop MCP servers for this minion
      if (this.mcpServerManager) {
        await this.mcpServerManager.stopServers(minionId);
      }

      // Dispose session
      this.disposeSession(minionId);

      // Close any terminal sessions for this minion
      this.terminalService?.closeMinionSessions(minionId);

      // Remove from config
      await this.config.removeMinion(minionId);

      this.emit("metadata", { minionId, metadata: null });

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to remove minion: ${message}`);
    } finally {
      this.removingMinions.delete(minionId);
    }
  }

  private enrichFrontendMetadata(metadata: FrontendMinionMetadata): FrontendMinionMetadata {
    const isInitializing =
      this.initStateManager.getInitState(metadata.id)?.status === "running" || undefined;
    return {
      ...metadata,
      isRemoving: this.removingMinions.has(metadata.id) || undefined,
      isInitializing,
    };
  }

  private enrichMaybeFrontendMetadata(
    metadata: FrontendMinionMetadata | null
  ): FrontendMinionMetadata | null {
    if (!metadata) {
      return null;
    }
    return this.enrichFrontendMetadata(metadata);
  }

  async list(): Promise<FrontendMinionMetadata[]> {
    try {
      const minions = await this.config.getAllMinionMetadata();
      return minions.map((w) => this.enrichFrontendMetadata(w));
    } catch (error) {
      log.error("Failed to list minions:", error);
      return [];
    }
  }

  /**
   * Get devcontainer info for deep link generation.
   * Returns null if not a devcontainer minion or container is not running.
   *
   * This queries Docker for the container name (on-demand discovery) and
   * calls ensureReady to get the container minion path.
   */
  async getDevcontainerInfo(minionId: string): Promise<{
    containerName: string;
    containerMinionPath: string;
    hostMinionPath: string;
  } | null> {
    const metadata = await this.getInfo(minionId);
    if (metadata?.runtimeConfig?.type !== "devcontainer") {
      return null;
    }

    const minion = this.config.findMinion(minionId);
    if (!minion) {
      return null;
    }

    // Get the host minion path
    const runtimeConfig = metadata.runtimeConfig;
    const runtime = createRuntime(runtimeConfig, {
      projectPath: metadata.projectPath,
      minionName: metadata.name,
    });

    const hostMinionPath = runtime.getMinionPath(metadata.projectPath, metadata.name);

    // Query Docker for container name (on-demand discovery)
    const containerName = await getDevcontainerContainerName(hostMinionPath);
    if (!containerName) {
      return null; // Container not running
    }

    // Get container minion path via ensureReady (idempotent if already running)
    const readyResult = await runtime.ensureReady();
    if (!readyResult.ready) {
      return null;
    }

    // Access the cached remoteMinionFolder from DevcontainerRuntime
    const devRuntime = runtime as DevcontainerRuntime;
    const containerMinionPath = devRuntime.getRemoteMinionFolder();
    if (!containerMinionPath) {
      return null;
    }

    return { containerName, containerMinionPath, hostMinionPath };
  }
  async getInfo(minionId: string): Promise<FrontendMinionMetadata | null> {
    const allMetadata = await this.config.getAllMinionMetadata();
    const found = allMetadata.find((m) => m.id === minionId) ?? null;
    return this.enrichMaybeFrontendMetadata(found);
  }

  /**
   * Refresh minion metadata from config and emit to subscribers.
   * Useful when external changes (like crew assignment) modify minion config.
   */
  async refreshAndEmitMetadata(minionId: string): Promise<void> {
    const metadata = await this.getInfo(minionId);
    if (metadata) {
      this.emit("metadata", { minionId, metadata });
    }
  }

  async rename(minionId: string, newName: string): Promise<Result<{ newMinionId: string }>> {
    try {
      if (this.aiService.isStreaming(minionId)) {
        return Err(
          "Cannot rename minion while AI stream is active. Please wait for the stream to complete."
        );
      }

      const validation = validateMinionName(newName);
      if (!validation.valid) {
        return Err(validation.error ?? "Invalid minion name");
      }

      // Mark minion as renaming to block new streams during the rename operation
      this.renamingMinions.add(minionId);

      const metadataResult = await this.aiService.getMinionMetadata(minionId);
      if (!metadataResult.success) {
        return Err(`Failed to get minion metadata: ${metadataResult.error}`);
      }
      const oldMetadata = metadataResult.data;
      const oldName = oldMetadata.name;

      if (newName === oldName) {
        return Ok({ newMinionId: minionId });
      }

      const allMinions = await this.config.getAllMinionMetadata();
      const collision = allMinions.find(
        (ws) => (ws.name === newName || ws.id === newName) && ws.id !== minionId
      );
      if (collision) {
        return Err(`Minion with name "${newName}" already exists`);
      }

      const minion = this.config.findMinion(minionId);
      if (!minion) {
        return Err("Failed to find minion in config");
      }
      const { projectPath } = minion;

      const runtime = createRuntime(oldMetadata.runtimeConfig, {
        projectPath,
        minionName: oldName,
      });

      const renameResult = await runtime.renameMinion(projectPath, oldName, newName);

      if (!renameResult.success) {
        return Err(renameResult.error);
      }

      const { oldPath, newPath } = renameResult;

      await this.config.editConfig((config) => {
        const projectConfig = config.projects.get(projectPath);
        if (projectConfig) {
          const minionEntry =
            projectConfig.minions.find((w) => w.id === minionId) ??
            projectConfig.minions.find((w) => w.path === oldPath);
          if (minionEntry) {
            minionEntry.name = newName;
            minionEntry.path = newPath;
          }
        }
        return config;
      });

      // Rename plan file if it exists (uses minion name, not ID)
      await movePlanFile(runtime, oldName, newName, oldMetadata.projectName);

      const allMetadataUpdated = await this.config.getAllMinionMetadata();
      const updatedMetadata = allMetadataUpdated.find((m) => m.id === minionId);
      if (!updatedMetadata) {
        return Err("Failed to retrieve updated minion metadata");
      }

      const enrichedMetadata = this.enrichFrontendMetadata(updatedMetadata);

      const session = this.sessions.get(minionId);
      if (session) {
        session.emitMetadata(enrichedMetadata);
      } else {
        this.emit("metadata", { minionId, metadata: enrichedMetadata });
      }

      return Ok({ newMinionId: minionId });
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to rename minion: ${message}`);
    } finally {
      // Always clear renaming flag, even on error
      this.renamingMinions.delete(minionId);
    }
  }

  /**
   * Update minion title without affecting the filesystem name.
   * Unlike rename(), this can be called even while streaming is active.
   */
  async updateTitle(minionId: string, title: string): Promise<Result<void>> {
    try {
      const minion = this.config.findMinion(minionId);
      if (!minion) {
        return Err("Minion not found");
      }
      const { projectPath, minionPath } = minion;

      await this.config.editConfig((config) => {
        const projectConfig = config.projects.get(projectPath);
        if (projectConfig) {
          const minionEntry =
            projectConfig.minions.find((w) => w.id === minionId) ??
            projectConfig.minions.find((w) => w.path === minionPath);
          if (minionEntry) {
            minionEntry.title = title;
          }
        }
        return config;
      });

      // Emit updated metadata
      const allMetadata = await this.config.getAllMinionMetadata();
      const updatedMetadata = allMetadata.find((m) => m.id === minionId);
      if (updatedMetadata) {
        const enrichedMetadata = this.enrichFrontendMetadata(updatedMetadata);
        const session = this.sessions.get(minionId);
        if (session) {
          session.emitMetadata(enrichedMetadata);
        } else {
          this.emit("metadata", { minionId, metadata: enrichedMetadata });
        }
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to update minion title: ${message}`);
    }
  }

  /**
   * Regenerate the minion title from chat history using AI.
   * Uses the first user message as the durable objective, plus a context block with
   * that first user message and the latest turns, then persists the generated title.
   */
  async regenerateTitle(minionId: string): Promise<Result<{ title: string }>> {
    const historyResult = await this.historyService.getHistoryFromLatestBoundary(minionId);
    if (!historyResult.success) {
      return Err("Could not read minion history");
    }

    let contextTurns = collectMinionTitleContextTurns(historyResult.data);
    let firstUserText = contextTurns.find((turn) => turn.role === "user")?.text;

    if (!firstUserText) {
      // Compaction boundaries can leave the latest epoch with only an assistant summary.
      // Fall back to scanning full history so regenerateTitle still works for compacted chats.
      const fallbackTurns: MinionTitleContextTurn[] = [];
      let fallbackFirstUserText: string | undefined;
      const fullHistoryResult = await this.historyService.iterateFullHistory(
        minionId,
        "forward",
        (messages) => {
          const chunkTurns = collectMinionTitleContextTurns(messages);
          for (const turn of chunkTurns) {
            if (!fallbackFirstUserText && turn.role === "user") {
              fallbackFirstUserText = turn.text;
            }
            fallbackTurns.push(turn);
          }
        }
      );
      if (!fullHistoryResult.success) {
        return Err("Could not read minion history");
      }

      firstUserText = fallbackFirstUserText;
      contextTurns = fallbackTurns;
    }

    if (!firstUserText) {
      return Err("No user messages in minion history");
    }

    const { conversationContext, latestUserText } =
      buildMinionTitleConversationContext(contextTurns);

    const candidates: string[] = [...NAME_GEN_PREFERRED_MODELS];
    const metadataResult = await this.aiService.getMinionMetadata(minionId);
    if (metadataResult.success) {
      const fallbackModels = [
        metadataResult.data.aiSettings?.model,
        ...Object.values(metadataResult.data.aiSettingsByAgent ?? {}).map(
          (settings) => settings.model
        ),
      ];
      for (const model of fallbackModels) {
        if (model && !candidates.includes(model)) {
          candidates.push(model);
        }
      }
    }

    const result = await generateMinionIdentity(
      firstUserText,
      candidates,
      this.aiService,
      conversationContext,
      latestUserText
    );
    if (!result.success) {
      return Err("Title generation failed");
    }

    const updateTitleResult = await this.updateTitle(minionId, result.data.title);
    if (!updateTitleResult.success) {
      return Err(updateTitleResult.error);
    }

    return Ok({ title: result.data.title });
  }

  /**
   * Archive a minion. Archived minions are hidden from the main sidebar
   * but can be viewed on the project page.
   *
   * If init is still running, we abort it before archiving so we don't leave
   * orphaned post-create work running in the background.
   */
  async archive(minionId: string): Promise<Result<void>> {
    if (minionId === LATTICE_HELP_CHAT_MINION_ID) {
      return Err("Cannot archive the Chat with Lattice system minion");
    }

    this.archivingMinions.add(minionId);

    try {
      const minion = this.config.findMinion(minionId);
      if (!minion) {
        return Err("Minion not found");
      }
      const initState = this.initStateManager.getInitState(minionId);
      if (initState?.status === "running") {
        // Archiving should not leave post-create setup running in the background.
        const initAbortController = this.initAbortControllers.get(minionId);
        if (initAbortController) {
          initAbortController.abort();
          this.initAbortControllers.delete(minionId);
        }

        this.initStateManager.clearInMemoryState(minionId);

        // Clearing init state prevents init-end from firing (createInitLogger.logComplete() bails when
        // state is missing). If archiving fails before we persist archivedAt (e.g., beforeArchive hook
        // error), ensure the sidebar doesn't stay stuck on isInitializing/"Cancel creation".
        try {
          const allMetadata = await this.config.getAllMinionMetadata();
          const updatedMetadata = allMetadata.find((m) => m.id === minionId);
          if (updatedMetadata) {
            const enrichedMetadata = this.enrichFrontendMetadata(updatedMetadata);
            const session = this.sessions.get(minionId);
            if (session) {
              session.emitMetadata(enrichedMetadata);
            } else {
              this.emit("metadata", { minionId, metadata: enrichedMetadata });
            }
          }
        } catch (error) {
          log.debug("Failed to emit metadata after init cancellation during archive", {
            minionId,
            error: getErrorMessage(error),
          });
        }
      }

      const { projectPath, minionPath } = minion;

      // Lifecycle hooks run *before* we persist archivedAt.
      //
      // NOTE: Archiving is typically a quick UI action, but it can fail if a hook needs to perform
      // cleanup (e.g., stopping a dedicated lattice-created Lattice minion) and that cleanup fails.
      if (this.minionLifecycleHooks) {
        const metadataResult = await this.aiService.getMinionMetadata(minionId);
        if (!metadataResult.success) {
          return Err(metadataResult.error);
        }

        const hookResult = await this.minionLifecycleHooks.runBeforeArchive({
          minionId,
          minionMetadata: metadataResult.data,
        });
        if (!hookResult.success) {
          return Err(hookResult.error);
        }
      }

      // Archiving removes the minion from the sidebar; ensure we don't leave a stream running
      // "headless" with no obvious UI affordance to interrupt it.
      //
      // NOTE: We only interrupt after beforeArchive hooks succeed, so a hook failure doesn't stop
      // an active stream.
      if (this.aiService.isStreaming(minionId)) {
        const stopResult = await this.interruptStream(minionId);
        if (!stopResult.success) {
          log.debug("Failed to stop stream during minion archive", {
            minionId,
            error: stopResult.error,
          });
        }
      }

      // Archiving hides minion UI; do not leave terminal PTYs running headless.
      this.terminalService?.closeMinionSessions(minionId);

      await this.config.editConfig((config) => {
        const projectConfig = config.projects.get(projectPath);
        if (projectConfig) {
          const minionEntry =
            projectConfig.minions.find((w) => w.id === minionId) ??
            projectConfig.minions.find((w) => w.path === minionPath);
          if (minionEntry) {
            // Just set archivedAt - archived state is derived from archivedAt > unarchivedAt
            minionEntry.archivedAt = new Date().toISOString();
          }
        }
        return config;
      });

      // Emit updated metadata
      const allMetadata = await this.config.getAllMinionMetadata();
      const updatedMetadata = allMetadata.find((m) => m.id === minionId);
      if (updatedMetadata) {
        const enrichedMetadata = this.enrichFrontendMetadata(updatedMetadata);
        const session = this.sessions.get(minionId);
        if (session) {
          session.emitMetadata(enrichedMetadata);
        } else {
          this.emit("metadata", { minionId, metadata: enrichedMetadata });
        }
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to archive minion: ${message}`);
    } finally {
      this.archivingMinions.delete(minionId);
    }
  }

  /**
   * Unarchive a minion. Restores it to the main sidebar view.
   */
  async unarchive(minionId: string): Promise<Result<void>> {
    if (minionId === LATTICE_HELP_CHAT_MINION_ID) {
      return Err("Cannot unarchive the Chat with Lattice system minion");
    }

    try {
      const minion = this.config.findMinion(minionId);
      if (!minion) {
        return Err("Minion not found");
      }
      const { projectPath, minionPath } = minion;

      let didUnarchive = false;

      await this.config.editConfig((config) => {
        const projectConfig = config.projects.get(projectPath);
        if (projectConfig) {
          const minionEntry =
            projectConfig.minions.find((w) => w.id === minionId) ??
            projectConfig.minions.find((w) => w.path === minionPath);
          if (minionEntry) {
            const wasArchived = isMinionArchived(
              minionEntry.archivedAt,
              minionEntry.unarchivedAt
            );
            if (wasArchived) {
              // Just set unarchivedAt - archived state is derived from archivedAt > unarchivedAt.
              // This also bumps minion to top of recency.
              minionEntry.unarchivedAt = new Date().toISOString();
              didUnarchive = true;
            }
          }
        }
        return config;
      });

      // Only run hooks when the minion is transitioning from archived → unarchived.
      if (!didUnarchive) {
        return Ok(undefined);
      }

      // Emit updated metadata
      const allMetadata = await this.config.getAllMinionMetadata();
      const updatedMetadata = allMetadata.find((m) => m.id === minionId);
      if (updatedMetadata) {
        const enrichedMetadata = this.enrichFrontendMetadata(updatedMetadata);
        const session = this.sessions.get(minionId);
        if (session) {
          session.emitMetadata(enrichedMetadata);
        } else {
          this.emit("metadata", { minionId, metadata: enrichedMetadata });
        }
      }

      // Lifecycle hooks run *after* we persist unarchivedAt.
      //
      // Why best-effort: Unarchive is a quick UI action and should not fail permanently due to a
      // start error (e.g., Lattice minion start).
      if (this.minionLifecycleHooks) {
        let hookMetadata: MinionMetadata | undefined = updatedMetadata;
        if (!hookMetadata) {
          const metadataResult = await this.aiService.getMinionMetadata(minionId);
          if (metadataResult.success) {
            hookMetadata = metadataResult.data;
          } else {
            log.debug("Failed to load minion metadata for afterUnarchive hooks", {
              minionId,
              error: metadataResult.error,
            });
          }
        }

        if (hookMetadata) {
          await this.minionLifecycleHooks.runAfterUnarchive({
            minionId,
            minionMetadata: hookMetadata,
          });
        }
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to unarchive minion: ${message}`);
    }
  }

  /**
   * Archive all non-archived minions within a project whose GitHub PR is merged.
   *
   * This is intended for a single command-palette action (one backend call), to avoid
   * O(n) frontend→backend loops.
   */
  async archiveMergedInProject(projectPath: string): Promise<Result<ArchiveMergedInProjectResult>> {
    const targetProjectPath = projectPath.trim();
    if (!targetProjectPath) {
      return Err("projectPath is required");
    }

    const archivedMinionIds: string[] = [];
    const skippedMinionIds: string[] = [];
    const errors: Array<{ minionId: string; error: string }> = [];

    try {
      const allMetadata = await this.config.getAllMinionMetadata();

      const candidates = allMetadata.filter((metadata) => {
        if (metadata.id === LATTICE_HELP_CHAT_MINION_ID) {
          return false;
        }
        if (metadata.projectPath !== targetProjectPath) {
          return false;
        }
        return !isMinionArchived(metadata.archivedAt, metadata.unarchivedAt);
      });

      const mergedMinionIds: string[] = [];

      const GH_CONCURRENCY_LIMIT = 4;
      const GH_TIMEOUT_SECS = 15;

      await forEachWithConcurrencyLimit(candidates, GH_CONCURRENCY_LIMIT, async (metadata) => {
        const minionId = metadata.id;

        try {
          const result = await this.executeBash(
            minionId,
            `gh pr view --json state 2>/dev/null || echo '{"no_pr":true}'`,
            { timeout_secs: GH_TIMEOUT_SECS }
          );

          if (!result.success) {
            errors.push({ minionId, error: result.error });
            return;
          }

          if (!result.data.success) {
            errors.push({ minionId, error: result.data.error });
            return;
          }

          const output = result.data.output;
          if (!output || output.trim().length === 0) {
            errors.push({ minionId, error: "gh pr view returned empty output" });
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(output);
          } catch (error) {
            const message = getErrorMessage(error);
            errors.push({ minionId, error: `Failed to parse gh output: ${message}` });
            return;
          }

          if (typeof parsed !== "object" || parsed === null) {
            errors.push({ minionId, error: "Unexpected gh output: not a JSON object" });
            return;
          }

          const record = parsed as Record<string, unknown>;

          if ("no_pr" in record) {
            skippedMinionIds.push(minionId);
            return;
          }

          if (record.state === "MERGED") {
            mergedMinionIds.push(minionId);
            return;
          }

          skippedMinionIds.push(minionId);
        } catch (error) {
          const message = getErrorMessage(error);
          errors.push({ minionId, error: message });
        }
      });

      // Archive sequentially: config.editConfig is not mutex-protected.
      for (const minionId of mergedMinionIds) {
        const result = await this.archive(minionId);
        if (!result.success) {
          errors.push({ minionId, error: result.error });
          continue;
        }
        archivedMinionIds.push(minionId);
      }

      archivedMinionIds.sort();
      skippedMinionIds.sort();
      errors.sort((a, b) => a.minionId.localeCompare(b.minionId));

      return Ok({
        archivedMinionIds,
        skippedMinionIds,
        errors,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to archive merged minions: ${message}`);
    }
  }

  private normalizeMinionAISettings(
    aiSettings: MinionAISettings
  ): Result<MinionAISettings, string> {
    const rawModel = aiSettings.model;
    const model = rawModel.trim();
    if (!model) {
      return Err("Model is required");
    }
    if (!isValidModelFormat(model)) {
      return Err(`Invalid model format: ${rawModel}`);
    }

    return Ok({
      model,
      thinkingLevel: aiSettings.thinkingLevel,
    });
  }

  private normalizeSendMessageAgentId(options: SendMessageOptions): SendMessageOptions {
    // agentId is required by the schema, so this just normalizes the value.
    const rawAgentId = options.agentId;
    const normalizedAgentId =
      typeof rawAgentId === "string" && rawAgentId.trim().length > 0
        ? rawAgentId.trim().toLowerCase()
        : MINION_DEFAULTS.agentId;

    if (normalizedAgentId === options.agentId) {
      return options;
    }

    return {
      ...options,
      agentId: normalizedAgentId,
    };
  }

  private extractMinionAISettingsFromSendOptions(
    options: SendMessageOptions | undefined
  ): MinionAISettings | null {
    const rawModel = options?.model;
    if (typeof rawModel !== "string" || rawModel.trim().length === 0) {
      return null;
    }

    const model = rawModel.trim();
    if (!isValidModelFormat(model)) {
      return null;
    }

    const requestedThinking = options?.thinkingLevel;
    // Be defensive: if a (very) old client doesn't send thinkingLevel, don't overwrite
    // any existing minion-scoped value.
    if (requestedThinking === undefined) {
      return null;
    }

    const thinkingLevel = requestedThinking;

    return { model, thinkingLevel };
  }

  /**
   * Best-effort persist AI settings from send/resume options.
   * Skips requests explicitly marked to avoid persistence.
   */
  private async maybePersistAISettingsFromOptions(
    minionId: string,
    options: SendMessageOptions | undefined,
    context: "send" | "resume"
  ): Promise<void> {
    if (options?.skipAiSettingsPersistence) {
      // One-shot/compaction sends shouldn't overwrite minion defaults.
      return;
    }

    const extractedSettings = this.extractMinionAISettingsFromSendOptions(options);
    if (!extractedSettings) return;

    const rawAgentId = options?.agentId;
    const agentId =
      typeof rawAgentId === "string" && rawAgentId.trim().length > 0
        ? rawAgentId.trim().toLowerCase()
        : MINION_DEFAULTS.agentId;

    const persistResult = await this.persistMinionAISettingsForAgent(
      minionId,
      agentId,
      extractedSettings,
      {
        emitMetadata: false,
      }
    );
    if (!persistResult.success) {
      log.debug(`Failed to persist minion AI settings from ${context} options`, {
        minionId,
        error: persistResult.error,
      });
    }
  }

  private async persistMinionAISettingsForAgent(
    minionId: string,
    agentId: string,
    aiSettings: MinionAISettings,
    options?: { emitMetadata?: boolean }
  ): Promise<Result<boolean, string>> {
    const found = this.config.findMinion(minionId);
    if (!found) {
      return Err("Minion not found");
    }

    const { projectPath, minionPath } = found;

    const config = this.config.loadConfigOrDefault();
    const projectConfig = config.projects.get(projectPath);
    if (!projectConfig) {
      return Err(`Project not found: ${projectPath}`);
    }

    const minionEntry = projectConfig.minions.find((w) => w.id === minionId);
    const minionEntryWithFallback =
      minionEntry ?? projectConfig.minions.find((w) => w.path === minionPath);
    if (!minionEntryWithFallback) {
      return Err("Minion not found");
    }

    const normalizedAgentId = agentId.trim().toLowerCase();
    if (!normalizedAgentId) {
      return Err("Agent ID is required");
    }

    const prev = minionEntryWithFallback.aiSettingsByAgent?.[normalizedAgentId];
    const changed =
      prev?.model !== aiSettings.model || prev?.thinkingLevel !== aiSettings.thinkingLevel;
    if (!changed) {
      return Ok(false);
    }

    minionEntryWithFallback.aiSettingsByAgent = {
      ...(minionEntryWithFallback.aiSettingsByAgent ?? {}),
      [normalizedAgentId]: aiSettings,
    };

    await this.config.saveConfig(config);

    if (options?.emitMetadata !== false) {
      const allMetadata = await this.config.getAllMinionMetadata();
      const updatedMetadata = allMetadata.find((m) => m.id === minionId) ?? null;
      const enrichedMetadata = this.enrichMaybeFrontendMetadata(updatedMetadata);

      const session = this.sessions.get(minionId);
      if (session) {
        session.emitMetadata(enrichedMetadata);
      } else {
        this.emit("metadata", { minionId, metadata: enrichedMetadata });
      }
    }

    return Ok(true);
  }

  async updateModeAISettings(
    minionId: string,
    mode: UIMode,
    aiSettings: MinionAISettings
  ): Promise<Result<void, string>> {
    // Mode-based updates use mode as the agentId.
    return this.updateAgentAISettings(minionId, mode, aiSettings);
  }

  async updateAgentAISettings(
    minionId: string,
    agentId: string,
    aiSettings: MinionAISettings
  ): Promise<Result<void, string>> {
    try {
      const normalized = this.normalizeMinionAISettings(aiSettings);
      if (!normalized.success) {
        return Err(normalized.error);
      }

      const persistResult = await this.persistMinionAISettingsForAgent(
        minionId,
        agentId,
        normalized.data,
        {
          emitMetadata: true,
        }
      );
      if (!persistResult.success) {
        return Err(persistResult.error);
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to update minion AI settings: ${message}`);
    }
  }

  async fork(
    sourceMinionId: string,
    newName?: string
  ): Promise<Result<{ metadata: FrontendMinionMetadata; projectPath: string }>> {
    try {
      if (sourceMinionId === LATTICE_HELP_CHAT_MINION_ID) {
        return Err("Cannot fork the Chat with Lattice system minion");
      }

      if (this.aiService.isStreaming(sourceMinionId)) {
        await this.historyService.commitPartial(sourceMinionId);
      }

      const sourceMetadataResult = await this.aiService.getMinionMetadata(sourceMinionId);
      if (!sourceMetadataResult.success) {
        return Err(`Failed to get source minion metadata: ${sourceMetadataResult.error}`);
      }
      const sourceMetadata = sourceMetadataResult.data;
      const foundProjectPath = sourceMetadata.projectPath;
      const projectName = sourceMetadata.projectName;
      const sourceRuntimeConfig = sourceMetadata.runtimeConfig;

      // Policy: do not allow creating new minions (including via fork) with a disallowed runtime.
      if (this.policyService?.isEnforced()) {
        if (!this.policyService.isRuntimeAllowed(sourceRuntimeConfig)) {
          return Err("Cloning this minion is not allowed by policy (runtime disabled)");
        }
      }

      // Auto-generate branch name (and title) when user omits one (seamless fork).
      // Uses pattern: {parentName}-fork-{N} for branch, "{parentTitle} (N)" for title.
      const isAutoName = newName == null;
      // Fetch all metadata upfront for both branch name and title collision checks.
      const allMetadata = isAutoName ? await this.config.getAllMinionMetadata() : [];
      let resolvedName: string;
      if (isAutoName) {
        const existingNamesSet = new Set(
          allMetadata.filter((m) => m.projectPath === foundProjectPath).map((m) => m.name)
        );
        // Also include local branch names to avoid silently reusing stale branches that
        // were left behind on disk but no longer exist in config metadata.
        try {
          for (const branchName of await listLocalBranches(foundProjectPath)) {
            existingNamesSet.add(branchName);
          }
        } catch (error) {
          log.debug("Failed to list local branches for fork auto-name preflight", {
            projectPath: foundProjectPath,
            error: getErrorMessage(error),
          });
        }

        const existingNames = [...existingNamesSet];
        resolvedName = generateForkBranchName(sourceMetadata.name, existingNames);

        if (!validateMinionName(resolvedName).valid) {
          // Legacy minion names can violate current naming rules (invalid
          // chars / length). Normalize and shrink the parent base until the
          // generated fork name satisfies current invariants.
          let normalizedParent = sourceMetadata.name
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^[-_]+|[-_]+$/g, "");

          if (!normalizedParent) {
            normalizedParent = "minion";
          }

          let candidateParent = normalizedParent;
          while (candidateParent.length > 1) {
            resolvedName = generateForkBranchName(candidateParent, existingNames);
            if (validateMinionName(resolvedName).valid) {
              break;
            }
            candidateParent = candidateParent.slice(0, -1);
          }

          if (!validateMinionName(resolvedName).valid) {
            resolvedName = generateForkBranchName(candidateParent, existingNames);
          }
        }
      } else {
        resolvedName = newName;
      }

      const resolvedNameValidation = validateMinionName(resolvedName);
      if (!resolvedNameValidation.valid) {
        return Err(resolvedNameValidation.error ?? "Invalid minion name");
      }

      const sourceRuntime = createRuntime(sourceRuntimeConfig, {
        projectPath: foundProjectPath,
        minionName: sourceMetadata.name,
      });

      const newMinionId = this.config.generateStableId();

      const session = this.getOrCreateSession(newMinionId);
      this.initStateManager.startInit(newMinionId, foundProjectPath);
      const initLogger = this.createInitLogger(newMinionId);

      const initAbortController = new AbortController();
      this.initAbortControllers.set(newMinionId, initAbortController);

      let forkResult: Awaited<ReturnType<typeof orchestrateFork>>;
      try {
        forkResult = await orchestrateFork({
          sourceRuntime,
          projectPath: foundProjectPath,
          sourceMinionName: sourceMetadata.name,
          newMinionName: resolvedName,
          initLogger,
          config: this.config,
          sourceMinionId,
          sourceRuntimeConfig,
          allowCreateFallback: false,
          abortSignal: initAbortController.signal,
        });
      } catch (error) {
        // Guarantee init lifecycle cleanup when orchestrateFork rejects.
        // initLogger.logComplete deletes from initAbortControllers and ends init state.
        initLogger.logComplete(-1);
        throw error;
      }

      if (!forkResult.success) {
        initLogger.logComplete(-1);
        return Err(forkResult.error);
      }

      const {
        minionPath,
        trunkBranch,
        forkedRuntimeConfig,
        targetRuntime,
        sourceRuntimeConfigUpdate,
        sourceRuntimeConfigUpdated,
      } = forkResult.data;

      // Run init for forked minion (fire-and-forget like create())
      const secrets = secretsToRecord(this.config.getEffectiveSecrets(foundProjectPath));
      runBackgroundInit(
        targetRuntime,
        {
          projectPath: foundProjectPath,
          branchName: resolvedName,
          trunkBranch,
          minionPath,
          initLogger,
          env: secrets,
          abortSignal: initAbortController.signal,
        },
        newMinionId,
        log
      );

      const sourceSessionDir = this.config.getSessionDir(sourceMinionId);
      const newSessionDir = this.config.getSessionDir(newMinionId);

      try {
        await fsPromises.mkdir(newSessionDir, { recursive: true });

        const sessionFiles = [
          "chat.jsonl",
          "partial.json",
          "session-timing.json",
          "session-usage.json",
        ] as const;
        for (const fileName of sessionFiles) {
          await copyIfExists(
            path.join(sourceSessionDir, fileName),
            path.join(newSessionDir, fileName)
          );
        }
      } catch (copyError) {
        await targetRuntime.deleteMinion(foundProjectPath, resolvedName, true);
        try {
          await fsPromises.rm(newSessionDir, { recursive: true, force: true });
        } catch (cleanupError) {
          log.error(`Failed to clean up session dir ${newSessionDir}:`, cleanupError);
        }
        initLogger.logComplete(-1);
        const message = getErrorMessage(copyError);
        return Err(`Failed to copy chat history: ${message}`);
      }

      // Copy plan file using explicit source/target runtimes for cross-runtime safety.
      // Create a fresh source runtime handle because DockerRuntime.forkMinion() can
      // mutate the original runtime's container identity to target the new minion.
      const freshSourceRuntime = createRuntime(sourceRuntimeConfig, {
        projectPath: foundProjectPath,
        minionName: sourceMetadata.name,
      });
      await copyPlanFileAcrossRuntimes(
        freshSourceRuntime,
        targetRuntime,
        sourceMetadata.name,
        sourceMinionId,
        resolvedName,
        projectName
      );

      if (sourceRuntimeConfigUpdate) {
        await this.config.updateMinionMetadata(sourceMinionId, {
          runtimeConfig: sourceRuntimeConfigUpdate,
        });
      }

      if (sourceRuntimeConfigUpdated) {
        const allMetadataUpdated = await this.config.getAllMinionMetadata();
        const updatedMetadata = allMetadataUpdated.find((m) => m.id === sourceMinionId) ?? null;
        const enrichedMetadata = this.enrichMaybeFrontendMetadata(updatedMetadata);
        const sourceSession = this.sessions.get(sourceMinionId);
        if (sourceSession) {
          sourceSession.emitMetadata(enrichedMetadata);
        } else {
          this.emit("metadata", { minionId: sourceMinionId, metadata: enrichedMetadata });
        }
      }

      // Compute namedMinionPath for frontend metadata
      const namedMinionPath = targetRuntime.getMinionPath(foundProjectPath, resolvedName);

      const metadata: FrontendMinionMetadata = {
        id: newMinionId,
        name: resolvedName,
        projectName,
        projectPath: foundProjectPath,
        createdAt: new Date().toISOString(),
        runtimeConfig: forkedRuntimeConfig,
        namedMinionPath,
        // Preserve minion organization when forking via /fork.
        crewId: sourceMetadata.crewId,
        // Seamless fork: generate a numbered title like "Parent Title (1)".
        ...(isAutoName
          ? {
              title: generateForkTitle(
                sourceMetadata.title ?? sourceMetadata.name,
                allMetadata
                  .filter((m) => m.projectPath === foundProjectPath)
                  .map((m) => m.title ?? m.name)
              ),
            }
          : {}),
      };

      await this.config.addMinion(foundProjectPath, metadata);

      const enrichedMetadata = this.enrichFrontendMetadata(metadata);
      session.emitMetadata(enrichedMetadata);

      return Ok({ metadata: enrichedMetadata, projectPath: foundProjectPath });
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to clone minion: ${message}`);
    }
  }

  async sendMessage(
    minionId: string,
    message: string,
    options: SendMessageOptions & {
      fileParts?: FilePart[];
    },
    internal?: {
      allowQueuedAgentTask?: boolean;
      skipAutoResumeReset?: boolean;
      synthetic?: boolean;
      /** When true, reject instead of queueing if the minion is busy. */
      requireIdle?: boolean;
    }
  ): Promise<Result<void, SendMessageError>> {
    log.debug("sendMessage handler: Received", {
      minionId,
      messagePreview: message.substring(0, 50),
      agentId: options?.agentId,
      options,
    });

    let resumedInterruptedTask = false;
    try {
      // Block streaming while minion is being renamed to prevent path conflicts
      if (this.renamingMinions.has(minionId)) {
        log.debug("sendMessage blocked: minion is being renamed", { minionId });
        return Err({
          type: "unknown",
          raw: "Minion is being renamed. Please wait and try again.",
        });
      }

      // Block streaming while minion is being removed to prevent races with config/session deletion.
      if (this.removingMinions.has(minionId)) {
        log.debug("sendMessage blocked: minion is being removed", { minionId });
        return Err({
          type: "unknown",
          raw: "Minion is being deleted. Please wait and try again.",
        });
      }

      // Guard: avoid creating sessions for minions that don't exist anymore.
      if (!this.config.findMinion(minionId)) {
        return Err({
          type: "unknown",
          raw: "Minion not found. It may have been deleted.",
        });
      }

      // Guard: queued agent tasks must not start streaming via generic sendMessage calls.
      // They should only be started by TaskService once a parallel slot is available.
      if (!internal?.allowQueuedAgentTask) {
        const config = this.config.loadConfigOrDefault();
        for (const [_projectPath, project] of config.projects) {
          const ws = project.minions.find((w) => w.id === minionId);
          if (!ws) continue;
          if (ws.parentMinionId && ws.taskStatus === "queued") {
            taskQueueDebug("MinionService.sendMessage blocked (queued task)", {
              minionId,
              stack: new Error("sendMessage blocked").stack,
            });
            return Err({
              type: "unknown",
              raw: "This agent task is queued and cannot start yet. Wait for a slot to free.",
            });
          }
          break;
        }
      } else {
        taskQueueDebug("MinionService.sendMessage allowed (internal dequeue)", {
          minionId,
          stack: new Error("sendMessage internal").stack,
        });
      }

      const session = this.getOrCreateSession(minionId);

      // Skip recency update for idle compaction - preserve original "last used" time
      const latticeMeta = options?.latticeMetadata as { type?: string; source?: string } | undefined;
      const isIdleCompaction =
        latticeMeta?.type === "compaction-request" && latticeMeta?.source === "idle-compaction";
      // Use current time for recency - this matches the timestamp used on the message
      // in agentSession.sendMessage(). Keeps ExtensionMetadata in sync with chat.jsonl.
      const messageTimestamp = Date.now();
      if (!isIdleCompaction) {
        void this.updateRecencyTimestamp(minionId, messageTimestamp);
      }

      // Experiments: resolve flags respecting userOverridable setting.
      // - If userOverridable && frontend provides a value (explicit override) → use frontend value
      // - Else if remote evaluation enabled → use PostHog assignment
      // - Else → use frontend value (dev fallback) or default
      const system1Experiment = EXPERIMENTS[EXPERIMENT_IDS.SYSTEM_1];
      const system1FrontendValue = options?.experiments?.system1;

      let system1Enabled: boolean | undefined;
      if (system1Experiment.userOverridable && system1FrontendValue !== undefined) {
        // User-overridable: trust frontend value (user's explicit choice)
        system1Enabled = system1FrontendValue;
      } else if (this.experimentsService?.isRemoteEvaluationEnabled() === true) {
        // Remote evaluation: use PostHog assignment
        system1Enabled = this.experimentsService.isExperimentEnabled(EXPERIMENT_IDS.SYSTEM_1);
      } else {
        // Fallback to frontend value (dev mode or telemetry disabled)
        system1Enabled = system1FrontendValue;
      }

      const resolvedExperiments: Record<string, boolean> = {};
      if (system1Enabled !== undefined) {
        resolvedExperiments.system1 = system1Enabled;
      }

      const resolvedOptions =
        Object.keys(resolvedExperiments).length === 0
          ? options
          : {
              ...options,
              experiments: {
                ...(options.experiments ?? {}),
                ...resolvedExperiments,
              },
            };

      const normalizedOptions = this.normalizeSendMessageAgentId(resolvedOptions);

      // Persist last-used model + thinking level for cross-device consistency.
      await this.maybePersistAISettingsFromOptions(minionId, normalizedOptions, "send");

      const shouldQueue = !normalizedOptions?.editMessageId && session.isBusy();

      if (shouldQueue) {
        const taskStatus = this.taskService?.getAgentTaskStatus?.(minionId);
        if (taskStatus === "interrupted") {
          return Err({
            type: "unknown",
            raw: "Interrupted task is still winding down. Wait until it is idle, then try again.",
          });
        }

        if (internal?.requireIdle) {
          return Err({
            type: "unknown",
            raw: "Minion is busy; idle-only send was skipped.",
          });
        }

        const pendingAskUserQuestion = askUserQuestionManager.getLatestPending(minionId);
        if (pendingAskUserQuestion) {
          try {
            askUserQuestionManager.cancel(
              minionId,
              pendingAskUserQuestion.toolCallId,
              "User responded in chat; questions canceled"
            );
          } catch (error) {
            log.debug("Failed to cancel pending ask_user_question", {
              minionId,
              toolCallId: pendingAskUserQuestion.toolCallId,
              error: getErrorMessage(error),
            });
          }
        }

        session.queueMessage(message, normalizedOptions, {
          synthetic: internal?.synthetic,
        });
        return Ok(undefined);
      }

      if (!internal?.skipAutoResumeReset) {
        this.taskService?.resetAutoResumeCount(minionId);
      }

      // Non-destructive interrupt cascades preserve descendant task minions with
      // taskStatus=interrupted. Transition before starting a new stream so TaskService
      // stream-end handling does not early-return on interrupted status.
      try {
        resumedInterruptedTask =
          (await this.taskService?.markInterruptedTaskRunning?.(minionId)) ?? false;
      } catch (error: unknown) {
        log.error("Failed to restore interrupted task status before sendMessage", {
          minionId,
          error,
        });
      }

      const result = await session.sendMessage(message, normalizedOptions, {
        synthetic: internal?.synthetic,
      });
      if (!result.success) {
        log.error("sendMessage handler: session returned error", {
          minionId,
          error: result.error,
        });

        if (resumedInterruptedTask) {
          try {
            await this.taskService?.restoreInterruptedTaskAfterResumeFailure?.(minionId);
          } catch (error: unknown) {
            log.error("Failed to restore interrupted task status after sendMessage failure", {
              minionId,
              error,
            });
          }
        }

        return result;
      }

      return result;
    } catch (error) {
      if (resumedInterruptedTask) {
        try {
          await this.taskService?.restoreInterruptedTaskAfterResumeFailure?.(minionId);
        } catch (restoreError: unknown) {
          log.error("Failed to restore interrupted task status after sendMessage throw", {
            minionId,
            error: restoreError,
          });
        }
      }

      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error, null, 2);
      log.error("Unexpected error in sendMessage handler:", error);

      // Handle incompatible minion errors from downgraded configs
      if (error instanceof IncompatibleRuntimeError) {
        const sendError: SendMessageError = {
          type: "incompatible_minion",
          message: error.message,
        };
        return Err(sendError);
      }

      const sendError: SendMessageError = {
        type: "unknown",
        raw: `Failed to send message: ${errorMessage}`,
      };
      return Err(sendError);
    }
  }

  async resumeStream(
    minionId: string,
    options: SendMessageOptions,
    internal?: { allowQueuedAgentTask?: boolean }
  ): Promise<Result<{ started: boolean }, SendMessageError>> {
    let resumedInterruptedTask = false;
    try {
      // Block streaming while minion is being renamed to prevent path conflicts
      if (this.renamingMinions.has(minionId)) {
        log.debug("resumeStream blocked: minion is being renamed", { minionId });
        return Err({
          type: "unknown",
          raw: "Minion is being renamed. Please wait and try again.",
        });
      }

      // Block streaming while minion is being removed to prevent races with config/session deletion.
      if (this.removingMinions.has(minionId)) {
        log.debug("resumeStream blocked: minion is being removed", { minionId });
        return Err({
          type: "unknown",
          raw: "Minion is being deleted. Please wait and try again.",
        });
      }

      // Guard: avoid creating sessions for minions that don't exist anymore.
      if (!this.config.findMinion(minionId)) {
        return Err({
          type: "unknown",
          raw: "Minion not found. It may have been deleted.",
        });
      }

      // Guard: queued agent tasks must not be resumed by generic UI/API calls.
      // TaskService is responsible for dequeuing and starting them.
      if (!internal?.allowQueuedAgentTask) {
        const config = this.config.loadConfigOrDefault();
        for (const [_projectPath, project] of config.projects) {
          const ws = project.minions.find((w) => w.id === minionId);
          if (!ws) continue;
          if (ws.parentMinionId && ws.taskStatus === "queued") {
            taskQueueDebug("MinionService.resumeStream blocked (queued task)", {
              minionId,
              stack: new Error("resumeStream blocked").stack,
            });
            return Err({
              type: "unknown",
              raw: "This agent task is queued and cannot start yet. Wait for a slot to free.",
            });
          }
          break;
        }
      } else {
        taskQueueDebug("MinionService.resumeStream allowed (internal dequeue)", {
          minionId,
          stack: new Error("resumeStream internal").stack,
        });
      }

      const session = this.getOrCreateSession(minionId);

      const taskStatus = this.taskService?.getAgentTaskStatus?.(minionId);
      if (taskStatus === "interrupted" && session.isBusy()) {
        return Err({
          type: "unknown",
          raw: "Interrupted task is still winding down. Wait until it is idle, then try again.",
        });
      }

      const normalizedOptions = this.normalizeSendMessageAgentId(options);

      // Persist last-used model + thinking level for cross-device consistency.
      await this.maybePersistAISettingsFromOptions(minionId, normalizedOptions, "resume");

      // Non-destructive interrupt cascades preserve descendant task minions with
      // taskStatus=interrupted. Transition before stream start so TaskService stream-end
      // handling does not early-return on interrupted status.
      try {
        resumedInterruptedTask =
          (await this.taskService?.markInterruptedTaskRunning?.(minionId)) ?? false;
      } catch (error: unknown) {
        log.error("Failed to restore interrupted task status before resumeStream", {
          minionId,
          error,
        });
      }

      const result = await session.resumeStream(normalizedOptions);
      if (!result.success) {
        log.error("resumeStream handler: session returned error", {
          minionId,
          error: result.error,
        });
        if (resumedInterruptedTask) {
          try {
            await this.taskService?.restoreInterruptedTaskAfterResumeFailure?.(minionId);
          } catch (error: unknown) {
            log.error("Failed to restore interrupted task status after resumeStream failure", {
              minionId,
              error,
            });
          }
        }
        return result;
      }

      // resumeStream can succeed without starting a new stream when the session is
      // still busy (started=false). Keep interrupted semantics in that case.
      if (!result.data.started) {
        if (resumedInterruptedTask) {
          try {
            await this.taskService?.restoreInterruptedTaskAfterResumeFailure?.(minionId);
          } catch (error: unknown) {
            log.error("Failed to restore interrupted task status after no-op resumeStream", {
              minionId,
              error,
            });
          }
        }
        return result;
      }

      return result;
    } catch (error) {
      if (resumedInterruptedTask) {
        try {
          await this.taskService?.restoreInterruptedTaskAfterResumeFailure?.(minionId);
        } catch (restoreError: unknown) {
          log.error("Failed to restore interrupted task status after resumeStream throw", {
            minionId,
            error: restoreError,
          });
        }
      }

      const errorMessage = getErrorMessage(error);
      log.error("Unexpected error in resumeStream handler:", error);

      // Handle incompatible minion errors from downgraded configs
      if (error instanceof IncompatibleRuntimeError) {
        const sendError: SendMessageError = {
          type: "incompatible_minion",
          message: error.message,
        };
        return Err(sendError);
      }

      const sendError: SendMessageError = {
        type: "unknown",
        raw: `Failed to resume stream: ${errorMessage}`,
      };
      return Err(sendError);
    }
  }

  async setAutoRetryEnabled(
    minionId: string,
    enabled: boolean,
    persist = true
  ): Promise<Result<{ previousEnabled: boolean; enabled: boolean }>> {
    try {
      const session = this.getOrCreateSession(minionId);
      const state = await session.setAutoRetryEnabled(enabled, { persist });
      return Ok(state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Unexpected error in setAutoRetryEnabled handler:", error);
      return Err(`Failed to set auto-retry enabled state: ${errorMessage}`);
    }
  }

  async getStartupAutoRetryModel(minionId: string): Promise<Result<string | null>> {
    try {
      const session = this.getOrCreateSession(minionId);
      const model = await session.getStartupAutoRetryModelHint();
      return Ok(model);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Unexpected error in getStartupAutoRetryModel handler:", error);
      return Err(`Failed to inspect startup auto-retry model: ${errorMessage}`);
    }
  }

  setAutoCompactionThreshold(minionId: string, threshold: number): Result<void> {
    try {
      const session = this.getOrCreateSession(minionId);
      session.setAutoCompactionThreshold(threshold);
      return Ok(undefined);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("Unexpected error in setAutoCompactionThreshold handler:", error);
      return Err(`Failed to set auto-compaction threshold: ${errorMessage}`);
    }
  }

  async interruptStream(
    minionId: string,
    options?: { soft?: boolean; abandonPartial?: boolean; sendQueuedImmediately?: boolean }
  ): Promise<Result<void>> {
    try {
      this.taskService?.resetAutoResumeCount(minionId);
      if (!options?.soft) {
        // Mark before attempting the session interrupt to close races where a child
        // could report between stop initiation and descendant cascade termination.
        this.taskService?.markParentMinionInterrupted(minionId);
      }

      const session = this.getOrCreateSession(minionId);
      const stopResult = await session.interruptStream(options);
      if (!stopResult.success) {
        // Interrupt failed, so clear hard-interrupt suppression we set above.
        if (!options?.soft) {
          this.taskService?.resetAutoResumeCount(minionId);
        }
        log.error("Failed to stop stream:", stopResult.error);
        return Err(stopResult.error);
      }

      // For hard interrupts, delete partial immediately. For soft interrupts,
      // defer to stream-abort handler (stream is still running and may recreate partial).
      if (options?.abandonPartial && !options?.soft) {
        log.debug("Abandoning partial for minion:", minionId);
        await this.historyService.deletePartial(minionId);
      }

      // Rationale: user-initiated hard interrupts should stop the entire task tree so
      // descendant sidekicks cannot finish later and auto-resume this minion.
      if (!options?.soft) {
        try {
          const interruptedTaskIds =
            await this.taskService?.terminateAllDescendantAgentTasks?.(minionId);
          if (interruptedTaskIds && interruptedTaskIds.length > 0) {
            log.debug("Cascade-interrupted descendant tasks on interrupt", {
              minionId,
              interruptedTaskIds,
            });
          }
        } catch (error: unknown) {
          log.error("Failed to cascade-interrupt descendant tasks on interrupt", {
            minionId,
            error,
          });
        }
      }

      // Handle queued messages based on option
      if (options?.sendQueuedImmediately) {
        // `sendQueuedMessages()` routes through AgentSession directly, so explicitly
        // clear hard-interrupt suppression first (it won't flow through sendMessage()).
        this.taskService?.resetAutoResumeCount(minionId);
        // Send queued messages immediately instead of restoring to input
        session.sendQueuedMessages();
      } else {
        // Restore queued messages to input box for user-initiated interrupts
        session.restoreQueueToInput();
      }

      return Ok(undefined);
    } catch (error) {
      if (!options?.soft) {
        // Keep suppression state consistent if interrupt setup/stop throws.
        this.taskService?.resetAutoResumeCount(minionId);
      }
      const errorMessage = getErrorMessage(error);
      log.error("Unexpected error in interruptStream handler:", error);
      return Err(`Failed to interrupt stream: ${errorMessage}`);
    }
  }

  async answerAskUserQuestion(
    minionId: string,
    toolCallId: string,
    answers: Record<string, string>
  ): Promise<Result<void>> {
    try {
      // Fast path: normal in-memory execution (stream still running, tool is awaiting input).
      askUserQuestionManager.answer(minionId, toolCallId, answers);
      return Ok(undefined);
    } catch (error) {
      // Fallback path: app restart (or other process death) means the in-memory
      // AskUserQuestionManager has no pending entry anymore.
      //
      // In that case we persist the tool result into partial.json or chat.jsonl,
      // then emit a synthetic tool-call-end so the renderer updates immediately.
      try {
        // Helper: update a message in-place if it contains this ask_user_question tool call.
        const tryFinalizeMessage = (
          msg: LatticeMessage
        ): Result<{ updated: LatticeMessage; output: AskUserQuestionToolSuccessResult }> => {
          let foundToolCall = false;
          let output: AskUserQuestionToolSuccessResult | null = null;
          let errorMessage: string | null = null;

          const updatedParts = msg.parts.map((part) => {
            if (!isDynamicToolPart(part) || part.toolCallId !== toolCallId) {
              return part;
            }

            foundToolCall = true;

            if (part.toolName !== "ask_user_question") {
              errorMessage = `toolCallId=${toolCallId} is toolName=${part.toolName}, expected ask_user_question`;
              return part;
            }

            // Already answered - treat as idempotent.
            if (part.state === "output-available") {
              const parsedOutput = AskUserQuestionToolResultSchema.safeParse(part.output);
              if (!parsedOutput.success) {
                errorMessage = `ask_user_question output validation failed: ${parsedOutput.error.message}`;
                return part;
              }
              output = parsedOutput.data;
              return part;
            }

            const parsedArgs = AskUserQuestionToolArgsSchema.safeParse(part.input);
            if (!parsedArgs.success) {
              errorMessage = `ask_user_question input validation failed: ${parsedArgs.error.message}`;
              return part;
            }

            const nextOutput: AskUserQuestionToolSuccessResult = {
              summary: buildAskUserQuestionSummary(answers),
              ui_only: {
                ask_user_question: {
                  questions: parsedArgs.data.questions,
                  answers,
                },
              },
            };
            output = nextOutput;

            return {
              ...part,
              state: "output-available" as const,
              output: nextOutput,
            };
          });

          if (errorMessage) {
            return Err(errorMessage);
          }
          if (!foundToolCall) {
            return Err("ask_user_question toolCallId not found in message");
          }
          if (!output) {
            return Err("ask_user_question output missing after update");
          }

          return Ok({ updated: { ...msg, parts: updatedParts }, output });
        };

        // 1) Prefer partial.json (most common after restart while waiting)
        const partial = await this.historyService.readPartial(minionId);
        if (partial) {
          const finalized = tryFinalizeMessage(partial);
          if (finalized.success) {
            const writeResult = await this.historyService.writePartial(
              minionId,
              finalized.data.updated
            );
            if (!writeResult.success) {
              return Err(writeResult.error);
            }

            const session = this.getOrCreateSession(minionId);
            session.emitChatEvent({
              type: "tool-call-end",
              minionId,
              messageId: finalized.data.updated.id,
              toolCallId,
              toolName: "ask_user_question",
              result: finalized.data.output,
              timestamp: Date.now(),
            });

            return Ok(undefined);
          }
        }

        // 2) Fall back to chat history (partial may have already been committed).
        // Only the current compaction epoch matters — pending tool calls don't survive compaction.
        const historyResult = await this.historyService.getHistoryFromLatestBoundary(minionId);
        if (!historyResult.success) {
          return Err(historyResult.error);
        }

        // Find the newest message containing this tool call.
        let best: LatticeMessage | null = null;
        let bestSeq = -Infinity;
        for (const msg of historyResult.data) {
          const seq = msg.metadata?.historySequence;
          if (seq === undefined) continue;

          const hasTool = msg.parts.some(
            (p) => isDynamicToolPart(p) && p.toolCallId === toolCallId
          );
          if (hasTool && seq > bestSeq) {
            best = msg;
            bestSeq = seq;
          }
        }

        if (!best) {
          const errorMessage = getErrorMessage(error);
          return Err(`Failed to answer ask_user_question: ${errorMessage}`);
        }

        // Guard against answering stale tool calls.
        const maxSeq = Math.max(
          ...historyResult.data
            .map((m) => m.metadata?.historySequence)
            .filter((n): n is number => typeof n === "number")
        );
        if (bestSeq !== maxSeq) {
          return Err(
            `Refusing to answer ask_user_question: tool call is not the latest message (toolSeq=${bestSeq}, latestSeq=${maxSeq})`
          );
        }

        const finalized = tryFinalizeMessage(best);
        if (!finalized.success) {
          return Err(finalized.error);
        }

        const updateResult = await this.historyService.updateHistory(
          minionId,
          finalized.data.updated
        );
        if (!updateResult.success) {
          return Err(updateResult.error);
        }

        const session = this.getOrCreateSession(minionId);
        session.emitChatEvent({
          type: "tool-call-end",
          minionId,
          messageId: finalized.data.updated.id,
          toolCallId,
          toolName: "ask_user_question",
          result: finalized.data.output,
          timestamp: Date.now(),
        });

        return Ok(undefined);
      } catch (innerError) {
        const errorMessage = getErrorMessage(innerError);
        return Err(errorMessage);
      }
    }
  }

  answerDelegatedToolCall(minionId: string, toolCallId: string, result: unknown): Result<void> {
    try {
      delegatedToolCallManager.answer(minionId, toolCallId, result);
      return Ok(undefined);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return Err(`Failed to answer delegated tool call: ${errorMessage}`);
    }
  }

  clearQueue(minionId: string): Result<void> {
    try {
      const session = this.getOrCreateSession(minionId);
      session.clearQueue();
      return Ok(undefined);
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      log.error("Unexpected error in clearQueue handler:", error);
      return Err(`Failed to clear queue: ${errorMessage}`);
    }
  }

  /**
   * Best-effort delete of plan files (new + legacy paths) for a minion.
   *
   * Why best-effort: plan files may not exist yet, or deletion may fail due to permissions.
   */
  private async deletePlanFilesForMinion(
    minionId: string,
    metadata: FrontendMinionMetadata
  ): Promise<void> {
    // Create runtime to get correct latticeHome (Docker uses /var/lattice, others use ~/.lattice)
    const runtime = createRuntimeForMinion(metadata);
    const latticeHome = runtime.getLatticeHome();
    const planPath = getPlanFilePath(metadata.name, metadata.projectName, latticeHome);
    const legacyPlanPath = getLegacyPlanFilePath(minionId);

    const isDocker = isDockerRuntime(metadata.runtimeConfig);
    const isSSH = isSSHRuntime(metadata.runtimeConfig);

    // For Docker: paths are already absolute (/var/lattice/...), just quote
    // For SSH: use $HOME expansion so the runtime shell resolves to the runtime home directory
    // For local: expand tilde locally since shellQuote prevents shell expansion
    const quotedPlanPath = isDocker
      ? shellQuote(planPath)
      : isSSH
        ? expandTildeForSSH(planPath)
        : shellQuote(expandTilde(planPath));
    // For legacy path: SSH/Docker use $HOME expansion, local expands tilde
    const quotedLegacyPlanPath =
      isDocker || isSSH
        ? expandTildeForSSH(legacyPlanPath)
        : shellQuote(expandTilde(legacyPlanPath));

    if (isDocker || isSSH) {
      try {
        // Use exec to delete files since runtime doesn't have a deleteFile method.
        // Use runtime minion path (not host projectPath) for Docker containers.
        const minionPath = runtime.getMinionPath(metadata.projectPath, metadata.name);
        const execStream = await runtime.exec(`rm -f ${quotedPlanPath} ${quotedLegacyPlanPath}`, {
          cwd: minionPath,
          timeout: 10,
        });

        try {
          await execStream.stdin.close();
        } catch {
          // Ignore stdin-close errors (e.g. already closed).
        }

        await execStream.exitCode.catch(() => {
          // Best-effort: ignore failures.
        });
      } catch {
        // Plan files don't exist or can't be deleted - ignore
      }

      return;
    }

    // Local runtimes: delete directly on the local filesystem.
    const planPathAbs = expandTilde(planPath);
    const legacyPlanPathAbs = expandTilde(legacyPlanPath);

    await Promise.allSettled([
      fsPromises.rm(planPathAbs, { force: true }),
      fsPromises.rm(legacyPlanPathAbs, { force: true }),
    ]);
  }

  async truncateHistory(minionId: string, percentage?: number): Promise<Result<void>> {
    const session = this.sessions.get(minionId);
    if (session?.isBusy() || this.aiService.isStreaming(minionId)) {
      return Err(
        "Cannot truncate history while a turn is active. Press Esc to stop the stream first."
      );
    }

    const truncateResult = await this.historyService.truncateHistory(
      minionId,
      percentage ?? 1.0
    );
    if (!truncateResult.success) {
      return Err(truncateResult.error);
    }

    const deletedSequences = truncateResult.data;
    if (deletedSequences.length > 0) {
      const deleteMessage: DeleteMessage = {
        type: "delete",
        historySequences: deletedSequences,
      };
      // Emit through the session so ORPC subscriptions receive the event
      if (session) {
        session.emitChatEvent(deleteMessage);
      } else {
        // Fallback to direct emit (legacy path)
        this.emit("chat", { minionId, message: deleteMessage });
      }
    }

    // On full clear, also delete plan file and clear file change tracking
    if ((percentage ?? 1.0) === 1.0) {
      const metadata = await this.getInfo(minionId);
      if (metadata) {
        await this.deletePlanFilesForMinion(minionId, metadata);
      }
      this.sessions.get(minionId)?.clearFileState();
    }

    return Ok(undefined);
  }

  async replaceHistory(
    minionId: string,
    summaryMessage: LatticeMessage,
    options?: {
      mode?: "destructive" | "append-compaction-boundary" | null;
      deletePlanFile?: boolean;
    }
  ): Promise<Result<void>> {
    // Support both new enum ("user"|"idle") and legacy boolean (true)
    const isCompaction = !!summaryMessage.metadata?.compacted;
    if (!isCompaction) {
      const session = this.sessions.get(minionId);
      if (session?.isBusy() || this.aiService.isStreaming(minionId)) {
        return Err(
          "Cannot replace history while a turn is active. Press Esc to stop the stream first."
        );
      }
    }

    const replaceMode = options?.mode ?? "destructive";

    try {
      let messageToAppend = summaryMessage;
      let deletedSequences: number[] = [];

      if (replaceMode === "append-compaction-boundary") {
        assert(
          summaryMessage.role === "assistant",
          "append-compaction-boundary replace mode requires an assistant summary message"
        );

        // Only need the current epoch's messages — the latest boundary marker holds
        // the max compaction epoch, and epochs are monotonically increasing with
        // append-only compaction. Falls back to full history for uncompacted minions.
        const historyResult = await this.historyService.getHistoryFromLatestBoundary(minionId);
        if (!historyResult.success) {
          return Err(
            `Failed to read history for append-compaction-boundary mode: ${historyResult.error}`
          );
        }

        const nextCompactionEpoch = getNextCompactionEpochForAppendBoundary(
          minionId,
          historyResult.data
        );
        assert(
          isPositiveInteger(nextCompactionEpoch),
          "append-compaction-boundary replace mode must compute a positive compaction epoch"
        );

        const compactedMarker = hasDurableCompactedMarker(summaryMessage.metadata?.compacted)
          ? summaryMessage.metadata.compacted
          : "user";

        messageToAppend = {
          ...summaryMessage,
          metadata: {
            ...(summaryMessage.metadata ?? {}),
            compacted: compactedMarker,
            compactionBoundary: true,
            compactionEpoch: nextCompactionEpoch,
          },
        };

        assert(
          hasDurableCompactedMarker(messageToAppend.metadata?.compacted),
          "append-compaction-boundary replace mode requires a durable compacted marker"
        );
        assert(
          messageToAppend.metadata?.compactionBoundary === true,
          "append-compaction-boundary replace mode must persist compactionBoundary=true"
        );
        assert(
          isPositiveInteger(messageToAppend.metadata?.compactionEpoch),
          "append-compaction-boundary replace mode must persist a positive compactionEpoch"
        );
      } else {
        assert(
          replaceMode === "destructive",
          `replaceHistory received unsupported replace mode: ${String(replaceMode)}`
        );

        const clearResult = await this.historyService.clearHistory(minionId);
        if (!clearResult.success) {
          return Err(`Failed to clear history: ${clearResult.error}`);
        }
        deletedSequences = clearResult.data;
      }

      const appendResult = await this.historyService.appendToHistory(minionId, messageToAppend);
      if (!appendResult.success) {
        return Err(`Failed to append summary message: ${appendResult.error}`);
      }

      // Emit through the session so ORPC subscriptions receive the events
      const session = this.sessions.get(minionId);
      if (deletedSequences.length > 0) {
        const deleteMessage: DeleteMessage = {
          type: "delete",
          historySequences: deletedSequences,
        };
        if (session) {
          session.emitChatEvent(deleteMessage);
        } else {
          this.emit("chat", { minionId, message: deleteMessage });
        }
      }

      // Add type: "message" for discriminated union (LatticeMessage doesn't have it)
      const typedSummaryMessage = { ...messageToAppend, type: "message" as const };
      if (session) {
        session.emitChatEvent(typedSummaryMessage);
      } else {
        this.emit("chat", { minionId, message: typedSummaryMessage });
      }

      // Optional cleanup: delete plan file when caller explicitly requests it.
      // Note: the propose_plan UI keeps the plan file on disk; this flag is reserved for
      // explicit reset flows and backwards compatibility.
      if (options?.deletePlanFile === true) {
        const metadata = await this.getInfo(minionId);
        if (metadata) {
          await this.deletePlanFilesForMinion(minionId, metadata);
        }
        this.sessions.get(minionId)?.clearFileState();
      }

      return Ok(undefined);
    } catch (error) {
      const message = getErrorMessage(error);
      return Err(`Failed to replace history: ${message}`);
    }
  }

  async getActivityList(): Promise<Record<string, MinionActivitySnapshot>> {
    try {
      const snapshots = await this.extensionMetadata.getAllSnapshots();
      return Object.fromEntries(snapshots.entries());
    } catch (error) {
      log.error("Failed to list activity:", error);
      return {};
    }
  }
  async getChatHistory(minionId: string): Promise<LatticeMessage[]> {
    try {
      // Only return messages from the latest compaction boundary onward.
      // Pre-boundary messages are summarized in the boundary marker.
      // TODO: allow users to opt in to viewing full pre-boundary history.
      const history = await this.historyService.getHistoryFromLatestBoundary(minionId);
      return history.success ? history.data : [];
    } catch (error) {
      log.error("Failed to get chat history:", error);
      return [];
    }
  }

  async getHistoryLoadMore(
    minionId: string,
    cursor: MinionHistoryLoadMoreCursor | null | undefined
  ): Promise<MinionHistoryLoadMoreResult> {
    assert(
      typeof minionId === "string" && minionId.trim().length > 0,
      "minionId is required"
    );

    if (cursor !== null && cursor !== undefined) {
      assert(
        isNonNegativeInteger(cursor.beforeHistorySequence),
        "cursor.beforeHistorySequence must be a non-negative integer"
      );
      assert(
        cursor.beforeMessageId === null ||
          cursor.beforeMessageId === undefined ||
          typeof cursor.beforeMessageId === "string",
        "cursor.beforeMessageId must be a string, null, or undefined"
      );
      if (typeof cursor.beforeMessageId === "string") {
        assert(
          cursor.beforeMessageId.trim().length > 0,
          "cursor.beforeMessageId must be non-empty when provided"
        );
      }
    }

    const emptyResult: MinionHistoryLoadMoreResult = {
      messages: [],
      nextCursor: null,
      hasOlder: false,
    };

    try {
      let beforeHistorySequence: number | undefined = cursor?.beforeHistorySequence;

      if (beforeHistorySequence === undefined) {
        // Initial load-more request (no cursor) should page one epoch older than startup replay.
        const latestBoundaryResult = await this.historyService.getHistoryFromLatestBoundary(
          minionId,
          0
        );
        if (!latestBoundaryResult.success) {
          log.warn("minion.history.loadMore: failed to read latest boundary", {
            minionId,
            error: latestBoundaryResult.error,
          });
          return emptyResult;
        }

        const oldestFromLatestBoundary = getOldestSequencedMessage(latestBoundaryResult.data);
        if (!oldestFromLatestBoundary) {
          return emptyResult;
        }

        beforeHistorySequence = oldestFromLatestBoundary.historySequence;
      }

      assert(
        isNonNegativeInteger(beforeHistorySequence),
        "resolved beforeHistorySequence must be a non-negative integer"
      );

      const historyWindowResult = await this.historyService.getHistoryBoundaryWindow(
        minionId,
        beforeHistorySequence
      );
      if (!historyWindowResult.success) {
        log.warn("minion.history.loadMore: failed to read boundary window", {
          minionId,
          beforeHistorySequence,
          error: historyWindowResult.error,
        });
        return emptyResult;
      }

      const messages: MinionChatMessage[] = historyWindowResult.data.messages.map((message) => ({
        ...message,
        type: "message",
      }));

      if (!historyWindowResult.data.hasOlder) {
        return {
          messages,
          nextCursor: null,
          hasOlder: false,
        };
      }

      const oldestInWindow = getOldestSequencedMessage(historyWindowResult.data.messages);
      if (!oldestInWindow) {
        // Defensive fallback: if we cannot build a stable cursor, stop paging instead of looping.
        log.warn("minion.history.loadMore: cannot compute next cursor despite hasOlder=true", {
          minionId,
          beforeHistorySequence,
        });
        return {
          messages,
          nextCursor: null,
          hasOlder: false,
        };
      }

      return {
        messages,
        nextCursor: {
          beforeHistorySequence: oldestInWindow.historySequence,
          beforeMessageId: oldestInWindow.message.id,
        },
        hasOlder: true,
      };
    } catch (error) {
      log.error("Failed to load more minion history:", {
        minionId,
        error: getErrorMessage(error),
      });
      return emptyResult;
    }
  }

  async getFileCompletions(
    minionId: string,
    query: string,
    limit = 20
  ): Promise<{ paths: string[] }> {
    assert(minionId, "minionId is required");
    assert(typeof query === "string", "query must be a string");

    const resolvedLimit = Math.min(Math.max(1, Math.trunc(limit)), 50);

    const metadata = await this.getInfo(minionId);
    if (!metadata) {
      return { paths: [] };
    }

    const runtime = createRuntimeForMinion(metadata);
    const isInPlace = metadata.projectPath === metadata.name;
    const minionPath = isInPlace
      ? metadata.projectPath
      : runtime.getMinionPath(metadata.projectPath, metadata.name);

    const now = Date.now();
    const CACHE_TTL_MS = 10_000;

    let cached = this.fileCompletionsCache.get(minionId);
    if (!cached) {
      cached = { index: EMPTY_FILE_COMPLETIONS_INDEX, fetchedAt: 0 };
      this.fileCompletionsCache.set(minionId, cached);
    }

    const cacheEntry = cached;

    const isStale = cacheEntry.fetchedAt === 0 || now - cacheEntry.fetchedAt > CACHE_TTL_MS;
    if (isStale && !cacheEntry.refreshing) {
      cacheEntry.refreshing = (async () => {
        const previousIndex = cacheEntry.index;

        try {
          const result = await execBuffered(runtime, "git ls-files -co --exclude-standard", {
            cwd: minionPath,
            timeout: 5,
          });

          if (result.exitCode !== 0) {
            cacheEntry.index = previousIndex;
          } else {
            const files = result.stdout
              .split("\n")
              .map((line) => line.trim())
              // File @mentions are whitespace-delimited, so we exclude spaced paths from autocomplete.
              .filter((filePath) => Boolean(filePath) && !/\s/.test(filePath));
            cacheEntry.index = buildFileCompletionsIndex(files);
          }

          cacheEntry.fetchedAt = Date.now();
        } catch (error) {
          log.debug("getFileCompletions: failed to list files", {
            minionId,
            error: getErrorMessage(error),
          });

          // Keep any previously indexed data, but avoid retrying in a tight loop.
          cacheEntry.index = previousIndex;
          cacheEntry.fetchedAt = Date.now();
        }
      })().finally(() => {
        cacheEntry.refreshing = undefined;
      });
    }

    if (cacheEntry.fetchedAt === 0 && cacheEntry.refreshing) {
      await cacheEntry.refreshing;
    }

    return { paths: searchFileCompletions(cacheEntry.index, query, resolvedLimit) };
  }
  async getFullReplay(minionId: string): Promise<MinionChatMessage[]> {
    try {
      const session = this.getOrCreateSession(minionId);
      const events: MinionChatMessage[] = [];
      await session.replayHistory(({ message }) => {
        events.push(message);
      });
      return events;
    } catch (error) {
      log.error("Failed to get full replay:", error);
      return [];
    }
  }

  async executeBash(
    minionId: string,
    script: string,
    options?: {
      timeout_secs?: number;
    }
  ): Promise<Result<BashToolResult>> {
    // Block bash execution while minion is being removed to prevent races with directory deletion.
    // A common case: sidekick calls agent_report → frontend's GitStatusStore triggers a git status
    // refresh → executeBash arrives while remove() is deleting the directory → spawn fails with ENOENT.
    // removingMinions is set for the entire duration of remove(), covering the window between
    // disk deletion and metadata invalidation.
    if (this.removingMinions.has(minionId)) {
      return Err(`Minion ${minionId} is being removed`);
    }

    // NOTE: This guard must run before any init/runtime operations that could wake a stopped SSH
    // runtime (e.g., Lattice minions started via `lattice ssh --wait=yes`).
    if (this.archivingMinions.has(minionId)) {
      return Err(`Minion ${minionId} is being archived; cannot execute bash`);
    }

    const metadataResult = await this.aiService.getMinionMetadata(minionId);
    if (!metadataResult.success) {
      return Err(`Failed to get minion metadata: ${metadataResult.error}`);
    }

    const metadata = metadataResult.data;
    if (isMinionArchived(metadata.archivedAt, metadata.unarchivedAt)) {
      return Err(`Minion ${minionId} is archived; cannot execute bash`);
    }

    // Wait for minion initialization (container creation, code sync, etc.)
    // Same behavior as AI tools - 5 min timeout, then proceeds anyway
    await this.initStateManager.waitForInit(minionId);

    try {
      // Get actual minion path from config
      const minion = this.config.findMinion(minionId);
      if (!minion) {
        return Err(`Minion ${minionId} not found in config`);
      }

      // Load project secrets
      const projectSecrets = this.config.getEffectiveSecrets(metadata.projectPath);

      // Create scoped temp directory for this IPC call
      using tempDir = new DisposableTempDir("lattice-ipc-bash");

      // Create runtime and compute minion path
      const runtime = createRuntime(metadata.runtimeConfig, {
        projectPath: metadata.projectPath,
        minionName: metadata.name,
      });

      // Ensure runtime is ready (e.g., start Docker container if stopped)
      const readyResult = await runtime.ensureReady();
      if (!readyResult.ready) {
        return Err(readyResult.error ?? "Runtime not ready");
      }

      const minionPath = runtime.getMinionPath(metadata.projectPath, metadata.name);

      // Create bash tool
      const bashTool = createBashTool({
        cwd: minionPath,
        runtime,
        secrets: secretsToRecord(projectSecrets),
        runtimeTempDir: tempDir.path,
        overflow_policy: "truncate",
      });

      // Execute the script
      const result = (await bashTool.execute!(
        {
          script,
          timeout_secs: options?.timeout_secs ?? 120,
        },
        {
          toolCallId: `bash-${Date.now()}`,
          messages: [],
        }
      )) as BashToolResult;

      return Ok(result);
    } catch (error) {
      // bashTool.execute returns error results instead of throwing, so this only catches
      // failures from setup code (getMinionMetadata, findMinion, createRuntime, etc.)
      const message = getErrorMessage(error);
      return Err(`Failed to execute bash command: ${message}`);
    }
  }

  /**
   * List background processes for a minion.
   * Returns process info suitable for UI display (excludes handle).
   */
  async listBackgroundProcesses(minionId: string): Promise<
    Array<{
      id: string;
      pid: number;
      script: string;
      displayName?: string;
      startTime: number;
      status: "running" | "exited" | "killed" | "failed";
      exitCode?: number;
    }>
  > {
    const processes = await this.backgroundProcessManager.list(minionId);
    return processes.map((p) => ({
      id: p.id,
      pid: p.pid,
      script: p.script,
      displayName: p.displayName,
      startTime: p.startTime,
      status: p.status,
      exitCode: p.exitCode,
    }));
  }

  /**
   * Terminate a background process by ID.
   * Verifies the process belongs to the specified minion.
   */
  async terminateBackgroundProcess(minionId: string, processId: string): Promise<Result<void>> {
    // Get process to verify minion ownership
    const proc = await this.backgroundProcessManager.getProcess(processId);
    if (!proc) {
      return Err(`Process not found: ${processId}`);
    }
    if (proc.minionId !== minionId) {
      return Err(`Process ${processId} does not belong to minion ${minionId}`);
    }

    const result = await this.backgroundProcessManager.terminate(processId);
    if (!result.success) {
      return Err(result.error);
    }
    return Ok(undefined);
  }

  /**
   * Peek output for a background bash process.
   *
   * This must not consume the output cursor used by bash_output/task_await.
   */
  async getBackgroundProcessOutput(
    minionId: string,
    processId: string,
    options?: { fromOffset?: number; tailBytes?: number }
  ): Promise<
    Result<{
      status: "running" | "exited" | "killed" | "failed";
      output: string;
      nextOffset: number;
      truncatedStart: boolean;
    }>
  > {
    const proc = await this.backgroundProcessManager.getProcess(processId);
    if (!proc) {
      return Err(`Process not found: ${processId}`);
    }
    if (proc.minionId !== minionId) {
      return Err(`Process ${processId} does not belong to minion ${minionId}`);
    }

    const result = await this.backgroundProcessManager.peekOutput(processId, options);
    if (!result.success) {
      return Err(result.error);
    }

    return Ok({
      status: result.status,
      output: result.output,
      nextOffset: result.nextOffset,
      truncatedStart: result.truncatedStart,
    });
  }

  /**
   * Get the tool call IDs of foreground bash processes for a minion.
   * Returns empty array if no foreground bashes are running.
   */
  getForegroundToolCallIds(minionId: string): string[] {
    return this.backgroundProcessManager.getForegroundToolCallIds(minionId);
  }

  /**
   * Send a foreground bash process to background by its tool call ID.
   * The process continues running but the agent stops waiting for it.
   */
  sendToBackground(toolCallId: string): Result<void> {
    const result = this.backgroundProcessManager.sendToBackground(toolCallId);
    if (!result.success) {
      return Err(result.error);
    }
    return Ok(undefined);
  }

  /**
   * Subscribe to background bash state changes.
   */
  onBackgroundBashChange(callback: (minionId: string) => void): void {
    this.backgroundProcessManager.on("change", callback);
  }

  /**
   * Unsubscribe from background bash state changes.
   */
  offBackgroundBashChange(callback: (minionId: string) => void): void {
    this.backgroundProcessManager.off("change", callback);
  }

  /**
   * Execute idle compaction for a minion directly from the backend.
   *
   * This path is frontend-independent: compaction still runs even if no UI is open.
   * Throws on failure so IdleCompactionService can log and continue with the next minion.
   */
  async executeIdleCompaction(minionId: string): Promise<void> {
    assert(minionId.trim().length > 0, "executeIdleCompaction requires a non-empty minionId");

    const sendOptions = await this.buildIdleCompactionSendOptions(minionId);

    const latticeMetadata: LatticeMessageMetadata = {
      type: "compaction-request",
      rawCommand: "/compact",
      commandPrefix: "/compact",
      parsed: {
        model: sendOptions.model,
      },
      requestedModel: sendOptions.model,
      source: "idle-compaction",
      displayStatus: { emoji: "💤", message: "Compacting idle minion..." },
    };

    const session = this.getOrCreateSession(minionId);
    if (session.isBusy()) {
      throw new Error(
        "Failed to execute idle compaction: Minion is busy; idle-only send was skipped."
      );
    }

    const sendResult = await this.sendMessage(
      minionId,
      buildCompactionMessageText({}),
      {
        ...sendOptions,
        latticeMetadata,
      },
      {
        // Idle compaction runs in background; avoid mutating auto-resume counters.
        skipAutoResumeReset: true,
        // Backend-initiated maintenance turn: do not treat as explicit user re-engagement.
        synthetic: true,
        // If the minion became active after eligibility checks, skip instead of queueing
        // stale maintenance work for later.
        requireIdle: true,
      }
    );

    if (!sendResult.success) {
      const rawError = sendResult.error;
      const formattedError =
        typeof rawError === "object" && rawError !== null
          ? "raw" in rawError && typeof rawError.raw === "string"
            ? rawError.raw
            : "message" in rawError && typeof rawError.message === "string"
              ? rawError.message
              : "type" in rawError && typeof rawError.type === "string"
                ? rawError.type
                : JSON.stringify(rawError)
          : String(rawError);
      throw new Error(`Failed to execute idle compaction: ${formattedError}`);
    }

    // Mark idle compaction only while a stream is actually active.
    // sendMessage can succeed on startup-abort paths where no stream is running,
    // and leaking this marker into the next user stream would suppress real notifications.
    if (session.isBusy()) {
      // Marker is added after dispatch to avoid races with concurrent user sends.
      // The streaming=true snapshot was already emitted without the flag, but the
      // streaming=false snapshot (on stream end) picks up the marker.
      this.idleCompactingMinions.add(minionId);
      return;
    }

    // Defensive cleanup for startup-abort paths or extremely fast completions that
    // finish before executeIdleCompaction regains control.
    this.idleCompactingMinions.delete(minionId);
  }

  private async buildIdleCompactionSendOptions(minionId: string): Promise<SendMessageOptions> {
    const config = this.config.loadConfigOrDefault();
    const minionMatch = this.config.findMinion(minionId);

    const minionEntry = minionMatch
      ? (() => {
          const project = config.projects.get(minionMatch.projectPath);
          return (
            project?.minions.find((minion) => minion.id === minionId) ??
            project?.minions.find((minion) => minion.path === minionMatch.minionPath)
          );
        })()
      : undefined;

    const activity = await this.extensionMetadata.getMetadata(minionId);

    const compactAgentSettings = minionEntry?.aiSettingsByAgent?.compact;
    const execAgentSettings =
      minionEntry?.aiSettingsByAgent?.[MINION_DEFAULTS.agentId] ?? minionEntry?.aiSettings;

    const preferredCompactionModel =
      typeof config.preferredCompactionModel === "string"
        ? config.preferredCompactionModel.trim()
        : undefined;

    const normalizedPreferredCompactionModel =
      preferredCompactionModel && isValidModelFormat(preferredCompactionModel)
        ? preferredCompactionModel
        : undefined;

    const fallbackModel =
      normalizedPreferredCompactionModel ??
      compactAgentSettings?.model ??
      execAgentSettings?.model ??
      activity?.lastModel ??
      MINION_DEFAULTS.model;

    let model = fallbackModel;
    if (!isValidModelFormat(model)) {
      log.warn("Idle compaction resolved invalid model; falling back to minion default", {
        minionId,
        model,
      });
      model = MINION_DEFAULTS.model;
    }

    const requestedThinking =
      compactAgentSettings?.thinkingLevel ??
      execAgentSettings?.thinkingLevel ??
      activity?.lastThinkingLevel ??
      MINION_DEFAULTS.thinkingLevel;

    const normalizedThinkingLevel =
      coerceThinkingLevel(requestedThinking) ?? MINION_DEFAULTS.thinkingLevel;

    return {
      model,
      agentId: "compact",
      thinkingLevel: enforceThinkingPolicy(model, normalizedThinkingLevel),
      maxOutputTokens: undefined,
      // Disable all tools during compaction - regex .* matches all tool names.
      toolPolicy: [{ regex_match: ".*", action: "disable" }],
      // Compaction should not mutate persisted minion AI defaults.
      skipAiSettingsPersistence: true,
    };
  }
}
