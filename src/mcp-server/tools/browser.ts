/**
 * Browser tools: per-minion headless browser via agent-browser.
 *
 * Each minion gets an isolated browser session. The snapshot-refs pattern
 * lets agents interact with pages via accessibility tree references (@e1, @e2).
 *
 * Core workflow: browser_navigate → browser_snapshot → browser_click/fill → repeat.
 *
 * Full feature set from agent-browser:
 * - Snapshot-refs interaction (click, fill, hover, select, drag)
 * - Keyboard input (type, press)
 * - Screenshots (plain + annotated with numbered labels)
 * - JavaScript evaluation
 * - Viewport/device emulation
 * - Tab management
 * - Dialog handling
 * - Cookie management
 * - Network request tracking
 * - Semantic find (by role/text/label)
 * - Wait for conditions
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerBrowserTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Navigate ────────────────────────────────────────────────────────────
  server.tool(
    "browser_navigate",
    "Navigate a minion's browser to a URL. Creates a browser session if one doesn't exist. " +
      "Each minion has its own isolated browser with independent cookies and state.",
    {
      minionId: z.string().describe("The minion ID"),
      url: z.string().describe("URL to navigate to"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.navigate({
          minionId: params.minionId,
          url: params.url,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Snapshot ─────────────────────────────────────────────────────────────
  server.tool(
    "browser_snapshot",
    "Get an accessibility tree snapshot of the current page with element " +
      "refs (@e1, @e2, etc.) that can be used with browser_click and browser_fill. " +
      "This is the primary way for agents to understand page structure.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.snapshot({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Screenshot ───────────────────────────────────────────────────────────
  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current page. Returns base64-encoded PNG.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.screenshot({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Annotated Screenshot ─────────────────────────────────────────────────
  server.tool(
    "browser_annotated_screenshot",
    "Take a screenshot with numbered labels overlaid on interactive elements. " +
      "Returns the image plus a list of annotations mapping numbers to element refs. " +
      "Useful for visual debugging and understanding page layout.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.annotatedScreenshot({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Click ────────────────────────────────────────────────────────────────
  server.tool(
    "browser_click",
    "Click an element identified by its snapshot ref (e.g., '@e2'). " +
      "Get refs from browser_snapshot first.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Element reference from snapshot (e.g., '@e2')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.click({
          minionId: params.minionId,
          ref: params.ref,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Fill ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_fill",
    "Fill a form field identified by its snapshot ref with a value. " +
      "Clears existing content before filling.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Element reference from snapshot (e.g., '@e3')"),
      value: z.string().describe("Value to fill into the element"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.fill({
          minionId: params.minionId,
          ref: params.ref,
          value: params.value,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Type ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_type",
    "Type text into the currently focused element. Unlike fill, this appends text " +
      "and fires keyboard events for each character.",
    {
      minionId: z.string().describe("The minion ID"),
      text: z.string().describe("Text to type"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.type({
          minionId: params.minionId,
          text: params.text,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Press ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_press",
    "Press a keyboard key or key combination. Supports Enter, Tab, Escape, " +
      "ArrowUp/Down/Left/Right, Backspace, Delete, and modifiers like Control+A, " +
      "Meta+C, Shift+Tab, etc.",
    {
      minionId: z.string().describe("The minion ID"),
      key: z.string().describe("Key to press (e.g., 'Enter', 'Tab', 'Control+A', 'Meta+V')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.press({
          minionId: params.minionId,
          key: params.key,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Hover ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_hover",
    "Hover over an element by its snapshot ref. Useful for revealing tooltips, " +
      "dropdown menus, or triggering hover states.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Element reference from snapshot (e.g., '@e5')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.hover({
          minionId: params.minionId,
          ref: params.ref,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Scroll ────────────────────────────────────────────────────────────────
  server.tool(
    "browser_scroll",
    "Scroll the page up or down.",
    {
      minionId: z.string().describe("The minion ID"),
      direction: z
        .enum(["up", "down"])
        .describe("Scroll direction"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result =
          params.direction === "up"
            ? await client.browser.scrollUp({ minionId: params.minionId })
            : await client.browser.scrollDown({ minionId: params.minionId });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Find ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_find",
    "Find an element using semantic locators (by role, text, label, placeholder, or testid) " +
      "and optionally perform an action on it. More resilient than snapshot refs for " +
      "elements that may change position.",
    {
      minionId: z.string().describe("The minion ID"),
      locator: z.string().describe("Locator type: role, text, label, placeholder, testid"),
      value: z.string().describe("Value to match against the locator"),
      action: z.string().optional().describe("Action to perform: click, fill, check, hover, etc."),
      actionValue: z.string().optional().describe("Value for the action (e.g., text to fill)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.find({
          minionId: params.minionId,
          locator: params.locator,
          value: params.value,
          action: params.action,
          actionValue: params.actionValue,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Wait ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_wait",
    "Wait for a condition before proceeding. Can wait for: a CSS selector to appear, " +
      "specific text on the page, a URL pattern, or a fixed time in milliseconds.",
    {
      minionId: z.string().describe("The minion ID"),
      target: z.string().describe("What to wait for: CSS selector, text, URL pattern, or time in ms"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.wait({
          minionId: params.minionId,
          target: params.target,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Eval ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_eval",
    "Execute JavaScript in the page context and return the result. " +
      "Useful for reading page state, extracting data, or performing actions " +
      "not covered by other tools.",
    {
      minionId: z.string().describe("The minion ID"),
      js: z.string().describe("JavaScript expression to evaluate in the page context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.eval({
          minionId: params.minionId,
          js: params.js,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Viewport ──────────────────────────────────────────────────────────
  server.tool(
    "browser_set_viewport",
    "Set the browser viewport dimensions. Useful for testing responsive layouts.",
    {
      minionId: z.string().describe("The minion ID"),
      width: z.number().describe("Viewport width in pixels"),
      height: z.number().describe("Viewport height in pixels"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setViewport({
          minionId: params.minionId,
          width: params.width,
          height: params.height,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Device ────────────────────────────────────────────────────────────
  server.tool(
    "browser_set_device",
    "Emulate a specific device with proper viewport, user agent, and device scale factor. " +
      "Supports common devices like 'iPhone 14', 'iPad Pro', 'Pixel 7', etc.",
    {
      minionId: z.string().describe("The minion ID"),
      device: z.string().describe("Device name (e.g., 'iPhone 14', 'iPad Pro', 'Pixel 7')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setDevice({
          minionId: params.minionId,
          device: params.device,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Tabs ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_tabs",
    "Manage browser tabs: list all open tabs, create a new tab, switch to a tab, or close a tab.",
    {
      minionId: z.string().describe("The minion ID"),
      action: z.enum(["list", "new", "switch", "close"]).default("list")
        .describe("Tab action to perform"),
      target: z.string().optional().describe("Tab index or URL (for switch/new)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.tabs({
          minionId: params.minionId,
          action: params.action,
          target: params.target,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Dialog ────────────────────────────────────────────────────────────────
  server.tool(
    "browser_dialog",
    "Handle browser dialogs (alert, confirm, prompt, beforeunload). " +
      "Accept or dismiss the dialog, optionally providing text for prompt dialogs.",
    {
      minionId: z.string().describe("The minion ID"),
      action: z.enum(["accept", "dismiss"]).describe("Whether to accept or dismiss the dialog"),
      promptText: z.string().optional().describe("Text to enter for prompt dialogs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.dialog({
          minionId: params.minionId,
          action: params.action,
          promptText: params.promptText,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Cookies ───────────────────────────────────────────────────────────────
  server.tool(
    "browser_cookies",
    "Manage browser cookies: list all cookies, set a new cookie, or clear cookies.",
    {
      minionId: z.string().describe("The minion ID"),
      action: z.enum(["list", "set", "clear"]).default("list")
        .describe("Cookie action to perform"),
      name: z.string().optional().describe("Cookie name (for set)"),
      value: z.string().optional().describe("Cookie value (for set)"),
      domain: z.string().optional().describe("Cookie domain (for set)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.cookies({
          minionId: params.minionId,
          action: params.action,
          name: params.name,
          value: params.value,
          domain: params.domain,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Network Requests ──────────────────────────────────────────────────────
  server.tool(
    "browser_network_requests",
    "View tracked network requests. Useful for debugging API calls, " +
      "monitoring network activity, or understanding what requests a page makes.",
    {
      minionId: z.string().describe("The minion ID"),
      filter: z.string().optional().describe("URL pattern to filter requests"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.networkRequests({
          minionId: params.minionId,
          filter: params.filter,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Drag ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_drag",
    "Drag and drop from one element to another using snapshot refs.",
    {
      minionId: z.string().describe("The minion ID"),
      sourceRef: z.string().describe("Source element reference (e.g., '@e3')"),
      targetRef: z.string().describe("Target element reference (e.g., '@e7')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.drag({
          minionId: params.minionId,
          sourceRef: params.sourceRef,
          targetRef: params.targetRef,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Select Option ─────────────────────────────────────────────────────────
  server.tool(
    "browser_select_option",
    "Select an option from a <select> dropdown by its snapshot ref. " +
      "Matches by option value or visible text.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Select element reference (e.g., '@e4')"),
      value: z.string().describe("Option value or label to select"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.selectOption({
          minionId: params.minionId,
          ref: params.ref,
          value: params.value,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Back ──────────────────────────────────────────────────────────────────
  server.tool(
    "browser_back",
    "Navigate browser history back.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.back({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Forward ───────────────────────────────────────────────────────────────
  server.tool(
    "browser_forward",
    "Navigate browser history forward.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.forward({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Close ─────────────────────────────────────────────────────────────────
  server.tool(
    "browser_close",
    "Close a minion's browser session and release resources.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.browser.close({ minionId: params.minionId });
        return {
          content: [jsonContent({ message: "Browser session closed" })],
        };
      })
  );

  // ── Session Info ──────────────────────────────────────────────────────────
  server.tool(
    "browser_session_info",
    "Get information about a minion's browser session (URL, status, stream port).",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const info = await client.browser.sessionInfo({
          minionId: params.minionId,
        });
        return { content: [jsonContent(info)] };
      })
  );

  // ── Phase 4: Full-strength agent-browser tools ──────────────────────

  // ── Save State ─────────────────────────────────────────────────────────
  server.tool(
    "browser_save_state",
    "Save a minion's browser session state (cookies, localStorage, sessionStorage) to a file. " +
      "Supports AES-256-GCM encryption for secure state persistence across restarts.",
    {
      minionId: z.string().describe("The minion ID"),
      path: z.string().optional().describe("File path to save state to (auto-generated if omitted)"),
      encrypt: z.boolean().optional().describe("Encrypt state file with AES-256-GCM"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.saveState({
          minionId: params.minionId,
          path: params.path,
          encrypt: params.encrypt,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Restore State ──────────────────────────────────────────────────────
  server.tool(
    "browser_restore_state",
    "Restore a minion's previously saved browser session state " +
      "(cookies, localStorage, sessionStorage) from a file.",
    {
      minionId: z.string().describe("The minion ID"),
      path: z.string().optional().describe("File path to restore state from"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.restoreState({
          minionId: params.minionId,
          path: params.path,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Storage ────────────────────────────────────────────────────────────
  server.tool(
    "browser_storage",
    "Manage localStorage or sessionStorage: get, set, remove, clear, or list keys. " +
      "Provides direct access without JavaScript eval.",
    {
      minionId: z.string().describe("The minion ID"),
      storageType: z.enum(["local", "session"]).describe("Storage type"),
      action: z.enum(["get", "set", "remove", "clear", "keys"]).describe("Storage operation"),
      key: z.string().optional().describe("Storage key (for get/set/remove)"),
      value: z.string().optional().describe("Value to set"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.storage({
          minionId: params.minionId,
          storageType: params.storageType,
          action: params.action,
          key: params.key,
          value: params.value,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Snapshot Diff ──────────────────────────────────────────────────────
  server.tool(
    "browser_snapshot_diff",
    "Compare current page snapshot with the previous one to detect DOM changes. " +
      "Shows added, removed, and modified elements. Call twice: once for baseline, once after changes.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.snapshotDiff({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Screenshot Diff ────────────────────────────────────────────────────
  server.tool(
    "browser_screenshot_diff",
    "Compare current screenshot with the previous one to visually detect page changes.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.screenshotDiff({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Screenshot Element ─────────────────────────────────────────────────
  server.tool(
    "browser_screenshot_element",
    "Take a screenshot of a specific element by its snapshot ref. Returns base64-encoded PNG.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Element reference from snapshot (e.g., '@e5')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.screenshotElement({
          minionId: params.minionId,
          ref: params.ref,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── PDF ────────────────────────────────────────────────────────────────
  server.tool(
    "browser_pdf",
    "Print the current page to PDF. Returns base64-encoded PDF data.",
    {
      minionId: z.string().describe("The minion ID"),
      landscape: z.boolean().optional().describe("Landscape orientation"),
      format: z.string().optional().describe("Page format: A4, Letter, Legal, Tabloid"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.pdf({
          minionId: params.minionId,
          landscape: params.landscape,
          format: params.format,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Console Logs ───────────────────────────────────────────────────────
  server.tool(
    "browser_console_logs",
    "Get browser console output (console.log, error, warn, info). " +
      "Essential for debugging JavaScript errors and monitoring API responses.",
    {
      minionId: z.string().describe("The minion ID"),
      level: z.string().optional().describe("Filter by level: log, warn, error, info"),
      clear: z.boolean().optional().describe("Clear logs after reading"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.consoleLogs({
          minionId: params.minionId,
          level: params.level,
          clear: params.clear,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Geolocation ────────────────────────────────────────────────────
  server.tool(
    "browser_set_geolocation",
    "Set the browser's geolocation for testing location-dependent features.",
    {
      minionId: z.string().describe("The minion ID"),
      latitude: z.number().describe("Latitude (-90 to 90)"),
      longitude: z.number().describe("Longitude (-180 to 180)"),
      accuracy: z.number().optional().describe("Accuracy in meters"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setGeolocation({
          minionId: params.minionId,
          latitude: params.latitude,
          longitude: params.longitude,
          accuracy: params.accuracy,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Permissions ────────────────────────────────────────────────────
  server.tool(
    "browser_set_permissions",
    "Set browser permissions (geolocation, notifications, camera, microphone, " +
      "clipboard-read, clipboard-write, etc.).",
    {
      minionId: z.string().describe("The minion ID"),
      permission: z.string().describe("Permission name"),
      state: z.enum(["grant", "deny", "prompt"]).describe("Permission state"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setPermissions({
          minionId: params.minionId,
          permission: params.permission,
          state: params.state,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Offline ────────────────────────────────────────────────────────
  server.tool(
    "browser_set_offline",
    "Toggle offline mode to simulate network disconnection. " +
      "Useful for testing offline-first behavior and service workers.",
    {
      minionId: z.string().describe("The minion ID"),
      offline: z.boolean().describe("Whether to enable offline mode"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setOffline({
          minionId: params.minionId,
          offline: params.offline,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Set Headers ────────────────────────────────────────────────────────
  server.tool(
    "browser_set_headers",
    "Set custom HTTP headers for all subsequent browser requests. " +
      "Useful for auth tokens, API keys, accept-language, etc.",
    {
      minionId: z.string().describe("The minion ID"),
      headers: z.record(z.string(), z.string()).describe("Header name-value pairs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.setHeaders({
          minionId: params.minionId,
          headers: params.headers,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Intercept Network ──────────────────────────────────────────────────
  server.tool(
    "browser_intercept_network",
    "Intercept network requests matching a URL pattern. " +
      "Can block, modify response, or log matching requests. " +
      "Useful for mocking APIs, blocking tracking, or monitoring endpoints.",
    {
      minionId: z.string().describe("The minion ID"),
      pattern: z.string().describe("URL pattern to intercept (e.g., '**/api/**')"),
      action: z.enum(["block", "modify", "log"]).describe("Action for matched requests"),
      modifyResponse: z.string().optional().describe("JSON response body for modify action"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.interceptNetwork({
          minionId: params.minionId,
          pattern: params.pattern,
          action: params.action,
          modifyResponse: params.modifyResponse,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Start Recording ────────────────────────────────────────────────────
  server.tool(
    "browser_start_recording",
    "Start recording the browser session for replay or debugging.",
    {
      minionId: z.string().describe("The minion ID"),
      outputPath: z.string().optional().describe("Path to save recording"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.startRecording({
          minionId: params.minionId,
          outputPath: params.outputPath,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Stop Recording ─────────────────────────────────────────────────────
  server.tool(
    "browser_stop_recording",
    "Stop recording the browser session and save the recording.",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.stopRecording({
          minionId: params.minionId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Connect Provider ───────────────────────────────────────────────────
  server.tool(
    "browser_connect_provider",
    "Connect to a cloud browser provider (Browserbase, Browserless, Browser Use, or Kernel). " +
      "Subsequent browser commands will use the cloud browser instead of local Chrome.",
    {
      minionId: z.string().describe("The minion ID"),
      provider: z.enum(["browserbase", "browserless", "browseruse", "kernel"]).describe("Provider name"),
      apiKey: z.string().describe("API key for the provider"),
      endpoint: z.string().optional().describe("Custom API endpoint URL"),
      projectId: z.string().optional().describe("Project ID (for Browserbase)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.connectProvider({
          minionId: params.minionId,
          provider: {
            provider: params.provider,
            apiKey: params.apiKey,
            endpoint: params.endpoint,
            projectId: params.projectId,
          },
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── List Sessions ──────────────────────────────────────────────────────
  server.tool(
    "browser_list_sessions",
    "List all active browser sessions across all minions.",
    {},
    () =>
      withErrorHandling(async () => {
        const sessions = await client.browser.listSessions({});
        return { content: [jsonContent(sessions)] };
      })
  );

  // ── Configure Session ──────────────────────────────────────────────────
  server.tool(
    "browser_configure_session",
    "Configure session-specific browser settings: headed mode, proxy, " +
      "user agent, color scheme, command timeout.",
    {
      minionId: z.string().describe("The minion ID"),
      headed: z.boolean().optional().describe("Run browser with visible window"),
      colorScheme: z.enum(["dark", "light", "no-preference"]).optional().describe("Color scheme"),
      proxy: z.string().optional().describe("Proxy URL"),
      userAgent: z.string().optional().describe("Custom user agent"),
      timeout: z.number().optional().describe("Command timeout in ms"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.configureSession({
          minionId: params.minionId,
          config: {
            headed: params.headed,
            colorScheme: params.colorScheme,
            proxy: params.proxy,
            userAgent: params.userAgent,
            timeout: params.timeout,
          },
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Delete Cookies ─────────────────────────────────────────────────────
  server.tool(
    "browser_delete_cookies",
    "Delete specific cookies by name, optionally filtered by domain.",
    {
      minionId: z.string().describe("The minion ID"),
      name: z.string().describe("Cookie name to delete"),
      domain: z.string().optional().describe("Cookie domain filter"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.deleteCookies({
          minionId: params.minionId,
          name: params.name,
          domain: params.domain,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Scroll To Element ──────────────────────────────────────────────────
  server.tool(
    "browser_scroll_to_element",
    "Scroll to bring a specific element into view by its snapshot ref.",
    {
      minionId: z.string().describe("The minion ID"),
      ref: z.string().describe("Element ref to scroll to (e.g., '@e12')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.scrollToElement({
          minionId: params.minionId,
          ref: params.ref,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Scroll By Pixels ───────────────────────────────────────────────────
  server.tool(
    "browser_scroll_by_pixels",
    "Scroll by a specific number of pixels in any direction (up, down, left, right).",
    {
      minionId: z.string().describe("The minion ID"),
      direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
      pixels: z.number().describe("Number of pixels to scroll"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.browser.scrollByPixels({
          minionId: params.minionId,
          direction: params.direction,
          pixels: params.pixels,
        });
        return { content: [jsonContent(result)] };
      })
  );
}
