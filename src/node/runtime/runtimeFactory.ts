import * as fs from "fs/promises";
import * as path from "path";
import type { Runtime, WorkspaceInitParams, WorkspaceInitResult } from "./Runtime";
import { LocalRuntime } from "./LocalRuntime";
import { WorktreeRuntime } from "./WorktreeRuntime";
import { SSHRuntime } from "./SSHRuntime";
import { LatticeSSHRuntime } from "./LatticeSSHRuntime";
import { createSSHTransport } from "./transports";
import { DockerRuntime, getContainerName } from "./DockerRuntime";
import { DevcontainerRuntime } from "./DevcontainerRuntime";
import { RemoteRuntime } from "./RemoteRuntime";
import type { RuntimeConfig, RuntimeMode, RuntimeAvailabilityStatus } from "@/common/types/runtime";
import { hasSrcBaseDir } from "@/common/types/runtime";
import { isIncompatibleRuntimeConfig } from "@/common/utils/runtimeCompatibility";
import { execAsync } from "@/node/utils/disposableExec";
import type { LatticeService } from "@/node/services/latticeService";
import type { CliAgentDetectionService } from "@/node/services/cliAgentDetectionService";
import { Config } from "@/node/config";
import { checkDevcontainerCliVersion } from "./devcontainerCli";
import { buildDevcontainerConfigInfo, scanDevcontainerConfigs } from "./devcontainerConfigs";
import { bootstrapAgentsOnRemote } from "./agentBootstrap";
import { log } from "@/node/services/log";

// Re-export for backward compatibility with existing imports
export { isIncompatibleRuntimeConfig };

// Global LatticeService singleton - set during app init so all createRuntime calls can use it
let globalLatticeService: LatticeService | undefined;

/**
 * Set the global LatticeService instance for runtime factory.
 * Call this during app initialization so createRuntime() can create LatticeSSHRuntime
 * without requiring callers to pass latticeService explicitly.
 */
export function setGlobalLatticeService(service: LatticeService): void {
  globalLatticeService = service;
}

/**
 * Run the full init sequence: postCreateSetup (if present) then initWorkspace.
 * Use this everywhere instead of calling initWorkspace directly to ensure
 * runtimes with provisioning steps (Docker, LatticeSSH) work correctly.
 *
 * When cliAgentDetectionService is provided and the runtime is remote (SSH/Docker),
 * locally-detected CLI agents are automatically installed on the remote before
 * initWorkspace runs. This ensures hire_employee works out of the box.
 */
export async function runFullInit(
  runtime: Runtime,
  params: WorkspaceInitParams,
  cliAgentDetectionService?: CliAgentDetectionService
): Promise<WorkspaceInitResult> {
  if (runtime.postCreateSetup) {
    await runtime.postCreateSetup(params);
  }

  // Auto-install CLI agents on remote runtimes (SSH, Docker)
  if (cliAgentDetectionService && runtime instanceof RemoteRuntime) {
    try {
      await bootstrapAgentsOnRemote(
        runtime,
        params.initLogger,
        cliAgentDetectionService,
        params.abortSignal
      );
    } catch (err) {
      // Non-fatal: log but continue with workspace init
      const msg = err instanceof Error ? err.message : String(err);
      params.initLogger.logStderr(`Agent bootstrap failed: ${msg}`);
      log.warn("[agent-bootstrap] Failed", { error: msg });
    }
  }

  return runtime.initWorkspace(params);
}

/**
 * Fire-and-forget init with standardized error handling.
 * Use this for background init after workspace creation (workspaceService, taskService).
 */
export function runBackgroundInit(
  runtime: Runtime,
  params: WorkspaceInitParams,
  workspaceId: string,
  logger?: { error: (msg: string, ctx: object) => void },
  cliAgentDetectionService?: CliAgentDetectionService
): void {
  void (async () => {
    try {
      await runFullInit(runtime, params, cliAgentDetectionService);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger?.error(`Workspace init failed for ${workspaceId}:`, { error });
      params.initLogger.logStderr(`Initialization failed: ${errorMsg}`);
      params.initLogger.logComplete(-1);
    }
  })();
}

