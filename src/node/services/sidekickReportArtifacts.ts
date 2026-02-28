import * as fsPromises from "fs/promises";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import { coerceThinkingLevel, type ThinkingLevel } from "@/common/types/thinking";

import { log } from "@/node/services/log";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";

export interface SidekickReportArtifactsFile {
  version: 1;
  artifactsByChildTaskId: Record<string, SidekickReportArtifactIndexEntry>;
}

export interface SidekickReportArtifactIndexEntry {
  childTaskId: string;
  /** Immediate parent in the agent-task tree (matches MinionConfigEntry.parentMinionId). */
  parentMinionId: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** Task-level model string used when running the sidekick (optional for legacy entries). */
  model?: string;
  /** Task-level thinking/reasoning level used when running the sidekick (optional for legacy entries). */
  thinkingLevel?: ThinkingLevel;
  title?: string;
  /** Full ancestor chain (parent first). Used for descendant scope checks after cleanup. */
  ancestorMinionIds: string[];
}

export interface SidekickReportArtifact extends SidekickReportArtifactIndexEntry {
  reportMarkdown: string;
}

const SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION = 1 as const;

const SIDEKICK_REPORT_ARTIFACTS_FILE_NAME = "sidekick-reports.json";
const SIDEKICK_REPORT_DIR_NAME = "sidekick-reports";
const SIDEKICK_REPORT_FILE_NAME = "report.json";

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function getSidekickReportArtifactsFilePath(minionSessionDir: string): string {
  return path.join(minionSessionDir, SIDEKICK_REPORT_ARTIFACTS_FILE_NAME);
}

export function getSidekickReportArtifactPath(
  minionSessionDir: string,
  childTaskId: string
): string {
  return path.join(
    minionSessionDir,
    SIDEKICK_REPORT_DIR_NAME,
    childTaskId,
    SIDEKICK_REPORT_FILE_NAME
  );
}

