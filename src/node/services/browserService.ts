/**
 * BrowserService — Per-minion headless browser sessions via agent-browser.
 *
 * Each minion gets an isolated browser instance identified by
 * `--session minion-<id>`. The service manages session lifecycle,
 * subprocess invocation, output parsing, and WebSocket streaming.
 *
 * agent-browser is CLI-only — every action spawns a subprocess:
 *   agent-browser --session <name> <command> [args...]
 *
 * Sessions persist across invocations (Chromium profile is retained
 * by agent-browser's session flag).
 *
 * WebSocket streaming:
 *   When AGENT_BROWSER_STREAM_PORT is set, agent-browser starts a
 *   WebSocket server that streams JPEG frames and accepts mouse/keyboard
 *   input events. The frontend connects directly via ws://localhost:<port>.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs/promises";
import * as net from "net";
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

/** Base port for WebSocket streaming allocation. */
const STREAM_PORT_BASE = 19200;

/** Internal session tracking state. */
interface BrowserSessionState {
  minionId: string;
  sessionName: string;
  currentUrl: string | null;
  createdAt: number;
  /** Allocated WebSocket stream port for live frame streaming. */
  streamPort: number | null;
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
  private readonly allocatedPorts = new Set<number>();
  private resolvedBinaryPath: string | null = null;

  constructor(private readonly config: Config) {}

  // ── Session lifecycle ───────────────────────────────────────────────────

