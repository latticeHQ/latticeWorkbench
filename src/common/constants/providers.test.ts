/**
 * Test that provider constants are correct (agent-only architecture)
 */

import { describe, test, expect } from "bun:test";
import { SUPPORTED_PROVIDERS, isValidProvider } from "./providers";
import { CLI_AGENT_SLUGS } from "./cliAgents";

describe("Provider Constants (Agent-Only)", () => {
  test("SUPPORTED_PROVIDERS matches CLI agent slugs", () => {
    expect(SUPPORTED_PROVIDERS.length).toBe(CLI_AGENT_SLUGS.length);
    for (const slug of CLI_AGENT_SLUGS) {
      expect(SUPPORTED_PROVIDERS).toContain(slug);
    }
  });

  test("isValidProvider accepts CLI agent slugs", () => {
    expect(isValidProvider("claude-code")).toBe(true);
    expect(isValidProvider("codex")).toBe(true);
  });

  test("isValidProvider rejects invalid providers", () => {
    expect(isValidProvider("invalid")).toBe(false);
    expect(isValidProvider("")).toBe(false);
    expect(isValidProvider("gpt-4")).toBe(false);
  });
});
