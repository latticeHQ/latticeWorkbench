import {
  getAgentIdKey,
  getModelKey,
  getThinkingLevelByModelKey,
  getThinkingLevelKey,
  getDisableMinionAgentsKey,
  PREFERRED_SYSTEM_1_MODEL_KEY,
  PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY,
} from "@/common/constants/storage";
import {
  readPersistedState,
  readPersistedString,
  updatePersistedState,
} from "@/browser/hooks/usePersistedState";
import { getDefaultModel } from "@/browser/hooks/useModelsFromSettings";
import {
  buildSendMessageOptions,
  normalizeModelPreference,
  normalizeSystem1Model,
  normalizeSystem1ThinkingLevel,
} from "@/browser/utils/messages/buildSendMessageOptions";
import type { SendMessageOptions } from "@/common/orpc/types";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { LatticeProviderOptions } from "@/common/types/providerOptions";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import { isExperimentEnabled } from "@/browser/hooks/useExperiments";
import { EXPERIMENT_IDS } from "@/common/constants/experiments";

/**
 * Read provider options from localStorage
 */
function getProviderOptions(): LatticeProviderOptions {
  const anthropic = readPersistedState<LatticeProviderOptions["anthropic"]>(
    "provider_options_anthropic",
    {}
  );
  const google = readPersistedState<LatticeProviderOptions["google"]>("provider_options_google", {});

  return {
    anthropic,
    google,
  };
}

/**
 * Non-hook equivalent of useSendMessageOptions — reads current preferences from localStorage.
 * Used by compaction, resume, idle-compaction, and plan execution outside React context.
 */
export function getSendOptionsFromStorage(minionId: string): SendMessageOptions {
  const defaultModel = getDefaultModel();
  const rawModel = readPersistedState<string>(getModelKey(minionId), defaultModel);
  const baseModel = normalizeModelPreference(rawModel, defaultModel);

  // Read thinking level (minion-scoped).
  // Migration: if the minion-scoped value is missing, fall back to legacy per-model storage
  // once, then persist into the minion-scoped key.
  const scopedKey = getThinkingLevelKey(minionId);
  const existingScoped = readPersistedState<ThinkingLevel | undefined>(scopedKey, undefined);
  const thinkingLevel =
    existingScoped ??
    readPersistedState<ThinkingLevel>(
      getThinkingLevelByModelKey(baseModel),
      MINION_DEFAULTS.thinkingLevel
    );
  if (existingScoped === undefined) {
    // Best-effort: avoid losing a user's existing per-model preference.
    updatePersistedState<ThinkingLevel>(scopedKey, thinkingLevel);
  }

  const agentId = readPersistedState<string>(
    getAgentIdKey(minionId),
    MINION_DEFAULTS.agentId
  );

  const providerOptions = getProviderOptions();

  const system1Model = normalizeSystem1Model(readPersistedString(PREFERRED_SYSTEM_1_MODEL_KEY));
  const system1ThinkingLevel = normalizeSystem1ThinkingLevel(
    readPersistedState<unknown>(PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY, "off")
  );

  const disableMinionAgents = readPersistedState<boolean>(
    getDisableMinionAgentsKey(minionId),
    false
  );

  return buildSendMessageOptions({
    model: baseModel,
    system1Model,
    system1ThinkingLevel,
    agentId,
    thinkingLevel,
    providerOptions,
    disableMinionAgents,
    experiments: {
      programmaticToolCalling: isExperimentEnabled(EXPERIMENT_IDS.PROGRAMMATIC_TOOL_CALLING),
      programmaticToolCallingExclusive: isExperimentEnabled(
        EXPERIMENT_IDS.PROGRAMMATIC_TOOL_CALLING_EXCLUSIVE
      ),
      system1: isExperimentEnabled(EXPERIMENT_IDS.SYSTEM_1),
      execSidekickHardRestart: isExperimentEnabled(EXPERIMENT_IDS.EXEC_SIDEKICK_HARD_RESTART),
    },
  });
}