function shouldUseSSH2Runtime(): boolean {
  // Windows always uses SSH2 (no native OpenSSH)
  if (process.platform === "win32") {
    return true;
  }
  // Other platforms: check config (defaults to OpenSSH)
  const config = new Config();
  return config.loadConfigOrDefault().useSSH2Transport ?? false;
}

/**
 * Error thrown when a workspace has an incompatible runtime configuration,
 * typically from a newer version of lattice that added new runtime types.
 */
export class IncompatibleRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleRuntimeError";
  }
}

/**
 * Options for creating a runtime.
 */
export interface CreateRuntimeOptions {
  /**
   * Headquarter path - required for project-dir local runtimes (type: "local" without srcBaseDir).
   * For Docker runtimes with existing workspaces, used together with workspaceName to derive container name.
   * For other runtime types, this is optional and used only for getWorkspacePath calculations.
   */
  projectPath?: string;
  /**
   * Workspace name - required for Docker runtimes when connecting to an existing workspace.
   * Used together with projectPath to derive the container name.
   */
  workspaceName?: string;
  /**
   * Lattice service - required for SSH runtimes with Lattice configuration.
   * When provided and config has lattice field, returns a Lattice SSH runtime (SSH/SSH2).
   */
  latticeService?: LatticeService;
}

/**
 * Create a Runtime instance based on the configuration.
 *
 * Handles runtime types:
 * - "local" without srcBaseDir: Headquarter-dir runtime (no isolation) - requires projectPath in options
 * - "local" with srcBaseDir: Legacy worktree config (backward compat)
 * - "worktree": Explicit worktree runtime
 * - "ssh": Remote SSH runtime
 * - "docker": Docker container runtime
 */
export function createRuntime(config: RuntimeConfig, options?: CreateRuntimeOptions): Runtime {
  // Check for incompatible configs from newer versions
  if (isIncompatibleRuntimeConfig(config)) {
    throw new IncompatibleRuntimeError(
      `This workspace uses a runtime configuration from a newer version of lattice. ` +
        `Please upgrade lattice to use this workspace.`
    );
  }

  switch (config.type) {
    case "local":
      // Check if this is legacy "local" with srcBaseDir (= worktree semantics)
      // or new "local" without srcBaseDir (= project-dir semantics)
      if (hasSrcBaseDir(config)) {
        // Legacy: "local" with srcBaseDir is treated as worktree
        return new WorktreeRuntime(config.srcBaseDir);
      }
      // Headquarter-dir: uses project path directly, no isolation
      if (!options?.projectPath) {
        throw new Error(
          "LocalRuntime requires projectPath in options for project-dir config (type: 'local' without srcBaseDir)"
        );
      }
      return new LocalRuntime(options.projectPath);

    case "worktree":
      return new WorktreeRuntime(config.srcBaseDir);

    case "ssh": {
      const sshConfig = {
        host: config.host,
        srcBaseDir: config.srcBaseDir,
        bgOutputDir: config.bgOutputDir,
        identityFile: config.identityFile,
        port: config.port,
      };

      const useSSH2 = shouldUseSSH2Runtime();
      const transport = createSSHTransport(sshConfig, useSSH2);

      // Use a Lattice SSH runtime for SSH+Lattice when latticeService is available (explicit or global)
      const latticeService = options?.latticeService ?? globalLatticeService;

      if (config.lattice) {
        if (!latticeService) {
          throw new Error("Lattice runtime requested but LatticeService is not initialized");
        }
        return new LatticeSSHRuntime(
          { ...sshConfig, lattice: config.lattice },
          transport,
          latticeService
        );
      }

      return new SSHRuntime(sshConfig, transport);
    }

    case "docker": {
      // For existing workspaces, derive container name from project+workspace
      const containerName =
        options?.projectPath && options?.workspaceName
          ? getContainerName(options.projectPath, options.workspaceName)
          : config.containerName;
      return new DockerRuntime({
        image: config.image,
        containerName,
        shareCredentials: config.shareCredentials,
      });
    }

    case "devcontainer": {
      // Devcontainer uses worktrees on host + container exec
      // srcBaseDir sourced from config to honor LATTICE_ROOT and dev-mode suffixes
      const runtime = new DevcontainerRuntime({
        srcBaseDir: new Config().srcDir,
        configPath: config.configPath,
        shareCredentials: config.shareCredentials,
      });
      // Set workspace path for existing workspaces
      if (options?.projectPath && options?.workspaceName) {
        runtime.setCurrentWorkspacePath(
          runtime.getWorkspacePath(options.projectPath, options.workspaceName)
        );
      }
      return runtime;
    }

    default: {
      const unknownConfig = config as { type?: string };
      throw new Error(`Unknown runtime type: ${unknownConfig.type ?? "undefined"}`);
    }
  }
}

