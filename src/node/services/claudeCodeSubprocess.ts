/**
 * Claude Code Subprocess Provider
 *
 * Implements the AI SDK LanguageModel interface by spawning the `claude` CLI binary
 * as a subprocess. This is the Anthropic-sanctioned way to use Claude Pro/Max
 * subscriptions from third-party tools — the real Claude Code binary makes the API
 * calls, so Anthropic's server-side checks pass.
 *
 * Execution Modes:
 *   - "proxy":   Text-only LLM proxy. No tools. Single-turn request/response.
 *   - "agentic": Claude Code handles tool calling internally via --mcp-config.
 *                The CLI runs its own multi-turn agentic loop with Lattice MCP tools.
 *
 * Architecture:
 *   Lattice → spawns `claude -p "<prompt>" --model <model> --output-format stream-json`
 *       → (agentic) also passes --mcp-config, --permission-mode, --max-turns
 *       → parses line-delimited JSON events from stdout
 *       → translates to AI SDK LanguageModelV2StreamPart events
 *
 * The claude CLI outputs three event types:
 *   1. { type: "system", subtype: "init", session_id, model } — session start
 *   2. { type: "assistant", message: { content: [...], usage, stop_reason } } — content
 *   3. { type: "result", result, usage, duration_ms, total_cost_usd } — final summary
 */

import { spawn, type ChildProcess } from "child_process";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
  LanguageModelV2FinishReason,
  LanguageModelV2CallWarning,
} from "@ai-sdk/provider";
import { log } from "./log";
import { ServerLockfile } from "./serverLockfile";
import { getLatticeHome } from "@/common/constants/paths";
import type { ClaudeCodeExecutionMode } from "@/common/types/claudeCodeMode";

// ────────────────────────────────────────────────────────────────────────────
// Claude CLI stream-json event types
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
// Binary discovery
// ────────────────────────────────────────────────────────────────────────────

let cachedBinaryPath: string | null = null;
const isWindows = process.platform === "win32";
const binaryName = isWindows ? "claude.exe" : "claude";

/**
 * Run a command with a timeout and return its stdout, or null on failure.
 */
function execProbe(cmd: string, args: string[], timeoutMs = 5_000): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 && stdout.trim() ? stdout.trim() : null);
    });
  });
}

/**
 * Find the `claude` binary on the system.
 *
 * Strategy (cross-platform):
 * 1. Login-shell `which` / `where` — picks up any PATH additions from rc files
 * 2. Static common paths — covers native installer, npm, Volta, nvm, Homebrew, bun, pnpm
 * 3. Validates with `--version` to confirm the binary is actually Claude Code
 *
 * Caches the result after first successful lookup.
 */
export async function findClaudeBinary(): Promise<string | null> {
  if (cachedBinaryPath) return cachedBinaryPath;

  // ── Step 1: shell-based lookup ──
  // On macOS/Linux, run `which` inside a login shell so we pick up ~/.zshrc PATH additions.
  // On Windows, use `where` directly (no login shell concept).
  let shellResult: string | null = null;

  if (isWindows) {
    shellResult = await execProbe("where", [binaryName]);
    // `where` may return multiple lines; take the first.
    if (shellResult?.includes("\n")) {
      shellResult = shellResult.split("\n")[0]?.trim() ?? null;
    }
  } else {
    const shell = process.env.SHELL ?? "/bin/zsh";
    shellResult = await execProbe(shell, ["-l", "-c", `which ${binaryName}`]);
  }

  if (shellResult) {
    cachedBinaryPath = shellResult;
    log.info(`[claude-code-subprocess] Found claude via shell lookup: ${shellResult}`);
    return shellResult;
  }

  // ── Step 2: common installation paths ──
  // Covers: native installer, npm global, Volta, nvm, fnm, Homebrew, bun, pnpm, Scoop, winget.
  const home = os.homedir();
  const commonPaths = isWindows
    ? [
        // Windows common paths
        path.join(home, "AppData", "Local", "Programs", "claude", binaryName),
        path.join(home, "AppData", "Roaming", "npm", binaryName),
        path.join(home, ".volta", "bin", binaryName),
        path.join(home, "scoop", "shims", binaryName),
        "C:\\Program Files\\Claude\\claude.exe",
      ]
    : [
        // macOS / Linux common paths
        path.join(home, ".local", "bin", binaryName),
        "/usr/local/bin/claude",
        path.join(home, ".npm-global", "bin", binaryName),
        path.join(home, ".volta", "bin", binaryName),
        path.join(home, ".nvm", "current", "bin", binaryName),
        // fnm (Fast Node Manager)
        path.join(home, ".local", "share", "fnm", "aliases", "default", "bin", binaryName),
        // Homebrew (Apple Silicon + Intel)
        "/opt/homebrew/bin/claude",
        // bun global
        path.join(home, ".bun", "bin", binaryName),
        // pnpm global
        path.join(home, ".local", "share", "pnpm", binaryName),
      ];

  for (const p of commonPaths) {
    try {
      const stats = await fsPromises.stat(p);
      if (stats.isFile()) {
        cachedBinaryPath = p;
        log.info(`[claude-code-subprocess] Found claude at common path: ${p}`);
        return p;
      }
    } catch {
      continue;
    }
  }

  log.warn("[claude-code-subprocess] Claude CLI binary not found in any known location");
  return null;
}

