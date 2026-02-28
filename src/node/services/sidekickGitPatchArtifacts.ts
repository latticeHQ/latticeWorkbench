import * as fsPromises from "fs/promises";
import * as path from "node:path";

import writeFileAtomic from "write-file-atomic";

import type { SidekickGitPatchArtifact } from "@/common/utils/tools/toolDefinitions";
import { log } from "@/node/services/log";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";

export interface SidekickGitPatchArtifactsFile {
  version: 1;
  artifactsByChildTaskId: Record<string, SidekickGitPatchArtifact>;
}

const SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION = 1 as const;

const SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_NAME = "sidekick-patches.json";
const SIDEKICK_GIT_PATCH_DIR_NAME = "sidekick-patches";
const SIDEKICK_GIT_PATCH_MBOX_FILE_NAME = "series.mbox";

export function getSidekickGitPatchArtifactsFilePath(minionSessionDir: string): string {
  return path.join(minionSessionDir, SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_NAME);
}

export function getSidekickGitPatchMboxPath(
  minionSessionDir: string,
  childTaskId: string
): string {
  return path.join(
    minionSessionDir,
    SIDEKICK_GIT_PATCH_DIR_NAME,
    childTaskId,
    SIDEKICK_GIT_PATCH_MBOX_FILE_NAME
  );
}

export async function readSidekickGitPatchArtifactsFile(
  minionSessionDir: string
): Promise<SidekickGitPatchArtifactsFile> {
  try {
    const filePath = getSidekickGitPatchArtifactsFilePath(minionSessionDir);
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") {
      return { version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    const obj = parsed as {
      version?: unknown;
      artifactsByChildTaskId?: unknown;
    };

    const version = obj.version;
    const artifactsByChildTaskId = obj.artifactsByChildTaskId;

    if (version !== SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION) {
      // Unknown version; treat as empty.
      return { version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    if (!artifactsByChildTaskId || typeof artifactsByChildTaskId !== "object") {
      return { version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    return {
      version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION,
      artifactsByChildTaskId: artifactsByChildTaskId as Record<string, SidekickGitPatchArtifact>,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
    }

    log.error("Failed to read sidekick git patch artifacts file", { error });
    return { version: SIDEKICK_GIT_PATCH_ARTIFACTS_FILE_VERSION, artifactsByChildTaskId: {} };
  }
}

export async function readSidekickGitPatchArtifact(
  minionSessionDir: string,
  childTaskId: string
): Promise<SidekickGitPatchArtifact | null> {
  const file = await readSidekickGitPatchArtifactsFile(minionSessionDir);
  return file.artifactsByChildTaskId[childTaskId] ?? null;
}

export async function updateSidekickGitPatchArtifactsFile(params: {
  minionId: string;
  minionSessionDir: string;
  update: (file: SidekickGitPatchArtifactsFile) => void;
}): Promise<SidekickGitPatchArtifactsFile> {
  return minionFileLocks.withLock(params.minionId, async () => {
    const file = await readSidekickGitPatchArtifactsFile(params.minionSessionDir);
    params.update(file);
    try {
      await fsPromises.mkdir(params.minionSessionDir, { recursive: true });
      const filePath = getSidekickGitPatchArtifactsFilePath(params.minionSessionDir);
      await writeFileAtomic(filePath, JSON.stringify(file, null, 2));
    } catch (error) {
      log.error("Failed to write sidekick git patch artifacts file", { error });
    }
    return file;
  });
}

export async function upsertSidekickGitPatchArtifact(params: {
  minionId: string;
  minionSessionDir: string;
  childTaskId: string;
  updater: (existing: SidekickGitPatchArtifact | null) => SidekickGitPatchArtifact;
}): Promise<SidekickGitPatchArtifact> {
  let updated: SidekickGitPatchArtifact | null = null;

  await updateSidekickGitPatchArtifactsFile({
    minionId: params.minionId,
    minionSessionDir: params.minionSessionDir,
    update: (file) => {
      const existing = file.artifactsByChildTaskId[params.childTaskId] ?? null;
      updated = params.updater(existing);
      file.artifactsByChildTaskId[params.childTaskId] = updated;
    },
  });

  if (!updated) {
    throw new Error("upsertSidekickGitPatchArtifact: updater returned no artifact");
  }

  return updated;
}

export async function markSidekickGitPatchArtifactApplied(params: {
  minionId: string;
  minionSessionDir: string;
  childTaskId: string;
  appliedAtMs: number;
}): Promise<SidekickGitPatchArtifact | null> {
  let updated: SidekickGitPatchArtifact | null = null;

  await updateSidekickGitPatchArtifactsFile({
    minionId: params.minionId,
    minionSessionDir: params.minionSessionDir,
    update: (file) => {
      const existing = file.artifactsByChildTaskId[params.childTaskId] ?? null;
      if (!existing) {
        updated = null;
        return;
      }

      updated = {
        ...existing,
        appliedAtMs: params.appliedAtMs,
        updatedAtMs: params.appliedAtMs,
      };
      file.artifactsByChildTaskId[params.childTaskId] = updated;
    },
  });

  return updated;
}
