/**
 * InboxesSettingsSection — configure channel adapter tokens and manage
 * connections. Modeled after latticeWorkbench-runtime's ViscaSection with
 * per-channel token inputs, show/hide toggle, status badges, and
 * connect/disconnect buttons.
 */
import React, { useState, useEffect } from "react";
import { Send, Wifi, WifiOff, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";
import { cn } from "@/common/lib/utils";

// ---------------------------------------------------------------------------
// Channel definitions — extend as more adapters are implemented
// ---------------------------------------------------------------------------

interface ChannelDef {
  channel: "telegram";
  label: string;
  icon: React.FC<{ className?: string }>;
  tokenLabel: string;
  tokenPlaceholder: string;
  helpText: string;
}

const CHANNELS: ChannelDef[] = [
  {
    channel: "telegram",
    label: "Telegram",
    icon: Send,
    tokenLabel: "Bot Token",
    tokenPlaceholder: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
    helpText: "Create a bot via @BotFather and paste the token here.",
  },
  // Future: { channel: "slack", ... }, { channel: "discord", ... }
];

// ---------------------------------------------------------------------------
// Per-adapter status from backend
// ---------------------------------------------------------------------------

interface AdapterStatus {
  channel: string;
  status: string;
  description?: string | null;
  error?: string | null;
}

interface TokenStatus {
  channel: string;
  configured: boolean;
  maskedToken?: string | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge(props: { adapter: AdapterStatus | undefined }) {
  if (!props.adapter) {
    return (
      <span className="text-muted flex items-center gap-1 text-xs">
        <WifiOff className="h-3 w-3" />
        Not configured
      </span>
    );
  }

  const { status, description, error } = props.adapter;
  const isConnected = status === "connected";
  const isError = status === "error";
  const isConnecting = status === "connecting";

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs",
        isConnected
          ? "text-green-400"
          : isError
            ? "text-red-400"
            : isConnecting
              ? "text-yellow-400"
              : "text-muted",
      )}
    >
      {isConnected ? (
        <Wifi className="h-3 w-3" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      <span className="capitalize">{status}</span>
      {description && (
        <span className="text-muted">({description})</span>
      )}
      {error && (
        <span className="ml-1 text-red-400/70">{error}</span>
      )}
    </span>
  );
}

function ChannelRow(props: {
  def: ChannelDef;
  adapterStatus: AdapterStatus | undefined;
  tokenStatus: TokenStatus | undefined;
  onSaveToken: (channel: string, token: string | null) => Promise<void>;
  onConnect: (channel: string) => Promise<void>;
  onDisconnect: (channel: string) => Promise<void>;
}) {
  const Icon = props.def.icon;
  const isConnected = props.adapterStatus?.status === "connected";
  const isConnecting = props.adapterStatus?.status === "connecting";

  // Local state for the token input — separate from backend state
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill with masked token if configured (so user sees something is there)
  useEffect(() => {
    if (props.tokenStatus?.configured && props.tokenStatus.maskedToken) {
      setTokenInput(props.tokenStatus.maskedToken);
    }
  }, [props.tokenStatus?.configured, props.tokenStatus?.maskedToken]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const token = tokenInput.trim();
      // If user clears the field or it's still the masked value, treat as clear
      if (!token || token === props.tokenStatus?.maskedToken) {
        await props.onSaveToken(props.def.channel, null);
        setTokenInput("");
      } else {
        await props.onSaveToken(props.def.channel, token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save token");
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await props.onConnect(props.def.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await props.onDisconnect(props.def.channel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setConnecting(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.onSaveToken(props.def.channel, null);
      setTokenInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear token");
    } finally {
      setSaving(false);
    }
  };

  // Determine if the input has a real (non-masked) new token
  const hasNewToken =
    tokenInput.trim() !== "" &&
    tokenInput.trim() !== props.tokenStatus?.maskedToken;

  return (
    <div className="border-border-medium rounded-md border p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="text-muted h-4 w-4" />
          <span className="text-foreground text-sm font-medium">
            {props.def.label}
          </span>
        </div>
        <StatusBadge adapter={props.adapterStatus} />
      </div>

      {/* Token input */}
      <div className="mb-2">
        <label className="text-muted mb-1 block text-xs">
          {props.def.tokenLabel}
        </label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type={showToken ? "text" : "password"}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={props.def.tokenPlaceholder}
              disabled={saving}
              spellCheck={false}
              className="bg-modal-bg border-border-medium focus:border-accent placeholder:text-dim text-foreground w-full rounded border px-2.5 py-1.5 pr-8 font-mono text-[13px] focus:outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="text-muted hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !hasNewToken}
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </div>
        <p className="text-muted mt-1 text-[11px]">{props.def.helpText}</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-destructive/10 text-destructive mb-2 rounded px-2 py-1 text-xs">
          {error}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {props.tokenStatus?.configured && (
          <>
            {isConnected ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleDisconnect()}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Disconnect
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleConnect()}
                disabled={connecting || isConnecting}
              >
                {connecting || isConnecting ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : null}
                Connect
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleClear()}
              disabled={saving}
              className="text-red-400 hover:text-red-300"
            >
              Remove Token
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const InboxesSettingsSection: React.FC = () => {
  const { api } = useAPI();
  const [adapterStatuses, setAdapterStatuses] = useState<AdapterStatus[]>([]);
  const [tokenStatuses, setTokenStatuses] = useState<TokenStatus[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch initial state
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    async function load() {
      try {
        const [connStatus, tokens] = await Promise.all([
          api!.inbox.connectionStatus(),
          api!.inbox.getChannelTokens(),
        ]);
        if (cancelled) return;
        setAdapterStatuses(connStatus.adapters);
        setTokenStatuses(tokens);
      } catch {
        // Non-fatal — user just sees empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [api]);

  // Refresh adapter statuses after an action
  const refreshStatuses = async () => {
    if (!api) return;
    try {
      const [connStatus, tokens] = await Promise.all([
        api.inbox.connectionStatus(),
        api.inbox.getChannelTokens(),
      ]);
      setAdapterStatuses(connStatus.adapters);
      setTokenStatuses(tokens);
    } catch {
      // Best-effort refresh
    }
  };

  const handleSaveToken = async (channel: string, token: string | null) => {
    if (!api) return;
    await api.inbox.setChannelToken({ channel: channel as "telegram", token });
    await refreshStatuses();
  };

  const handleConnect = async (channel: string) => {
    if (!api) return;
    await api.inbox.connectAdapter({ channel: channel as "telegram" });
    await refreshStatuses();
  };

  const handleDisconnect = async (channel: string) => {
    if (!api) return;
    await api.inbox.disconnectAdapter({ channel: channel as "telegram" });
    await refreshStatuses();
  };

  if (loading) {
    return (
      <div className="text-muted flex items-center gap-2 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading inbox settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted text-xs">
          Connect messaging platform bots to receive and auto-respond to messages
          via Lattice agents. Each channel requires its own bot token.
        </p>
        <p className="text-muted mt-1 text-xs">
          Tokens are stored in{" "}
          <code className="text-accent">~/.lattice/config.json</code>. You can also
          set them via environment variables (e.g.,{" "}
          <code className="text-accent">LATTICE_TELEGRAM_BOT_TOKEN</code>).
        </p>
      </div>

      {CHANNELS.map((def) => {
        const adapterStatus = adapterStatuses.find(
          (a) => a.channel === def.channel,
        );
        const tokenStatus = tokenStatuses.find(
          (t) => t.channel === def.channel,
        );

        return (
          <ChannelRow
            key={def.channel}
            def={def}
            adapterStatus={adapterStatus}
            tokenStatus={tokenStatus}
            onSaveToken={handleSaveToken}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        );
      })}
    </div>
  );
};
