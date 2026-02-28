import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execSync } from "node:child_process";

import type { ToolExecutionOptions } from "ai";

import { createTaskApplyGitPatchTool } from "@/node/services/tools/task_apply_git_patch";
import {
  getSidekickGitPatchMboxPath,
  readSidekickGitPatchArtifact,
  upsertSidekickGitPatchArtifact,
} from "@/node/services/sidekickGitPatchArtifacts";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import { getTestDeps } from "@/node/services/tools/testHelpers";

const mockToolCallOptions: ToolExecutionOptions = {
  toolCallId: "test-call-id",
  messages: [],
};

function initGitRepo(repoPath: string): void {
  execSync("git init -b main", { cwd: repoPath, stdio: "ignore" });
  execSync('git config user.email "test@example.com"', { cwd: repoPath, stdio: "ignore" });
  execSync('git config user.name "test"', { cwd: repoPath, stdio: "ignore" });
  execSync("git config commit.gpgsign false", { cwd: repoPath, stdio: "ignore" });
}

async function commitFile(
  repoPath: string,
  fileName: string,
  content: string,
  message: string
): Promise<void> {
  await fsPromises.writeFile(path.join(repoPath, fileName), content, "utf-8");
  execSync(`git add -- ${fileName}`, { cwd: repoPath, stdio: "ignore" });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: repoPath, stdio: "ignore" });
}

