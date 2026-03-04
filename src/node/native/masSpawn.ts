/**
 * MAS-safe process spawning via NSTask native addon.
 *
 * In the macOS App Sandbox, Node.js's child_process.spawn() can fail with
 * EPERM because libuv's posix_spawn/fork+exec doesn't propagate sandbox
 * inheritance attributes. Apple's NSTask handles this correctly.
 *
 * On MAS builds: loads the native lattice_spawn addon and uses NSTask.
 * On all other builds: delegates to child_process.spawn() (zero overhead).
 */

import { spawn, type ChildProcess, type SpawnOptions } from "child_process";
import { EventEmitter } from "events";
import * as net from "net";
import * as path from "path";
import type { Readable, Writable } from "stream";
import * as tty from "tty";

// Lazy-loaded native addon
let nativeAddon: NativeAddon | null = null;
let nativeAddonLoadError: Error | null = null;

interface NativeAddon {
  spawn(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      stdin?: boolean;
      stdout?: boolean;
      stderr?: boolean;
    },
    exitCallback: (code: number, signal: number) => void
  ): { pid: number; stdinFd: number; stdoutFd: number; stderrFd: number };

  spawn_pty(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    },
    exitCallback: (code: number, signal: number) => void
  ): { pid: number; masterFd: number };

  resize_pty(masterFd: number, cols: number, rows: number): void;

  kill(pid: number, signal?: number): number;
}

function loadNativeAddon(): NativeAddon {
  if (nativeAddon) return nativeAddon;
  if (nativeAddonLoadError) throw nativeAddonLoadError;

  try {
    const isPackaged = __dirname.includes("app.asar");
    const possiblePaths: string[] = [];

    console.log(`[masSpawn] Loading native addon: __dirname=${__dirname}, isPackaged=${isPackaged}`);

    if (isPackaged) {
      // Packaged Electron: .node file is in app.asar.unpacked (native addons can't load from asar)
      const asarUnpackedRoot = __dirname.split("app.asar")[0] + "app.asar.unpacked";
      possiblePaths.push(
        path.join(asarUnpackedRoot, "src", "node", "native", "lattice-spawn", "build", "Release", "lattice_spawn.node")
      );
    } else {
      // Development: __dirname is src/node/native/ (TS source) or dist/node/native/ (compiled)
      possiblePaths.push(
        // Direct sibling (same directory as this file in source tree)
        path.join(__dirname, "lattice-spawn", "build", "Release", "lattice_spawn.node"),
        // From dist/ back to src/
        path.resolve(__dirname, "../../../src/node/native/lattice-spawn/build/Release/lattice_spawn.node"),
      );
    }

    for (const addonPath of possiblePaths) {
      try {
        console.log(`[masSpawn] Trying addon path: ${addonPath}`);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        nativeAddon = require(addonPath) as NativeAddon;
        console.log(`[masSpawn] Native addon loaded successfully from: ${addonPath}`);
        return nativeAddon;
      } catch (loadErr) {
        console.log(`[masSpawn] Failed to load from ${addonPath}: ${loadErr}`);
      }
    }

    throw new Error(`lattice_spawn.node not found in: ${possiblePaths.join(", ")}`);
  } catch (err) {
    nativeAddonLoadError = err instanceof Error ? err : new Error(String(err));
    console.error(`[masSpawn] FATAL: Could not load native addon:`, nativeAddonLoadError.message);
    throw nativeAddonLoadError;
  }
}

/** Signal name → number mapping for kill() */
const SIGNAL_MAP: Record<string, number> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
  SIGUSR1: 10,
  SIGUSR2: 12,
};

/** Signal number → name mapping for exit callbacks */
const SIGNAL_REVERSE: Record<number, string> = {};
for (const [name, num] of Object.entries(SIGNAL_MAP)) {
  SIGNAL_REVERSE[num] = name;
}

/**
 * Create a Readable stream from a raw file descriptor.
 * The fd is owned by us (already dup()'d by the native addon).
 */
function readableFromFd(fd: number): Readable {
  const sock = new net.Socket({ fd, readable: true, writable: false });
  // Ensure the fd is closed when the stream ends
  sock.on("end", () => {
    try {
      sock.destroy();
    } catch {
      // ignore
    }
  });
  return sock as unknown as Readable;
}

/**
 * Create a Writable stream from a raw file descriptor.
 */
function writableFromFd(fd: number): Writable {
  const sock = new net.Socket({ fd, readable: false, writable: true });
  return sock as unknown as Writable;
}

/**
 * A ChildProcess-compatible wrapper around NSTask-spawned processes.
 *
 * Implements the subset of ChildProcess used by DisposableProcess and
 * the spawn callsites in LocalBaseRuntime / bashExecutionService.
 */
