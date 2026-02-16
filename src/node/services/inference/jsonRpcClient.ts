/**
 * JSON-RPC 2.0 client for communicating with the Python inference worker
 * over stdin/stdout. Ported from Go's worker/manager.go readResponses()
 * and callRPC().
 *
 * Protocol:
 * - Newline-delimited JSON on both stdin (requests) and stdout (responses)
 * - Responses with "jsonrpc" field are RPC responses → routed by ID
 * - Messages with "token"/"done" fields are streaming tokens
 */

import type { Writable, Readable } from "stream";
import * as readline from "readline";
import type { JsonRpcRequest, JsonRpcResponse, JsonRpcError, StreamToken } from "./types";

interface PendingRequest {
  resolve: (resp: JsonRpcResponse) => void;
  reject: (err: Error) => void;
}

export class JsonRpcClient {
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private streamCallback: ((token: StreamToken) => void) | null = null;
  private rl: readline.Interface;
  private disposed = false;

  constructor(
    private stdin: Writable,
    stdout: Readable
  ) {
    // Read newline-delimited JSON from stdout
    this.rl = readline.createInterface({ input: stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => this.handleLine(line));
    this.rl.on("close", () => this.handleClose());
  }

  /**
   * Send a JSON-RPC request and wait for the matching response.
   */
  async call(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) throw new Error("JsonRpcClient is disposed");

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (resp) => {
          if (resp.error) {
            reject(new Error(`RPC error [${resp.error.code}]: ${resp.error.message}`));
          } else {
            resolve(resp.result);
          }
        },
        reject,
      });

      const data = JSON.stringify(request) + "\n";
      this.stdin.write(data, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(new Error(`Failed to write RPC request: ${err.message}`));
        }
      });
    });
  }

  /**
   * Send a generate_stream request and return an AsyncIterable of tokens.
   * The Python worker first responds with {"status": "streaming"} (RPC response),
   * then emits stream tokens as {"token": "...", "done": false/true}.
   */
  async *callStream(method: string, params?: unknown): AsyncGenerator<StreamToken> {
    if (this.disposed) throw new Error("JsonRpcClient is disposed");

    // First, send the RPC request and wait for the "streaming" acknowledgement
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined && { params }),
    };

    // Set up the promise for the initial RPC response
    const ackPromise = new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (resp) => {
          if (resp.error) {
            reject(new Error(`RPC error [${resp.error.code}]: ${resp.error.message}`));
          } else {
            resolve();
          }
        },
        reject,
      });
    });

    // Set up a queue for streaming tokens
    const tokenQueue: StreamToken[] = [];
    let tokenResolve: (() => void) | null = null;
    let streamDone = false;
    let streamError: Error | null = null;

    this.streamCallback = (token: StreamToken) => {
      if (token.error) {
        streamError = new Error(`Worker stream error: ${token.error}`);
        streamDone = true;
      }
      tokenQueue.push(token);
      if (tokenResolve) {
        tokenResolve();
        tokenResolve = null;
      }
    };

    // Send the request
    const data = JSON.stringify(request) + "\n";
    this.stdin.write(data);

    // Wait for the streaming acknowledgement
    await ackPromise;

    // Yield streaming tokens
    try {
      while (!streamDone) {
        if (tokenQueue.length > 0) {
          const token = tokenQueue.shift()!;
          if (token.done) {
            break;
          }
          if (token.error) {
            throw new Error(`Worker stream error: ${token.error}`);
          }
          yield token;
        } else {
          // Wait for the next token
          await new Promise<void>((resolve) => {
            tokenResolve = resolve;
          });
        }
      }
      if (streamError) throw streamError;
    } finally {
      this.streamCallback = null;
    }
  }

  /**
   * Handle a single line from the worker's stdout.
   */
  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Non-JSON output from worker — ignore (or could log)
      return;
    }

    // JSON-RPC response: has "jsonrpc" field
    if ("jsonrpc" in parsed) {
      const resp = parsed as unknown as JsonRpcResponse;
      const pending = this.pending.get(resp.id);
      if (pending) {
        this.pending.delete(resp.id);
        pending.resolve(resp);
      }
      return;
    }

    // Streaming token: has "token" or "done" field
    if ("token" in parsed || "done" in parsed) {
      const token: StreamToken = {
        token: (parsed.token as string) ?? "",
        done: (parsed.done as boolean) ?? false,
        error: parsed.error as string | undefined,
      };
      if (this.streamCallback) {
        this.streamCallback(token);
      }
      return;
    }

    // Unknown output — ignore
  }

  /**
   * Handle the stdout stream closing (worker process exited).
   */
  private handleClose(): void {
    this.disposed = true;
    // Reject all pending requests
    for (const [id, pending] of this.pending) {
      pending.reject(new Error("Worker process exited"));
      this.pending.delete(id);
    }
    // Signal stream end
    if (this.streamCallback) {
      this.streamCallback({ token: "", done: true, error: "Worker process exited" });
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.disposed = true;
    this.rl.close();
    for (const [id, pending] of this.pending) {
      pending.reject(new Error("Client disposed"));
      this.pending.delete(id);
    }
  }
}
