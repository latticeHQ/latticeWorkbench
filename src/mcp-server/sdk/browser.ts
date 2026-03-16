/**
 * Lattice SDK — Browser operations (46 functions)
 *
 * Per-minion headless browser control via agent-browser (full-strength).
 * Each minion gets an isolated browser session with independent cookies & state.
 *
 * Core workflow: navigate → snapshot → click/fill → snapshot → ...
 *
 * Full feature set:
 *   Core: navigate, snapshot, screenshot, click, fill, type, scroll, back, forward
 *   Interaction: press, hover, find, wait, drag, selectOption
 *   Visual: annotatedScreenshot, screenshotDiff, screenshotElement, pdf
 *   JS: evalJS, consoleLogs
 *   Viewport: setViewport, setDevice, setGeolocation, setPermissions
 *   Network: networkRequests, setHeaders, setOffline, interceptNetwork
 *   State: saveState, restoreState, storage
 *   Tabs/Cookies: tabs, dialog, cookies, deleteCookies
 *   Session: close, sessionInfo, listSessions, configureSession, connectProvider
 *   Advanced: snapshotDiff, startRecording, stopRecording
 *   Scrolling: scrollDown, scrollUp, scrollToElement, scrollByPixels
 *
 * Usage (code execution pattern):
 *   import { getClient } from './client';
 *   import * as browser from './browser';
 *   const c = await getClient();
 *   const mid = process.env.LATTICE_MINION_ID!;
 *   await browser.navigate(c, mid, 'https://example.com');
 *   const page = await browser.snapshot(c, mid);
 *   console.log(page.output); // accessibility tree with @e1, @e2, ... refs
 *   await browser.click(c, mid, '@e3');
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// ── Core navigation & page reading ──────────────────────────────────────────

/** Navigate to a URL. Creates a browser session if none exists. */
export async function navigate(c: RouterClient<AppRouter>, minionId: string, url: string) {
  return c.browser.navigate({ minionId, url });
}

/** Get accessibility tree snapshot with element refs (@e1, @e2, ...). */
export async function snapshot(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.snapshot({ minionId });
}

/** Take a screenshot (base64-encoded PNG). */
export async function screenshot(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.screenshot({ minionId });
}

/** Annotated screenshot with numbered labels on interactive elements. */
export async function annotatedScreenshot(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.annotatedScreenshot({ minionId });
}

// ── Element interaction ─────────────────────────────────────────────────────

/** Click an element by snapshot ref (e.g. '@e2'). */
export async function click(c: RouterClient<AppRouter>, minionId: string, ref: string) {
  return c.browser.click({ minionId, ref });
}

/** Fill a form field by snapshot ref. Clears existing content. */
export async function fill(c: RouterClient<AppRouter>, minionId: string, ref: string, value: string) {
  return c.browser.fill({ minionId, ref, value });
}

/** Type text into the focused element (appends, fires keyboard events). */
export async function type(c: RouterClient<AppRouter>, minionId: string, text: string) {
  return c.browser.type({ minionId, text });
}

/** Press a key or combination (Enter, Tab, Control+A, Meta+V, etc.). */
export async function press(c: RouterClient<AppRouter>, minionId: string, key: string) {
  return c.browser.press({ minionId, key });
}

/** Hover over an element by snapshot ref. */
export async function hover(c: RouterClient<AppRouter>, minionId: string, ref: string) {
  return c.browser.hover({ minionId, ref });
}

/** Find element by semantic locator (role/text/label/placeholder/testid). */
export async function find(
  c: RouterClient<AppRouter>,
  minionId: string,
  locator: string,
  value: string,
  action?: string,
  actionValue?: string
) {
  return c.browser.find({ minionId, locator, value, action, actionValue });
}

/** Select an option from a <select> dropdown by ref. */
export async function selectOption(c: RouterClient<AppRouter>, minionId: string, ref: string, value: string) {
  return c.browser.selectOption({ minionId, ref, value });
}

/** Drag and drop between two elements by snapshot refs. */
export async function drag(c: RouterClient<AppRouter>, minionId: string, sourceRef: string, targetRef: string) {
  return c.browser.drag({ minionId, sourceRef, targetRef });
}

