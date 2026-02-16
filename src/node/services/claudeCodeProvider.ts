/**
 * Claude Code CLI Provider — Custom Vercel AI SDK LanguageModelV2 implementation
 *
 * Spawns `claude -p --output-format stream-json --verbose` as a subprocess
 * for each API call. This is the same approach used by Cline, OpenClaw, etc.
 *
 * Why: Claude Code OAuth tokens (sk-ant-oat01-*) are restricted to the Claude Code
 * binary and CANNOT be used directly against api.anthropic.com. The CLI handles
 * all authentication internally.
 */

import { spawn, type ChildProcess } from "child_process";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2FinishReason,
  LanguageModelV2CallWarning,
} from "@ai-sdk/provider";
import { log } from "./log";

// ────────────────────────────────────────────────────────────────────────────
// Spawn helper — uses login shell to inherit keychain access on macOS
// ────────────────────────────────────────────────────────────────────────────

function spawnClaude(claudePath: string, args: string[], timeout?: number): ChildProcess {
  const shell = process.env.SHELL || "/bin/zsh";
  // Escape args for shell: wrap each in single quotes, escaping any embedded single quotes
  const escapedArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const shellCmd = `"${claudePath}" ${escapedArgs}`;

  return spawn(shell, ["-l", "-c", shellCmd], {
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      HOME: process.env.HOME || require("os").homedir(),
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Types for Claude CLI stream-json output
// ────────────────────────────────────────────────────────────────────────────

interface ClaudeStreamInit {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
  tools: string[];
}

interface ClaudeStreamAssistant {
  type: "assistant";
  message: {
    id: string;
    model: string;
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
      | { type: "thinking"; thinking: string }
    >;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    stop_reason: string | null;
  };
  session_id: string;
}

interface ClaudeStreamResult {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  result: string;
  duration_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  session_id: string;
  total_cost_usd: number;
}

type ClaudeStreamEvent = ClaudeStreamInit | ClaudeStreamAssistant | ClaudeStreamResult;

// ────────────────────────────────────────────────────────────────────────────
// Convert Vercel AI SDK prompt to a string for Claude CLI
// ────────────────────────────────────────────────────────────────────────────

function promptToString(options: LanguageModelV2CallOptions): string {
  const parts: string[] = [];

  for (const msg of options.prompt) {
    if (msg.role === "system") {
      parts.push(`<system>\n${msg.content}\n</system>`);
    } else if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push(part.text);
        }
      }
    } else if (msg.role === "assistant") {
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push(`[Assistant]: ${part.text}`);
        } else if (part.type === "tool-call") {
          parts.push(`[Tool Call: ${part.toolName}(${JSON.stringify(part.input)})]`);
        }
      }
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const output = part.output;
          let resultText = "";
          if (typeof output === "object" && output !== null) {
            if ("type" in output && "value" in output) {
              resultText = String((output as { value: unknown }).value);
            } else {
              resultText = JSON.stringify(output);
            }
          } else {
            resultText = String(output);
          }
          parts.push(`[Tool Result for ${part.toolName}]: ${resultText}`);
        }
      }
    }
  }

  return parts.join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Find the claude CLI binary path
// ────────────────────────────────────────────────────────────────────────────

let cachedClaudePath: string | null = null;

