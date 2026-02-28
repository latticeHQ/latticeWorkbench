import { describe, expect, it, mock, beforeEach, afterEach, spyOn, type Mock } from "bun:test";
import type { LatticeService } from "@/node/services/latticeService";
import type { RuntimeConfig } from "@/common/types/runtime";
import * as runtimeHelpers from "@/node/utils/runtime/helpers";

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
import type { RuntimeStatusEvent } from "./Runtime";

import { LatticeSSHRuntime, type LatticeSSHRuntimeConfig } from "./LatticeSSHRuntime";
import { SSHRuntime } from "./SSHRuntime";
import { createSSHTransport } from "./transports";

/**
 * Create a minimal mock LatticeService for testing.
 * Only mocks methods used by the tested code paths.
 */
function createMockLatticeService(overrides?: Partial<LatticeService>): LatticeService {
  const provisioningSession = {
    token: "token",
    dispose: mock(() => Promise.resolve()),
  };

  return {
    createMinion: mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        // default: no output
        for (const line of [] as string[]) {
          yield line;
        }
      })()
    ),
    deleteMinion: mock(() => Promise.resolve()),
    deleteMinionEventually: mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    ),
    ensureProvisioningSession: mock(() => Promise.resolve(provisioningSession)),
    takeProvisioningSession: mock(() => provisioningSession),
    disposeProvisioningSession: mock(() => Promise.resolve()),
    fetchDeploymentSshConfig: mock(() => Promise.resolve({ hostnameSuffix: "lattice" })),
    ensureSSHConfig: mock(() => Promise.resolve()),
    getMinionStatus: mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "running" as const })
    ),
    listMinions: mock(() => Promise.resolve({ ok: true, minions: [] })),
    waitForStartupScripts: mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        // default: no output (startup scripts completed)
        for (const line of [] as string[]) {
          yield line;
        }
      })()
    ),
    minionExists: mock(() => Promise.resolve(false)),
    ...overrides,
  } as unknown as LatticeService;
}

/**
 * Create a LatticeSSHRuntime with minimal config for testing.
 */
function createRuntime(
  latticeConfig: {
    existingMinion?: boolean;
    minionName?: string;
    template?: string;
  },
  latticeService: LatticeService
): LatticeSSHRuntime {
  const template = "template" in latticeConfig ? latticeConfig.template : "default-template";

  const config: LatticeSSHRuntimeConfig = {
    host: "placeholder.lattice",
    srcBaseDir: "~/src",
    lattice: {
      existingMinion: latticeConfig.existingMinion ?? false,
      minionName: latticeConfig.minionName,
      template,
    },
  };
  const transport = createSSHTransport(config, false);
  return new LatticeSSHRuntime(config, transport, latticeService);
}

/**
 * Create an SSH+Lattice RuntimeConfig for finalizeConfig tests.
 */
function createSSHLatticeConfig(lattice: {
  existingMinion?: boolean;
  minionName?: string;
}): RuntimeConfig {
  return {
    type: "ssh",
    host: "placeholder.lattice",
    srcBaseDir: "~/src",
    lattice: {
      existingMinion: lattice.existingMinion ?? false,
      minionName: lattice.minionName,
      template: "default-template",
    },
  };
}

// =============================================================================
// Test Suite 1: finalizeConfig (name/host derivation)
// =============================================================================

