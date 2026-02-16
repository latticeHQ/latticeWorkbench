import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import * as net from "net";
import { log } from "@/node/services/log";

export interface InferredProcessOptions {
  pythonPath?: string;
  modelDir?: string;
  authToken?: string;
  maxModels?: number;
  memoryBudgetGB?: number;
  enableCluster?: boolean;
  nodeName?: string;
  joinUrl?: string;
  /** Enable mDNS zero-config LAN discovery (default: true in Go binary) */
  enableMDNS?: boolean;
  /** KV cache quantization bits (0=fp16, 4=int4, 8=int8) */
  kvCacheBits?: number;
}

/**
 * Manages the lifecycle of the `latticeinference serve` Go binary subprocess.
 *
 * Spawns the Go binary on a free port, health-checks until ready,
 * and provides graceful shutdown.
 */
export class InferredProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private _port = 0;
  private _alive = false;
  private stopping = false;

  constructor(
    private readonly binaryPath: string,
    private readonly options: InferredProcessOptions = {}
  ) {
    super();
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get alive(): boolean {
    return this._alive;
  }

  get port(): number {
    return this._port;
  }

  /**
   * Find a free port by binding to port 0 and immediately closing.
   */
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

  /**
   * Spawn the Go binary and wait for it to become healthy.
   */
  async start(): Promise<void> {
    if (this._alive && this.process) return;

    this._port = await this.findFreePort();

    const args = ["serve", "-port", String(this._port), "-host", "127.0.0.1"];

    if (this.options.pythonPath) {
      args.push("-python", this.options.pythonPath);
    }
    if (this.options.modelDir) {
      args.push("-model-dir", this.options.modelDir);
    }
    if (this.options.authToken) {
      args.push("-auth-token", this.options.authToken);
    }
    if (this.options.maxModels) {
      args.push("-max-models", String(this.options.maxModels));
    }
    if (this.options.memoryBudgetGB) {
      args.push("-memory-budget-gb", String(this.options.memoryBudgetGB));
    }
    if (this.options.enableCluster) {
      args.push("-cluster");
    }
    if (this.options.nodeName) {
      args.push("-name", this.options.nodeName);
    }
    if (this.options.joinUrl) {
      args.push("-join", this.options.joinUrl);
    }
    // mDNS is enabled by default in Go binary; only pass flag to explicitly disable
    if (this.options.enableMDNS === false) {
      args.push("-mdns=false");
    }
    if (this.options.kvCacheBits && this.options.kvCacheBits > 0) {
      args.push("-kv-cache-bits", String(this.options.kvCacheBits));
    }

    log.info(`[inferred] spawning: ${this.binaryPath} ${args.join(" ")}`);

    this.process = spawn(this.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Forward stderr for logging
    this.process.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        log.info(`[inferred] ${line}`);
      }
    });

    // Forward stdout (Go binary might log there too)
    this.process.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        log.info(`[inferred:out] ${line}`);
      }
    });

    // Handle unexpected exit
    this.process.on("exit", (code, signal) => {
      this._alive = false;
      if (!this.stopping) {
        log.warn(`[inferred] process exited unexpectedly: code=${code} signal=${signal}`);
        this.emit("crashed", code, signal);
      }
      this.process = null;
    });

    this.process.on("error", (err) => {
      log.error(`[inferred] process error: ${err.message}`);
      this._alive = false;
    });

    // Wait for healthcheck
    await this.waitForHealthy();
    this._alive = true;
    this.emit("ready");
    log.info(`[inferred] ready at ${this.baseUrl}`);
  }

  /**
   * Poll /healthz until it returns 200 or timeout.
   */
  private async waitForHealthy(timeoutMs = 30000, intervalMs = 200): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`${this.baseUrl}/healthz`, {
          signal: AbortSignal.timeout(2000),
        });
        if (resp.ok) return;
      } catch {
        // Not ready yet
      }

      // Check if process died while waiting
      if (!this.process || this.process.exitCode !== null) {
        throw new Error("[inferred] process exited before becoming healthy");
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`[inferred] health check timeout after ${timeoutMs}ms`);
  }

  /**
   * Ensure the process is running (start if needed).
   */
  async ensureRunning(): Promise<void> {
    if (this._alive && this.process) return;
    await this.start();
  }

  /**
   * Graceful shutdown: SIGTERM, then SIGKILL after 5s.
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    this.stopping = true;
    const proc = this.process;

    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        log.warn("[inferred] force killing after timeout");
        proc.kill("SIGKILL");
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        this._alive = false;
        this.process = null;
        this.stopping = false;
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }
}
