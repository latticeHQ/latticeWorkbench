import { describe, test, expect } from "bun:test";
import { MINION_DEFAULTS } from "./minionDefaults";
import { DEFAULT_MODEL } from "@/common/constants/knownModels";

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

describe("MINION_DEFAULTS", () => {
  test("should have all expected keys", () => {
    expect(MINION_DEFAULTS).toHaveProperty("agentId");
    expect(MINION_DEFAULTS).toHaveProperty("thinkingLevel");
    expect(MINION_DEFAULTS).toHaveProperty("model");
    expect(MINION_DEFAULTS).toHaveProperty("input");
  });

  test("should have correct default values", () => {
    expect(MINION_DEFAULTS.agentId).toBe("auto");
    expect(MINION_DEFAULTS.thinkingLevel).toBe("off");
    expect(MINION_DEFAULTS.model).toBe(DEFAULT_MODEL);
    expect(MINION_DEFAULTS.input).toBe("");
  });

  test("should have correct types", () => {
    expect(typeof MINION_DEFAULTS.agentId).toBe("string");
    expect(typeof MINION_DEFAULTS.thinkingLevel).toBe("string");
    expect(typeof MINION_DEFAULTS.model).toBe("string");
    expect(typeof MINION_DEFAULTS.input).toBe("string");
  });

  test("should be frozen to prevent modification", () => {
    expect(Object.isFrozen(MINION_DEFAULTS)).toBe(true);
  });

  test("should prevent modification attempts (immutability)", () => {
    // Frozen objects silently fail in non-strict mode, throw in strict mode
    // We just verify the object is frozen - TypeScript prevents modification at compile time
    const originalAgentId = MINION_DEFAULTS.agentId;
    const mutableDefaults = MINION_DEFAULTS as Mutable<typeof MINION_DEFAULTS>;
    try {
      mutableDefaults.agentId = "plan" as unknown as typeof MINION_DEFAULTS.agentId;
    } catch {
      // Expected in strict mode
    }
    // Value should remain unchanged
    expect(MINION_DEFAULTS.agentId).toBe(originalAgentId);
  });

  test("agentId should default to auto", () => {
    expect(MINION_DEFAULTS.agentId).toBe("auto");
  });

  test("thinkingLevel should be valid ThinkingLevel", () => {
    const validLevels = ["off", "low", "medium", "high"];
    expect(validLevels).toContain(MINION_DEFAULTS.thinkingLevel);
  });

  test("model should follow provider:model format", () => {
    expect(MINION_DEFAULTS.model).toMatch(/^[a-z]+:[a-z0-9-]+$/);
  });

  test("input should be empty string", () => {
    expect(MINION_DEFAULTS.input).toBe("");
    expect(MINION_DEFAULTS.input).toHaveLength(0);
  });
});