describe("LatticeSSHRuntime.finalizeConfig", () => {
  let latticeService: LatticeService;
  let runtime: LatticeSSHRuntime;

  beforeEach(() => {
    latticeService = createMockLatticeService();
    runtime = createRuntime({}, latticeService);
  });

  describe("new minion mode", () => {
    it("uses hostname suffix from deployment SSH config", async () => {
      const fetchDeploymentSshConfig = mock(() => Promise.resolve({ hostnameSuffix: "corp" }));
      latticeService = createMockLatticeService({ fetchDeploymentSshConfig });
      runtime = createRuntime({}, latticeService);

      const config = createSSHLatticeConfig({ existingMinion: false });
      const result = await runtime.finalizeConfig("my-feature", config);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === "ssh") {
        expect(result.data.host).toBe("lattice-my-feature.corp");
      }
      expect(fetchDeploymentSshConfig).toHaveBeenCalled();
    });
    it("derives Lattice name from branch name when not provided", async () => {
      const config = createSSHLatticeConfig({ existingMinion: false });
      const result = await runtime.finalizeConfig("my-feature", config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("ssh");
        if (result.data.type === "ssh") {
          expect(result.data.lattice?.minionName).toBe("lattice-my-feature");
          expect(result.data.host).toBe("lattice-my-feature.lattice");
        }
      }
    });

    it("converts underscores to hyphens", async () => {
      const config = createSSHLatticeConfig({ existingMinion: false });
      const result = await runtime.finalizeConfig("my_feature_branch", config);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === "ssh") {
        expect(result.data.lattice?.minionName).toBe("lattice-my-feature-branch");
        expect(result.data.host).toBe("lattice-my-feature-branch.lattice");
      }
    });

    it("collapses multiple hyphens and trims leading/trailing", async () => {
      const config = createSSHLatticeConfig({ existingMinion: false });
      const result = await runtime.finalizeConfig("--my--feature--", config);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === "ssh") {
        expect(result.data.lattice?.minionName).toBe("lattice-my-feature");
      }
    });

    it("rejects names that fail regex after conversion", async () => {
      const config = createSSHLatticeConfig({ existingMinion: false });
      // Name with special chars that can't form a valid Lattice name (only hyphens/underscores become invalid)
      const result = await runtime.finalizeConfig("@#$%", config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("cannot be converted to a valid Lattice name");
      }
    });

    it("returns error when deployment SSH config fetch fails", async () => {
      const provisioningSession = {
        token: "token",
        dispose: mock(() => Promise.resolve()),
      };
      const ensureProvisioningSession = mock(() => Promise.resolve(provisioningSession));
      const fetchDeploymentSshConfig = mock(() => Promise.reject(new Error("nope")));
      const disposeProvisioningSession = mock(() => Promise.resolve());

      latticeService = createMockLatticeService({
        ensureProvisioningSession,
        fetchDeploymentSshConfig,
        disposeProvisioningSession,
      });
      runtime = createRuntime({}, latticeService);

      const config = createSSHLatticeConfig({ existingMinion: false });
      const result = await runtime.finalizeConfig("branch", config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("Failed to read Lattice deployment SSH config");
        expect(result.error).toContain("nope");
      }
      expect(ensureProvisioningSession).toHaveBeenCalledWith("lattice-branch");
      expect(fetchDeploymentSshConfig).toHaveBeenCalledWith(provisioningSession);
      expect(disposeProvisioningSession).toHaveBeenCalledWith("lattice-branch");
    });
    it("uses provided minionName over branch name", async () => {
      const config = createSSHLatticeConfig({
        existingMinion: false,
        minionName: "custom-name",
      });
      const result = await runtime.finalizeConfig("branch-name", config);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === "ssh") {
        expect(result.data.lattice?.minionName).toBe("custom-name");
        expect(result.data.host).toBe("custom-name.lattice");
      }
    });
  });

  describe("existing minion mode", () => {
    it("requires minionName to be provided", async () => {
      const config = createSSHLatticeConfig({ existingMinion: true });
      const result = await runtime.finalizeConfig("branch-name", config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("required for existing minions");
      }
    });

    it("keeps provided minionName and sets host", async () => {
      const config = createSSHLatticeConfig({
        existingMinion: true,
        minionName: "existing-ws",
      });
      const result = await runtime.finalizeConfig("branch-name", config);

      expect(result.success).toBe(true);
      if (result.success && result.data.type === "ssh") {
        expect(result.data.lattice?.minionName).toBe("existing-ws");
        expect(result.data.host).toBe("existing-ws.lattice");
      }
    });
  });

  it("passes through non-SSH configs unchanged", async () => {
    const config: RuntimeConfig = { type: "local" };
    const result = await runtime.finalizeConfig("branch", config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(config);
    }
  });

  it("passes through SSH configs without lattice unchanged", async () => {
    const config: RuntimeConfig = { type: "ssh", host: "example.com", srcBaseDir: "/src" };
    const result = await runtime.finalizeConfig("branch", config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(config);
    }
  });
});

// =============================================================================
// Test Suite 2: deleteMinion behavior
// =============================================================================

