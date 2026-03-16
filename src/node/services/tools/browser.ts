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
      const info = await config.browserService.getSessionInfo(config.minionId);
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

// ── Phase 4: Full-strength agent-browser tools ──────────────────────────

export const createBrowserSaveStateTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_save_state.description,
    inputSchema: TOOL_DEFINITIONS.browser_save_state.schema,
    execute: async ({ path, encrypt }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.saveState(ctx.minionId, path ?? undefined, encrypt ?? undefined);
    },
  });

export const createBrowserRestoreStateTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_restore_state.description,
    inputSchema: TOOL_DEFINITIONS.browser_restore_state.schema,
    execute: async ({ path }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.restoreState(ctx.minionId, path ?? undefined);
    },
  });

export const createBrowserStorageTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_storage.description,
    inputSchema: TOOL_DEFINITIONS.browser_storage.schema,
    execute: async ({ storageType, action, key, value }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.storage(ctx.minionId, storageType, action, key ?? undefined, value ?? undefined);
    },
  });

export const createBrowserSnapshotDiffTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_snapshot_diff.description,
    inputSchema: TOOL_DEFINITIONS.browser_snapshot_diff.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.snapshotDiff(ctx.minionId);
    },
  });

export const createBrowserScreenshotDiffTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_screenshot_diff.description,
    inputSchema: TOOL_DEFINITIONS.browser_screenshot_diff.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.screenshotDiff(ctx.minionId);
    },
  });

export const createBrowserScreenshotElementTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_screenshot_element.description,
    inputSchema: TOOL_DEFINITIONS.browser_screenshot_element.schema,
    execute: async ({ ref }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.screenshotElement(ctx.minionId, ref);
    },
  });

export const createBrowserPdfTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_pdf.description,
    inputSchema: TOOL_DEFINITIONS.browser_pdf.schema,
    execute: async ({ landscape, format }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.pdf(ctx.minionId, {
        landscape: landscape ?? undefined,
        format: format ?? undefined,
      });
    },
  });

export const createBrowserConsoleLogsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_console_logs.description,
    inputSchema: TOOL_DEFINITIONS.browser_console_logs.schema,
    execute: async ({ level, clear }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.consoleLogs(ctx.minionId, level ?? undefined, clear ?? undefined);
    },
  });

export const createBrowserSetGeolocationTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_geolocation.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_geolocation.schema,
    execute: async ({ latitude, longitude, accuracy }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setGeolocation(ctx.minionId, latitude, longitude, accuracy ?? undefined);
    },
  });

export const createBrowserSetPermissionsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_permissions.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_permissions.schema,
    execute: async ({ permission, state }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setPermissions(ctx.minionId, permission, state);
    },
  });

export const createBrowserSetOfflineTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_offline.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_offline.schema,
    execute: async ({ offline }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setOffline(ctx.minionId, offline);
    },
  });

export const createBrowserSetHeadersTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_set_headers.description,
    inputSchema: TOOL_DEFINITIONS.browser_set_headers.schema,
    execute: async ({ headers }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.setHeaders(ctx.minionId, headers as Record<string, string>);
    },
  });

export const createBrowserInterceptNetworkTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_intercept_network.description,
    inputSchema: TOOL_DEFINITIONS.browser_intercept_network.schema,
    execute: async ({ pattern, action, modifyResponse }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.interceptNetwork(ctx.minionId, pattern, action, modifyResponse ?? undefined);
    },
  });

export const createBrowserStartRecordingTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_start_recording.description,
    inputSchema: TOOL_DEFINITIONS.browser_start_recording.schema,
    execute: async ({ outputPath }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.startRecording(ctx.minionId, outputPath ?? undefined);
    },
  });

export const createBrowserStopRecordingTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_stop_recording.description,
    inputSchema: TOOL_DEFINITIONS.browser_stop_recording.schema,
    execute: async () => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.stopRecording(ctx.minionId);
    },
  });

export const createBrowserConnectProviderTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_connect_provider.description,
    inputSchema: TOOL_DEFINITIONS.browser_connect_provider.schema,
    execute: async ({ provider, apiKey, endpoint, projectId }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.connectProvider(ctx.minionId, {
        provider,
        apiKey,
        endpoint: endpoint ?? undefined,
        projectId: projectId ?? undefined,
      });
    },
  });

export const createBrowserListSessionsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_list_sessions.description,
    inputSchema: TOOL_DEFINITIONS.browser_list_sessions.schema,
    execute: async () => {
      if (!config.browserService) return noBrowser();
      const sessions = config.browserService.listSessions();
      return {
        success: true,
        output: sessions.length > 0
          ? JSON.stringify(sessions, null, 2)
          : "No active browser sessions.",
      } as BrowserActionResult;
    },
  });

export const createBrowserConfigureSessionTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_configure_session.description,
    inputSchema: TOOL_DEFINITIONS.browser_configure_session.schema,
    execute: async ({ headed, colorScheme, proxy, userAgent, timeout }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.configureSession(ctx.minionId, {
        headed: headed ?? undefined,
        colorScheme: colorScheme ?? undefined,
        proxy: proxy ?? undefined,
        userAgent: userAgent ?? undefined,
        timeout: timeout ?? undefined,
      });
    },
  });

export const createBrowserDeleteCookiesTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_delete_cookies.description,
    inputSchema: TOOL_DEFINITIONS.browser_delete_cookies.schema,
    execute: async ({ name, domain }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.deleteCookies(ctx.minionId, name, domain ?? undefined);
    },
  });

export const createBrowserScrollToElementTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_scroll_to_element.description,
    inputSchema: TOOL_DEFINITIONS.browser_scroll_to_element.schema,
    execute: async ({ ref }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.scrollToElement(ctx.minionId, ref);
    },
  });

export const createBrowserScrollByPixelsTool: ToolFactory = (config) =>
  tool({
    description: TOOL_DEFINITIONS.browser_scroll_by_pixels.description,
    inputSchema: TOOL_DEFINITIONS.browser_scroll_by_pixels.schema,
    execute: async ({ direction, pixels }) => {
      const ctx = getCtx(config);
      if ("error" in ctx) return ctx.error;
      return ctx.browser.scrollByPixels(ctx.minionId, direction, pixels);
    },
  });

/**
 * Core browser tools loaded directly into every agent context (5 tools).
 * These cover the fundamental browse-and-interact loop.
 *
 * Additional browser tools (41) are available via SDK progressive disclosure:
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
/**
 * Create ALL browser tools (46) as a record keyed by tool name.
 * Full agent-browser feature coverage including state persistence,
 * storage, diffing, PDF, console, geolocation, network interception,
 * recording, cloud providers, and session configuration.
 */
export function createAllBrowserTools(config: ToolFactory extends (c: infer C) => unknown ? C : never): Record<string, ReturnType<ToolFactory>> {
  return {
    // Core (5)
    browser_navigate: createBrowserNavigateTool(config),
    browser_snapshot: createBrowserSnapshotTool(config),
    browser_screenshot: createBrowserScreenshotTool(config),
    browser_click: createBrowserClickTool(config),
    browser_fill: createBrowserFillTool(config),
    // Interaction (7)
    browser_type: createBrowserTypeTool(config),
    browser_press: createBrowserPressTool(config),
    browser_hover: createBrowserHoverTool(config),
    browser_find: createBrowserFindTool(config),
    browser_drag: createBrowserDragTool(config),
    browser_select_option: createBrowserSelectOptionTool(config),
    browser_wait: createBrowserWaitTool(config),
    // Visual (5)
    browser_annotated_screenshot: createBrowserAnnotatedScreenshotTool(config),
    browser_screenshot_diff: createBrowserScreenshotDiffTool(config),
    browser_screenshot_element: createBrowserScreenshotElementTool(config),
    browser_snapshot_diff: createBrowserSnapshotDiffTool(config),
    browser_pdf: createBrowserPdfTool(config),
    // JS & Console (2)
    browser_eval: createBrowserEvalTool(config),
    browser_console_logs: createBrowserConsoleLogsTool(config),
    // Navigation & Scrolling (5)
    browser_scroll: createBrowserScrollTool(config),
    browser_scroll_to_element: createBrowserScrollToElementTool(config),
    browser_scroll_by_pixels: createBrowserScrollByPixelsTool(config),
    browser_back: createBrowserBackTool(config),
    browser_forward: createBrowserForwardTool(config),
    // Viewport & Emulation (4)
    browser_set_viewport: createBrowserSetViewportTool(config),
    browser_set_device: createBrowserSetDeviceTool(config),
    browser_set_geolocation: createBrowserSetGeolocationTool(config),
    browser_set_permissions: createBrowserSetPermissionsTool(config),
    // Network (4)
    browser_network_requests: createBrowserNetworkRequestsTool(config),
    browser_set_offline: createBrowserSetOfflineTool(config),
    browser_set_headers: createBrowserSetHeadersTool(config),
    browser_intercept_network: createBrowserInterceptNetworkTool(config),
    // State & Storage (3)
    browser_save_state: createBrowserSaveStateTool(config),
    browser_restore_state: createBrowserRestoreStateTool(config),
    browser_storage: createBrowserStorageTool(config),
    // Tabs & Dialogs & Cookies (4)
    browser_tabs: createBrowserTabsTool(config),
    browser_dialog: createBrowserDialogTool(config),
    browser_cookies: createBrowserCookiesTool(config),
    browser_delete_cookies: createBrowserDeleteCookiesTool(config),
    // Session Management (5)
    browser_close: createBrowserCloseTool(config),
    browser_session_info: createBrowserSessionInfoTool(config),
    browser_list_sessions: createBrowserListSessionsTool(config),
    browser_configure_session: createBrowserConfigureSessionTool(config),
    browser_connect_provider: createBrowserConnectProviderTool(config),
    // Recording (2)
    browser_start_recording: createBrowserStartRecordingTool(config),
    browser_stop_recording: createBrowserStopRecordingTool(config),
  };
}
