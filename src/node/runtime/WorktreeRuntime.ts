import type {
  WorkspaceCreationParams,
  WorkspaceCreationResult,
  WorkspaceInitParams,
  WorkspaceInitResult,
  WorkspaceForkParams,
  WorkspaceForkResult,
} from "./Runtime";
import { checkInitHookExists, getLatticeEnv } from "./initHook";
import { LocalBaseRuntime } from "./LocalBaseRuntime";
import { getErrorMessage } from "@/common/utils/errors";
import { WorktreeManager } from "@/node/worktree/WorktreeManager";

/**
 * Worktree runtime implementation that executes commands and file operations
 * directly on the host machine using Node.js APIs.
 *
 * This runtime uses git worktrees for workspace isolation:
 * - Workspaces are created in {srcBaseDir}/{projectName}/{workspaceName}
 * - Each workspace is a git worktree with its own branch
 */
export class WorktreeRuntime extends LocalBaseRuntime {
  private readonly worktreeManager: WorktreeManager;

  constructor(srcBaseDir: string) {
    super();
    this.worktreeManager = new WorktreeManager(srcBaseDir);
  }

  getWorkspacePath(projectPath: string, workspaceName: string): string {
    return this.worktreeManager.getWorkspacePath(projectPath, workspaceName);
  }

  async createWorkspace(params: WorkspaceCreationParams): Promise<WorkspaceCreationResult> {
    return this.worktreeManager.createWorkspace({
      projectPath: params.projectPath,
      branchName: params.branchName,
      trunkBranch: params.trunkBranch,
      initLogger: params.initLogger,
    });
  }

  async initWorkspace(params: WorkspaceInitParams): Promise<WorkspaceInitResult> {
    const { projectPath, branchName, workspacePath, initLogger, env, skipInitHook } = params;

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
        const latticeEnv = { ...env, ...getLatticeEnv(projectPath, "worktree", branchName) };
        await this.runInitHook(workspacePath, latticeEnv, initLogger);
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

  async renameWorkspace(
    projectPath: string,
    oldName: string,
    newName: string,
    _abortSignal?: AbortSignal
  ): Promise<
    { success: true; oldPath: string; newPath: string } | { success: false; error: string }
  > {
    // Note: _abortSignal ignored for local operations (fast, no need for cancellation)
    return this.worktreeManager.renameWorkspace(projectPath, oldName, newName);
  }

  async deleteWorkspace(
    projectPath: string,
    workspaceName: string,
    force: boolean,
    _abortSignal?: AbortSignal
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }> {
    // Note: _abortSignal ignored for local operations (fast, no need for cancellation)
    return this.worktreeManager.deleteWorkspace(projectPath, workspaceName, force);
  }

  async forkWorkspace(params: WorkspaceForkParams): Promise<WorkspaceForkResult> {
    return this.worktreeManager.forkWorkspace(params);
  }
}