describe("LatticeSSHRuntime.deleteMinion", () => {
  /**
   * For deleteMinion tests, we mock SSHRuntime.prototype.deleteMinion
   * to control the parent class behavior.
   */
  let sshDeleteSpy: Mock<typeof SSHRuntime.prototype.deleteMinion>;

  beforeEach(() => {
    sshDeleteSpy = spyOn(SSHRuntime.prototype, "deleteMinion").mockResolvedValue({
      success: true,
      deletedPath: "/path",
    });
  });

  afterEach(() => {
    sshDeleteSpy.mockRestore();
  });

  it("never calls latticeService.deleteMinionEventually when existingMinion=true", async () => {
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: true, minionName: "existing-ws" },
      latticeService
    );

    await runtime.deleteMinion("/project", "ws", false);
    expect(deleteMinionEventually).not.toHaveBeenCalled();
  });

  it("skips Lattice deletion when minionName is not set", async () => {
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ deleteMinionEventually });

    // No minionName provided
    const runtime = createRuntime({ existingMinion: false }, latticeService);

    const result = await runtime.deleteMinion("/project", "ws", false);
    expect(deleteMinionEventually).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("skips Lattice deletion when SSH delete fails and force=false", async () => {
    sshDeleteSpy.mockResolvedValue({ success: false, error: "dirty minion" });

    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);
    expect(deleteMinionEventually).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("calls Lattice deletion (no SSH) when force=true", async () => {
    sshDeleteSpy.mockResolvedValue({ success: false, error: "dirty minion" });

    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    await runtime.deleteMinion("/project", "ws", true);
    expect(sshDeleteSpy).not.toHaveBeenCalled();
    expect(deleteMinionEventually).toHaveBeenCalledWith(
      "my-ws",
      expect.objectContaining({ waitForExistence: true, waitForExistenceTimeoutMs: 10_000 })
    );
  });

  it("returns combined error when SSH succeeds but Lattice delete fails", async () => {
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: false as const, error: "Lattice API error" })
    );
    const latticeService = createMockLatticeService({ deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("SSH delete succeeded");
      expect(result.error).toContain("Lattice API error");
    }
  });

  it("succeeds immediately when Lattice minion is already deleted", async () => {
    // getMinionStatus returns { kind: "not_found" } when minion doesn't exist
    const getMinionStatus = mock(() => Promise.resolve({ kind: "not_found" as const }));
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ getMinionStatus, deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);

    // Should succeed without calling SSH delete or Lattice delete
    expect(result.success).toBe(true);
    expect(sshDeleteSpy).not.toHaveBeenCalled();
    expect(deleteMinionEventually).not.toHaveBeenCalled();
  });

  it("proceeds with SSH cleanup when status check fails with API error", async () => {
    // API error (auth, network) - should NOT treat as "already deleted"
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "error" as const, error: "lattice timed out" })
    );
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ getMinionStatus, deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);

    // Should proceed with SSH cleanup (which succeeds), then Lattice delete
    expect(sshDeleteSpy).toHaveBeenCalled();
    expect(deleteMinionEventually).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it("deletes stopped Lattice minion without SSH cleanup", async () => {
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "stopped" as const })
    );
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ getMinionStatus, deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);

    expect(result.success).toBe(true);
    expect(sshDeleteSpy).not.toHaveBeenCalled();
    expect(deleteMinionEventually).toHaveBeenCalledWith(
      "my-ws",
      expect.objectContaining({ waitForExistence: false })
    );
  });
  it("succeeds immediately when Lattice minion status is 'deleting'", async () => {
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "deleting" as const })
    );
    const deleteMinionEventually = mock(() =>
      Promise.resolve({ success: true as const, data: undefined })
    );
    const latticeService = createMockLatticeService({ getMinionStatus, deleteMinionEventually });

    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws" },
      latticeService
    );

    const result = await runtime.deleteMinion("/project", "ws", false);

    // Should succeed without calling SSH delete or Lattice delete (minion already dying)
    expect(result.success).toBe(true);
    expect(sshDeleteSpy).not.toHaveBeenCalled();
    expect(deleteMinionEventually).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Test Suite 3: validateBeforePersist (collision detection)
// =============================================================================

