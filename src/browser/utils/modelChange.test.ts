import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";

import {
  consumeMinionModelChange,
  setMinionModelWithOrigin,
} from "@/browser/utils/modelChange";

let minionCounter = 0;

function nextMinionId(): string {
  minionCounter += 1;
  return `model-change-test-${minionCounter}`;
}

describe("modelChange", () => {
  beforeEach(() => {
    globalThis.window = new GlobalWindow() as unknown as Window & typeof globalThis;
    globalThis.document = globalThis.window.document;
    globalThis.localStorage = globalThis.window.localStorage;
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    globalThis.window = undefined as unknown as Window & typeof globalThis;
    globalThis.document = undefined as unknown as Document;
    globalThis.localStorage = undefined as unknown as Storage;
  });

  test("does not record explicit entries for no-op model changes", () => {
    const minionId = nextMinionId();
    const model = "openai:gpt-5.2-codex";
    const otherModel = "anthropic:claude-sonnet-4-5";

    setMinionModelWithOrigin(minionId, model, "sync");

    // Simulate user selecting the already-active model.
    setMinionModelWithOrigin(minionId, model, "user");

    expect(consumeMinionModelChange(minionId, model)).toBeNull();

    // A later sync-driven away→back transition should not misclassify as explicit.
    expect(consumeMinionModelChange(minionId, otherModel)).toBeNull();
    expect(consumeMinionModelChange(minionId, model)).toBeNull();
  });

  test("clears stale explicit entries once the model diverges", () => {
    const minionId = nextMinionId();

    const previousModel = "anthropic:claude-sonnet-4-5";
    const targetModel = "openai:gpt-5.2-codex";
    const divergedModel = "openai:gpt-4o-mini";

    setMinionModelWithOrigin(minionId, previousModel, "sync");

    // Record an explicit change to targetModel.
    setMinionModelWithOrigin(minionId, targetModel, "user");

    // If the store reports a totally different model first, the pending entry is stale.
    expect(consumeMinionModelChange(minionId, divergedModel)).toBeNull();

    // Returning to targetModel later should not consume the stale entry.
    expect(consumeMinionModelChange(minionId, targetModel)).toBeNull();
  });

  test("keeps pending entries when the model briefly reports the previous value", () => {
    const minionId = nextMinionId();

    const initialModel = "anthropic:claude-sonnet-4-5";
    const firstModel = "openai:gpt-5.2-codex";
    const secondModel = "openai:gpt-4o-mini";

    setMinionModelWithOrigin(minionId, initialModel, "sync");

    setMinionModelWithOrigin(minionId, firstModel, "user");
    setMinionModelWithOrigin(minionId, secondModel, "user");

    // Rapid A→B: if we observe A while tracking B, keep the pending B entry.
    expect(consumeMinionModelChange(minionId, firstModel)).toBeNull();
    expect(consumeMinionModelChange(minionId, secondModel)).toBe("user");
  });
});
