import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Config } from "@/node/config";
import { createRuntime } from "@/node/runtime/runtimeFactory";
import { execBuffered } from "@/node/utils/runtime/helpers";
import { MinionMcpOverridesService } from "./minionMcpOverridesService";

function getMinionPath(args: {
  srcDir: string;
  projectName: string;
  minionName: string;
}): string {
  return path.join(args.srcDir, args.projectName, args.minionName);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("MinionMcpOverridesService", () => {
  let tempDir: string;
  let config: Config;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lattice-mcp-overrides-test-"));
    config = new Config(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty overrides when no file and no legacy config", async () => {
    const projectPath = "/fake/project";
    const minionId = "ws-id";
    const minionName = "branch";

    const minionPath = getMinionPath({
      srcDir: config.srcDir,
      projectName: "project",
      minionName,
    });
    await fs.mkdir(minionPath, { recursive: true });

    await config.editConfig((cfg) => {
      cfg.projects.set(projectPath, {
        minions: [
          {
            path: minionPath,
            id: minionId,
            name: minionName,
            runtimeConfig: { type: "worktree", srcBaseDir: config.srcDir },
          },
        ],
      });
      return cfg;
    });

    const service = new MinionMcpOverridesService(config);
    const overrides = await service.getOverridesForMinion(minionId);

    expect(overrides).toEqual({});
    expect(await pathExists(path.join(minionPath, ".lattice", "mcp.local.jsonc"))).toBe(false);
  });

  it("adds .lattice/mcp.local.jsonc to git exclude when writing overrides", async () => {
    const projectPath = "/fake/project";
    const minionId = "ws-id";
    const minionName = "branch";

    const minionPath = getMinionPath({
      srcDir: config.srcDir,
      projectName: "project",
      minionName,
    });
    await fs.mkdir(minionPath, { recursive: true });

    const runtime = createRuntime({ type: "local" }, { projectPath: minionPath });
    const gitInitResult = await execBuffered(runtime, "git init", {
      cwd: minionPath,
      timeout: 10,
    });
    expect(gitInitResult.exitCode).toBe(0);

    await config.editConfig((cfg) => {
      cfg.projects.set(projectPath, {
        minions: [
          {
            path: minionPath,
            id: minionId,
            name: minionName,
            runtimeConfig: { type: "worktree", srcBaseDir: config.srcDir },
          },
        ],
      });
      return cfg;
    });

    const service = new MinionMcpOverridesService(config);

    const excludePathResult = await execBuffered(runtime, "git rev-parse --git-path info/exclude", {
      cwd: minionPath,
      timeout: 10,
    });
    expect(excludePathResult.exitCode).toBe(0);

    const excludePathRaw = excludePathResult.stdout.trim();
    expect(excludePathRaw.length).toBeGreaterThan(0);

    const excludePath = path.isAbsolute(excludePathRaw)
      ? excludePathRaw
      : path.join(minionPath, excludePathRaw);

    const before = (await pathExists(excludePath)) ? await fs.readFile(excludePath, "utf-8") : "";
    expect(before).not.toContain(".lattice/mcp.local.jsonc");

    await service.setOverridesForMinion(minionId, {
      disabledServers: ["server-a"],
    });

    const after = await fs.readFile(excludePath, "utf-8");
    expect(after).toContain(".lattice/mcp.local.jsonc");
  });
  it("persists overrides to .lattice/mcp.local.jsonc and reads them back", async () => {
    const projectPath = "/fake/project";
    const minionId = "ws-id";
    const minionName = "branch";

    const minionPath = getMinionPath({
      srcDir: config.srcDir,
      projectName: "project",
      minionName,
    });
    await fs.mkdir(minionPath, { recursive: true });

    await config.editConfig((cfg) => {
      cfg.projects.set(projectPath, {
        minions: [
          {
            path: minionPath,
            id: minionId,
            name: minionName,
            runtimeConfig: { type: "worktree", srcBaseDir: config.srcDir },
          },
        ],
      });
      return cfg;
    });

    const service = new MinionMcpOverridesService(config);

    await service.setOverridesForMinion(minionId, {
      disabledServers: ["server-a", "server-a"],
      toolAllowlist: { "server-b": ["tool1", "tool1", ""] },
    });

    const filePath = path.join(minionPath, ".lattice", "mcp.local.jsonc");
    expect(await pathExists(filePath)).toBe(true);

    const roundTrip = await service.getOverridesForMinion(minionId);
    expect(roundTrip).toEqual({
      disabledServers: ["server-a"],
      toolAllowlist: { "server-b": ["tool1"] },
    });
  });

  it("removes minion-local file when overrides are set to empty", async () => {
    const projectPath = "/fake/project";
    const minionId = "ws-id";
    const minionName = "branch";

    const minionPath = getMinionPath({
      srcDir: config.srcDir,
      projectName: "project",
      minionName,
    });
    await fs.mkdir(minionPath, { recursive: true });

    await config.editConfig((cfg) => {
      cfg.projects.set(projectPath, {
        minions: [
          {
            path: minionPath,
            id: minionId,
            name: minionName,
            runtimeConfig: { type: "worktree", srcBaseDir: config.srcDir },
          },
        ],
      });
      return cfg;
    });

    const service = new MinionMcpOverridesService(config);

    await service.setOverridesForMinion(minionId, {
      disabledServers: ["server-a"],
    });

    const filePath = path.join(minionPath, ".lattice", "mcp.local.jsonc");
    expect(await pathExists(filePath)).toBe(true);

    await service.setOverridesForMinion(minionId, {});
    expect(await pathExists(filePath)).toBe(false);
  });

  it("migrates legacy config.json overrides into minion-local file", async () => {
    const projectPath = "/fake/project";
    const minionId = "ws-id";
    const minionName = "branch";

    const minionPath = getMinionPath({
      srcDir: config.srcDir,
      projectName: "project",
      minionName,
    });
    await fs.mkdir(minionPath, { recursive: true });

    await config.editConfig((cfg) => {
      cfg.projects.set(projectPath, {
        minions: [
          {
            path: minionPath,
            id: minionId,
            name: minionName,
            runtimeConfig: { type: "worktree", srcBaseDir: config.srcDir },
            mcp: {
              disabledServers: ["server-a"],
              toolAllowlist: { "server-b": ["tool1"] },
            },
          },
        ],
      });
      return cfg;
    });

    const service = new MinionMcpOverridesService(config);
    const overrides = await service.getOverridesForMinion(minionId);

    expect(overrides).toEqual({
      disabledServers: ["server-a"],
      toolAllowlist: { "server-b": ["tool1"] },
    });

    // File written
    const filePath = path.join(minionPath, ".lattice", "mcp.local.jsonc");
    expect(await pathExists(filePath)).toBe(true);

    // Legacy config cleared
    const loaded = config.loadConfigOrDefault();
    const projectConfig = loaded.projects.get(projectPath);
    expect(projectConfig).toBeDefined();
    expect(projectConfig!.minions[0].mcp).toBeUndefined();
  });
});
