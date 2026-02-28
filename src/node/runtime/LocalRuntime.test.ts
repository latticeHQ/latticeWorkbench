import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { LocalRuntime } from "./LocalRuntime";
import type { InitLogger, RuntimeStatusEvent } from "./Runtime";

// Minimal mock logger - matches pattern in initHook.test.ts
function createMockLogger(): InitLogger & { steps: string[] } {
  const steps: string[] = [];
  return {
    steps,
    logStep: (msg: string) => steps.push(msg),
    logStdout: () => {
      /* no-op for test */
    },
    logStderr: () => {
      /* no-op for test */
    },
    logComplete: () => {
      /* no-op for test */
    },
  };
}

describe("LocalRuntime", () => {
  // Use a temp directory for tests
  let testDir: string;

  beforeAll(async () => {
    // Resolve real path to handle macOS symlinks (/var -> /private/var)
    testDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "localruntime-test-")));
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("constructor and getMinionPath", () => {
    it("stores projectPath and returns it regardless of arguments", () => {
      const runtime = new LocalRuntime("/home/user/my-project");
      // Both arguments are ignored - always returns the project path
      expect(runtime.getMinionPath("/other/path", "some-branch")).toBe("/home/user/my-project");
      expect(runtime.getMinionPath("", "")).toBe("/home/user/my-project");
    });

    it("does not expand tilde (unlike WorktreeRuntime)", () => {
      // LocalRuntime stores the path as-is; callers must pass expanded paths
      const runtime = new LocalRuntime("~/my-project");
      expect(runtime.getMinionPath("", "")).toBe("~/my-project");
    });
  });

  describe("ensureReady", () => {
    it("allows non-git project directories to be ready", async () => {
      const runtime = new LocalRuntime(testDir);
      const events: RuntimeStatusEvent[] = [];

      const result = await runtime.ensureReady({
        statusSink: (event) => events.push(event),
      });

      expect(result).toEqual({ ready: true });
      expect(events[0]).toMatchObject({ phase: "checking", runtimeType: "local" });
      expect(events[events.length - 1]).toMatchObject({ phase: "ready", runtimeType: "local" });
    });
  });

  describe("createMinion", () => {
    it("succeeds when directory exists", async () => {
      const runtime = new LocalRuntime(testDir);
      const logger = createMockLogger();

      const result = await runtime.createMinion({
        projectPath: testDir,
        branchName: "main",
        trunkBranch: "main",
        directoryName: "main",
        initLogger: logger,
      });

      expect(result.success).toBe(true);
      expect(result.minionPath).toBe(testDir);
      expect(logger.steps.length).toBeGreaterThan(0);
      expect(logger.steps.some((s) => s.includes("project directory"))).toBe(true);
    });

    it("fails when directory does not exist", async () => {
      const nonExistentPath = path.join(testDir, "does-not-exist");
      const runtime = new LocalRuntime(nonExistentPath);
      const logger = createMockLogger();

      const result = await runtime.createMinion({
        projectPath: nonExistentPath,
        branchName: "main",
        trunkBranch: "main",
        directoryName: "main",
        initLogger: logger,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  describe("initMinion", () => {
    it("runs init hook by default, but skips when skipInitHook=true", async () => {
      const runtime = new LocalRuntime(testDir);

      const latticeDir = path.join(testDir, ".lattice");
      await fs.mkdir(latticeDir, { recursive: true });

      const markerPath = path.join(testDir, ".init-marker");
      await fs.rm(markerPath, { force: true });

      const hookPath = path.join(latticeDir, "init");
      await fs.writeFile(hookPath, "#!/usr/bin/env bash\n\necho ran > .init-marker\n");
      await fs.chmod(hookPath, 0o755);

      {
        const logger = createMockLogger();
        const result = await runtime.initMinion({
          projectPath: testDir,
          branchName: "main",
          trunkBranch: "main",
          minionPath: testDir,
          initLogger: logger,
        });
        expect(result.success).toBe(true);
      }

      const ranMarkerExists = await fs.access(markerPath).then(
        () => true,
        () => false
      );
      expect(ranMarkerExists).toBe(true);

      // Remove marker and re-run init with skip flag.
      await fs.rm(markerPath, { force: true });

      {
        const logger = createMockLogger();
        const result = await runtime.initMinion({
          projectPath: testDir,
          branchName: "main",
          trunkBranch: "main",
          minionPath: testDir,
          initLogger: logger,
          skipInitHook: true,
        });
        expect(result.success).toBe(true);
        expect(logger.steps).toContain("Skipping .lattice/init hook (disabled for this task)");
      }

      const skippedMarkerExists = await fs.access(markerPath).then(
        () => true,
        () => false
      );
      expect(skippedMarkerExists).toBe(false);
    });
  });

  describe("deleteMinion", () => {
    it("returns success without deleting anything", async () => {
      const runtime = new LocalRuntime(testDir);

      // Create a test file to verify it isn't deleted
      const testFile = path.join(testDir, "delete-test.txt");
      await fs.writeFile(testFile, "should not be deleted");

      const result = await runtime.deleteMinion(testDir, "main", false);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.deletedPath).toBe(testDir);
      }

      // Verify file still exists
      const fileStillExists = await fs.access(testFile).then(
        () => true,
        () => false
      );
      expect(fileStillExists).toBe(true);

      // Cleanup
      await fs.unlink(testFile);
    });

    it("returns success even with force=true (still no-op)", async () => {
      const runtime = new LocalRuntime(testDir);

      const result = await runtime.deleteMinion(testDir, "main", true);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.deletedPath).toBe(testDir);
      }
      // Directory should still exist
      const dirExists = await fs.access(testDir).then(
        () => true,
        () => false
      );
      expect(dirExists).toBe(true);
    });
  });

  describe("renameMinion", () => {
    it("is a no-op that returns success with same path", async () => {
      const runtime = new LocalRuntime(testDir);

      const result = await runtime.renameMinion(testDir, "old", "new");

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.oldPath).toBe(testDir);
        expect(result.newPath).toBe(testDir);
      }
    });
  });

  describe("forkMinion", () => {
    it("succeeds and returns project path (no worktree isolation)", async () => {
      const runtime = new LocalRuntime(testDir);
      const logger = createMockLogger();

      const result = await runtime.forkMinion({
        projectPath: testDir,
        sourceMinionName: "main",
        newMinionName: "feature",
        initLogger: logger,
      });

      expect(result.success).toBe(true);
      expect(result.minionPath).toBe(testDir);
      // sourceBranch is undefined for LocalRuntime (no git operations)
      expect(result.sourceBranch).toBeUndefined();
      // Should have logged steps
      expect(logger.steps.some((s) => s.includes("fork"))).toBe(true);
      expect(logger.steps.some((s) => s.includes("verified"))).toBe(true);
    });

    it("fails when project directory does not exist", async () => {
      const nonExistentPath = path.join(testDir, "does-not-exist");
      const runtime = new LocalRuntime(nonExistentPath);
      const logger = createMockLogger();

      const result = await runtime.forkMinion({
        projectPath: nonExistentPath,
        sourceMinionName: "main",
        newMinionName: "feature",
        initLogger: logger,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not exist");
    });
  });

  // Note: exec, stat, resolvePath, normalizePath are tested in the shared Runtime
  // interface tests (tests/runtime/runtime.test.ts matrix)

  describe("ensureDir", () => {
    it("creates directories recursively", async () => {
      const runtime = new LocalRuntime(testDir);

      const dirPath = path.join(testDir, "ensure-dir", "a", "b", "c");
      await runtime.ensureDir(dirPath);

      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);

      // Should be idempotent
      await runtime.ensureDir(dirPath);
    });
  });

  describe("tilde expansion in file operations", () => {
    it("stat expands tilde paths", async () => {
      const runtime = new LocalRuntime(testDir);

      // Create a file in home directory's .lattice folder
      const latticeDir = path.join(os.homedir(), ".lattice", "test-tilde");
      await fs.mkdir(latticeDir, { recursive: true });
      const testFile = path.join(latticeDir, "test.txt");
      await fs.writeFile(testFile, "test content");

      try {
        // Use tilde path - should work
        const stat = await runtime.stat("~/.lattice/test-tilde/test.txt");
        expect(stat.size).toBeGreaterThan(0);
        expect(stat.isDirectory).toBe(false);
      } finally {
        await fs.rm(latticeDir, { recursive: true, force: true });
      }
    });

    it("readFile expands tilde paths", async () => {
      const runtime = new LocalRuntime(testDir);

      // Create a file in home directory's .lattice folder
      const latticeDir = path.join(os.homedir(), ".lattice", "test-tilde");
      await fs.mkdir(latticeDir, { recursive: true });
      const testFile = path.join(latticeDir, "read-test.txt");
      const content = "hello from tilde path";
      await fs.writeFile(testFile, content);

      try {
        // Use tilde path - should work
        const stream = runtime.readFile("~/.lattice/test-tilde/read-test.txt");
        const reader = stream.getReader();
        let result = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          result += new TextDecoder().decode(value);
        }
        expect(result).toBe(content);
      } finally {
        await fs.rm(latticeDir, { recursive: true, force: true });
      }
    });

    it("writeFile expands tilde paths", async () => {
      const runtime = new LocalRuntime(testDir);

      // Create parent directory in home
      const latticeDir = path.join(os.homedir(), ".lattice", "test-tilde-write");
      await fs.mkdir(latticeDir, { recursive: true });

      try {
        // Use tilde path - should work
        const content = "written via tilde path";
        const stream = runtime.writeFile("~/.lattice/test-tilde-write/write-test.txt");
        const writer = stream.getWriter();
        await writer.write(new TextEncoder().encode(content));
        await writer.close();

        // Verify file was written to correct location
        const written = await fs.readFile(path.join(latticeDir, "write-test.txt"), "utf-8");
        expect(written).toBe(content);
      } finally {
        await fs.rm(latticeDir, { recursive: true, force: true });
      }
    });
  });
});
