/**
 * Unit tests for name generation model selection fallback.
 *
 * Agent-only architecture: tests verify that:
 * 1. Preferred CLI agent models are tried in order
 * 2. When preferred models aren't available, user's model is tried
 * 3. Returns null when no CLI agents are detected
 */

import { describe, it, expect, mock } from "bun:test";
import { selectModelForNameGeneration } from "@/node/services/workspaceTitleGenerator";
import type { AIService } from "@/node/services/aiService";
import { Ok, Err, type Result } from "@/common/types/result";
import type { SendMessageError } from "@/common/types/errors";
import type { LanguageModel } from "ai";

// Helper to create a mock AI service that only "succeeds" for specific models
function createMockAiService(availableModels: Set<string>): Pick<AIService, "createModel"> {
  return {
    createModel: mock((modelId: string): Promise<Result<LanguageModel, SendMessageError>> => {
      if (availableModels.has(modelId)) {
        // Return a mock LanguageModel (we just need success status)
        return Promise.resolve(Ok({ modelId } as unknown as LanguageModel));
      }
      return Promise.resolve(
        Err({ type: "provider_not_supported", provider: modelId.split(":")[0] })
      );
    }),
  };
}

describe("selectModelForNameGeneration", () => {
  it("returns first available preferred CLI agent model", async () => {
    const mockService = createMockAiService(
      new Set(["claude-code:claude-sonnet-4-5", "codex:gpt-4.1"])
    );

    const result = await selectModelForNameGeneration(mockService as AIService, [
      "claude-code:claude-sonnet-4-5",
      "codex:gpt-4.1",
    ]);

    expect(result).toBe("claude-code:claude-sonnet-4-5");
  });

  it("skips unavailable agents and tries next in list", async () => {
    // Only Codex is installed
    const mockService = createMockAiService(new Set(["codex:gpt-4.1"]));

    const result = await selectModelForNameGeneration(mockService as AIService, [
      "claude-code:claude-sonnet-4-5",
      "codex:gpt-4.1",
    ]);

    expect(result).toBe("codex:gpt-4.1");
  });

  it("falls back to user's model when preferred agents aren't available", async () => {
    // User has Gemini configured
    const mockService = createMockAiService(new Set(["gemini:gemini-2.5-flash"]));

    const result = await selectModelForNameGeneration(
      mockService as AIService,
      ["claude-code:claude-sonnet-4-5", "codex:gpt-4.1"], // preferred models unavailable
      "gemini:gemini-2.5-flash" // user's model
    );

    expect(result).toBe("gemini:gemini-2.5-flash");
  });

  it("returns null when no CLI agents are available", async () => {
    const mockService = createMockAiService(new Set()); // No agents installed

    const result = await selectModelForNameGeneration(mockService as AIService, [
      "claude-code:claude-sonnet-4-5",
      "codex:gpt-4.1",
    ]);

    expect(result).toBeNull();
  });

  it("prefers cheap models over user's potentially expensive model", async () => {
    // Both Claude Code Sonnet (cheap) and user's Opus (expensive) are available
    const mockService = createMockAiService(
      new Set(["claude-code:claude-sonnet-4-5", "claude-code:claude-opus-4-5"])
    );

    const result = await selectModelForNameGeneration(
      mockService as AIService,
      ["claude-code:claude-sonnet-4-5"],
      "claude-code:claude-opus-4-5" // user's expensive model
    );

    // Should prefer cheap Sonnet over expensive Opus
    expect(result).toBe("claude-code:claude-sonnet-4-5");
  });

  it("uses default models when no preferred list provided", async () => {
    // Claude Code is installed (first in DEFAULT_NAME_GENERATION_MODELS)
    const mockService = createMockAiService(new Set(["claude-code:claude-sonnet-4-5"]));

    const result = await selectModelForNameGeneration(mockService as AIService);

    expect(result).toBe("claude-code:claude-sonnet-4-5");
  });

  it("returns null when user model also unavailable", async () => {
    const mockService = createMockAiService(new Set()); // Nothing available

    const result = await selectModelForNameGeneration(
      mockService as AIService,
      ["claude-code:claude-sonnet-4-5"],
      "codex:gpt-4.1" // user model also not available
    );

    expect(result).toBeNull();
  });
});
