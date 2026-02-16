import { describe, expect, test } from "bun:test";
import { filterHiddenModels, getSuggestedModels } from "./useModelsFromSettings";
import type { ProvidersConfigMap } from "@/common/orpc/types";

describe("getSuggestedModels", () => {
  test("returns custom models from config", () => {
    const config: ProvidersConfigMap = {
      "claude-code": { apiKeySet: false, isConfigured: true, models: ["claude-sonnet-4-5"] },
      codex: { apiKeySet: false, isConfigured: true, models: ["gpt-4.1"] },
    };

    const suggested = getSuggestedModels(config);

    expect(suggested).toContain("claude-code:claude-sonnet-4-5");
    expect(suggested).toContain("codex:gpt-4.1");
    expect(suggested.length).toBe(2);
  });

  test("returns empty array for null config", () => {
    expect(getSuggestedModels(null)).toEqual([]);
  });
});

describe("filterHiddenModels", () => {
  test("filters out hidden models", () => {
    expect(filterHiddenModels(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
});
