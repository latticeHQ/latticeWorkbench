/**
 * Python Worker Manager — ported from Go's worker/manager.go.
 *
 * Manages the lifecycle of the Python inference subprocess:
 * - Spawns worker.py with --model and --backend flags
 * - Communicates via JSON-RPC 2.0 over stdin/stdout
 * - Health check on startup (120s timeout for model loading)
 * - Graceful shutdown with fallback to SIGKILL
 */

import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as readline from "readline";
import { JsonRpcClient } from "./jsonRpcClient";
import { detectBackend, detectPython, findWorkerScript } from "./backendDetection";
import type { GenerateParams, GenerateResult, StreamToken } from "./types";
import { log } from "@/node/services/log";

const HEALTH_CHECK_TIMEOUT_MS = 120_000; // 120s for model loading
const SHUTDOWN_TIMEOUT_MS = 5_000; // 5s graceful shutdown

export interface WorkerManagerEvents {
  ready: [];
  exit: [code: number | null, signal: string | null];
  error: [error: Error];
}

export class PythonWorkerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private rpcClient: JsonRpcClient | null = null;
  private _alive = false;
  private _backend = "";
  private _modelPath = "";
  private pythonPath: string;
  private workerScriptPath: string;

  constructor(appResourcesPath?: string) {
    super();
    this.pythonPath = detectPython();
    this.workerScriptPath = findWorkerScript(appResourcesPath);
  }

  get alive(): boolean {
    return this._alive;
  }

  get backend(): string {
    return this._backend;
  }

  get modelPath(): string {
    return this._modelPath;
  }

  /**
   * Start the Python worker subprocess with the given model.
   * Blocks until the worker reports ready via health check.
   */
  async start(modelPath: string, backend?: string): Promise<void> {
    // Stop existing process if running
    if (this._alive) {
      await this.stop();
    }

    const resolvedBackend = backend ?? detectBackend(modelPath);
    this._backend = resolvedBackend;
    this._modelPath = modelPath;

    log.info(
      `[inference] starting Python worker: python=${this.pythonPath} backend=${resolvedBackend} model=${modelPath}`
    );

    const workerDir = path.dirname(this.workerScriptPath);

    const child = spawn(
      this.pythonPath,
      [this.workerScriptPath, "--model", modelPath, "--backend", resolvedBackend],
      {
        cwd: workerDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          LATTICE_WORKER_MODE: "jsonrpc",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    this.process = child;

    // Wire up JSON-RPC client on stdin/stdout
    this.rpcClient = new JsonRpcClient(child.stdin!, child.stdout!);

    // Log stderr
    if (child.stderr) {
      const stderrRl = readline.createInterface({ input: child.stderr });
      stderrRl.on("line", (line) => {
        log.info(`[inference/worker] ${line}`);
      });
    }

    // Handle process exit
    child.on("exit", (code, signal) => {
      this._alive = false;
      log.info(`[inference] worker exited code=${code} signal=${signal}`);
      this.emit("exit", code, signal);
    });

    child.on("error", (err) => {
      this._alive = false;
      log.error(`[inference] worker error: ${err.message}`);
      this.emit("error", err);
    });

    // Health check — wait for worker to load model and report ready
    await this.waitReady();
    this._alive = true;

    log.info(`[inference] worker ready, backend=${resolvedBackend}`);
    this.emit("ready");
  }

  /**
   * Wait for the worker to respond to a health check.
   */
  private async waitReady(): Promise<void> {
    if (!this.rpcClient) throw new Error("Worker not started");

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("Timeout waiting for worker to load model (120s)")),
        HEALTH_CHECK_TIMEOUT_MS
      );
    });

    const healthPromise = this.rpcClient.call("health") as Promise<{
      status: string;
      backend: string;
    }>;

    const result = await Promise.race([healthPromise, timeoutPromise]);
    if ((result as { status: string }).status !== "ok") {
      throw new Error(`Worker health check failed: ${JSON.stringify(result)}`);
    }
  }

  /**
   * Non-streaming text generation.
   */
  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (!this._alive || !this.rpcClient) {
      throw new Error("Worker is not running");
    }

    const result = (await this.rpcClient.call("generate", params)) as GenerateResult;
    return result;
  }

  /**
   * Streaming text generation.
   * Returns an AsyncIterable of stream tokens.
   */
  async *generateStream(params: GenerateParams): AsyncGenerator<StreamToken> {
    if (!this._alive || !this.rpcClient) {
      throw new Error("Worker is not running");
    }

    yield* this.rpcClient.callStream("generate_stream", params);
  }

  /**
   * Stop the worker subprocess.
   * Tries graceful shutdown first, then SIGKILL after timeout.
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    this._alive = false;

    // Try graceful shutdown via RPC
    try {
      if (this.rpcClient) {
        // Fire and forget — don't await since the process may exit
        const shutdownData =
          JSON.stringify({
            jsonrpc: "2.0",
            id: -1,
            method: "shutdown",
          }) + "\n";
        this.process.stdin?.write(shutdownData);
      }
    } catch {
      // Ignore errors during shutdown
    }

    // Wait for process to exit, or kill after timeout
    const child = this.process;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already dead
        }
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);

      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Cleanup
    this.rpcClient?.dispose();
    this.rpcClient = null;
    this.process = null;
  }

  /**
   * Check if the worker is alive and responding.
   */
  isAlive(): boolean {
    return this._alive;
  }
}
