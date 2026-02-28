import type { RuntimeConfig, RuntimeAvailabilityStatus } from "@/common/types/runtime";
import type { RuntimeStatusEvent as StreamRuntimeStatusEvent } from "@/common/types/stream";
import type { Result } from "@/common/types/result";

/**
 * Runtime abstraction for executing tools in different environments.
 *
 * DESIGN PRINCIPLE: Keep this interface minimal and low-level.
 * - Prefer streaming primitives over buffered APIs
 * - Implement shared helpers (utils/runtime/) that work across all runtimes
 * - Avoid duplicating helper logic in each runtime implementation
 *
 * This interface allows tools to run locally, in Docker containers, over SSH, etc.
 */

/**
 * PATH TERMINOLOGY & HIERARCHY
 *
 * srcBaseDir (base directory for all minions):
 *   - Where lattice stores ALL minion directories
 *   - Local: ~/.lattice/src (tilde expanded to full path by LocalRuntime)
 *   - SSH: /home/user/minion (tilde paths are allowed and are resolved before use)
 *
 * Minion Path Computation:
 *   {srcBaseDir}/{projectName}/{minionName}
 *
 *   - projectName: basename(projectPath)
 *     Example: "/Users/me/git/my-project" → "my-project"
 *
 *   - minionName: branch name or custom name
 *     Example: "feature-123" or "main"
 *
 * Full Example (Local):
 *   srcBaseDir:    ~/.lattice/src (expanded to /home/user/.lattice/src)
 *   projectPath:   /Users/me/git/my-project (local git repo)
 *   projectName:   my-project (extracted)
 *   minionName: feature-123
 *   → Minion:   /home/user/.lattice/src/my-project/feature-123
 *
 * Full Example (SSH):
 *   srcBaseDir:    /home/user/minion (absolute path required)
 *   projectPath:   /Users/me/git/my-project (local git repo)
 *   projectName:   my-project (extracted)
 *   minionName: feature-123
 *   → Minion:   /home/user/minion/my-project/feature-123
 */

/**
 * Options for executing a command
 */
export interface ExecOptions {
  /** Working directory for command execution */
  cwd: string;
  /** Environment variables to inject */
  env?: Record<string, string>;
  /**
   * Timeout in seconds.
   *
   * When provided, prevents zombie processes by ensuring spawned processes are killed.
   * Even long-running commands should have a reasonable upper bound (e.g., 3600s for 1 hour).
   *
   * When omitted, no timeout is applied - use only for internal operations like
   * spawning background processes that are designed to run indefinitely.
   */
  timeout?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Force PTY allocation (SSH only - adds -t flag) */
  forcePTY?: boolean;
}

/**
 * Handle to a background process.
 * Abstracts away whether process is local or remote.
 *
 * Output is written directly to a unified output.log file by shell redirection.
 * This handle is for lifecycle management and output directory operations.
 */
export interface BackgroundHandle {
  /** Output directory containing output.log, meta.json, exit_code */
  readonly outputDir: string;

  /**
   * Get the exit code if the process has exited.
   * Returns null if still running.
   * Async because SSH needs to read remote exit_code file.
   */
  getExitCode(): Promise<number | null>;

  /**
   * Terminate the process (SIGTERM → wait → SIGKILL).
   */
  terminate(): Promise<void>;

  /**
   * Clean up resources (called after process exits or on error).
   */
  dispose(): Promise<void>;

  /**
   * Write meta.json to the output directory.
   */
  writeMeta(metaJson: string): Promise<void>;

  /**
   * Get the current size of output.log in bytes.
   * Used to tail output without reading the entire file.
   */
  getOutputFileSize(): Promise<number>;

  /**
   * Read output from output.log at the given byte offset.
   * Returns the content read and the new offset (for incremental reads).
   * Works on both local and SSH runtimes by using runtime.exec() internally.
   */
  readOutput(offset: number): Promise<{ content: string; newOffset: number }>;
}

/**
 * Streaming result from executing a command
 */
