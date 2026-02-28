/**
 * PTY Service - Manages terminal PTY sessions
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Uses callbacks for output/exit events to avoid circular dependencies.
 */

import { randomUUID } from "crypto";

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

interface SessionData {
  pty: PtyHandle;
  minionId: string;
  minionPath: string;
  runtime: Runtime;
  runtimeLabel: string;
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

interface CreateSessionOptions {
  env?: NodeJS.ProcessEnv;
  /** User-configured default shell from config.json. */
  defaultShell?: string;
  /** Profile command — spawn this instead of the default shell (e.g. "claude", "aider") */
  profileCommand?: string;
  /** Arguments for the profile command */
  profileArgs?: string[];
  /** Additional env vars from the terminal profile */
  profileEnv?: Record<string, string>;
  /** Override the auto-generated session ID (used for restoring persisted sessions). */
  sessionId?: string;
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
 * PTYService - Manages terminal PTY sessions for minions
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Each minion can have one or more terminal sessions.
 */
export class PTYService {
  private sessions = new Map<string, SessionData>();

  /**
   * Create a new terminal session for a minion
   */
  async createSession(
    params: TerminalCreateParams,
    runtime: Runtime,
    minionPath: string,
    onData: (data: string) => void,
    onExit: (exitCode: number) => void,
    runtimeConfig?: RuntimeConfig,
    options?: CreateSessionOptions
  ): Promise<TerminalSession> {
    // Reuse a persisted session ID on restore, or generate a new one.
    // Random suffix avoids collisions when creating multiple sessions quickly.
    const sessionId =
      options?.sessionId ?? `${params.minionId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let ptyProcess: PtyHandle | null = null;
    let runtimeLabel: string;

    if (runtime instanceof SSHRuntime) {
      ptyProcess = await runtime.createPtySession({
        minionPath,
        cols: params.cols,
        rows: params.rows,
      });
      runtimeLabel = "SSH";
      log.info(`[PTY] SSH terminal for ${sessionId}: ssh ${runtime.getConfig().host}`);
    } else if (runtime instanceof DevcontainerRuntime) {
      // Must check before LocalBaseRuntime since DevcontainerRuntime extends it
      const devcontainerArgs = ["exec", "--minion-folder", minionPath];

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
        cwd: minionPath,
        cols: params.cols,
        rows: params.rows,
        preferElectronBuild: false,
      });
    } else if (runtime instanceof LocalBaseRuntime) {
      try {
        await access(minionPath, constants.F_OK);
      } catch {
        throw new Error(`Minion path does not exist: ${minionPath}`);
      }

      // Terminal profiles: if a profile command is provided, spawn it directly
      // instead of the default shell. This lets tools like Claude Code, Aider,
      // etc. run as the top-level process (not inside a shell).
      const useProfile = options?.profileCommand != null;
      const command = useProfile ? options.profileCommand : undefined;
      const profileArgs = useProfile ? (options.profileArgs ?? []) : undefined;

      const shell = useProfile
        ? { command: command!, args: profileArgs! }
        : resolveLocalPtyShell({ configuredShell: options?.defaultShell });

      runtimeLabel = useProfile ? "Profile" : "Local";

      if (!shell.command.trim()) {
        throw new Error("Cannot spawn Local terminal: empty shell command");
      }

      // Merge profile env vars with minion env
      const mergedEnv =
        useProfile && options.profileEnv
          ? { ...options?.env, ...options.profileEnv }
          : options?.env;

      const printableArgs = shell.args.length > 0 ? ` ${shell.args.join(" ")}` : "";
      log.info(
        `Spawning PTY: ${shell.command}${printableArgs}, cwd: ${minionPath}, size: ${params.cols}x${params.rows}`
      );
      log.debug(`process.env.SHELL: ${process.env.SHELL ?? "undefined"}`);
      log.debug(`process.env.PATH: ${process.env.PATH ?? process.env.Path ?? "undefined"}`);

      ptyProcess = spawnPtyProcess({
        runtimeLabel,
        command: shell.command,
        args: shell.args,
        cwd: minionPath,
        cols: params.cols,
        rows: params.rows,
        preferElectronBuild: true,
        env: mergedEnv,
        logLocalEnv: true,
      });
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
        `cd ${shellQuotePath(minionPath)} && exec /bin/sh`,
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
      `Creating terminal session ${sessionId} for minion ${params.minionId} (${runtimeLabel})`
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
      minionId: params.minionId,
      minionPath,
      runtime,
      runtimeLabel,
      onData,
      onExit,
    });

    return {
      sessionId,
      minionId: params.minionId,
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
   * Get all session IDs for a minion.
   * Used by frontend to discover existing sessions to reattach to after reload.
   */
  getMinionSessionIds(minionId: string): string[] {
    return Array.from(this.sessions.entries())
      .filter(([, session]) => session.minionId === minionId)
      .map(([id]) => id);
  }

  /**
   * Close all terminal sessions for a minion
   */
  closeMinionSessions(minionId: string): void {
    const sessionIds = Array.from(this.sessions.entries())
      .filter(([, session]) => session.minionId === minionId)
      .map(([id]) => id);

    log.info(`Closing ${sessionIds.length} terminal session(s) for minion ${minionId}`);

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
