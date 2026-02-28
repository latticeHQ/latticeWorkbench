import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import {
  getSidekickGitPatchArtifactsFilePath,
  markSidekickGitPatchArtifactApplied,
  readSidekickGitPatchArtifactsFile,
  upsertSidekickGitPatchArtifact,
} from "@/node/services/sidekickGitPatchArtifacts";

describe("sidekickGitPatchArtifacts", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-sidekick-git-patch-"));
  });

  afterEach(async () => {
    await fsPromises.rm(testDir, { recursive: true, force: true });
  });

  test("readSidekickGitPatchArtifactsFile returns empty file when missing", async () => {
    const file = await readSidekickGitPatchArtifactsFile(testDir);
    expect(file.version).toBe(1);
    expect(file.artifactsByChildTaskId).toEqual({});
  });

  test("upsertSidekickGitPatchArtifact writes and updates artifacts", async () => {
    const minionId = "parent-1";
    const childTaskId = "child-1";

    const createdAtMs = Date.now();

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: testDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs,
        updatedAtMs: createdAtMs,
        status: "ready",
        commitCount: 2,
        mboxPath: "/tmp/series.mbox",
      }),
    });

    const pathOnDisk = getSidekickGitPatchArtifactsFilePath(testDir);
    await fsPromises.stat(pathOnDisk);

    const file = await readSidekickGitPatchArtifactsFile(testDir);
    const artifact = file.artifactsByChildTaskId[childTaskId];
    expect(artifact).toBeTruthy();
    expect(artifact?.childTaskId).toBe(childTaskId);
    expect(artifact?.parentMinionId).toBe(minionId);
    expect(artifact?.createdAtMs).toBe(createdAtMs);
    expect(artifact?.status).toBe("ready");
    expect(artifact?.commitCount).toBe(2);
  });

  test("markSidekickGitPatchArtifactApplied sets appliedAtMs", async () => {
    const minionId = "parent-1";
    const childTaskId = "child-1";
    const createdAtMs = Date.now();

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: testDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs,
        updatedAtMs: createdAtMs,
        status: "ready",
        commitCount: 1,
        mboxPath: "/tmp/series.mbox",
      }),
    });

    const appliedAtMs = createdAtMs + 1234;
    const updated = await markSidekickGitPatchArtifactApplied({
      minionId,
      minionSessionDir: testDir,
      childTaskId,
      appliedAtMs,
    });

    expect(updated?.appliedAtMs).toBe(appliedAtMs);
    expect(updated?.updatedAtMs).toBe(appliedAtMs);

    const file = await readSidekickGitPatchArtifactsFile(testDir);
    expect(file.artifactsByChildTaskId[childTaskId]?.appliedAtMs).toBe(appliedAtMs);
  });
});
