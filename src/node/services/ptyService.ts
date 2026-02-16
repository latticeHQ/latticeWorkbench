/**
 * PTY Service - Manages terminal PTY sessions
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Uses callbacks for output/exit events to avoid circular dependencies.
 */

import { randomUUID } from "crypto";
import { execFileSync } from "child_process";

import { log } from "@/node/services/log";
import type { Runtime } from "@/node/runtime/Runtime";
import type {
  TerminalSession,
  TerminalCreateParams,
  TerminalResizeParams,
} from "@/common/types/terminal";
import type { PtyHandle } from "@/node/runtime/transports";
import { spawnPtyProcess } from "@/node/runtime/ptySpawn";
import { SSHRuntime } from "@/node/runtime/SSHRuntime";
import { LocalBaseRuntime } from "@/node/runtime/LocalBaseRuntime";
import { DockerRuntime } from "@/node/runtime/DockerRuntime";
import { DevcontainerRuntime } from "@/node/runtime/DevcontainerRuntime";
import type { RuntimeConfig } from "@/common/types/runtime";
import { access } from "fs/promises";
import { constants } from "fs";
import { resolveLocalPtyShell } from "@/node/utils/main/resolveLocalPtyShell";

function shellQuotePath(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Resolve a command name to its absolute path using /usr/bin/which so that
 * node-pty's posix_spawnp receives an absolute path and skips its own PATH
 * search entirely.
 *
 * Background: posix_spawnp uses the C-level `environ` global, not Node's JS
 * process.env proxy. When Node/Bun patches PATH at startup (after the native
 * addon is loaded), the C-level PATH may be stale, causing ENOENT even though
 * process.env.PATH looks correct.  Passing an absolute path side-steps the
 * issue completely.
 */
function resolveCommandPath(command: string): string {
  if (command.startsWith("/")) return command; // already absolute
  try {
    const resolved = execFileSync("/usr/bin/which", [command], {
      encoding: "utf8",
      timeout: 3000,
      env: { PATH: process.env.PATH ?? process.env.Path ?? "" },
    }).trim();
    return resolved || command;
  } catch {
    return command; // fall back — posix_spawnp might still find it
  }
}

interface SessionData {
  pty: PtyHandle;
  workspaceId: string;
  workspacePath: string;
  runtime: Runtime;
  runtimeLabel: string;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

/**
 * Create a data handler that buffers incomplete escape sequences
 */
function createBufferedDataHandler(onData: (data: string) => void): (data: string) => void {
  let buffer = "";
  return (data: string) => {
    buffer += data;
    let sendUpTo = buffer.length;

    // Hold back incomplete escape sequences
    if (buffer.endsWith("\x1b")) {
      sendUpTo = buffer.length - 1;
    } else if (buffer.endsWith("\x1b[")) {
      sendUpTo = buffer.length - 2;
    } else {
      // eslint-disable-next-line no-control-regex, @typescript-eslint/prefer-regexp-exec
      const match = buffer.match(/\x1b\[[0-9;]*$/);
      if (match) {
        sendUpTo = buffer.length - match[0].length;
      }
    }

    if (sendUpTo > 0) {
      onData(buffer.substring(0, sendUpTo));
      buffer = buffer.substring(sendUpTo);
    }
  };
}

/**
 * PTYService - Manages terminal PTY sessions for workspaces
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Each workspace can have one or more terminal sessions.
 */
export class PTYService {
  private sessions = new Map<string, SessionData>();

  /**
   * Create a new terminal session for a workspace
   */
  async createSession(
    params: TerminalCreateParams,
    runtime: Runtime,
    workspacePath: string,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
    runtimeConfig?: RuntimeConfig
  ): Promise<TerminalSession> {
    // Include a random suffix to avoid collisions when creating multiple sessions quickly.
    // Collisions can cause two PTYs to appear "merged" under one sessionId.
    const sessionId = `${params.workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let ptyProcess: PtyHandle | null = null;
    let runtimeLabel: string;

    if (runtime instanceof SSHRuntime) {
      ptyProcess = await runtime.createPtySession({
        workspacePath,
        cols: params.cols,
        rows: params.rows,
      });
      runtimeLabel = "SSH";
      log.info(`[PTY] SSH terminal for ${sessionId}: ssh ${runtime.getConfig().host}`);
    } else if (runtime instanceof DevcontainerRuntime) {
      // Must check before LocalBaseRuntime since DevcontainerRuntime extends it
      const devcontainerArgs = ["exec", "--workspace-folder", workspacePath];

      // Include config path for non-default devcontainer.json locations
      if (runtimeConfig?.type === "devcontainer" && runtimeConfig.configPath) {
        devcontainerArgs.push("--config", runtimeConfig.configPath);
      }

      devcontainerArgs.push("--", "/bin/sh");
      runtimeLabel = "Devcontainer";
      log.info(
        `[PTY] Devcontainer terminal for ${sessionId}: devcontainer ${devcontainerArgs.join(" ")}`
      );

      ptyProcess = spawnPtyProcess({
        runtimeLabel,
        command: "devcontainer",
        args: devcontainerArgs,
        cwd: workspacePath,
        cols: params.cols,
        rows: params.rows,
        preferElectronBuild: false,
      });
    } else if (runtime instanceof LocalBaseRuntime) {
      try {
        await access(workspacePath, constants.F_OK);
      } catch {
        throw new Error(`Workspace path does not exist: ${workspacePath}`);
      }
      runtimeLabel = "Local";

      if (params.initialCommand && params.directExec) {
        // "Direct exec" via shell exec-replacement:
        //
        // We want the PTY to BE the agent binary (claude, codex, …) with no shell prompt
        // or echoed command visible.  node-pty's pty.fork() + execvp() works fine for
        // standard system binaries but fails with Bun single-file executables (the claude
        // and codex binaries embed a full Bun runtime in a __BUN Mach-O section; the
        // fork+exec path in node-pty's native addon conflicts with Bun's loader, producing
        // "posix_spawnp failed").
        //
        // Solution: spawn the user's shell with `-c "exec <absolute-path>"`.
        //   • The shell itself spawns fine via node-pty (it's a standard OS binary).
        //   • The shell runs exec immediately, replacing itself with the agent binary.
        //   • After exec the PTY process IS the agent — no shell remains, no prompt shown.
        //   • Using `-c` (non-interactive) means zsh/bash never writes a prompt before exec.
        const [rawCommand, ...extraArgs] = params.initialCommand.trim().split(/\s+/);
        const resolvedBinary = resolveCommandPath(rawCommand);
        const allParts = [resolvedBinary, ...extraArgs];
        const execArg = allParts.map(shellQuotePath).join(" ");
        const shell = process.env.SHELL ?? "/bin/zsh";
        log.info(
          `Spawning PTY (exec via shell): ${shell} -c "exec ${execArg}", cwd: ${workspacePath}, size: ${params.cols}x${params.rows}`
        );
        ptyProcess = spawnPtyProcess({
          runtimeLabel,
          command: shell,
          args: ["-c", `exec ${execArg}`],
          cwd: workspacePath,
          cols: params.cols,
          rows: params.rows,
          // false = use @lydell/node-pty (dev-server build), same as the shell terminal path.
          // The Electron-ABI node-pty build fails with posix_spawnp in the Bun dev server.
          preferElectronBuild: false,
        });
      } else {
        const shell = resolveLocalPtyShell();

        if (!shell.command.trim()) {
          throw new Error("Cannot spawn Local terminal: empty shell command");
        }

        const printableArgs = shell.args.length > 0 ? ` ${shell.args.join(" ")}` : "";
        log.info(
          `Spawning PTY: ${shell.command}${printableArgs}, cwd: ${workspacePath}, size: ${params.cols}x${params.rows}`
        );
        log.debug(`process.env.SHELL: ${process.env.SHELL ?? "undefined"}`);
        log.debug(`process.env.PATH: ${process.env.PATH ?? process.env.Path ?? "undefined"}`);

        ptyProcess = spawnPtyProcess({
          runtimeLabel,
          command: shell.command,
          args: shell.args,
          cwd: workspacePath,
          cols: params.cols,
          rows: params.rows,
          preferElectronBuild: true,
          logLocalEnv: true,
        });
      }
    } else if (runtime instanceof DockerRuntime) {
      const containerName = runtime.getContainerName();
      if (!containerName) {
        throw new Error("Docker container not initialized");
      }
      const dockerArgs = [
        "exec",
        "-it",
        containerName,
        "/bin/sh",
        "-c",
        `cd ${shellQuotePath(workspacePath)} && exec /bin/sh`,
      ];
      runtimeLabel = "Docker";
      log.info(`[PTY] Docker terminal for ${sessionId}: docker ${dockerArgs.join(" ")}`);

      ptyProcess = spawnPtyProcess({
        runtimeLabel,
        command: "docker",
        args: dockerArgs,
        cwd: process.cwd(),
        cols: params.cols,
        rows: params.rows,
        preferElectronBuild: false,
      });
    } else {
      throw new Error(`Unsupported runtime type: ${runtime.constructor.name}`);
    }

    log.info(
      `Creating terminal session ${sessionId} for workspace ${params.workspaceId} (${runtimeLabel})`
    );
    log.info(`[PTY] Terminal size: ${params.cols}x${params.rows}`);

    if (!ptyProcess) {
      throw new Error(`Failed to initialize ${runtimeLabel} terminal session`);
    }

    // Wire up handlers
    ptyProcess.onData(createBufferedDataHandler(onData));
    ptyProcess.onExit(({ exitCode }) => {
      log.info(`${runtimeLabel} terminal session ${sessionId} exited with code ${exitCode}`);
      this.sessions.delete(sessionId);
      onExit(exitCode);
    });

    this.sessions.set(sessionId, {
      pty: ptyProcess,
      workspaceId: params.workspaceId,
      workspacePath,
      runtime,
      runtimeLabel,
      onData,
      onExit,
    });

    return {
      sessionId,
      workspaceId: params.workspaceId,
      cols: params.cols,
      rows: params.rows,
    };
  }

  /**
   * Send input to a terminal session
   */
  sendInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.pty) {
      log.info(`Cannot send input to session ${sessionId}: not found or no PTY`);
      return;
    }

    // Works for both local and SSH now
    session.pty.write(data);
  }

  /**
   * Resize a terminal session
   */
  resize(params: TerminalResizeParams): void {
    const session = this.sessions.get(params.sessionId);
    if (!session?.pty) {
      log.info(`Cannot resize terminal session ${params.sessionId}: not found or no PTY`);
      return;
    }

    // Now works for both local AND SSH! 🎉
    session.pty.resize(params.cols, params.rows);
    log.debug(
      `Resized terminal ${params.sessionId} (${session.runtimeLabel}) to ${params.cols}x${params.rows}`
    );
  }

  /**
   * Close a terminal session
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.info(`Cannot close terminal session ${sessionId}: not found`);
      return;
    }

    log.info(`Closing terminal session ${sessionId}`);

    if (session.pty) {
      // Works for both local and SSH
      session.pty.kill();
    }

    this.sessions.delete(sessionId);
  }

  /**
   * Get all session IDs for a workspace.
   * Used by frontend to discover existing sessions to reattach to after reload.
   */
  getWorkspaceSessionIds(workspaceId: string): string[] {
    return Array.from(this.sessions.entries())
      .filter(([, session]) => session.workspaceId === workspaceId)
      .map(([id]) => id);
  }

  /**
   * Close all terminal sessions for a workspace
   */
  closeWorkspaceSessions(workspaceId: string): void {
    const sessionIds = Array.from(this.sessions.entries())
      .filter(([, session]) => session.workspaceId === workspaceId)
      .map(([id]) => id);

    log.info(`Closing ${sessionIds.length} terminal session(s) for workspace ${workspaceId}`);

    sessionIds.forEach((id) => this.closeSession(id));
  }

  /**
   * Close all terminal sessions.
   * Called during server shutdown to prevent orphan PTY processes.
   */
  closeAllSessions(): void {
    const sessionIds = Array.from(this.sessions.keys());
    log.info(`Closing all ${sessionIds.length} terminal session(s)`);
    sessionIds.forEach((id) => this.closeSession(id));
  }

  /**
   * Get all sessions for debugging
   */
  getSessions(): Map<string, SessionData> {
    return this.sessions;
  }
}