/** Sync accessor — returns cached path only (null if detection hasn't run). */
export function findClaudeBinaryCached(): string | null {
  return cachedBinaryPath;
}

/** Reset cached binary path (for testing). */
export function resetClaudeBinaryCache(): void {
  cachedBinaryPath = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Auth check — quick probe to verify the CLI is logged in
// ────────────────────────────────────────────────────────────────────────────

export async function isClaudeCodeAuthenticated(): Promise<{ ok: boolean; message: string }> {
  const binaryPath = await findClaudeBinary();
  if (!binaryPath) {
    return {
      ok: false,
      message: "Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code",
    };
  }

  return new Promise((resolve) => {
    const proc = spawnClaude(
      binaryPath,
      ["-p", "say ok", "--output-format", "json", "--max-turns", "1"],
      30_000
    );

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (stdout.includes('"type":"result"')) {
        try {
          const result = JSON.parse(stdout) as {
            type: string;
            is_error?: boolean;
            result?: string;
          };
          if (result.is_error) {
            const msg = result.result ?? "Unknown CLI error";
            const isAuthError =
              msg.includes("API key") || msg.includes("/login") || msg.includes("auth");
            resolve({
              ok: false,
              message: isAuthError
                ? "Not authenticated. Run `claude auth login` or `claude setup-token`."
                : `CLI error: ${msg}`,
            });
          } else {
            resolve({ ok: true, message: "Connected" });
          }
          return;
        } catch {
          // JSON parse failed, fall through
        }
      }

      resolve({
        ok: false,
        message: stderr.includes("not authenticated")
          ? "Not authenticated. Run `claude setup-token` or `claude auth login`."
          : `CLI error (code ${String(code ?? "unknown")}): ${(stderr || stdout).slice(0, 200)}`,
      });
    });

    proc.on("error", (err) => {
      resolve({ ok: false, message: `Failed to spawn Claude CLI: ${err.message}` });
    });

    proc.stdin?.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Process spawning — direct exec with cached login-shell environment
// ────────────────────────────────────────────────────────────────────────────

/**
 * Environment variables forwarded to the claude subprocess.
 * Only pass auth keys, PATH, and essentials — no leaking of unrelated secrets.
 */
const ENV_ALLOWLIST = new Set([
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
  "NODE_ENV",
  "NODE_PATH",
  "NVM_DIR",
  "VOLTA_HOME",
  "FNM_DIR",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_MODEL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSH_AUTH_SOCK",
  "GNUPGHOME",
]);

/**
 * Keys that MUST be removed from the subprocess env to prevent the Claude CLI
 * from thinking it's running inside another Claude Code session (which causes
 * it to refuse to start).
 */
const ENV_BLOCKLIST = new Set(["CLAUDECODE", "CLAUDE_CODE_SESSION"]);

function buildFilteredEnvFrom(
  source: Record<string, string | undefined>
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (ENV_ALLOWLIST.has(key) && !ENV_BLOCKLIST.has(key) && value != null) {
      env[key] = value;
    }
  }
  env.HOME ??= os.homedir();
  return env;
}

/**
 * Spawn the claude binary inside a login shell — matches lattice's working approach.
 * The login shell ensures PATH, NVM, keychain, and all profile setup are applied.
 * Each arg is single-quote escaped for the shell command string.
 */
function spawnClaude(binaryPath: string, args: string[], timeout?: number): ChildProcess {
  const shell = process.env.SHELL ?? "/bin/zsh";
  // Escape for shell: wrap in single quotes, escaping any embedded single quotes
  const shellEscape = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const escapedBinary = shellEscape(binaryPath);
  const escapedArgs = args.map(shellEscape).join(" ");
  const shellCmd = `${escapedBinary} ${escapedArgs}`;

  const env = buildFilteredEnvFrom(process.env);

  return spawn(shell, ["-l", "-c", shellCmd], {
    timeout,
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// MCP config generation — for agentic mode
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate MCP config JSON for Claude Code CLI's --mcp-config flag.
 * Configures the Lattice MCP server so Claude Code can call Lattice tools
 * (create minions, list projects, send messages, etc.) during its agentic loop.
 *
 * Returns null if the Lattice server is not running (graceful degradation).
 */
async function generateLatticeMcpConfig(): Promise<string | null> {
  try {
    const lockfile = new ServerLockfile(getLatticeHome());
    const lockData = await lockfile.read();

    if (!lockData) {
      log.warn("[claude-code-subprocess] No server.lock found; agentic mode will lack MCP tools");
      return null;
    }

    // Compute absolute path to MCP server entry point.
    // In dev: __dirname is src/node/services/, MCP server is at src/mcp-server/index.ts
    // In prod: adjust relative path accordingly.
    const mcpServerPath = path.resolve(__dirname, "../../mcp-server/index.ts");

    const config = {
      mcpServers: {
        lattice: {
          command: "bun",
          args: ["run", mcpServerPath],
          env: {
            LATTICE_SERVER_URL: lockData.baseUrl,
            ...(lockData.token ? { LATTICE_SERVER_AUTH_TOKEN: lockData.token } : {}),
          },
        },
      },
    };

    log.info(`[claude-code-subprocess] Generated MCP config for agentic mode (server: ${lockData.baseUrl})`);
    return JSON.stringify(config);
  } catch (error) {
    log.warn("[claude-code-subprocess] Failed to generate MCP config", { error });
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt serialization — convert AI SDK messages to flat text for CLI
// ────────────────────────────────────────────────────────────────────────────

function extractSystemPrompt(options: LanguageModelV2CallOptions): string | null {
  const parts: string[] = [];
  for (const msg of options.prompt) {
    if (msg.role === "system") {
      parts.push(msg.content);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function promptToFlatString(options: LanguageModelV2CallOptions, skipSystem: boolean): string {
  const parts: string[] = [];

  for (const msg of options.prompt) {
    if (msg.role === "system") {
      if (!skipSystem) {
        parts.push(`<system>\n${msg.content}\n</system>`);
      }
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
          let text = "";
          if (typeof output === "object" && output !== null) {
            if ("type" in output && "value" in output) {
              text = String((output as { value: unknown }).value);
            } else {
              text = JSON.stringify(output);
            }
          } else {
            text = String(output);
          }
          parts.push(`[Tool Result for ${part.toolName}]: ${text}`);
        }
      }
    }
  }

  return parts.join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Stream-JSON input serialization — convert AI SDK messages to CLI stdin events
// ────────────────────────────────────────────────────────────────────────────

/**
 * Serialize AI SDK prompt messages to Claude Code stream-json input events.
 * Each event is a JSON line written to stdin when using --input-format stream-json.
 *
 * System prompts are handled via --system-prompt flag, not stdin.
 */
function promptToStreamJsonEvents(options: LanguageModelV2CallOptions): string[] {
  const events: string[] = [];

  for (const msg of options.prompt) {
    if (msg.role === "system") {
      // Handled via --system-prompt CLI flag
      continue;
    } else if (msg.role === "user") {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        }
      }
      if (textParts.length > 0) {
        events.push(
          JSON.stringify({
            type: "user",
            message: { role: "user", content: textParts.join("\n") },
          })
        );
      }
    } else if (msg.role === "tool") {
      // Tool results from AI SDK's tool execution — fed back to CLI
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const output =
            typeof part.output === "object"
              ? JSON.stringify(part.output)
              : String(part.output);
          events.push(
            JSON.stringify({
              type: "tool_result",
              tool_use_id: part.toolCallId,
              content: output,
            })
          );
        }
      }
    }
    // Assistant messages are part of conversation history the CLI reconstructs
    // from the user + tool_result sequence. We don't replay them on stdin.
  }

  return events;
}

// ────────────────────────────────────────────────────────────────────────────
// Normalize model ID — UI sends dots (claude-opus-4.5), CLI expects dashes
// ────────────────────────────────────────────────────────────────────────────

function normalizeModelId(modelId: string): string {
  return modelId.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

// ────────────────────────────────────────────────────────────────────────────
// Stream adapter — parses claude's line-delimited JSON into LanguageModelV2StreamParts
// ────────────────────────────────────────────────────────────────────────────

function attachStreamJsonAdapter(
  proc: ChildProcess,
  controller: ReadableStreamDefaultController<LanguageModelV2StreamPart>,
  closeStdin: boolean = true
): void {
  let buffer = "";
  const textId = "text-0";
  let textStarted = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finishReason: LanguageModelV2FinishReason = "stop";

  controller.enqueue({ type: "stream-start", warnings: [] });

  // Log stderr for diagnostics but don't surface to the UI
  proc.stderr?.on("data", (d: Buffer) => {
    const msg = d.toString().trim();
    if (msg) {
      log.debug(`[claude-code-subprocess] stderr: ${msg.slice(0, 500)}`);
    }
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as ClaudeStreamEvent;

        // Skip events we don't handle (e.g. rate_limit_event)
        if (event.type !== "system" && event.type !== "assistant" && event.type !== "result") {
          continue;
        }

        if (event.type === "system" && event.subtype === "init") {
          controller.enqueue({
            type: "response-metadata",
            id: event.session_id,
            modelId: event.model,
            timestamp: new Date(),
          });
        } else if (event.type === "assistant") {
          for (const part of event.message.content) {
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
              controller.enqueue({ type: "tool-input-start", id: part.id, toolName: part.name });
              controller.enqueue({
                type: "tool-input-delta",
                id: part.id,
                delta: JSON.stringify(part.input),
              });
              controller.enqueue({ type: "tool-input-end", id: part.id });
            }
          }

          if (event.message.usage) {
            totalInputTokens += event.message.usage.input_tokens || 0;
            totalOutputTokens += event.message.usage.output_tokens || 0;
          }

          if (event.message.stop_reason === "tool_use") {
            finishReason = "tool-calls";
          }
        } else if (event.type === "result") {
          if (event.usage) {
            totalInputTokens = event.usage.input_tokens || totalInputTokens;
            totalOutputTokens = event.usage.output_tokens || totalOutputTokens;
          }
          if (event.is_error) {
            finishReason = "error";
            controller.enqueue({
              type: "error",
              error: new Error(event.result || "Claude Code CLI returned an error"),
            });
          }
        }
      } catch {
        log.debug(`[claude-code-subprocess] Skipping unparseable line: ${line.slice(0, 100)}`);
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
      log.warn(`[claude-code-subprocess] Process exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    controller.enqueue({ type: "error", error: err });
    controller.close();
  });

  if (closeStdin) {
    proc.stdin?.end();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LanguageModelV2 factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the claude binary path, searching lazily on first use.
 * Subsequent calls return the cached result.
 */
async function requireClaudeBinary(): Promise<string> {
  const cached = findClaudeBinaryCached();
  if (cached) return cached;

  const found = await findClaudeBinary();
  if (!found) {
    throw new Error(
      "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
    );
  }
  return found;
}

/**
 * Create a LanguageModelV2 that routes through the Claude Code CLI subprocess.
 * Uses the user's Pro/Max subscription via the real claude binary.
 *
 * Binary discovery is deferred to first doGenerate/doStream call — no need
 * to call findClaudeBinary() ahead of time.
 *
 * @param modelId - Model ID (e.g. "claude-sonnet-4-5"). Dots normalized to dashes.
 * @param mode - Execution mode: "proxy" (text-only) or "agentic" (with MCP tools).
 */
export function createClaudeCodeModel(
  modelId: string,
  mode: ClaudeCodeExecutionMode = "agentic"
): LanguageModelV2 {
  const normalizedModelId = normalizeModelId(modelId);

  return {
    specificationVersion: "v2" as const,
    provider: "claude-code",
    modelId: normalizedModelId,
    supportedUrls: {},

    // ── Non-streaming ──
    async doGenerate(options: LanguageModelV2CallOptions) {
      const binaryPath = await requireClaudeBinary();
      const systemPrompt = extractSystemPrompt(options);
      const prompt = promptToFlatString(options, systemPrompt !== null);

      // Generate MCP config for agentic mode
      const mcpConfigJson = mode === "agentic" ? await generateLatticeMcpConfig() : null;

      const args = buildClaudeArgs({
        prompt,
        modelId: normalizedModelId,
        systemPrompt,
        outputFormat: "json",
        mode,
        mcpConfigJson,
      });

      log.info(
        `[claude-code-subprocess] doGenerate: ${binaryPath} ${args.slice(0, 4).join(" ")} ...`
      );

      return new Promise((resolve, reject) => {
        const proc = spawnClaude(binaryPath, args);

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
                  // Use final text if we haven't accumulated any from assistant events
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
                // Skip unparseable lines (debug output, etc.)
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
                modelId: normalizedModelId,
                timestamp: new Date(),
              },
            });
          } catch {
            reject(
              new Error(
                `Claude Code CLI failed (code ${String(code ?? "unknown")}): ${(stderr || stdout).slice(0, 500)}`
              )
            );
          }
        });

        proc.on("error", reject);
        proc.stdin?.end();
      });
    },

    // ── Streaming ──
    async doStream(options: LanguageModelV2CallOptions) {
      const binaryPath = await requireClaudeBinary();
      const systemPrompt = extractSystemPrompt(options);

      if (mode === "streaming") {
        // ── Streaming mode: write conversation as stream-json events to stdin ──
        const events = promptToStreamJsonEvents(options);

        // CLI still needs MCP config to know about available tools
        const mcpConfigJson = await generateLatticeMcpConfig();

        const args = buildClaudeArgs({
          prompt: "", // not used in streaming mode — input via stdin
          modelId: normalizedModelId,
          systemPrompt,
          outputFormat: "stream-json",
          mode: "streaming",
          mcpConfigJson,
        });

        log.info(
          `[claude-code-subprocess] doStream (streaming): ${binaryPath} ${args.slice(0, 4).join(" ")} ... (${events.length} stdin events)`
        );

        const proc = spawnClaude(binaryPath, args);

        if (options.abortSignal) {
          options.abortSignal.addEventListener("abort", () => {
            log.info("[claude-code-subprocess] Abort signal received, killing process");
            proc.kill("SIGTERM");
          });
        }

        // Write conversation events to stdin, then close to signal end-of-input
        for (const event of events) {
          proc.stdin?.write(event + "\n");
        }
        proc.stdin?.end();

        const stream = new ReadableStream<LanguageModelV2StreamPart>({
          start(controller) {
            // Don't close stdin again — already closed above
            attachStreamJsonAdapter(proc, controller, false);
          },
        });

        return {
          stream,
          rawCall: {
            rawPrompt: events.join("\n"),
            rawSettings: { model: normalizedModelId },
          },
          warnings: [] as LanguageModelV2CallWarning[],
        };
      }

      // ── Proxy / Agentic: flat text prompt via -p flag ──
      const prompt = promptToFlatString(options, systemPrompt !== null);

      // Generate MCP config for agentic mode
      const mcpConfigJson = mode === "agentic" ? await generateLatticeMcpConfig() : null;

      const args = buildClaudeArgs({
        prompt,
        modelId: normalizedModelId,
        systemPrompt,
        outputFormat: "stream-json",
        mode,
        mcpConfigJson,
      });

      log.info(
        `[claude-code-subprocess] doStream: ${binaryPath} ${args.slice(0, 4).join(" ")} ...`
      );

      const proc = spawnClaude(binaryPath, args);

      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", () => {
          log.info("[claude-code-subprocess] Abort signal received, killing process");
          proc.kill("SIGTERM");
        });
      }

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          attachStreamJsonAdapter(proc, controller);
        },
      });

      return {
        stream,
        rawCall: {
          rawPrompt: prompt,
          rawSettings: { model: normalizedModelId },
        },
        warnings: [] as LanguageModelV2CallWarning[],
      };
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// CLI argument builder
// ────────────────────────────────────────────────────────────────────────────

/** Default max turns for agentic mode — generous but bounded to prevent infinite loops. */
const DEFAULT_AGENTIC_MAX_TURNS = 25;

interface ClaudeArgOptions {
  prompt: string;
  modelId: string;
  systemPrompt: string | null;
  outputFormat: "json" | "stream-json";
  mode: ClaudeCodeExecutionMode;
  /** MCP config JSON string for agentic mode (from generateLatticeMcpConfig). */
  mcpConfigJson?: string | null;
  /** Max agentic turns. Defaults to DEFAULT_AGENTIC_MAX_TURNS in agentic mode. */
  maxTurns?: number;
}

function buildClaudeArgs(options: ClaudeArgOptions): string[] {
  const { prompt, modelId, systemPrompt, outputFormat, mode, mcpConfigJson, maxTurns } = options;
  const args: string[] = [];

  // System prompt via dedicated flag — matches lattice's working pattern.
  // The CLI receives this as a system message for the underlying API call.
  if (systemPrompt) {
    args.push("--system-prompt", systemPrompt);
  }

  if (mode === "streaming") {
    // ── Streaming mode: bidirectional stream-json ──
    // No -p flag — input comes via stdin as structured JSON events.
    args.push("--input-format", "stream-json");
    args.push("--output-format", "stream-json");
    args.push("--model", modelId);
    args.push("--verbose");
    args.push("--no-session-persistence");

    // The CLI still needs tool definitions to generate tool_use events.
    // We pass --mcp-config so it knows about Lattice tools.
    if (mcpConfigJson) {
      args.push("--mcp-config", mcpConfigJson);
    }
    args.push("--permission-mode", "bypassPermissions");

    const effectiveMaxTurns = maxTurns ?? DEFAULT_AGENTIC_MAX_TURNS;
    args.push("--max-turns", String(effectiveMaxTurns));
    return args;
  }

  // ── Proxy / Agentic: non-interactive print mode ──
  args.push("-p", prompt);

  // Model selection
  args.push("--model", modelId);

  // Output format + flags — matches lattice's extraArgs
  args.push("--output-format", outputFormat);
  args.push("--verbose");
  args.push("--no-session-persistence");

  // ── Agentic mode: pass MCP config and permission bypass ──
  if (mode === "agentic") {
    // Inject Lattice MCP server so Claude Code can call Lattice tools
    // (create_minion, list_projects, send_message, etc.) during its agentic loop.
    if (mcpConfigJson) {
      args.push("--mcp-config", mcpConfigJson);
    }

    // Bypass permission prompts since Lattice is a trusted environment.
    // Without this, Claude Code would prompt on stderr for tool approvals,
    // which we cannot respond to in non-interactive mode.
    args.push("--permission-mode", "bypassPermissions");

    // Safety limit to prevent infinite tool loops.
    const effectiveMaxTurns = maxTurns ?? DEFAULT_AGENTIC_MAX_TURNS;
    args.push("--max-turns", String(effectiveMaxTurns));
  }

  return args;
}
