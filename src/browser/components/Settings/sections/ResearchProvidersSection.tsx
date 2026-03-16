/**
 * ResearchProvidersSection — Settings UI for configuring financial data provider API keys.
 *
 * These keys are injected into the OpenBB data server on startup as environment variables.
 * Users can add/update keys here and restart the server to pick up changes.
 *
 * Keys are stored in the global secrets store (same as Settings → Secrets) under
 * well-known names like FRED_API_KEY, FMP_API_KEY, etc.
 *
 * Features:
 * - Live connection health indicator (green/red dot)
 * - Per-key format validation
 * - Save & Restart combo action
 * - Quandl/Nasdaq support
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Zap,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import type { Secret } from "@/common/types/secrets";

/** Provider definition — what we show in the UI. */
interface ProviderDef {
  /** Secret key name (e.g. FRED_API_KEY) */
  key: string;
  /** Display name */
  label: string;
  /** Short description */
  description: string;
  /** URL to get an API key */
  signupUrl: string;
  /** Whether yfinance (free) covers this — if true, key is optional */
  optional: boolean;
  /** Expected key format hint for validation (regex pattern) */
  keyPattern?: RegExp;
  /** Human-readable format hint */
  keyHint?: string;
}

const PROVIDERS: ProviderDef[] = [
  {
    key: "FRED_API_KEY",
    label: "FRED (Federal Reserve)",
    description:
      "Economic data, interest rates, GDP, CPI, employment — required for Economy, Fixed Income, and FRED Series views.",
    signupUrl: "https://fred.stlouisfed.org/docs/api/api_key.html",
    optional: false,
    keyPattern: /^[a-f0-9]{32}$/i,
    keyHint: "32-character hex string",
  },
  {
    key: "FMP_API_KEY",
    label: "Financial Modeling Prep",
    description:
      "Enhanced company fundamentals, financial statements, earnings, and analyst estimates.",
    signupUrl: "https://site.financialmodelingprep.com/developer/docs/",
    optional: true,
    keyPattern: /^[A-Za-z0-9]{20,}$/,
    keyHint: "20+ character alphanumeric key",
  },
  {
    key: "POLYGON_API_KEY",
    label: "Polygon.io",
    description:
      "Real-time and historical market data for stocks, options, forex, and crypto.",
    signupUrl: "https://polygon.io/dashboard/signup",
    optional: true,
    keyPattern: /^[A-Za-z0-9_]{20,}$/,
    keyHint: "20+ character alphanumeric key",
  },
  {
    key: "ALPHA_VANTAGE_API_KEY",
    label: "Alpha Vantage",
    description:
      "Stock prices, technical indicators, and fundamental data. Free tier available.",
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    optional: true,
    keyPattern: /^[A-Z0-9]{12,}$/,
    keyHint: "Alphanumeric key (e.g. ABC123XYZ456)",
  },
  {
    key: "INTRINIO_API_KEY",
    label: "Intrinio",
    description:
      "Financial data feeds including real-time prices, fundamentals, and options.",
    signupUrl: "https://intrinio.com/",
    optional: true,
  },
  {
    key: "QUANDL_API_KEY",
    label: "Quandl / Nasdaq Data Link",
    description:
      "Commodities, futures, economic indicators, and alternative data from Nasdaq Data Link (formerly Quandl).",
    signupUrl: "https://data.nasdaq.com/sign-up",
    optional: true,
    keyPattern: /^[A-Za-z0-9_-]{15,}$/,
    keyHint: "20-character alphanumeric key",
  },
  {
    key: "TIINGO_API_KEY",
    label: "Tiingo",
    description:
      "End-of-day stock prices, crypto data, and news. Free tier available.",
    signupUrl: "https://www.tiingo.com/",
    optional: true,
    keyPattern: /^[a-f0-9]{40}$/i,
    keyHint: "40-character hex token",
  },
];

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface ValidationResult {
  valid: boolean;
  message?: string;
}

