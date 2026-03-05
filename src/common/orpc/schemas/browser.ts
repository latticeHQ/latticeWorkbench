/**
 * Zod schemas for per-minion headless browser sessions.
 * Used by oRPC route validation and shared type inference.
 */
import { z } from "zod";

/** A single element reference from the accessibility tree snapshot. */
export const BrowserElementRefSchema = z.object({
  ref: z.string(),
  role: z.string(),
  name: z.string(),
  value: z.string().optional(),
});

/** Parsed accessibility tree snapshot with element refs for interaction. */
export const BrowserSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  elements: z.array(BrowserElementRefSchema),
  raw: z.string(),
});

/** Base64-encoded screenshot of the current page. */
export const BrowserScreenshotSchema = z.object({
  minionId: z.string(),
  base64: z.string(),
  url: z.string(),
  timestamp: z.number(),
});

/** Metadata about a minion's active browser session. */
export const BrowserSessionInfoSchema = z.object({
  minionId: z.string(),
  sessionName: z.string(),
  url: z.string().nullable(),
  isActive: z.boolean(),
});

/** Result of a browser action (navigate, click, fill, etc.). */
export const BrowserActionResultSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  snapshot: BrowserSnapshotSchema.optional(),
  screenshot: BrowserScreenshotSchema.optional(),
  error: z.string().optional(),
});
