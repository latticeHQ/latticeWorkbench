import { describe, it, expect } from "bun:test";
import {
  normalizeGatewayModel,
  getModelName,
  supports1MContext,
  isValidModelFormat,
  resolveModelAlias,
} from "./models";

describe("normalizeGatewayModel", () => {
  it("should return all strings unchanged (passthrough)", () => {
    expect(normalizeGatewayModel("anthropic:claude-opus-4-5")).toBe("anthropic:claude-opus-4-5");
    expect(normalizeGatewayModel("openai:gpt-4o")).toBe("openai:gpt-4o");
    expect(normalizeGatewayModel("claude-opus-4-5")).toBe("claude-opus-4-5");
  });
});

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

  it("should return false for Anthropic non-Sonnet-4 models", () => {
    expect(supports1MContext("anthropic:claude-opus-4-5")).toBe(false);
    expect(supports1MContext("anthropic:claude-haiku-4-5")).toBe(false);
  });
});

describe("isValidModelFormat", () => {
  it("returns true for valid model formats", () => {
    expect(isValidModelFormat("anthropic:claude-sonnet-4-5")).toBe(true);
    expect(isValidModelFormat("openai:gpt-5.2")).toBe(true);
    expect(isValidModelFormat("google:gemini-3-pro-preview")).toBe(true);
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

describe("resolveModelAlias", () => {
  it("resolves known aliases to full model strings", () => {
    expect(resolveModelAlias("haiku")).toBe("claude-code:claude-haiku-4-5");
    expect(resolveModelAlias("sonnet")).toBe("claude-code:claude-sonnet-4-5");
    expect(resolveModelAlias("opus")).toBe("claude-code:claude-opus-4-5");
    expect(resolveModelAlias("codex")).toBe("codex:gpt-5.2-codex");
    expect(resolveModelAlias("codex-5.1")).toBe("codex:gpt-5.1-codex");
  });

  it("returns non-alias strings unchanged", () => {
    expect(resolveModelAlias("anthropic:custom-model")).toBe("anthropic:custom-model");
    expect(resolveModelAlias("openai:gpt-5.2")).toBe("openai:gpt-5.2");
    expect(resolveModelAlias("unknown")).toBe("unknown");
  });
});