export function findClaudeBinary(): string | null {
  if (cachedClaudePath) return cachedClaudePath;

  const { execSync } = require("child_process") as typeof import("child_process");
  try {
    const result = execSync("which claude", { encoding: "utf-8", timeout: 5000 }).trim();
    if (result) {
      cachedClaudePath = result;
      return result;
    }
  } catch {
    // Try common paths
    const fs = require("fs") as typeof import("fs");
    const commonPaths = [
      `${process.env.HOME}/.local/bin/claude`,
      "/usr/local/bin/claude",
      `${process.env.HOME}/.npm-global/bin/claude`,
    ];
    for (const p of commonPaths) {
      try {
        if (fs.existsSync(p)) {
          cachedClaudePath = p;
          return p;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Check if Claude CLI is authenticated (quick check)
// ────────────────────────────────────────────────────────────────────────────

export async function isClaudeCliAuthenticated(): Promise<{ ok: boolean; message: string }> {
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    return { ok: false, message: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code" };
  }

  return new Promise((resolve) => {
    const proc = spawnClaude(claudePath, ["-p", "say ok", "--output-format", "json", "--max-turns", "1"], 30000);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      // Try to parse JSON result first (CLI may exit with code 1 but still produce valid JSON)
      if (stdout.includes('"type":"result"')) {
        try {
          const result = JSON.parse(stdout) as ClaudeStreamResult & { modelUsage?: Record<string, unknown> };
          if (result.is_error) {
            // CLI ran but returned an error (e.g., auth failure)
            const msg = result.result || "Unknown CLI error";
            const isAuthError = msg.includes("API key") || msg.includes("/login") || msg.includes("auth");
            resolve({
              ok: false,
              message: isAuthError
                ? `Not authenticated. Run \`claude auth login\` or \`claude setup-token\`.`
                : `CLI error: ${msg}`,
            });
          } else {
            resolve({
              ok: true,
              message: `Connected — model: ${result.modelUsage ? Object.keys(result.modelUsage).join(", ") : "unknown"}`,
            });
          }
          return;
        } catch {
          // JSON parse failed, fall through
        }
      }

      // No valid JSON result — report raw error
      resolve({
        ok: false,
        message: stderr.includes("not authenticated")
          ? "Not authenticated. Run `claude setup-token` or `claude auth login`."
          : `CLI error (code ${code}): ${stderr.slice(0, 200) || stdout.slice(0, 200)}`,
      });
    });

    proc.on("error", (err) => {
      resolve({ ok: false, message: `Failed to spawn Claude CLI: ${err.message}` });
    });

    // Close stdin to signal EOF
    proc.stdin?.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Claude Code CLI LanguageModel — the actual Vercel AI SDK provider
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize model ID for the Claude CLI.
 * UI may send "claude-opus-4.5" (dot), but CLI expects "claude-opus-4-5" (dash)
 * or a short alias like "opus", "sonnet", "haiku".
 */
function normalizeModelId(modelId: string): string {
  // Map common dot-notation names to CLI-compatible format
  // e.g. "claude-opus-4.5" → "claude-opus-4-5"
  // e.g. "claude-sonnet-4.5" → "claude-sonnet-4-5"
  return modelId.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

export function createClaudeCodeModel(modelId: string): LanguageModelV2 {
  const cliModelId = normalizeModelId(modelId);
  const claudePath = findClaudeBinary();
  if (!claudePath) {
    throw new Error("Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code");
  }

  return {
    specificationVersion: "v2" as const,
    provider: "claude-code",
    modelId,
    supportedUrls: {},

    // ── Non-streaming generation ──
    async doGenerate(options: LanguageModelV2CallOptions) {
      const prompt = promptToString(options);

      return new Promise((resolve, reject) => {
        const args = [
          "-p", prompt,
          "--output-format", "json",
          "--model", cliModelId,
          "--max-turns", "1",
          "--no-session-persistence",
        ];

        const proc = spawnClaude(claudePath!, args);

        let stdout = "";
        let stderr = "";

        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", () => {
            proc.kill("SIGTERM");
          });
        }

        proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

        proc.on("close", (code) => {
          try {
            const result = JSON.parse(stdout) as ClaudeStreamResult;

            resolve({
              content: [
                { type: "text" as const, text: result.result || "" },
              ],
              finishReason: "stop" as LanguageModelV2FinishReason,
              usage: {
                inputTokens: result.usage?.input_tokens ?? 0,
                outputTokens: result.usage?.output_tokens ?? 0,
                totalTokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
              },
              warnings: [] as LanguageModelV2CallWarning[],
              response: {
                id: result.session_id || "unknown",
                modelId,
                timestamp: new Date(),
              },
            });
          } catch (err) {
            reject(new Error(`Claude CLI failed (code ${code}): ${stderr || stdout}`));
          }
        });

        proc.on("error", reject);
        proc.stdin?.end();
      });
    },

    // ── Streaming generation ──
    async doStream(options: LanguageModelV2CallOptions) {
      const prompt = promptToString(options);

      const args = [
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--model", cliModelId,
        "--max-turns", "1",
        "--no-session-persistence",
      ];

      log.info("[claude-code] Spawning CLI:", claudePath!, args.slice(0, 4).join(" "), "...");

      const proc = spawnClaude(claudePath!, args);

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          log.info("[claude-code] Abort signal received, killing CLI process");
          proc.kill("SIGTERM");
        });
      }

      let stderr = "";
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      // Create a ReadableStream that transforms CLI output to AI SDK stream parts
      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          let buffer = "";
          const textId = "text-0";
          let textStarted = false;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let finishReason: LanguageModelV2FinishReason = "stop";

          // Emit stream-start
          controller.enqueue({
            type: "stream-start",
            warnings: [],
          });

          proc.stdout?.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? ""; // Keep incomplete last line

            for (const line of lines) {
              if (!line.trim()) continue;

              try {
                const event = JSON.parse(line) as ClaudeStreamEvent;

                if (event.type === "system" && event.subtype === "init") {
                  // Emit response metadata
                  controller.enqueue({
                    type: "response-metadata",
                    id: event.session_id,
                    modelId: event.model,
                    timestamp: new Date(),
                  });
                } else if (event.type === "assistant") {
                  const msg = event.message;

                  for (const part of msg.content) {
                    if (part.type === "thinking") {
                      const thinkId = `reasoning-${Date.now()}`;
                      controller.enqueue({ type: "reasoning-start", id: thinkId });
                      controller.enqueue({ type: "reasoning-delta", id: thinkId, delta: part.thinking });
                      controller.enqueue({ type: "reasoning-end", id: thinkId });
                    } else if (part.type === "text") {
                      if (!textStarted) {
                        controller.enqueue({ type: "text-start", id: textId });
                        textStarted = true;
                      }
                      controller.enqueue({ type: "text-delta", id: textId, delta: part.text });
                    } else if (part.type === "tool_use") {
                      controller.enqueue({
                        type: "tool-input-start",
                        id: part.id,
                        toolName: part.name,
                      });
                      controller.enqueue({
                        type: "tool-input-delta",
                        id: part.id,
                        delta: JSON.stringify(part.input),
                      });
                      controller.enqueue({
                        type: "tool-input-end",
                        id: part.id,
                      });
                    }
                  }

                  // Track usage
                  if (msg.usage) {
                    totalInputTokens += msg.usage.input_tokens || 0;
                    totalOutputTokens += msg.usage.output_tokens || 0;
                  }

                  // Check stop reason
                  if (msg.stop_reason === "tool_use") {
                    finishReason = "tool-calls";
                  }
                } else if (event.type === "result") {
                  // Use result-level usage if available
                  if (event.usage) {
                    totalInputTokens = event.usage.input_tokens || totalInputTokens;
                    totalOutputTokens = event.usage.output_tokens || totalOutputTokens;
                  }

                  if (event.is_error) {
                    finishReason = "error";
                    controller.enqueue({
                      type: "error",
                      error: new Error(event.result || "Claude CLI returned error"),
                    });
                  }
                }
              } catch {
                // Skip unparseable lines (could be debug output)
                log.debug("[claude-code] Skipping unparseable line:", line.slice(0, 100));
              }
            }
          });

          proc.on("close", (code) => {
            // End text if started
            if (textStarted) {
              controller.enqueue({ type: "text-end", id: textId });
            }

            // Emit finish
            controller.enqueue({
              type: "finish",
              usage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens,
              },
              finishReason,
            });

            controller.close();

            if (code !== 0 && code !== null) {
              log.warn(`[claude-code] CLI exited with code ${code}: ${stderr.slice(0, 500)}`);
            }
          });

          proc.on("error", (err) => {
            controller.enqueue({ type: "error", error: err });
            controller.close();
          });

          // Close stdin
          proc.stdin?.end();
        },
      });

      return { stream };
    },
  };
}
