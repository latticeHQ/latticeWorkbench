import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { cleanup, render, waitFor } from "@testing-library/react";

import { AgentProvider } from "@/browser/contexts/AgentContext";
import { consumeMinionModelChange } from "@/browser/utils/modelChange";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  AGENT_AI_DEFAULTS_KEY,
  getModelKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
} from "@/common/constants/storage";

import { MinionModeAISync } from "./MinionModeAISync";

let minionCounter = 0;

function nextMinionId(): string {
  minionCounter += 1;
  return `minion-mode-ai-sync-test-${minionCounter}`;
}

const noop = () => {
  // intentional noop for tests
};

function SyncHarness(props: { minionId: string; agentId: string }) {
  return (
    <AgentProvider
      value={{
        agentId: props.agentId,
        setAgentId: noop,
        currentAgent: undefined,
        agents: [],
        loaded: true,
        loadFailed: false,
        refresh: () => Promise.resolve(),
        refreshing: false,
        disableMinionAgents: false,
        setDisableMinionAgents: noop,
      }}
    >
      <MinionModeAISync minionId={props.minionId} />
    </AgentProvider>
  );
}

function renderSync(props: { minionId: string; agentId: string }) {
  return render(<SyncHarness minionId={props.minionId} agentId={props.agentId} />);
}

describe("MinionModeAISync", () => {
  beforeEach(() => {
    globalThis.window = new GlobalWindow() as unknown as Window & typeof globalThis;
    globalThis.document = globalThis.window.document;
    globalThis.localStorage = globalThis.window.localStorage;
    globalThis.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    globalThis.window = undefined as unknown as Window & typeof globalThis;
    globalThis.document = undefined as unknown as Document;
    globalThis.localStorage = undefined as unknown as Storage;
  });

  test("only records explicit model changes when agentId changes", async () => {
    const minionId = nextMinionId();

    const execModel = "openai:gpt-4o-mini";
    const planModel = "anthropic:claude-3-5-sonnet-latest";

    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {
      exec: { modelString: execModel },
      plan: { modelString: planModel },
    });

    // Start with a different model so the mount sync performs an update.
    updatePersistedState(getModelKey(minionId), "some-legacy-model");

    const { rerender } = renderSync({ minionId, agentId: "exec" });

    // Mount sync should update the model but NOT record an explicit change entry.
    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(execModel);
    });
    expect(consumeMinionModelChange(minionId, execModel)).toBeNull();

    // Switching agents (within the same minion) should be treated as explicit.
    rerender(<SyncHarness minionId={minionId} agentId="plan" />);

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(planModel);
    });
    expect(consumeMinionModelChange(minionId, planModel)).toBe("agent");
  });

  test("prefers configured agent defaults over minion-by-agent overrides", async () => {
    const minionId = nextMinionId();

    const configuredModel = "anthropic:claude-haiku-4-5";
    const configuredThinking = "off";
    const minionModel = "openai:gpt-5.2";
    const minionThinking = "high";

    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {
      exec: { modelString: configuredModel, thinkingLevel: configuredThinking },
    });
    updatePersistedState(getMinionAISettingsByAgentKey(minionId), {
      exec: { model: minionModel, thinkingLevel: minionThinking },
    });

    updatePersistedState(getModelKey(minionId), "some-legacy-model");
    updatePersistedState(getThinkingLevelKey(minionId), "medium");

    renderSync({ minionId, agentId: "exec" });

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(configuredModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "high")).toBe(configuredThinking);
    });
  });

  test("ignores minion-by-agent values when settings are inherit", async () => {
    const minionId = nextMinionId();

    const existingModel = "some-legacy-model";
    const existingThinking = "off";

    // Inherit in Settings removes explicit per-agent defaults from AGENT_AI_DEFAULTS_KEY.
    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {});
    updatePersistedState(getMinionAISettingsByAgentKey(minionId), {
      exec: { model: "openai:gpt-5.2", thinkingLevel: "medium" },
    });

    updatePersistedState(getModelKey(minionId), existingModel);
    updatePersistedState(getThinkingLevelKey(minionId), existingThinking);

    renderSync({ minionId, agentId: "exec" });

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(existingModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "off")).toBe(existingThinking);
    });
  });

  test("restores minion-by-agent override on explicit agent switch when defaults inherit", async () => {
    const minionId = nextMinionId();

    const planModel = "anthropic:claude-sonnet-4-5";
    const planThinking = "high";
    const execMinionModel = "openai:gpt-5.2-pro";
    const execMinionThinking = "medium";

    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {});
    updatePersistedState(getMinionAISettingsByAgentKey(minionId), {
      exec: { model: execMinionModel, thinkingLevel: execMinionThinking },
    });

    updatePersistedState(getModelKey(minionId), planModel);
    updatePersistedState(getThinkingLevelKey(minionId), planThinking);

    const { rerender } = renderSync({ minionId, agentId: "plan" });

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(planModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "off")).toBe(planThinking);
    });

    rerender(<SyncHarness minionId={minionId} agentId="exec" />);

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(execMinionModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "off")).toBe(
        execMinionThinking
      );
    });

    expect(consumeMinionModelChange(minionId, execMinionModel)).toBe("agent");
  });

  test("ignores same-agent minion overrides when agent defaults are missing", async () => {
    const minionId = nextMinionId();

    const existingModel = "some-legacy-model";
    const existingThinking = "high";

    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {
      exec: { modelString: "anthropic:claude-haiku-4-5", thinkingLevel: "off" },
    });
    updatePersistedState(getMinionAISettingsByAgentKey(minionId), {
      custom: { model: "openai:gpt-5.2-pro", thinkingLevel: "medium" },
    });

    updatePersistedState(getModelKey(minionId), existingModel);
    updatePersistedState(getThinkingLevelKey(minionId), existingThinking);

    renderSync({ minionId, agentId: "custom" });

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(existingModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "off")).toBe(existingThinking);
    });
  });

  test("does not inherit base defaults when selected agent has its own partial settings entry", async () => {
    const minionId = nextMinionId();

    const customConfiguredModel = "anthropic:claude-haiku-4-5";
    const baseConfiguredThinking = "off";

    updatePersistedState(AGENT_AI_DEFAULTS_KEY, {
      custom: { modelString: customConfiguredModel },
      exec: { thinkingLevel: baseConfiguredThinking },
    });

    updatePersistedState(getModelKey(minionId), "some-legacy-model");
    updatePersistedState(getThinkingLevelKey(minionId), "high");

    // Unknown non-plan agent IDs still use exec as fallback agent; this verifies
    // a partial custom settings entry blocks inheriting exec thinking defaults.
    renderSync({ minionId, agentId: "custom" });

    await waitFor(() => {
      expect(readPersistedState(getModelKey(minionId), "")).toBe(customConfiguredModel);
      expect(readPersistedState(getThinkingLevelKey(minionId), "off")).toBe("high");
    });
  });
});
