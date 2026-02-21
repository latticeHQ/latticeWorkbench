/**
 * LiveKitSection — settings form for LiveKit voice/video credentials.
 *
 * Stores three values in providers.jsonc under the "livekit" key:
 *   - wsUrl      (LiveKit Cloud WebSocket URL, e.g. wss://xxx.livekit.cloud)
 *   - apiKey     (LiveKit API Key)
 *   - apiSecret  (LiveKit API Secret — password-obscured)
 *
 * Uses the same api.providers.setProviderConfig pattern as the rest
 * of the providers section. Saves on blur (not on every keystroke).
 */

import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { Input } from "@/browser/components/ui/input";
import { useAPI } from "@/browser/contexts/API";

interface FieldState {
  value: string;
  saving: boolean;
  saved: boolean;
}

const EMPTY: FieldState = { value: "", saving: false, saved: false };

export function LiveKitSection() {
  const { api } = useAPI();

  const [wsUrl, setWsUrl] = useState<FieldState>(EMPTY);
  const [apiKey, setApiKey] = useState<FieldState>(EMPTY);
  const [apiSecret, setApiSecret] = useState<FieldState>(EMPTY);
  const [showSecret, setShowSecret] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Track saved flash timeouts
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── Load current config ──────────────────────────────────────────

  useEffect(() => {
    if (!api) return;
    void api.providers.getConfig().then((config) => {
      const lk = config.livekit as
        | { apiKeySet?: boolean; baseUrl?: string; [k: string]: unknown }
        | undefined;
      // wsUrl is stored as baseUrl in the generic ProviderConfig schema
      setWsUrl({ value: (lk?.baseUrl as string | undefined) ?? "", saving: false, saved: false });
      // apiKey and apiSecret: apiKeySet tells us if they're set, but the actual values
      // are redacted. Show placeholder if set.
      setApiKey({
        value: lk?.apiKeySet ? "••••••••••••••••" : "",
        saving: false,
        saved: false,
      });
      setApiSecret({ value: "", saving: false, saved: false });
      setLoaded(true);
    });
  }, [api]);

  // ── Save helper ──────────────────────────────────────────────────

  const save = async (
    field: string,
    keyPath: string[],
    value: string,
    setter: React.Dispatch<React.SetStateAction<FieldState>>
  ) => {
    if (!api || !value.trim()) return;
    setter((prev) => ({ ...prev, saving: true, saved: false }));
    try {
      await api.providers.setProviderConfig({ provider: "livekit", keyPath, value });
      setter((prev) => ({ ...prev, saving: false, saved: true }));
      // Clear "saved" flash after 2s
      if (savedTimers.current[field]) clearTimeout(savedTimers.current[field]);
      savedTimers.current[field] = setTimeout(() => {
        setter((prev) => ({ ...prev, saved: false }));
      }, 2000);
    } catch {
      setter((prev) => ({ ...prev, saving: false, saved: false }));
    }
  };

  // ── Cleanup timers ───────────────────────────────────────────────

  useEffect(() => {
    const timers = savedTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center gap-1.5 px-1 py-2">
        <Loader2 size={11} className="text-muted animate-spin" />
        <span className="text-muted text-[11px]">Loading…</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-1">
      {/* Docs link */}
      <div className="flex items-center gap-1 pb-0.5">
        <a
          href="https://cloud.livekit.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted hover:text-accent flex items-center gap-0.5 text-[10px] transition-colors"
        >
          <ExternalLink size={9} />
          <span>LiveKit Cloud</span>
        </a>
        <span className="text-muted text-[10px]">— get your credentials from Project Settings</span>
      </div>

      {/* wsUrl */}
      <CredentialRow
        label="Server URL"
        placeholder="wss://my-project.livekit.cloud"
        value={wsUrl.value}
        saving={wsUrl.saving}
        saved={wsUrl.saved}
        type="text"
        onChange={(v) => setWsUrl((p) => ({ ...p, value: v }))}
        onBlur={(v) => void save("wsUrl", ["wsUrl"], v, setWsUrl)}
      />

      {/* apiKey */}
      <CredentialRow
        label="API Key"
        placeholder="APIxxxxxxxxxxxxxxx"
        value={apiKey.value}
        saving={apiKey.saving}
        saved={apiKey.saved}
        type="text"
        onChange={(v) => setApiKey((p) => ({ ...p, value: v }))}
        onBlur={(v) => void save("apiKey", ["apiKey"], v, setApiKey)}
      />

      {/* apiSecret */}
      <CredentialRow
        label="API Secret"
        placeholder="Enter to update…"
        value={apiSecret.value}
        saving={apiSecret.saving}
        saved={apiSecret.saved}
        type={showSecret ? "text" : "password"}
        showToggle
        onToggleShow={() => setShowSecret((s) => !s)}
        showingSecret={showSecret}
        onChange={(v) => setApiSecret((p) => ({ ...p, value: v }))}
        onBlur={(v) => void save("apiSecret", ["apiSecret"], v, setApiSecret)}
      />
    </div>
  );
}

// ── Single credential input row ──────────────────────────────────────────────

interface CredentialRowProps {
  label: string;
  placeholder: string;
  value: string;
  saving: boolean;
  saved: boolean;
  type: "text" | "password";
  showToggle?: boolean;
  showingSecret?: boolean;
  onToggleShow?: () => void;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
}

function CredentialRow({
  label,
  placeholder,
  value,
  saving,
  saved,
  type,
  showToggle,
  showingSecret,
  onToggleShow,
  onChange,
  onBlur,
}: CredentialRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted w-20 shrink-0 text-right text-[11px]">{label}</span>
      <div className="relative flex flex-1 items-center">
        <Input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => onBlur(e.target.value)}
          className="border-border-medium bg-background-secondary h-7 flex-1 pr-12 text-[11px] font-mono"
        />
        {/* Status indicators */}
        <div className="absolute right-2 flex items-center gap-1">
          {saving && <Loader2 size={11} className="text-muted animate-spin" />}
          {saved && <CheckCircle2 size={11} className="text-[var(--color-success)]" />}
          {showToggle && onToggleShow && (
            <button
              type="button"
              onClick={onToggleShow}
              className="text-muted hover:text-foreground ml-0.5 transition-colors"
              tabIndex={-1}
              title={showingSecret ? "Hide secret" : "Show secret"}
            >
              {showingSecret ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
