import { useCallback, useMemo } from "react";
import { readPersistedState, usePersistedState } from "./usePersistedState";
import { WORKSPACE_DEFAULTS } from "@/constants/workspaceDefaults";
import { useProvidersConfig } from "./useProvidersConfig";
import { useCliAgentDetection } from "./useCliAgentDetection";
import { useAPI } from "@/browser/contexts/API";
import { CLI_AGENT_SLUGS } from "@/common/constants/cliAgents";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import type { CliAgentDetectionResult, ProvidersConfigMap } from "@/common/orpc/types";

const HIDDEN_MODELS_KEY = "hidden-models";
const DEFAULT_MODEL_KEY = "model-default";

const CLI_AGENT_SLUG_SET = new Set<string>(CLI_AGENT_SLUGS);

/**
 * Fallback model list from KNOWN_MODELS — used when no CLI agents are detected yet
 * (e.g., during initial load or if detection fails). Ensures the model picker is never empty.
 */
const FALLBACK_MODELS: string[] = Object.values(KNOWN_MODELS).map((m) => m.id);

/**
 * Derive model strings from detected CLI agents with supportedModels.
 * Returns `slug:modelId` entries for detected agents.
 */
function getCliAgentModels(detectedAgents: CliAgentDetectionResult[]): string[] {
  const models: string[] = [];
  for (const agent of detectedAgents) {
    if (!agent.detected || !agent.supportedModels?.length) continue;
    for (const modelId of agent.supportedModels) {
      models.push(`${agent.slug}:${modelId}`);
    }
  }
  return models;
}

/**
 * Get custom models added by the user (e.g., additional models for agents).
 */
function getCustomModels(config: ProvidersConfigMap | null): string[] {
  if (!config) return [];
  const models: string[] = [];
  for (const [provider, info] of Object.entries(config)) {
    if (!info.models) continue;
    for (const modelId of info.models) {
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

/**
 * Get suggested models from config (compatibility shim).
 * In the agent-only architecture, this returns custom models from the config.
 * Used by System1Section and other consumers that need a flat model list.
 */
export function getSuggestedModels(config: ProvidersConfigMap | null): string[] {
  return getCustomModels(config);
}

export function getDefaultModel(): string {
  const fallback = WORKSPACE_DEFAULTS.model;
  const persisted = readPersistedState<string | null>(DEFAULT_MODEL_KEY, null);
  if (!persisted) return fallback;
  return persisted;
}

/**
 * Source-of-truth for selectable models.
 *
 * Agent-only architecture: models come exclusively from detected CLI agents.
 * Custom models (user-added) are supported for extending agent model lists.
 * No built-in SDK provider models.
 */
export function useModelsFromSettings() {
  const { api } = useAPI();
  const { config, refresh } = useProvidersConfig();
  const { detectedAgents, loading: agentDetectionLoading } = useCliAgentDetection();

  const [defaultModel, setDefaultModel] = usePersistedState<string>(
    DEFAULT_MODEL_KEY,
    WORKSPACE_DEFAULTS.model,
    { listener: true }
  );

  const [hiddenModels, setHiddenModels] = usePersistedState<string[]>(HIDDEN_MODELS_KEY, [], {
    listener: true,
  });

  // Models from detected CLI agents (e.g. claude-code:claude-sonnet-4-5)
  const cliModels = useMemo(() => getCliAgentModels(detectedAgents), [detectedAgents]);

  const customModels = useMemo(
    () => filterHiddenModels(getCustomModels(config), hiddenModels),
    [config, hiddenModels]
  );

  // Agent models first, then any user-added custom models.
  // Falls back to KNOWN_MODELS if no agents detected (e.g., detection in-flight or failed).
  const models = useMemo(() => {
    const agentModels = dedupeKeepFirst([...cliModels, ...customModels]);
    const baseModels = agentModels.length > 0 ? agentModels : FALLBACK_MODELS;
    return filterHiddenModels(baseModels, hiddenModels);
  }, [cliModels, customModels, hiddenModels]);

  /**
   * If a model is selected that isn't already known, persist it as a custom model.
   */
  const ensureModelInSettings = useCallback(
    (modelString: string) => {
      if (!api) return;

      const canonical = modelString.trim();
      if (!canonical) return;

      const colonIndex = canonical.indexOf(":");
      if (colonIndex === -1) return;

      const provider = canonical.slice(0, colonIndex);
      const modelId = canonical.slice(colonIndex + 1);
      if (!provider || !modelId) return;
      // Only accept CLI agent slugs
      if (!CLI_AGENT_SLUG_SET.has(provider)) return;

      const run = async () => {
        const providerConfig = config ?? (await api.providers.getConfig());
        const existingModels = providerConfig[provider]?.models ?? [];
        if (existingModels.includes(modelId)) return;

        await api.providers.setModels({ provider, models: [...existingModels, modelId] });
        await refresh();
      };

      run().catch(() => {
        // Ignore failures - user can still manage models via Settings
      });
    },
    [api, config, refresh]
  );

  const hideModel = useCallback(
    (modelString: string) => {
      const canonical = modelString.trim();
      if (!canonical) {
        return;
      }
      setHiddenModels((prev) => (prev.includes(canonical) ? prev : [...prev, canonical]));
    },
    [setHiddenModels]
  );

  const unhideModel = useCallback(
    (modelString: string) => {
      const canonical = modelString.trim();
      if (!canonical) {
        return;
      }
      setHiddenModels((prev) => prev.filter((m) => m !== canonical));
    },
    [setHiddenModels]
  );

  // True while initial agent detection is still in flight (models may be fallbacks)
  const isDetecting = agentDetectionLoading && cliModels.length === 0;

  // Slugs of detected agents (for health checks)
  const detectedSlugs = useMemo(() => detectedAgents.map((a) => a.slug), [detectedAgents]);

  return {
    ensureModelInSettings,
    models,
    customModels,
    hiddenModels,
    hideModel,
    unhideModel,
    defaultModel,
    setDefaultModel,
    /** True while CLI agent detection is running and no agents found yet */
    isDetecting,
    /** Slugs of detected CLI agents (for health checks) */
    detectedSlugs,
  };
}