describe("LatticeSSHRuntime.validateBeforePersist", () => {
  it("returns error when Lattice minion already exists", async () => {
    const minionExists = mock(() => Promise.resolve(true));
    const latticeService = createMockLatticeService({ minionExists });
    const runtime = createRuntime({}, latticeService);

    const config = createSSHLatticeConfig({
      existingMinion: false,
      minionName: "my-ws",
    });

    const result = await runtime.validateBeforePersist("branch", config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("already exists");
    }
    expect(minionExists).toHaveBeenCalledWith("my-ws");
  });

  it("skips collision check for existingMinion=true", async () => {
    const minionExists = mock(() => Promise.resolve(true));
    const latticeService = createMockLatticeService({ minionExists });
    const runtime = createRuntime({}, latticeService);

    const config = createSSHLatticeConfig({
      existingMinion: true,
      minionName: "existing-ws",
    });

    const result = await runtime.validateBeforePersist("branch", config);
    expect(result.success).toBe(true);
    expect(minionExists).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Test Suite 4: postCreateSetup (provisioning)
// =============================================================================

describe("LatticeSSHRuntime.postCreateSetup", () => {
  let execBufferedSpy: ReturnType<typeof spyOn<typeof runtimeHelpers, "execBuffered">>;

  beforeEach(() => {
    execBufferedSpy = spyOn(runtimeHelpers, "execBuffered").mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
      duration: 0,
    });
  });

  afterEach(() => {
    execBufferedSpy.mockRestore();
  });

  it("creates a new Lattice minion and prepares the directory", async () => {
    const createMinion = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "build line 1";
        yield "build line 2";
      })()
    );
    const ensureSSHConfig = mock(() => Promise.resolve());
    const provisioningSession = {
      token: "token",
      dispose: mock(() => Promise.resolve()),
    };
    const takeProvisioningSession = mock(() => provisioningSession);

    // Start with minion not found, then return running after creation
    let minionCreated = false;
    const getMinionStatus = mock(() =>
      Promise.resolve(
        minionCreated
          ? { kind: "ok" as const, status: "running" as const }
          : { kind: "not_found" as const }
      )
    );

    const latticeService = createMockLatticeService({
      createMinion,
      ensureSSHConfig,
      getMinionStatus,
      takeProvisioningSession,
    });
    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws", template: "my-template" },
      latticeService
    );

    // Before postCreateSetup, ensureReady should fail (minion doesn't exist on server)
    const beforeReady = await runtime.ensureReady();
    expect(beforeReady.ready).toBe(false);
    if (!beforeReady.ready) {
      expect(beforeReady.errorType).toBe("runtime_not_ready");
    }

    // Simulate minion being created by postCreateSetup
    minionCreated = true;

    const steps: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const initLogger = {
      logStep: (s: string) => {
        steps.push(s);
      },
      logStdout: (s: string) => {
        stdout.push(s);
      },
      logStderr: (s: string) => {
        stderr.push(s);
      },
      logComplete: noop,
    };

    await runtime.postCreateSetup({
      initLogger,
      projectPath: "/project",
      branchName: "branch",
      trunkBranch: "main",
      minionPath: "/home/user/src/my-project/my-ws",
    });

    expect(takeProvisioningSession).toHaveBeenCalledWith("my-ws");
    expect(createMinion).toHaveBeenCalledWith(
      "my-ws",
      "my-template",
      undefined,
      undefined,
      undefined,
      provisioningSession
    );
    expect(provisioningSession.dispose).toHaveBeenCalled();
    expect(ensureSSHConfig).toHaveBeenCalled();
    expect(execBufferedSpy).toHaveBeenCalled();

    // After postCreateSetup, ensureReady should succeed (minion exists on server)
    const afterReady = await runtime.ensureReady();
    expect(afterReady.ready).toBe(true);

    expect(stdout).toEqual(["build line 1", "build line 2"]);
    expect(stderr).toEqual([]);
    expect(steps.join("\n")).toContain("Creating Lattice minion");
    expect(steps.join("\n")).toContain("Configuring SSH");
    expect(steps.join("\n")).toContain("Preparing minion directory");
  });

  it("disposes provisioning session when minion creation fails", async () => {
    const createMinion = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        yield "Starting minion...";
        await Promise.resolve();
        throw new Error("boom");
      })()
    );
    const provisioningSession = {
      token: "token",
      dispose: mock(() => Promise.resolve()),
    };
    const takeProvisioningSession = mock(() => provisioningSession);

    const latticeService = createMockLatticeService({
      createMinion,
      takeProvisioningSession,
    });
    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws", template: "my-template" },
      latticeService
    );

    let caughtError: Error | undefined;
    try {
      await runtime.postCreateSetup({
        initLogger: {
          logStep: noop,
          logStdout: noop,
          logStderr: noop,
          logComplete: noop,
        },
        projectPath: "/project",
        branchName: "branch",
        trunkBranch: "main",
        minionPath: "/home/user/src/my-project/my-ws",
      });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toContain("Failed to create Lattice minion");
    expect(takeProvisioningSession).toHaveBeenCalledWith("my-ws");
    expect(createMinion).toHaveBeenCalledWith(
      "my-ws",
      "my-template",
      undefined,
      undefined,
      undefined,
      provisioningSession
    );
    expect(provisioningSession.dispose).toHaveBeenCalled();
  });

  it("skips minion creation when existingMinion=true and minion is running", async () => {
    const createMinion = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "should not happen";
      })()
    );
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "Already running";
      })()
    );
    const ensureSSHConfig = mock(() => Promise.resolve());
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "running" as const })
    );

    const latticeService = createMockLatticeService({
      createMinion,
      waitForStartupScripts,
      ensureSSHConfig,
      getMinionStatus,
    });
    const runtime = createRuntime(
      { existingMinion: true, minionName: "existing-ws" },
      latticeService
    );

    await runtime.postCreateSetup({
      initLogger: {
        logStep: noop,
        logStdout: noop,
        logStderr: noop,
        logComplete: noop,
      },
      projectPath: "/project",
      branchName: "branch",
      trunkBranch: "main",
      minionPath: "/home/user/src/my-project/existing-ws",
    });

    expect(createMinion).not.toHaveBeenCalled();
    // waitForStartupScripts is called (it handles running minions quickly)
    expect(waitForStartupScripts).toHaveBeenCalled();
    expect(ensureSSHConfig).toHaveBeenCalled();
    expect(execBufferedSpy).toHaveBeenCalled();
  });

  it("uses waitForStartupScripts for existing stopped minion (auto-starts via lattice ssh)", async () => {
    const createMinion = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "should not happen";
      })()
    );
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "Starting minion...";
        yield "Build complete";
        yield "Startup scripts finished";
      })()
    );
    const ensureSSHConfig = mock(() => Promise.resolve());
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "stopped" as const })
    );

    const latticeService = createMockLatticeService({
      createMinion,
      waitForStartupScripts,
      ensureSSHConfig,
      getMinionStatus,
    });
    const runtime = createRuntime(
      { existingMinion: true, minionName: "existing-ws" },
      latticeService
    );

    const loggedStdout: string[] = [];
    await runtime.postCreateSetup({
      initLogger: {
        logStep: noop,
        logStdout: (line) => loggedStdout.push(line),
        logStderr: noop,
        logComplete: noop,
      },
      projectPath: "/project",
      branchName: "branch",
      trunkBranch: "main",
      minionPath: "/home/user/src/my-project/existing-ws",
    });

    expect(createMinion).not.toHaveBeenCalled();
    expect(waitForStartupScripts).toHaveBeenCalled();
    expect(loggedStdout).toContain("Starting minion...");
    expect(loggedStdout).toContain("Startup scripts finished");
    expect(ensureSSHConfig).toHaveBeenCalled();
  });

  it("polls until stopping minion becomes stopped before connecting", async () => {
    let pollCount = 0;
    const getMinionStatus = mock(() => {
      pollCount++;
      // First 2 calls return "stopping", then "stopped"
      if (pollCount <= 2) {
        return Promise.resolve({ kind: "ok" as const, status: "stopping" as const });
      }
      return Promise.resolve({ kind: "ok" as const, status: "stopped" as const });
    });
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "Ready";
      })()
    );
    const ensureSSHConfig = mock(() => Promise.resolve());

    const latticeService = createMockLatticeService({
      getMinionStatus,
      waitForStartupScripts,
      ensureSSHConfig,
    });

    const runtime = createRuntime(
      { existingMinion: true, minionName: "stopping-ws" },
      latticeService
    );

    // Avoid real sleeps in this polling test
    interface RuntimeWithSleep {
      sleep: (ms: number, abortSignal?: AbortSignal) => Promise<void>;
    }
    spyOn(runtime as unknown as RuntimeWithSleep, "sleep").mockResolvedValue(undefined);

    const loggedSteps: string[] = [];
    await runtime.postCreateSetup({
      initLogger: {
        logStep: (step) => loggedSteps.push(step),
        logStdout: noop,
        logStderr: noop,
        logComplete: noop,
      },
      projectPath: "/project",
      branchName: "branch",
      trunkBranch: "main",
      minionPath: "/home/user/src/my-project/stopping-ws",
    });

    // Should have polled status multiple times
    expect(pollCount).toBeGreaterThan(2);
    expect(loggedSteps.some((s) => s.includes("Waiting for Lattice minion"))).toBe(true);
    expect(waitForStartupScripts).toHaveBeenCalled();
  });

  it("throws when minionName is missing", () => {
    const latticeService = createMockLatticeService();
    const runtime = createRuntime({ existingMinion: false, template: "tmpl" }, latticeService);

    return expect(
      runtime.postCreateSetup({
        initLogger: {
          logStep: noop,
          logStdout: noop,
          logStderr: noop,
          logComplete: noop,
        },
        projectPath: "/project",
        branchName: "branch",
        trunkBranch: "main",
        minionPath: "/home/user/src/my-project/ws",
      })
    ).rejects.toThrow("Lattice minion name is required");
  });

  it("throws when template is missing for new minions", () => {
    const latticeService = createMockLatticeService();
    const runtime = createRuntime(
      { existingMinion: false, minionName: "my-ws", template: undefined },
      latticeService
    );

    return expect(
      runtime.postCreateSetup({
        initLogger: {
          logStep: noop,
          logStdout: noop,
          logStderr: noop,
          logComplete: noop,
        },
        projectPath: "/project",
        branchName: "branch",
        trunkBranch: "main",
        minionPath: "/home/user/src/my-project/ws",
      })
    ).rejects.toThrow("Lattice template is required");
  });
});