export interface ExecStream {
  /** Standard output stream */
  stdout: ReadableStream<Uint8Array>;
  /** Standard error stream */
  stderr: ReadableStream<Uint8Array>;
  /** Standard input stream */
  stdin: WritableStream<Uint8Array>;
  /** Promise that resolves with exit code when process completes */
  exitCode: Promise<number>;
  /** Promise that resolves with wall clock duration in milliseconds */
  duration: Promise<number>;
}

/**
 * File statistics
 */
export interface FileStat {
  /** File size in bytes */
  size: number;
  /** Last modified time */
  modifiedTime: Date;
  /** True if path is a directory (false implies regular file for our purposes) */
  isDirectory: boolean;
}

/**
 * Logger for streaming minion initialization events to frontend.
 * Used to report progress during minion creation and init hook execution.
 */
export interface InitLogger {
  /** Log a creation step (e.g., "Creating worktree", "Syncing files") */
  logStep(message: string): void;
  /** Log stdout line from init hook */
  logStdout(line: string): void;
  /** Log stderr line from init hook */
  logStderr(line: string): void;
  /** Report init hook completion */
  logComplete(exitCode: number): void;
  /** Signal that the init hook is about to run (starts timeout window). */
  enterHookPhase?(): void;
}

/**
 * Parameters for minion creation
 */
export interface MinionCreationParams {
  /** Absolute path to project directory on local machine */
  projectPath: string;
  /** Branch name to checkout in minion */
  branchName: string;
  /** Trunk branch to base new branches on */
  trunkBranch: string;
  /** Directory name to use for minion (typically branch name) */
  directoryName: string;
  /** Logger for streaming creation progress and init hook output */
  initLogger: InitLogger;
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result from minion creation
 */
export interface MinionCreationResult {
  success: boolean;
  /** Absolute path to minion (local path for LocalRuntime, remote path for SSHRuntime) */
  minionPath?: string;
  error?: string;
}

/**
 * Parameters for minion initialization
 */
export interface MinionInitParams {
  /** Absolute path to project directory on local machine */
  projectPath: string;
  /** Branch name to checkout in minion */
  branchName: string;
  /** Trunk branch to base new branches on */
  trunkBranch: string;
  /** Absolute path to minion (from createMinion result) */
  minionPath: string;
  /** Logger for streaming initialization progress and output */
  initLogger: InitLogger;
  /** Optional abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Environment variables to inject (LATTICE_ vars + secrets) */
  env?: Record<string, string>;

  /**
   * When true, skip running the project's .lattice/init hook.
   *
   * NOTE: This skips only hook execution, not runtime provisioning.
   */
  skipInitHook?: boolean;
}

/**
 * Result from minion initialization
 */
export interface MinionInitResult {
  success: boolean;
  error?: string;
}

/**
 * Runtime interface - minimal, low-level abstraction for tool execution environments.
 *
 * All methods return streaming primitives for memory efficiency.
 * Use helpers in utils/runtime/ for convenience wrappers (e.g., readFileString, execBuffered).

/**
 * Parameters for forking an existing minion
 */
export interface MinionForkParams {
  /** Project root path (local path) */
  projectPath: string;
  /** Name of the source minion to fork from */
  sourceMinionName: string;
  /** Name for the new minion */
  newMinionName: string;
  /** Logger for streaming initialization events */
  initLogger: InitLogger;
  /** Signal to abort long-running operations (e.g. cp -R -P or git worktree add) */
  abortSignal?: AbortSignal;
}

/**
 * Result of forking a minion
 */
export interface MinionForkResult {
  /** Whether the fork operation succeeded */
  success: boolean;
  /** Path to the new minion (if successful) */
  minionPath?: string;
  /** Branch that was forked from */
  sourceBranch?: string;
  /** Error message (if failed) */
  error?: string;
  /** Runtime config for the forked minion (if different from source) */
  forkedRuntimeConfig?: RuntimeConfig;
  /** Updated runtime config for source minion (e.g., mark as shared) */
  sourceRuntimeConfig?: RuntimeConfig;
  /**
   * When true and success=false, don't fall back to createMinion.
   * Use when the runtime provisions shared infrastructure that sidekicks must share.
   */
  failureIsFatal?: boolean;
}

/**
 * Flags that control minion creation behavior in MinionService.
 * Allows runtimes to customize the create flow without MinionService
 * needing runtime-specific conditionals.
 */
export interface RuntimeCreateFlags {
  /**
   * Skip srcBaseDir resolution before createMinion.
   * Use when runtime access doesn't exist until postCreateSetup (e.g., Lattice).
   */
  deferredRuntimeAccess?: boolean;