  /**
   * Ensure a session exists for the minion, creating tracking state if needed.
   * agent-browser itself handles session persistence via --session flag,
   * so "creating" a session is just internal bookkeeping + port allocation.
   */
  private async ensureSession(minionId: string): Promise<BrowserSessionState> {
    let session = this.sessions.get(minionId);
    if (!session) {
      const streamPort = await this.allocateStreamPort();
      session = {
        minionId,
        sessionName: `minion-${minionId}`,
        currentUrl: null,
        createdAt: Date.now(),
        streamPort,
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
      await this.execBrowserCommand(session, "close");
    } catch {
      // Best-effort — session may already be closed
    }

    // Release stream port
    if (session.streamPort) {
      this.allocatedPorts.delete(session.streamPort);
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
      streamPort: session.streamPort,
    };
  }

  /** Get the allocated stream port for a minion (null if no session). */
  getStreamPort(minionId: string): number | null {
    return this.sessions.get(minionId)?.streamPort ?? null;
  }

  // ── Browser actions — Core ─────────────────────────────────────────────

  async navigate(minionId: string, url: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const result = await this.execBrowserCommand(session, "open", [url]);
      if (result.success) {
        session.currentUrl = url;
      }
      return result;
    });
  }

  async snapshot(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const result = await this.execBrowserCommand(session, "snapshot", ["-i"]);
      if (result.success) {
        result.snapshot = this.parseSnapshot(result.output, session.currentUrl);
      }
      return result;
    });
  }

  async screenshot(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const tmpDir = path.join(this.config.rootDir, "tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      const screenshotPath = path.join(tmpDir, `screenshot-${minionId}-${Date.now()}.png`);

      const result = await this.execBrowserCommand(session, "screenshot", [
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
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "click", [ref]);
    });
  }

  async fill(minionId: string, ref: string, value: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "fill", [ref, value]);
    });
  }

  async type(minionId: string, text: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "type", [text]);
    });
  }

  async scrollDown(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "scroll", ["down"]);
    });
  }

  async scrollUp(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "scroll", ["up"]);
    });
  }

  async back(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "go", ["back"]);
    });
  }

  async forward(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "go", ["forward"]);
    });
  }

  // ── Browser actions — Phase 3 new commands ─────────────────────────────

  /** Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.). */
  async press(minionId: string, key: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "press", [key]);
    });
  }

  /** Hover over an element by snapshot ref. */
  async hover(minionId: string, ref: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "hover", [ref]);
    });
  }

  /** Semantic locator search + action (find by role/text/label/placeholder/testid). */
  async find(
    minionId: string,
    locator: string,
    value: string,
    action?: string,
    actionValue?: string
  ): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const args = [locator, value];
      if (action) {
        args.push("--action", action);
        if (actionValue) {
          args.push("--value", actionValue);
        }
      }
      return this.execBrowserCommand(session, "find", args);
    });
  }

  /** Wait for a condition: selector visible, text appears, URL matches, or time in ms. */
  async wait(minionId: string, target: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "wait", [target]);
    });
  }

  /** Take an annotated screenshot with numbered labels on interactive elements. */
  async annotatedScreenshot(minionId: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const tmpDir = path.join(this.config.rootDir, "tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      const screenshotPath = path.join(tmpDir, `annotated-${minionId}-${Date.now()}.png`);

      const result = await this.execBrowserCommand(session, "screenshot", [
        "--annotate",
        "--output",
        screenshotPath,
      ]);

      if (result.success) {
        try {
          const data = await fs.readFile(screenshotPath);
          result.annotatedScreenshot = {
            minionId,
            base64: data.toString("base64"),
            url: session.currentUrl ?? "",
            timestamp: Date.now(),
            annotations: this.parseAnnotations(result.output),
          };
          await fs.unlink(screenshotPath).catch(() => {});
        } catch (err) {
          result.success = false;
          result.error = `Failed to read annotated screenshot: ${err}`;
        }
      }

      return result;
    });
  }

  /** Execute JavaScript on the page and return the result. */
  async evalJS(minionId: string, js: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "eval", [js]);
    });
  }

  /** Set the browser viewport dimensions. */
  async setViewport(minionId: string, width: number, height: number): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "viewport", [`${width}x${height}`]);
    });
  }

  /** Emulate a device (iPhone 14, iPad Pro, Pixel 7, etc.). */
  async setDevice(minionId: string, device: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "device", [device]);
    });
  }

  /** Tab management: list, create, switch, close tabs. */
  async tabs(minionId: string, action: string, target?: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const args: string[] = [action];
      if (target) args.push(target);
      return this.execBrowserCommand(session, "tabs", args);
    });
  }

  /** Handle browser dialogs (alert, confirm, prompt, beforeunload). */
  async dialog(minionId: string, action: string, promptText?: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const args: string[] = [action];
      if (promptText) args.push("--text", promptText);
      return this.execBrowserCommand(session, "dialog", args);
    });
  }

  /** Cookie management: list, set, clear. */
  async cookies(
    minionId: string,
    action: string,
    name?: string,
    value?: string,
    domain?: string
  ): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const args: string[] = [action];
      if (name) args.push("--name", name);
      if (value) args.push("--value", value);
      if (domain) args.push("--domain", domain);
      return this.execBrowserCommand(session, "cookies", args);
    });
  }

  /** View tracked network requests. */
  async networkRequests(minionId: string, filter?: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      const args: string[] = [];
      if (filter) args.push("--filter", filter);
      return this.execBrowserCommand(session, "network", args);
    });
  }

  /** Drag and drop from source element to target element. */
  async drag(minionId: string, sourceRef: string, targetRef: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "drag", [sourceRef, targetRef]);
    });
  }

  /** Select an option from a <select> dropdown. */
  async selectOption(minionId: string, ref: string, value: string): Promise<BrowserActionResult> {
    const session = await this.ensureSession(minionId);
    return this.withMutex(minionId, async () => {
      return this.execBrowserCommand(session, "select", [ref, value]);
    });
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  /**
   * Execute an agent-browser CLI command for a given session.
   * Spawns: agent-browser --session <sessionName> <command> [args...]
   *
   * Includes AGENT_BROWSER_STREAM_PORT for WebSocket streaming,
   * --ignore-https-errors for SSL cert issues, and --headed false for headless.
   */
  private async execBrowserCommand(
    session: BrowserSessionState,
    command: string,
    args: string[] = []
  ): Promise<BrowserActionResult> {
    const binaryPath = await this.resolveBinaryPath();

    const fullArgs = [
      "--session", session.sessionName,
      "--headed", "false",
      "--ignore-https-errors",
      "--color-scheme", "dark",
      command,
      ...args,
    ];

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      NO_COLOR: "1",
      AGENT_BROWSER_HEADED: "false",
      AGENT_BROWSER_IGNORE_HTTPS_ERRORS: "1",
    };

    // Enable WebSocket streaming if port is allocated
    if (session.streamPort) {
      env.AGENT_BROWSER_STREAM_PORT = String(session.streamPort);
    }

    try {
      const { stdout, stderr } = await execFileAsync(binaryPath, fullArgs, {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large snapshots
        env,
      });

      if (stderr && stderr.trim()) {
        log.debug(`[browser:${session.sessionName}] stderr: ${stderr.trim()}`);
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
   * Parse annotation labels from annotated screenshot stdout.
   * Expected format: [1] @e3 "Submit button"
   */
  private parseAnnotations(stdout: string): Array<{ ref: string; label: string }> {
    const annotations: Array<{ ref: string; label: string }> = [];
    const lines = stdout.split("\n");

    for (const line of lines) {
      const match = line.trim().match(/^\[(\d+)\]\s+(@e\d+)\s+"([^"]*)"/);
      if (match) {
        annotations.push({
          ref: match[2],
          label: `[${match[1]}] ${match[3]}`,
        });
      }
    }

    return annotations;
  }

  /**
   * Allocate a free port for WebSocket streaming.
   * Starts from STREAM_PORT_BASE and probes until a free port is found.
   */
  private async allocateStreamPort(): Promise<number> {
    let port = STREAM_PORT_BASE;
    while (this.allocatedPorts.has(port) || !(await this.isPortFree(port))) {
      port++;
      if (port > STREAM_PORT_BASE + 200) {
        log.warn("Could not allocate stream port, falling back to null");
        return 0; // Will be treated as null by caller
      }
    }
    this.allocatedPorts.add(port);
    return port;
  }

  /** Check if a TCP port is free. */
  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "127.0.0.1");
    });
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
