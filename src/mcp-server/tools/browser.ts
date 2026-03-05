/**
 * Browser tools: per-minion headless browser via agent-browser.
 *
 * Each minion gets an isolated browser session. The snapshot-refs pattern
 * lets agents interact with pages via accessibility tree references (@e1, @e2).
 *
 * Workflow: browser_navigate → browser_snapshot → browser_click/fill → repeat.
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
    "Type text into the currently focused element. Unlike fill, this appends text.",
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
    "Get information about a minion's browser session (URL, status).",
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