// =============================================================================
// Test Suite 5: ensureReady (runtime readiness + status events)
// =============================================================================

describe("LatticeSSHRuntime.ensureReady", () => {
  it("returns ready when minion is already running", async () => {
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "running" as const })
    );
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "should not be called";
      })()
    );
    const latticeService = createMockLatticeService({ getMinionStatus, waitForStartupScripts });

    const runtime = createRuntime(
      { existingMinion: true, minionName: "my-ws" },
      latticeService
    );

    const events: RuntimeStatusEvent[] = [];
    const result = await runtime.ensureReady({
      statusSink: (e) => events.push(e),
    });

    expect(result).toEqual({ ready: true });
    expect(getMinionStatus).toHaveBeenCalled();
    // Short-circuited because status is already "running"
    expect(waitForStartupScripts).not.toHaveBeenCalled();
    expect(events.map((e) => e.phase)).toEqual(["checking", "ready"]);
    expect(events[0]?.runtimeType).toBe("ssh");
  });

  it("connects via waitForStartupScripts when status is stopped (auto-starts)", async () => {
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "stopped" as const })
    );
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "Starting minion...";
        yield "Minion started";
      })()
    );
    const latticeService = createMockLatticeService({ getMinionStatus, waitForStartupScripts });

    const runtime = createRuntime(
      { existingMinion: true, minionName: "my-ws" },
      latticeService
    );

    const events: RuntimeStatusEvent[] = [];
    const result = await runtime.ensureReady({
      statusSink: (e) => events.push(e),
    });

    expect(result).toEqual({ ready: true });
    expect(waitForStartupScripts).toHaveBeenCalled();
    // We should see checking, then starting, then ready
    expect(events[0]?.phase).toBe("checking");
    expect(events.some((e) => e.phase === "starting")).toBe(true);
    expect(events.at(-1)?.phase).toBe("ready");
  });

  it("returns runtime_start_failed when waitForStartupScripts fails", async () => {
    const getMinionStatus = mock(() =>
      Promise.resolve({ kind: "ok" as const, status: "stopped" as const })
    );
    const waitForStartupScripts = mock(() =>
      (async function* (): AsyncGenerator<string, void, unknown> {
        await Promise.resolve();
        yield "Starting minion...";
        throw new Error("connection failed");
      })()
    );
    const latticeService = createMockLatticeService({ getMinionStatus, waitForStartupScripts });

    const runtime = createRuntime(
      { existingMinion: true, minionName: "my-ws" },
      latticeService
    );

    const events: RuntimeStatusEvent[] = [];
    const result = await runtime.ensureReady({
      statusSink: (e) => events.push(e),
    });

    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.errorType).toBe("runtime_start_failed");
      expect(result.error).toContain("Failed to connect");
    }

    expect(events.at(-1)?.phase).toBe("error");
  });
});
