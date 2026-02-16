/**
 * BrowserSessionManager - Manages browser instances per workspace.
 *
 * Each workspace (and sub-agent) can have its own isolated browser session.
 * Sessions are lazily created and automatically cleaned up on workspace close.
 *
 * Two launch strategies (auto-detected):
 *
 * 1. NATIVE CHROME (preferred) — Launches the real system Chrome/Chromium
 *    with --remote-debugging-port, then Playwright connects via CDP.
 *    This is a real, fully native desktop browser — zero bot detection,
 *    real GPU, real WebGL fingerprint, real everything. Perfect for
 *    sites like X, Reddit, LinkedIn that aggressively detect automation.
 *
 * 2. PLAYWRIGHT CHROMIUM (fallback) — If no system Chrome is found,
 *    falls back to Playwright's bundled Chromium with stealth flags.
 *
 * On dedicated Mac Studios each agent gets its own native Chrome window.
 * The user can VNC/screen-share in and interact directly.
 */

import { EventEmitter } from "events";
import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { log } from "@/node/services/log";

// Playwright types - dynamically imported to avoid hard dependency at startup
type PlaywrightBrowser = import("playwright").Browser;
type PlaywrightBrowserContext = import("playwright").BrowserContext;
type PlaywrightPage = import("playwright").Page;

// ── Types ────────────────────────────────────────────────────────────

export interface BrowserSession {
  id: string;
  workspaceId: string;
  browser: PlaywrightBrowser;
  context: PlaywrightBrowserContext;
  pages: Map<string, PlaywrightPage>;
  activePageId: string;
  status: "active" | "closed";
  createdAt: number;
  lastActivity: number;
  /** Whether this session is headless (no visible UI) */
  headless: boolean;
  /** CDP WebSocket endpoint — used to connect the frontend <webview> to the same browser */
  cdpUrl: string | null;
  /** HTTP URL for the page being viewed — frontend can load this in a webview */
  debugUrl: string | null;
  /** Launch mode used for this session */
  launchMode: "native-chrome" | "playwright-chromium";
  /** Child process handle if we spawned native Chrome (needed for cleanup) */
  chromeProcess: ChildProcess | null;
}

export type BrowserActionType =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "screenshot"
  | "read_text"
  | "read_html"
  | "wait"
  | "select"
  | "hover"
  | "go_back"
  | "go_forward"
  | "new_tab"
  | "close_tab"
  | "list_tabs"
  | "switch_tab"
  | "evaluate";

export interface BrowserAction {
  action: BrowserActionType;
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  /** Scroll direction: "up" | "down" | "left" | "right" */
  direction?: string;
  /** Scroll amount in pixels */
  amount?: number;
  /** Wait timeout in ms */
  timeoutMs?: number;
  /** JavaScript code for evaluate action */
  code?: string;
  /** Whether to take a full-page screenshot */
  fullPage?: boolean;
  /** Page/tab ID for tab operations */
  pageId?: string;
  /** Coordinate for click [x, y] */
  coordinate?: [number, number];
}

export interface BrowserActionResult {
  success: true;
  /** The type of content returned */
  contentType: "text" | "html" | "screenshot" | "info";
  /** The content (text, html, base64 png, or info message) */
  content: string;
  /** Current page URL after action */
  url: string;
  /** Current page title */
  title: string;
}

export interface BrowserActionError {
  success: false;
  error: string;
}

/** Snapshot of the browser's visual state — stored per workspace for UI rendering. */
export interface BrowserSnapshot {
  /** Base64-encoded PNG screenshot */
  screenshot: string;
  /** Current page URL */
  url: string;
  /** Current page title */
  title: string;
  /** Timestamp when this snapshot was taken */
  timestamp: number;
  /** The action that triggered this snapshot */
  lastAction: string;
}

// Actions that change the visual state (worth auto-capturing after)
const VISUAL_ACTIONS = new Set<BrowserActionType>([
  "navigate",
  "click",
  "type",
  "scroll",
  "select",
  "hover",
  "go_back",
  "go_forward",
  "new_tab",
  "switch_tab",
  "evaluate",
]);

// ── Chrome Discovery ─────────────────────────────────────────────────

/** Known Chrome/Chromium paths per platform */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/usr/bin/brave-browser",
    "/usr/bin/microsoft-edge",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

/**
 * Find the system Chrome/Chromium binary.
 * Returns the path or null if not found.
 */
