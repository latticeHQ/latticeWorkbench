import React, { useCallback, useEffect, useState } from "react";
import { Check, X, Eye, EyeOff, ExternalLink, Loader2, Zap, ChevronDown, ChevronRight } from "lucide-react";

import { createEditKeyHandler } from "@/browser/utils/ui/keybinds";
import { SUPPORTED_PROVIDERS } from "@/common/constants/providers";
import type { ProviderName } from "@/common/constants/providers";
import { ProviderWithIcon } from "@/browser/components/ProviderIcon";
import { useAPI } from "@/browser/contexts/API";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import { Button } from "@/browser/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/ui/select";
import {
  HelpIndicator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/browser/components/ui/tooltip";

interface FieldConfig {
  key: string;
  label: string;
  placeholder: string;
  type: "secret" | "text";
  optional?: boolean;
}

/**
 * Get provider-specific field configuration.
 * Most providers use API Key + Base URL, but some (like Bedrock) have different needs.
 */
function getProviderFields(provider: ProviderName): FieldConfig[] {
  // GitHub Copilot uses CLI auth - no fields needed
  if (provider === "github-copilot") {
    return [];
  }

  // Claude Code: uses CLI subprocess — no manual token entry needed
  if (provider === "claude-code") {
    return [];
  }

  if (provider === "bedrock") {
    return [
      { key: "region", label: "Region", placeholder: "us-east-1", type: "text" },
      {
        key: "bearerToken",
        label: "Bearer Token",
        placeholder: "AWS_BEARER_TOKEN_BEDROCK",
        type: "secret",
        optional: true,
      },
      {
        key: "accessKeyId",
        label: "Access Key ID",
        placeholder: "AWS Access Key ID",
        type: "secret",
        optional: true,
      },
      {
        key: "secretAccessKey",
        label: "Secret Access Key",
        placeholder: "AWS Secret Access Key",
        type: "secret",
        optional: true,
      },
    ];
  }

  // Default for most providers
  return [
    { key: "apiKey", label: "API Key", placeholder: "Enter API key", type: "secret" },
    {
      key: "baseUrl",
      label: "Base URL",
      placeholder: "https://api.example.com",
      type: "text",
      optional: true,
    },
  ];
}

/**
 * URLs to create/manage API keys for each provider.
 */
const PROVIDER_KEY_URLS: Partial<Record<ProviderName, string>> = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  xai: "https://console.x.ai/team/default/api-keys",
  deepseek: "https://platform.deepseek.com/api_keys",
  openrouter: "https://openrouter.ai/settings/keys",
  // bedrock: AWS credential chain, no simple key URL
  // ollama: local service, no key needed
};

