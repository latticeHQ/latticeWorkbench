/**
 * Browser tools — Per-minion headless browser via agent-browser.
 *
 * Each tool delegates to BrowserService which manages isolated browser
 * sessions (one per minion). The tools are thin wrappers that validate
 * input, call the service, and return structured results.
 *
 * These are *internal* agent tools (registered in getToolsForModel),
 * distinct from the external MCP tools in src/mcp-server/tools/browser.ts.
 */

import { tool } from "ai";
import type { ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import type { BrowserService } from "@/node/services/browserService";
import type { BrowserActionResult } from "@/common/types/browser";

// ── Helpers ─────────────────────────────────────────────────────────────────

function noBrowser(): BrowserActionResult {
  return {
    success: false,
    output: "Browser service is not available. Ensure the minion has browser support enabled.",
  };
}

function noMinion(): BrowserActionResult {
  return {
    success: false,
    output: "No minionId in tool configuration — browser tools require a minion context.",
  };
}

/** Shortcut to get minionId + browserService or return an error result. */
function getCtx(config: { minionId?: string; browserService?: BrowserService }):
  | { minionId: string; browser: BrowserService }
  | { error: BrowserActionResult } {
  if (!config.browserService) return { error: noBrowser() };
  if (!config.minionId) return { error: noMinion() };
  return { minionId: config.minionId, browser: config.browserService };
}

// ── Tool factories ──────────────────────────────────────────────────────────

export const createBrowserNavigateTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_navigate.description,
    inputSchema: TOOL_DEFINITIONS.browser_navigate.schema,
    execute: async ({ url }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.navigate(ctx.minionId, url);
    },
  });

export const createBrowserSnapshotTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_snapshot.description,
    inputSchema: TOOL_DEFINITIONS.browser_snapshot.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.snapshot(ctx.minionId);
    },
  });

export const createBrowserScreenshotTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_screenshot.description,
    inputSchema: TOOL_DEFINITIONS.browser_screenshot.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.screenshot(ctx.minionId);
    },
  });

export const createBrowserAnnotatedScreenshotTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_annotated_screenshot.description,
    inputSchema: TOOL_DEFINITIONS.browser_annotated_screenshot.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.annotatedScreenshot(ctx.minionId);
    },
  });

export const createBrowserClickTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_click.description,
    inputSchema: TOOL_DEFINITIONS.browser_click.schema,
    execute: async ({ ref }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.click(ctx.minionId, ref);
    },
  });

export const createBrowserFillTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_fill.description,
    inputSchema: TOOL_DEFINITIONS.browser_fill.schema,
    execute: async ({ ref, value }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.fill(ctx.minionId, ref, value);
    },
  });

export const createBrowserTypeTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_type.description,
    inputSchema: TOOL_DEFINITIONS.browser_type.schema,
    execute: async ({ text }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.type(ctx.minionId, text);
    },
  });

export const createBrowserPressTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_press.description,
    inputSchema: TOOL_DEFINITIONS.browser_press.schema,
    execute: async ({ key }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.press(ctx.minionId, key);
    },
  });

export const createBrowserHoverTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_hover.description,
    inputSchema: TOOL_DEFINITIONS.browser_hover.schema,
    execute: async ({ ref }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.hover(ctx.minionId, ref);
    },
  });

export const createBrowserScrollTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_scroll.description,
    inputSchema: TOOL_DEFINITIONS.browser_scroll.schema,
    execute: async ({ direction }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return direction === "up"
        ? ctx.browser.scrollUp(ctx.minionId)
        : ctx.browser.scrollDown(ctx.minionId);
    },
  });

export const createBrowserFindTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_find.description,
    inputSchema: TOOL_DEFINITIONS.browser_find.schema,
    execute: async ({ locator, value, action, actionValue }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.find(
        ctx.minionId,
        locator,
        value,
        action ?? undefined,
        actionValue ?? undefined
      );
    },
  });

export const createBrowserWaitTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_wait.description,
    inputSchema: TOOL_DEFINITIONS.browser_wait.schema,
    execute: async ({ target }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.wait(ctx.minionId, target);
    },
  });

export const createBrowserEvalTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_eval.description,
    inputSchema: TOOL_DEFINITIONS.browser_eval.schema,
    execute: async ({ js }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.evalJS(ctx.minionId, js);
    },
  });

export const createBrowserSetViewportTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_viewport.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_viewport.schema,
    execute: async ({ width, height }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setViewport(ctx.minionId, width, height);
    },
  });

export const createBrowserSetDeviceTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_device.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_device.schema,
    execute: async ({ device }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setDevice(ctx.minionId, device);
    },
  });

export const createBrowserTabsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_tabs.description,
    inputSchema: TOOL_DEFINITIONS.browser_tabs.schema,
    execute: async ({ action, target }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.tabs(ctx.minionId, action, target ?? undefined);
    },
  });