// ── Scrolling & navigation ──────────────────────────────────────────────────

/** Scroll the page down. */
export async function scrollDown(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.scrollDown({ minionId });
}

/** Scroll the page up. */
export async function scrollUp(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.scrollUp({ minionId });
}

/** Navigate browser history back. */
export async function back(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.back({ minionId });
}

/** Navigate browser history forward. */
export async function forward(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.forward({ minionId });
}

// ── Page utilities ──────────────────────────────────────────────────────────

/** Wait for a condition: CSS selector, text, URL pattern, or time in ms. */
export async function wait(c: RouterClient<AppRouter>, minionId: string, target: string) {
  return c.browser.wait({ minionId, target });
}

/** Execute JavaScript in the page context. */
export async function evalJS(c: RouterClient<AppRouter>, minionId: string, js: string) {
  return c.browser.eval({ minionId, js });
}

/** Handle browser dialogs (alert, confirm, prompt). */
export async function dialog(c: RouterClient<AppRouter>, minionId: string, action: string, promptText?: string) {
  return c.browser.dialog({ minionId, action: action as "accept" | "dismiss", promptText });
}

// ── Viewport & device emulation ─────────────────────────────────────────────

/** Set viewport dimensions (width × height in pixels). */
export async function setViewport(c: RouterClient<AppRouter>, minionId: string, width: number, height: number) {
  return c.browser.setViewport({ minionId, width, height });
}

/** Emulate a device (e.g. 'iPhone 14', 'iPad Pro', 'Pixel 7'). */
export async function setDevice(c: RouterClient<AppRouter>, minionId: string, device: string) {
  return c.browser.setDevice({ minionId, device });
}

// ── Tab, cookie & network management ────────────────────────────────────────

/** Manage tabs: list, new, switch, close. */
export async function tabs(c: RouterClient<AppRouter>, minionId: string, action: string, target?: string) {
  return c.browser.tabs({ minionId, action: action as "new" | "list" | "switch" | "close", target });
}

/** Manage cookies: list, set, clear. */
export async function cookies(
  c: RouterClient<AppRouter>,
  minionId: string,
  action: string,
  name?: string,
  value?: string,
  domain?: string
) {
  return c.browser.cookies({ minionId, action: action as "set" | "clear" | "list", name, value, domain });
}

/** View tracked network requests (optionally filtered by URL pattern). */
export async function networkRequests(c: RouterClient<AppRouter>, minionId: string, filter?: string) {
  return c.browser.networkRequests({ minionId, filter });
}

// ── Session management ──────────────────────────────────────────────────────

/** Close the browser session and release resources. */
export async function close(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.close({ minionId });
}

/** Get session info (URL, status, stream port). */
export async function sessionInfo(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.sessionInfo({ minionId });
}

// ── State persistence ────────────────────────────────────────────────────────

/** Save session state (cookies, localStorage, sessionStorage) to a file. Supports AES-256-GCM encryption. */
export async function saveState(c: RouterClient<AppRouter>, minionId: string, path?: string, encrypt?: boolean) {
  return c.browser.saveState({ minionId, path, encrypt });
}

/** Restore session state from a previously saved file. */
export async function restoreState(c: RouterClient<AppRouter>, minionId: string, path?: string) {
  return c.browser.restoreState({ minionId, path });
}

/** Manage localStorage or sessionStorage (get, set, remove, clear, keys). */
export async function storage(
  c: RouterClient<AppRouter>,
  minionId: string,
  storageType: "local" | "session",
  action: "get" | "set" | "remove" | "clear" | "keys",
  key?: string,
  value?: string
) {
  return c.browser.storage({ minionId, storageType, action, key, value });
}

// ── Diffing ──────────────────────────────────────────────────────────────────

/** Compare current snapshot with previous to detect DOM changes. */
export async function snapshotDiff(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.snapshotDiff({ minionId });
}

/** Compare current screenshot with previous visually. */
export async function screenshotDiff(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.screenshotDiff({ minionId });
}

/** Take a screenshot of a specific element by ref. */
export async function screenshotElement(c: RouterClient<AppRouter>, minionId: string, ref: string) {
  return c.browser.screenshotElement({ minionId, ref });
}

