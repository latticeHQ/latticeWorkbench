/**
 * Copilot LM Proxy Server
 *
 * Exposes an OpenAI-compatible HTTP endpoint that bridges requests to the
 * VS Code Language Model API (vscode.lm). This allows the LATTICE WORKBENCH backend
 * to use GitHub Copilot's models through the VS Code extension without
 * direct access to api.githubcopilot.com.
 *
 * Endpoints:
 *   GET  /v1/models              — List available Copilot models
 *   POST /v1/chat/completions    — Chat completion (streaming + non-streaming)
 *   GET  /health                 — Health check
 */

import * as http from "node:http";
import * as vscode from "vscode";

const DEFAULT_PORT = 3941;

/** OpenAI-compatible message format */
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenAI-compatible request body */
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/** Read the full request body as a string */
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Convert OpenAI message role to VS Code LanguageModelChatMessage */
function convertMessage(msg: ChatMessage): vscode.LanguageModelChatMessage {
  switch (msg.role) {
    case "system":
      // VS Code LM API doesn't have a system role — prepend as user context
      return vscode.LanguageModelChatMessage.User(`[System Instructions]\n${msg.content}`);
    case "user":
      return vscode.LanguageModelChatMessage.User(msg.content);
    case "assistant":
      return vscode.LanguageModelChatMessage.Assistant(msg.content);
    default:
      return vscode.LanguageModelChatMessage.User(msg.content);
  }
}

/** Format a text chunk as an OpenAI streaming chunk */
function formatStreamChunk(
  text: string,
  model: string,
  chunkId: string
): object {
  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: null,
      },
    ],
  };
}

