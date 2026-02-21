/**
 * PTY Service - Manages terminal PTY sessions with lifecycle guard.
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Uses callbacks for output/exit events to avoid circular dependencies.
 *
 * PTY Lifecycle Guard (prevents PTY exhaustion at scale):
 *   1. PID tracking — writes spawned PIDs to ~/.lattice/pty-pids.json
 *   2. Startup reaper — kills orphaned PTYs from crashed server instances
 *   3. Concurrent limit — refuses to spawn beyond MAX_CONCURRENT_PTYS
 *   4. Dead session pruner — periodic scan removes sessions whose PTY died
 */

import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";

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
import { getLatticePtyPidsFile } from "@/common/constants/paths";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max concurrent PTY sessions. Override with LATTICE_MAX_PTYS env var. */
const MAX_CONCURRENT_PTYS = Number(process.env.LATTICE_MAX_PTYS) || 64;

/** How often to scan for dead sessions (ms) */
const PRUNE_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Check whether a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = existence check, no actual signal sent
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// PID file types
// ---------------------------------------------------------------------------

interface PtyPidFile {
  serverPid: number;
  pids: number[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Session data
// ---------------------------------------------------------------------------

interface SessionData {
  pty: PtyHandle;
  /** OS-level PID of the PTY process. -1 for remote (SSH/Docker) sessions. */
  pid: number;
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

// ---------------------------------------------------------------------------
// PTYService
// ---------------------------------------------------------------------------

/**
 * PTYService - Manages terminal PTY sessions for workspaces
 *
 * Handles local, SSH, SSH2, and Docker terminal sessions (node-pty + ssh2).
 * Each workspace can have one or more terminal sessions.
 *
 * Includes PTY lifecycle guard:
 *  - Tracks spawned PIDs on disk for crash recovery
 *  - Enforces concurrent session limit (default 64, env LATTICE_MAX_PTYS)
 *  - Periodically prunes sessions whose PTY process has died
 */
export class PTYService {
  private sessions = new Map<string, SessionData>();
  private readonly latticeHome: string;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(latticeHome: string) {
    this.latticeHome = latticeHome;

    // Start periodic dead-session pruner
    this.pruneTimer = setInterval(() => {
      this.pruneDeadSessions();
    }, PRUNE_INTERVAL_MS);
    // Don't keep the process alive just for pruning
    if (this.pruneTimer && typeof this.pruneTimer === "object" && "unref" in this.pruneTimer) {
      this.pruneTimer.unref();
    }

    log.info(`[PTY Guard] Initialized — max concurrent PTYs: ${MAX_CONCURRENT_PTYS}, prune interval: ${PRUNE_INTERVAL_MS}ms`);
  }

  // =========================================================================
  // Static: Orphan Reaper (call on server startup)
  // =========================================================================

  /**
   * Kill orphaned PTY processes left behind by a crashed server instance.
   *
   * Reads the PID tracking file, checks each PID, and SIGKILL any that
   * are still alive but belong to a different (now-dead) server process.
   * Safe to call before PTYService is instantiated.
   */
  static reapOrphans(latticeHome: string): void {
    const pidFile = getLatticePtyPidsFile(latticeHome);
    let data: PtyPidFile;

    try {
      const raw = fs.readFileSync(pidFile, "utf-8");
      data = JSON.parse(raw) as PtyPidFile;
    } catch {
      // No PID file or corrupt — nothing to reap
      return;
    }

    // If the server that wrote this file is still alive, don't touch its PTYs
    if (isProcessAlive(data.serverPid)) {
      log.info(`[PTY Guard] Previous server (PID ${data.serverPid}) is still alive — skipping reap`);
      return;
    }

    let reaped = 0;
    for (const pid of data.pids) {
      if (isProcessAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
          reaped++;
          log.info(`[PTY Guard] Reaped orphan PTY process ${pid}`);
        } catch (e) {
          log.warn(`[PTY Guard] Failed to kill orphan PID ${pid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Delete stale PID file
    try {
      fs.unlinkSync(pidFile);
    } catch {
      // ignore
    }

    if (reaped > 0) {
      log.info(`[PTY Guard] Reaped ${reaped} orphan PTY process(es) from crashed server (PID ${data.serverPid})`);
    } else {
      log.info(`[PTY Guard] No orphan PTY processes found`);
    }
  }

  // =========================================================================
  // PID tracking (disk persistence)
  // =========================================================================

  /** Persist current active PIDs to disk (atomic write). */
  private persistPids(): void {
    const pids: number[] = [];
    for (const session of this.sessions.values()) {
      if (session.pid > 0) {
        pids.push(session.pid);
      }
    }

    const data: PtyPidFile = {
      serverPid: process.pid,
      pids,
      updatedAt: new Date().toISOString(),
    };

    const pidFile = getLatticePtyPidsFile(this.latticeHome);
    const tmpFile = pidFile + ".tmp";

    try {
      // Ensure directory exists
      const dir = path.dirname(pidFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Atomic write: temp file → rename
      fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmpFile, pidFile);
    } catch (e) {
      log.warn(`[PTY Guard] Failed to persist PIDs: ${e instanceof Error ? e.message : String(e)}`);
      // Non-fatal — guard is best-effort
    }
  }

  /** Remove the PID file on clean shutdown. */
  private removePidFile(): void {
    try {
      fs.unlinkSync(getLatticePtyPidsFile(this.latticeHome));
    } catch {
      // ignore
    }
  }

  // =========================================================================
  // Dead session pruner
  // =========================================================================

  /**
   * Scan all sessions and close any whose PTY process has died.
   * Runs on a 30-second interval to catch externally-killed agents.
   */
  private pruneDeadSessions(): void {
    const deadSessionIds: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      // Only check local PTYs (pid > 0). Remote sessions (SSH/Docker) have pid = -1.
      if (session.pid > 0 && !isProcessAlive(session.pid)) {
        deadSessionIds.push(sessionId);
      }
    }

    if (deadSessionIds.length > 0) {
      log.info(`[PTY Guard] Pruning ${deadSessionIds.length} dead session(s): ${deadSessionIds.join(", ")}`);
      for (const id of deadSessionIds) {
        this.closeSession(id);
      }
    }
  }

  // =========================================================================
  // Session management
  // =========================================================================

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
    // --- PTY limit check ---
    if (this.sessions.size >= MAX_CONCURRENT_PTYS) {
      throw new Error(
        `PTY limit reached (${this.sessions.size}/${MAX_CONCURRENT_PTYS}). ` +
        `Close idle agents before spawning new ones. ` +
        `Override limit with LATTICE_MAX_PTYS env var.`
      );
    }

    // Include a random suffix to avoid collisions when creating multiple sessions quickly.
    // Collisions can cause two PTYs to appear "merged" under one sessionId.
    const sessionId = `${params.workspaceId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let ptyProcess: PtyHandle | null = null;
    let runtimeLabel: string;
    let pid = -1; // -1 = remote/unknown, will be overwritten for local spawns

    if (runtime instanceof SSHRuntime) {
      ptyProcess = await runtime.createPtySession({
        workspacePath,
        cols: params.cols,
        rows: params.rows,
        initialCommand: params.initialCommand,
        directExec: params.directExec,
      });
      runtimeLabel = "SSH";
      const execNote = params.directExec ? " (direct exec)" : "";
      log.info(`[PTY] SSH terminal${execNote} for ${sessionId}: ssh ${runtime.getConfig().host}`);
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
      // devcontainer exec spawns local process — extract PID
      if ("pid" in ptyProcess && typeof ptyProcess.pid === "number") {
        pid = ptyProcess.pid;
      }
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
          // false = use @lydell/node-pty (Bun/dev ABI).
          // The Electron-ABI build (preferElectronBuild: true) causes posix_spawnp
          // failures in the Bun dev-server because the native addon conflicts with
          // Bun's loader — the same reason directExec uses false above.
          preferElectronBuild: false,
          logLocalEnv: true,
        });
      }

      // Extract PID from local PTY (IPty has .pid)
      if ("pid" in ptyProcess && typeof ptyProcess.pid === "number") {
        pid = ptyProcess.pid;
      }
    } else if (runtime instanceof DockerRuntime) {
      const containerName = runtime.getContainerName();
      if (!containerName) {
        throw new Error("Docker container not initialized");
      }
      runtimeLabel = "Docker";

      if (params.initialCommand && params.directExec) {
        // Direct exec: run the agent binary directly in the container, bypassing shell.
        // This ensures the agent auto-starts (same behavior as local directExec).
        const dockerArgs = [
          "exec",
          "-it",
          "-w", workspacePath,
          containerName,
          "/bin/sh", "-l", "-c", params.initialCommand,
        ];
        log.info(`[PTY] Docker terminal (direct exec) for ${sessionId}: docker ${dockerArgs.join(" ")}`);

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
        const dockerArgs = [
          "exec",
          "-it",
          containerName,
          "/bin/sh",
          "-c",
          `cd ${shellQuotePath(workspacePath)} && exec /bin/sh`,
        ];
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
      }
      // docker exec spawns local process
      if ("pid" in ptyProcess && typeof ptyProcess.pid === "number") {
        pid = ptyProcess.pid;
      }
    } else {
      throw new Error(`Unsupported runtime type: ${runtime.constructor.name}`);
    }

    log.info(
      `Creating terminal session ${sessionId} for workspace ${params.workspaceId} (${runtimeLabel})` +
      (pid > 0 ? ` [PID ${pid}]` : "")
    );
    log.info(`[PTY] Terminal size: ${params.cols}x${params.rows}, active sessions: ${this.sessions.size + 1}/${MAX_CONCURRENT_PTYS}`);

    if (!ptyProcess) {
      throw new Error(`Failed to initialize ${runtimeLabel} terminal session`);
    }

    // Wire up handlers
    ptyProcess.onData(createBufferedDataHandler(onData));
    ptyProcess.onExit(({ exitCode }) => {
      log.info(`${runtimeLabel} terminal session ${sessionId} exited with code ${exitCode} [PID ${pid}]`);
      this.sessions.delete(sessionId);
      this.persistPids();
      onExit(exitCode);
    });

    this.sessions.set(sessionId, {
      pty: ptyProcess,
      pid,
      workspaceId: params.workspaceId,
      workspacePath,
      runtime,
      runtimeLabel,
      onData,
      onExit,
    });

    // Persist PIDs to disk for crash recovery
    this.persistPids();

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

    // Now works for both local AND SSH!
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

    log.info(`Closing terminal session ${sessionId} [PID ${session.pid}]`);

    if (session.pty) {
      // Works for both local and SSH
      session.pty.kill();
    }

    this.sessions.delete(sessionId);
    this.persistPids();
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
    // Stop the pruner
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }

    const sessionIds = Array.from(this.sessions.keys());
    log.info(`Closing all ${sessionIds.length} terminal session(s)`);
    sessionIds.forEach((id) => this.closeSession(id));

    // Remove PID file on clean shutdown
    this.removePidFile();
  }

  /**
   * Get all sessions for debugging
   */
  getSessions(): Map<string, SessionData> {
    return this.sessions;
  }
}