// ── PDF & Console ────────────────────────────────────────────────────────────

/** Print current page to PDF. Returns base64-encoded PDF. */
export async function pdf(c: RouterClient<AppRouter>, minionId: string, options?: { landscape?: boolean; format?: string }) {
  return c.browser.pdf({ minionId, ...options });
}

/** Get browser console logs (log, warn, error, info). */
export async function consoleLogs(c: RouterClient<AppRouter>, minionId: string, level?: string, clear?: boolean) {
  return c.browser.consoleLogs({ minionId, level, clear });
}

// ── Viewport & Emulation ─────────────────────────────────────────────────────

/** Set the browser's geolocation. */
export async function setGeolocation(c: RouterClient<AppRouter>, minionId: string, latitude: number, longitude: number, accuracy?: number) {
  return c.browser.setGeolocation({ minionId, latitude, longitude, accuracy });
}

/** Set browser permissions (geolocation, notifications, camera, etc.). */
export async function setPermissions(c: RouterClient<AppRouter>, minionId: string, permission: string, state: "grant" | "deny" | "prompt") {
  return c.browser.setPermissions({ minionId, permission, state });
}

// ── Network control ──────────────────────────────────────────────────────────

/** Toggle offline mode (network emulation). */
export async function setOffline(c: RouterClient<AppRouter>, minionId: string, offline: boolean) {
  return c.browser.setOffline({ minionId, offline });
}

/** Set custom HTTP headers for all requests. */
export async function setHeaders(c: RouterClient<AppRouter>, minionId: string, headers: Record<string, string>) {
  return c.browser.setHeaders({ minionId, headers });
}

/** Intercept network requests matching a URL pattern. */
export async function interceptNetwork(
  c: RouterClient<AppRouter>,
  minionId: string,
  pattern: string,
  action: "block" | "modify" | "log",
  modifyResponse?: string
) {
  return c.browser.interceptNetwork({ minionId, pattern, action, modifyResponse });
}

// ── Recording ────────────────────────────────────────────────────────────────

/** Start recording the browser session. */
export async function startRecording(c: RouterClient<AppRouter>, minionId: string, outputPath?: string) {
  return c.browser.startRecording({ minionId, outputPath });
}

/** Stop recording the browser session. */
export async function stopRecording(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.stopRecording({ minionId });
}

// ── Cloud browser providers ──────────────────────────────────────────────────

/** Connect to a cloud browser provider (Browserbase, Browserless, Browser Use, Kernel). */
export async function connectProvider(
  c: RouterClient<AppRouter>,
  minionId: string,
  provider: { provider: "browserbase" | "browserless" | "browseruse" | "kernel"; apiKey: string; endpoint?: string; projectId?: string }
) {
  return c.browser.connectProvider({ minionId, provider });
}

// ── Session management ───────────────────────────────────────────────────────

/** List all active browser sessions across all minions. */
export async function listSessions(c: RouterClient<AppRouter>) {
  return c.browser.listSessions({});
}

/** Configure session-specific settings (headed mode, proxy, user agent, etc.). */
export async function configureSession(
  c: RouterClient<AppRouter>,
  minionId: string,
  config: { headed?: boolean; colorScheme?: "dark" | "light" | "no-preference"; proxy?: string; userAgent?: string; timeout?: number }
) {
  return c.browser.configureSession({ minionId, config });
}

// ── Extended cookies ─────────────────────────────────────────────────────────

/** Delete specific cookies by name. */
export async function deleteCookies(c: RouterClient<AppRouter>, minionId: string, name: string, domain?: string) {
  return c.browser.deleteCookies({ minionId, name, domain });
}

// ── Extended scrolling ───────────────────────────────────────────────────────

/** Scroll to bring a specific element into view. */
export async function scrollToElement(c: RouterClient<AppRouter>, minionId: string, ref: string) {
  return c.browser.scrollToElement({ minionId, ref });
}

/** Scroll by a specific pixel amount in any direction. */
export async function scrollByPixels(c: RouterClient<AppRouter>, minionId: string, direction: "up" | "down" | "left" | "right", pixels: number) {
  return c.browser.scrollByPixels({ minionId, direction, pixels });
}
