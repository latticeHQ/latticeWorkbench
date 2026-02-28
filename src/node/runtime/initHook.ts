import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import type { ExecOptions, ExecStream, InitLogger } from "./Runtime";
import {
  isWorktreeRuntime,
  isSSHRuntime,
  isDockerRuntime,
  isDevcontainerRuntime,
  type RuntimeConfig,
  type RuntimeMode,
} from "@/common/types/runtime";

import type { ThinkingLevel } from "@/common/types/thinking";

/**
 * Check if .lattice/init hook exists and is executable
 * @param projectPath - Path to the project root
 * @returns true if hook exists and is executable, false otherwise
 */
export async function checkInitHookExists(projectPath: string): Promise<boolean> {
  const hookPath = path.join(projectPath, ".lattice", "init");

  try {
    await fsPromises.access(hookPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the init hook path for a project
 */
export function getInitHookPath(projectPath: string): string {
  return path.join(projectPath, ".lattice", "init");
}

/**
 * Get LATTICE_ environment variables for bash execution.
 * Used by both init hook and regular bash tool calls.
 * @param projectPath - Path to project root (local path for LocalRuntime, remote path for SSHRuntime)
 * @param runtime - Runtime type: "local", "worktree", "ssh", or "docker"
 * @param minionName - Name of the minion (branch name or custom name)
 */
export function getLatticeEnv(
  projectPath: string,
  runtime: RuntimeMode,
  minionName: string,
  options?: {
    modelString?: string;
    thinkingLevel?: ThinkingLevel;
    /** Cumulative session costs in USD (if available) */
    costsUsd?: number;
  }
): Record<string, string> {
  if (!projectPath) {
    throw new Error("getLatticeEnv: projectPath is required");
  }
  if (!minionName) {
    throw new Error("getLatticeEnv: minionName is required");
  }

  const env: Record<string, string> = {
    LATTICE_PROJECT_PATH: projectPath,
    LATTICE_RUNTIME: runtime,
    LATTICE_MINION_NAME: minionName,
  };

  if (options?.modelString) {
    env.LATTICE_MODEL_STRING = options.modelString;
  }

  if (options?.thinkingLevel !== undefined) {
    env.LATTICE_THINKING_LEVEL = options.thinkingLevel;
  }

  if (options?.costsUsd !== undefined) {
    env.LATTICE_COSTS_USD = options.costsUsd.toFixed(2);
  }

  return env;
}

/**
 * Get the effective runtime type from a RuntimeConfig.
 * Handles legacy "local" with srcBaseDir → "worktree" mapping.
 */
export function getRuntimeType(config: RuntimeConfig | undefined): RuntimeMode {
  if (!config) return "worktree"; // Default to worktree for undefined config
  if (isSSHRuntime(config)) return "ssh";
  if (isDockerRuntime(config)) return "docker";
  if (isDevcontainerRuntime(config)) return "devcontainer";
  if (isWorktreeRuntime(config)) return "worktree";
  return "local";
}

/**
 * Line-buffered logger that splits stream output into lines and logs them
 * Handles incomplete lines by buffering until a newline is received
 */
export class LineBuffer {
  private buffer = "";
  private readonly logLine: (line: string) => void;

  constructor(logLine: (line: string) => void) {
    this.logLine = logLine;
  }

  /**
   * Process a chunk of data, splitting on newlines and logging complete lines
   */
  append(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // Keep last incomplete line
    for (const line of lines) {
      if (line) this.logLine(line);
    }
  }

  /**
   * Flush any remaining buffered data (called when stream closes)
   */
  flush(): void {
    if (this.buffer) {
      this.logLine(this.buffer);
      this.buffer = "";
    }
  }
}

/**
 * Create line-buffered loggers for stdout and stderr
 * Returns an object with append and flush methods for each stream
 */
export function createLineBufferedLoggers(initLogger: InitLogger) {
  const stdoutBuffer = new LineBuffer((line) => initLogger.logStdout(line));
  const stderrBuffer = new LineBuffer((line) => initLogger.logStderr(line));

  return {
    stdout: {
      append: (data: string) => stdoutBuffer.append(data),
      flush: () => stdoutBuffer.flush(),
    },
    stderr: {
      append: (data: string) => stderrBuffer.append(data),
      flush: () => stderrBuffer.flush(),
    },
  };
}

/**
 * Minimal runtime interface needed for running init hooks.
 * This allows the helper to work with any runtime implementation.
 */
export interface InitHookRuntime {
  exec(command: string, options: ExecOptions): Promise<ExecStream>;
}

/**
 * Run .lattice/init hook on a runtime and stream output to logger.
 * Shared implementation used by SSH and Docker runtimes.
 *
 * @param runtime - Runtime instance with exec capability
 * @param hookPath - Full path to the init hook (e.g., "/src/.lattice/init" or "~/lattice/project/minion/.lattice/init")
 * @param minionPath - Working directory for the hook
 * @param latticeEnv - LATTICE_ environment variables from getLatticeEnv()
 * @param initLogger - Logger for streaming output
 * @param abortSignal - Optional abort signal
 */
export async function runInitHookOnRuntime(
  runtime: InitHookRuntime,
  hookPath: string,
  minionPath: string,
  latticeEnv: Record<string, string>,
  initLogger: InitLogger,
  abortSignal?: AbortSignal
): Promise<void> {
  initLogger.logStep(`Running init hook: ${hookPath}`);

  const hookStream = await runtime.exec(hookPath, {
    cwd: minionPath,
    timeout: 3600, // 1 hour - generous timeout for init hooks
    abortSignal,
    // When init is cancellable (archive/remove), we want abort to actually stop the remote hook.
    // With OpenSSH, allocating a PTY ensures the remote process is tied to the session and
    // receives a hangup when the client disconnects.
    forcePTY: abortSignal !== undefined,
    env: latticeEnv,
  });

  // Create line-buffered loggers for proper output handling
  const loggers = createLineBufferedLoggers(initLogger);
  const stdoutReader = hookStream.stdout.getReader();
  const stderrReader = hookStream.stderr.getReader();
  const decoder = new TextDecoder();

  // Read stdout in parallel
  const readStdout = async () => {
    try {
      while (true) {
        const { done, value } = await stdoutReader.read();
        if (done) break;
        loggers.stdout.append(decoder.decode(value, { stream: true }));
      }
      loggers.stdout.flush();
    } finally {
      stdoutReader.releaseLock();
    }
  };

  // Read stderr in parallel
  const readStderr = async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        loggers.stderr.append(decoder.decode(value, { stream: true }));
      }
      loggers.stderr.flush();
    } finally {
      stderrReader.releaseLock();
    }
  };

  // Wait for all streams and exit code
  const [exitCode] = await Promise.all([hookStream.exitCode, readStdout(), readStderr()]);

  // Log completion with exit code - hook failures are non-fatal per https://latticeruntime.com/hooks/init
  // ("failures are logged but don't prevent minion usage")
  initLogger.logComplete(exitCode);
}
