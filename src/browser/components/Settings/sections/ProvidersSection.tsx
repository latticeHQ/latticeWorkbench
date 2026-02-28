import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react";

import { createEditKeyHandler } from "@/browser/utils/ui/keybinds";
import type { ProviderName } from "@/common/constants/providers";
import { usePolicy } from "@/browser/contexts/PolicyContext";
import { getAllowedProvidersForUi } from "@/browser/utils/policyUi";
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
import { Switch } from "@/browser/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/browser/components/ui/toggle-group";
import {
  HelpIndicator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/browser/components/ui/tooltip";
import { getErrorMessage } from "@/common/utils/errors";

type CodexOauthFlowStatus = "idle" | "starting" | "waiting" | "error";
type CopilotLoginStatus = "idle" | "starting" | "waiting" | "success" | "error";
type AnthropicOauthStatus = "idle" | "starting" | "waiting_code" | "submitting" | "error";

interface CodexOauthDeviceFlow {
  flowId: string;
  userCode: string;
  verifyUrl: string;
}

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
  if (provider === "bedrock") {
    return [
      { key: "region", label: "Region", placeholder: "us-east-1", type: "text" },
      {
        key: "profile",
        label: "AWS Profile",
        placeholder: "my-sso-profile",
        type: "text",
        optional: true,
      },
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

  if (provider === "github-copilot") {
    return []; // OAuth-based, no manual key entry
  }

  // Subprocess providers (claude-code): no API key needed — CLI handles auth.
  if (provider === "claude-code") {
    return [];
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
  const policyState = usePolicy();
  const effectivePolicy =
    policyState.status.state === "enforced" ? (policyState.policy ?? null) : null;
  const visibleProviders = useMemo(
    () => getAllowedProvidersForUi(effectivePolicy),
    [effectivePolicy]
  );

  const { providersExpandedProvider, setProvidersExpandedProvider } = useSettings();

  const { api } = useAPI();
  const { config, refresh, updateOptimistically } = useProvidersConfig();

  const isDesktop = !!window.api;

  // The "Connect (Browser)" OAuth flow requires a redirect back to this origin,
  // which only works when the host is the user's local machine. On a remote lattice
  // server the redirect would land on the server, not the user's browser.
  const isRemoteServer =
    !isDesktop && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

  const [codexOauthStatus, setCodexOauthStatus] = useState<CodexOauthFlowStatus>("idle");
  const [codexOauthError, setCodexOauthError] = useState<string | null>(null);

  const codexOauthAttemptRef = useRef(0);
  const [codexOauthDesktopFlowId, setCodexOauthDesktopFlowId] = useState<string | null>(null);
  const [codexOauthDeviceFlow, setCodexOauthDeviceFlow] = useState<CodexOauthDeviceFlow | null>(
    null
  );
  const [codexOauthAuthorizeUrl, setCodexOauthAuthorizeUrl] = useState<string | null>(null);

  const codexOauthIsConnected = config?.openai?.codexOauthSet === true;
  const openaiApiKeySet = config?.openai?.apiKeySet === true;
  const codexOauthDefaultAuth =
    config?.openai?.codexOauthDefaultAuth === "apiKey" ? "apiKey" : "oauth";
  const codexOauthDefaultAuthIsEditable = codexOauthIsConnected && openaiApiKeySet;

  const codexOauthLoginInProgress =
    codexOauthStatus === "starting" || codexOauthStatus === "waiting";

  const startCodexOauthBrowserConnect = async () => {
    const attempt = ++codexOauthAttemptRef.current;

    if (!api) {
      setCodexOauthStatus("error");
      setCodexOauthError("Lattice API not connected.");
      return;
    }

    // Best-effort: cancel any in-progress flow before starting a new one.
    if (codexOauthDesktopFlowId) {
      void api.codexOauth.cancelDesktopFlow({ flowId: codexOauthDesktopFlowId });
    }
    if (codexOauthDeviceFlow) {
      void api.codexOauth.cancelDeviceFlow({ flowId: codexOauthDeviceFlow.flowId });
    }

    setCodexOauthError(null);
    setCodexOauthDesktopFlowId(null);
    setCodexOauthDeviceFlow(null);
    setCodexOauthAuthorizeUrl(null);

    try {
      setCodexOauthStatus("starting");

      if (!isDesktop) {
        const startResult = await api.codexOauth.startDeviceFlow();

        if (attempt !== codexOauthAttemptRef.current) {
          if (startResult.success) {
            void api.codexOauth.cancelDeviceFlow({ flowId: startResult.data.flowId });
          }
          return;
        }

        if (!startResult.success) {
          setCodexOauthStatus("error");
          setCodexOauthError(startResult.error);
          return;
        }

        setCodexOauthDeviceFlow({
          flowId: startResult.data.flowId,
          userCode: startResult.data.userCode,
          verifyUrl: startResult.data.verifyUrl,
        });
        setCodexOauthStatus("waiting");

        // Keep device-code login manual per user request: we only open the
        // verification page from the explicit "Copy & Open" action.
        const waitResult = await api.codexOauth.waitForDeviceFlow({
          flowId: startResult.data.flowId,
        });

        if (attempt !== codexOauthAttemptRef.current) {
          return;
        }

        if (!waitResult.success) {
          setCodexOauthStatus("error");
          setCodexOauthError(waitResult.error);
          return;
        }

        setCodexOauthStatus("idle");
        setCodexOauthDeviceFlow(null);
        setCodexOauthAuthorizeUrl(null);
        await refresh();
        return;
      }

      const startResult = await api.codexOauth.startDesktopFlow();

      if (attempt !== codexOauthAttemptRef.current) {
        if (startResult.success) {
          void api.codexOauth.cancelDesktopFlow({ flowId: startResult.data.flowId });
        }
        return;
      }

      if (!startResult.success) {
        setCodexOauthStatus("error");
        setCodexOauthError(startResult.error);
        return;
      }

      const { flowId, authorizeUrl } = startResult.data;
      setCodexOauthDesktopFlowId(flowId);
      setCodexOauthAuthorizeUrl(authorizeUrl);
      setCodexOauthStatus("waiting");

      const waitResult = await api.codexOauth.waitForDesktopFlow({ flowId });

      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      if (!waitResult.success) {
        setCodexOauthStatus("error");
        setCodexOauthError(waitResult.error);
        return;
      }

      setCodexOauthStatus("idle");
      setCodexOauthDesktopFlowId(null);
      await refresh();
    } catch (err) {
      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      setCodexOauthStatus("error");
      setCodexOauthError(getErrorMessage(err));
    }
  };

  const startCodexOauthDeviceConnect = async () => {
    const attempt = ++codexOauthAttemptRef.current;

    if (!api) {
      setCodexOauthStatus("error");
      setCodexOauthError("Lattice API not connected.");
      return;
    }

    // Best-effort: cancel any in-progress flow before starting a new one.
    if (codexOauthDesktopFlowId) {
      void api.codexOauth.cancelDesktopFlow({ flowId: codexOauthDesktopFlowId });
    }
    if (codexOauthDeviceFlow) {
      void api.codexOauth.cancelDeviceFlow({ flowId: codexOauthDeviceFlow.flowId });
    }

    setCodexOauthError(null);
    setCodexOauthDesktopFlowId(null);
    setCodexOauthDeviceFlow(null);
    setCodexOauthAuthorizeUrl(null);

    try {
      setCodexOauthStatus("starting");
      const startResult = await api.codexOauth.startDeviceFlow();

      if (attempt !== codexOauthAttemptRef.current) {
        if (startResult.success) {
          void api.codexOauth.cancelDeviceFlow({ flowId: startResult.data.flowId });
        }
        return;
      }

      if (!startResult.success) {
        setCodexOauthStatus("error");
        setCodexOauthError(startResult.error);
        return;
      }

      setCodexOauthDeviceFlow({
        flowId: startResult.data.flowId,
        userCode: startResult.data.userCode,
        verifyUrl: startResult.data.verifyUrl,
      });
      setCodexOauthStatus("waiting");

      const waitResult = await api.codexOauth.waitForDeviceFlow({
        flowId: startResult.data.flowId,
      });

      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      if (!waitResult.success) {
        setCodexOauthStatus("error");
        setCodexOauthError(waitResult.error);
        return;
      }

      setCodexOauthStatus("idle");
      setCodexOauthDeviceFlow(null);
      setCodexOauthAuthorizeUrl(null);
      await refresh();
    } catch (err) {
      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      setCodexOauthStatus("error");
      setCodexOauthError(getErrorMessage(err));
    }
  };

  const disconnectCodexOauth = async () => {
    const attempt = ++codexOauthAttemptRef.current;

    if (!api) {
      setCodexOauthStatus("error");
      setCodexOauthError("Lattice API not connected.");
      return;
    }

    // Best-effort: cancel any in-progress flow.
    if (codexOauthDesktopFlowId) {
      void api.codexOauth.cancelDesktopFlow({ flowId: codexOauthDesktopFlowId });
    }
    if (codexOauthDeviceFlow) {
      void api.codexOauth.cancelDeviceFlow({ flowId: codexOauthDeviceFlow.flowId });
    }

    setCodexOauthError(null);
    setCodexOauthDesktopFlowId(null);
    setCodexOauthDeviceFlow(null);
    setCodexOauthAuthorizeUrl(null);

    try {
      setCodexOauthStatus("starting");
      const result = await api.codexOauth.disconnect();

      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      if (!result.success) {
        setCodexOauthStatus("error");
        setCodexOauthError(result.error);
        return;
      }

      updateOptimistically("openai", { codexOauthSet: false });
      setCodexOauthStatus("idle");
      await refresh();
    } catch (err) {
      if (attempt !== codexOauthAttemptRef.current) {
        return;
      }

      setCodexOauthStatus("error");
      setCodexOauthError(getErrorMessage(err));
    }
  };

  const cancelCodexOauth = () => {
    codexOauthAttemptRef.current++;

    if (api) {
      if (codexOauthDesktopFlowId) {
        void api.codexOauth.cancelDesktopFlow({ flowId: codexOauthDesktopFlowId });
      }
      if (codexOauthDeviceFlow) {
        void api.codexOauth.cancelDeviceFlow({ flowId: codexOauthDeviceFlow.flowId });
      }
    }

    setCodexOauthDesktopFlowId(null);
    setCodexOauthDeviceFlow(null);
    setCodexOauthAuthorizeUrl(null);
    setCodexOauthStatus("idle");
    setCodexOauthError(null);
  };

  // --- GitHub Copilot Device Code Flow ---
  const [copilotLoginStatus, setCopilotLoginStatus] = useState<CopilotLoginStatus>("idle");
  const [copilotLoginError, setCopilotLoginError] = useState<string | null>(null);
  const [copilotFlowId, setCopilotFlowId] = useState<string | null>(null);
  const [copilotUserCode, setCopilotUserCode] = useState<string | null>(null);
  const [copilotVerificationUri, setCopilotVerificationUri] = useState<string | null>(null);
  const copilotLoginAttemptRef = useRef(0);
  const copilotFlowIdRef = useRef<string | null>(null);

  const copilotApiKeySet = config?.["github-copilot"]?.apiKeySet ?? false;
  const copilotLoginInProgress =
    copilotLoginStatus === "waiting" || copilotLoginStatus === "starting";
  const copilotIsLoggedIn = copilotApiKeySet || copilotLoginStatus === "success";

  const cancelCopilotLogin = () => {
    copilotLoginAttemptRef.current++;
    if (api && copilotFlowId) {
      void api.copilotOauth.cancelDeviceFlow({
        flowId: copilotFlowId,
      });
    }
    setCopilotFlowId(null);
    copilotFlowIdRef.current = null;
    setCopilotUserCode(null);
    setCopilotVerificationUri(null);
    setCopilotLoginStatus("idle");
    setCopilotLoginError(null);
  };

  // Cancel any in-flight Copilot login if the component unmounts.
  // Use a ref for api so this only fires on true unmount, not on api identity
  // changes (e.g. reconnection), which would spuriously cancel active flows.
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    return () => {
      if (copilotFlowIdRef.current && apiRef.current) {
        void apiRef.current.copilotOauth.cancelDeviceFlow({ flowId: copilotFlowIdRef.current });
      }
    };
  }, []);

  const clearCopilotCredentials = () => {
    if (!api) return;
    cancelCopilotLogin();
    updateOptimistically("github-copilot", { apiKeySet: false });
    void api.providers.setProviderConfig({
      provider: "github-copilot",
      keyPath: ["apiKey"],
      value: "",
    });
  };

  const startCopilotLogin = async () => {
    const attempt = ++copilotLoginAttemptRef.current;
    try {
      setCopilotLoginError(null);
      setCopilotLoginStatus("starting");

      if (!api) {
        setCopilotLoginStatus("error");
        setCopilotLoginError("API not connected.");
        return;
      }

      // Best-effort: cancel any in-progress flow before starting a new one.
      if (copilotFlowIdRef.current) {
        void api.copilotOauth.cancelDeviceFlow({ flowId: copilotFlowIdRef.current });
        copilotFlowIdRef.current = null;
        setCopilotFlowId(null);
      }

      const startResult = await api.copilotOauth.startDeviceFlow();

      if (attempt !== copilotLoginAttemptRef.current) {
        if (startResult.success) {
          void api.copilotOauth.cancelDeviceFlow({ flowId: startResult.data.flowId });
        }
        return;
      }

      if (!startResult.success) {
        setCopilotLoginStatus("error");
        setCopilotLoginError(startResult.error);
        return;
      }

      const { flowId, verificationUri, userCode } = startResult.data;
      setCopilotFlowId(flowId);
      copilotFlowIdRef.current = flowId;
      setCopilotUserCode(userCode);
      setCopilotVerificationUri(verificationUri);
      setCopilotLoginStatus("waiting");

      // Keep device-code login manual per user request: we only open the
      // verification page from the explicit "Copy & Open" action.

      // Wait for flow to complete (polling happens on backend)
      const waitResult = await api.copilotOauth.waitForDeviceFlow({ flowId });

      if (attempt !== copilotLoginAttemptRef.current) return;

      if (waitResult.success) {
        setCopilotLoginStatus("success");
        return;
      }

      setCopilotLoginStatus("error");
      setCopilotLoginError(waitResult.error);
    } catch (err) {
      if (attempt !== copilotLoginAttemptRef.current) return;
      const message = getErrorMessage(err);
      setCopilotLoginStatus("error");
      setCopilotLoginError(message);
    }
  };

  // --- Anthropic OAuth (Claude Pro/Max) ---
  // Uses PKCE authorization code grant: user opens authorize URL in browser,
  // logs in at claude.ai, gets redirected with a code, then pastes it back.
  const [anthropicOauthStatus, setAnthropicOauthStatus] = useState<AnthropicOauthStatus>("idle");
  const [anthropicOauthError, setAnthropicOauthError] = useState<string | null>(null);
  const [anthropicOauthAuthorizeUrl, setAnthropicOauthAuthorizeUrl] = useState<string | null>(null);
  const [anthropicOauthCodeInput, setAnthropicOauthCodeInput] = useState("");
  const anthropicOauthAttemptRef = useRef(0);
  const anthropicOauthFlowIdRef = useRef<string | null>(null);

  const anthropicOauthIsConnected = config?.anthropic?.anthropicOauthSet === true;
  const anthropicOauthLoginInProgress =
    anthropicOauthStatus === "starting" ||
    anthropicOauthStatus === "waiting_code" ||
    anthropicOauthStatus === "submitting";

  const cancelAnthropicOauth = () => {
    anthropicOauthAttemptRef.current++;
    if (api && anthropicOauthFlowIdRef.current) {
      void api.anthropicOauth.cancelFlow({ flowId: anthropicOauthFlowIdRef.current });
    }
    anthropicOauthFlowIdRef.current = null;
    setAnthropicOauthAuthorizeUrl(null);
    setAnthropicOauthCodeInput("");
    setAnthropicOauthStatus("idle");
    setAnthropicOauthError(null);
  };

  // Cancel any in-flight Anthropic OAuth flow on unmount.
  useEffect(() => {
    return () => {
      if (anthropicOauthFlowIdRef.current && apiRef.current) {
        void apiRef.current.anthropicOauth.cancelFlow({ flowId: anthropicOauthFlowIdRef.current });
      }
    };
  }, []);

  const disconnectAnthropicOauth = async () => {
    const attempt = ++anthropicOauthAttemptRef.current;

    if (!api) {
      setAnthropicOauthStatus("error");
      setAnthropicOauthError("Lattice API not connected.");
      return;
    }

    // Best-effort: cancel any in-progress flow.
    if (anthropicOauthFlowIdRef.current) {
      void api.anthropicOauth.cancelFlow({ flowId: anthropicOauthFlowIdRef.current });
    }

    anthropicOauthFlowIdRef.current = null;
    setAnthropicOauthAuthorizeUrl(null);
    setAnthropicOauthCodeInput("");
    setAnthropicOauthError(null);

    try {
      const result = await api.anthropicOauth.disconnect();

      if (attempt !== anthropicOauthAttemptRef.current) return;

      if (!result.success) {
        setAnthropicOauthStatus("error");
        setAnthropicOauthError(result.error);
        return;
      }

      updateOptimistically("anthropic", { anthropicOauthSet: false });
      setAnthropicOauthStatus("idle");
      await refresh();
    } catch (err) {
      if (attempt !== anthropicOauthAttemptRef.current) return;
      setAnthropicOauthStatus("error");
      setAnthropicOauthError(getErrorMessage(err));
    }
  };

  const startAnthropicOauthLogin = async () => {
    const attempt = ++anthropicOauthAttemptRef.current;

    if (!api) {
      setAnthropicOauthStatus("error");
      setAnthropicOauthError("Lattice API not connected.");
      return;
    }

    // Best-effort: cancel any in-progress flow before starting a new one.
    if (anthropicOauthFlowIdRef.current) {
      void api.anthropicOauth.cancelFlow({ flowId: anthropicOauthFlowIdRef.current });
      anthropicOauthFlowIdRef.current = null;
    }

    setAnthropicOauthError(null);
    setAnthropicOauthCodeInput("");
    setAnthropicOauthAuthorizeUrl(null);

    try {
      setAnthropicOauthStatus("starting");

      const startResult = await api.anthropicOauth.startFlow();

      if (attempt !== anthropicOauthAttemptRef.current) {
        if (startResult.success) {
          void api.anthropicOauth.cancelFlow({ flowId: startResult.data.flowId });
        }
        return;
      }

      if (!startResult.success) {
        setAnthropicOauthStatus("error");
        setAnthropicOauthError(startResult.error);
        return;
      }

      const { flowId, authorizeUrl } = startResult.data;
      anthropicOauthFlowIdRef.current = flowId;
      setAnthropicOauthAuthorizeUrl(authorizeUrl);
      setAnthropicOauthStatus("waiting_code");
    } catch (err) {
      if (attempt !== anthropicOauthAttemptRef.current) return;
      setAnthropicOauthStatus("error");
      setAnthropicOauthError(getErrorMessage(err));
    }
  };

  const submitAnthropicOauthCode = async () => {
    const attempt = anthropicOauthAttemptRef.current;
    const flowId = anthropicOauthFlowIdRef.current;

    if (!api || !flowId || !anthropicOauthCodeInput.trim()) return;

    try {
      setAnthropicOauthStatus("submitting");
      setAnthropicOauthError(null);

      const result = await api.anthropicOauth.submitCode({
        flowId,
        code: anthropicOauthCodeInput.trim(),
      });

      if (attempt !== anthropicOauthAttemptRef.current) return;

      if (!result.success) {
        setAnthropicOauthStatus("error");
        setAnthropicOauthError(result.error);
        return;
      }

      // Success — clean up flow state
      anthropicOauthFlowIdRef.current = null;
      setAnthropicOauthAuthorizeUrl(null);
      setAnthropicOauthCodeInput("");
      setAnthropicOauthStatus("idle");
      updateOptimistically("anthropic", { anthropicOauthSet: true });
      await refresh();
    } catch (err) {
      if (attempt !== anthropicOauthAttemptRef.current) return;
      setAnthropicOauthStatus("error");
      setAnthropicOauthError(getErrorMessage(err));
    }
  };

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

  const handleToggleProvider = (provider: string) => {
    setExpandedProvider((prev) => {
      const next = prev === provider ? null : provider;
      if (prev === "github-copilot" && next !== "github-copilot") {
        cancelCopilotLogin();
      }
      if (prev === "anthropic" && next !== "anthropic") {
        cancelAnthropicOauth();
      }
      return next;
    });
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

  const isEnabled = (provider: string): boolean => {
    return config?.[provider]?.isEnabled ?? true;
  };

  /** Check if provider is configured (uses backend-computed isConfigured) */
  const isConfigured = (provider: string): boolean => {
    return config?.[provider]?.isConfigured ?? false;
  };

  const hasAnyConfiguredProvider = useMemo(
    () => Object.values(config ?? {}).some((providerConfig) => providerConfig.isConfigured),
    [config]
  );

  const handleProviderEnabledChange = useCallback(
    (provider: string, nextEnabled: boolean) => {
      if (!api) {
        return;
      }

      updateOptimistically(provider, {
        isEnabled: nextEnabled,
        ...(nextEnabled ? {} : { isConfigured: false }),
      });

      // Persist only `enabled: false` for disabled providers. Re-enabling removes the key.
      void api.providers.setProviderConfig({
        provider,
        keyPath: ["enabled"],
        value: nextEnabled ? "" : "false",
      });
    },
    [api, updateOptimistically]
  );

  const getFieldValue = (provider: string, field: string): string | undefined => {
    const providerConfig = config?.[provider];
    if (!providerConfig) return undefined;

    // For bedrock, check aws nested object for region/profile
    if (provider === "bedrock" && (field === "region" || field === "profile")) {
      return field === "region" ? providerConfig.aws?.region : providerConfig.aws?.profile;
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

  return (
    <div className="space-y-2">
      <p className="text-muted mb-4 text-xs">
        Configure API keys and endpoints for AI providers. Keys are stored in{" "}
        <code className="text-accent">~/.lattice/providers.jsonc</code>
      </p>

      {policyState.status.state === "enforced" && (
        <div className="border-border-medium bg-background-secondary/50 text-muted flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <span>Your settings are controlled by a policy.</span>
        </div>
      )}

      {visibleProviders.map((provider) => {
        const isExpanded = expandedProvider === provider;
        const enabled = isEnabled(provider);
        const configured = isConfigured(provider);
        const fields = getProviderFields(provider);
        const statusDotColor = !enabled
          ? "bg-warning"
          : configured
            ? "bg-success"
            : "bg-border-medium";
        const statusDotTitle = !enabled ? "Disabled" : configured ? "Configured" : "Not configured";

        return (
          <div
            key={provider}
            className="border-border-medium bg-background-secondary overflow-hidden rounded-md border"
          >
            {/* Provider header */}
            <Button
              variant="ghost"
              onClick={() => handleToggleProvider(provider)}
              className="flex h-auto w-full items-center justify-between rounded-none px-4 py-3 text-left"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="text-muted h-4 w-4" />
                ) : (
                  <ChevronRight className="text-muted h-4 w-4" />
                )}
                <ProviderWithIcon
                  provider={provider}
                  displayName
                  className="text-foreground text-sm font-medium"
                />
              </div>
              <div className={`h-2 w-2 rounded-full ${statusDotColor}`} title={statusDotTitle} />
            </Button>

            {/* Provider settings */}
            {isExpanded && (
              <div className="border-border-medium space-y-3 border-t px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label className="text-foreground block text-xs font-medium">Enabled</label>
                    <span className="text-muted text-xs">
                      Disable this provider without deleting saved credentials.
                    </span>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(nextChecked) =>
                      handleProviderEnabledChange(provider, nextChecked)
                    }
                    aria-label={`Toggle ${provider} provider`}
                    disabled={!api}
                  />
                </div>

                {/* Quick link to get API key */}
                {PROVIDER_KEY_URLS[provider] && (
                  <div className="space-y-1">
                    <a
                      href={PROVIDER_KEY_URLS[provider]}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted hover:text-accent inline-flex items-center gap-1 text-xs transition-colors"
                    >
                      Get API Key
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                    {provider === "anthropic" &&
                      configured &&
                      config?.[provider]?.apiKeySet === false && (
                        <div className="text-muted text-xs">
                          Configured via environment variables.
                        </div>
                      )}
                  </div>
                )}

                {provider === "github-copilot" && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-foreground block text-xs font-medium">
                        Authentication
                      </label>
                      <span className="text-muted text-xs">
                        {copilotIsLoggedIn ? "Logged in" : "Not logged in"}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            void startCopilotLogin();
                          }}
                          disabled={copilotLoginInProgress}
                        >
                          {copilotLoginStatus === "error"
                            ? "Try again"
                            : copilotLoginInProgress
                              ? "Waiting for authorization..."
                              : copilotIsLoggedIn
                                ? "Re-login with GitHub"
                                : "Login with GitHub"}
                        </Button>

                        {copilotLoginInProgress && (
                          <Button variant="secondary" size="sm" onClick={cancelCopilotLogin}>
                            Cancel
                          </Button>
                        )}

                        {copilotIsLoggedIn && (
                          <Button variant="ghost" size="sm" onClick={clearCopilotCredentials}>
                            Log out
                          </Button>
                        )}
                      </div>

                      {copilotLoginStatus === "waiting" && copilotUserCode && (
                        <div className="bg-background-tertiary space-y-2 rounded-md p-3">
                          <p className="text-muted text-xs">Enter this code on GitHub:</p>
                          <div className="flex items-center gap-2">
                            <code className="text-foreground text-lg font-bold tracking-widest">
                              {copilotUserCode}
                            </code>
                            <Button
                              size="sm"
                              aria-label="Copy and open GitHub verification page"
                              onClick={() => {
                                void navigator.clipboard.writeText(copilotUserCode);
                                if (copilotVerificationUri) {
                                  window.open(copilotVerificationUri, "_blank", "noopener");
                                }
                              }}
                              className="h-8 px-3 text-xs"
                              disabled={!copilotVerificationUri}
                            >
                              Copy & Open GitHub
                            </Button>
                          </div>
                          <p className="text-muted inline-flex items-center gap-2 text-xs">
                            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                            Waiting for authorization...
                          </p>
                        </div>
                      )}

                      {copilotLoginStatus === "error" && copilotLoginError && (
                        <p className="text-destructive text-xs">
                          Login failed: {copilotLoginError}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Claude Code subprocess provider — CLI handles auth, no API key needed */}
                {provider === "claude-code" && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-foreground block text-xs font-medium">
                        Authentication
                      </label>
                      <span className="text-muted text-xs">
                        Uses your Claude Code CLI login (Pro/Max subscription).
                      </span>
                    </div>
                    <div className="text-muted text-xs">
                      {configured ? (
                        <span className="text-success">CLI detected and ready.</span>
                      ) : (
                        <span>
                          Claude Code CLI not found. Install:{" "}
                          <code className="bg-background-tertiary rounded px-1 py-0.5">
                            npm install -g @anthropic-ai/claude-code
                          </code>
                        </span>
                      )}
                    </div>
                    <div className="text-muted text-xs">
                      Models:{" "}
                      <code className="bg-background-tertiary rounded px-1 py-0.5">cc:opus</code>
                      {" · "}
                      <code className="bg-background-tertiary rounded px-1 py-0.5">cc:sonnet</code>
                      {" · "}
                      <code className="bg-background-tertiary rounded px-1 py-0.5">cc:haiku</code>
                    </div>

                    {/* Execution mode selector */}
                    <div className="pt-1">
                      <label className="text-foreground block text-xs font-medium">
                        Execution Mode
                      </label>
                      <p className="text-muted mb-1.5 text-xs">
                        Controls how Claude Code handles tool calls.
                      </p>
                      <ToggleGroup
                        type="single"
                        value={
                          (config?.["claude-code"] as Record<string, unknown> | undefined)
                            ?.claudeCodeMode as string ?? "agentic"
                        }
                        onValueChange={(next) => {
                          if (!api || !next) return;
                          if (
                            next !== "proxy" &&
                            next !== "agentic" &&
                            next !== "streaming"
                          )
                            return;
                          void api.providers.setProviderConfig({
                            provider: "claude-code",
                            keyPath: ["claudeCodeMode"],
                            value: next,
                          });
                          updateOptimistically("claude-code", {
                            claudeCodeMode: next as "proxy" | "agentic" | "streaming",
                          });
                        }}
                        className="h-9"
                      >
                        <ToggleGroupItem
                          value="agentic"
                          className="h-7 px-3 text-[13px]"
                        >
                          Agentic
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="streaming"
                          className="h-7 px-3 text-[13px]"
                        >
                          Streaming
                        </ToggleGroupItem>
                        <ToggleGroupItem
                          value="proxy"
                          className="h-7 px-3 text-[13px]"
                        >
                          Proxy
                        </ToggleGroupItem>
                      </ToggleGroup>
                      <p className="text-muted mt-1 text-[11px]">
                        <strong>Agentic:</strong> CLI handles tools via MCP.{" "}
                        <strong>Streaming:</strong> Lattice intercepts tool calls.{" "}
                        <strong>Proxy:</strong> Text-only, no tools.
                      </p>
                    </div>
                  </div>
                )}

                {fields.map((fieldConfig) => {
                  const isEditing =
                    editingField?.provider === provider && editingField?.field === fieldConfig.key;
                  const fieldValue = getFieldValue(provider, fieldConfig.key);
                  const fieldIsSet = isFieldSet(provider, fieldConfig.key, fieldConfig);

                  return (
                    <div key={fieldConfig.key}>
                      <label className="text-muted mb-1 block text-xs">
                        {fieldConfig.label}
                        {fieldConfig.optional && <span className="text-dim"> (optional)</span>}
                      </label>
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input
                            type={
                              fieldConfig.type === "secret" && !showPassword ? "password" : "text"
                            }
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder={fieldConfig.placeholder}
                            className="bg-modal-bg border-border-medium focus:border-accent flex-1 rounded border px-2 py-1.5 font-mono text-xs focus:outline-none"
                            autoFocus
                            onKeyDown={createEditKeyHandler({
                              onSave: handleSaveEdit,
                              onCancel: handleCancelEdit,
                            })}
                          />
                          {fieldConfig.type === "secret" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setShowPassword(!showPassword)}
                              className="text-muted hover:text-foreground h-6 w-6"
                              title={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleSaveEdit}
                            className="h-6 w-6 text-green-500 hover:text-green-400"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleCancelEdit}
                            className="text-muted hover:text-foreground h-6 w-6"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-foreground font-mono text-xs">
                            {fieldConfig.type === "secret"
                              ? fieldIsSet
                                ? "••••••••"
                                : "Not set"
                              : (fieldValue ?? "Default")}
                          </span>
                          <div className="flex gap-2">
                            {(fieldConfig.type === "text"
                              ? !!fieldValue
                              : fieldConfig.type === "secret" && fieldIsSet) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleClearField(provider, fieldConfig.key)}
                                className="text-muted hover:text-error h-auto px-1 py-0 text-xs"
                              >
                                Clear
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleStartEdit(provider, fieldConfig.key, fieldConfig)
                              }
                              className="text-accent hover:text-accent-light h-auto px-1 py-0 text-xs"
                            >
                              {fieldIsSet || fieldValue ? "Change" : "Set"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Anthropic: OAuth login (Claude Pro/Max subscription) */}
                {provider === "anthropic" && (
                  <div className="border-border-light space-y-2 border-t pt-3">
                    <div>
                      <label className="text-foreground block text-xs font-medium">
                        Anthropic OAuth
                      </label>
                      <span className="text-muted text-xs">
                        {anthropicOauthStatus === "starting"
                          ? "Starting..."
                          : anthropicOauthStatus === "submitting"
                            ? "Verifying..."
                            : anthropicOauthIsConnected
                              ? "Connected (Claude Pro/Max)"
                              : "Not connected"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          void startAnthropicOauthLogin();
                        }}
                        disabled={!api || anthropicOauthLoginInProgress}
                      >
                        {anthropicOauthStatus === "error"
                          ? "Try again"
                          : anthropicOauthLoginInProgress
                            ? "Connecting..."
                            : anthropicOauthIsConnected
                              ? "Re-connect"
                              : "Login with Anthropic"}
                      </Button>

                      {anthropicOauthLoginInProgress && (
                        <Button variant="secondary" size="sm" onClick={cancelAnthropicOauth}>
                          Cancel
                        </Button>
                      )}

                      {anthropicOauthIsConnected && !anthropicOauthLoginInProgress && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void disconnectAnthropicOauth();
                          }}
                          disabled={!api}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>

                    {/* Code paste UI — shown after user opens authorize URL */}
                    {anthropicOauthStatus === "waiting_code" && anthropicOauthAuthorizeUrl && (
                      <div className="bg-background-tertiary space-y-2 rounded-md p-3">
                        <p className="text-muted text-xs">
                          1. Open the link below and log in with your Anthropic account.
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            aria-label="Copy and open Anthropic authorization page"
                            onClick={() => {
                              void navigator.clipboard.writeText(anthropicOauthAuthorizeUrl);
                              window.open(anthropicOauthAuthorizeUrl, "_blank", "noopener");
                            }}
                            className="h-8 px-3 text-xs"
                          >
                            Copy & Open Anthropic
                          </Button>
                        </div>
                        <p className="text-muted text-xs">
                          2. After logging in, paste the authorization code below:
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={anthropicOauthCodeInput}
                            onChange={(e) => setAnthropicOauthCodeInput(e.target.value)}
                            placeholder="Paste code here (code#state)"
                            className="bg-modal-bg border-border-medium focus:border-accent flex-1 rounded border px-2 py-1.5 font-mono text-xs focus:outline-none"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && anthropicOauthCodeInput.trim()) {
                                void submitAnthropicOauthCode();
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={() => {
                              void submitAnthropicOauthCode();
                            }}
                            disabled={!anthropicOauthCodeInput.trim()}
                          >
                            Submit
                          </Button>
                        </div>
                      </div>
                    )}

                    {anthropicOauthStatus === "submitting" && (
                      <p className="text-muted inline-flex items-center gap-2 text-xs">
                        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                        Exchanging code for token...
                      </p>
                    )}

                    {anthropicOauthStatus === "error" && anthropicOauthError && (
                      <p className="text-destructive text-xs">
                        Login failed: {anthropicOauthError}
                      </p>
                    )}
                  </div>
                )}

                {/* Anthropic: prompt cache TTL */}
                {provider === "anthropic" && (
                  <div className="border-border-light border-t pt-3">
                    <div className="mb-1 flex items-center gap-1">
                      <label className="text-muted block text-xs">Prompt cache TTL</label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpIndicator aria-label="Anthropic prompt cache TTL help">
                              ?
                            </HelpIndicator>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="max-w-[280px]">
                              <div className="font-semibold">Prompt cache TTL</div>
                              <div className="mt-1">
                                Default is <span className="font-semibold">5m</span>. Use{" "}
                                <span className="font-semibold">1h</span> for longer workflows at a
                                higher cache-write cost.
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>

                    <Select
                      value={config?.anthropic?.cacheTtl === "1h" ? "1h" : "default"}
                      onValueChange={(next) => {
                        if (!api) {
                          return;
                        }
                        if (next !== "default" && next !== "1h") {
                          return;
                        }

                        const cacheTtl = next === "1h" ? "1h" : undefined;
                        updateOptimistically("anthropic", { cacheTtl });
                        void api.providers.setProviderConfig({
                          provider: "anthropic",
                          keyPath: ["cacheTtl"],
                          // Empty string clears providers.jsonc key; backend defaults to 5m when unset.
                          value: next === "1h" ? "1h" : "",
                        });
                      }}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default (5m)</SelectItem>
                        <SelectItem value="1h">1 hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* OpenAI: ChatGPT OAuth + service tier */}
                {provider === "openai" && (
                  <div className="border-border-light space-y-3 border-t pt-3">
                    <div>
                      <label className="text-foreground block text-xs font-medium">
                        ChatGPT (Codex) OAuth
                      </label>
                      <span className="text-muted text-xs">
                        {codexOauthStatus === "starting"
                          ? "Starting..."
                          : codexOauthStatus === "waiting"
                            ? "Waiting for login..."
                            : codexOauthIsConnected
                              ? "Connected"
                              : "Not connected"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!isRemoteServer && (
                        <Button
                          size="sm"
                          onClick={() => {
                            void startCodexOauthBrowserConnect();
                          }}
                          disabled={!api || codexOauthLoginInProgress}
                        >
                          Connect (Browser)
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void startCodexOauthDeviceConnect();
                        }}
                        disabled={!api || codexOauthLoginInProgress}
                      >
                        Connect (Device)
                      </Button>

                      {codexOauthStatus === "waiting" &&
                        !codexOauthDeviceFlow &&
                        codexOauthAuthorizeUrl && (
                          <Button
                            size="sm"
                            aria-label="Copy and open OpenAI authorization page"
                            onClick={() => {
                              void navigator.clipboard.writeText(codexOauthAuthorizeUrl);
                              window.open(codexOauthAuthorizeUrl, "_blank", "noopener");
                            }}
                            className="h-8 px-3 text-xs"
                          >
                            Copy & Open OpenAI
                          </Button>
                        )}

                      {codexOauthLoginInProgress && (
                        <Button variant="secondary" size="sm" onClick={cancelCodexOauth}>
                          Cancel
                        </Button>
                      )}

                      {codexOauthIsConnected && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            void disconnectCodexOauth();
                          }}
                          disabled={!api || codexOauthLoginInProgress}
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>

                    {codexOauthDeviceFlow && (
                      <div className="bg-background-tertiary space-y-2 rounded-md p-3">
                        <p className="text-muted text-xs">
                          Enter this code on the OpenAI verification page:
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="text-foreground text-lg font-bold tracking-widest">
                            {codexOauthDeviceFlow.userCode}
                          </code>
                          <Button
                            size="sm"
                            aria-label="Copy and open OpenAI verification page"
                            onClick={() => {
                              void navigator.clipboard.writeText(codexOauthDeviceFlow.userCode);
                              window.open(codexOauthDeviceFlow.verifyUrl, "_blank", "noopener");
                            }}
                            className="h-8 px-3 text-xs"
                          >
                            Copy & Open OpenAI
                          </Button>
                        </div>
                        <p className="text-muted inline-flex items-center gap-2 text-xs">
                          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                          Waiting for authorization...
                        </p>
                      </div>
                    )}

                    {codexOauthStatus === "waiting" && !codexOauthDeviceFlow && (
                      <p className="text-muted inline-flex items-center gap-2 text-xs">
                        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                        Waiting for authorization...
                      </p>
                    )}

                    {codexOauthStatus === "error" && codexOauthError && (
                      <p className="text-destructive text-xs">{codexOauthError}</p>
                    )}

                    <div className="border-border-light space-y-2 border-t pt-3">
                      <div>
                        <label className="text-muted block text-xs">
                          Default auth (when both are set)
                        </label>
                        <p className="text-muted text-xs">
                          Applies to models that support both ChatGPT OAuth and API keys (e.g.{" "}
                          <code className="text-accent">gpt-5.2</code>).
                        </p>
                      </div>

                      <ToggleGroup
                        type="single"
                        value={codexOauthDefaultAuth}
                        onValueChange={(next) => {
                          if (!api) return;
                          if (next !== "oauth" && next !== "apiKey") {
                            return;
                          }

                          updateOptimistically("openai", { codexOauthDefaultAuth: next });
                          void api.providers.setProviderConfig({
                            provider: "openai",
                            keyPath: ["codexOauthDefaultAuth"],
                            value: next,
                          });
                        }}
                        size="sm"
                        className="h-9"
                        disabled={!api || !codexOauthDefaultAuthIsEditable}
                      >
                        <ToggleGroupItem value="oauth" size="sm" className="h-7 px-3 text-[13px]">
                          Use ChatGPT OAuth by default
                        </ToggleGroupItem>
                        <ToggleGroupItem value="apiKey" size="sm" className="h-7 px-3 text-[13px]">
                          Use OpenAI API key by default
                        </ToggleGroupItem>
                      </ToggleGroup>

                      <p className="text-muted text-xs">
                        ChatGPT OAuth uses subscription billing (costs included). API key uses
                        OpenAI platform billing.
                      </p>

                      {!codexOauthDefaultAuthIsEditable && (
                        <p className="text-muted text-xs">
                          Connect ChatGPT OAuth and set an OpenAI API key to change this setting.
                        </p>
                      )}
                    </div>

                    <div className="border-border-light border-t pt-3">
                      <div className="mb-1 flex items-center gap-1">
                        <label className="text-muted block text-xs">Service tier</label>
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
                        <SelectTrigger className="w-40">
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
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {config && !hasAnyConfiguredProvider && (
        <div className="border-warning/40 bg-warning/10 text-warning rounded-md border px-3 py-2 text-xs">
          No providers are currently enabled. You won&apos;t be able to send messages until you
          enable a provider.
        </div>
      )}
    </div>
  );
}
