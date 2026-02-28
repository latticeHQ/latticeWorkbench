import type {
  EnsureReadyOptions,
  EnsureReadyResult,
  MinionCreationParams,
  MinionCreationResult,
  MinionInitParams,
  MinionInitResult,
  MinionForkParams,
  MinionForkResult,
} from "./Runtime";
import { MINION_REPO_MISSING_ERROR } from "./Runtime";
import { checkInitHookExists, getLatticeEnv } from "./initHook";
import { LocalBaseRuntime } from "./LocalBaseRuntime";
import { getErrorMessage } from "@/common/utils/errors";
import { isGitRepository } from "@/node/utils/pathUtils";
import { WorktreeManager } from "@/node/worktree/WorktreeManager";

/**
 * Worktree runtime implementation that executes commands and file operations
 * directly on the host machine using Node.js APIs.
 *
 * This runtime uses git worktrees for minion isolation:
 * - Minions are created in {srcBaseDir}/{projectName}/{minionName}
 * - Each minion is a git worktree with its own branch
 */
export class WorktreeRuntime extends LocalBaseRuntime {
  private readonly worktreeManager: WorktreeManager;
  private readonly currentProjectPath?: string;
  private readonly currentMinionName?: string;

  constructor(
    srcBaseDir: string,
    options?: {
      projectPath?: string;
      minionName?: string;
    }
  ) {
    super();
    this.worktreeManager = new WorktreeManager(srcBaseDir);
    this.currentProjectPath = options?.projectPath;
    this.currentMinionName = options?.minionName;
  }

  getMinionPath(projectPath: string, minionName: string): string {
    return this.worktreeManager.getMinionPath(projectPath, minionName);
  }

  override async ensureReady(options?: EnsureReadyOptions): Promise<EnsureReadyResult> {
    if (!this.currentProjectPath || !this.currentMinionName) {
      return { ready: true };
    }

    const statusSink = options?.statusSink;
    statusSink?.({
      phase: "checking",
      runtimeType: "worktree",
      detail: "Checking repository...",
    });

    const minionPath = this.getMinionPath(this.currentProjectPath, this.currentMinionName);
    const hasRepo = await isGitRepository(minionPath);
    if (!hasRepo) {
      statusSink?.({
        phase: "error",
        runtimeType: "worktree",
        detail: MINION_REPO_MISSING_ERROR,
      });
      return {
        ready: false,
        error: MINION_REPO_MISSING_ERROR,
        errorType: "runtime_not_ready",
      };
    }

    statusSink?.({ phase: "ready", runtimeType: "worktree" });
    return { ready: true };
  }

  async createMinion(params: MinionCreationParams): Promise<MinionCreationResult> {
    return this.worktreeManager.createMinion({
      projectPath: params.projectPath,
      branchName: params.branchName,
      trunkBranch: params.trunkBranch,
      initLogger: params.initLogger,
    });
  }

  async initMinion(params: MinionInitParams): Promise<MinionInitResult> {
    const { projectPath, branchName, minionPath, initLogger, abortSignal, env, skipInitHook } =
      params;

    try {
      if (skipInitHook) {
        initLogger.logStep("Skipping .lattice/init hook (disabled for this task)");
        initLogger.logComplete(0);
        return { success: true };
      }

      // Run .lattice/init hook if it exists
      // Note: runInitHook calls logComplete() internally if hook exists
      const hookExists = await checkInitHookExists(projectPath);
      if (hookExists) {
        initLogger.enterHookPhase?.();
        const latticeEnv = { ...env, ...getLatticeEnv(projectPath, "worktree", branchName) };
        await this.runInitHook(minionPath, latticeEnv, initLogger, abortSignal);
      } else {
        // No hook - signal completion immediately
        initLogger.logComplete(0);
      }
      return { success: true };
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      initLogger.logStderr(`Initialization failed: ${errorMsg}`);
      initLogger.logComplete(-1);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  async renameMinion(
    projectPath: string,
    oldName: string,
    newName: string,
    _abortSignal?: AbortSignal
  ): Promise<
    { success: true; oldPath: string; newPath: string } | { success: false; error: string }
  > {
    // Note: _abortSignal ignored for local operations (fast, no need for cancellation)
    return this.worktreeManager.renameMinion(projectPath, oldName, newName);
  }

  async deleteMinion(
    projectPath: string,
    minionName: string,
    force: boolean,
    _abortSignal?: AbortSignal
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }> {
    // Note: _abortSignal ignored for local operations (fast, no need for cancellation)
    return this.worktreeManager.deleteMinion(projectPath, minionName, force);
  }

  async forkMinion(params: MinionForkParams): Promise<MinionForkResult> {
    return this.worktreeManager.forkMinion(params);
  }
}
