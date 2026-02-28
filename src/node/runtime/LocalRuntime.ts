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
import { checkInitHookExists, getLatticeEnv } from "./initHook";
import { getErrorMessage } from "@/common/utils/errors";
import { LocalBaseRuntime } from "./LocalBaseRuntime";

/**
 * Local runtime implementation that uses the project directory directly.
 *
 * Unlike WorktreeRuntime, this runtime:
 * - Does NOT create git worktrees or isolate minions
 * - Uses the project directory as the minion path
 * - Cannot delete the project directory (deleteMinion is a no-op)
 * - Supports forking (creates new minion entries pointing to same project directory)
 *
 * This is useful for users who want to work directly in their project
 * without the overhead of worktree management.
 */
export class LocalRuntime extends LocalBaseRuntime {
  private readonly projectPath: string;

  constructor(projectPath: string) {
    super();
    this.projectPath = projectPath;
  }

  /**
   * For LocalRuntime, the minion path is always the project path itself.
   * The minionName parameter is ignored since there's only one minion per project.
   */
  getMinionPath(_projectPath: string, _minionName: string): string {
    return this.projectPath;
  }

  override ensureReady(options?: EnsureReadyOptions): Promise<EnsureReadyResult> {
    const statusSink = options?.statusSink;
    statusSink?.({
      phase: "checking",
      runtimeType: "local",
      detail: "Checking repository...",
    });

    // Non-git projects are explicitly supported for LocalRuntime; avoid blocking readiness
    // on missing .git so local-only workflows continue to work.
    statusSink?.({ phase: "ready", runtimeType: "local" });
    return Promise.resolve({ ready: true });
  }

  /**
   * Creating a minion is a no-op for LocalRuntime since we use the project directory directly.
   * We just verify the directory exists.
   */
  async createMinion(params: MinionCreationParams): Promise<MinionCreationResult> {
    const { initLogger } = params;

    try {
      initLogger.logStep("Using project directory directly (no worktree isolation)");

      // Verify the project directory exists
      try {
        await this.stat(this.projectPath);
      } catch {
        return {
          success: false,
          error: `Project directory does not exist: ${this.projectPath}`,
        };
      }

      initLogger.logStep("Project directory verified");

      return { success: true, minionPath: this.projectPath };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
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
      const hookExists = await checkInitHookExists(projectPath);
      if (hookExists) {
        initLogger.enterHookPhase?.();
        const latticeEnv = { ...env, ...getLatticeEnv(projectPath, "local", branchName) };
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

  /**
   * Renaming is a no-op for LocalRuntime - the minion path is always the project directory.
   * Returns success so the metadata (minion name) can be updated in config.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async renameMinion(
    _projectPath: string,
    _oldName: string,
    _newName: string,
    _abortSignal?: AbortSignal
  ): Promise<
    { success: true; oldPath: string; newPath: string } | { success: false; error: string }
  > {
    // No filesystem operation needed - path stays the same
    return { success: true, oldPath: this.projectPath, newPath: this.projectPath };
  }

  /**
   * Deleting is a no-op for LocalRuntime - we never delete the user's project directory.
   * Returns success so the minion entry can be removed from config.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteMinion(
    _projectPath: string,
    _minionName: string,
    _force: boolean,
    _abortSignal?: AbortSignal
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }> {
    // Return success but don't actually delete anything
    // The project directory should never be deleted
    return { success: true, deletedPath: this.projectPath };
  }

  /**
   * Fork for LocalRuntime creates a new minion entry pointing to the same project directory.
   * Since LocalRuntime doesn't create separate directories, "forking" just means:
   * 1. A new minion ID with the new name
   * 2. Copied chat history (handled by minionService)
   * 3. Same project directory as source
   *
   * This enables conversation branching without git worktree overhead.
   */
  async forkMinion(params: MinionForkParams): Promise<MinionForkResult> {
    const { initLogger } = params;

    initLogger.logStep("Creating conversation fork (no worktree isolation)");

    // Verify the project directory exists (same check as createMinion)
    try {
      await this.stat(this.projectPath);
    } catch {
      return {
        success: false,
        error: `Project directory does not exist: ${this.projectPath}`,
      };
    }

    initLogger.logStep("Project directory verified");

    // Return success - the minion service will copy chat history
    // and create a new minion entry pointing to this project directory
    return {
      success: true,
      minionPath: this.projectPath,
      // sourceBranch is optional for LocalRuntime since no git operations are involved
    };
  }
}
