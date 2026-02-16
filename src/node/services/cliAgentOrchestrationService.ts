/**
 * CLI Agent Orchestration Service
 *
 * Spawns CLI coding agents as subprocesses, streams their output,
 * and manages lifecycle (start, stream, stop). Works with any agent
 * that accepts prompt input via stdin/args and produces text output.
 *
 * Patterns adopted from:
 * - claudeCodeProvider.ts (login shell wrapper, line-buffered streaming)
 * - backgroundProcessManager.ts (file-based output, incremental reads)
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { log } from "@/node/services/log";
import {
  CLI_AGENT_DEFINITIONS,
  type CliAgentSlug,
  type CliAgentDefinition,
} from "@/common/constants/cliAgents";
import type { CliAgentDetectionService } from "./cliAgentDetectionService";

export interface AgentSession {
  id: string;
  slug: string;
  displayName: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: number;
  /** Accumulated output */
  output: string;
  exitCode?: number;
}

export interface AgentRunOptions {
  /** CLI agent slug (e.g., "claude-code", "codex") */
  slug: string;
  /** Prompt / command to send to the agent */
  prompt: string;
  /** Working directory */
  cwd: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Timeout in ms (default: 5 minutes) */
  timeoutMs?: number;
}

export interface AgentRunResult {
  sessionId: string;
  success: boolean;
  output: string;
  exitCode?: number;
  durationMs: number;
}

export interface AgentStreamEvent {
  sessionId: string;
  type: "output" | "error" | "exit";
  data: string;
  exitCode?: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Maps agent slugs to their CLI argument patterns.
 * Each agent accepts prompts differently.
 */
function buildAgentArgs(slug: string, prompt: string, def: CliAgentDefinition): string[] {
  switch (slug) {
    case "claude-code":
      return ["-p", prompt, "--output-format", "stream-json", "--verbose"];
    case "codex":
      return ["--prompt", prompt];
    case "gemini":
      return ["-p", prompt];
    case "github-copilot":
      // gh copilot suggest
      return ["copilot", "suggest", "-t", "shell", prompt];
    default:
      // Generic: most CLI agents accept prompt as positional arg or via -p
      return [prompt];
  }
}

/**
 * Resolve the binary to execute for a given agent.
 */
function getAgentBinary(slug: string, def: CliAgentDefinition): string {
  if (slug === "github-copilot") return "gh";
  return def.binaryNames[0];
}

export class CliAgentOrchestrationService extends EventEmitter {
  private sessions = new Map<string, AgentSession>();
  private processes = new Map<string, ChildProcess>();
  private nextSessionId = 1;

  constructor(private detectionService: CliAgentDetectionService) {
    super();
  }

  /**
   * Run a CLI agent with a prompt. Returns when the process completes.
   */
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const rawDef = CLI_AGENT_DEFINITIONS[options.slug as CliAgentSlug];
    const def = rawDef as CliAgentDefinition | undefined;

    if (!def) {
      return {
        sessionId: "",
        success: false,
        output: `Unknown agent: ${options.slug}`,
        durationMs: 0,
      };
    }

    // Verify agent is installed
    const detection = await this.detectionService.detectOne(options.slug);
    if (!detection.detected) {
      return {
        sessionId: "",
        success: false,
        output: `${def.displayName} is not installed. Install it first.`,
        durationMs: 0,
      };
    }

    const sessionId = `agent-${this.nextSessionId++}`;
    const binary = detection.binaryPath ?? getAgentBinary(options.slug, def);
    const args = buildAgentArgs(options.slug, options.prompt, def);
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const session: AgentSession = {
      id: sessionId,
      slug: options.slug,
      displayName: def.displayName,
      status: "running",
      startedAt: Date.now(),
      output: "",
    };
    this.sessions.set(sessionId, session);

    log.info(
      `[AgentOrchestration] Starting ${def.displayName} (${sessionId}): ${binary} ${args.join(" ")}`
    );

    const startTime = Date.now();

    try {
      const result = await this.spawnAgent(sessionId, binary, args, {
        cwd: options.cwd,
        env: options.env,
        timeout,
      });

      session.status = result.exitCode === 0 ? "completed" : "failed";
      session.exitCode = result.exitCode;

      return {
        sessionId,
        success: result.exitCode === 0,
        output: session.output,
        exitCode: result.exitCode,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      session.status = "failed";
      const msg = error instanceof Error ? error.message : String(error);
      return {
        sessionId,
        success: false,
        output: `${session.output}\nError: ${msg}`,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Stop a running agent session.
   */
  stop(sessionId: string): boolean {
    const proc = this.processes.get(sessionId);
    if (!proc) return false;

    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = "stopped";
    }

    proc.kill("SIGTERM");

    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill("SIGKILL");
      }
    }, 5000);

    return true;
  }

  /**
   * Get current status of all sessions.
   */
  listSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get a specific session.
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Spawn agent subprocess with line-buffered output streaming.
   * Uses login shell wrapper for PATH/keychain access (macOS).
   */
  private spawnAgent(
    sessionId: string,
    binary: string,
    args: string[],
    options: { cwd: string; env?: Record<string, string>; timeout: number }
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      const shell = process.env.SHELL || "/bin/zsh";
      const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
      const shellCmd = `"${binary}" ${escapedArgs}`;

      const proc = spawn(shell, ["-l", "-c", shellCmd], {
        cwd: options.cwd,
        timeout: options.timeout,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...options.env,
          HOME: process.env.HOME ?? require("os").homedir(),
        },
      });

      this.processes.set(sessionId, proc);
      const session = this.sessions.get(sessionId);

      let stdoutBuffer = "";
      let stderrBuffer = "";

      // Line-buffered stdout streaming
      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutBuffer += text;

        if (session) {
          session.output += text;
        }

        // Emit complete lines
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.emit("output", {
            sessionId,
            type: "output",
            data: line + "\n",
          } satisfies AgentStreamEvent);
        }
      });

      // Line-buffered stderr streaming
      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuffer += text;

        if (session) {
          session.output += text;
        }

        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          this.emit("output", {
            sessionId,
            type: "error",
            data: line + "\n",
          } satisfies AgentStreamEvent);
        }
      });

      proc.on("close", (code) => {
        // Flush remaining buffers
        if (stdoutBuffer && session) {
          session.output += stdoutBuffer;
          this.emit("output", {
            sessionId,
            type: "output",
            data: stdoutBuffer,
          } satisfies AgentStreamEvent);
        }
        if (stderrBuffer && session) {
          session.output += stderrBuffer;
          this.emit("output", {
            sessionId,
            type: "error",
            data: stderrBuffer,
          } satisfies AgentStreamEvent);
        }

        this.processes.delete(sessionId);
        const exitCode = code ?? 1;

        this.emit("output", {
          sessionId,
          type: "exit",
          data: "",
          exitCode,
        } satisfies AgentStreamEvent);

        resolve({ exitCode });
      });

      proc.on("error", (err) => {
        this.processes.delete(sessionId);
        reject(err);
      });
    });
  }

  /**
   * Clean up all running sessions.
   */
  async dispose(): Promise<void> {
    for (const [sessionId, proc] of this.processes) {
      log.info(`[AgentOrchestration] Terminating session ${sessionId}`);
      proc.kill("SIGTERM");
    }
    this.processes.clear();
    this.sessions.clear();
  }
}
