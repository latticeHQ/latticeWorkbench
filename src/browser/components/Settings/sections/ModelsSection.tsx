import React, { useCallback, useState } from "react";
import {
  Loader2,
  Plus,
} from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/ui/select";
import { useAPI } from "@/browser/contexts/API";
import { getSuggestedModels, useModelsFromSettings } from "@/browser/hooks/useModelsFromSettings";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import { SearchableModelSelect } from "../components/SearchableModelSelect";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { PROVIDER_DISPLAY_NAMES, SUPPORTED_PROVIDERS } from "@/common/constants/providers";
import {
  LAST_CUSTOM_MODEL_PROVIDER_KEY,
  PREFERRED_COMPACTION_MODEL_KEY,
} from "@/common/constants/storage";
import { ModelRow } from "./ModelRow";

// Table header component
function ModelsTableHeader({ showActions = true }: { showActions?: boolean }) {
  return (
    <thead>
      <tr className="border-border-medium bg-background-secondary/50 border-b">
        <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-muted">Provider</th>
        <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Model</th>
        <th className="w-14 py-1.5 pr-2 text-right text-[11px] font-medium text-muted md:w-16">Ctx</th>
        {showActions && (
          <th className="w-24 py-1.5 pr-3 text-right text-[11px] font-medium text-muted md:w-28" />
        )}
      </tr>
    </thead>
  );
}

interface EditingState {
  provider: string;
  originalModelId: string;
  newModelId: string;
}

