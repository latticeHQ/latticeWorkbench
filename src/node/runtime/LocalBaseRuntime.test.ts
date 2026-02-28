import { describe, expect, it } from "bun:test";
import * as os from "os";
import * as path from "path";
import { LocalBaseRuntime } from "./LocalBaseRuntime";
import type {
  MinionCreationParams,
  MinionCreationResult,
  MinionInitParams,
  MinionInitResult,
  MinionForkParams,
  MinionForkResult,
} from "./Runtime";

class TestLocalRuntime extends LocalBaseRuntime {
  getMinionPath(_projectPath: string, _minionName: string): string {
    return "/tmp/minion";
  }

  createMinion(_params: MinionCreationParams): Promise<MinionCreationResult> {
    return Promise.resolve({ success: true, minionPath: "/tmp/minion" });
  }

  initMinion(_params: MinionInitParams): Promise<MinionInitResult> {
    return Promise.resolve({ success: true });
  }

  renameMinion(
    _projectPath: string,
    _oldName: string,
    _newName: string
  ): Promise<
    { success: true; oldPath: string; newPath: string } | { success: false; error: string }
  > {
    return Promise.resolve({ success: true, oldPath: "/tmp/minion", newPath: "/tmp/minion" });
  }

  deleteMinion(
    _projectPath: string,
    _minionName: string,
    _force: boolean
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }> {
    return Promise.resolve({ success: true, deletedPath: "/tmp/minion" });
  }

  forkMinion(_params: MinionForkParams): Promise<MinionForkResult> {
    return Promise.resolve({
      success: true,
      minionPath: "/tmp/minion",
      sourceBranch: "main",
    });
  }
}

describe("LocalBaseRuntime.resolvePath", () => {
  it("should expand tilde to home directory", async () => {
    const runtime = new TestLocalRuntime();
    const resolved = await runtime.resolvePath("~");
    expect(resolved).toBe(os.homedir());
  });

  it("should expand tilde with path", async () => {
    const runtime = new TestLocalRuntime();
    const resolved = await runtime.resolvePath("~/..");
    const expected = path.dirname(os.homedir());
    expect(resolved).toBe(expected);
  });

  it("should resolve absolute paths", async () => {
    const runtime = new TestLocalRuntime();
    const resolved = await runtime.resolvePath("/tmp");
    expect(resolved).toBe("/tmp");
  });

  it("should resolve non-existent paths without checking existence", async () => {
    const runtime = new TestLocalRuntime();
    const resolved = await runtime.resolvePath("/this/path/does/not/exist/12345");
    // Should resolve to absolute path without checking if it exists
    expect(resolved).toBe("/this/path/does/not/exist/12345");
  });

  it("should resolve relative paths from cwd", async () => {
    const runtime = new TestLocalRuntime();
    const resolved = await runtime.resolvePath(".");
    // Should resolve to absolute path
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});
