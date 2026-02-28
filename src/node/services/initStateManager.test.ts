import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Config } from "@/node/config";
import { InitStateManager } from "./initStateManager";
import type { MinionInitEvent } from "@/common/orpc/types";
import { INIT_HOOK_MAX_LINES } from "@/common/constants/toolLimits";
import { minionFileLocks } from "@/node/utils/concurrency/minionFileLocks";

describe("InitStateManager", () => {
  let tempDir: string;
  let config: Config;
  let manager: InitStateManager;

  beforeEach(async () => {
    // Create temp directory as lattice root
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "init-state-test-"));

    // Create sessions directory
    const sessionsDir = path.join(tempDir, "sessions");
    await fs.mkdir(sessionsDir, { recursive: true });

    // Config constructor takes rootDir directly
    config = new Config(tempDir);
    manager = new InitStateManager(config);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("lifecycle", () => {
    it("should track init hook lifecycle (start → output → end)", async () => {
      const minionId = "test-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      // Subscribe to events
      manager.on("init-start", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-output", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      // Start init
      manager.startInit(minionId, "/path/to/hook");
      expect(manager.getInitState(minionId)).toBeTruthy();
      expect(manager.getInitState(minionId)?.status).toBe("running");

      // Append output
      manager.appendOutput(minionId, "Installing deps...", false);
      manager.appendOutput(minionId, "Done!", false);
      expect(manager.getInitState(minionId)?.lines).toEqual([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "Installing deps...", isError: false, timestamp: expect.any(Number) },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "Done!", isError: false, timestamp: expect.any(Number) },
      ]);

      // End init (await to ensure event fires)
      await manager.endInit(minionId, 0);
      expect(manager.getInitState(minionId)?.status).toBe("success");
      expect(manager.getInitState(minionId)?.exitCode).toBe(0);

      // Verify events
      expect(events).toHaveLength(4); // start + 2 outputs + end
      expect(events[0].type).toBe("init-start");
      expect(events[1].type).toBe("init-output");
      expect(events[2].type).toBe("init-output");
      expect(events[3].type).toBe("init-end");
    });

    it("should track stderr lines with isError flag", () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      manager.appendOutput(minionId, "stdout line", false);
      manager.appendOutput(minionId, "stderr line", true);

      const state = manager.getInitState(minionId);
      expect(state?.lines).toEqual([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "stdout line", isError: false, timestamp: expect.any(Number) },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "stderr line", isError: true, timestamp: expect.any(Number) },
      ]);
    });

    it("should set status to error on non-zero exit code", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      await manager.endInit(minionId, 1);

      const state = manager.getInitState(minionId);
      expect(state?.status).toBe("error");
      expect(state?.exitCode).toBe(1);
    });
  });

  describe("persistence", () => {
    it("should persist state to disk on endInit", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      manager.appendOutput(minionId, "Line 1", false);
      manager.appendOutput(minionId, "Line 2", true);
      await manager.endInit(minionId, 0);

      // Read from disk
      const diskState = await manager.readInitStatus(minionId);
      expect(diskState).toBeTruthy();
      expect(diskState?.status).toBe("success");
      expect(diskState?.exitCode).toBe(0);
      expect(diskState?.lines).toEqual([
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "Line 1", isError: false, timestamp: expect.any(Number) },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        { line: "Line 2", isError: true, timestamp: expect.any(Number) },
      ]);
    });

    it("should replay from in-memory state when available", async () => {
      const minionId = "test-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      manager.on("init-start", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-output", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      // Create state
      manager.startInit(minionId, "/path/to/hook");
      manager.appendOutput(minionId, "Line 1", false);
      await manager.endInit(minionId, 0);

      events.length = 0; // Clear events

      // Replay from in-memory
      await manager.replayInit(minionId);

      expect(events).toHaveLength(3); // start + output + end
      expect(events[0].type).toBe("init-start");
      expect(events[1].type).toBe("init-output");
      expect(events[2].type).toBe("init-end");
    });

    it("should replay from disk when not in memory", async () => {
      const minionId = "test-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      // Create and persist state
      manager.startInit(minionId, "/path/to/hook");
      manager.appendOutput(minionId, "Line 1", false);
      manager.appendOutput(minionId, "Error line", true);
      await manager.endInit(minionId, 1);

      // Clear in-memory state (simulate process restart)
      manager.clearInMemoryState(minionId);
      expect(manager.getInitState(minionId)).toBeUndefined();

      // Subscribe to events
      manager.on("init-start", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-output", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      // Replay from disk
      await manager.replayInit(minionId);

      expect(events).toHaveLength(4); // start + 2 outputs + end
      expect(events[0].type).toBe("init-start");
      expect(events[1].type).toBe("init-output");
      expect((events[1] as { line: string }).line).toBe("Line 1");
      expect(events[2].type).toBe("init-output");
      expect((events[2] as { line: string }).line).toBe("Error line");
      expect((events[2] as { isError?: boolean }).isError).toBe(true);
      expect(events[3].type).toBe("init-end");
      expect((events[3] as { exitCode: number }).exitCode).toBe(1);
    });

    it("should not replay if no state exists", async () => {
      const minionId = "nonexistent-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      manager.on("init-start", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-output", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      await manager.replayInit(minionId);

      expect(events).toHaveLength(0);
    });
  });

  describe("cleanup", () => {
    it("should delete persisted state from disk", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      await manager.endInit(minionId, 0);

      // Verify state exists
      const stateBeforeDelete = await manager.readInitStatus(minionId);
      expect(stateBeforeDelete).toBeTruthy();

      // Delete
      await manager.deleteInitStatus(minionId);

      // Verify deleted
      const stateAfterDelete = await manager.readInitStatus(minionId);
      expect(stateAfterDelete).toBeNull();
    });

    it("should clear in-memory state", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      expect(manager.getInitState(minionId)).toBeTruthy();

      // Get the init promise before clearing
      const initPromise = manager.waitForInit(minionId);

      // Clear in-memory state (rejects internal promise, but waitForInit catches it)
      manager.clearInMemoryState(minionId);

      // Verify state is cleared
      expect(manager.getInitState(minionId)).toBeUndefined();

      // waitForInit never throws - it resolves even when init is canceled
      // This allows tools to proceed and fail naturally with their own errors
      // eslint-disable-next-line @typescript-eslint/await-thenable
      await expect(initPromise).resolves.toBeUndefined();
    });

    it("should not recreate session directory if queued persistence runs after state is cleared", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      const sessionDir = config.getSessionDir(minionId);
      await fs.mkdir(sessionDir, { recursive: true });

      let releaseLock: (() => void) | undefined;
      const lockHeld = minionFileLocks.withLock(minionId, async () => {
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      });

      // Let the lock callback run so releaseLock is set.
      await Promise.resolve();
      if (!releaseLock) {
        throw new Error("Expected minion file lock to be held");
      }

      // Queue endInit persistence behind the minion file lock.
      const endInitPromise = manager.endInit(minionId, 0);

      // Simulate minion removal: clear in-memory init state and delete the session directory.
      manager.clearInMemoryState(minionId);
      await fs.rm(sessionDir, { recursive: true, force: true });

      // Allow queued persistence to proceed.
      releaseLock();
      await lockHeld;
      await endInitPromise;

      expect(await manager.readInitStatus(minionId)).toBeNull();

      const sessionDirExists = await fs
        .access(sessionDir)
        .then(() => true)
        .catch(() => false);
      expect(sessionDirExists).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle appendOutput with no active state", () => {
      const minionId = "nonexistent-minion";
      // Should not throw
      manager.appendOutput(minionId, "Line", false);
    });

    it("should handle endInit with no active state", async () => {
      const minionId = "nonexistent-minion";
      // Should not throw
      await manager.endInit(minionId, 0);
    });

    it("should handle deleteInitStatus for nonexistent file", async () => {
      const minionId = "nonexistent-minion";
      // Should not throw
      await manager.deleteInitStatus(minionId);
    });
  });

  describe("truncation", () => {
    it("should truncate lines when exceeding INIT_HOOK_MAX_LINES", () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      // Add more lines than the limit
      const totalLines = INIT_HOOK_MAX_LINES + 100;
      for (let i = 0; i < totalLines; i++) {
        manager.appendOutput(minionId, `Line ${i}`, false);
      }

      const state = manager.getInitState(minionId);
      expect(state?.lines.length).toBe(INIT_HOOK_MAX_LINES);
      expect(state?.truncatedLines).toBe(100);

      // Should have the most recent lines (tail)
      const lastLine = state?.lines[INIT_HOOK_MAX_LINES - 1];
      expect(lastLine?.line).toBe(`Line ${totalLines - 1}`);

      // First line should be from when truncation started
      const firstLine = state?.lines[0];
      expect(firstLine?.line).toBe(`Line 100`);
    });

    it("should include truncatedLines in init-end event", async () => {
      const minionId = "test-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      manager.startInit(minionId, "/path/to/hook");

      // Add more lines than the limit
      for (let i = 0; i < INIT_HOOK_MAX_LINES + 50; i++) {
        manager.appendOutput(minionId, `Line ${i}`, false);
      }

      await manager.endInit(minionId, 0);

      expect(events).toHaveLength(1);
      expect((events[0] as { truncatedLines?: number }).truncatedLines).toBe(50);
    });

    it("should persist truncatedLines to disk", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      // Add more lines than the limit
      for (let i = 0; i < INIT_HOOK_MAX_LINES + 25; i++) {
        manager.appendOutput(minionId, `Line ${i}`, false);
      }

      await manager.endInit(minionId, 0);

      const diskState = await manager.readInitStatus(minionId);
      expect(diskState?.truncatedLines).toBe(25);
      expect(diskState?.lines.length).toBe(INIT_HOOK_MAX_LINES);
    });

    it("should not set truncatedLines when under limit", () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      // Add fewer lines than the limit
      for (let i = 0; i < 10; i++) {
        manager.appendOutput(minionId, `Line ${i}`, false);
      }

      const state = manager.getInitState(minionId);
      expect(state?.lines.length).toBe(10);
      expect(state?.truncatedLines).toBeUndefined();
    });

    it("should truncate old persisted data on replay (backwards compat)", async () => {
      const minionId = "test-minion";
      const events: Array<MinionInitEvent & { minionId: string }> = [];

      // Manually write a large init-status.json to simulate old data
      const sessionsDir = path.join(tempDir, "sessions", minionId);
      await fs.mkdir(sessionsDir, { recursive: true });

      const oldLineCount = INIT_HOOK_MAX_LINES + 200;
      const oldStatus = {
        status: "success",
        hookPath: "/path/to/hook",
        startTime: Date.now() - 1000,
        lines: Array.from({ length: oldLineCount }, (_, i) => ({
          line: `Old line ${i}`,
          isError: false,
          timestamp: Date.now() - 1000 + i,
        })),
        exitCode: 0,
        endTime: Date.now(),
        // No truncatedLines field - old format
      };
      await fs.writeFile(path.join(sessionsDir, "init-status.json"), JSON.stringify(oldStatus));

      // Subscribe to events
      manager.on("init-output", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );
      manager.on("init-end", (event: MinionInitEvent & { minionId: string }) =>
        events.push(event)
      );

      // Replay from disk
      await manager.replayInit(minionId);

      // Should only emit MAX_LINES output events (truncated)
      const outputEvents = events.filter((e) => e.type === "init-output");
      expect(outputEvents.length).toBe(INIT_HOOK_MAX_LINES);

      // init-end should include truncatedLines count
      const endEvent = events.find((e) => e.type === "init-end");
      expect((endEvent as { truncatedLines?: number }).truncatedLines).toBe(200);

      // First replayed line should be from the tail (old line 200)
      expect((outputEvents[0] as { line: string }).line).toBe("Old line 200");
    });
  });

  describe("waitForInit hook phase", () => {
    it("should not time out during runtime setup (intentional)", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      const waitPromise = manager.waitForInit(minionId);
      const result = await Promise.race([
        waitPromise.then(() => "done"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 150)),
      ]);

      expect(result).toBe("pending");

      await manager.endInit(minionId, 0);
      await waitPromise;
    });

    it("should start timeout once hook phase begins", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      manager.enterHookPhase(minionId);

      const state = manager.getInitState(minionId);
      if (!state) {
        throw new Error("Expected init state to exist");
      }
      state.hookStartTime = Date.now() - 5 * 60 * 1000 - 1000;

      const waitPromise = manager.waitForInit(minionId);
      const result = await Promise.race([
        waitPromise.then(() => "done"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 150)),
      ]);

      expect(result).toBe("done");

      await manager.endInit(minionId, 0);
      await waitPromise;
    });

    it("should set hookStartTime when entering hook phase", () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");

      manager.enterHookPhase(minionId);

      const state = manager.getInitState(minionId);
      if (!state) {
        throw new Error("Expected init state to exist");
      }

      expect(state.phase).toBe("init_hook");
      expect(state.hookStartTime).toBeDefined();
      expect(typeof state.hookStartTime).toBe("number");
    });
  });

  describe("waitForInit with abortSignal", () => {
    it("should return immediately if abortSignal is already aborted", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      const controller = new AbortController();
      controller.abort();

      const start = Date.now();
      await manager.waitForInit(minionId, controller.signal);
      expect(Date.now() - start).toBeLessThan(200); // Should be instant
    });

    it("should return when abortSignal fires during wait", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      const controller = new AbortController();

      const waitPromise = manager.waitForInit(minionId, controller.signal);
      setTimeout(() => controller.abort(), 20);

      const start = Date.now();
      await waitPromise;
      expect(Date.now() - start).toBeLessThan(300); // Should return quickly after abort
    });

    it("should clean up timeout when init completes first", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      const waitPromise = manager.waitForInit(minionId);

      await manager.endInit(minionId, 0);
      await waitPromise;
      // No spurious timeout error should be logged (verify via log spy if needed)
    });

    it("should work without abortSignal (backwards compat)", async () => {
      const minionId = "test-minion";
      manager.startInit(minionId, "/path/to/hook");
      const waitPromise = manager.waitForInit(minionId);

      // Complete init
      await manager.endInit(minionId, 0);
      await waitPromise;
      // Should complete without error
    });
  });
});
