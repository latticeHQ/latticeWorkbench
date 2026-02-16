/**
 * Browser MCP tools — control embedded browser instances via MCP.
 *
 * Exposes Playwright-backed browser automation through the MCP server,
 * allowing any MCP client (Claude Code, Cursor, channel bots, etc.)
 * to control browsers within workspaces.
 *
 * Follows Anthropic's computer-use pattern:
 *   navigate → screenshot → observe → act → screenshot → verify
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BrowserSessionManager,
  type BrowserAction,
  type BrowserActionType,
} from "../../node/services/browserSessionManager.js";

// ── Shared browser session manager (one per MCP server process) ──────
let browserManager: BrowserSessionManager | null = null;

function getManager(): BrowserSessionManager {
  if (!browserManager) {
    browserManager = new BrowserSessionManager();
  }
  return browserManager;
}

export function registerBrowserTools(server: McpServer): void {
  // ── browser_navigate ───────────────────────────────────────────────

  server.tool(
    "browser_navigate",
    "Navigate the browser to a URL. Creates a new browser session if one doesn't exist for the workspace.",
    {
      workspace_id: z.string().describe("Workspace ID to associate the browser session with"),
      url: z.string().url().describe("URL to navigate to"),
    },
    async ({ workspace_id, url }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, { action: "navigate", url });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text" as const, text: `Navigated to ${result.url}\nTitle: ${result.title}` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_screenshot ──────────────────────────────────────────────

  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current browser page. Returns base64-encoded PNG image data. Use this to see the current state before deciding on actions.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      full_page: z.boolean().optional().describe("Capture full page (default: viewport only)"),
    },
    async ({ workspace_id, full_page }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "screenshot",
          fullPage: full_page,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "image" as const,
              data: result.content,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
              text: `URL: ${result.url}\nTitle: ${result.title}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_click ──────────────────────────────────────────────────

  server.tool(
    "browser_click",
    "Click an element on the page by CSS selector or [x,y] coordinate. Always take a screenshot first to identify click targets.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      selector: z.string().optional().describe("CSS selector of element to click"),
      coordinate: z.tuple([z.number(), z.number()]).optional().describe("Click position [x, y]"),
    },
    async ({ workspace_id, selector, coordinate }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "click",
          selector,
          coordinate: coordinate as [number, number] | undefined,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `${result.content}\nURL: ${result.url}` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_type ───────────────────────────────────────────────────

  server.tool(
    "browser_type",
    "Type text into an input field. If selector is provided, fills that element; otherwise types into the currently focused element.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      text: z.string().describe("Text to type"),
      selector: z.string().optional().describe("CSS selector of input to fill"),
    },
    async ({ workspace_id, text, selector }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "type",
          text,
          selector,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: result.content }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_scroll ─────────────────────────────────────────────────

  server.tool(
    "browser_scroll",
    "Scroll the page in a given direction.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      direction: z
        .enum(["up", "down", "left", "right"])
        .default("down")
        .describe("Scroll direction"),
      amount: z.number().positive().default(500).describe("Scroll amount in pixels"),
    },
    async ({ workspace_id, direction, amount }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "scroll",
          direction,
          amount,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: result.content }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_read_text ──────────────────────────────────────────────

  server.tool(
    "browser_read_text",
    "Extract visible text content from the page or a specific element. Useful for reading articles, product listings, form values, etc.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector to read text from (default: entire page body)"),
    },
    async ({ workspace_id, selector }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "read_text",
          selector,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `URL: ${result.url}\nTitle: ${result.title}\n\n${result.content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_evaluate ───────────────────────────────────────────────

  server.tool(
    "browser_evaluate",
    "Execute JavaScript in the page context. Returns the result of the last expression. Useful for extracting data, checking state, or performing DOM operations.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      code: z.string().describe("JavaScript code to execute in the browser page"),
    },
    async ({ workspace_id, code }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const result = await manager.executeAction(session.id, {
          action: "evaluate",
          code,
        });
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text" as const, text: result.content }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_action (unified) ───────────────────────────────────────

  server.tool(
    "browser_action",
    "Perform any browser action (navigate, click, type, scroll, screenshot, read_text, read_html, wait, select, hover, go_back, go_forward, new_tab, close_tab, list_tabs, switch_tab, evaluate). This is the unified tool — use specific tools above for common actions.",
    {
      workspace_id: z.string().describe("Workspace ID"),
      action: z
        .enum([
          "navigate",
          "click",
          "type",
          "scroll",
          "screenshot",
          "read_text",
          "read_html",
          "wait",
          "select",
          "hover",
          "go_back",
          "go_forward",
          "new_tab",
          "close_tab",
          "list_tabs",
          "switch_tab",
          "evaluate",
        ])
        .describe("Action to perform"),
      url: z.string().optional(),
      selector: z.string().optional(),
      text: z.string().optional(),
      value: z.string().optional(),
      coordinate: z.tuple([z.number(), z.number()]).optional(),
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      amount: z.number().positive().optional(),
      full_page: z.boolean().optional(),
      timeout_ms: z.number().positive().optional(),
      page_id: z.string().optional(),
      code: z.string().optional(),
    },
    async ({
      workspace_id,
      action,
      url,
      selector,
      text,
      value,
      coordinate,
      direction,
      amount,
      full_page,
      timeout_ms,
      page_id,
      code,
    }) => {
      try {
        const manager = getManager();
        const session = await manager.getOrCreateSession(workspace_id);
        const browserAction: BrowserAction = {
          action: action as BrowserActionType,
          url,
          selector,
          text,
          value,
          coordinate: coordinate as [number, number] | undefined,
          direction,
          amount,
          fullPage: full_page,
          timeoutMs: timeout_ms,
          pageId: page_id,
          code,
        };
        const result = await manager.executeAction(session.id, browserAction);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${result.error}` }],
            isError: true,
          };
        }
        if (result.contentType === "screenshot") {
          return {
            content: [
              { type: "image" as const, data: result.content, mimeType: "image/png" },
              { type: "text" as const, text: `URL: ${result.url}\nTitle: ${result.title}` },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `${result.content}\nURL: ${result.url}\nTitle: ${result.title}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_session_info ───────────────────────────────────────────

  server.tool(
    "browser_session_info",
    "Get info about active browser sessions for a workspace — status, tab count, last activity time.",
    {
      workspace_id: z.string().describe("Workspace ID"),
    },
    async ({ workspace_id }) => {
      try {
        const manager = getManager();
        const sessions = manager.listSessions(workspace_id);
        if (sessions.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No active browser sessions for this workspace." },
            ],
          };
        }
        const infos = sessions.map((s) => manager.getSessionInfo(s.id)).filter(Boolean);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(infos, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── browser_close ──────────────────────────────────────────────────

  server.tool(
    "browser_close",
    "Close all browser sessions for a workspace. Frees memory and resources.",
    {
      workspace_id: z.string().describe("Workspace ID"),
    },
    async ({ workspace_id }) => {
      try {
        const manager = getManager();
        await manager.closeWorkspaceSessions(workspace_id);
        return {
          content: [
            {
              type: "text" as const,
              text: `Closed all browser sessions for workspace ${workspace_id}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
