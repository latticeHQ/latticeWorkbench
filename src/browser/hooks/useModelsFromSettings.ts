import { useCallback, useMemo } from "react";
import { readPersistedString, usePersistedState } from "./usePersistedState";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import {
  isCodexOauthAllowedModelId,
  isCodexOauthRequiredModelId,
} from "@/common/constants/codexOAuth";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import { useProvidersConfig } from "./useProvidersConfig";
import { usePolicy } from "@/browser/contexts/PolicyContext";
import { useAPI } from "@/browser/contexts/API";
import { isValidProvider } from "@/common/constants/providers";
import { isModelAllowedByPolicy } from "@/browser/utils/policyUi";
import { getModelProvider } from "@/common/utils/ai/models";
import type { ProviderModelEntry, ProvidersConfigMap } from "@/common/orpc/types";
import { DEFAULT_MODEL_KEY, HIDDEN_MODELS_KEY } from "@/common/constants/storage";

import { getProviderModelEntryId } from "@/common/utils/providers/modelEntries";

const BUILT_IN_MODELS: string[] = Object.values(KNOWN_MODELS).map((m) => m.id);
const BUILT_IN_MODEL_SET = new Set<string>(BUILT_IN_MODELS);

function getCustomModels(config: ProvidersConfigMap | null): string[] {
  if (!config) return [];
  const models: string[] = [];
  for (const [provider, info] of Object.entries(config)) {
    // Only surface custom models from enabled providers
    if (!info.isEnabled) continue;
    if (!info.models) continue;
    for (const modelEntry of info.models) {
      const modelId = getProviderModelEntryId(modelEntry);
      models.push(`${provider}:${modelId}`);
    }
  }
  return models;
}

/** A provider is available only when it is enabled and has credentials configured. */
function isProviderAvailable(config: ProvidersConfigMap | null, provider: string): boolean {
  if (config == null) return true; // Config is loading/unknown; avoid temporary hiding flicker.

  const info = config[provider];
  // Unknown providers are treated as available so we do not hide valid models by default.
  if (!info) return true;

  return info.isEnabled && info.isConfigured;
}

function getAllCustomModels(config: ProvidersConfigMap | null): string[] {
  if (!config) return [];

  const models: string[] = [];
  for (const [provider, info] of Object.entries(config)) {
    if (!info.models) continue;

    for (const modelEntry of info.models) {
      const modelId = getProviderModelEntryId(modelEntry);
      models.push(`${provider}:${modelId}`);
    }
  }

  return models;
}

