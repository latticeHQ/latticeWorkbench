/**
 * LiveKitSection — settings form for LiveKit voice/video credentials.
 *
 * Stores three values in providers.jsonc under the "livekit" key:
 *   - wsUrl      (LiveKit Cloud WebSocket URL, e.g. wss://xxx.livekit.cloud)
 *   - apiKey     (LiveKit API Key)
 *   - apiSecret  (LiveKit API Secret — password-obscured)
 *
 * Uses a single "Save" button — all dirty fields are written together.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, ExternalLink, Check, Loader2, Save } from "lucide-react";
import { Input } from "@/browser/components/ui/input";
import { Button } from "@/browser/components/ui/button";
import { useAPI } from "@/browser/contexts/API";

type SaveState = "idle" | "saving" | "saved";

export function LiveKitSection() {
  const { api } = useAPI();

  // Current values in the form
  const [wsUrl, setWsUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // Track what was last successfully saved (to detect dirty state)
  const savedRef = useRef({ wsUrl: "", apiKey: "", apiSecret: "" });

  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load current config ──────────────────────────────────────────

  useEffect(() => {
    if (!api) return;
    // Use dedicated livekit.getConfig — providers.getConfig() only returns SUPPORTED_PROVIDERS
    // (CLI agent slugs) and never includes "livekit".
    void api.livekit.getConfig().then((cfg) => {
      const url = cfg.baseUrl ?? "";
      const key = cfg.apiKeySet ? "••••••••••••••••" : "";
      setWsUrl(url);
      setApiKey(key);
      setApiSecret("");
      savedRef.current = { wsUrl: url, apiKey: key, apiSecret: "" };
      setLoaded(true);
    });
  }, [api]);

  // ── Dirty check ──────────────────────────────────────────────────

  const isDirty =
    wsUrl !== savedRef.current.wsUrl ||
    apiKey !== savedRef.current.apiKey ||
    apiSecret !== savedRef.current.apiSecret;

  // ── Save all dirty fields ────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!api || saveState === "saving") return;
    setSaveState("saving");

    try {
      const saves: Promise<unknown>[] = [];

      if (wsUrl !== savedRef.current.wsUrl && wsUrl.trim()) {
        // Store as "baseUrl" — this is the key getConfig() exposes back as lk.baseUrl
        saves.push(
          api.providers.setProviderConfig({ provider: "livekit", keyPath: ["baseUrl"], value: wsUrl.trim() })
        );
      }
      if (apiKey !== savedRef.current.apiKey && apiKey.trim() && !apiKey.startsWith("•")) {
        saves.push(
          api.providers.setProviderConfig({ provider: "livekit", keyPath: ["apiKey"], value: apiKey.trim() })
        );
      }
      if (apiSecret.trim()) {
        saves.push(
          api.providers.setProviderConfig({ provider: "livekit", keyPath: ["apiSecret"], value: apiSecret.trim() })
        );
      }

      await Promise.all(saves);

      // Update saved baseline
      savedRef.current = { wsUrl, apiKey, apiSecret: "" };
      // Clear secret field after save (it's write-only)
      setApiSecret("");

      setSaveState("saved");
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("idle");
    }
  }, [api, wsUrl, apiKey, apiSecret, saveState]);

  // Enter key saves
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isDirty) void handleSave();
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
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

      {/* Server URL */}
      <CredentialRow
        label="Server URL"
        placeholder="wss://my-project.livekit.cloud"
        value={wsUrl}
        type="text"
        onKeyDown={handleKeyDown}
        onChange={setWsUrl}
      />

      {/* API Key */}
      <CredentialRow
        label="API Key"
        placeholder="APIxxxxxxxxxxxxxxx"
        value={apiKey}
        type="text"
        onKeyDown={handleKeyDown}
        onChange={(v) => setApiKey(v)}
      />

      {/* API Secret */}
      <CredentialRow
        label="API Secret"
        placeholder="Enter to update…"
        value={apiSecret}
        type={showSecret ? "text" : "password"}
        showToggle
        onToggleShow={() => setShowSecret((s) => !s)}
        showingSecret={showSecret}
        onKeyDown={handleKeyDown}
        onChange={setApiSecret}
      />

      {/* Save button row */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {saveState === "saved" && (
          <span className="text-[var(--color-success)] flex items-center gap-1 text-[11px]">
            <Check size={11} />
            Saved
          </span>
        )}
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={!isDirty || saveState === "saving"}
          className="h-6 gap-1 px-2.5 text-[11px]"
        >
          {saveState === "saving" ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <Save size={11} />
          )}
          {saveState === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

// ── Single credential input row ──────────────────────────────────────────────

interface CredentialRowProps {
  label: string;
  placeholder: string;
  value: string;
  type: "text" | "password";
  showToggle?: boolean;
  showingSecret?: boolean;
  onToggleShow?: () => void;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function CredentialRow({
  label,
  placeholder,
  value,
  type,
  showToggle,
  showingSecret,
  onToggleShow,
  onChange,
  onKeyDown,
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
          onKeyDown={onKeyDown}
          className="border-border-medium bg-background-secondary h-7 flex-1 text-[11px] font-mono"
          style={showToggle ? { paddingRight: "2rem" } : undefined}
        />
        {showToggle && onToggleShow && (
          <button
            type="button"
            onClick={onToggleShow}
            className="text-muted hover:text-foreground absolute right-2 transition-colors"
            tabIndex={-1}
            title={showingSecret ? "Hide secret" : "Show secret"}
          >
            {showingSecret ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
      </div>
    </div>
  );
}
