/**
 * OpenBB Platform Service — manages the lifecycle of the embedded OpenBB API server.
 *
 * Follows the same pattern as ExoService:
 * - Status detection: not_installed / installed_not_running / starting / running / error
 * - Ref-counted polling with change events
 * - User-triggered install / start / stop
 *
 * Does NOT auto-start — waits for the user to press a button.
 */

import { EventEmitter } from "events";
import { spawn, execFile, type ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import { log } from "@/node/services/log";

export interface OpenBBServiceOptions {
  /** Override the openbb-platform root (defaults to tools/openbb-platform relative to project) */
  platformRoot?: string;
  /** Fixed port (default: auto-detect free port) */
  port?: number;
  /** Callback to get secrets as key-value pairs (used to inject API keys like FRED_API_KEY, FMP_API_KEY) */
  getSecrets?: () => Record<string, string>;
}

// --- Status types (discriminated union, like Exo) ---

export type OpenBBStatus =
  | { status: "not_installed" }
  | { status: "installed_not_running"; bootstrapped: boolean; platformRoot: string }
  | { status: "starting" }
  | { status: "running"; port: number; baseUrl: string; endpointCount: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 3_000;
const FETCH_TIMEOUT_MS = 2_000;

/**
 * Manages the embedded OpenBB Python API server lifecycle.
 */
export class OpenBBService extends EventEmitter {
  private process: ChildProcess | null = null;
  private _port = 0;
  private _alive = false;
  private _starting = false;
  private stopping = false;
  private readonly platformRoot: string;
  private readonly fixedPort: number | undefined;
  private readonly getSecrets: (() => Record<string, string>) | undefined;

  // Ref-counted polling (like ExoService)
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private subscriberCount = 0;
  private lastStatusJson = "";

  constructor(
    _projectRoot: string,
    options: OpenBBServiceOptions = {}
  ) {
    super();
    this.platformRoot =
      options.platformRoot ?? OpenBBService.resolveDefaultPlatformRoot();
    this.fixedPort = options.port;
    this.getSecrets = options.getSecrets;
    log.info(`[openbb] platform root resolved to: ${this.platformRoot}`);
  }

  /**
   * Resolve the tools/openbb-platform directory relative to the source tree.
   *
   * Three environments:
   *   1. Dev (unbundled):  __dirname = src/node/services/   → ../../../tools/openbb-platform  (3 levels)
   *   2. Dev (compiled):   __dirname = dist/node/services/  → ../../../tools/openbb-platform  (3 levels — same depth)
   *   3. Packaged Electron: __dirname inside app.asar       → app.asar.unpacked/tools/openbb-platform
   */
  private static resolveDefaultPlatformRoot(): string {
    const isPackaged =
      __dirname.includes(`app.asar${path.sep}`) || __dirname.includes("app.asar/");

    if (isPackaged) {
      const asarUnpackedRoot = __dirname.split("app.asar")[0] + "app.asar.unpacked";
      return path.join(asarUnpackedRoot, "tools", "openbb-platform");
    }

    // Both src/node/services/ and dist/node/services/ are 3 levels deep from project root
    return path.resolve(__dirname, "../../../tools/openbb-platform");
  }

  // --- Paths ---

  private get venvDir(): string {
    return path.join(this.platformRoot, ".venv");
  }

  private get venvPython(): string {
    return path.join(this.venvDir, "bin", "python");
  }

  private get launcherScript(): string {
    return path.join(this.platformRoot, "launch_server.py");
  }

  private get bootstrapScript(): string {
    return path.join(this.platformRoot, "bootstrap.sh");
  }

  private get sentinelFile(): string {
    return path.join(this.platformRoot, ".bootstrap-complete");
  }

  // --- Status detection (like ExoService.getState) ---

  private isInstalled(): boolean {
    return fs.existsSync(this.bootstrapScript) && fs.existsSync(this.launcherScript);
  }

  private isBootstrapComplete(): boolean {
    return fs.existsSync(this.sentinelFile) && fs.existsSync(this.venvPython);
  }

  /**
   * Detect current status — called every poll cycle.
   */
  async getState(): Promise<OpenBBStatus> {
    // 1. Check if the platform source is installed
    if (!this.isInstalled()) {
      return { status: "not_installed" };
    }

    // 2. If we're currently starting up, report that
    if (this._starting) {
      return { status: "starting" };
    }

    // 3. If we have a running process, check health
    if (this._alive && this.process && this._port > 0) {
      try {
        const resp = await fetch(`http://127.0.0.1:${this._port}/healthz`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (resp.ok) {
          // Try to get endpoint count from openapi
          let endpointCount = 0;
          try {
            const openapi = await fetch(`http://127.0.0.1:${this._port}/openapi.json`, {
              signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (openapi.ok) {
              const doc = await openapi.json() as { paths?: Record<string, unknown> };
              endpointCount = Object.keys(doc.paths ?? {}).length;
            }
          } catch {
            // Non-critical
          }
          return {
            status: "running",
            port: this._port,
            baseUrl: `http://127.0.0.1:${this._port}`,
            endpointCount,
          };
        }
      } catch {
        // Process might have died
        this._alive = false;
      }
    }

    // 4. Not running — show installed state
    return {
      status: "installed_not_running",
      bootstrapped: this.isBootstrapComplete(),
      platformRoot: this.platformRoot,
    };
  }

  // --- Polling (like ExoService) ---

  startPolling(): void {
    this.subscriberCount++;
    if (this.pollTimer) return; // Already polling

    const poll = async () => {
      try {
        const state = await this.getState();
        const json = JSON.stringify(state);
        if (json !== this.lastStatusJson) {
          this.lastStatusJson = json;
          this.emit("change", state);
        }
      } catch (err) {
        log.error(`[openbb] poll error: ${err}`);
      }
    };

    void poll(); // Immediate first poll
    this.pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (this.subscriberCount === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  onChange(handler: (state: OpenBBStatus) => void): () => void {
    this.on("change", handler);
    return () => this.off("change", handler);
  }

  // --- Bootstrap ---

  async bootstrap(): Promise<void> {
    if (this.isBootstrapComplete()) {
      log.info("[openbb] already bootstrapped");
      return;
    }

    if (!fs.existsSync(this.bootstrapScript)) {
      throw new Error(`[openbb] bootstrap.sh not found at ${this.bootstrapScript}`);
    }

    log.info("[openbb] bootstrapping OpenBB platform...");

    return new Promise<void>((resolve, reject) => {
      const proc = execFile(
        "/bin/bash",
        [this.bootstrapScript],
        {
          cwd: this.platformRoot,
          env: { ...process.env },
          timeout: 600_000, // 10 min max
        },
        (error, stdout, stderr) => {
          if (error) {
            log.error(`[openbb] bootstrap failed: ${error.message}`);
            if (stderr) log.error(`[openbb] stderr: ${stderr}`);
            reject(error);
            return;
          }
          if (stdout) {
            for (const line of stdout.trim().split("\n")) {
              log.info(`[openbb:bootstrap] ${line}`);
            }
          }
          log.info("[openbb] bootstrap complete");
          resolve();
        }
      );

      proc.stdout?.on("data", (data: Buffer) => {
        for (const line of data.toString().trim().split("\n")) {
          log.info(`[openbb:bootstrap] ${line}`);
        }
      });
    });
  }

  // --- Port ---

  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error("Could not determine free port")));
        }
      });
      server.on("error", reject);
    });
  }

  // --- Start/Stop ---

  async start(): Promise<void> {
    if (this._alive && this.process) return;

    this._starting = true;
    // Force an immediate status change notification
    this.lastStatusJson = "";

    try {
      // Ensure bootstrapped
      if (!this.isBootstrapComplete()) {
        await this.bootstrap();
      }

      this._port = this.fixedPort ?? (await this.findFreePort());

      const args = [this.launcherScript, "--host", "127.0.0.1", "--port", String(this._port)];
      log.info(`[openbb] spawning: ${this.venvPython} ${args.join(" ")}`);

      // Inject data provider API keys from secrets (FRED_API_KEY → OPENBB_FRED_API_KEY, etc.)
      const providerEnv: Record<string, string> = {};
      if (this.getSecrets) {
        const secrets = this.getSecrets();
        // Map well-known API key secret names to OpenBB env vars
        const keyMappings: Record<string, string> = {
          FRED_API_KEY: "OPENBB_FRED_API_KEY",
          FMP_API_KEY: "OPENBB_FMP_API_KEY",
          POLYGON_API_KEY: "OPENBB_POLYGON_API_KEY",
          ALPHA_VANTAGE_API_KEY: "OPENBB_ALPHA_VANTAGE_API_KEY",
          INTRINIO_API_KEY: "OPENBB_INTRINIO_API_KEY",
          QUANDL_API_KEY: "OPENBB_QUANDL_API_KEY",
          TIINGO_API_KEY: "OPENBB_TIINGO_API_KEY",
        };
        for (const [secretKey, envKey] of Object.entries(keyMappings)) {
          if (secrets[secretKey]) {
            providerEnv[envKey] = secrets[secretKey];
            log.info(`[openbb] injecting ${envKey} from secrets`);
          }
        }
        // Also pass through any OPENBB_* secrets directly
        for (const [key, value] of Object.entries(secrets)) {
          if (key.startsWith("OPENBB_") && value) {
            providerEnv[key] = value;
          }
        }
      }

      this.process = spawn(this.venvPython, args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: this.platformRoot,
        env: {
          ...process.env,
          ...providerEnv,
          OPENBB_API_AUTH: "false",
          OPENBB_AUTO_BUILD: "false",
          VIRTUAL_ENV: this.venvDir,
          PATH: `${path.join(this.venvDir, "bin")}:${process.env.PATH}`,
        },
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        for (const line of data.toString().trim().split("\n")) {
          log.info(`[openbb] ${line}`);
        }
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        for (const line of data.toString().trim().split("\n")) {
          log.info(`[openbb:out] ${line}`);
        }
      });

      this.process.on("exit", (code, signal) => {
        this._alive = false;
        this._starting = false;
        if (!this.stopping) {
          log.warn(`[openbb] process exited unexpectedly: code=${code} signal=${signal}`);
        }
        this.process = null;
        this.lastStatusJson = ""; // Force change event
      });

      this.process.on("error", (err) => {
        log.error(`[openbb] process error: ${err.message}`);
        this._alive = false;
        this._starting = false;
      });

      // Wait for health check
      await this.waitForHealthy();
      this._alive = true;
      this._starting = false;
      this.lastStatusJson = ""; // Force change event
      log.info(`[openbb] ready at http://127.0.0.1:${this._port}`);
    } catch (err) {
      this._starting = false;
      this.lastStatusJson = ""; // Force change event
      throw err;
    }
  }

  private async waitForHealthy(timeoutMs = 120_000, intervalMs = 500): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${this._port}/healthz`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) return;
      } catch {
        // Not ready yet
      }

      if (!this.process || this.process.exitCode !== null) {
        throw new Error("[openbb] process exited before becoming healthy");
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[openbb] health check timeout after ${timeoutMs}ms`);
  }

  async ensureRunning(): Promise<void> {
    if (this._alive && this.process) return;
    await this.start();
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    this.stopping = true;
    const proc = this.process;

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        log.warn("[openbb] force killing after timeout");
        proc.kill("SIGKILL");
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        this._alive = false;
        this.process = null;
        this.stopping = false;
        this.lastStatusJson = ""; // Force change event
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  /**
   * Legacy getStatus — kept for backward compat but getState() is preferred.
   */
  getStatus(): { alive: boolean; port: number; bootstrapped: boolean; baseUrl: string } {
    return {
      alive: this._alive,
      port: this._port,
      bootstrapped: this.isBootstrapComplete(),
      baseUrl: `http://127.0.0.1:${this._port}`,
    };
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.subscriberCount = 0;
    this.removeAllListeners();
  }
}
