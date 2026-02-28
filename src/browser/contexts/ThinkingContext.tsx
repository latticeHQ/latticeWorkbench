import type { ReactNode } from "react";
import React, { createContext, useContext, useEffect, useMemo, useCallback } from "react";
import { THINKING_LEVEL_OFF, type ThinkingLevel } from "@/common/types/thinking";
import {
  readPersistedState,
  updatePersistedState,
  usePersistedState,
} from "@/browser/hooks/usePersistedState";
import {
  getAgentIdKey,
  getModelKey,
  getProjectScopeId,
  getThinkingLevelByModelKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
  GLOBAL_SCOPE_ID,
} from "@/common/constants/storage";
import { getDefaultModel } from "@/browser/hooks/useModelsFromSettings";
import { enforceThinkingPolicy, getThinkingPolicyForModel } from "@/common/utils/thinking/policy";
import { useAPI } from "@/browser/contexts/API";
import {
  clearPendingMinionAiSettings,
  markPendingMinionAiSettings,
} from "@/browser/utils/minionAiSettingsSync";
import { KEYBINDS, matchesKeybind } from "@/browser/utils/ui/keybinds";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

interface ThinkingContextType {
  thinkingLevel: ThinkingLevel;
  setThinkingLevel: (level: ThinkingLevel) => void;
}

const ThinkingContext = createContext<ThinkingContextType | undefined>(undefined);

interface ThinkingProviderProps {
  minionId?: string; // Minion-scoped storage (highest priority)
  projectPath?: string; // Project-scoped storage (fallback if no minionId)
  children: ReactNode;
}

function getScopeId(minionId: string | undefined, projectPath: string | undefined): string {
  return minionId ?? (projectPath ? getProjectScopeId(projectPath) : GLOBAL_SCOPE_ID);
}

function getCanonicalModelForScope(scopeId: string, fallbackModel: string): string {
  const rawModel = readPersistedState<string>(getModelKey(scopeId), fallbackModel);
  return rawModel || fallbackModel;
}

export const ThinkingProvider: React.FC<ThinkingProviderProps> = (props) => {
  const { api } = useAPI();
  const defaultModel = getDefaultModel();
  const scopeId = getScopeId(props.minionId, props.projectPath);
  const thinkingKey = getThinkingLevelKey(scopeId);

  // Minion-scoped thinking. (No longer per-model.)
  const [thinkingLevel, setThinkingLevelInternal] = usePersistedState<ThinkingLevel>(
    thinkingKey,
    THINKING_LEVEL_OFF,
    { listener: true }
  );

  // One-time migration: if the new minion-scoped key is missing, seed from the legacy per-model key.
  useEffect(() => {
    const existing = readPersistedState<ThinkingLevel | undefined>(thinkingKey, undefined);
    if (existing !== undefined) {
      return;
    }

    const model = getCanonicalModelForScope(scopeId, defaultModel);
    const legacyKey = getThinkingLevelByModelKey(model);
    const legacy = readPersistedState<ThinkingLevel | undefined>(legacyKey, undefined);
    if (legacy === undefined) {
      return;
    }

    updatePersistedState(thinkingKey, legacy);
  }, [defaultModel, scopeId, thinkingKey]);

  const setThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      const model = getCanonicalModelForScope(scopeId, defaultModel);

      setThinkingLevelInternal(level);

      // Minion variant: persist to backend so settings follow the minion across devices.
      if (!props.minionId) {
        return;
      }

      const minionId = props.minionId;

      type MinionAISettingsByAgentCache = Partial<
        Record<string, { model: string; thinkingLevel: ThinkingLevel }>
      >;

      const normalizedAgentId =
        readPersistedState<string>(getAgentIdKey(scopeId), MINION_DEFAULTS.agentId)
          .trim()
          .toLowerCase() || MINION_DEFAULTS.agentId;

      updatePersistedState<MinionAISettingsByAgentCache>(
        getMinionAISettingsByAgentKey(minionId),
        (prev) => {
          const record: MinionAISettingsByAgentCache =
            prev && typeof prev === "object" ? prev : {};
          return {
            ...record,
            [normalizedAgentId]: { model, thinkingLevel: level },
          };
        },
        {}
      );

      if (!api) {
        return;
      }

      // Avoid stale backend metadata clobbering newer local preferences when users
      // click through levels quickly (tests reproduce this by cycling to xhigh).
      markPendingMinionAiSettings(minionId, normalizedAgentId, {
        model,
        thinkingLevel: level,
      });

      api.minion
        .updateAgentAISettings({
          minionId,
          agentId: normalizedAgentId,
          aiSettings: { model, thinkingLevel: level },
        })
        .then((result) => {
          if (!result.success) {
            clearPendingMinionAiSettings(minionId, normalizedAgentId);
          }
        })
        .catch(() => {
          clearPendingMinionAiSettings(minionId, normalizedAgentId);
          // Best-effort only. If offline or backend is old, the next sendMessage will persist.
        });
    },
    [api, defaultModel, props.minionId, scopeId, setThinkingLevelInternal]
  );

  // Global keybind: cycle thinking level (Ctrl/Cmd+Shift+T).
  // Implemented at the ThinkingProvider level so it works in both the minion view
  // and the "New Minion" creation screen (which doesn't mount AIView).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesKeybind(e, KEYBINDS.TOGGLE_THINKING)) {
        return;
      }

      e.preventDefault();

      const model = getCanonicalModelForScope(scopeId, defaultModel);
      const allowed = getThinkingPolicyForModel(model);
      if (allowed.length <= 1) {
        return;
      }

      const effectiveThinkingLevel = enforceThinkingPolicy(model, thinkingLevel);
      const currentIndex = allowed.indexOf(effectiveThinkingLevel);
      const nextIndex = (currentIndex + 1) % allowed.length;
      setThinkingLevel(allowed[nextIndex]);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [defaultModel, scopeId, thinkingLevel, setThinkingLevel]);

  // Memoize context value to prevent unnecessary re-renders of consumers.
  const contextValue = useMemo(
    () => ({ thinkingLevel, setThinkingLevel }),
    [thinkingLevel, setThinkingLevel]
  );

  return <ThinkingContext.Provider value={contextValue}>{props.children}</ThinkingContext.Provider>;
};

export const useThinking = () => {
  const context = useContext(ThinkingContext);
  if (!context) {
    throw new Error("useThinking must be used within a ThinkingProvider");
  }
  return context;
};
