/**
 * Lattice SDK — Browser operations (12 functions)
 *
 * Per-minion headless browser control via agent-browser.
 * Each minion gets an isolated browser session.
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

export async function navigate(c: RouterClient<AppRouter>, minionId: string, url: string) {
  return c.browser.navigate({ minionId, url });
}

export async function snapshot(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.snapshot({ minionId });
}

export async function screenshot(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.screenshot({ minionId });
}

export async function click(c: RouterClient<AppRouter>, minionId: string, ref: string) {
  return c.browser.click({ minionId, ref });
}

export async function fill(
  c: RouterClient<AppRouter>,
  minionId: string,
  ref: string,
  value: string
) {
  return c.browser.fill({ minionId, ref, value });
}

export async function type(c: RouterClient<AppRouter>, minionId: string, text: string) {
  return c.browser.type({ minionId, text });
}

export async function scrollUp(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.scrollUp({ minionId });
}

export async function scrollDown(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.scrollDown({ minionId });
}

export async function back(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.back({ minionId });
}

export async function forward(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.forward({ minionId });
}

export async function close(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.close({ minionId });
}

export async function sessionInfo(c: RouterClient<AppRouter>, minionId: string) {
  return c.browser.sessionInfo({ minionId });
}
