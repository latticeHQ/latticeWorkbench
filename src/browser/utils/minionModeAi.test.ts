import { describe, expect, test } from "bun:test";
import type { ThinkingLevel } from "@/common/types/thinking";
import { resolveMinionAiSettingsForAgent } from "./minionModeAi";

describe("resolveMinionAiSettingsForAgent", () => {
  test("uses global agent defaults when configured", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {
        exec: { modelString: "openai:gpt-5.3-codex", thinkingLevel: "high" },
      },
      fallbackModel: "openai:gpt-5.2",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "off",
    });

    expect(result).toEqual({
      resolvedModel: "openai:gpt-5.3-codex",
      resolvedThinking: "high",
    });
  });

  test("inherits existing minion settings when global defaults are unset", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {},
      fallbackModel: "openai:gpt-5.2",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "medium",
    });

    expect(result).toEqual({
      resolvedModel: "anthropic:claude-opus-4-6",
      resolvedThinking: "medium",
    });
  });

  test("uses minion-by-agent fallback when explicitly enabled", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {},
      minionByAgent: {
        exec: { model: "openai:gpt-5.2", thinkingLevel: "medium" },
      },
      useMinionByAgentFallback: true,
      fallbackModel: "openai:gpt-5.2-mini",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "off",
    });

    expect(result).toEqual({
      resolvedModel: "openai:gpt-5.2",
      resolvedThinking: "medium",
    });
  });

  test("ignores minion-by-agent fallback when disabled", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {},
      minionByAgent: {
        exec: { model: "openai:gpt-5.2", thinkingLevel: "medium" },
      },
      useMinionByAgentFallback: false,
      fallbackModel: "openai:gpt-5.2-mini",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "off",
    });

    expect(result).toEqual({
      resolvedModel: "anthropic:claude-opus-4-6",
      resolvedThinking: "off",
    });
  });

  test('treats empty modelString as "inherit"', () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {
        exec: { modelString: "  " },
      },
      fallbackModel: "openai:gpt-5.2",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "low",
    });

    expect(result).toEqual({
      resolvedModel: "anthropic:claude-opus-4-6",
      resolvedThinking: "low",
    });
  });

  test("guards non-string global default model values", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {
        exec: { modelString: 42 as unknown as string },
      },
      fallbackModel: "openai:gpt-5.2-mini",
      existingModel: "anthropic:claude-opus-4-6",
      existingThinking: "off",
    });

    expect(result).toEqual({
      resolvedModel: "anthropic:claude-opus-4-6",
      resolvedThinking: "off",
    });
  });

  test("self-heals invalid inherited minion settings", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {},
      fallbackModel: "openai:gpt-5.2",
      existingModel: "   ",
      existingThinking: "legacy-invalid" as unknown as ThinkingLevel,
    });

    expect(result).toEqual({
      resolvedModel: "openai:gpt-5.2",
      resolvedThinking: "off",
    });
  });

  test("guards non-string persisted model values", () => {
    const result = resolveMinionAiSettingsForAgent({
      agentId: "exec",
      agentAiDefaults: {},
      fallbackModel: "openai:gpt-5.2",
      existingModel: 42 as unknown as string,
      existingThinking: "off",
    });

    expect(result).toEqual({
      resolvedModel: "openai:gpt-5.2",
      resolvedThinking: "off",
    });
  });
});
