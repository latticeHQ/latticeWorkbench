import { beforeEach, describe, expect, it, spyOn, vi } from "bun:test";
import type { RuntimeConfig } from "@/common/types/runtime";
import type { Config } from "@/node/config";
import * as gitModule from "@/node/git";
import { getContainerName } from "@/node/runtime/DockerRuntime";
import type {
  InitLogger,
  Runtime,
  MinionCreationResult,
  MinionForkResult,
} from "@/node/runtime/Runtime";
import * as runtimeFactoryModule from "@/node/runtime/runtimeFactory";
import * as runtimeUpdatesModule from "@/node/services/utils/forkRuntimeUpdates";
import { orchestrateFork } from "./forkOrchestrator";

let applyForkRuntimeUpdatesMock!: ReturnType<
  typeof spyOn<typeof runtimeUpdatesModule, "applyForkRuntimeUpdates">
>;
let createRuntimeMock!: ReturnType<typeof spyOn<typeof runtimeFactoryModule, "createRuntime">>;
let detectDefaultTrunkBranchMock!: ReturnType<
  typeof spyOn<typeof gitModule, "detectDefaultTrunkBranch">
>;
let listLocalBranchesMock!: ReturnType<typeof spyOn<typeof gitModule, "listLocalBranches">>;

const PROJECT_PATH = "/projects/demo";
const SOURCE_MINION_NAME = "feature/source";
const NEW_MINION_NAME = "feature/new";
const SOURCE_MINION_ID = "minion-source";
const SOURCE_RUNTIME_CONFIG: RuntimeConfig = { type: "local" };
const DEFAULT_FORKED_RUNTIME_CONFIG: RuntimeConfig = {
  type: "docker",
  image: "node:20",
  containerName: getContainerName(PROJECT_PATH, NEW_MINION_NAME),
};

function createInitLogger(): InitLogger {
  return {
    logStep: vi.fn(),
    logStdout: vi.fn(),
    logStderr: vi.fn(),
    logComplete: vi.fn(),
  };
}

function createConfig(): Config {
  return {
    updateMinionMetadata: vi.fn(),
  } as unknown as Config;
}

function createSourceRuntimeMocks(): {
  sourceRuntime: Runtime;
  forkMinion: ReturnType<typeof vi.fn>;
  createMinion: ReturnType<typeof vi.fn>;
} {
  const forkMinion = vi.fn();
  const createMinion = vi.fn();
  const sourceRuntime = {
    forkMinion,
    createMinion,
  } as unknown as Runtime;

  return { sourceRuntime, forkMinion, createMinion };
}

interface RunOrchestrateForkOptions {
  sourceRuntime: Runtime;
  allowCreateFallback: boolean;
  config?: Config;
  sourceRuntimeConfig?: RuntimeConfig;
  preferredTrunkBranch?: string;
}

async function runOrchestrateFork(options: RunOrchestrateForkOptions) {
  const config = options.config ?? createConfig();

  return orchestrateFork({
    sourceRuntime: options.sourceRuntime,
    projectPath: PROJECT_PATH,
    sourceMinionName: SOURCE_MINION_NAME,
    newMinionName: NEW_MINION_NAME,
    initLogger: createInitLogger(),
    config,
    sourceMinionId: SOURCE_MINION_ID,
    sourceRuntimeConfig: options.sourceRuntimeConfig ?? SOURCE_RUNTIME_CONFIG,
    allowCreateFallback: options.allowCreateFallback,
    preferredTrunkBranch: options.preferredTrunkBranch,
  });
}

