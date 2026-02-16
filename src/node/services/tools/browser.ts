/**
 * Browser automation tool for AI agents.
 *
 * Follows the Anthropic computer-use pattern:
 * 1. Navigate → Screenshot → Observe → Act → Screenshot → Verify
 *
 * Each workspace gets its own isolated Playwright browser session.
 * Sub-agents spawned via the `task` tool also get independent sessions.
 *
 * The tool lazily creates a BrowserSessionManager-backed session on first use
 * and reuses it for subsequent calls within the same workspace.
 *
 * IMPORTANT: Screenshots are compressed (JPEG, quality 50) and capped at 100KB
 * base64 to avoid blowing up the agent's context window. Full-quality snapshots
 * are still captured for the UI panel separately.
 */

import { tool } from "ai";
import type { BrowserToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  BrowserSessionManager,
  type BrowserAction,
  type BrowserActionType,
} from "@/node/services/browserSessionManager";

/**
 * Max base64 screenshot size to return to the agent (in chars).
 * ~100KB base64 ≈ ~75KB image ≈ ~25K tokens. Beyond this we return
 * a text description + page text instead.
 */
const MAX_SCREENSHOT_BASE64_CHARS = 100_000;

/**
 * Max text content length returned to the agent.
 * Prevents massive DOM dumps from eating the context.
 */
const MAX_TEXT_CONTENT_CHARS = 30_000;

/**
 * Global fallback BrowserSessionManager instance.
 * Used when ToolConfiguration doesn't provide one (e.g., sub-agents).
 * Each workspace still gets its own isolated browser session.
 */
let globalBrowserManager: BrowserSessionManager | null = null;

function getOrCreateManager(config: ToolConfiguration): BrowserSessionManager {
  if (config.browserSessionManager) return config.browserSessionManager;
  if (!globalBrowserManager) {
    globalBrowserManager = new BrowserSessionManager();
  }
  return globalBrowserManager;
}

/**
 * Truncate content to stay within token budget.
 */
function capContent(content: string, contentType: string): string {
  if (contentType === "screenshot") {
    if (content.length > MAX_SCREENSHOT_BASE64_CHARS) {
      // Screenshot too large — return a placeholder.
      // The agent should use read_text instead for this page.
      return `[Screenshot too large (${Math.round(content.length / 1000)}KB). Use read_text action to get page content instead.]`;
    }
    return content;
  }
  // Text and HTML content
  const limit = MAX_TEXT_CONTENT_CHARS;
  if (content.length > limit) {
    return content.slice(0, limit) + `\n\n[Content truncated at ${limit} chars. Use a selector to read specific sections.]`;
  }
  return content;
}

/**
 * Browser tool factory — creates the `browser` tool for AI agents.
 */
export const createBrowserTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.browser.description,
    inputSchema: TOOL_DEFINITIONS.browser.schema,
    execute: async (
      {
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
      },
      { abortSignal }
    ): Promise<BrowserToolResult> => {
      try {
        if (abortSignal?.aborted) {
          return { success: false, error: "Browser action cancelled" };
        }

        const manager = getOrCreateManager(config);
        const workspaceId = config.workspaceId ?? "default";

        // Get or create a session for this workspace
        const session = await manager.getOrCreateSession(workspaceId);

        // Map tool input to BrowserAction
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
          return { success: false, error: result.error };
        }

        // Cap content size to prevent context window overflow
        const cappedContent = capContent(result.content, result.contentType);

        // If screenshot was too large and got replaced with text,
        // update the content_type accordingly
        const effectiveType =
          result.contentType === "screenshot" && cappedContent !== result.content
            ? "text"
            : result.contentType;

        return {
          success: true,
          content_type: effectiveType as "text" | "html" | "screenshot" | "info",
          content: cappedContent,
          url: result.url,
          title: result.title,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `browser error: ${message}`,
        };
      }
    },
  });
};
