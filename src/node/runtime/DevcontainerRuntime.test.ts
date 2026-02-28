import { describe, expect, it } from "bun:test";
import { DevcontainerRuntime } from "./DevcontainerRuntime";

interface RuntimeState {
  remoteHomeDir?: string;
  remoteUser?: string;
  remoteMinionFolder?: string;
  currentMinionPath?: string;
}

function createRuntime(state: RuntimeState): DevcontainerRuntime {
  const runtime = new DevcontainerRuntime({
    srcBaseDir: "/tmp/lattice",
    configPath: ".devcontainer/devcontainer.json",
  });
  const internal = runtime as unknown as RuntimeState;
  internal.remoteHomeDir = state.remoteHomeDir;
  internal.remoteUser = state.remoteUser;
  internal.remoteMinionFolder = state.remoteMinionFolder;
  internal.currentMinionPath = state.currentMinionPath;
  return runtime;
}

describe("DevcontainerRuntime.resolvePath", () => {
  it("resolves ~ to cached remoteHomeDir", async () => {
    const runtime = createRuntime({ remoteHomeDir: "/home/lattice" });
    expect(await runtime.resolvePath("~")).toBe("/home/lattice");
  });

  it("throws when home is unknown", async () => {
    const runtime = createRuntime({});
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test expect().rejects requires await
    await expect(runtime.resolvePath("~")).rejects.toThrow("container home directory unavailable");
  });

  it("resolves ~/path to cached remoteHomeDir", async () => {
    const runtime = createRuntime({ remoteHomeDir: "/opt/user" });
    expect(await runtime.resolvePath("~/.lattice")).toBe("/opt/user/.lattice");
  });

  it("falls back to /home/<user> without cached home", async () => {
    const runtime = createRuntime({ remoteUser: "node" });
    expect(await runtime.resolvePath("~")).toBe("/home/node");
  });

  it("falls back to /root for root user", async () => {
    const runtime = createRuntime({ remoteUser: "root" });
    expect(await runtime.resolvePath("~")).toBe("/root");
  });

  it("resolves relative paths against remoteMinionFolder", async () => {
    const runtime = createRuntime({ remoteMinionFolder: "/minions/demo" });
    expect(await runtime.resolvePath("./foo")).toBe("/minions/demo/foo");
    expect(await runtime.resolvePath("bar")).toBe("/minions/demo/bar");
  });

  it("resolves relative paths against / when no minion set", async () => {
    const runtime = createRuntime({});
    expect(await runtime.resolvePath("foo")).toBe("/foo");
  });

  it("passes absolute paths through", async () => {
    const runtime = createRuntime({});
    expect(await runtime.resolvePath("/tmp/test")).toBe("/tmp/test");
  });
});

describe("DevcontainerRuntime.quoteForContainer", () => {
  function quoteForContainer(runtime: DevcontainerRuntime, filePath: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (runtime as any).quoteForContainer(filePath);
  }

  it("uses $HOME expansion for tilde paths", () => {
    const runtime = createRuntime({});
    expect(quoteForContainer(runtime, "~/.lattice")).toBe('"$HOME/.lattice"');
  });
});

describe("DevcontainerRuntime.resolveContainerCwd", () => {
  // Access the private method for testing
  function resolveContainerCwd(
    runtime: DevcontainerRuntime,
    optionsCwd: string | undefined,
    minionFolder: string
  ): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (runtime as any).resolveContainerCwd(optionsCwd, minionFolder);
  }

  it("uses POSIX absolute path as cwd", () => {
    const runtime = createRuntime({ remoteMinionFolder: "/minions/project" });
    expect(resolveContainerCwd(runtime, "/tmp/test", "/host/minion")).toBe("/tmp/test");
  });

  it("rejects Windows drive letter paths and falls back to minion", () => {
    const runtime = createRuntime({ remoteMinionFolder: "/minions/project" });
    expect(resolveContainerCwd(runtime, "C:\\Users\\dev", "/host/minion")).toBe(
      "/minions/project"
    );
  });

  it("rejects paths with backslashes and falls back to minion", () => {
    const runtime = createRuntime({ remoteMinionFolder: "/minions/project" });
    expect(resolveContainerCwd(runtime, "some\\path", "/host/minion")).toBe(
      "/minions/project"
    );
  });

  it("falls back to minionFolder when remoteMinionFolder not set", () => {
    const runtime = createRuntime({});
    expect(resolveContainerCwd(runtime, "C:\\", "/host/minion")).toBe("/host/minion");
  });

  it("falls back when cwd is undefined", () => {
    const runtime = createRuntime({ remoteMinionFolder: "/minions/project" });
    expect(resolveContainerCwd(runtime, undefined, "/host/minion")).toBe("/minions/project");
  });
});

describe("DevcontainerRuntime.resolveHostPathForMounted", () => {
  function resolveHostPathForMounted(
    runtime: DevcontainerRuntime,
    filePath: string
  ): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (runtime as any).resolveHostPathForMounted(filePath);
  }

  it("accepts Windows host paths under the minion root", () => {
    const runtime = createRuntime({ currentMinionPath: "C:\\ws\\proj" });
    const filePath = "C:\\ws\\proj\\.lattice\\mcp.local.jsonc";
    expect(resolveHostPathForMounted(runtime, filePath)).toBe(filePath);
  });
});
describe("DevcontainerRuntime.mapHostPathToContainer", () => {
  // Access the private method for testing
  function mapHostPathToContainer(runtime: DevcontainerRuntime, hostPath: string): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
    return (runtime as any).mapHostPathToContainer(hostPath);
  }

  it("maps host minion root to container minion", () => {
    const runtime = createRuntime({
      remoteMinionFolder: "/minions/project",
      currentMinionPath: "/home/user/lattice/project/branch",
    });
    expect(mapHostPathToContainer(runtime, "/home/user/lattice/project/branch")).toBe(
      "/minions/project"
    );
  });

  it("maps host subpath to container subpath", () => {
    const runtime = createRuntime({
      remoteMinionFolder: "/minions/project",
      currentMinionPath: "/home/user/lattice/project/branch",
    });
    expect(mapHostPathToContainer(runtime, "/home/user/lattice/project/branch/src/file.ts")).toBe(
      "/minions/project/src/file.ts"
    );
  });

  it("normalizes Windows backslashes to forward slashes", () => {
    const runtime = createRuntime({
      remoteMinionFolder: "/minions/project",
      currentMinionPath: "C:\\Users\\dev\\lattice\\project\\branch",
    });
    // Windows-style path with backslashes should map correctly
    expect(
      mapHostPathToContainer(runtime, "C:\\Users\\dev\\lattice\\project\\branch\\src\\file.ts")
    ).toBe("/minions/project/src/file.ts");
  });

  it("returns null for paths outside minion", () => {
    const runtime = createRuntime({
      remoteMinionFolder: "/minions/project",
      currentMinionPath: "/home/user/lattice/project/branch",
    });
    expect(mapHostPathToContainer(runtime, "/tmp/other")).toBeNull();
  });

  it("returns null when minion not set", () => {
    const runtime = createRuntime({});
    expect(mapHostPathToContainer(runtime, "/some/path")).toBeNull();
  });
});