class NsTaskChildProcess extends EventEmitter {
  readonly pid: number;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;

  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;

  private readonly _pid: number;

  constructor(
    result: { pid: number; stdinFd: number; stdoutFd: number; stderrFd: number },
    private readonly _addon: NativeAddon
  ) {
    super();
    this._pid = result.pid;
    this.pid = result.pid;

    // Create Node.js streams from the raw fds
    this.stdin = result.stdinFd >= 0 ? writableFromFd(result.stdinFd) : null;
    this.stdout = result.stdoutFd >= 0 ? readableFromFd(result.stdoutFd) : null;
    this.stderr = result.stderrFd >= 0 ? readableFromFd(result.stderrFd) : null;
  }

  /**
   * Called by the native addon's exit callback (marshalled via TSFN).
   */
  _onExit(code: number, signal: number): void {
    if (signal !== 0) {
      this.signalCode = SIGNAL_REVERSE[signal] ?? `SIG${signal}`;
      this.exitCode = null;
    } else {
      this.exitCode = code;
      this.signalCode = null;
    }

    console.log(`[masSpawn] Process pid=${this._pid} exited: code=${this.exitCode}, signal=${this.signalCode}`);
    this.emit("exit", this.exitCode, this.signalCode);

    // Emit "close" after a microtask to let stdio drain
    process.nextTick(() => {
      this.emit("close", this.exitCode, this.signalCode);
    });
  }

  /**
   * Send a signal to the process.
   */
  kill(signal?: string | number): boolean {
    let sigNum: number;
    if (typeof signal === "string") {
      sigNum = SIGNAL_MAP[signal] ?? 15; // Default SIGTERM
    } else if (typeof signal === "number") {
      sigNum = signal;
    } else {
      sigNum = 15; // SIGTERM
    }

    const ret = this._addon.kill(this._pid, sigNum);
    if (ret === 0) {
      this.killed = true;
    }
    return ret === 0;
  }

  /**
   * Ref/unref for event loop handling — no-ops since we use TSFN internally.
   */
  ref(): this { return this; }
  unref(): this { return this; }
}

/**
 * Check if the current process is running in the MAS sandbox.
 */
function isMAS(): boolean {
  return !!(process as NodeJS.Process & { mas?: boolean }).mas;
}

/**
 * Spawn a child process, using NSTask on MAS builds and child_process.spawn otherwise.
 *
 * The returned object is a real ChildProcess (non-MAS) or a ChildProcess-compatible
 * NsTaskChildProcess (MAS) that works with DisposableProcess and existing callsites.
 */
export function masSpawn(
  command: string,
  args: string[],
  options?: SpawnOptions
): ChildProcess {
  // Non-MAS: delegate to child_process.spawn directly
  if (!isMAS()) {
    return spawn(command, args, options ?? {});
  }

  console.log(`[masSpawn] MAS spawn: command=${command}, args=${JSON.stringify(args.slice(0, 2))}${args.length > 2 ? "..." : ""}, cwd=${options?.cwd ?? "inherit"}`);

  // Strategy: Try NSTask native addon first (handles sandbox inheritance correctly).
  // If the addon can't load (packaging/codesign issue), fall back to regular spawn()
  // which may work since detached:true (the main EPERM cause) is already disabled.
  let addon: NativeAddon | null = null;
  try {
    addon = loadNativeAddon();
  } catch (addonErr) {
    console.warn(`[masSpawn] Native addon unavailable, falling back to child_process.spawn: ${addonErr instanceof Error ? addonErr.message : String(addonErr)}`);
  }

  // Fallback: use regular spawn (without detached:true, which was the EPERM cause)
  if (!addon) {
    console.log(`[masSpawn] Using child_process.spawn fallback for: ${command}`);
    const safeOptions = { ...(options ?? {}), detached: false };
    const child = spawn(command, args, safeOptions);
    child.on("error", (err) => {
      console.error(`[masSpawn] child_process.spawn fallback FAILED:`, err.message);
    });
    child.on("exit", (code, signal) => {
      console.log(`[masSpawn] child_process.spawn fallback exited: code=${code}, signal=${signal}`);
    });
    return child;
  }

  // NSTask path: use native addon
  return spawnViaNSTask(addon, command, args, options);
}

