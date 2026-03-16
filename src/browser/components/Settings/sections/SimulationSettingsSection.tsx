/**
 * SimulationSettingsSection — Settings UI for configuring the simulation engine.
 *
 * Features:
 * - Provider status overview (reads from existing Providers config — no duplication)
 * - Claude Code and Lattice Inference as first-class subprocess providers
 * - Model routing configuration (which model per simulation task)
 * - FalkorDB / Graph DB system status
 *
 * API keys are managed in Settings > Providers — this section shows status only
 * and links there for editing, avoiding duplicate key configuration.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  Cpu,
  Loader2,
  RefreshCw,
  Settings,
  Sliders,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { PROVIDER_DEFINITIONS } from "@/common/constants/providers";
import { getProviderModelEntryId } from "@/common/utils/providers/modelEntries";
import { Button } from "@/browser/components/ui/button";

// ---------------------------------------------------------------------------
// Provider definitions for simulation
// ---------------------------------------------------------------------------

interface SimProviderDef {
  key: string;
  label: string;
  description: string;
}

/** API-key providers that simulation can use (reads status from Providers config) */
const API_PROVIDERS: SimProviderDef[] = [
  { key: "anthropic", label: "Anthropic", description: "Claude models for Tier 1 reasoning and persona generation" },
  { key: "google", label: "Google AI", description: "Gemini models for Tier 2 agents and classification" },
  { key: "openai", label: "OpenAI", description: "GPT models as alternative agent backbone" },
  { key: "xai", label: "xAI", description: "Grok models for reasoning and classification" },
  { key: "deepseek", label: "DeepSeek", description: "Cost-effective models for agent tiers" },
  { key: "openrouter", label: "OpenRouter", description: "100+ models through a single key" },
];