describe("orchestrateFork", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    applyForkRuntimeUpdatesMock = spyOn(
      runtimeUpdatesModule,
      "applyForkRuntimeUpdates"
    ).mockResolvedValue({
      forkedRuntimeConfig: DEFAULT_FORKED_RUNTIME_CONFIG,
    });

    createRuntimeMock = spyOn(runtimeFactoryModule, "createRuntime").mockReturnValue({
      marker: "target-runtime",
    } as unknown as Runtime);
    listLocalBranchesMock = spyOn(gitModule, "listLocalBranches").mockResolvedValue(["main"]);
    detectDefaultTrunkBranchMock = spyOn(gitModule, "detectDefaultTrunkBranch").mockResolvedValue(
      "main"
    );
  });

  it("returns Ok with fork metadata when forkMinion succeeds", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    const forkResult: MinionForkResult = {
      success: true,
      minionPath: "/minions/forked",
      sourceBranch: "feature/source-branch",
    };
    forkMinion.mockResolvedValue(forkResult);

    const targetRuntime = { marker: "fresh-runtime" } as unknown as Runtime;
    createRuntimeMock.mockReturnValue(targetRuntime);
    const config = createConfig();

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: false,
      config,
    });

    expect(result).toEqual({
      success: true,
      data: {
        minionPath: "/minions/forked",
        trunkBranch: "feature/source-branch",
        forkedRuntimeConfig: DEFAULT_FORKED_RUNTIME_CONFIG,
        targetRuntime,
        forkedFromSource: true,
        sourceRuntimeConfigUpdated: false,
      },
    });

    expect(createMinion).not.toHaveBeenCalled();
    expect(listLocalBranchesMock).not.toHaveBeenCalled();
    expect(detectDefaultTrunkBranchMock).not.toHaveBeenCalled();
    expect(applyForkRuntimeUpdatesMock).toHaveBeenCalledWith(
      config,
      SOURCE_MINION_ID,
      SOURCE_RUNTIME_CONFIG,
      forkResult,
      { persistSourceRuntimeConfigUpdate: false }
    );
    expect(createRuntimeMock).toHaveBeenCalledWith(DEFAULT_FORKED_RUNTIME_CONFIG, {
      projectPath: PROJECT_PATH,
      minionName: NEW_MINION_NAME,
    });
  });

  it("falls back to createMinion when fork fails and fallback is allowed", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: false,
      error: "fork failed",
    } satisfies MinionForkResult);
    listLocalBranchesMock.mockResolvedValue(["main", "develop"]);
    detectDefaultTrunkBranchMock.mockResolvedValue("develop");
    createMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/created",
    } satisfies MinionCreationResult);

    const targetRuntime = { marker: "runtime-after-create-fallback" } as unknown as Runtime;
    createRuntimeMock.mockReturnValue(targetRuntime);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(createMinion).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: PROJECT_PATH,
        branchName: NEW_MINION_NAME,
        trunkBranch: "develop",
        directoryName: NEW_MINION_NAME,
      })
    );

    expect(result).toEqual({
      success: true,
      data: {
        minionPath: "/minions/created",
        trunkBranch: "develop",
        forkedRuntimeConfig: DEFAULT_FORKED_RUNTIME_CONFIG,
        targetRuntime,
        forkedFromSource: false,
        sourceRuntimeConfigUpdated: false,
      },
    });

    expect(createRuntimeMock).toHaveBeenCalledWith(DEFAULT_FORKED_RUNTIME_CONFIG, {
      projectPath: PROJECT_PATH,
      minionName: NEW_MINION_NAME,
    });
  });

  it("returns Err immediately when fork fails and fallback is not allowed", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: false,
      error: "fork denied",
    } satisfies MinionForkResult);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: false,
    });

    expect(result).toEqual({ success: false, error: "fork denied" });
    expect(createMinion).not.toHaveBeenCalled();
    expect(listLocalBranchesMock).not.toHaveBeenCalled();
    expect(detectDefaultTrunkBranchMock).not.toHaveBeenCalled();
    expect(createRuntimeMock).not.toHaveBeenCalled();
  });

  it("returns Err for fatal fork failures even when fallback is allowed", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: false,
      error: "fatal fork failure",
      failureIsFatal: true,
    } satisfies MinionForkResult);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(result).toEqual({ success: false, error: "fatal fork failure" });
    expect(createMinion).not.toHaveBeenCalled();
    expect(listLocalBranchesMock).not.toHaveBeenCalled();
    expect(detectDefaultTrunkBranchMock).not.toHaveBeenCalled();
  });

  it("prefers sourceMinionName as trunk branch when listed locally during fallback", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({ success: false } satisfies MinionForkResult);
    listLocalBranchesMock.mockResolvedValue([SOURCE_MINION_NAME, "main", "develop"]);
    createMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/from-source-minion-branch",
    } satisfies MinionCreationResult);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success result, got error: ${result.error}`);
    }

    expect(result.data.trunkBranch).toBe(SOURCE_MINION_NAME);
    expect(result.data.forkedFromSource).toBe(false);
    expect(detectDefaultTrunkBranchMock).not.toHaveBeenCalled();
  });

  it("falls back to main when trunk branch detection throws", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({ success: false } satisfies MinionForkResult);
    listLocalBranchesMock.mockRejectedValue(new Error("git unavailable"));
    createMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/main-fallback",
    } satisfies MinionCreationResult);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success result, got error: ${result.error}`);
    }

    expect(result.data.trunkBranch).toBe("main");
    expect(detectDefaultTrunkBranchMock).not.toHaveBeenCalled();
  });

  it("uses preferredTrunkBranch when fork fails and git discovery is unavailable", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();

    forkMinion.mockResolvedValue({
      success: false,
      failureIsFatal: false,
      error: "fork not supported",
    } satisfies MinionForkResult);

    createMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/new",
    } satisfies MinionCreationResult);

    // Simulate SSH/Docker where local git discovery is unavailable.
    listLocalBranchesMock.mockRejectedValue(new Error("git not available"));

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
      preferredTrunkBranch: "develop",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success result, got error: ${result.error}`);
    }

    expect(result.data.trunkBranch).toBe("develop");
    expect(result.data.forkedFromSource).toBe(false);

    // createMinion should receive the preferred trunk branch.
    expect(createMinion).toHaveBeenCalledWith(
      expect.objectContaining({ trunkBranch: "develop" })
    );

    // preferredTrunkBranch short-circuits local git discovery.
    expect(listLocalBranchesMock).not.toHaveBeenCalled();
  });

  it("surfaces sourceRuntimeConfigUpdate without persisting it in orchestrator", async () => {
    const { sourceRuntime, forkMinion } = createSourceRuntimeMocks();
    const sourceRuntimeConfigUpdate: RuntimeConfig = {
      type: "worktree",
      srcBaseDir: "/tmp/shared-src",
    };
    forkMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/forked-with-source-update",
      sourceBranch: "main",
      sourceRuntimeConfig: sourceRuntimeConfigUpdate,
    } satisfies MinionForkResult);
    applyForkRuntimeUpdatesMock.mockResolvedValue({
      forkedRuntimeConfig: DEFAULT_FORKED_RUNTIME_CONFIG,
      sourceRuntimeConfigUpdate,
    });
    const config = createConfig();

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: false,
      config,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success result, got error: ${result.error}`);
    }

    expect(result.data.sourceRuntimeConfigUpdated).toBe(true);
    expect(result.data.sourceRuntimeConfigUpdate).toEqual(sourceRuntimeConfigUpdate);
    expect(applyForkRuntimeUpdatesMock).toHaveBeenCalledWith(
      config,
      SOURCE_MINION_ID,
      SOURCE_RUNTIME_CONFIG,
      expect.objectContaining({
        sourceRuntimeConfig: sourceRuntimeConfigUpdate,
      }),
      { persistSourceRuntimeConfigUpdate: false }
    );
  });

  it("uses the runtime config from applyForkRuntimeUpdates when creating target runtime", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: false,
      error: "fork failed",
    } satisfies MinionForkResult);
    createMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/created-with-custom-runtime",
    } satisfies MinionCreationResult);

    const customForkedRuntimeConfig: RuntimeConfig = {
      type: "ssh",
      host: "ssh.example.com",
      srcBaseDir: "~/lattice",
    };
    applyForkRuntimeUpdatesMock.mockResolvedValue({
      forkedRuntimeConfig: customForkedRuntimeConfig,
    });

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Expected success result, got error: ${result.error}`);
    }

    expect(result.data.forkedRuntimeConfig).toEqual(customForkedRuntimeConfig);
    expect(createRuntimeMock).toHaveBeenCalledWith(customForkedRuntimeConfig, {
      projectPath: PROJECT_PATH,
      minionName: NEW_MINION_NAME,
    });
  });

  it("normalizes Docker containerName to destination minion identity", async () => {
    const { sourceRuntime, forkMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: true,
      minionPath: "/minions/new",
    } satisfies MinionForkResult);

    // Source Docker config with a container name belonging to the source minion
    const sourceDockerConfig: RuntimeConfig = {
      type: "docker",
      image: "node:20",
      containerName: "lattice-demo-source-aaaaaa",
    };

    // applyForkRuntimeUpdates returns the source config unchanged (simulating fallback)
    applyForkRuntimeUpdatesMock.mockResolvedValue({
      forkedRuntimeConfig: sourceDockerConfig,
    });

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: false,
      sourceRuntimeConfig: sourceDockerConfig,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");

    // Must use destination-derived container name, not the inherited source name
    const expectedContainerName = getContainerName(PROJECT_PATH, NEW_MINION_NAME);
    expect(result.data.forkedRuntimeConfig).toEqual({
      type: "docker",
      image: "node:20",
      containerName: expectedContainerName,
    });
    expect(result.data.forkedRuntimeConfig).not.toEqual(
      expect.objectContaining({ containerName: "lattice-demo-source-aaaaaa" })
    );

    // createRuntime should also receive the normalized config
    expect(createRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ containerName: expectedContainerName }),
      { projectPath: PROJECT_PATH, minionName: NEW_MINION_NAME }
    );
  });
  it("returns Err when create fallback also fails", async () => {
    const { sourceRuntime, forkMinion, createMinion } = createSourceRuntimeMocks();
    forkMinion.mockResolvedValue({
      success: false,
      error: "fork failed",
    } satisfies MinionForkResult);
    createMinion.mockResolvedValue({
      success: false,
      error: "create failed",
    } satisfies MinionCreationResult);

    const result = await runOrchestrateFork({
      sourceRuntime,
      allowCreateFallback: true,
    });

    expect(result).toEqual({ success: false, error: "create failed" });
    expect(createRuntimeMock).not.toHaveBeenCalled();
  });
});
