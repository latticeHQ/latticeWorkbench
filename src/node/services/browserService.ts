/**
 * BrowserService — Per-minion headless browser sessions via agent-browser.
 *
 * Each minion gets an isolated browser instance identified by
 * `--session minion-<id>`. The service manages session lifecycle,
 * subprocess invocation, and output parsing.
 *
 * agent-browser is CLI-only — every action spawns a subprocess:
 *   agent-browser --session <name> <command> [args...]
 *
 * Sessions persist across invocations (Chromium profile is retained
 * by agent-browser's session flag).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import type { Config } from "@/node/config";
import type {
  BrowserActionResult,
  BrowserElementRef,
  BrowserSessionInfo,
  BrowserSnapshot,
} from "@/common/types/browser";
import { log } from "@/node/services/log";

const execFileAsync = promisify(execFile);

/** Default timeout for browser commands (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Internal session tracking state. */
interface BrowserSessionState {
  minionId: string;
  sessionName: string;
  currentUrl: string | null;
  createdAt: number;
}

/**
 * Simple async mutex to serialize concurrent commands per session.
 * Prevents race conditions when an agent fires multiple browser
 * commands simultaneously for the same minion.
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export class BrowserService {
  private readonly sessions = new Map<string, BrowserSessionState>();
  private readonly mutexes = new Map<string, AsyncMutex>();
  private resolvedBinaryPath: string | null = null;

  constructor(private readonly config: Config) {}

  // ── Session lifecycle ───────────────────────────────────────────────────

  /**
   * Ensure a session exists for the minion, creating tracking state if needed.
   * agent-browser itself handles session persistence via --session flag,
   * so "creating" a session is just internal bookkeeping.
   */
  private ensureSession(minionId: string): BrowserSessionState {
    let session = this.sessions.get(minionId);
    if (!session) {
      session = {
        minionId,
        sessionName: `minion-${minionId}`,
        currentUrl: null,
        createdAt: Date.now(),
      };
      this.sessions.set(minionId, session);
    }
    return session;
  }

  /** Close a minion's browser session and clean up tracking state. */
  async closeSession(minionId: string): Promise<void> {
    const session = this.sessions.get(minionId);
    if (!session) return;

    try {
      // Attempt to close the browser gracefully
      await this.execBrowserCommand(session.sessionName, "close");
    } catch {
      // Best-effort — session may already be closed
    }

    this.sessions.delete(minionId);
    this.mutexes.delete(minionId);
  }

  /** Close all browser sessions for a minion (called on minion removal/archive). */
  closeMinionSessions(minionId: string): void {
    if (this.sessions.has(minionId)) {
      // Fire-and-forget close
      this.closeSession(minionId).catch((err) => {
        log.warn(`Failed to close browser session for minion ${minionId}:`, err);
      });
    }
  }

  /** Close all browser sessions (called on app dispose). */
  closeAllSessions(): void {
    for (const minionId of this.sessions.keys()) {
      this.closeMinionSessions(minionId);
    }
  }

  /** Get session info for a minion (returns null if no active session). */
  getSessionInfo(minionId: string): BrowserSessionInfo | null {
    const session = this.sessions.get(minionId);
    if (!session) return null;
    return {
      minionId: session.minionId,
      sessionName: session.sessionName,
      url: session.currentUrl,
      isActive: true,
    };
  }

  // ── Browser actions ─────────────────────────────────────────────────────

  async navigate(minionId: string, url: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const result = await this.execBrowserCommand(session.sessionName, "open", [url]);
      if (result.success) {
        session.currentUrl = url;
      }
      return result;
    });
  }

  async snapshot(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const result = await this.execBrowserCommand(session.sessionName, "snapshot", ["-i"]);
      if (result.success) {
        result.snapshot = this.parseSnapshot(result.output, session.currentUrl);
      }
      return result;
    });
  }

  async screenshot(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      // agent-browser screenshot writes to stdout or a file.
      // Use --format base64 if supported, otherwise read from temp file.
      const tmpDir = path.join(this.config.rootDir, "tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      const screenshotPath = path.join(tmpDir, `screenshot-${minionId}-${Date.now()}.png`);

      const result = await this.execBrowserCommand(session.sessionName, "screenshot", [
        "--output",
        screenshotPath,
      ]);

      if (result.success) {
        try {
          const data = await fs.readFile(screenshotPath);
          result.screenshot = {
            minionId,
            base64: data.toString("base64"),
            url: session.currentUrl ?? "",
            timestamp: Date.now(),
          };
          // Clean up temp file
          await fs.unlink(screenshotPath).catch(() => {});
        } catch (err) {
          result.success = false;
          result.error = `Failed to read screenshot file: ${err}`;
        }
      }

      return result;
    });
  }

  async click(minionId: string, ref: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "click", [ref]);
    });
  }

  async fill(minionId: string, ref: string, value: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "fill", [ref, value]);
    });
  }

  async type(minionId: string, text: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "type", [text]);
    });
  }

  async scrollDown(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "scroll", ["down"]);
    });
  }

  async scrollUp(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "scroll", ["up"]);
    });
  }

  async back(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "go", ["back"]);
    });
  }

  async forward(minionId: string): Promise<BrowserActionResult> {
    const session = this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session.sessionName, "go", ["forward"]);
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Execute an agent-browser CLI command for a given session.
   * Spawns: agent-browser --session <sessionName> <command> [args...]
   */
  private async execBrowserCommand(
    sessionName: string,
    command: string,
    args: string[] = []
  ): Promise<BrowserActionResult> {
    const binaryPath = await this.resolveBinaryPath();

    const fullArgs = ["--session", sessionName, command, ...args];

    try {
      const { stdout, stderr } = await execFileAsync(binaryPath, fullArgs, {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large snapshots
        env: { ...process.env, NO_COLOR: "1" },
      });

      if (stderr && stderr.trim()) {
        log.debug(`[browser:${sessionName}] stderr: ${stderr.trim()}`);
      }

      return {
        success: true,
        output: stdout,
      };
    } catch (err: unknown) {
      const error = err as Error & { stdout?: string; stderr?: string; code?: string };

      // Timeout
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" || error.message?.includes("TIMEOUT")) {
        return {
          success: false,
          output: error.stdout ?? "",
          error: `Browser command timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        };
      }

      // Command failed but may have partial output
      return {
        success: false,
        output: error.stdout ?? "",
        error: error.stderr?.trim() || error.message || "Unknown browser command error",
      };
    }
  }

  /**
   * Parse the accessibility tree output from `snapshot -i`.
   *
   * Expected format (each line):
   *   @e1 [role] "name"
   *   @e2 [role] "name" value="current value"
   */
  private parseSnapshot(stdout: string, currentUrl: string | null): BrowserSnapshot {
    const elements: BrowserElementRef[] = [];
    const lines = stdout.split("\n");

    // Extract title and URL from header lines if present
    let url = currentUrl ?? "";
    let title = "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Parse URL line: url: https://...
      if (trimmed.startsWith("url:")) {
        url = trimmed.slice(4).trim();
        continue;
      }

      // Parse title line: title: ...
      if (trimmed.startsWith("title:")) {
        title = trimmed.slice(6).trim();
        continue;
      }

      // Parse element ref lines: @e1 [role] "name" value="..."
      const refMatch = trimmed.match(/^(@e\d+)\s+\[([^\]]+)\]\s+"([^"]*)"(?:\s+value="([^"]*)")?/);
      if (refMatch) {
        const element: BrowserElementRef = {
          ref: refMatch[1],
          role: refMatch[2],
          name: refMatch[3],
        };
        if (refMatch[4] !== undefined) {
          element.value = refMatch[4];
        }
        elements.push(element);
      }
    }

    return { url, title, elements, raw: stdout };
  }

  /**
   * Resolve the agent-browser binary path.
   * Checks: global install → local node_modules → npx fallback.
   */
  private async resolveBinaryPath(): Promise<string> {
    if (this.resolvedBinaryPath) return this.resolvedBinaryPath;

    // Check if agent-browser is globally available
    try {
      const { stdout } = await execFileAsync("which", ["agent-browser"], { timeout: 5_000 });
      const globalPath = stdout.trim();
      if (globalPath) {
        this.resolvedBinaryPath = globalPath;
        return globalPath;
      }
    } catch {
      // Not globally installed
    }

    // Check local node_modules
    const localBin = path.resolve(__dirname, "../../../node_modules/.bin/agent-browser");
    try {
      await fs.access(localBin, fs.constants.X_OK);
      this.resolvedBinaryPath = localBin;
      return localBin;
    } catch {
      // Not in local node_modules
    }

    // Fallback to npx (will auto-download if needed)
    this.resolvedBinaryPath = "npx";
    return "npx";
  }

  /** Get or create a mutex for serializing commands per minion. */
  private getMutex(minionId: string): AsyncMutex {
    let mutex = this.mutexes.get(minionId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.mutexes.set(minionId, mutex);
    }
    return mutex;
  }

  /** Execute a function while holding the per-minion mutex. */
  private async withMutex<T>(minionId: string, fn: () => Promise<T>): Promise<T> {
    const mutex = this.getMutex(minionId);
    await mutex.acquire();
    try {
      return await fn();
    } finally {
      mutex.release();
    }
  }
}
