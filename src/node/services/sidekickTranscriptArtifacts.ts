import * as fsPromises from "fs/promises";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import type { ThinkingLevel } from "@/common/types/thinking";

import { log } from "@/node/services/log";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";

export interface SidekickTranscriptArtifactsFile {
  version: 1;
  artifactsByChildTaskId: Record<string, SidekickTranscriptArtifactIndexEntry>;
}

export interface SidekickTranscriptArtifactIndexEntry {
  childTaskId: string;
  /** Immediate parent in the agent-task tree (matches MinionConfigEntry.parentMinionId). */
  parentMinionId: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** Task-level model string used when running the sidekick (optional for legacy entries). */
  model?: string;
  /** Task-level thinking/reasoning level used when running the sidekick (optional for legacy entries). */
  thinkingLevel?: ThinkingLevel;
  /** Absolute path to the archived chat.jsonl file on disk (if present). */
  chatPath?: string;
  /** Absolute path to the archived partial.json file on disk (if present). */
  partialPath?: string;
}

const SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION = 1 as const;

const SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_NAME = "sidekick-transcripts.json";
const SIDEKICK_TRANSCRIPTS_DIR_NAME = "sidekick-transcripts";
const SIDEKICK_TRANSCRIPT_CHAT_FILE_NAME = "chat.jsonl";
const SIDEKICK_TRANSCRIPT_PARTIAL_FILE_NAME = "partial.json";

export function getSidekickTranscriptArtifactsFilePath(minionSessionDir: string): string {
  return path.join(minionSessionDir, SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_NAME);
}

export function getSidekickTranscriptChatPath(
  minionSessionDir: string,
  childTaskId: string
): string {
  return path.join(
    minionSessionDir,
    SIDEKICK_TRANSCRIPTS_DIR_NAME,
    childTaskId,
    SIDEKICK_TRANSCRIPT_CHAT_FILE_NAME
  );
}

export function getSidekickTranscriptPartialPath(
  minionSessionDir: string,
  childTaskId: string
): string {
  return path.join(
    minionSessionDir,
    SIDEKICK_TRANSCRIPTS_DIR_NAME,
    childTaskId,
    SIDEKICK_TRANSCRIPT_PARTIAL_FILE_NAME
  );
}

export async function readSidekickTranscriptArtifactsFile(
  minionSessionDir: string
): Promise<SidekickTranscriptArtifactsFile> {
  try {
    const filePath = getSidekickTranscriptArtifactsFilePath(minionSessionDir);
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return { version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    const obj = parsed as {
      version?: unknown;
      artifactsByChildTaskId?: unknown;
    };

    if (obj.version !== SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION) {
      // Unknown version; treat as empty.
      return { version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    if (!obj.artifactsByChildTaskId || typeof obj.artifactsByChildTaskId !== "object") {
      return { version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    return {
      version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION,
      artifactsByChildTaskId: obj.artifactsByChildTaskId as Record<
        string,
        SidekickTranscriptArtifactIndexEntry
      >,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    log.error("Failed to read sidekick transcript artifacts file", { error });
    return { version: SIDEKICK_TRANSCRIPT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
  }
}

export async function updateSidekickTranscriptArtifactsFile(params: {
  /** Minion id that owns the session dir we're writing into (used for file locking). */
  minionId: string;
  minionSessionDir: string;
  update: (file: SidekickTranscriptArtifactsFile) => void;
}): Promise<SidekickTranscriptArtifactsFile> {
  return minionFileLocks.withLock(params.minionId, async () => {
    const file = await readSidekickTranscriptArtifactsFile(params.minionSessionDir);
    params.update(file);

    try {
      await fsPromises.mkdir(params.minionSessionDir, { recursive: true });
      const filePath = getSidekickTranscriptArtifactsFilePath(params.minionSessionDir);
      await writeFileAtomic(filePath, JSON.stringify(file, null, 2));
    } catch (error) {
      log.error("Failed to write sidekick transcript artifacts file", { error });
    }

    return file;
  });
}

export async function upsertSidekickTranscriptArtifactIndexEntry(params: {
  /** Minion id that owns the session dir we're writing into (used for file locking). */
  minionId: string;
  minionSessionDir: string;
  childTaskId: string;
  updater: (
    existing: SidekickTranscriptArtifactIndexEntry | null
  ) => SidekickTranscriptArtifactIndexEntry;
}): Promise<SidekickTranscriptArtifactIndexEntry> {
  let updated: SidekickTranscriptArtifactIndexEntry | null = null;

  await updateSidekickTranscriptArtifactsFile({
    minionId: params.minionId,
    minionSessionDir: params.minionSessionDir,
    update: (file) => {
      const existing = file.artifactsByChildTaskId[params.childTaskId] ?? null;
      updated = params.updater(existing);
      file.artifactsByChildTaskId[params.childTaskId] = updated;
    },
  });

  if (!updated) {
    throw new Error("upsertSidekickTranscriptArtifactIndexEntry: updater returned no entry");
  }

  return updated;
}