describe("task_apply_git_patch tool", () => {
  let rootDir: string;
  let childRepo: string;
  let targetRepo: string;
  let sessionDir: string;

  beforeEach(async () => {
    rootDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-task-apply-git-patch-"));
    childRepo = path.join(rootDir, "child");
    targetRepo = path.join(rootDir, "target");
    sessionDir = path.join(rootDir, "session");

    await fsPromises.mkdir(childRepo, { recursive: true });
    await fsPromises.mkdir(targetRepo, { recursive: true });
    await fsPromises.mkdir(sessionDir, { recursive: true });
  });

  afterEach(async () => {
    await fsPromises.rm(rootDir, { recursive: true, force: true });
  });

  it("applies a ready patch artifact via git am and marks it applied", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    // Both repos start from the same base content so the patch applies cleanly.
    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(true);
    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "child change"
    );

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs ?? 0).toBeGreaterThan(0);
  }, 20_000);

  it("replays patch artifacts from an ancestor session dir without mutating metadata", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    // Both repos start from the same base content so the patch applies cleanly.
    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";

    const ancestorMinionId = "ancestor-minion";
    const currentMinionId = "current-minion";

    const latticeSessionsDir = path.join(rootDir, "sessions");
    const ancestorSessionDir = path.join(latticeSessionsDir, ancestorMinionId);
    const currentSessionDir = path.join(latticeSessionsDir, currentMinionId);

    await fsPromises.mkdir(ancestorSessionDir, { recursive: true });
    await fsPromises.mkdir(currentSessionDir, { recursive: true });

    const patchPath = getSidekickGitPatchMboxPath(ancestorSessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    const appliedAtMs = Date.now();

    await upsertSidekickGitPatchArtifact({
      minionId: ancestorMinionId,
      minionSessionDir: ancestorSessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: ancestorMinionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
        appliedAtMs,
      }),
    });

    // Minimal config.json to allow parentMinionId traversal for ancestor lookup.
    await fsPromises.writeFile(
      path.join(rootDir, "config.json"),
      JSON.stringify(
        {
          projects: [
            [
              "/tmp/test-project",
              {
                minions: [
                  { path: "/tmp/ancestor", id: ancestorMinionId, name: "ancestor" },
                  {
                    path: "/tmp/current",
                    id: currentMinionId,
                    name: "current",
                    parentMinionId: ancestorMinionId,
                  },
                ],
              },
            ],
          ],
        },
        null,
        2
      ),
      "utf-8"
    );

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      minionId: currentMinionId,
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: currentSessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(true);
    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "child change"
    );

    // The replay path must never mutate the ancestor patch metadata.
    const artifact = await readSidekickGitPatchArtifact(ancestorSessionDir, childTaskId);
    expect(artifact?.appliedAtMs).toBe(appliedAtMs);

    const replayArtifact = await readSidekickGitPatchArtifact(currentSessionDir, childTaskId);
    expect(replayArtifact).toBeNull();
  }, 20_000);

  it("supports dry_run without changing the repo or marking applied", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!(
      { task_id: childTaskId, dry_run: true },
      mockToolCallOptions
    )) as { success: boolean; error?: string };

    expect(result.success).toBe(true);

    // HEAD should remain on the base commit.
    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "base"
    );

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs).toBeUndefined();
  }, 20_000);

  it("returns a clear error when the patch does not apply cleanly", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello world", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    // Create a conflicting change in the target repo.
    await commitFile(targetRepo, "README.md", "hello there", "target change");

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      dryRun?: boolean;
      conflictPaths?: string[];
      failedPatchSubject?: string;
      error?: string;
      note?: string;
    };

    expect(result.success).toBe(false);
    expect(result.dryRun).toBe(false);
    expect(result.failedPatchSubject).toBe("child change");
    expect(result.conflictPaths ?? []).toContain("README.md");
    expect(result.error).toBeTruthy();
    expect(result.note).toContain("git am --continue");

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs).toBeUndefined();
  }, 20_000);

  it("returns structured conflict diagnostics on dry_run failure", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello world", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    // Create a conflicting change in the target repo.
    await commitFile(targetRepo, "README.md", "hello there", "target change");

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!(
      { task_id: childTaskId, dry_run: true },
      mockToolCallOptions
    )) as {
      success: boolean;
      dryRun?: boolean;
      conflictPaths?: string[];
      failedPatchSubject?: string;
      error?: string;
      note?: string;
    };

    expect(result.success).toBe(false);
    expect(result.dryRun).toBe(true);
    expect(result.failedPatchSubject).toBe("child change");
    expect(result.conflictPaths ?? []).toContain("README.md");
    expect(result.error).toBeTruthy();
    expect(result.note).toContain("Dry run failed");

    // Dry run should not affect the original worktree.
    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "target change"
    );

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs).toBeUndefined();
  }, 20_000);

  it("allows applying with force=true even when the working tree isn't clean", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    // Make the target repo "dirty" (untracked file). This should block without force=true.
    await fsPromises.writeFile(path.join(targetRepo, "UNTRACKED.md"), "untracked", "utf-8");

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const dirtyResult = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
      note?: string;
    };

    expect(dirtyResult.success).toBe(false);
    expect(dirtyResult.error).toBe("Working tree is not clean.");
    expect(dirtyResult.note).toContain("force=true");

    const forceResult = (await tool.execute!(
      { task_id: childTaskId, force: true },
      mockToolCallOptions
    )) as { success: boolean; error?: string };

    expect(forceResult.success).toBe(true);

    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "child change"
    );

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs ?? 0).toBeGreaterThan(0);
  }, 20_000);

  it("blocks applying when there are staged changes unless force=true", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    // Both repos start from the same base content so the patch applies cleanly.
    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: patchPath,
      }),
    });

    // Stage a change in the target repo. This should block without force=true.
    await fsPromises.writeFile(path.join(targetRepo, "STAGED.md"), "staged", "utf-8");
    execSync("git add -- STAGED.md", { cwd: targetRepo, stdio: "ignore" });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
      note?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toBe("Working tree is not clean.");
    expect(result.note).toContain("force=true");

    // The patch should not have been applied or marked applied.
    expect(execSync("git log -1 --pretty=%s", { cwd: targetRepo, encoding: "utf-8" }).trim()).toBe(
      "base"
    );

    const artifact = await readSidekickGitPatchArtifact(sessionDir, childTaskId);
    expect(artifact?.appliedAtMs).toBeUndefined();
  }, 20_000);

  it("ignores an unsafe mboxPath in artifact metadata", async () => {
    initGitRepo(childRepo);
    initGitRepo(targetRepo);

    // Both repos start from the same base content so the patch applies cleanly.
    await commitFile(childRepo, "README.md", "hello", "base");
    await commitFile(targetRepo, "README.md", "hello", "base");

    const baseSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    await commitFile(childRepo, "README.md", "hello\nworld", "child change");
    const headSha = execSync("git rev-parse HEAD", { cwd: childRepo, encoding: "utf-8" }).trim();

    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const patchPath = getSidekickGitPatchMboxPath(sessionDir, childTaskId);
    const patch = execSync(`git format-patch --stdout --binary ${baseSha}..${headSha}`, {
      cwd: childRepo,
      encoding: "buffer",
    });

    await fsPromises.mkdir(path.dirname(patchPath), { recursive: true });
    await fsPromises.writeFile(patchPath, patch);

    // Simulate corrupted metadata pointing outside the session dir.
    const unsafePath = path.join(rootDir, "outside-session.mbox");

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        baseCommitSha: baseSha,
        headCommitSha: headSha,
        commitCount: 1,
        mboxPath: unsafePath,
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: targetRepo,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
      note?: string;
    };

    expect(result.success).toBe(true);
    expect(result.note).toContain("Ignoring unsafe mboxPath");
  }, 20_000);

  it("returns clear errors for non-ready patch artifact statuses", async () => {
    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: rootDir,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "pending",
      }),
    });

    const pendingResult = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
    };

    expect(pendingResult.success).toBe(false);
    expect(pendingResult.error).toContain("pending");

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "failed",
        error: "boom",
      }),
    });

    const failedResult = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
    };

    expect(failedResult.success).toBe(false);
    expect(failedResult.error).toContain("boom");

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "skipped",
      }),
    });

    const skippedResult = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
    };

    expect(skippedResult.success).toBe(false);
    expect(skippedResult.error).toContain("skipped");
  });

  it("refuses to apply an already-applied patch unless force=true", async () => {
    const childTaskId = "child-task-1";
    const minionId = getTestDeps().minionId;

    await upsertSidekickGitPatchArtifact({
      minionId,
      minionSessionDir: sessionDir,
      childTaskId,
      updater: () => ({
        childTaskId,
        parentMinionId: minionId,
        createdAtMs: Date.now(),
        status: "ready",
        appliedAtMs: Date.now(),
      }),
    });

    const tool = createTaskApplyGitPatchTool({
      ...getTestDeps(),
      cwd: rootDir,
      runtime: createRuntime({ type: "local", srcBaseDir: "/tmp" }),
      runtimeTempDir: "/tmp",
      minionSessionDir: sessionDir,
    });

    const result = (await tool.execute!({ task_id: childTaskId }, mockToolCallOptions)) as {
      success: boolean;
      error?: string;
      note?: string;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Patch already applied");
    expect(result.note).toContain("force=true");
  });
});
