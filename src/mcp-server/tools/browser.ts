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
}