/**
 * Helper to check if a runtime config requires projectPath for createRuntime.
 */
export function runtimeRequiresProjectPath(config: RuntimeConfig): boolean {
  // Headquarter-dir local runtime (no srcBaseDir) requires projectPath
  return config.type === "local" && !hasSrcBaseDir(config);
}

/**
 * Check if a project has a .git directory (is a git repository).
 */
async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(projectPath, ".git");
    const stat = await fs.stat(gitPath);
    // .git can be a directory (normal repo) or a file (worktree)
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if Docker daemon is running and accessible.
 */
async function isDockerAvailable(): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    using proc = execAsync("docker info");
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("timeout")), 5000);
    });
    await Promise.race([proc.result, timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

type RuntimeAvailabilityMap = Record<RuntimeMode, RuntimeAvailabilityStatus>;

/**
 * Check availability of all runtime types for a given project.
 * Returns a record of runtime mode to availability status.
 */
export async function checkRuntimeAvailability(
  projectPath: string
): Promise<RuntimeAvailabilityMap> {
  const [isGit, dockerAvailable, devcontainerCliInfo, devcontainerConfigs] = await Promise.all([
    isGitRepository(projectPath),
    isDockerAvailable(),
    checkDevcontainerCliVersion(),
    scanDevcontainerConfigs(projectPath),
  ]);

  const devcontainerConfigInfo = buildDevcontainerConfigInfo(devcontainerConfigs);

  const gitRequiredReason = "Requires git repository";

  // Determine devcontainer availability
  let devcontainerAvailability: RuntimeAvailabilityStatus;
  if (!isGit) {
    devcontainerAvailability = { available: false, reason: gitRequiredReason };
  } else if (!devcontainerCliInfo) {
    devcontainerAvailability = {
      available: false,
      reason: "Dev Container CLI not installed. Run: npm install -g @devcontainers/cli",
    };
  } else if (!dockerAvailable) {
    devcontainerAvailability = { available: false, reason: "Docker daemon not running" };
  } else if (devcontainerConfigInfo.length === 0) {
    devcontainerAvailability = { available: false, reason: "No devcontainer.json found" };
  } else {
    devcontainerAvailability = {
      available: true,
      configs: devcontainerConfigInfo,
      cliVersion: devcontainerCliInfo.version,
    };
  }

  return {
    local: { available: true },
    worktree: isGit ? { available: true } : { available: false, reason: gitRequiredReason },
    ssh: isGit ? { available: true } : { available: false, reason: gitRequiredReason },
    docker: !isGit
      ? { available: false, reason: gitRequiredReason }
      : !dockerAvailable
        ? { available: false, reason: "Docker daemon not running" }
        : { available: true },
    devcontainer: devcontainerAvailability,
  };
}
