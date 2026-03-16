/**
 * Zod schemas for per-minion headless browser sessions.
 * Used by oRPC route validation and shared type inference.
 *
 * Full agent-browser feature coverage:
 * - Snapshot-refs pattern (@e1, @e2) for accessible interaction
 * - WebSocket streaming via AGENT_BROWSER_STREAM_PORT (live JPEG frames + input)
 * - Session persistence with optional AES-256-GCM encryption
 * - State management: cookies, localStorage, sessionStorage
 * - Snapshot/screenshot diffing for change detection
 * - Cloud browser providers: Browserbase, Browserless, Browser Use, Kernel
 * - Network interception, offline mode, custom headers
 * - Session recording, PDF export, console logs
 * - Geolocation, permissions, proxy support
 * - Action policy enforcement (allow/deny/confirm)
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

/** Annotated screenshot with numbered element labels overlaid. */
export const BrowserAnnotatedScreenshotSchema = z.object({
  minionId: z.string(),
  base64: z.string(),
  url: z.string(),
  timestamp: z.number(),
  annotations: z.array(
    z.object({
      ref: z.string(),
      label: z.string(),
    })
  ),
});

/** Cloud browser provider configuration. */
export const BrowserProviderConfigSchema = z.object({
  provider: z.enum(["browserbase", "browserless", "browseruse", "kernel"]),
  apiKey: z.string(),
  endpoint: z.string().optional(),
  projectId: z.string().optional(),
});

/** Action policy for browser safety enforcement. */
export const BrowserActionPolicySchema = z.object({
  default: z.enum(["allow", "deny"]).optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  confirm: z.array(z.string()).optional(),
});

/** Per-session browser configuration. */
export const BrowserSessionConfigSchema = z.object({
  headed: z.boolean().optional(),
  colorScheme: z.enum(["dark", "light", "no-preference"]).optional(),
  ignoreHttpsErrors: z.boolean().optional(),
  provider: BrowserProviderConfigSchema.optional(),
  policy: BrowserActionPolicySchema.optional(),
  proxy: z.string().optional(),
  userAgent: z.string().optional(),
  timeout: z.number().optional(),
});

/** Metadata about a minion's active browser session. */
export const BrowserSessionInfoSchema = z.object({
  minionId: z.string(),
  sessionName: z.string(),
  url: z.string().nullable(),
  isActive: z.boolean(),
  /** WebSocket streaming port (null if streaming not active). */
  streamPort: z.number().nullable(),
});

/** Result of a browser action (navigate, click, fill, etc.). */
export const BrowserActionResultSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  snapshot: BrowserSnapshotSchema.optional(),
  screenshot: BrowserScreenshotSchema.optional(),
  annotatedScreenshot: BrowserAnnotatedScreenshotSchema.optional(),
  error: z.string().optional(),
});
