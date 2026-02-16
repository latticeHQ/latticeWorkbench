/**
 * Generic CLI Agent LanguageModelV2 Provider
 *
 * Creates a Vercel AI SDK LanguageModelV2 for ANY CLI coding agent by spawning
 * the agent's binary as a subprocess and streaming its output. This generalizes
 * the pattern from claudeCodeProvider.ts to work with all detected agents.
 *
 * Two output adapters:
 * - "stream-json": Parses Claude's line-delimited JSON events (text, reasoning, tool calls)
 * - "text": Plain stdout → text-delta events (works for all other agents)
 */

import { spawn, type ChildProcess } from "child_process";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2FinishReason,
  LanguageModelV2CallWarning,
} from "@ai-sdk/provider";
import type { CliAgentDefinition } from "@/common/constants/cliAgents";
import { log } from "./log";

// ────────────────────────────────────────────────────────────────────────────
// Spawn helper — uses login shell to inherit PATH + keychain access on macOS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Curated allowlist of environment variables forwarded to agent processes.
 * Modelled after emdash's pattern: only pass auth keys, PATH, and essentials.
 * Prevents leaking unrelated env vars (e.g. database secrets, build tokens)
 * to agent subprocesses.
 */
const AGENT_ENV_ALLOWLIST: readonly string[] = [
  // ── Shell / System essentials ──
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",

  // ── Node.js / package managers ──
  "NODE_ENV",
  "NODE_PATH",
  "NVM_DIR",
  "VOLTA_HOME",
  "FNM_DIR",
  "npm_config_prefix",

  // ── Anthropic / Claude ──
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_MODEL",

  // ── OpenAI / Codex ──
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",

  // ── Google / Gemini ──
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",

  // ── GitHub / Copilot ──
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITHUB_COPILOT_TOKEN",

  // ── AWS (Bedrock) ──
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_PROFILE",

  // ── Azure ──
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_VERSION",

  // ── Mistral ──
  "MISTRAL_API_KEY",

  // ── Other providers ──
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "FIREWORKS_API_KEY",
  "DEEPSEEK_API_KEY",
  "COHERE_API_KEY",
  "REPLICATE_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
  "PERPLEXITY_API_KEY",
  "XAI_API_KEY",

  // ── Proxy / Networking ──
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "ALL_PROXY",

  // ── macOS keychain / security ──
  "SSH_AUTH_SOCK",
  "GNUPGHOME",
  "GPG_AGENT_INFO",

  // ── Lattice-specific ──
  "LATTICE_ROOT",
  "LATTICE_SESSION_ID",
] as const;

/**
 * Build a filtered env object from the current process environment,
 * only including vars in the allowlist.
 */
function buildAgentEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of AGENT_ENV_ALLOWLIST) {
    if (key in process.env) {
      env[key] = process.env[key];
    }
  }
  // Always ensure HOME is set
  if (!env.HOME) {
    env.HOME = require("os").homedir();
  }
  return env;
}