  /**
   * Use config-level collision detection instead of runtime.createMinion.
   * Use when createMinion can't detect existing minions (host doesn't exist).
   */
  configLevelCollisionDetection?: boolean;
}

/**
 * Runtime status update payload for ensureReady progress.
 *
 * Derived from the stream schema type to keep phase/runtimeType/detail consistent
 * across backend + frontend.
 */
export type RuntimeStatusEvent = Pick<StreamRuntimeStatusEvent, "phase" | "runtimeType" | "detail">;

/**
 * Callback for runtime status updates during ensureReady().
 */
export type RuntimeStatusSink = (status: RuntimeStatusEvent) => void;

/**
 * Options for ensureReady().
 */
export interface EnsureReadyOptions {
  /**
   * Callback to emit runtime-status events for UX feedback.
   * Lattice uses this to show "Starting Lattice minion..." during boot.
   */
  statusSink?: RuntimeStatusSink;

  /**
   * Abort signal to cancel long-running operations.
   */
  signal?: AbortSignal;
}

/**
 * Result of ensureReady().
 * Distinguishes between permanent failures (runtime_not_ready) and
 * transient failures (runtime_start_failed) for retry logic.
 */
export type EnsureReadyResult =
  | { ready: true }
  | {
      ready: false;
      error: string;
      errorType: "runtime_not_ready" | "runtime_start_failed";
    };

/**
 * Shared error message for missing repositories during runtime readiness checks.
 */
export const MINION_REPO_MISSING_ERROR = "Minion setup incomplete: repository not found.";

/**
 * Runtime interface - minimal, low-level abstraction for tool execution environments.
 *
 * All methods return streaming primitives for memory efficiency.
 * Use helpers in utils/runtime/ for convenience wrappers (e.g., readFileString, execBuffered).
 */
export interface Runtime {
  /**
   * Flags that control minion creation behavior.
   * If not provided, defaults to standard behavior (no flags set).
   */
  readonly createFlags?: RuntimeCreateFlags;
  /**
   * Execute a bash command with streaming I/O
   * @param command The bash script to execute
   * @param options Execution options (cwd, env, timeout, etc.)
   * @returns Promise that resolves to streaming handles for stdin/stdout/stderr and completion promises
   * @throws RuntimeError if execution fails in an unrecoverable way
   */
  exec(command: string, options: ExecOptions): Promise<ExecStream>;

  /**
   * Read file contents as a stream
   * @param path Absolute or relative path to file
   * @param abortSignal Optional abort signal for cancellation
   * @returns Readable stream of file contents
   * @throws RuntimeError if file cannot be read
   */
  readFile(path: string, abortSignal?: AbortSignal): ReadableStream<Uint8Array>;

  /**
   * Write file contents atomically from a stream
   * @param path Absolute or relative path to file
   * @param abortSignal Optional abort signal for cancellation
   * @returns Writable stream for file contents
   * @throws RuntimeError if file cannot be written
   */
  writeFile(path: string, abortSignal?: AbortSignal): WritableStream<Uint8Array>;

  /**
   * Get file statistics
   * @param path Absolute or relative path to file/directory
   * @param abortSignal Optional abort signal for cancellation
   * @returns File statistics
   * @throws RuntimeError if path does not exist or cannot be accessed
   */
  stat(path: string, abortSignal?: AbortSignal): Promise<FileStat>;

  /**
   * Ensure a directory exists (mkdir -p semantics).
   *
   * This intentionally lives on the Runtime abstraction so local runtimes can use
   * Node fs APIs (Windows-safe) while remote runtimes can use shell commands.
   */
  ensureDir(path: string): Promise<void>;