function findSystemChrome(): string | null {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Try `which` on  lattice
  if (process.platform !== "win32") {
    try {
      const result = execSync("which google-chrome || which chromium || which chromium-browser", {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (result) return result;
    } catch {
      /* not found */
    }
  }
  return null;
}

// ── Session Manager ──────────────────────────────────────────────────

export class BrowserSessionManager extends EventEmitter {
  private sessions = new Map<string, BrowserSession>();
  private playwright: typeof import("playwright") | null = null;
  private sessionCounter = 0;
  /** Latest visual snapshot per workspace — consumed by the BrowserTab UI */
  private snapshots = new Map<string, BrowserSnapshot>();
  /** Track used debug ports to avoid conflicts */
  private usedPorts = new Set<number>();
  /** Base port for CDP debugging (each session gets a unique port) */
  private static BASE_DEBUG_PORT = 9222;
  /** Cached system Chrome path (null = not checked yet, "" = not found) */
  private systemChromePath: string | null | undefined = undefined;

  /**
   * Lazily import Playwright to avoid loading it at startup.
   */
  private async getPlaywright(): Promise<typeof import("playwright")> {
    if (!this.playwright) {
      try {
        this.playwright = await import("playwright");
      } catch (err) {
        throw new Error("Playwright is not installed. Run: npx playwright install chromium");
      }
    }
    return this.playwright;
  }

  /**
   * Find an available debug port for a new session.
   */
  private getNextDebugPort(): number {
    let port = BrowserSessionManager.BASE_DEBUG_PORT;
    while (this.usedPorts.has(port)) {
      port++;
    }
    this.usedPorts.add(port);
    return port;
  }

  /**
   * Get cached system Chrome path.
   */
  private getSystemChrome(): string | null {
    if (this.systemChromePath === undefined) {
      this.systemChromePath = findSystemChrome();
      if (this.systemChromePath) {
        log.info("[BrowserSessionManager] Found system Chrome", {
          path: this.systemChromePath,
        });
      } else {
        log.info("[BrowserSessionManager] No system Chrome found, will use Playwright Chromium");
      }
    }
    return this.systemChromePath ?? null;
  }

  /**
   * Launch a native Chrome process with remote debugging.
   * Returns the child process and waits for the debug port to be ready.
   */
  private async launchNativeChrome(
    chromePath: string,
    debugPort: number,
    userDataDir: string
  ): Promise<ChildProcess> {
    const args = [
      `--remote-debugging-port=${debugPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      // Don't restore previous session
      "--no-restore-session-state",
      // Start with a blank page
      "about:blank",
    ];

    log.info("[BrowserSessionManager] Launching native Chrome", {
      chromePath,
      debugPort,
      userDataDir,
    });

    const chromeProcess = spawn(chromePath, args, {
      stdio: "ignore",
      detached: false,
    });

    // Wait for the debug port to become available
    const maxWait = 15_000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const resp = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (resp.ok) {
          log.info("[BrowserSessionManager] Native Chrome ready", { debugPort });
          return chromeProcess;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    // Timed out — kill the process
    chromeProcess.kill();
    throw new Error(`Native Chrome failed to start on port ${debugPort} within ${maxWait}ms`);
  }

  /**
   * Create a new browser session for a workspace.
   *
   * Strategy:
   * 1. Try to launch native system Chrome with --remote-debugging-port
   *    then connect Playwright via CDP. This gives a 100% real browser.
   * 2. Fall back to Playwright's bundled Chromium if no system Chrome.
   *
   * On a dedicated Mac Studio each agent gets its own Chrome window.
   */
  async createSession(
    workspaceId: string,
    options?: { headless?: boolean }
  ): Promise<BrowserSession> {
    const pw = await this.getPlaywright();
    const headless = options?.headless ?? false;
    const debugPort = this.getNextDebugPort();
    const chromePath = this.getSystemChrome();

    let browser: PlaywrightBrowser;
    let cdpUrl: string | null = null;
    let debugUrl: string | null = null;
    let launchMode: "native-chrome" | "playwright-chromium";
    let chromeProcess: ChildProcess | null = null;

    if (chromePath && !headless) {
      // ── Strategy 1: Native Chrome ──────────────────────────────
      // Launch the real system Chrome, then connect Playwright via CDP.
      // This is indistinguishable from a human using Chrome.
      try {
        const userDataDir = `/tmp/lattice-browser-${workspaceId}-${Date.now()}`;
        chromeProcess = await this.launchNativeChrome(chromePath, debugPort, userDataDir);

        // Connect Playwright to the running Chrome via CDP
        browser = await pw.chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);

        launchMode = "native-chrome";
        debugUrl = `http://127.0.0.1:${debugPort}`;

        // Fetch the CDP WebSocket URL
        try {
          const resp = await fetch(`${debugUrl}/json/version`);
          if (resp.ok) {
            const info = (await resp.json()) as {
              webSocketDebuggerUrl?: string;
            };
            cdpUrl = info.webSocketDebuggerUrl ?? null;
          }
        } catch {
          /* non-fatal */
        }

        log.info("[BrowserSessionManager] Connected to native Chrome via CDP", {
          debugPort,
          cdpUrl,
        });
      } catch (err) {
        // Native Chrome failed — fall back to Playwright
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          "[BrowserSessionManager] Native Chrome launch failed, falling back to Playwright",
          {
            error: msg,
          }
        );
        chromeProcess = null;
        this.usedPorts.delete(debugPort);
        // Re-acquire port for Playwright fallback
        const fallbackPort = this.getNextDebugPort();
        const result = await this.launchPlaywrightChromium(pw, headless, fallbackPort);
        browser = result.browser;
        cdpUrl = result.cdpUrl;
        debugUrl = result.debugUrl;
        launchMode = "playwright-chromium";
      }
    } else {
      // ── Strategy 2: Playwright Chromium (fallback / headless) ──
      const result = await this.launchPlaywrightChromium(pw, headless, debugPort);
      browser = result.browser;
      cdpUrl = result.cdpUrl;
      debugUrl = result.debugUrl;
      launchMode = "playwright-chromium";
    }

    // Get the default context (native Chrome) or create one (Playwright)
    let context: PlaywrightBrowserContext;
    let page: PlaywrightPage;

    if (launchMode === "native-chrome") {
      // Native Chrome connected via CDP — use the default context
      const contexts = browser.contexts();
      context = contexts[0] ?? (await browser.newContext());
      const pages = context.pages();
      page = pages[0] ?? (await context.newPage());
    } else {
      // Playwright Chromium — create a context with realistic settings
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York",
        screen: { width: 1440, height: 900 },
      });

      // Stealth scripts for Playwright Chromium
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      });

      page = await context.newPage();
    }

    const sessionId = `browser-${workspaceId}-${++this.sessionCounter}`;
    const pageId = `page-0`;

    const session: BrowserSession = {
      id: sessionId,
      workspaceId,
      browser,
      context,
      pages: new Map([[pageId, page]]),
      activePageId: pageId,
      status: "active",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      headless,
      cdpUrl,
      debugUrl,
      launchMode,
      chromeProcess,
    };

    this.sessions.set(sessionId, session);
    log.info("[BrowserSessionManager] Created session", {
      sessionId,
      workspaceId,
      headless,
      debugPort,
      launchMode,
      cdpUrl,
    });
    this.emit("session-created", { sessionId, workspaceId });

    return session;
  }

  /**
   * Fallback: Launch Playwright's bundled Chromium with stealth flags.
   */
  private async launchPlaywrightChromium(
    pw: typeof import("playwright"),
    headless: boolean,
    debugPort: number
  ): Promise<{
    browser: PlaywrightBrowser;
    cdpUrl: string | null;
    debugUrl: string | null;
  }> {
    const browser = await pw.chromium.launch({
      headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        `--remote-debugging-port=${debugPort}`,
        "--remote-allow-origins=*",
        "--disable-blink-features=AutomationControlled",
        "--enable-webgl",
        "--enable-accelerated-2d-canvas",
        "--window-size=1280,800",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    let cdpUrl: string | null = null;
    let debugUrl: string | null = null;
    try {
      const resp = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (resp.ok) {
        const info = (await resp.json()) as { webSocketDebuggerUrl?: string };
        cdpUrl = info.webSocketDebuggerUrl ?? null;
      }
      debugUrl = `http://127.0.0.1:${debugPort}`;
    } catch {
      log.warn("[BrowserSessionManager] Could not fetch CDP info", { debugPort });
    }

    return { browser, cdpUrl, debugUrl };
  }

  /**
   * Get existing session by ID, or null if not found/closed.
   */
  getSession(sessionId: string): BrowserSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "closed") return null;
    return session;
  }

  /**
   * Get or create a session for a workspace.
   * Returns existing active session if one exists, otherwise creates new.
   */
  async getOrCreateSession(
    workspaceId: string,
    options?: { headless?: boolean }
  ): Promise<BrowserSession> {
    // Find existing active session for this workspace
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.status === "active") {
        session.lastActivity = Date.now();
        return session;
      }
    }
    return this.createSession(workspaceId, options);
  }

  /**
   * List all sessions, optionally filtered by workspace.
   */
  listSessions(workspaceId?: string): BrowserSession[] {
    const all = Array.from(this.sessions.values());
    if (workspaceId) {
      return all.filter((s) => s.workspaceId === workspaceId);
    }
    return all;
  }

  /**
   * Get the active page for a session.
   */
  private getActivePage(session: BrowserSession): PlaywrightPage {
    const page = session.pages.get(session.activePageId);
    if (!page) {
      // Fallback to first available page
      const first = session.pages.values().next().value;
      if (!first) throw new Error("No pages available in session");
      return first;
    }
    return page;
  }

  /**
   * Execute a browser action on a session.
   * After visual actions (navigate, click, type, scroll, etc.), automatically
   * captures a screenshot and stores it for the BrowserTab UI to display.
   */
  async executeAction(
    sessionId: string,
    action: BrowserAction
  ): Promise<BrowserActionResult | BrowserActionError> {
    const session = this.getSession(sessionId);
    if (!session) {
      return { success: false, error: `Session ${sessionId} not found or closed` };
    }

    session.lastActivity = Date.now();
    const page = this.getActivePage(session);
    const timeout = action.timeoutMs ?? 30_000;

    const result = await this._executeActionInner(session, page, action, timeout);

    // Auto-capture screenshot after visual actions for the live BrowserTab panel
    if (result.success && VISUAL_ACTIONS.has(action.action)) {
      this.autoCapture(session, page, action.action).catch(() => {
        // Non-fatal: auto-capture is best-effort for the UI
      });
    }
    // If the action itself was a screenshot, store it too
    if (result.success && action.action === "screenshot") {
      this.snapshots.set(session.workspaceId, {
        screenshot: result.content,
        url: result.url,
        title: result.title,
        timestamp: Date.now(),
        lastAction: "screenshot",
      });
      this.emit("snapshot", { workspaceId: session.workspaceId });
    }

    return result;
  }

  /**
   * Auto-capture a screenshot after a visual action.
   */
  private async autoCapture(
    session: BrowserSession,
    page: PlaywrightPage,
    actionName: string
  ): Promise<void> {
    try {
      const buffer = await page.screenshot({ fullPage: false, type: "png" });
      const base64 = buffer.toString("base64");
      const snapshot: BrowserSnapshot = {
        screenshot: base64,
        url: page.url(),
        title: await page.title(),
        timestamp: Date.now(),
        lastAction: actionName,
      };
      this.snapshots.set(session.workspaceId, snapshot);
      this.emit("snapshot", { workspaceId: session.workspaceId });
    } catch {
      // Ignore — page may have closed or navigated during capture
    }
  }

  /**
   * Get the latest snapshot for a workspace (consumed by BrowserTab UI).
   */
  getSnapshot(workspaceId: string): BrowserSnapshot | null {
    return this.snapshots.get(workspaceId) ?? null;
  }

  /**
   * Get the page URL that the active page is currently on.
   * Used by the frontend to show what the agent is browsing.
   */
  getActivePageUrl(workspaceId: string): string | null {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.status === "active") {
        const page = session.pages.get(session.activePageId);
        return page?.url() ?? null;
      }
    }
    return null;
  }

  /**
   * Internal action execution (no auto-capture).
   */
  private async _executeActionInner(
    session: BrowserSession,
    page: PlaywrightPage,
    action: BrowserAction,
    timeout: number
  ): Promise<BrowserActionResult | BrowserActionError> {
    try {
      switch (action.action) {
        case "navigate": {
          if (!action.url) return { success: false, error: "url is required for navigate" };
          await page.goto(action.url, { timeout, waitUntil: "domcontentloaded" });
          return {
            success: true,
            contentType: "info",
            content: `Navigated to ${action.url}`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "click": {
          if (action.coordinate) {
            await page.mouse.click(action.coordinate[0], action.coordinate[1]);
          } else if (action.selector) {
            await page.click(action.selector, { timeout });
          } else {
            return { success: false, error: "selector or coordinate required for click" };
          }
          // Wait briefly for any navigation/rendering
          await page.waitForTimeout(500);
          return {
            success: true,
            contentType: "info",
            content: `Clicked ${action.selector ?? `(${action.coordinate![0]}, ${action.coordinate![1]})`}`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "type": {
          if (!action.text) return { success: false, error: "text is required for type" };
          if (action.selector) {
            await page.fill(action.selector, action.text, { timeout });
          } else {
            // Type into currently focused element
            await page.keyboard.type(action.text);
          }
          return {
            success: true,
            contentType: "info",
            content: `Typed "${action.text.slice(0, 50)}${action.text.length > 50 ? "..." : ""}" into ${action.selector ?? "focused element"}`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "select": {
          if (!action.selector) return { success: false, error: "selector required for select" };
          if (!action.value) return { success: false, error: "value required for select" };
          await page.selectOption(action.selector, action.value, { timeout });
          return {
            success: true,
            contentType: "info",
            content: `Selected "${action.value}" in ${action.selector}`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "hover": {
          if (action.coordinate) {
            await page.mouse.move(action.coordinate[0], action.coordinate[1]);
          } else if (action.selector) {
            await page.hover(action.selector, { timeout });
          } else {
            return { success: false, error: "selector or coordinate required for hover" };
          }
          return {
            success: true,
            contentType: "info",
            content: `Hovered over ${action.selector ?? `(${action.coordinate![0]}, ${action.coordinate![1]})`}`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "scroll": {
          const dir = action.direction ?? "down";
          const amount = action.amount ?? 500;
          const deltaX = dir === "left" ? -amount : dir === "right" ? amount : 0;
          const deltaY = dir === "up" ? -amount : dir === "down" ? amount : 0;
          await page.mouse.wheel(deltaX, deltaY);
          await page.waitForTimeout(300);
          return {
            success: true,
            contentType: "info",
            content: `Scrolled ${dir} by ${amount}px`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "screenshot": {
          // Use JPEG with reduced quality for agent consumption (saves ~80% tokens).
          // Full-quality PNGs are still captured via autoCapture for the UI panel.
          // Quality 30 + JPEG = ~20-40KB vs ~500KB+ for PNG = massive token savings.
          const buffer = await page.screenshot({
            fullPage: action.fullPage ?? false,
            type: "jpeg",
            quality: 30,
          });
          const base64 = buffer.toString("base64");
          return {
            success: true,
            contentType: "screenshot",
            content: base64,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "read_text": {
          let text: string;
          if (action.selector) {
            text = (await page.textContent(action.selector, { timeout })) ?? "";
          } else {
            text = await page.evaluate(() => document.body.innerText);
          }
          // Truncate to avoid token explosion
          if (text.length > 50_000) {
            text = text.slice(0, 50_000) + "\n\n[Content truncated at 50,000 chars]";
          }
          return {
            success: true,
            contentType: "text",
            content: text,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "read_html": {
          let html: string;
          if (action.selector) {
            html = await page.innerHTML(action.selector, { timeout });
          } else {
            html = await page.content();
          }
          if (html.length > 100_000) {
            html = html.slice(0, 100_000) + "\n\n<!-- Content truncated -->";
          }
          return {
            success: true,
            contentType: "html",
            content: html,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "wait": {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout });
            return {
              success: true,
              contentType: "info",
              content: `Element ${action.selector} appeared`,
              url: page.url(),
              title: await page.title(),
            };
          }
          const waitMs = action.timeoutMs ?? 1000;
          await page.waitForTimeout(waitMs);
          return {
            success: true,
            contentType: "info",
            content: `Waited ${waitMs}ms`,
            url: page.url(),
            title: await page.title(),
          };
        }

        case "go_back": {
          await page.goBack({ timeout });
          return {
            success: true,
            contentType: "info",
            content: "Navigated back",
            url: page.url(),
            title: await page.title(),
          };
        }

        case "go_forward": {
          await page.goForward({ timeout });
          return {
            success: true,
            contentType: "info",
            content: "Navigated forward",
            url: page.url(),
            title: await page.title(),
          };
        }

        case "new_tab": {
          const newPage = await session.context.newPage();
          const newPageId = `page-${session.pages.size}`;
          session.pages.set(newPageId, newPage);
          session.activePageId = newPageId;
          if (action.url) {
            await newPage.goto(action.url, { timeout, waitUntil: "domcontentloaded" });
          }
          return {
            success: true,
            contentType: "info",
            content: `Opened new tab ${newPageId}${action.url ? ` at ${action.url}` : ""}`,
            url: newPage.url(),
            title: await newPage.title(),
          };
        }

        case "close_tab": {
          const targetPageId = action.pageId ?? session.activePageId;
          const targetPage = session.pages.get(targetPageId);
          if (!targetPage) {
            return { success: false, error: `Tab ${targetPageId} not found` };
          }
          if (session.pages.size <= 1) {
            return { success: false, error: "Cannot close the last tab" };
          }
          await targetPage.close();
          session.pages.delete(targetPageId);
          // Switch to first remaining page
          if (session.activePageId === targetPageId) {
            session.activePageId = session.pages.keys().next().value!;
          }
          const activePage = this.getActivePage(session);
          return {
            success: true,
            contentType: "info",
            content: `Closed tab ${targetPageId}. Active tab: ${session.activePageId}`,
            url: activePage.url(),
            title: await activePage.title(),
          };
        }

        case "list_tabs": {
          const tabs: string[] = [];
          for (const [id, p] of session.pages) {
            const isActive = id === session.activePageId ? " (active)" : "";
            tabs.push(`${id}${isActive}: ${p.url()}`);
          }
          return {
            success: true,
            contentType: "text",
            content: tabs.join("\n"),
            url: page.url(),
            title: await page.title(),
          };
        }

        case "switch_tab": {
          if (!action.pageId) return { success: false, error: "pageId required for switch_tab" };
          const switchPage = session.pages.get(action.pageId);
          if (!switchPage) {
            return { success: false, error: `Tab ${action.pageId} not found` };
          }
          session.activePageId = action.pageId;
          await switchPage.bringToFront();
          return {
            success: true,
            contentType: "info",
            content: `Switched to tab ${action.pageId}`,
            url: switchPage.url(),
            title: await switchPage.title(),
          };
        }

        case "evaluate": {
          if (!action.code) return { success: false, error: "code required for evaluate" };
          const result = await page.evaluate(action.code);
          const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return {
            success: true,
            contentType: "text",
            content: resultStr ?? "undefined",
            url: page.url(),
            title: await page.title(),
          };
        }

        default:
          return { success: false, error: `Unknown action: ${action.action}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("[BrowserSessionManager] Action failed", {
        sessionId: session.id,
        action: action.action,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  /**
   * Close a browser session and clean up resources.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = "closed";
    // Release debug port
    if (session.debugUrl) {
      try {
        const url = new URL(session.debugUrl);
        this.usedPorts.delete(Number(url.port));
      } catch {
        /* ignore */
      }
    }
    try {
      await session.browser.close();
    } catch {
      // Browser may already be closed
    }
    // Kill native Chrome process if we spawned one
    if (session.chromeProcess) {
      try {
        session.chromeProcess.kill();
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId);
    log.info("[BrowserSessionManager] Closed session", {
      sessionId,
      launchMode: session.launchMode,
    });
    this.emit("session-closed", { sessionId, workspaceId: session.workspaceId });
  }

  /**
   * Close all sessions for a workspace (called on workspace removal).
   */
  async closeWorkspaceSessions(workspaceId: string): Promise<void> {
    const sessions = this.listSessions(workspaceId);
    await Promise.all(sessions.map((s) => this.closeSession(s.id)));
  }

  /**
   * Close all sessions (called on app shutdown).
   */
  async closeAll(): Promise<void> {
    const all = Array.from(this.sessions.keys());
    await Promise.all(all.map((id) => this.closeSession(id)));
  }

  /**
   * Get session info (safe for serialization — no Playwright objects).
   */
  getSessionInfo(sessionId: string): {
    id: string;
    workspaceId: string;
    status: string;
    headless: boolean;
    pageCount: number;
    activePageId: string;
    createdAt: number;
    lastActivity: number;
    cdpUrl: string | null;
    debugUrl: string | null;
    launchMode: string;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      workspaceId: session.workspaceId,
      status: session.status,
      headless: session.headless,
      pageCount: session.pages.size,
      activePageId: session.activePageId,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      cdpUrl: session.cdpUrl,
      debugUrl: session.debugUrl,
      launchMode: session.launchMode,
    };
  }
}
