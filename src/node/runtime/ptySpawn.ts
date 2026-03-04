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
    log.info(`[PTY] MAS build detected — bypassing node-pty, using /usr/bin/script fallback`);
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
 * MAS sandbox fallback: spawn a shell via /usr/bin/script which allocates a real PTY
 * internally, then wrap it in an IPty-compatible interface.
 *
 * /usr/bin/script -q /dev/null <shell> creates a pseudo-TTY and runs the shell inside it.
 * This works even when node-pty's forkpty() is blocked by the sandbox.
 */
function spawnScriptPty(request: PtySpawnRequest, env: NodeJS.ProcessEnv): IPty {
  const shell = request.command;
  const shellArgs = request.args;

  // Use /usr/bin/script to create a PTY wrapper
  // -q = quiet (no "Script started" message)
  // /dev/null = don't save transcript
  const scriptArgs = ["-q", "/dev/null", shell, ...shellArgs];

  const child = masSpawn("/usr/bin/script", scriptArgs, {
    cwd: request.cwd,
    env: env as Record<string, string>,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!child.pid) {
    throw new Error("Failed to spawn /usr/bin/script — no PID");
  }

  log.info(`[PTY] MAS script fallback spawned: pid=${child.pid}`);

  // Create an IPty-compatible wrapper
  const ptyObj: IPty = {
    pid: child.pid,
    cols: request.cols,
    rows: request.rows,
    process: shell,
    handleFlowControl: false,

    onData: (listener: (data: string) => void) => {
      // stdout carries the PTY output (script merges stdout+stderr through the PTY)
      child.stdout?.on("data", (chunk: Buffer) => {
        listener(chunk.toString("utf-8"));
      });
      // Also capture stderr for any script errors
      child.stderr?.on("data", (chunk: Buffer) => {
        listener(chunk.toString("utf-8"));
      });
      return { dispose: () => { child.stdout?.removeAllListeners("data"); child.stderr?.removeAllListeners("data"); } };
    },

    onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => {
      child.on("exit", (code: number | null, signal: string | null) => {
        listener({ exitCode: code ?? 0, signal: signal ? parseInt(signal, 10) || undefined : undefined });
      });
      return { dispose: () => { child.removeAllListeners("exit"); } };
    },

    write: (data: string) => {
      child.stdin?.write(data);
    },

    resize: (_cols: number, _rows: number) => {
      // script doesn't support dynamic resize, but update our tracked values
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
