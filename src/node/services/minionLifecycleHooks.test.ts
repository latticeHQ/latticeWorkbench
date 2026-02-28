import { describe, expect, it } from "bun:test";
import { MinionLifecycleHooks } from "./minionLifecycleHooks";
import { Err, Ok } from "@/common/types/result";
import type { MinionMetadata } from "@/common/types/minion";

const TEST_METADATA: MinionMetadata = {
  id: "ws",
  name: "ws",
  projectName: "proj",
  projectPath: "/tmp/proj",
  runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
};

describe("MinionLifecycleHooks", () => {
  it("runs beforeArchive hooks sequentially in registration order", async () => {
    const hooks = new MinionLifecycleHooks();

    const calls: string[] = [];
    hooks.registerBeforeArchive(() => {
      calls.push("first");
      return Promise.resolve(Ok(undefined));
    });
    hooks.registerBeforeArchive(() => {
      calls.push("second");
      return Promise.resolve(Ok(undefined));
    });

    const result = await hooks.runBeforeArchive({
      minionId: "ws",
      minionMetadata: TEST_METADATA,
    });

    expect(result.success).toBe(true);
    expect(calls).toEqual(["first", "second"]);
  });

  it("stops running hooks after the first Err result", async () => {
    const hooks = new MinionLifecycleHooks();

    const calls: string[] = [];
    hooks.registerBeforeArchive(() => {
      calls.push("first");
      return Promise.resolve(Ok(undefined));
    });
    hooks.registerBeforeArchive(() => {
      calls.push("second");
      return Promise.resolve(Err("nope\nextra"));
    });
    hooks.registerBeforeArchive(() => {
      calls.push("third");
      return Promise.resolve(Ok(undefined));
    });

    const result = await hooks.runBeforeArchive({
      minionId: "ws",
      minionMetadata: TEST_METADATA,
    });

    expect(calls).toEqual(["first", "second"]);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Hook errors are sanitized to a single line.
      expect(result.error).toBe("nope");
    }
  });

  it("returns Err when a hook throws (and sanitizes the thrown message)", async () => {
    const hooks = new MinionLifecycleHooks();

    hooks.registerBeforeArchive(() => Promise.reject(new Error("boom\nstack")));

    const result = await hooks.runBeforeArchive({
      minionId: "ws",
      minionMetadata: TEST_METADATA,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("beforeArchive hook threw: boom");
    }
  });

  it("runs afterUnarchive hooks sequentially (best-effort) even when one returns Err", async () => {
    const hooks = new MinionLifecycleHooks();

    const calls: string[] = [];
    hooks.registerAfterUnarchive(() => {
      calls.push("first");
      return Promise.resolve(Err("nope\nextra"));
    });
    hooks.registerAfterUnarchive(() => {
      calls.push("second");
      return Promise.resolve(Ok(undefined));
    });

    await hooks.runAfterUnarchive({
      minionId: "ws",
      minionMetadata: TEST_METADATA,
    });

    expect(calls).toEqual(["first", "second"]);
  });

  it("swallows thrown errors from afterUnarchive hooks and continues", async () => {
    const hooks = new MinionLifecycleHooks();

    const calls: string[] = [];
    hooks.registerAfterUnarchive(() => {
      calls.push("first");
      return Promise.reject(new Error("boom\nstack"));
    });
    hooks.registerAfterUnarchive(() => {
      calls.push("second");
      return Promise.resolve(Ok(undefined));
    });

    await hooks.runAfterUnarchive({
      minionId: "ws",
      minionMetadata: TEST_METADATA,
    });

    expect(calls).toEqual(["first", "second"]);
  });
});
