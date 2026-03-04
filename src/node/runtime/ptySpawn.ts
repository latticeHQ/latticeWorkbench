import type { IPty } from "node-pty";
import { log } from "@/node/services/log";
import { getErrorMessage } from "@/common/utils/errors";
import { getRealHome } from "@/common/utils/masHome";

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

  // MAS sandbox: local PTY is not viable. node-pty's spawn-helper crashes (unsigned
  // binary can't inherit sandbox), and even with a native PTY via posix_openpt(), the
  // sandbox blocks execution of non-system binaries (brew, node, npm, cargo, etc.).
  // SSH runtime is the correct solution — it provides a full unsandboxed terminal.
  if (isMAS) {
    log.info(`[PTY] MAS build detected — local terminal not available, SSH runtime required`);
    throw new Error(
      `Local terminal is not available in the App Store build. ` +
      `Please use SSH runtime instead: enable Remote Login in System Settings → General → Sharing, ` +
      `then configure your minion to use SSH runtime (localhost).`
    );
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