export const createBrowserDialogTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_dialog.description,
    inputSchema: TOOL_DEFINITIONS.browser_dialog.schema,
    execute: async ({ action, promptText }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.dialog(ctx.minionId, action, promptText ?? undefined);
    },
  });

export const createBrowserCookiesTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_cookies.description,
    inputSchema: TOOL_DEFINITIONS.browser_cookies.schema,
    execute: async ({ action, name, value, domain }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.cookies(
        ctx.minionId,
        action,
        name ?? undefined,
        value ?? undefined,
        domain ?? undefined
      );
    },
  });

export const createBrowserNetworkRequestsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_network_requests.description,
    inputSchema: TOOL_DEFINITIONS.browser_network_requests.schema,
    execute: async ({ filter }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.networkRequests(ctx.minionId, filter ?? undefined);
    },
  });

export const createBrowserDragTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_drag.description,
    inputSchema: TOOL_DEFINITIONS.browser_drag.schema,
    execute: async ({ sourceRef, targetRef }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.drag(ctx.minionId, sourceRef, targetRef);
    },
  });

export const createBrowserSelectOptionTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_select_option.description,
    inputSchema: TOOL_DEFINITIONS.browser_select_option.schema,
    execute: async ({ ref, value }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.selectOption(ctx.minionId, ref, value);
    },
  });

export const createBrowserBackTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_back.description,
    inputSchema: TOOL_DEFINITIONS.browser_back.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.back(ctx.minionId);
    },
  });

export const createBrowserForwardTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_forward.description,
    inputSchema: TOOL_DEFINITIONS.browser_forward.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.forward(ctx.minionId);
    },
  });

export const createBrowserCloseTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_close.description,
    inputSchema: TOOL_DEFINITIONS.browser_close.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      await ctx.browser.closeSession(ctx.minionId);
      return { success: true, output: "Browser session closed." } as BrowserActionResult;
    },
  });

export const createBrowserSessionInfoTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_session_info.description,
    inputSchema: TOOL_DEFINITIONS.browser_session_info.schema,
    execute: async () => {
      if (!config.browserService) return noBrowser();
      if (!config.minionId) return noMinion();
      const info = config.browserService.getSessionInfo(config.minionId);
      if (!info) {
        return {
          success: true,
          output: "No active browser session for this minion. Use browser_navigate to start one.",
        } as BrowserActionResult;
      }
      return {
        success: true,
        output: JSON.stringify(info, null, 2),
      } as BrowserActionResult;
    },
  });

/**
 * Core browser tools loaded directly into every agent context (5 tools).
 * These cover the fundamental browse-and-interact loop.
 *
 * Additional browser tools (20) are available via SDK progressive disclosure:
 *   lattice_search_tools({ query: "browser" }) → file_read SDK → bash code execution
 * See: src/mcp-server/sdk/browser.ts
 */
export function createCoreBrowserTools(config: ToolFactory extends (c: infer C) => unknown ? C : never): Record<string, ReturnType<ToolFactory>> {
  return {
    browser_navigate: createBrowserNavigateTool(config),
    browser_snapshot: createBrowserSnapshotTool(config),
    browser_screenshot: createBrowserScreenshotTool(config),
    browser_click: createBrowserClickTool(config),
    browser_fill: createBrowserFillTool(config),
  };
}

/**
 * Create ALL browser tools (25) as a record keyed by tool name.
 * Used by tests or for full tool registration when progressive disclosure is disabled.
 */
export function createAllBrowserTools(config: ToolFactory extends (c: infer C) => unknown ? C : never): Record<string, ReturnType<ToolFactory>> {
  return {
    browser_navigate: createBrowserNavigateTool(config),
    browser_snapshot: createBrowserSnapshotTool(config),
    browser_screenshot: createBrowserScreenshotTool(config),
    browser_annotated_screenshot: createBrowserAnnotatedScreenshotTool(config),
    browser_click: createBrowserClickTool(config),
    browser_fill: createBrowserFillTool(config),
    browser_type: createBrowserTypeTool(config),
    browser_press: createBrowserPressTool(config),
    browser_hover: createBrowserHoverTool(config),
    browser_scroll: createBrowserScrollTool(config),
    browser_find: createBrowserFindTool(config),
    browser_wait: createBrowserWaitTool(config),
    browser_eval: createBrowserEvalTool(config),
    browser_set_viewport: createBrowserSetViewportTool(config),
    browser_set_device: createBrowserSetDeviceTool(config),
    browser_tabs: createBrowserTabsTool(config),
    browser_dialog: createBrowserDialogTool(config),
    browser_cookies: createBrowserCookiesTool(config),
    browser_network_requests: createBrowserNetworkRequestsTool(config),
    browser_drag: createBrowserDragTool(config),
    browser_select_option: createBrowserSelectOptionTool(config),
    browser_back: createBrowserBackTool(config),
    browser_forward: createBrowserForwardTool(config),
    browser_close: createBrowserCloseTool(config),
    browser_session_info: createBrowserSessionInfoTool(config),
  };
}