  /**
   * Resolve a path to its absolute, canonical form (expanding tildes, resolving symlinks, etc.).
   * This is used at minion creation time to normalize srcBaseDir paths in config.
   *
   * @param path Path to resolve (may contain tildes or be relative)
   * @returns Promise resolving to absolute path
   * @throws RuntimeError if path cannot be resolved (e.g., doesn't exist, permission denied)
   *
   * @example
   * // LocalRuntime
   * await runtime.resolvePath("~/lattice")      // => "/home/user/lattice"
   * await runtime.resolvePath("./relative")  // => "/current/dir/relative"
   *
   * // SSHRuntime
   * await runtime.resolvePath("~/lattice")      // => "/home/user/lattice" (via SSH shell expansion)
   */
  resolvePath(path: string): Promise<string>;

  /**
   * Normalize a path for comparison purposes within this runtime's context.
   * Handles runtime-specific path semantics (local vs remote).
   *
   * @param targetPath Path to normalize (may be relative or absolute)
   * @param basePath Base path to resolve relative paths against
   * @returns Normalized path suitable for string comparison
   *
   * @example
   * // LocalRuntime
   * runtime.normalizePath(".", "/home/user") // => "/home/user"
   * runtime.normalizePath("../other", "/home/user/project") // => "/home/user/other"
   *
   * // SSHRuntime
   * runtime.normalizePath(".", "/home/user") // => "/home/user"
   * runtime.normalizePath("~/project", "~") // => "~/project"
   */
  normalizePath(targetPath: string, basePath: string): string;

  /**
   * Compute absolute minion path from project and minion name.
   * This is the SINGLE source of truth for minion path computation.
   *
   * - LocalRuntime: {workdir}/{project-name}/{minion-name}
   * - SSHRuntime: {workdir}/{project-name}/{minion-name}
   *
   * All Runtime methods (create, delete, rename) MUST use this method internally
   * to ensure consistent path computation.
   *
   * @param projectPath Project root path (local path, used to extract project name)
   * @param minionName Minion name (typically branch name)
   * @returns Absolute path to minion directory
   */
  getMinionPath(projectPath: string, minionName: string): string;

  /**
   * Create a minion for this runtime (fast, returns immediately)
   * - LocalRuntime: Creates git worktree
   * - SSHRuntime: Creates remote directory only
   * Does NOT run init hook or sync files.
   * @param params Minion creation parameters
   * @returns Result with minion path or error
   */
  createMinion(params: MinionCreationParams): Promise<MinionCreationResult>;

  /**
   * Finalize runtime config after collision handling.
   * Called with final branch name (may have collision suffix).
   *
   * Use cases:
   * - Lattice: derive minion name from branch, compute SSH host
   *
   * @param finalBranchName Branch name after collision handling
   * @param config Current runtime config
   * @returns Updated runtime config, or error
   */
  finalizeConfig?(
    finalBranchName: string,
    config: RuntimeConfig
  ): Promise<Result<RuntimeConfig, string>>;

  /**
   * Validate before persisting minion metadata.
   * Called after finalizeConfig, before editConfig.
   * May make network calls for external validation.
   *
   * Use cases:
   * - Lattice: check if minion name already exists
   *
   * IMPORTANT: This hook runs AFTER createMinion(). Only implement this if:
   * - createMinion() is side-effect-free for this runtime, OR
   * - The runtime can tolerate/clean up side effects on validation failure
   *
   * If your runtime's createMinion() has side effects (e.g., creates directories)
   * and validation failure would leave orphaned resources, consider whether those
   * checks belong in createMinion() itself instead.
   *
   * @param finalBranchName Branch name after collision handling
   * @param config Finalized runtime config
   * @returns Success, or error message
   */
  validateBeforePersist?(
    finalBranchName: string,
    config: RuntimeConfig
  ): Promise<Result<void, string>>;

  /**
   * Optional long-running setup that runs after lattice persists minion metadata.
   * Used for provisioning steps that must happen before initMinion but after
   * the minion is registered (e.g., creating Lattice minions, pulling Docker images).
   *
   * Contract:
   * - MAY take minutes (streams progress via initLogger)
   * - MUST NOT call initLogger.logComplete() - that's handled by the caller
   * - On failure: throw; caller will log error and mark init failed
   * - Runtimes with this hook expect callers to use runFullInit/runBackgroundInit
   *
   * @param params Same as initMinion params
   */
  postCreateSetup?(params: MinionInitParams): Promise<void>;

