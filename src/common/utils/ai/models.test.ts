import { describe, it, expect } from "bun:test";
import {
  getModelName,
  supports1MContext,
  isValidModelFormat,
} from "./models";

describe("getModelName", () => {
  it("should extract model name from provider:model format", () => {
    expect(getModelName("anthropic:claude-opus-4-5")).toBe("claude-opus-4-5");
    expect(getModelName("openai:gpt-4o")).toBe("gpt-4o");
  });

  it("should return full string if no colon", () => {
    expect(getModelName("claude-opus-4-5")).toBe("claude-opus-4-5");
  });
});

describe("supports1MContext", () => {
  it("should return true for Anthropic Sonnet 4 models", () => {
    expect(supports1MContext("anthropic:claude-sonnet-4-5")).toBe(true);
    expect(supports1MContext("anthropic:claude-sonnet-4-5-20250514")).toBe(true);
    expect(supports1MContext("anthropic:claude-sonnet-4-20250514")).toBe(true);
  });

  it("should return false for non-Anthropic models", () => {
    expect(supports1MContext("openai:gpt-4o")).toBe(false);
  });

  it("should return true for Opus 4.6 models", () => {
    expect(supports1MContext("anthropic:claude-opus-4-6")).toBe(true);
  });

  it("should return false for Anthropic non-Sonnet-4 / non-Opus-4.6 models", () => {
    expect(supports1MContext("anthropic:claude-opus-4-5")).toBe(false);
    expect(supports1MContext("anthropic:claude-haiku-4-5")).toBe(false);
  });

  it("should return true for Opus 4.6 models", () => {
    expect(supports1MContext("anthropic:claude-opus-4-6")).toBe(true);
    expect(supports1MContext("anthropic:claude-opus-4-6-20260201")).toBe(true);
  });
});

describe("isValidModelFormat", () => {
  it("returns true for valid model formats", () => {
    expect(isValidModelFormat("anthropic:claude-sonnet-4-5")).toBe(true);
    expect(isValidModelFormat("openai:gpt-5.2")).toBe(true);
    expect(isValidModelFormat("google:gemini-3.1-pro-preview")).toBe(true);
    // Ollama-style model names with colons in the model ID
    expect(isValidModelFormat("ollama:gpt-oss:20b")).toBe(true);
  });

  it("returns false for invalid model formats", () => {
    // Missing colon
    expect(isValidModelFormat("gpt")).toBe(false);
    expect(isValidModelFormat("sonnet")).toBe(false);
    expect(isValidModelFormat("badmodel")).toBe(false);

    // Colon at start or end
    expect(isValidModelFormat(":model")).toBe(false);
    expect(isValidModelFormat("provider:")).toBe(false);

    // Empty string
    expect(isValidModelFormat("")).toBe(false);
  });
});