export function spawnAgentProcess(
  binaryPath: string,
  args: string[],
  timeout?: number
): ChildProcess {
  const shell = process.env.SHELL || "/bin/zsh";
  // Escape for shell: wrap in single quotes, escaping any embedded single quotes
  const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const escapedBinary = shellEscape(binaryPath);
  const escapedArgs = args.map(shellEscape).join(" ");
  const shellCmd = `${escapedBinary} ${escapedArgs}`;

  return spawn(shell, ["-l", "-c", shellCmd], {
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
    env: buildAgentEnv(),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Convert Vercel AI SDK prompt to a flat string for CLI agents
// ────────────────────────────────────────────────────────────────────────────

export function promptToString(options: LanguageModelV2CallOptions): string {
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
// Build CLI arguments from agent definition metadata
// ────────────────────────────────────────────────────────────────────────────

export function buildCliArgs(
  slug: string,
  prompt: string,
  modelId: string,
  def: CliAgentDefinition
): string[] {
  // Special case: github-copilot uses `gh copilot suggest`
  if (slug === "github-copilot") {
    return ["copilot", "suggest", "-t", "shell", prompt];
  }

  const args: string[] = [];

  // Add prompt (flag or positional)
  if (def.promptFlag) {
    args.push(def.promptFlag, prompt);
  } else {
    args.push(prompt);
  }

  // Add model selection
  if (def.modelFlag && modelId) {
    args.push(def.modelFlag, modelId);
  }

  // Add extra args from definition
  if (def.extraArgs) {
    args.push(...def.extraArgs);
  }

  return args;
}

// ────────────────────────────────────────────────────────────────────────────
// Types for Claude CLI stream-json output (used by stream-json adapter)
// ────────────────────────────────────────────────────────────────────────────

interface ClaudeStreamInit {
  type: "system";
  subtype: "init";
  session_id: string;
  model: string;
}

interface ClaudeStreamAssistant {
  type: "assistant";
  message: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "thinking"; thinking: string }
      | { type: "tool_use"; id: string; name: string; input: unknown }
    >;
    usage?: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  };
}

interface ClaudeStreamResult {
  type: "result";
  is_error?: boolean;
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
// Output adapters
// ────────────────────────────────────────────────────────────────────────────

/**
 * stream-json adapter: Parses Claude's line-delimited JSON events into
 * LanguageModelV2StreamPart events (text-delta, reasoning, tool calls, finish).
 */
function streamJsonAdapter(
  proc: ChildProcess,
  controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  modelId: string
): void {
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
              controller.enqueue({
                type: "reasoning-start",
                id: thinkId,
              });
              controller.enqueue({
                type: "reasoning-delta",
                id: thinkId,
                delta: part.thinking,
              });
              controller.enqueue({ type: "reasoning-end", id: thinkId });
            } else if (part.type === "text") {
              if (!textStarted) {
                controller.enqueue({ type: "text-start", id: textId });
                textStarted = true;
              }
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: part.text,
              });
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
              error: new Error(event.result || "CLI agent returned error"),
            });
          }
        }
      } catch {
        // Skip unparseable lines (could be debug output)
        log.debug(`[cli-agent] Skipping unparseable line: ${line.slice(0, 100)}`);
      }
    }
  });

  proc.on("close", (code) => {
    if (textStarted) {
      controller.enqueue({ type: "text-end", id: textId });
    }

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
      log.warn(`[cli-agent] Process exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    controller.enqueue({ type: "error", error: err });
    controller.close();
  });

  // Close stdin
  proc.stdin?.end();
}

/**
 * text adapter: Plain stdout chunks → text-delta events.
 * Works for all non-Claude agents that produce plain text output.
 */
function textAdapter(
  proc: ChildProcess,
  controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  modelId: string
): void {
  const textId = "text-0";
  let textStarted = false;

  // Emit stream-start
  controller.enqueue({
    type: "stream-start",
    warnings: [],
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text) return;

    if (!textStarted) {
      controller.enqueue({ type: "text-start", id: textId });
      textStarted = true;
    }
    controller.enqueue({ type: "text-delta", id: textId, delta: text });
  });

  proc.on("close", (code) => {
    if (textStarted) {
      controller.enqueue({ type: "text-end", id: textId });
    }

    const finishReason: LanguageModelV2FinishReason = code === 0 ? "stop" : "error";

    controller.enqueue({
      type: "finish",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      finishReason,
    });

    controller.close();

    if (code !== 0 && code !== null) {
      log.warn(`[cli-agent] Process exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    controller.enqueue({ type: "error", error: err });
    controller.close();
  });

  // Close stdin
  proc.stdin?.end();
}

// ────────────────────────────────────────────────────────────────────────────
// Main factory: creates a LanguageModelV2 for any CLI agent
// ────────────────────────────────────────────────────────────────────────────