  /**
   * Initialize minion asynchronously (may be slow, streams progress)
   * - LocalRuntime: Runs init hook if present
   * - SSHRuntime: Syncs files, checks out branch, runs init hook
   * Streams progress via initLogger.
   * @param params Minion initialization parameters
   * @returns Result indicating success or error
   */
  initMinion(params: MinionInitParams): Promise<MinionInitResult>;

  /**
   * Rename minion directory
   * - LocalRuntime: Uses git worktree move (worktrees managed by git)
   * - SSHRuntime: Uses mv (plain directories on remote, not worktrees)
   * Runtime computes minion paths internally from workdir + projectPath + minion names.
   * @param projectPath Project root path (local path, used for git commands in LocalRuntime and to extract project name)
   * @param oldName Current minion name
   * @param newName New minion name
   * @param abortSignal Optional abort signal for cancellation
   * @returns Promise resolving to Result with old/new paths on success, or error message
   */
  renameMinion(
    projectPath: string,
    oldName: string,
    newName: string,
    abortSignal?: AbortSignal
  ): Promise<
    { success: true; oldPath: string; newPath: string } | { success: false; error: string }
  >;

  /**
   * Delete minion directory
   * - LocalRuntime: Uses git worktree remove (with --force only if force param is true)
   * - SSHRuntime: Checks for uncommitted changes unless force is true, then uses rm -rf
   * Runtime computes minion path internally from workdir + projectPath + minionName.
   *
   * **CRITICAL: Implementations must NEVER auto-apply --force or skip dirty checks without explicit force=true.**
   * If minion has uncommitted changes and force=false, implementations MUST return error.
   * The force flag is the user's explicit intent - implementations must not override it.
   *
   * @param projectPath Project root path (local path, used for git commands in LocalRuntime and to extract project name)
   * @param minionName Minion name to delete
   * @param force If true, force deletion even with uncommitted changes or special conditions (submodules, etc.)
   * @param abortSignal Optional abort signal for cancellation
   * @returns Promise resolving to Result with deleted path on success, or error message
   */
  deleteMinion(
    projectPath: string,
    minionName: string,
    force: boolean,
    abortSignal?: AbortSignal
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }>;

  /**
   * Ensure the runtime is ready for operations.
   * - LocalRuntime: Always returns ready (no-op)
   * - DockerRuntime: Starts container if stopped
   * - SSHRuntime: Could verify connection (future)
   * - LatticeSSHRuntime: Checks minion status, starts if stopped, waits for ready
   *
   * Called automatically by AIService before streaming.
   *
   * @param options Optional config: statusSink for progress events, signal for cancellation
   * @returns Result indicating ready or failure with error type for retry decisions
   */
  ensureReady(options?: EnsureReadyOptions): Promise<EnsureReadyResult>;

  /**
   * Fork an existing minion to create a new one.
   * Creates a new minion branching from the source minion's current branch.
   * Capability and error behavior are runtime-defined; shared orchestration
   * (see forkOrchestrator.ts) handles policy differences between user and task forks.
   *
   * @param params Fork parameters (source minion name, new minion name, etc.)
   * @returns Result with new minion path and source branch, or error
   */
  forkMinion(params: MinionForkParams): Promise<MinionForkResult>;

  /**
   * Get the runtime's temp directory (absolute path, resolved).
   * - LocalRuntime: /tmp (or OS temp dir)
   * - SSHRuntime: Resolved remote temp dir (e.g., /tmp)
   *
   * Used for background process output, temporary files, etc.
   */
  tempDir(): Promise<string>;

  /**
   * Get the lattice home directory for this runtime.
   * Used for storing plan files and other lattice-specific data.
   * - LocalRuntime/SSHRuntime: ~/.lattice (tilde expanded by runtime)
   * - DockerRuntime: /var/lattice (world-readable, avoids /root permission issues)
   */
  getLatticeHome(): string;
}

/**
 * Result of checking if a runtime type is available for a project.
 * Re-exported for backward compatibility with existing imports.
 */
export type RuntimeAvailability = RuntimeAvailabilityStatus;

/**
 * Error thrown by runtime implementations
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly type: "exec" | "file_io" | "network" | "unknown",
    public readonly cause?: Error
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}
