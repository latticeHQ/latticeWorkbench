import React, { useCallback, useEffect, useState } from "react";
import {
  MessageSquare,
  Plus,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  ChevronRight,
  Copy,
} from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { Input } from "@/browser/components/ui/input";
import { Switch } from "@/browser/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/browser/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/browser/components/ui/tooltip";
import { useAPI } from "@/browser/contexts/API";
import { copyToClipboard } from "@/browser/utils/clipboard";
import type { ChannelListItem, ChannelConfig } from "@/common/types/channel";

// ── Platform metadata ──────────────────────────────────────────────────

const PLATFORM_INFO: Record<
  string,
  {
    label: string;
    icon: string;
    color: string;
    credentialLabel: string;
    credentialKey: string;
    placeholder: string;
  }
> = {
  telegram: {
    label: "Telegram",
    icon: "T",
    color: "bg-blue-500/20 text-blue-400",
    credentialLabel: "Bot Token",
    credentialKey: "botToken",
    placeholder: "123456:ABC-DEF1234ghIkl-zyx57W2v...",
  },
  discord: {
    label: "Discord",
    icon: "D",
    color: "bg-indigo-500/20 text-indigo-400",
    credentialLabel: "Bot Token",
    credentialKey: "botToken",
    placeholder: "MTA5NzE5OTk4NjM0...",
  },
  slack: {
    label: "Slack",
    icon: "S",
    color: "bg-purple-500/20 text-purple-400",
    credentialLabel: "Bot Token",
    credentialKey: "botToken",
    placeholder: "xoxb-...",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: "W",
    color: "bg-green-500/20 text-green-400",
    credentialLabel: "Access Token",
    credentialKey: "accessToken",
    placeholder: "EAAx...",
  },
};

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  disconnected: "bg-zinc-500",
  error: "bg-red-500",
};

// ── Create channel dialog ─────────────────────────────────────────────

interface CreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function ChannelCreateDialog({ isOpen, onClose, onCreated }: CreateDialogProps) {
  const { api } = useAPI();

  const [type, setType] = useState("telegram");
  const [accountId, setAccountId] = useState("");
  const [credential, setCredential] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [sessionScope, setSessionScope] = useState("per-peer");
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState<string[]>([]);

  const info = PLATFORM_INFO[type];

