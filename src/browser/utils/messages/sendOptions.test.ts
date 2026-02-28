import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import {
  getModelKey,
  PREFERRED_SYSTEM_1_MODEL_KEY,
  PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY,
} from "@/common/constants/storage";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import { getSendOptionsFromStorage } from "./sendOptions";
import { normalizeModelPreference } from "./buildSendMessageOptions";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

describe("getSendOptionsFromStorage", () => {
  beforeEach(() => {
    const windowInstance = new GlobalWindow();
    (globalThis as any).window = windowInstance.window;
    (globalThis as any).document = windowInstance.window.document;
    (globalThis as any).location = new URL("https://example.com/");
    (globalThis as any).StorageEvent = windowInstance.window.StorageEvent;
    (globalThis as any).CustomEvent = windowInstance.window.CustomEvent;

    window.localStorage.clear();
    window.localStorage.setItem("model-default", JSON.stringify("openai:default"));
  });

  afterEach(() => {
    window.localStorage.clear();
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
    (globalThis as any).location = undefined;
    (globalThis as any).StorageEvent = undefined;
    (globalThis as any).CustomEvent = undefined;
  });

  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */

  test("normalizes stored model preference with shared helper", () => {
    const minionId = "ws-1";
    const rawModel = "anthropic:claude-haiku-4-5";

    window.localStorage.setItem(getModelKey(minionId), JSON.stringify(rawModel));

    const options = getSendOptionsFromStorage(minionId);
    const expectedModel = normalizeModelPreference(rawModel, "openai:default");

    expect(options.model).toBe(expectedModel);
    expect(options.thinkingLevel).toBe(MINION_DEFAULTS.thinkingLevel);
  });

  test("omits system1 thinking when set to off", () => {
    const minionId = "ws-2";

    window.localStorage.setItem(PREFERRED_SYSTEM_1_MODEL_KEY, JSON.stringify("openai:gpt-5.2"));
    window.localStorage.setItem(PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY, JSON.stringify("off"));

    const options = getSendOptionsFromStorage(minionId);
    expect(options.system1ThinkingLevel).toBeUndefined();

    window.localStorage.setItem(PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY, JSON.stringify("high"));
    const withThinking = getSendOptionsFromStorage(minionId);
    expect(withThinking.system1ThinkingLevel).toBe("high");
  });

  test("includes Anthropic prompt cache TTL from persisted provider options", () => {
    const minionId = "ws-3";

    window.localStorage.setItem(
      "provider_options_anthropic",
      JSON.stringify({
        cacheTtl: "1h",
      })
    );

    const options = getSendOptionsFromStorage(minionId);
    expect(options.providerOptions?.anthropic?.cacheTtl).toBe("1h");
  });
});