/** Format the final streaming chunk (finish_reason: stop) */
function formatStreamEnd(model: string, chunkId: string): object {
  return {
    id: chunkId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
}

/** Format a complete non-streaming response */
function formatCompleteResponse(
  text: string,
  model: string,
  completionId: string
): object {
  return {
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

/** Generate a unique ID for completions */
function generateId(): string {
  return `chatcmpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class CopilotLmProxy {
  private server: http.Server | null = null;
  private port: number;
  private outputChannel: vscode.LogOutputChannel;

  constructor(
    port?: number,
    outputChannel?: vscode.LogOutputChannel
  ) {
    this.port = port ?? DEFAULT_PORT;
    this.outputChannel =
      outputChannel ?? vscode.window.createOutputChannel("LATTICE WORKBENCH LM Proxy", { log: true });
  }

  /** Start the proxy server */
  async start(): Promise<number> {
    if (this.server) {
      this.outputChannel.info(`LM Proxy already running on port ${this.port}`);
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // CORS headers for local development
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          if (req.url === "/health" && req.method === "GET") {
            await this.handleHealth(res);
          } else if (req.url === "/v1/models" && req.method === "GET") {
            await this.handleListModels(res);
          } else if (
            req.url === "/v1/chat/completions" &&
            req.method === "POST"
          ) {
            await this.handleChatCompletion(req, res);
          } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: { message: "Not found", type: "not_found" } })
            );
          }
        } catch (err) {
          this.outputChannel.error(`Request error: ${err}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
          }
          res.end(
            JSON.stringify({
              error: {
                message: err instanceof Error ? err.message : String(err),
                type: "server_error",
              },
            })
          );
        }
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          this.outputChannel.warn(
            `Port ${this.port} in use, trying ${this.port + 1}...`
          );
          this.port++;
          this.server?.listen(this.port, "127.0.0.1");
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, "127.0.0.1", () => {
        this.outputChannel.info(
          `LM Proxy started on http://127.0.0.1:${this.port}`
        );
        resolve(this.port);
      });
    });
  }

  /** Stop the proxy server */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.outputChannel.info("LM Proxy stopped");
    }
  }

  /** GET /health */
  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        modelsAvailable: models.length,
        port: this.port,
      })
    );
  }

  /** GET /v1/models — List available Copilot models */
  private async handleListModels(res: http.ServerResponse): Promise<void> {
    const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
    const data = models.map((m) => ({
      id: m.family,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.vendor,
      permission: [],
      root: m.family,
      parent: null,
    }));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data }));
  }

  /** POST /v1/chat/completions — Chat completion */
  private async handleChatCompletion(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const body = await readBody(req);
    let request: ChatCompletionRequest;
    try {
      request = JSON.parse(body) as ChatCompletionRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Invalid JSON body", type: "invalid_request" },
        })
      );
      return;
    }

    const { model, messages, stream } = request;

    this.outputChannel.info(
      `Chat completion: model=${model}, messages=${messages.length}, stream=${!!stream}`
    );

    // Select the requested model from Copilot
    const selectedModel = await this.selectModel(model);
    if (!selectedModel) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: `Model "${model}" not available. Use GET /v1/models to list available models.`,
            type: "model_not_found",
          },
        })
      );
      return;
    }

    // Convert messages to VS Code LM format
    const vsMessages = messages.map(convertMessage);

    const completionId = generateId();

    // Create a cancellation token
    const cts = new vscode.CancellationTokenSource();

    // Handle client disconnect
    req.on("close", () => {
      cts.cancel();
    });

    try {
      const response = await selectedModel.sendRequest(
        vsMessages,
        {
          modelOptions: {
            ...(request.max_tokens != null && { maxOutputTokens: request.max_tokens }),
            ...(request.temperature != null && { temperature: request.temperature }),
          },
        },
        cts.token
      );

      if (stream) {
        // SSE streaming response
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        for await (const chunk of response.text) {
          if (cts.token.isCancellationRequested) {
            break;
          }
          const data = formatStreamChunk(chunk, model, completionId);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }

        // Send finish chunk
        const endData = formatStreamEnd(model, completionId);
        res.write(`data: ${JSON.stringify(endData)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // Non-streaming: collect full response
        let fullText = "";
        for await (const chunk of response.text) {
          fullText += chunk;
        }
        const data = formatCompleteResponse(fullText, model, completionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      }

      this.outputChannel.info(`Chat completion finished: ${completionId}`);
    } catch (err) {
      if (err instanceof vscode.LanguageModelError) {
        this.outputChannel.error(`LM API error: ${err.message} (code: ${err.code})`);
        const statusCode = err.code === "NotFound" ? 404 : err.code === "NoPermissions" ? 403 : 500;
        if (!res.headersSent) {
          res.writeHead(statusCode, { "Content-Type": "application/json" });
        }
        res.end(
          JSON.stringify({
            error: {
              message: err.message,
              type: "language_model_error",
              code: err.code,
            },
          })
        );
      } else {
        throw err;
      }
    } finally {
      cts.dispose();
    }
  }

  /**
   * Select a Copilot model by name.
   * Tries exact family match first, then falls back to searching all models.
   */
  private async selectModel(
    modelName: string
  ): Promise<vscode.LanguageModelChat | null> {
    // Try exact family match
    const exactMatch = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: modelName,
    });
    if (exactMatch.length > 0) {
      return exactMatch[0];
    }

    // Fallback: search all copilot models for a partial match
    const allModels = await vscode.lm.selectChatModels({ vendor: "copilot" });
    const partial = allModels.find(
      (m) =>
        m.family.includes(modelName) ||
        m.name.toLowerCase().includes(modelName.toLowerCase())
    );
    if (partial) {
      return partial;
    }

    // Last resort: return the first available model
    if (allModels.length > 0) {
      this.outputChannel.warn(
        `Model "${modelName}" not found, falling back to "${allModels[0].family}"`
      );
      return allModels[0];
    }

    return null;
  }

  /** Get the port the server is running on */
  getPort(): number {
    return this.port;
  }

  /** Check if the server is running */
  isRunning(): boolean {
    return this.server !== null;
  }
}