export function filterHiddenModels(models: string[], hiddenModels: string[]): string[] {
  if (hiddenModels.length === 0) {
    return models;
  }

  const hidden = new Set(hiddenModels);
  return models.filter((m) => !hidden.has(m));
}
function dedupeKeepFirst(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

export function getSuggestedModels(config: ProvidersConfigMap | null): string[] {
  const customModels = getCustomModels(config);
  return dedupeKeepFirst([...customModels, ...BUILT_IN_MODELS]);
}

export function getDefaultModel(): string {
  const fallback = MINION_DEFAULTS.model;
  const persisted = readPersistedString(DEFAULT_MODEL_KEY);
  if (!persisted) return fallback;

  const canonical = persisted.trim();
  return canonical || fallback;
}

/**
 * Source-of-truth for selectable models.
 *
 * The model selector should be driven by Settings (built-in + custom).
 * When a model is selected that isn't built-in, we persist it into Settings so it becomes
 * discoverable/manageable there.
 */
export function useModelsFromSettings() {
  const policyState = usePolicy();
  const effectivePolicy =
    policyState.status.state === "enforced" ? (policyState.policy ?? null) : null;
  const { api } = useAPI();

  const persistModelPrefs = useCallback(
    (patch: { defaultModel?: string; hiddenModels?: string[] }) => {
      if (!api?.config?.updateModelPreferences) {
        return;
      }

      api.config.updateModelPreferences(patch).catch(() => {
        // Best-effort only; startup seeding will heal the cache next time.
      });
    },
    [api]
  );
  const { config, refresh } = useProvidersConfig();

  const [defaultModel, setDefaultModel] = usePersistedState<string>(
    DEFAULT_MODEL_KEY,
    MINION_DEFAULTS.model,
    { listener: true }
  );

  const setDefaultModelAndPersist = useCallback(
    (next: string | ((prev: string) => string)) => {
      setDefaultModel((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        const canonical = resolved.trim();
        const canonicalPrev = prev.trim();

        if (canonical !== canonicalPrev) {
          persistModelPrefs({ defaultModel: canonical });
        }

        return canonical;
      });
    },
    [persistModelPrefs, setDefaultModel]
  );

  const [hiddenModels, setHiddenModels] = usePersistedState<string[]>(HIDDEN_MODELS_KEY, [], {
    listener: true,
  });

  const customModels = useMemo(() => {
    const next = filterHiddenModels(getCustomModels(config), hiddenModels);
    return effectivePolicy ? next.filter((m) => isModelAllowedByPolicy(effectivePolicy, m)) : next;
  }, [config, hiddenModels, effectivePolicy]);

  const openaiApiKeySet = config === null ? null : config.openai?.apiKeySet === true;
  const codexOauthSet = config === null ? null : config.openai?.codexOauthSet === true;

  const providerHiddenModels = useMemo(() => {
    if (config == null) {
      return [];
    }

    const allModels = dedupeKeepFirst([...getAllCustomModels(config), ...BUILT_IN_MODELS]);
    const userHiddenSet = new Set(hiddenModels);

    const hasOpenaiApiKey = openaiApiKeySet === true;
    const hasCodexOauth = codexOauthSet === true;

    const next = allModels.filter((modelId) => {
      if (userHiddenSet.has(modelId)) {
        return false;
      }

      const provider = getModelProvider(modelId);
      if (provider === "" || isProviderAvailable(config, provider)) {
        return false;
      }

      // Exclude OpenAI models that would also be filtered by OAuth gating.
      // Surfacing them in the hidden bucket would let users select models that
      // fail at send time (oauth_not_connected / api_key_not_found).
      if (modelId.startsWith("openai:")) {
        if (!hasOpenaiApiKey && hasCodexOauth) {
          return isCodexOauthAllowedModelId(modelId);
        }
        if (hasOpenaiApiKey && hasCodexOauth) {
          return true;
        }
        return !isCodexOauthRequiredModelId(modelId);
      }

      return true;
    });

    return effectivePolicy ? next.filter((m) => isModelAllowedByPolicy(effectivePolicy, m)) : next;
  }, [
    config,
    hiddenModels,
    effectivePolicy,
    openaiApiKeySet,
    codexOauthSet,
  ]);

  const hiddenModelsForSelector = useMemo(
    () => dedupeKeepFirst([...hiddenModels, ...providerHiddenModels]),
    [hiddenModels, providerHiddenModels]
  );

  const models = useMemo(() => {
    const suggested = filterHiddenModels(getSuggestedModels(config), hiddenModels);

    // Hide models from providers that are disabled or not configured.
    // Keep all models visible while provider config is still loading to avoid UI flicker.
    const providerFiltered =
      config == null
        ? suggested
        : suggested.filter((modelId) => {
            if (isProviderAvailable(config, getModelProvider(modelId))) {
              return true;
            }

            return false;
          });

    if (config == null) {
      return effectivePolicy
        ? providerFiltered.filter((m) => isModelAllowedByPolicy(effectivePolicy, m))
        : providerFiltered;
    }
    const hasOpenaiApiKey = openaiApiKeySet === true;
    const hasCodexOauth = codexOauthSet === true;

    // OpenAI model gating:
    // - API key + OAuth: allow everything.
    // - API key only: hide models that require OAuth.
    // - OAuth only: show only models routable via OAuth.
    // - Neither: hide models that require OAuth (status quo).
    const next = providerFiltered.filter((modelId) => {
      if (!modelId.startsWith("openai:")) {
        return true;
      }

      if (hasOpenaiApiKey && hasCodexOauth) {
        return true;
      }

      if (!hasOpenaiApiKey && hasCodexOauth) {
        return isCodexOauthAllowedModelId(modelId);
      }

      return !isCodexOauthRequiredModelId(modelId);
    });

    return effectivePolicy ? next.filter((m) => isModelAllowedByPolicy(effectivePolicy, m)) : next;
  }, [
    config,
    hiddenModels,
    effectivePolicy,
    openaiApiKeySet,
    codexOauthSet,
  ]);

  /**
   * If a model is selected that isn't built-in, persist it as a provider custom model.
   */
  const ensureModelInSettings = useCallback(
    (modelString: string) => {
      if (!api) return;

      const canonical = modelString.trim();
      if (!canonical) return;
      if (BUILT_IN_MODEL_SET.has(canonical)) return;

      if (!isModelAllowedByPolicy(effectivePolicy, canonical)) {
        return;
      }

      const colonIndex = canonical.indexOf(":");
      if (colonIndex === -1) return;

      const provider = canonical.slice(0, colonIndex);
      const modelId = canonical.slice(colonIndex + 1);
      if (!provider || !modelId) return;
      if (!isValidProvider(provider)) return;

      const run = async () => {
        const providerConfig = config ?? (await api.providers.getConfig());
        const existingModels: ProviderModelEntry[] = providerConfig[provider]?.models ?? [];
        if (existingModels.some((entry) => getProviderModelEntryId(entry) === modelId)) return;

        await api.providers.setModels({ provider, models: [...existingModels, modelId] });
        await refresh();
      };

      run().catch(() => {
        // Ignore failures - user can still manage models via Settings
      });
    },
    [api, config, refresh, effectivePolicy]
  );

  const hideModel = useCallback(
    (modelString: string) => {
      const canonical = modelString.trim();
      if (!canonical) {
        return;
      }

      setHiddenModels((prev) => {
        if (prev.includes(canonical)) {
          return prev;
        }

        const nextHiddenModels = [...prev, canonical];
        persistModelPrefs({ hiddenModels: nextHiddenModels });
        return nextHiddenModels;
      });
    },
    [persistModelPrefs, setHiddenModels]
  );

  const unhideModel = useCallback(
    (modelString: string) => {
      const canonical = modelString.trim();
      if (!canonical) {
        return;
      }

      setHiddenModels((prev) => {
        const nextHiddenModels = prev.filter((m) => m !== canonical);
        if (nextHiddenModels.length === prev.length) {
          return prev;
        }

        persistModelPrefs({ hiddenModels: nextHiddenModels });
        return nextHiddenModels;
      });
    },
    [persistModelPrefs, setHiddenModels]
  );

  return {
    ensureModelInSettings,
    models,
    customModels,
    hiddenModels,
    hiddenModelsForSelector,
    hideModel,
    unhideModel,
    defaultModel,
    setDefaultModel: setDefaultModelAndPersist,
    openaiApiKeySet,
    codexOauthSet,
  };
}
