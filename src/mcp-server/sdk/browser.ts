/**
 * Lattice SDK — Browser operations (25 functions)
 *
 * Per-minion headless browser control via agent-browser.
 * Each minion gets an isolated browser session with independent cookies & state.
 *
 * Core workflow: navigate → snapshot → click/fill → snapshot → ...
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
  return c.browser.dialog({ minionId, action, promptText });
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
  return c.browser.tabs({ minionId, action, target });
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
  return c.browser.cookies({ minionId, action, name, value, domain });
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