function spawnViaNSTask(
  addon: NativeAddon,
  command: string,
  args: string[],
  options?: SpawnOptions
): ChildProcess {
  // Determine which stdio channels to create
  const stdio = options?.stdio;
  let wantStdin = true;
  let wantStdout = true;
  let wantStderr = true;

  if (Array.isArray(stdio)) {
    wantStdin = stdio[0] === "pipe";
    wantStdout = stdio[1] === "pipe";
    wantStderr = stdio[2] === "pipe";
  } else if (stdio === "ignore") {
    wantStdin = false;
    wantStdout = false;
    wantStderr = false;
  }

  // Build env object for NSTask (full replacement, not inherited)
  let env: Record<string, string> | undefined;
  if (options?.env) {
    env = {};
    for (const [key, val] of Object.entries(options.env)) {
      if (val !== undefined) {
        env[key] = val;
      }
    }
  } else {
    // NSTask doesn't auto-inherit; pass current env
    env = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  const nativeOpts = {
    cwd: options?.cwd?.toString(),
    env,
    stdin: wantStdin,
    stdout: wantStdout,
    stderr: wantStderr,
  };

  let nsProc: NsTaskChildProcess | null = null;

  try {
    const result = addon.spawn(command, args, nativeOpts, (code: number, signal: number) => {
      nsProc!._onExit(code, signal);
    });

    nsProc = new NsTaskChildProcess(result, addon);
    console.log(`[masSpawn] NSTask spawned pid=${result.pid}, stdinFd=${result.stdinFd}, stdoutFd=${result.stdoutFd}, stderrFd=${result.stderrFd}`);
  } catch (err) {
    console.error(`[masSpawn] NSTask spawn FAILED, falling back to child_process.spawn:`, err instanceof Error ? err.message : String(err));
    // Fall back to regular spawn instead of returning a broken error process
    const safeOptions = { ...(options ?? {}), detached: false };
    const child = spawn(command, args, safeOptions);
    child.on("error", (spawnErr) => {
      console.error(`[masSpawn] child_process.spawn fallback also FAILED:`, spawnErr.message);
    });
    child.on("exit", (code, signal) => {
      console.log(`[masSpawn] child_process.spawn fallback exited: code=${code}, signal=${signal}`);
    });
    return child;
  }

  return nsProc as unknown as ChildProcess;
}

/**
 * Result from masSpawnPty — a real PTY session.
 */
export interface MasPtyHandle {
  pid: number;
  masterFd: number;
  /** Readable/writable socket connected to the PTY master fd */
  master: net.Socket;
  /** Kill the child process */
  kill(signal?: number): number;
  /** Resize the PTY */
  resize(cols: number, rows: number): void;
  /** Fires when child exits: (code, signal) */
  onExit: (callback: (code: number, signal: number) => void) => void;
}

/**
 * Spawn a process with a real PTY (master/slave pair) in the MAS sandbox.
 *
 * Uses posix_openpt() from the native addon to create the PTY pair, then
 * posix_spawn() with the slave as stdin/stdout/stderr + POSIX_SPAWN_SETSID
 * so the child gets a proper controlling terminal.
 *
 * Returns a handle with the master fd as a read/write socket, plus resize support.
 */
export function masSpawnPty(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
  }
): MasPtyHandle {
  const addon = loadNativeAddon();

  // Build env (same logic as masSpawn — NSTask doesn't auto-inherit)
  let env: Record<string, string> | undefined;
  if (options.env) {
    env = {};
    for (const [key, val] of Object.entries(options.env)) {
      if (val !== undefined) {
        env[key] = String(val);
      }
    }
  } else {
    env = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined) {
        env[key] = val;
      }
    }
  }

  let exitCallback: ((code: number, signal: number) => void) | null = null;

  const result = addon.spawn_pty(command, args, {
    cwd: options.cwd,
    env,
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
  }, (code: number, signal: number) => {
    console.log(`[masSpawnPty] Process pid=${result.pid} exited: code=${code}, signal=${signal}`);
    if (exitCallback) exitCallback(code, signal);
  });

  console.log(`[masSpawnPty] PTY spawned: pid=${result.pid}, masterFd=${result.masterFd}`);

  // PTY master fds are TTY type — net.Socket rejects them ("Unsupported fd type: TTY")
  // because libuv's uv_guess_handle() returns UV_TTY. tty.ReadStream explicitly creates
  // a TTY handle which works correctly for PTY masters. It extends net.Socket (duplex),
  // so both .on('data') reading and .write() work.
  const masterSocket = new tty.ReadStream(result.masterFd) as unknown as net.Socket;

  return {
    pid: result.pid,
    masterFd: result.masterFd,
    master: masterSocket,
    kill: (signal?: number) => addon.kill(result.pid, signal ?? 15),
    resize: (cols: number, rows: number) => {
      try {
        addon.resize_pty(result.masterFd, cols, rows);
      } catch {
        // Ignore resize errors (fd may be closed)
      }
    },
    onExit: (callback: (code: number, signal: number) => void) => {
      exitCallback = callback;
    },
  };
}
