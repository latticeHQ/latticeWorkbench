import type { IPty } from "node-pty";
import { log } from "@/node/services/log";
import { getErrorMessage } from "@/common/utils/errors";
import { getRealHome } from "@/common/utils/masHome";
import { masSpawn } from "@/node/native/masSpawn";

interface PtySpawnRequest {
  runtimeLabel: string;
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  preferElectronBuild: boolean;
  env?: NodeJS.ProcessEnv;
  pathEnv?: string;
  logLocalEnv?: boolean;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
function loadNodePty(runtimeType: string, preferElectronBuild: boolean): typeof import("node-pty") {
  const first = preferElectronBuild ? "node-pty" : "@lydell/node-pty";
  const second = preferElectronBuild ? "@lydell/node-pty" : "node-pty";

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
    const pty = require(first);
    log.debug(`Using ${first} for ${runtimeType}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return pty;
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
      const pty = require(second);
      log.debug(`Using ${second} for ${runtimeType} (fallback)`);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return pty;
    } catch (err) {
      log.error("Neither @lydell/node-pty nor node-pty available:", err);
      throw new Error(
        process.versions.electron
          ? `${runtimeType} terminals are not available. node-pty failed to load (likely due to Electron ABI version mismatch). Run 'make rebuild-native' to rebuild native modules.`
          : `${runtimeType} terminals are not available. No prebuilt binaries found for your platform. Supported: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64.`
      );
    }
  }
}

function resolvePathEnv(env: NodeJS.ProcessEnv, pathEnvOverride?: string): string | undefined {
  if (pathEnvOverride) {
    return pathEnvOverride;
  }

  const basePath =
    env.PATH ??
    env.Path ??
    (process.platform === "win32" ? undefined : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");

  // On macOS, ensure common binary directories are always included.
  // In MAS sandbox, PATH may be minimal and missing Homebrew, Bun, Cargo, etc.
  if (process.platform === "darwin" && basePath) {
    const realHome = getRealHome();
    const essential = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      `${realHome}/.bun/bin`,
      `${realHome}/.cargo/bin`,
      `${realHome}/.local/bin`,
      `${realHome}/.npm-global/bin`,
      `${realHome}/.nvm/current/bin`,
    ];
    const pathSet = new Set(basePath.split(":"));
    const missing = essential.filter((p) => !pathSet.has(p));
    // PREPEND so Homebrew/user-installed tools are found before /usr/bin shims.
    // In MAS sandbox, /usr/bin/git is an xcrun shim that fails; Homebrew git works.
    return missing.length > 0 ? `${missing.join(":")}:${basePath}` : basePath;
  }

  return basePath;
}

export function spawnPtyProcess(request: PtySpawnRequest): IPty {
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...request.env };
  const pathEnv = resolvePathEnv(mergedEnv, request.pathEnv);

  // HOME for MAS sandbox is set in main.ts loadServices() after security-scoped
  // bookmarks restore access. PTY spawn inherits the corrected process.env.HOME.

  // Ensure SHELL is set — MAS sandbox may not inherit it from launchd.
  // node-pty and spawned processes rely on SHELL for subshell invocations.
  const shellEnv =
    mergedEnv.SHELL?.trim() || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

  const env: NodeJS.ProcessEnv = {
    ...mergedEnv,
    TERM: "xterm-256color",
    SHELL: shellEnv,
    ...(pathEnv ? { PATH: pathEnv } : {}),
  };

  const spawnOpts = {
    name: "xterm-256color",
    cols: request.cols,
    rows: request.rows,
    cwd: request.cwd,
    env,
  };

  const isMAS = !!(process as NodeJS.Process & { mas?: boolean }).mas;
  log.info(`[PTY] Spawning: cmd=${request.command}, args=${request.args.join(" ")}, cwd=${request.cwd}, mas=${isMAS}, HOME=${process.env.HOME ?? "unset"}`);

  // MAS sandbox: skip node-pty entirely. Its spawn-helper binary crashes with
  // "Process is not in an inherited sandbox" (SIGTRAP) because it can't inherit
  // the App Sandbox profile. Use /usr/bin/script to allocate a real PTY instead.
  if (isMAS) {
    log.info(`[PTY] MAS build detected — bypassing node-pty, using direct shell fallback`);
    try {
      return spawnScriptPty(request, env);
    } catch (scriptErr) {
      const scriptErrMsg = getErrorMessage(scriptErr);
      log.error(`[PTY] MAS script fallback failed:`, scriptErr);

      if (request.logLocalEnv) {
        log.error(`Local PTY spawn config: ${request.command} ${request.args.join(" ")} (cwd: ${request.cwd})`);
        log.error(`process.env.HOME: ${process.env.HOME ?? "undefined"}`);
        log.error(`process.env.SHELL: ${process.env.SHELL ?? "undefined"}`);
        log.error(`process.env.PATH: ${process.env.PATH ?? process.env.Path ?? "undefined"}`);
      }

      throw new Error(`Failed to spawn ${request.runtimeLabel} terminal in MAS sandbox: ${scriptErrMsg}`);
    }
  }

  // Non-MAS: use node-pty as normal
  const pty = loadNodePty(request.runtimeLabel, request.preferElectronBuild);
  try {
    const result = pty.spawn(request.command, request.args, spawnOpts);
    log.info(`[PTY] Spawn succeeded: pid=${result.pid}`);
    return result;
  } catch (primaryErr) {
    const primaryErrMsg = getErrorMessage(primaryErr);
    log.error(`[PTY] Primary node-pty spawn failed for ${request.runtimeLabel}:`, primaryErr);

    // If EPERM, try the alternate node-pty variant — the NAPI-based
    // @lydell/node-pty may succeed where the Electron build fails, or vice versa.
    if (primaryErrMsg.includes("EPERM")) {
      try {
        const altPty = loadNodePty(request.runtimeLabel, !request.preferElectronBuild);
        if (altPty !== pty) {
          log.info(`[PTY] Retrying with alternate node-pty variant...`);
          return altPty.spawn(request.command, request.args, spawnOpts);
        }
      } catch (altErr) {
        log.error(`[PTY] Alternate node-pty variant also failed:`, altErr);
      }
    }

    const printableArgs = request.args.length > 0 ? ` ${request.args.join(" ")}` : "";
    const cmd = `${request.command}${printableArgs}`;
    const details = `cmd="${cmd}", cwd="${request.cwd}", platform="${process.platform}"`;

    if (request.logLocalEnv) {
      log.error(`Local PTY spawn config: ${cmd} (cwd: ${request.cwd})`);
      log.error(`process.env.HOME: ${process.env.HOME ?? "undefined"}`);
      log.error(`process.env.SHELL: ${process.env.SHELL ?? "undefined"}`);
      log.error(`process.env.PATH: ${process.env.PATH ?? process.env.Path ?? "undefined"}`);
    }

    throw new Error(`Failed to spawn ${request.runtimeLabel} terminal (${details}): ${primaryErrMsg}`);
  }
}

/**
 * MAS sandbox fallback: spawn an interactive shell directly via masSpawn()
 * and wrap it in an IPty-compatible interface.
 *
 * The MAS sandbox blocks PTY allocation (openpty/posix_openpt/forkpty) which
 * breaks both node-pty's spawn-helper and /usr/bin/script. So we spawn the
 * shell directly with -i (force interactive) over piped stdio. This gives us
 * a working terminal without full PTY capabilities (no cursor movement, no
 * resize), but commands, output, and colors (via TERM=xterm-256color) work.
 */
function spawnScriptPty(request: PtySpawnRequest, env: NodeJS.ProcessEnv): IPty {
  const shell = request.command;
  const shellArgs = request.args;

  // Force interactive mode since we don't have a real PTY.
  // -i makes zsh/bash show a prompt and accept commands even with piped stdio.
  const forceInteractiveArgs = ["-i", ...shellArgs];

  const child = masSpawn(shell, forceInteractiveArgs, {
    cwd: request.cwd,
    env: env as Record<string, string>,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!child.pid) {
    throw new Error(`Failed to spawn ${shell} — no PID`);
  }

  log.info(`[PTY] MAS direct shell fallback spawned: pid=${child.pid}, shell=${shell}`);

  // Track data listeners for local echo (piped stdio doesn't echo keystrokes)
  const dataListeners: Array<(data: string) => void> = [];

  // Create an IPty-compatible wrapper
  const ptyObj: IPty = {
    pid: child.pid,
    cols: request.cols,
    rows: request.rows,
    process: shell,
    handleFlowControl: false,

    onData: (listener: (data: string) => void) => {
      dataListeners.push(listener);
      // stdout carries shell output
      child.stdout?.on("data", (chunk: Buffer) => {
        listener(chunk.toString("utf-8"));
      });
      // stderr carries shell errors (zshrc warnings etc.)
      child.stderr?.on("data", (chunk: Buffer) => {
        listener(chunk.toString("utf-8"));
      });
      return { dispose: () => {
        const idx = dataListeners.indexOf(listener);
        if (idx >= 0) dataListeners.splice(idx, 1);
        child.stdout?.removeAllListeners("data");
        child.stderr?.removeAllListeners("data");
      } };
    },

    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
      child.on("exit", (code: number | null, signal: string | null) => {
        listener({ exitCode: code ?? 0, signal: signal ? parseInt(signal, 10) || undefined : undefined });
      });
      return { dispose: () => { child.removeAllListeners("exit"); } };
    },

    write: (data: string) => {
      child.stdin?.write(data);

      // Local echo: piped stdio doesn't echo keystrokes, so we do it manually.
      // Without a real PTY, the terminal (xterm.js) won't see what the user types.
      for (const listener of dataListeners) {
        for (const ch of data) {
          if (ch === "\r") {
            // Enter: echo newline
            listener("\r\n");
          } else if (ch === "\x7f" || ch === "\b") {
            // Backspace: move cursor back, overwrite with space, move back
            listener("\b \b");
          } else if (ch === "\x03") {
            // Ctrl+C: echo ^C and newline
            listener("^C\r\n");
          } else if (ch === "\x04") {
            // Ctrl+D: echo ^D
            listener("^D");
          } else if (ch.charCodeAt(0) >= 32) {
            // Printable characters: echo as-is
            listener(ch);
          }
          // Other control chars (arrows, tab, etc.): don't echo
        }
      }
    },

    resize: (_cols: number, _rows: number) => {
      // No PTY = no resize support, but track values for the UI
      (ptyObj as any).cols = _cols;
      (ptyObj as any).rows = _rows;
    },

    kill: (signal?: string) => {
      child.kill((signal ?? "SIGTERM") as NodeJS.Signals);
    },

    clear: () => {
      // No-op for script-based PTY
    },

    pause: () => { child.stdout?.pause(); },
    resume: () => { child.stdout?.resume(); },
  } as IPty;

  return ptyObj;
}