  // Load available projects when dialog opens
  useEffect(() => {
    if (!isOpen || !api) return;
    api.projects
      .list()
      .then((list) => {
        const paths = list.map(([path]) => path);
        setProjects(paths);
        if (!projectPath && paths.length > 0) {
          setProjectPath(paths[0]!);
        }
      })
      .catch(() => {
        // ignore — user can still type manually
      });
  }, [isOpen, api]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = useCallback(() => {
    setType("telegram");
    setAccountId("");
    setCredential("");
    setProjectPath("");
    setSessionScope("per-peer");
    setEnabled(true);
    setError("");
    setSaving(false);
  }, []);

  const handleCreate = useCallback(async () => {
    if (!api) return;

    const trimmedId = accountId.trim();
    const trimmedCred = credential.trim();
    const trimmedProject = projectPath.trim();

    if (!trimmedId) {
      setError("Account ID is required");
      return;
    }
    if (!trimmedCred) {
      setError(`${info?.credentialLabel ?? "Credential"} is required`);
      return;
    }
    if (!trimmedProject) {
      setError("Headquarter is required — select which project receives inbound messages");
      return;
    }

    setError("");
    setSaving(true);

    try {
      const config: ChannelConfig = {
        type: type as ChannelConfig["type"],
        accountId: trimmedId,
        enabled,
        defaultProjectPath: trimmedProject,
        sessionScope: sessionScope as ChannelConfig["sessionScope"],
        credentials: { [info?.credentialKey ?? "token"]: trimmedCred },
      };

      const result = await api.channels.create(config);
      if (!result.success) {
        setError(result.error ?? "Failed to create channel");
        setSaving(false);
        return;
      }

      resetForm();
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [
    api,
    type,
    accountId,
    credential,
    projectPath,
    sessionScope,
    enabled,
    info,
    resetForm,
    onCreated,
    onClose,
  ]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetForm();
          onClose();
        }
      }}
    >
      <DialogContent maxWidth="440px" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-sm">Add Channel</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {/* Platform type */}
          <div className="space-y-1">
            <label className="text-foreground text-[11px] font-medium">Platform</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="border-border-medium bg-background h-7 w-full text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PLATFORM_INFO).map(([key, p]) => (
                  <SelectItem key={key} value={key} className="text-[11px]">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Account ID */}
          <div className="space-y-1">
            <label className="text-foreground text-[11px] font-medium">Account ID</label>
            <div className="text-muted text-[10px]">
              Unique name for this channel (e.g. "my-bot")
            </div>
            <Input
              value={accountId}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAccountId(e.target.value)}
              placeholder="my-telegram-bot"
              className="border-border-medium bg-background h-7 text-[11px]"
            />
          </div>

          {/* Credential */}
          <div className="space-y-1">
            <label className="text-foreground text-[11px] font-medium">
              {info?.credentialLabel ?? "Token"}
            </label>
            <div className="text-muted text-[10px]">
              {type === "telegram"
                ? "Get from @BotFather on Telegram"
                : type === "discord"
                  ? "Get from Discord Developer Portal"
                  : "Platform authentication token"}
            </div>
            <Input
              value={credential}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCredential(e.target.value)}
              placeholder={info?.placeholder ?? "Enter token..."}
              className="border-border-medium bg-background h-7 font-mono text-[11px]"
              type="password"
            />
          </div>

          {/* Default project */}
          <div className="space-y-1">
            <label className="text-foreground text-[11px] font-medium">
              Headquarter <span className="text-error">*</span>
            </label>
            <div className="text-muted text-[10px]">
              New workspaces created in this project for inbound messages
            </div>
            {projects.length > 0 ? (
              <Select value={projectPath} onValueChange={setProjectPath}>
                <SelectTrigger className="border-border-medium bg-background h-7 w-full font-mono text-[11px]">
                  <SelectValue placeholder="Select a project..." />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => {
                    const shortName = p.split("/").slice(-2).join("/");
                    return (
                      <SelectItem key={p} value={p} className="text-[11px]">
                        {shortName}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={projectPath}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setProjectPath(e.target.value)
                }
                placeholder="/path/to/your/project"
                className="border-border-medium bg-background h-7 font-mono text-[11px]"
              />
            )}
          </div>

          {/* Session scope */}
          <div className="space-y-1">
            <label className="text-foreground text-[11px] font-medium">Session Scope</label>
            <Select value={sessionScope} onValueChange={setSessionScope}>
              <SelectTrigger className="border-border-medium bg-background h-7 w-full text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="per-peer" className="text-[11px]">
                  Per User (isolated)
                </SelectItem>
                <SelectItem value="per-channel-peer" className="text-[11px]">
                  Per Channel + User
                </SelectItem>
                <SelectItem value="shared" className="text-[11px]">
                  Shared (single workspace)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-0.5">
            <div>
              <div className="text-foreground text-[11px] font-medium">Auto-connect</div>
              <div className="text-muted text-[10px]">Connect when workbench starts</div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Toggle auto-connect"
            />
          </div>

          {error && <p className="text-error text-[11px]">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => {
              resetForm();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button size="sm" className="h-7 text-[11px]" onClick={handleCreate} disabled={saving}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main section ──────────────────────────────────────────────────────

export function ChannelsSection() {
  const { api } = useAPI();
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [configs, setConfigs] = useState<Map<string, ChannelConfig>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    if (!api) return;
    setError("");
    try {
      const list = await api.channels.list();
      setChannels(list);

      const configMap = new Map<string, ChannelConfig>();
      for (const ch of list) {
        try {
          const config = await api.channels.get({ accountId: ch.accountId });
          configMap.set(ch.accountId, config);
        } catch {
          // ignore individual config load failures
        }
      }
      setConfigs(configMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadChannels();

    const interval = setInterval(() => {
      loadChannels();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadChannels]);

  const handleConnect = useCallback(
    async (accountId: string) => {
      if (!api) return;
      try {
        const result = await api.channels.connect({ accountId });
        if (!result.success) {
          setError(result.error ?? "Failed to connect");
        }
        await loadChannels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, loadChannels]
  );

  const handleDisconnect = useCallback(
    async (accountId: string) => {
      if (!api) return;
      try {
        const result = await api.channels.disconnect({ accountId });
        if (!result.success) {
          setError(result.error ?? "Failed to disconnect");
        }
        await loadChannels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, loadChannels]
  );

  const handleRemove = useCallback(
    async (accountId: string) => {
      if (!api) return;
      try {
        const result = await api.channels.remove({ accountId });
        if (!result.success) {
          setError(result.error ?? "Failed to remove");
        }
        await loadChannels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, loadChannels]
  );

  const handleToggle = useCallback(
    async (channel: ChannelListItem, enabled: boolean) => {
      if (!api) return;
      const config = configs.get(channel.accountId);
      if (!config) return;
      try {
        await api.channels.update({ ...config, enabled });
        await loadChannels();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [api, configs, loadChannels]
  );

  const toggleExpand = (accountId: string) => {
    setExpandedId((prev) => (prev === accountId ? null : accountId));
  };

  // ── Expanded detail row ──
  const renderExpandedRow = (ch: ChannelListItem) => {
    const config = configs.get(ch.accountId);
    if (!config) return null;

    const projectShort = config.defaultProjectPath
      ? config.defaultProjectPath.split("/").slice(-2).join("/")
      : "Not set";

    return (
      <tr key={`${ch.accountId}-detail`}>
        <td colSpan={6} className="p-0">
          <div className="bg-background-secondary/20 border-t border-border-medium/50 px-4 py-2.5">
            <div className="ml-4 space-y-2">
              {/* Account ID */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Account</span>
                <button
                  type="button"
                  className="text-muted hover:text-foreground flex items-center gap-1 bg-transparent p-0 text-[11px] font-mono"
                  onClick={() => void copyToClipboard(config.accountId)}
                >
                  <code>{config.accountId}</code>
                  <Copy className="h-2.5 w-2.5 opacity-50" />
                </button>
              </div>

              {/* Headquarter */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Headquarter</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-foreground text-[11px] font-mono truncate max-w-[280px] block cursor-help">
                      {projectShort}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="text-[11px] font-mono">
                    {config.defaultProjectPath ?? "Not set"}
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Session scope */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Scope</span>
                <span className="text-foreground text-[11px]">
                  {config.sessionScope ?? "per-peer"}
                </span>
              </div>

              {/* Auto-connect */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Auto-connect</span>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(val) => handleToggle(ch, val)}
                  aria-label="Toggle auto-connect"
                />
              </div>

              {/* Credentials */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Credentials</span>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(config.credentials).map((key) => (
                    <span
                      key={key}
                      className="bg-background-secondary rounded px-1.5 py-0.5 font-mono text-[10px] text-muted"
                    >
                      {key}: {"*".repeat(8)}
                    </span>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-1">
                <span className="w-20 shrink-0" />
                <div className="flex items-center gap-2">
                  {ch.status === "connected" ? (
                    <button
                      type="button"
                      className="text-muted hover:text-foreground flex items-center gap-1 text-[10px]"
                      onClick={() => handleDisconnect(ch.accountId)}
                    >
                      <PowerOff className="h-3 w-3" />
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-muted hover:text-foreground flex items-center gap-1 text-[10px]"
                      onClick={() => handleConnect(ch.accountId)}
                      disabled={ch.status === "connecting"}
                    >
                      <Power className="h-3 w-3" />
                      Connect
                    </button>
                  )}
                  <span className="text-border-medium">|</span>
                  <button
                    type="button"
                    className="text-muted hover:text-red-400 flex items-center gap-1 text-[10px]"
                    onClick={() => handleRemove(ch.accountId)}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </button>
                </div>
              </div>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      {/* ── Channels table ── */}
      <div className="border-border-medium rounded-md border">
        <div className="bg-background-secondary/40 flex items-center justify-between border-b border-border-medium/50 px-3 py-1.5">
          <span className="text-[10px] font-semibold tracking-wide uppercase text-muted">
            Channels
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="text-muted hover:text-foreground flex items-center gap-1 text-[10px]"
              onClick={() => {
                setLoading(true);
                loadChannels();
              }}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              className="text-muted hover:text-foreground flex items-center gap-1 text-[10px]"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Add
            </button>
          </div>
        </div>

        <div className="text-muted px-3 py-1.5 text-[10px] border-b border-border-medium/50">
          Connect messaging platforms (Telegram, Discord, Slack, WhatsApp) to route messages into
          workspace sessions.
        </div>

        {error && (
          <div className="text-error px-3 py-1.5 text-[10px] border-b border-border-medium/50">
            {error}
          </div>
        )}

        {loading && channels.length === 0 ? (
          <div className="text-muted flex items-center justify-center py-8 text-[11px]">
            Loading channels...
          </div>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <MessageSquare className="text-muted h-5 w-5" />
            <div className="text-center">
              <p className="text-foreground text-[11px] font-medium">No channels configured</p>
              <p className="text-muted mt-0.5 text-[10px]">
                Add a bot to receive messages from external users
              </p>
            </div>
            <button
              type="button"
              className="text-accent hover:text-accent/80 mt-1 flex items-center gap-1 text-[10px]"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-3 w-3" />
              Add Channel
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-medium/50">
                <th className="px-3 py-1 text-left text-[10px] font-medium text-muted">Channel</th>
                <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Account</th>
                <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Scope</th>
                <th className="px-2 py-1 text-center text-[10px] font-medium text-muted">
                  Sessions
                </th>
                <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Status</th>
                <th className="px-2 py-1 text-right text-[10px] font-medium text-muted">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-medium/30">
              {channels.map((ch) => {
                const info = PLATFORM_INFO[ch.type];
                const isExpanded = expandedId === ch.accountId;
                const isConnected = ch.status === "connected";
                const isConnecting = ch.status === "connecting";

                return (
                  <React.Fragment key={ch.accountId}>
                    <tr
                      className="hover:bg-background-secondary/30 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(ch.accountId)}
                    >
                      {/* Platform + chevron */}
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight
                            className={`h-3 w-3 shrink-0 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                          />
                          <span
                            className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${info?.color ?? "bg-zinc-500/20 text-zinc-400"}`}
                          >
                            {info?.icon ?? "?"}
                          </span>
                          <span className="text-foreground text-[11px] font-medium">
                            {info?.label ?? ch.type}
                          </span>
                        </div>
                      </td>
                      {/* Account */}
                      <td className="px-2 py-1.5">
                        <span className="text-muted text-[10px] font-mono">{ch.accountId}</span>
                      </td>
                      {/* Scope */}
                      <td className="px-2 py-1.5">
                        <span className="text-muted text-[10px]">{ch.sessionScope}</span>
                      </td>
                      {/* Sessions */}
                      <td className="px-2 py-1.5 text-center">
                        <span className="text-muted text-[10px]">{ch.sessionCount}</span>
                      </td>
                      {/* Status dot + label */}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[ch.status] ?? STATUS_COLORS.disconnected}`}
                          />
                          <span className="text-muted text-[10px]">{ch.status}</span>
                        </div>
                      </td>
                      {/* Quick actions */}
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-px">
                          {isConnected ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted hover:text-foreground rounded p-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDisconnect(ch.accountId);
                                  }}
                                >
                                  <PowerOff className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-[11px]">Disconnect</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-muted hover:text-foreground rounded p-1 disabled:opacity-30"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleConnect(ch.accountId);
                                  }}
                                  disabled={isConnecting}
                                >
                                  <Power className="h-3 w-3" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-[11px]">Connect</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted hover:text-red-400 rounded p-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemove(ch.accountId);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent className="text-[11px]">Remove</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? renderExpandedRow(ch) : null}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <ChannelCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={loadChannels}
      />
    </div>
  );
}