export function createCliAgentModel(
  slug: string,
  modelId: string,
  binaryPath: string,
  def: CliAgentDefinition
): LanguageModelV2 {
  const outputFormat = def.outputFormat ?? "text";

  return {
    specificationVersion: "v2" as const,
    provider: slug,
    modelId,
    supportedUrls: {},

    // ── Non-streaming generation ──
    async doGenerate(options: LanguageModelV2CallOptions) {
      const prompt = promptToString(options);
      const args = buildCliArgs(slug, prompt, modelId, def);

      // For Claude, override to JSON output for non-streaming
      const generateArgs =
        outputFormat === "stream-json" ? args.map((a) => (a === "stream-json" ? "json" : a)) : args;

      return new Promise((resolve, reject) => {
        log.info(
          `[cli-agent:${slug}] doGenerate: ${binaryPath} ${generateArgs.slice(0, 4).join(" ")} ...`
        );

        const proc = spawnAgentProcess(binaryPath, generateArgs);

        let stdout = "";
        let stderr = "";

        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", () => {
            proc.kill("SIGTERM");
          });
        }

        proc.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString();
        });

        proc.on("close", (code) => {
          if (outputFormat === "stream-json") {
            // Parse Claude's line-delimited JSON output.
            // Claude CLI outputs one JSON object per line: init, assistant, result events.
            try {
              const lines = stdout.split("\n").filter((l) => l.trim());
              let textContent = "";
              let sessionId = "unknown";
              let inputTokens = 0;
              let outputTokens = 0;
              let finishReason: LanguageModelV2FinishReason = "stop";

              for (const line of lines) {
                try {
                  const event = JSON.parse(line) as ClaudeStreamEvent;
                  if (event.type === "system" && event.subtype === "init") {
                    sessionId = event.session_id;
                  } else if (event.type === "assistant") {
                    // Extract text from assistant message content parts
                    for (const part of event.message.content) {
                      if (part.type === "text") {
                        textContent += part.text;
                      }
                    }
                    if (event.message.usage) {
                      inputTokens += event.message.usage.input_tokens || 0;
                      outputTokens += event.message.usage.output_tokens || 0;
                    }
                  } else if (event.type === "result") {
                    // result.result contains the final text output
                    if (event.result && !textContent) {
                      textContent = event.result;
                    }
                    if (event.usage) {
                      inputTokens = event.usage.input_tokens || 0;
                      outputTokens = event.usage.output_tokens || 0;
                    }
                    sessionId = event.session_id || sessionId;
                    if (event.is_error) {
                      finishReason = "error";
                    }
                  }
                } catch {
                  // Skip unparseable lines
                }
              }

              resolve({
                content: [{ type: "text" as const, text: textContent }],
                finishReason,
                usage: {
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                warnings: [] as LanguageModelV2CallWarning[],
                response: {
                  id: sessionId,
                  modelId,
                  timestamp: new Date(),
                },
              });
            } catch (err) {
              reject(new Error(`${slug} CLI failed (code ${code}): ${stderr || stdout.slice(0, 500)}`));
            }
          } else {
            // Plain text output
            resolve({
              content: [{ type: "text" as const, text: stdout }],
              finishReason:
                code === 0
                  ? ("stop" as LanguageModelV2FinishReason)
                  : ("error" as LanguageModelV2FinishReason),
              usage: {
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
              },
              warnings: [] as LanguageModelV2CallWarning[],
              response: {
                id: `${slug}-${Date.now()}`,
                modelId,
                timestamp: new Date(),
              },
            });
          }
        });

        proc.on("error", reject);
        proc.stdin?.end();
      });
    },

    // ── Streaming generation ──
    async doStream(options: LanguageModelV2CallOptions) {
      const prompt = promptToString(options);
      const args = buildCliArgs(slug, prompt, modelId, def);

      log.info(`[cli-agent:${slug}] doStream: ${binaryPath} ${args.slice(0, 4).join(" ")} ...`);

      const proc = spawnAgentProcess(binaryPath, args);

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          log.info(`[cli-agent:${slug}] Abort signal received, killing process`);
          proc.kill("SIGTERM");
        });
      }

      let stderr = "";
      proc.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          if (outputFormat === "stream-json") {
            streamJsonAdapter(proc, controller, modelId);
          } else {
            textAdapter(proc, controller, modelId);
          }
        },
      });

      return { stream };
    },
  };
}