function validateKey(value: string, provider: ProviderDef): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: true }; // Empty is OK (key not set)

  if (/\s/.test(trimmed)) {
    return { valid: false, message: "Key should not contain spaces" };
  }
  if (trimmed.length < 8) {
    return { valid: false, message: "Key seems too short (minimum 8 characters)" };
  }
  if (provider.keyPattern && !provider.keyPattern.test(trimmed)) {
    return {
      valid: false,
      message: provider.keyHint
        ? `Expected format: ${provider.keyHint}`
        : "Key format doesn't match expected pattern",
    };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSecretRef(v: Secret["value"]): v is { secret: string } {
  return typeof v === "object" && v !== null && "secret" in v;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ResearchProvidersSection: React.FC = () => {
  const { api } = useAPI();

  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(() => new Set());
  const [serverStatus, setServerStatus] = useState<"unknown" | "running" | "stopped" | "starting">("unknown");

  // ---------------------------------------------------------------------------
  // Server health check
  // ---------------------------------------------------------------------------

  const checkServerHealth = useCallback(async () => {
    if (!api) return;
    try {
      const status = await (api as any).openbb.getStatus();
      if (status?.status === "running") {
        setServerStatus("running");
      } else if (status?.status === "starting") {
        setServerStatus("starting");
      } else {
        setServerStatus("stopped");
      }
    } catch {
      setServerStatus("stopped");
    }
  }, [api]);

  // Poll server health every 5s
  useEffect(() => {
    void checkServerHealth();
    const interval = setInterval(() => void checkServerHealth(), 5000);
    return () => clearInterval(interval);
  }, [checkServerHealth]);

  // ---------------------------------------------------------------------------
  // Load current secrets
  // ---------------------------------------------------------------------------

  const loadSecrets = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const allSecrets = await api.secrets.get({});
      const record: Record<string, string> = {};
      for (const s of allSecrets) {
        if (s && typeof s.key === "string") {
          record[s.key] =
            typeof s.value === "string"
              ? s.value
              : isSecretRef(s.value)
                ? s.value.secret
                : "";
        }
      }
      setSecrets(record);
      // Initialize edited with current values for provider keys
      const initial: Record<string, string> = {};
      for (const p of PROVIDERS) {
        initial[p.key] = record[p.key] ?? "";
      }
      setEdited(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load secrets");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadSecrets();
  }, [loadSecrets]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const isDirty = PROVIDERS.some(
    (p) => (edited[p.key] ?? "") !== (secrets[p.key] ?? ""),
  );

  const hasValidationErrors = PROVIDERS.some((p) => {
    const val = (edited[p.key] ?? "").trim();
    if (!val) return false;
    return !validateKey(val, p).valid;
  });

  const configuredCount = PROVIDERS.filter(
    (p) => (secrets[p.key] ?? "").trim().length > 0,
  ).length;

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!api) return false;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Load all existing secrets, merge in our changes, save back
      const allSecrets = await api.secrets.get({});
      const byKey = new Map<string, Secret>();
      for (const s of allSecrets) {
        if (s && typeof s.key === "string") {
          byKey.set(s.key, s);
        }
      }

      // Update provider keys
      for (const p of PROVIDERS) {
        const val = (edited[p.key] ?? "").trim();
        if (val) {
          byKey.set(p.key, { key: p.key, value: val });
        } else {
          byKey.delete(p.key);
        }
      }

      const merged = Array.from(byKey.values());
      const result = await api.secrets.update({ secrets: merged });

      if (!result.success) {
        setError(result.error ?? "Failed to save");
        return false;
      }

      // Update local state
      const newSecrets = { ...secrets };
      for (const p of PROVIDERS) {
        const val = (edited[p.key] ?? "").trim();
        if (val) {
          newSecrets[p.key] = val;
        } else {
          delete newSecrets[p.key];
        }
      }
      setSecrets(newSecrets);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  }, [api, edited, secrets]);

  // ---------------------------------------------------------------------------
  // Restart
  // ---------------------------------------------------------------------------

  const handleRestart = useCallback(async () => {
    if (!api) return;
    setRestarting(true);
    setServerStatus("starting");
    setError(null);
    setSuccess(null);

    try {
      await (api as any).openbb.stop();
      // Small delay to ensure clean shutdown
      await new Promise((r) => setTimeout(r, 1000));
      await (api as any).openbb.start();
      setServerStatus("running");
      setSuccess("Data server restarted with updated API keys.");
    } catch (err) {
      setServerStatus("stopped");
      setError(err instanceof Error ? err.message : "Failed to restart server");
    } finally {
      setRestarting(false);
    }
  }, [api]);

  // ---------------------------------------------------------------------------
  // Save & Restart combo
  // ---------------------------------------------------------------------------

  const handleSaveAndRestart = useCallback(async () => {
    const saved = await handleSave();
    if (saved) {
      await handleRestart();
    }
  }, [handleSave, handleRestart]);

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  const toggleVisibility = (key: string) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header with status indicator */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Circle
              className={`h-2.5 w-2.5 ${
                serverStatus === "running"
                  ? "fill-green-400 text-green-400"
                  : serverStatus === "starting"
                    ? "fill-yellow-400 text-yellow-400 animate-pulse"
                    : serverStatus === "stopped"
                      ? "fill-red-400 text-red-400"
                      : "fill-neutral-500 text-neutral-500"
              }`}
            />
            <span className="text-xs font-medium text-neutral-400">
              Data Server:{" "}
              <span
                className={
                  serverStatus === "running"
                    ? "text-green-400"
                    : serverStatus === "starting"
                      ? "text-yellow-400"
                      : serverStatus === "stopped"
                        ? "text-red-400"
                        : "text-neutral-500"
                }
              >
                {serverStatus === "running"
                  ? "Running"
                  : serverStatus === "starting"
                    ? "Starting..."
                    : serverStatus === "stopped"
                      ? "Stopped"
                      : "Unknown"}
              </span>
            </span>
          </div>
          <span className="text-[10px] text-neutral-600">
            {configuredCount}/{PROVIDERS.length} providers configured
          </span>
        </div>

        <p className="text-muted text-xs">
          Configure API keys for financial data providers used by the Research
          tab. Keys are stored securely and injected when the data server starts.
        </p>
        <p className="text-muted mt-1 text-xs">
          <strong className="text-foreground">yfinance</strong> (free, no key
          needed) is the default provider for most data. Additional providers
          unlock more endpoints and higher-quality data.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {loading ? (
        <div className="text-muted flex items-center gap-2 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading provider configuration...
        </div>
      ) : (
        <div className="space-y-4">
          {PROVIDERS.map((provider) => {
            const currentValue = edited[provider.key] ?? "";
            const savedValue = secrets[provider.key] ?? "";
            const isConfigured = savedValue.trim().length > 0;
            const isVisible = visibleKeys.has(provider.key);
            const validation = validateKey(currentValue, provider);
            const showValidation =
              currentValue.trim().length > 0 && !validation.valid;

            return (
              <div
                key={provider.key}
                className="border-border-medium rounded-lg border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-sm font-medium">
                        {provider.label}
                      </span>
                      {isConfigured ? (
                        <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">
                          Configured
                        </span>
                      ) : provider.optional ? (
                        <span className="text-muted rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium">
                          Optional
                        </span>
                      ) : (
                        <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-muted mt-0.5 text-xs leading-relaxed">
                      {provider.description}
                    </p>
                  </div>
                  <a
                    href={provider.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:text-accent/80 mt-0.5 flex shrink-0 items-center gap-1 text-[11px] transition-colors"
                  >
                    Get Key
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type={isVisible ? "text" : "password"}
                      value={currentValue}
                      onChange={(e) =>
                        setEdited((prev) => ({
                          ...prev,
                          [provider.key]: e.target.value,
                        }))
                      }
                      placeholder={`Enter ${provider.label} API key...`}
                      disabled={saving}
                      spellCheck={false}
                      className={`bg-modal-bg border-border-medium focus:border-accent placeholder:text-dim text-foreground w-full rounded border px-2.5 py-1.5 pr-8 font-mono text-[13px] focus:outline-none disabled:opacity-50 ${
                        showValidation ? "border-yellow-500/50" : ""
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => toggleVisibility(provider.key)}
                      className="text-muted hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                      aria-label={isVisible ? "Hide key" : "Show key"}
                    >
                      {isVisible ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Validation warning */}
                {showValidation && (
                  <div className="mt-1.5 flex items-center gap-1 text-[10px] text-yellow-500">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {validation.message}
                  </div>
                )}

                <div className="mt-1.5 text-[10px] text-neutral-600">
                  Secret key:{" "}
                  <code className="text-neutral-500">{provider.key}</code>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          type="button"
          onClick={handleRestart}
          disabled={restarting || loading}
          className="gap-1.5"
        >
          {restarting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {restarting ? "Restarting..." : "Restart Data Server"}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            type="button"
            onClick={loadSecrets}
            disabled={!isDirty || saving || loading}
          >
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!isDirty || saving || loading || hasValidationErrors}
          >
            {saving ? "Saving..." : "Save Keys"}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSaveAndRestart()}
            disabled={
              !isDirty || saving || restarting || loading || hasValidationErrors
            }
            className="gap-1.5"
          >
            {saving || restarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {saving
              ? "Saving..."
              : restarting
                ? "Restarting..."
                : "Save & Restart"}
          </Button>
        </div>
      </div>
    </div>
  );
};
