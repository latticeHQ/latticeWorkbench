import type { IPty } from "node-pty";
import { log } from "@/node/services/log";
import { getErrorMessage } from "@/common/utils/errors";

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
    return missing.length > 0 ? `${basePath}:${missing.join(":")}` : basePath;
  }

  return basePath;
}

/**
 * Get the real user home directory, bypassing MAS sandbox container redirect.
 * In MAS sandbox, $HOME is ~/Library/Containers/<bundleId>/Data/
 */
function getRealHome(): string {
  const home = require("os").homedir() as string;
  const containerMatch = home.match(/^(\/Users\/[^/]+)\/Library\/Containers\//);
  return containerMatch ? containerMatch[1] : home;
}

export function spawnPtyProcess(request: PtySpawnRequest): IPty {
  const pty = loadNodePty(request.runtimeLabel, request.preferElectronBuild);
  const mergedEnv: NodeJS.ProcessEnv = { ...process.env, ...request.env };
  const pathEnv = resolvePathEnv(mergedEnv, request.pathEnv);

  // In MAS sandbox, $HOME points to container. Set to real home so spawned
  // shells find .zshrc/.bashrc and load the user's full environment.
  const realHome = process.platform === "darwin" ? getRealHome() : undefined;

  // Ensure SHELL is set — MAS sandbox may not inherit it from launchd.
  // node-pty and spawned processes rely on SHELL for subshell invocations.
  const shellEnv =
    mergedEnv.SHELL?.trim() || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");

  const env: NodeJS.ProcessEnv = {
    ...mergedEnv,
    TERM: "xterm-256color",
    SHELL: shellEnv,
    ...(pathEnv ? { PATH: pathEnv } : {}),
    ...(realHome ? { HOME: realHome } : {}),
  };

  try {
    return pty.spawn(request.command, request.args, {
      name: "xterm-256color",
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env,
    });
  } catch (err) {
    log.error(`[PTY] Failed to spawn ${request.runtimeLabel} terminal:`, err);

    const printableArgs = request.args.length > 0 ? ` ${request.args.join(" ")}` : "";
    const cmd = `${request.command}${printableArgs}`;
    const details = `cmd="${cmd}", cwd="${request.cwd}", platform="${process.platform}"`;
    const errMessage = getErrorMessage(err);

    if (request.logLocalEnv) {
      log.error(`Local PTY spawn config: ${cmd} (cwd: ${request.cwd})`);
      log.error(`process.env.SHELL: ${process.env.SHELL ?? "undefined"}`);
      log.error(`process.env.PATH: ${process.env.PATH ?? process.env.Path ?? "undefined"}`);
    }

    throw new Error(`Failed to spawn ${request.runtimeLabel} terminal (${details}): ${errMessage}`);
  }
}
