/**
 * Shared browser types for per-minion headless browser sessions.
 *
 * Each minion gets an isolated browser instance via agent-browser's
 * `--session <name>` flag. Types here are inferred from Zod schemas
 * in `../orpc/schemas/browser.ts`.
 */
import type { z } from "zod";
import type {
  BrowserActionResultSchema,
  BrowserElementRefSchema,
  BrowserScreenshotSchema,
  BrowserSessionInfoSchema,
  BrowserSnapshotSchema,
} from "../orpc/schemas/browser";

/** A single element reference from the accessibility tree snapshot. */
export type BrowserElementRef = z.infer<typeof BrowserElementRefSchema>;

/** Parsed accessibility tree snapshot with element refs for interaction. */
export type BrowserSnapshot = z.infer<typeof BrowserSnapshotSchema>;

/** Base64-encoded screenshot of the current page. */
export type BrowserScreenshot = z.infer<typeof BrowserScreenshotSchema>;

/** Metadata about a minion's active browser session. */
export type BrowserSessionInfo = z.infer<typeof BrowserSessionInfoSchema>;

/** Result of a browser action (navigate, click, fill, etc.). */
export type BrowserActionResult = z.infer<typeof BrowserActionResultSchema>;