export async function readSidekickReportArtifactsFile(
  minionSessionDir: string
): Promise<SidekickReportArtifactsFile> {
  try {
    const filePath = getSidekickReportArtifactsFilePath(minionSessionDir);
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return { version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    const obj = parsed as {
      version?: unknown;
      artifactsByChildTaskId?: unknown;
    };

    if (obj.version !== SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION) {
      // Unknown version; treat as empty.
      return { version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    if (!obj.artifactsByChildTaskId || typeof obj.artifactsByChildTaskId !== "object") {
      return { version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    return {
      version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION,
      artifactsByChildTaskId: obj.artifactsByChildTaskId as Record<
        string,
        SidekickReportArtifactIndexEntry
      >,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    log.error("Failed to read sidekick report artifacts file", { error });
    return { version: SIDEKICK_REPORT_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
  }
}

export async function readSidekickReportArtifactIndexEntry(
  minionSessionDir: string,
  childTaskId: string
): Promise<SidekickReportArtifactIndexEntry | null> {
  const file = await readSidekickReportArtifactsFile(minionSessionDir);
  return file.artifactsByChildTaskId[childTaskId] ?? null;
}

export async function readSidekickReportArtifact(
  minionSessionDir: string,
  childTaskId: string
): Promise<SidekickReportArtifact | null> {
  const meta = await readSidekickReportArtifactIndexEntry(minionSessionDir, childTaskId);

  const reportPath = getSidekickReportArtifactPath(minionSessionDir, childTaskId);
  try {
    const raw = await fsPromises.readFile(reportPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const obj = parsed as {
      childTaskId?: unknown;
      parentMinionId?: unknown;
      createdAtMs?: unknown;
      updatedAtMs?: unknown;
      model?: unknown;
      thinkingLevel?: unknown;
      title?: unknown;
      ancestorMinionIds?: unknown;
      reportMarkdown?: unknown;
    };

    const reportMarkdown = typeof obj.reportMarkdown === "string" ? obj.reportMarkdown : null;
    if (!reportMarkdown || reportMarkdown.length === 0) {
      return null;
    }

    const title = typeof obj.title === "string" ? obj.title : undefined;

    const model =
      typeof obj.model === "string" && obj.model.trim().length > 0 ? obj.model.trim() : undefined;
    const thinkingLevel = coerceThinkingLevel(obj.thinkingLevel);

    if (meta) {
      // Trust the index file for metadata (versioned), but allow per-task file to override title.
      return {
        ...meta,
        model:
          typeof meta.model === "string" && meta.model.trim().length > 0
            ? meta.model.trim()
            : undefined,
        thinkingLevel: coerceThinkingLevel(meta.thinkingLevel),
        title: title ?? meta.title,
        reportMarkdown,
      };
    }

    // Self-healing: if the index entry is missing/corrupted, fall back to the per-task artifact.
    const parentMinionId =
      typeof obj.parentMinionId === "string" ? obj.parentMinionId : null;
    const createdAtMs = typeof obj.createdAtMs === "number" ? obj.createdAtMs : null;
    const updatedAtMs = typeof obj.updatedAtMs === "number" ? obj.updatedAtMs : null;
    const ancestorMinionIds = isStringArray(obj.ancestorMinionIds)
      ? obj.ancestorMinionIds
      : null;

    if (!parentMinionId || !createdAtMs || !updatedAtMs || !ancestorMinionIds) {
      return null;
    }

    return {
      childTaskId,
      parentMinionId,
      createdAtMs,
      updatedAtMs,
      model,
      thinkingLevel,
      title,
      ancestorMinionIds,
      reportMarkdown,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    log.error("Failed to read sidekick report artifact", { childTaskId, error });
    return null;
  }
}

export async function updateSidekickReportArtifactsFile(params: {
  minionId: string;
  minionSessionDir: string;
  update: (file: SidekickReportArtifactsFile) => void;
}): Promise<SidekickReportArtifactsFile> {
  return minionFileLocks.withLock(params.minionId, async () => {
    const file = await readSidekickReportArtifactsFile(params.minionSessionDir);
    params.update(file);

    try {
      await fsPromises.mkdir(params.minionSessionDir, { recursive: true });
      const filePath = getSidekickReportArtifactsFilePath(params.minionSessionDir);
      await writeFileAtomic(filePath, JSON.stringify(file, null, 2));
    } catch (error) {
      log.error("Failed to write sidekick report artifacts file", { error });
    }

    return file;
  });
}

export async function upsertSidekickReportArtifact(params: {
  /** Minion id that owns the session dir we're writing into (used for file locking). */
  minionId: string;
  minionSessionDir: string;
  childTaskId: string;
  parentMinionId: string;
  ancestorMinionIds: string[];
  reportMarkdown: string;
  /** Task-level model string used when running the sidekick (optional for legacy entries). */
  model?: string;
  /** Task-level thinking/reasoning level used when running the sidekick (optional for legacy entries). */
  thinkingLevel?: ThinkingLevel;
  title?: string;
  nowMs?: number;
}): Promise<SidekickReportArtifactIndexEntry> {
  let updated: SidekickReportArtifactIndexEntry | null = null;

  await minionFileLocks.withLock(params.minionId, async () => {
    const nowMs = params.nowMs ?? Date.now();

    const model =
      typeof params.model === "string" && params.model.trim().length > 0
        ? params.model.trim()
        : undefined;
    const thinkingLevel = coerceThinkingLevel(params.thinkingLevel);

    const file = await readSidekickReportArtifactsFile(params.minionSessionDir);
    const existing = file.artifactsByChildTaskId[params.childTaskId] ?? null;
    const createdAtMs = existing?.createdAtMs ?? nowMs;

    // Write the report payload first so we never publish an index entry without a report body.
    const reportPath = getSidekickReportArtifactPath(
      params.minionSessionDir,
      params.childTaskId
    );
    try {
      await fsPromises.mkdir(path.dirname(reportPath), { recursive: true });
      await writeFileAtomic(
        reportPath,
        JSON.stringify(
          {
            childTaskId: params.childTaskId,
            parentMinionId: params.parentMinionId,
            createdAtMs,
            updatedAtMs: nowMs,
            model,
            thinkingLevel,
            title: params.title,
            ancestorMinionIds: params.ancestorMinionIds,
            reportMarkdown: params.reportMarkdown,
          },
          null,
          2
        )
      );
    } catch (error) {
      log.error("Failed to write sidekick report artifact", {
        minionId: params.minionId,
        childTaskId: params.childTaskId,
        error,
      });
      return;
    }

    updated = {
      childTaskId: params.childTaskId,
      parentMinionId: params.parentMinionId,
      createdAtMs,
      updatedAtMs: nowMs,
      model,
      thinkingLevel,
      title: params.title,
      ancestorMinionIds: params.ancestorMinionIds,
    };
    file.artifactsByChildTaskId[params.childTaskId] = updated;

    try {
      await fsPromises.mkdir(params.minionSessionDir, { recursive: true });
      const filePath = getSidekickReportArtifactsFilePath(params.minionSessionDir);
      await writeFileAtomic(filePath, JSON.stringify(file, null, 2));
    } catch (error) {
      log.error("Failed to write sidekick report artifacts file", { error });
    }
  });

  if (!updated) {
    throw new Error("upsertSidekickReportArtifact: failed to write report artifact");
  }

  return updated;
}