// Human-readable labels for model route keys
const ROUTE_LABELS: Record<string, { label: string; description: string }> = {
  tier1_reasoning: { label: "Tier 1 — Reasoning", description: "Key decision-makers (highest quality)" },
  tier2_agents: { label: "Tier 2 — Agents", description: "Active participants (fast, high volume)" },
  tier3_agents: { label: "Tier 3 — Local", description: "Background actors (free, local inference)" },
  ontology: { label: "Ontology", description: "Knowledge graph entity extraction" },
  persona_generation: { label: "Persona Gen", description: "Agent profile creation" },
  report_react: { label: "Report (ReACT)", description: "Analysis report generation" },
  embeddings: { label: "Embeddings", description: "Semantic embeddings for search" },
  classification: { label: "Classification", description: "Content topic classification" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SimulationSettingsSection: React.FC = () => {
  const { api } = useAPI();
  const settings = useSettings();
  const { config: providersConfig, loading: providersLoading } = useProvidersConfig();

  // -- Model routing state (built client-side from KNOWN_MODELS + provider config) --
  const [currentRouting, setCurrentRouting] = useState<Record<string, { provider: string; model: string }>>({});
  const [routingExpanded, setRoutingExpanded] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  // Build available models client-side — same data source as chat model selector
  const models = useMemo(() => {
    const result: Array<{ id: string; provider: string; providerDisplayName: string; modelId: string }> = [];

    // 1. Add all KNOWN_MODELS, filtering by provider availability
    for (const model of Object.values(KNOWN_MODELS)) {
      const provider = model.provider;
      const providerDef = PROVIDER_DEFINITIONS[provider as keyof typeof PROVIDER_DEFINITIONS];
      if (!providerDef) continue;

      const info = providersConfig?.[provider];
      // Provider is available if: no config yet (unknown = available), or enabled + configured/no-key-needed
      const isAvailable = !info || (info.isEnabled && (info.isConfigured || !providerDef.requiresApiKey));
      if (!isAvailable) continue;

      result.push({
        id: `${provider}:${model.providerModelId}`,
        provider,
        providerDisplayName: providerDef.displayName,
        modelId: model.providerModelId,
      });
    }

    // 2. Add custom models from provider config
    if (providersConfig) {
      for (const [provider, info] of Object.entries(providersConfig)) {
        if (!info.isEnabled || !info.models) continue;
        const providerDef = PROVIDER_DEFINITIONS[provider as keyof typeof PROVIDER_DEFINITIONS];
        for (const modelEntry of info.models) {
          const modelId = getProviderModelEntryId(modelEntry);
          if (!modelId) continue;
          const fullId = `${provider}:${modelId}`;
          if (result.some((m) => m.id === fullId)) continue;
          result.push({
            id: fullId,
            provider,
            providerDisplayName: providerDef?.displayName ?? provider,
            modelId,
          });
        }
      }
    }

    return result;
  }, [providersConfig]);

  // -- Setup status --
  const [setupStatus, setSetupStatus] = useState<{
    llmProviderConfigured: boolean;
    dockerAvailable: boolean;
    falkorDbContainerRunning: boolean;
    graphDbConnected: boolean;
    graphDbHost: string;
    graphDbPort: number;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Load setup status from backend
  // ---------------------------------------------------------------------------

  const loadSetup = useCallback(async () => {
    if (!api) return;
    try {
      const result = await (api as any).simulation.checkSetup();
      setSetupStatus(result);
    } catch {
      // Not critical
    }
  }, [api]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  // Read status for all providers (including subprocess) from the same config
  const claudeCodeInfo = providersConfig?.["claude-code"];
  const claudeCodeReady = claudeCodeInfo?.isConfigured && claudeCodeInfo?.isEnabled;
  const latticeInferenceInfo = providersConfig?.["lattice-inference"];
  const latticeInferenceReady = latticeInferenceInfo?.isConfigured && latticeInferenceInfo?.isEnabled;

  const configuredApiProviders = API_PROVIDERS.filter((p) => {
    const info = providersConfig?.[p.key];
    return info?.isConfigured && info?.isEnabled;
  });

  const totalAvailable = configuredApiProviders.length +
    (claudeCodeReady ? 1 : 0) +
    (latticeInferenceReady ? 1 : 0);

  // ---------------------------------------------------------------------------
  // Model routing update
  // ---------------------------------------------------------------------------

  const handleRouteChange = useCallback(
    (routeKey: string, modelId: string) => {
      if (!modelId) return;
      const [provider, ...modelParts] = modelId.split(":");
      const model = modelParts.join(":");
      if (!provider || !model) return;

      setCurrentRouting((prev) => ({ ...prev, [routeKey]: { provider, model } }));
      setDirty(true);
      setSaveResult(null);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!api) return;
    setSaving(true);
    setSaveResult(null);
    try {
      // Persist each route to backend
      for (const [routeKey, route] of Object.entries(currentRouting)) {
        await (api as any).simulation.updateModelRouting({
          routeKey,
          provider: route.provider,
          model: route.model,
        });
      }
      setDirty(false);
      setSaveResult("success");
      setTimeout(() => setSaveResult(null), 3000);
    } catch {
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  }, [api, currentRouting]);

  // Group models by provider
  const modelsByProvider = models.reduce<Record<string, typeof models>>(
    (acc, m) => {
      (acc[m.providerDisplayName] ??= []).push(m);
      return acc;
    },
    {},
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header with status */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          {setupStatus && (
            <div className="flex items-center gap-2">
              <Circle
                className={`h-2.5 w-2.5 ${
                  setupStatus.llmProviderConfigured && setupStatus.graphDbConnected
                    ? "fill-green-400 text-green-400"
                    : setupStatus.llmProviderConfigured
                      ? "fill-yellow-400 text-yellow-400"
                      : "fill-red-400 text-red-400"
                }`}
              />
              <span className="text-xs font-medium text-neutral-400">
                Engine:{" "}
                <span
                  className={
                    setupStatus.llmProviderConfigured && setupStatus.graphDbConnected
                      ? "text-green-400"
                      : setupStatus.llmProviderConfigured
                        ? "text-yellow-400"
                        : "text-red-400"
                  }
                >
                  {setupStatus.llmProviderConfigured && setupStatus.graphDbConnected
                    ? "Ready"
                    : setupStatus.llmProviderConfigured
                      ? "Partial (no Graph DB)"
                      : "Not configured"}
                </span>
              </span>
            </div>
          )}
          <span className="text-[10px] text-neutral-600">
            {totalAvailable} providers available
          </span>
        </div>

        <p className="text-muted text-xs">
          Configure model routing for the multi-agent simulation engine.
          Provider API keys are managed in{" "}
          <button
            className="text-accent hover:underline"
            onClick={() => settings.open("providers")}
          >
            Settings &gt; Providers
          </button>
          .
        </p>
      </div>

      {/* Provider Status — read-only overview from existing config */}
      <div>
        <h3 className="text-foreground mb-3 flex items-center gap-2 text-sm font-medium">
          <Zap className="h-4 w-4" />
          Available Providers
        </h3>

        {providersLoading ? (
          <div className="text-muted flex items-center gap-2 py-4 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading provider configuration...
          </div>
        ) : (
          <div className="space-y-2">
            {/* Subprocess providers first — they don't need API keys */}
            <div className="border-border-medium rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-violet-400" />
                  <span className="text-foreground text-sm font-medium">Claude Code</span>
                  {claudeCodeReady ? (
                    <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                      CLI detected
                    </span>
                  ) : (
                    <span className="rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
                      Not available
                    </span>
                  )}
                </div>
                <button
                  className="text-muted hover:text-foreground transition-colors"
                  onClick={() => settings.open("providers", { expandProvider: "claude-code" })}
                  title="Configure in Providers"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-muted mt-1 text-xs">
                Pro/Max subscription via CLI subprocess. No API key needed.
                {!claudeCodeReady && (
                  <span className="text-amber-400 ml-1">
                    Install CLI: npm install -g @anthropic-ai/claude-code
                  </span>
                )}
              </p>
            </div>

            <div className="border-border-medium rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-blue-400" />
                  <span className="text-foreground text-sm font-medium">Lattice Inference</span>
                  {latticeInferenceReady ? (
                    <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                      Available
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                      Local MLX
                    </span>
                  )}
                </div>
                <button
                  className="text-muted hover:text-foreground transition-colors"
                  onClick={() => settings.open("providers", { expandProvider: "lattice-inference" })}
                  title="Configure in Providers"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-muted mt-1 text-xs">
                On-device inference via MLX (Apple Silicon). No API key needed.
              </p>
            </div>

            {/* API-key providers — show read-only status from Providers config */}
            {API_PROVIDERS.map((provider) => {
              const info = providersConfig?.[provider.key];
              const isConfigured = info?.isConfigured && info?.isEnabled;
              const isDisabled = info && !info.isEnabled;

              return (
                <div
                  key={provider.key}
                  className="border-border-medium rounded-lg border p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-sm font-medium">
                        {provider.label}
                      </span>
                      {isConfigured ? (
                        <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                          Configured
                        </span>
                      ) : isDisabled ? (
                        <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
                          Disabled
                        </span>
                      ) : (
                        <span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400">
                          Not configured
                        </span>
                      )}
                    </div>
                    <button
                      className="text-muted hover:text-foreground transition-colors"
                      onClick={() => settings.open("providers", { expandProvider: provider.key })}
                      title="Configure in Providers"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-muted mt-0.5 text-xs">{provider.description}</p>
                </div>
              );
            })}

            {/* Link to Providers settings */}
            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => settings.open("providers")}
                className="gap-1.5"
              >
                <Settings className="h-3.5 w-3.5" />
                Manage API Keys in Providers
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Model Routing section */}
      <div>
        <button
          onClick={() => setRoutingExpanded(!routingExpanded)}
          className="text-foreground mb-2 flex w-full items-center gap-2 text-sm font-medium"
        >
          <Sliders className="h-4 w-4" />
          Model Routing
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${routingExpanded ? "rotate-90" : ""}`}
          />
          <span className="ml-auto text-[10px] font-normal text-neutral-500">
            {models.length} models available
          </span>
        </button>

        {routingExpanded && (
          <div className="space-y-3">
            <p className="text-muted text-xs">
              Choose which model handles each simulation task. Models from all
              configured providers are available, including Claude Code and Lattice Inference.
            </p>

            <div className="space-y-2">
              {Object.entries(ROUTE_LABELS).map(([routeKey, routeInfo]) => {
                const current = currentRouting[routeKey];
                const currentModelId = current
                  ? `${current.provider}:${current.model}`
                  : "";

                return (
                  <div
                    key={routeKey}
                    className="flex items-center gap-3"
                  >
                    <div className="w-32 shrink-0">
                      <div
                        className="text-foreground text-xs font-medium truncate"
                        title={routeInfo.description}
                      >
                        {routeInfo.label}
                      </div>
                      <div className="text-muted text-[10px] truncate">
                        {routeInfo.description}
                      </div>
                    </div>
                    <select
                      value={currentModelId}
                      onChange={(e) =>
                        void handleRouteChange(routeKey, e.target.value)
                      }
                      className="bg-background border-border text-foreground flex-1 rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring min-w-0"
                    >
                      {!currentModelId && (
                        <option value="">Select model...</option>
                      )}
                      {Object.entries(modelsByProvider).map(
                        ([providerName, providerModels]) => (
                          <optgroup key={providerName} label={providerName}>
                            {providerModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.modelId}
                              </option>
                            ))}
                          </optgroup>
                        ),
                      )}
                    </select>
                  </div>
                );
              })}
            </div>

            {/* Save button + feedback */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                size="sm"
                className="gap-1.5"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Save Routing
                  </>
                )}
              </Button>
              {saveResult === "success" && (
                <span className="text-xs text-green-400">Saved successfully</span>
              )}
              {saveResult === "error" && (
                <span className="text-xs text-red-400">Save failed — backend may need restart</span>
              )}
              {dirty && !saving && (
                <span className="text-xs text-amber-400">Unsaved changes</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Setup status */}
      {setupStatus && (
        <div>
          <h3 className="text-foreground mb-2 text-sm font-medium">
            System Status
          </h3>
          <div className="space-y-1.5">
            <StatusRow
              label="LLM Provider"
              ok={setupStatus.llmProviderConfigured}
              detail={
                setupStatus.llmProviderConfigured
                  ? "At least one provider available"
                  : "Configure a provider or use Claude Code / Lattice Inference"
              }
            />
            <StatusRow
              label="Docker"
              ok={setupStatus.dockerAvailable}
              detail={
                setupStatus.dockerAvailable ? "Available" : "Install Docker Desktop for FalkorDB"
              }
            />
            <StatusRow
              label="FalkorDB"
              ok={setupStatus.graphDbConnected}
              detail={
                setupStatus.graphDbConnected
                  ? `Connected (${setupStatus.graphDbHost}:${setupStatus.graphDbPort})`
                  : setupStatus.falkorDbContainerRunning
                    ? "Container running, connection failed"
                    : "Not running"
              }
            />
          </div>

          <div className="mt-3">
            <Button
              onClick={() => void loadSetup()}
              variant="outline"
              size="sm"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Recheck Status
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Status Row
// ---------------------------------------------------------------------------

const StatusRow: React.FC<{
  label: string;
  ok: boolean;
  detail: string;
}> = ({ label, ok, detail }) => (
  <div className="flex items-center gap-2 text-xs">
    {ok ? (
      <Check className="h-3 w-3 shrink-0 text-green-500" />
    ) : (
      <X className="h-3 w-3 shrink-0 text-red-500" />
    )}
    <span className="text-foreground font-medium">{label}</span>
    <span className="text-muted truncate">{detail}</span>
  </div>
);
