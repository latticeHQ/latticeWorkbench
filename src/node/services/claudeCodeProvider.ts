/**
 * Claude Code CLI Provider — Thin wrapper over the generic cliAgentProvider.
 *
 * Keeps Claude-specific binary discovery + auth check. Delegates the actual
 * LanguageModelV2 implementation to createCliAgentModel().
 */

import type { LanguageModelV2 } from "@ai-sdk/provider";
import { spawn } from "child_process";
import * as fsPromises from "fs/promises";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";
import { createCliAgentModel, spawnAgentProcess } from "./cliAgentProvider";

// ────────────────────────────────────────────────────────────────────────────
// Find the claude CLI binary path
// ────────────────────────────────────────────────────────────────────────────

let cachedClaudePath: string | null = null;

/**
 * Async binary discovery — does NOT block the event loop.
 * Caches the result after first successful lookup.
 */
export async function findClaudeBinary(): Promise<string | null> {
  if (cachedClaudePath) return cachedClaudePath;

  // Try `which claude` asynchronously
  try {
    const result = await new Promise<string | null>((resolve) => {
      const child = spawn("which", ["claude"], { stdio: ["ignore", "pipe", "ignore"] });
      let stdout = "";
      child.stdout!.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      const timeout = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 5000);
      child.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code === 0 && stdout.trim() ? stdout.trim() : null);
      });
    });
    if (result) {
      cachedClaudePath = result;
      return result;
    }
  } catch {
    // Fall through to common paths
  }

  // Try common paths (async stat)
  const commonPaths = [
    `${process.env.HOME}/.local/bin/claude`,
    "/usr/local/bin/claude",
    `${process.env.HOME}/.npm-global/bin/claude`,
  ];
  for (const p of commonPaths) {
    try {
      const stats = await fsPromises.stat(p);
      if (stats.isFile()) {
        cachedClaudePath = p;
        return p;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Sync accessor — returns the cached binary path only.
 * Returns null if findClaudeBinary() hasn't been called yet.
 * Used in synchronous model-creation paths where detection has already run.
 */
export function findClaudeBinaryCached(): string | null {
  return cachedClaudePath;
}

// ────────────────────────────────────────────────────────────────────────────
// Check if Claude CLI is authenticated (quick check)
// ────────────────────────────────────────────────────────────────────────────

/** Result type from Claude's JSON output (used for auth check only) */
interface ClaudeAuthResult {
  type: "result";
  is_error?: boolean;
  result?: string;
  modelUsage?: Record<string, unknown>;
}

export async function isClaudeCliAuthenticated(): Promise<{ ok: boolean; message: string }> {
  const claudePath = await findClaudeBinary();
  if (!claudePath) {
    return {
      ok: false,
      message: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
    };
  }

  return new Promise((resolve) => {
    const proc = spawnAgentProcess(
      claudePath,
      ["-p", "say ok", "--output-format", "json", "--max-turns", "1"],
      30000
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
      // Try to parse JSON result first (CLI may exit with code 1 but still produce valid JSON)
      if (stdout.includes('"type":"result"')) {
        try {
          const result = JSON.parse(stdout) as ClaudeAuthResult;
          if (result.is_error) {
            const msg = result.result || "Unknown CLI error";
            const isAuthError =
              msg.includes("API key") || msg.includes("/login") || msg.includes("auth");
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

    proc.stdin?.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Create Claude Code LanguageModelV2 — delegates to generic factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Normalize model ID for the Claude CLI.
 * UI may send "claude-opus-4.5" (dot), but CLI expects "claude-opus-4-5" (dash)
 */
function normalizeModelId(modelId: string): string {
  return modelId.replace(/(\d+)\.(\d+)/g, "$1-$2");
}

export function createClaudeCodeModel(modelId: string): LanguageModelV2 {
  // Use cached path — detection service always runs before model creation,
  // so findClaudeBinary() has already resolved and cached the path.
  const claudePath = findClaudeBinaryCached();
  if (!claudePath) {
    throw new Error("Claude Code CLI not found. Install: npm install -g @anthropic-ai/claude-code");
  }

  const def = CLI_AGENT_DEFINITIONS["claude-code"];
  return createCliAgentModel("claude-code", normalizeModelId(modelId), claudePath, def);
}