export function ProvidersSection() {
  const { providersExpandedProvider, setProvidersExpandedProvider } = useSettings();

  const { api } = useAPI();
  const { config, updateOptimistically } = useProvidersConfig();

  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  useEffect(() => {
    if (!providersExpandedProvider) {
      return;
    }

    setExpandedProvider(providersExpandedProvider);
    setProvidersExpandedProvider(null);
  }, [providersExpandedProvider, setProvidersExpandedProvider]);
  const [editingField, setEditingField] = useState<{
    provider: string;
    field: string;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: string;
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  const handleToggleProvider = (provider: string) => {
    setExpandedProvider((prev) => (prev === provider ? null : provider));
    setEditingField(null);
  };

  const handleStartEdit = (provider: string, field: string, fieldConfig: FieldConfig) => {
    setEditingField({ provider, field });
    // For secrets, start empty since we only show masked value
    // For text fields, show current value
    const currentValue = getFieldValue(provider, field);
    setEditValue(fieldConfig.type === "text" && currentValue ? currentValue : "");
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue("");
    setShowPassword(false);
  };

  const handleSaveEdit = useCallback(() => {
    if (!editingField || !api) return;

    const { provider, field } = editingField;

    // Optimistic update for instant feedback
    if (field === "apiKey") {
      updateOptimistically(provider, { apiKeySet: editValue !== "" });
    } else if (field === "baseUrl") {
      updateOptimistically(provider, { baseUrl: editValue || undefined });
    }

    setEditingField(null);
    setEditValue("");
    setShowPassword(false);

    // Save in background
    void api.providers.setProviderConfig({ provider, keyPath: [field], value: editValue });
  }, [api, editingField, editValue, updateOptimistically]);

  const handleClearField = useCallback(
    (provider: string, field: string) => {
      if (!api) return;

      // Optimistic update for instant feedback
      if (field === "apiKey") {
        updateOptimistically(provider, { apiKeySet: false });
      } else if (field === "baseUrl") {
        updateOptimistically(provider, { baseUrl: undefined });
      }

      // Save in background
      void api.providers.setProviderConfig({ provider, keyPath: [field], value: "" });
    },
    [api, updateOptimistically]
  );

  const handleTestConnection = useCallback(
    async (provider: string) => {
      if (!api || testingProvider) return;
      setTestingProvider(provider);
      setTestResult(null);
      try {
        const result = await api.providers.testConnection({ provider });
        setTestResult({ provider, ...result });
      } catch (error) {
        setTestResult({
          provider,
          success: false,
          message: error instanceof Error ? error.message : "Test failed",
        });
      } finally {
        setTestingProvider(null);
      }
    },
    [api, testingProvider]
  );

  /** Check if provider is configured (uses backend-computed isConfigured) */
  const isConfigured = (provider: string): boolean => {
    return config?.[provider]?.isConfigured ?? false;
  };

  const getFieldValue = (provider: string, field: string): string | undefined => {
    const providerConfig = config?.[provider];
    if (!providerConfig) return undefined;

    // For bedrock, check aws nested object for region
    if (provider === "bedrock" && field === "region") {
      return providerConfig.aws?.region;
    }

    // For standard fields like baseUrl
    const value = providerConfig[field as keyof typeof providerConfig];
    return typeof value === "string" ? value : undefined;
  };

  const isFieldSet = (provider: string, field: string, fieldConfig: FieldConfig): boolean => {
    const providerConfig = config?.[provider];
    if (!providerConfig) return false;

    if (fieldConfig.type === "secret") {
      // For apiKey, we have apiKeySet from the sanitized config
      if (field === "apiKey") return providerConfig.apiKeySet ?? false;

      // For AWS secrets, check the aws nested object
      if (provider === "bedrock" && providerConfig.aws) {
        const { aws } = providerConfig;
        switch (field) {
          case "bearerToken":
            return aws.bearerTokenSet ?? false;
          case "accessKeyId":
            return aws.accessKeyIdSet ?? false;
          case "secretAccessKey":
            return aws.secretAccessKeySet ?? false;
        }
      }
      return false;
    }
    return !!getFieldValue(provider, field);
  };

  /** Get a short summary of the key/auth method for the table row */
  const getKeyStatusLabel = (provider: ProviderName): string => {
    if (provider === "github-copilot" || provider === "github-copilot-direct") return "CLI auth";
    if (provider === "claude-code") return "CLI auth";
    if (provider === "ollama") return "No key needed";
    if (provider === "lattice-inference") return "Local";
    if (provider === "bedrock") return "AWS creds";
    const hasKey = isFieldSet(provider, "apiKey", { key: "apiKey", label: "", placeholder: "", type: "secret" });
    return hasKey ? "sk-...set" : "Not set";
  };

  return (
    <div className="space-y-3">
      <p className="text-muted text-xs">
        Configure API keys and endpoints for AI providers. Keys are stored in{" "}
        <code className="text-accent">~/.lattice/providers.jsonc</code>
      </p>

      {/* Provider table */}
      <div className="border-border-medium overflow-hidden rounded-md border">
        <table className="w-full">
          <thead>
            <tr className="border-border-medium bg-background-secondary/50 border-b">
              <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-muted">Provider</th>
              <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Status</th>
              <th className="py-1.5 pr-2 text-left text-[11px] font-medium text-muted">Auth</th>
              <th className="py-1.5 pr-3 text-right text-[11px] font-medium text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {SUPPORTED_PROVIDERS.map((provider) => {
              const isExpanded = expandedProvider === provider;
              const configured = isConfigured(provider);
              const fields = getProviderFields(provider);
              const keyUrl = PROVIDER_KEY_URLS[provider];

              return (
                <React.Fragment key={provider}>
                  {/* Main row */}
                  <tr
                    className={`border-border-medium group cursor-pointer border-b transition-colors ${
                      isExpanded
                        ? "bg-background-secondary/40"
                        : "hover:bg-background-secondary/30"
                    }`}
                    onClick={() => handleToggleProvider(provider)}
                  >
                    {/* Provider name + icon */}
                    <td className="py-2 pl-3 pr-2">
                      <div className="flex items-center gap-2">
                        {isExpanded ? (
                          <ChevronDown className="text-muted h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="text-muted h-3 w-3 shrink-0" />
                        )}
                        <ProviderWithIcon
                          provider={provider}
                          displayName
                          className="text-foreground text-xs font-medium"
                        />
                      </div>
                    </td>

                    {/* Status dot + label */}
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5">
                        <div
                          className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-green-500" : "bg-border-medium"}`}
                        />
                        <span className={`text-[11px] ${configured ? "text-green-500" : "text-muted"}`}>
                          {configured ? "Connected" : "Not set"}
                        </span>
                      </div>
                    </td>

                    {/* Auth method */}
                    <td className="py-2 pr-2">
                      <span className="font-mono text-[11px] text-muted">
                        {getKeyStatusLabel(provider)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {keyUrl && (
                          <a
                            href={keyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted hover:text-accent p-0.5 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                            title="Get API key"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        {configured && provider !== "github-copilot" && (
                          <button
                            type="button"
                            className="text-muted hover:text-accent p-0.5 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleTestConnection(provider);
                            }}
                            disabled={testingProvider === provider}
                            title="Test connection"
                          >
                            {testingProvider === provider ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Zap className="h-3 w-3" />
                            )}
                          </button>
                        )}
                        {testResult && testResult.provider === provider && (
                          <span
                            className={`text-[10px] font-medium ${testResult.success ? "text-green-500" : "text-red-400"}`}
                          >
                            {testResult.success ? "OK" : "Fail"}
                            {testResult.latencyMs != null && testResult.success && (
                              <span className="text-muted ml-0.5 font-normal">({testResult.latencyMs}ms)</span>
                            )}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr className="border-border-medium border-b">
                      <td colSpan={4} className="bg-background-secondary/20 px-4 py-3">
                        <div className="ml-5 space-y-2.5">
                          {/* Provider-specific help text */}
                          {provider === "anthropic" &&
                            configured &&
                            config?.[provider]?.apiKeySet === false && (
                              <div className="text-muted text-[11px]">
                                Configured via environment variables.
                              </div>
                            )}

                          {fields.length === 0 && provider === "github-copilot" && (
                            <div className="text-muted text-[11px]">
                              Auto-configured via GitHub Copilot CLI. Run{" "}
                              <code className="text-accent">gh copilot auth login</code> to authenticate.
                            </div>
                          )}

                          {fields.length === 0 && provider === "claude-code" && (
                            <div className="text-muted space-y-1 text-[11px]">
                              <div>
                                Uses your Claude Max/Pro subscription via Claude Code CLI.
                              </div>
                              <div>
                                Install:{" "}
                                <code className="text-accent">npm install -g @anthropic-ai/claude-code</code>
                              </div>
                              <div>
                                Authenticate:{" "}
                                <code className="text-accent">claude auth login</code> or{" "}
                                <code className="text-accent">claude setup-token</code>
                              </div>
                              {configured && (
                                <div className="text-green-500 font-medium">
                                  CLI detected and ready.
                                </div>
                              )}
                              {!configured && (
                                <div className="text-yellow-500">
                                  CLI not found in PATH.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Editable fields in a compact grid */}
                          {fields.length > 0 && (
                            <div className="space-y-2">
                              {fields.map((fieldConfig) => {
                                const isEditing =
                                  editingField?.provider === provider && editingField?.field === fieldConfig.key;
                                const fieldValue = getFieldValue(provider, fieldConfig.key);
                                const fieldIsSet = isFieldSet(provider, fieldConfig.key, fieldConfig);

                                return (
                                  <div key={fieldConfig.key} className="flex items-center gap-3">
                                    <label className="text-muted w-24 shrink-0 text-[11px]">
                                      {fieldConfig.label}
                                      {fieldConfig.optional && <span className="text-dim"> (opt)</span>}
                                    </label>
                                    {isEditing ? (
                                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                        <input
                                          type={
                                            fieldConfig.type === "secret" && !showPassword ? "password" : "text"
                                          }
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          placeholder={fieldConfig.placeholder}
                                          className="bg-modal-bg border-border-medium focus:border-accent min-w-0 flex-1 rounded border px-2 py-1 font-mono text-[11px] focus:outline-none"
                                          autoFocus
                                          onKeyDown={createEditKeyHandler({
                                            onSave: handleSaveEdit,
                                            onCancel: handleCancelEdit,
                                          })}
                                        />
                                        {fieldConfig.type === "secret" && (
                                          <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="text-muted hover:text-foreground p-0.5"
                                            title={showPassword ? "Hide" : "Show"}
                                          >
                                            {showPassword ? (
                                              <EyeOff className="h-3 w-3" />
                                            ) : (
                                              <Eye className="h-3 w-3" />
                                            )}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={handleSaveEdit}
                                          className="p-0.5 text-green-500 hover:text-green-400"
                                        >
                                          <Check className="h-3 w-3" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={handleCancelEdit}
                                          className="text-muted hover:text-foreground p-0.5"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex min-w-0 flex-1 items-center justify-between">
                                        <span className="text-foreground font-mono text-[11px]">
                                          {fieldConfig.type === "secret"
                                            ? fieldIsSet
                                              ? "••••••••"
                                              : "Not set"
                                            : (fieldValue ?? "Default")}
                                        </span>
                                        <div className="flex gap-1.5">
                                          {(fieldConfig.type === "text"
                                            ? !!fieldValue
                                            : fieldConfig.type === "secret" && fieldIsSet) && (
                                            <button
                                              type="button"
                                              onClick={() => handleClearField(provider, fieldConfig.key)}
                                              className="text-muted hover:text-error text-[10px] transition-colors"
                                            >
                                              Clear
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleStartEdit(provider, fieldConfig.key, fieldConfig)
                                            }
                                            className="text-accent hover:text-accent-light text-[10px] transition-colors"
                                          >
                                            {fieldIsSet || fieldValue ? "Change" : "Set"}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Test Connection — inline result */}
                          {configured && provider !== "github-copilot" && (
                            <div className="flex items-center gap-2 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleTestConnection(provider)}
                                disabled={testingProvider === provider}
                                className="h-6 gap-1.5 px-2.5 text-[11px]"
                              >
                                {testingProvider === provider ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Testing...
                                  </>
                                ) : (
                                  <>
                                    <Zap className="h-3 w-3" />
                                    Test Connection
                                  </>
                                )}
                              </Button>
                              {testResult && testResult.provider === provider && (
                                <span
                                  className={`text-[11px] ${testResult.success ? "text-green-500" : "text-red-400"}`}
                                >
                                  {testResult.message}
                                  {testResult.latencyMs != null && testResult.success && (
                                    <span className="text-muted ml-1">({testResult.latencyMs}ms)</span>
                                  )}
                                </span>
                              )}
                            </div>
                          )}

                          {/* OpenAI service tier dropdown */}
                          {provider === "openai" && (
                            <div className="flex items-center gap-3 pt-1">
                              <div className="flex items-center gap-1">
                                <label className="text-muted text-[11px]">Service tier</label>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <HelpIndicator aria-label="OpenAI service tier help">?</HelpIndicator>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-[260px]">
                                        <div className="font-semibold">OpenAI service tier</div>
                                        <div className="mt-1">
                                          <span className="font-semibold">auto</span>: standard behavior.
                                        </div>
                                        <div>
                                          <span className="font-semibold">priority</span>: lower latency,
                                          higher cost.
                                        </div>
                                        <div>
                                          <span className="font-semibold">flex</span>: lower cost, higher
                                          latency.
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>
                              <Select
                                value={config?.openai?.serviceTier ?? "auto"}
                                onValueChange={(next) => {
                                  if (!api) return;
                                  if (
                                    next !== "auto" &&
                                    next !== "default" &&
                                    next !== "flex" &&
                                    next !== "priority"
                                  ) {
                                    return;
                                  }

                                  updateOptimistically("openai", { serviceTier: next });
                                  void api.providers.setProviderConfig({
                                    provider: "openai",
                                    keyPath: ["serviceTier"],
                                    value: next,
                                  });
                                }}
                              >
                                <SelectTrigger className="h-6 w-28 text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="auto">auto</SelectItem>
                                  <SelectItem value="default">default</SelectItem>
                                  <SelectItem value="flex">flex</SelectItem>
                                  <SelectItem value="priority">priority</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