export function ModelsSection() {
  const { api } = useAPI();
  const { config, loading, updateModelsOptimistically } = useProvidersConfig();
  const [lastProvider, setLastProvider] = usePersistedState(LAST_CUSTOM_MODEL_PROVIDER_KEY, "");
  const [newModelId, setNewModelId] = useState("");
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectableProviders = SUPPORTED_PROVIDERS;
  const { defaultModel, setDefaultModel, hiddenModels, hideModel, unhideModel } =
    useModelsFromSettings();

  // Compaction model preference
  const [compactionModel, setCompactionModel] = usePersistedState<string>(
    PREFERRED_COMPACTION_MODEL_KEY,
    "",
    { listener: true }
  );

  // All models (including hidden) for the settings dropdowns
  const allModels = getSuggestedModels(config);

  // ── Cloud model management ─────────────────────────────────────────────
  const modelExists = useCallback(
    (provider: string, modelId: string, excludeOriginal?: string): boolean => {
      if (!config) return false;
      const currentModels = config[provider]?.models ?? [];
      return currentModels.some((m) => m === modelId && m !== excludeOriginal);
    },
    [config]
  );

  const handleAddModel = useCallback(() => {
    if (!config || !lastProvider || !newModelId.trim()) return;
    const trimmedModelId = newModelId.trim();
    if (modelExists(lastProvider, trimmedModelId)) {
      setError(`Model "${trimmedModelId}" already exists for this provider`);
      return;
    }
    if (!api) return;
    setError(null);
    const updatedModels = updateModelsOptimistically(lastProvider, (models) => [
      ...models,
      trimmedModelId,
    ]);
    setNewModelId("");
    void api.providers.setModels({ provider: lastProvider, models: updatedModels });
  }, [api, lastProvider, newModelId, config, modelExists, updateModelsOptimistically]);

  const handleRemoveModel = useCallback(
    (provider: string, modelId: string) => {
      if (!config || !api) return;
      const updatedModels = updateModelsOptimistically(provider, (models) =>
        models.filter((m) => m !== modelId)
      );
      void api.providers.setModels({ provider, models: updatedModels });
    },
    [api, config, updateModelsOptimistically]
  );

  const handleStartEdit = useCallback((provider: string, modelId: string) => {
    setEditing({ provider, originalModelId: modelId, newModelId: modelId });
    setError(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditing(null);
    setError(null);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!config || !editing || !api) return;
    const trimmedModelId = editing.newModelId.trim();
    if (!trimmedModelId) {
      setError("Model ID cannot be empty");
      return;
    }
    if (trimmedModelId !== editing.originalModelId) {
      if (modelExists(editing.provider, trimmedModelId)) {
        setError(`Model "${trimmedModelId}" already exists for this provider`);
        return;
      }
    }
    setError(null);
    const updatedModels = updateModelsOptimistically(editing.provider, (models) =>
      models.map((m) => (m === editing.originalModelId ? trimmedModelId : m))
    );
    setEditing(null);
    void api.providers.setModels({ provider: editing.provider, models: updatedModels });
  }, [api, editing, config, modelExists, updateModelsOptimistically]);

  // Show loading state while config is being fetched
  if (loading || !config) {
    return (
      <div className="flex items-center justify-center gap-2 py-12">
        <Loader2 className="text-muted h-5 w-5 animate-spin" />
        <span className="text-muted text-xs">Loading...</span>
      </div>
    );
  }

  // Get all custom models across providers
  const getCustomModels = (): Array<{ provider: string; modelId: string; fullId: string }> => {
    const models: Array<{ provider: string; modelId: string; fullId: string }> = [];
    for (const [provider, providerConfig] of Object.entries(config)) {
      if (providerConfig.models) {
        for (const modelId of providerConfig.models) {
          models.push({ provider, modelId, fullId: `${provider}:${modelId}` });
        }
      }
    }
    return models;
  };

  // Get built-in models from KNOWN_MODELS
  const builtInModels = Object.values(KNOWN_MODELS).map((model) => ({
    provider: model.provider,
    modelId: model.providerModelId,
    fullId: model.id,
    aliases: model.aliases,
  }));

  const customModels = getCustomModels();

  return (
    <div className="space-y-4">
      {/* ── Defaults ─────────────────────────────────────────────────────── */}
      <div className="border-border-medium overflow-hidden rounded-md border">
        <div className="border-border-medium bg-background-secondary/50 border-b px-3 py-1.5">
          <span className="text-muted text-[11px] font-medium tracking-wide uppercase">Defaults</span>
        </div>
        <div className="divide-border-medium divide-y">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-28 shrink-0">
              <div className="text-foreground text-[11px]">Default Model</div>
              <div className="text-muted text-[10px]">New workspaces</div>
            </div>
            <div className="min-w-0 flex-1">
              <SearchableModelSelect
                value={defaultModel}
                onChange={setDefaultModel}
                models={allModels}
                placeholder="Select model"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-28 shrink-0">
              <div className="text-foreground text-[11px]">Compaction</div>
              <div className="text-muted text-[10px]">History summary</div>
            </div>
            <div className="min-w-0 flex-1">
              <SearchableModelSelect
                value={compactionModel}
                onChange={setCompactionModel}
                models={allModels}
                emptyOption={{ value: "", label: "Use workspace model" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── All Models (single unified table) ────────────────────────────── */}
      <div className="border-border-medium overflow-hidden rounded-md border">
        {/* Add custom model bar */}
        <div className="border-border-medium bg-background-secondary/50 flex flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
          <span className="text-muted mr-auto text-[11px] font-medium tracking-wide uppercase">Models</span>
          <Select value={lastProvider} onValueChange={setLastProvider}>
            <SelectTrigger className="bg-background border-border-medium focus:border-accent h-6 w-auto shrink-0 rounded border px-2 text-[11px]">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {selectableProviders.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {PROVIDER_DISPLAY_NAMES[provider]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            type="text"
            value={newModelId}
            onChange={(e) => setNewModelId(e.target.value)}
            placeholder="model-id"
            className="bg-background border-border-medium focus:border-accent w-36 min-w-0 rounded border px-2 py-0.5 font-mono text-[11px] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddModel();
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddModel}
            disabled={!lastProvider || !newModelId.trim()}
            className="h-6 shrink-0 gap-1 px-2 text-[11px]"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>

        {error && !editing && (
          <div className="text-error border-border-medium border-b px-3 py-1 text-[11px]">{error}</div>
        )}

        {/* Table */}
        <table className="w-full">
          <ModelsTableHeader />
          <tbody>
            {/* Custom models first */}
            {customModels.map((model) => {
              const isModelEditing =
                editing?.provider === model.provider &&
                editing?.originalModelId === model.modelId;
              return (
                <ModelRow
                  key={model.fullId}
                  provider={model.provider}
                  modelId={model.modelId}
                  fullId={model.fullId}
                  isCustom={true}
                  isDefault={defaultModel === model.fullId}
                  isEditing={isModelEditing}
                  editValue={isModelEditing ? editing.newModelId : undefined}
                  editError={isModelEditing ? error : undefined}
                  saving={false}
                  hasActiveEdit={editing !== null}
                  onSetDefault={() => setDefaultModel(model.fullId)}
                  onStartEdit={() => handleStartEdit(model.provider, model.modelId)}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onEditChange={(value) =>
                    setEditing((prev) => (prev ? { ...prev, newModelId: value } : null))
                  }
                  onRemove={() => handleRemoveModel(model.provider, model.modelId)}
                  isHiddenFromSelector={hiddenModels.includes(model.fullId)}
                  onToggleVisibility={() =>
                    hiddenModels.includes(model.fullId)
                      ? unhideModel(model.fullId)
                      : hideModel(model.fullId)
                  }
                />
              );
            })}

            {/* Separator between custom and built-in if both exist */}
            {customModels.length > 0 && builtInModels.length > 0 && (
              <tr className="border-border-medium border-b">
                <td colSpan={4} className="bg-background-secondary/30 px-3 py-1">
                  <span className="text-muted text-[10px] tracking-wide uppercase">Built-in</span>
                </td>
              </tr>
            )}

            {/* Built-in models */}
            {builtInModels.map((model) => (
              <ModelRow
                key={model.fullId}
                provider={model.provider}
                modelId={model.modelId}
                fullId={model.fullId}
                aliases={model.aliases}
                isCustom={false}
                isDefault={defaultModel === model.fullId}
                isEditing={false}
                onSetDefault={() => setDefaultModel(model.fullId)}
                isHiddenFromSelector={hiddenModels.includes(model.fullId)}
                onToggleVisibility={() =>
                  hiddenModels.includes(model.fullId)
                    ? unhideModel(model.fullId)
                    : hideModel(model.fullId)
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
