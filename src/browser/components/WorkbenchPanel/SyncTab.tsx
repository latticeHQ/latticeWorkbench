/**
 * SyncTab — UI for GitHub config backup (sync ~/.lattice/ to a private repo).
 *
 * Three views:
 * 1. Unconfigured — setup prompt with cloud icon
 * 2. Setup form — repo picker (GitHub-integrated) + auto-sync toggle + category checkboxes
 * 3. Connected — status display, push/pull buttons, edit/disconnect
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Download,
  ExternalLink,
  Github,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type { SyncConfig, SyncStatus, SyncCategories } from "@/common/types/sync";
import { DEFAULT_SYNC_CATEGORIES } from "@/common/types/sync";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function shortCommit(hash: string): string {
  return hash.slice(0, 7);
}

// ---------------------------------------------------------------------------
// Repo source picker (GitHub-integrated)
// ---------------------------------------------------------------------------

type RepoSource = "github" | "manual";
interface GhRepo { name: string; fullName: string; url: string; isPrivate: boolean }

interface RepoPickerProps {
  repoUrl: string;
  onRepoUrl: (url: string) => void;
  api: NonNullable<ReturnType<typeof useAPI>["api"]>;
}

/**
 * Repo picker: checks `gh` auth, shows create/select or falls back to manual input.
 */
function RepoPicker(props: RepoPickerProps) {
  const [source, setSource] = useState<RepoSource>("github");
  const [ghAuth, setGhAuth] = useState<{ checked: boolean; authenticated: boolean; username: string | null }>({
    checked: false,
    authenticated: false,
    username: null,
  });
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newRepoName, setNewRepoName] = useState("lattice-backup");
  const [createError, setCreateError] = useState<string | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  // Whether the user is in "create new" mode within the GitHub tab
  const [showCreate, setShowCreate] = useState(false);

  // Check gh auth on mount
  useEffect(() => {
    let cancelled = false;
    void props.api.sync.checkGhAuth().then((result) => {
      if (cancelled) return;
      setGhAuth({ checked: true, authenticated: result.authenticated, username: result.username ?? null });
      // If not authenticated, fall back to manual
      if (!result.authenticated) {
        setSource("manual");
      }
    });
    return () => { cancelled = true; };
  }, [props.api]);

  const fetchRepos = () => {
    setLoadingRepos(true);
    void props.api.sync.listRepos().then((list) => {
      setRepos(list);
      setLoadingRepos(false);
    });
  };

  // Fetch repos when switching to github tab (if authenticated)
  useEffect(() => {
    if (source === "github" && ghAuth.authenticated && repos.length === 0) {
      fetchRepos();
    }
  }, [source, ghAuth.authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = () => {
    if (!newRepoName.trim()) return;
    setCreating(true);
    setCreateError(null);
    void props.api.sync
      .createRepo({ name: newRepoName.trim() })
      .then((result) => {
        props.onRepoUrl(result.url);
        setShowCreate(false);
        setCreating(false);
      })
      .catch((err: unknown) => {
        setCreateError(String(err));
        setCreating(false);
      });
  };

  const handleSelectRepo = (repo: GhRepo) => {
    props.onRepoUrl(repo.url);
  };

  // While checking auth, show a loader
  if (!ghAuth.checked) {
    return (
      <div className="flex items-center gap-2 py-2">
        <Loader2 className="text-muted h-3 w-3 animate-spin" />
        <span className="text-muted text-[10px]">Checking GitHub CLI...</span>
      </div>
    );
  }

  const filteredRepos = repoFilter
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(repoFilter.toLowerCase()) ||
          r.fullName.toLowerCase().includes(repoFilter.toLowerCase()),
      )
    : repos;

  return (
    <div className="flex flex-col gap-2">
      {/* Source tabs */}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setSource("github")}
          disabled={!ghAuth.authenticated}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
            source === "github"
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:text-foreground",
            !ghAuth.authenticated && "cursor-not-allowed opacity-40",
          )}
        >
          <Github className="h-3 w-3" />
          GitHub
        </button>
        <button
          type="button"
          onClick={() => setSource("manual")}
          className={cn(
            "flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
            source === "manual"
              ? "bg-accent text-accent-foreground"
              : "text-muted hover:text-foreground",
          )}
        >
          <ExternalLink className="h-3 w-3" />
          Manual URL
        </button>
      </div>

      {!ghAuth.authenticated && (
        <div className="text-muted flex items-start gap-1.5 text-[10px]">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            GitHub CLI not authenticated. Run{" "}
            <code className="bg-muted/30 rounded px-1">gh auth login</code> to enable repo
            creation and selection.
          </span>
        </div>
      )}

      {/* GitHub tab */}
      {source === "github" && ghAuth.authenticated && (
        <div className="flex flex-col gap-2">
          {ghAuth.username && (
            <span className="text-muted text-[10px]">
              Signed in as <span className="text-foreground font-medium">{ghAuth.username}</span>
            </span>
          )}

          {showCreate ? (
            // Create new repo form
            <div className="flex flex-col gap-1.5">
              <label className="text-foreground text-[10px] font-medium">New private repo name</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  className="border-border bg-background text-foreground placeholder:text-muted min-w-0 flex-1 rounded border px-2 py-1 text-xs"
                  placeholder="lattice-backup"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!newRepoName.trim() || creating}
                  onClick={handleCreate}
                  className={cn(
                    "bg-accent text-accent-foreground flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium",
                    (!newRepoName.trim() || creating) && "cursor-not-allowed opacity-50",
                  )}
                >
                  {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-muted hover:text-foreground text-[10px]"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {createError && (
                <span className="text-destructive text-[10px] break-all">{createError}</span>
              )}
            </div>
          ) : (
            // Repo list + create button
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="bg-accent text-accent-foreground flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium"
                >
                  <Plus className="h-3 w-3" />
                  New Repo
                </button>
                <button
                  type="button"
                  onClick={fetchRepos}
                  disabled={loadingRepos}
                  className="text-muted hover:text-foreground flex items-center gap-1 text-[10px]"
                >
                  <RefreshCw className={cn("h-3 w-3", loadingRepos && "animate-spin")} />
                </button>
              </div>

              {/* Search filter */}
              {repos.length > 5 && (
                <div className="relative">
                  <Search className="text-muted pointer-events-none absolute top-1/2 left-1.5 h-3 w-3 -translate-y-1/2" />
                  <input
                    type="text"
                    className="border-border bg-background text-foreground placeholder:text-muted w-full rounded border py-1 pr-2 pl-6 text-[10px]"
                    placeholder="Filter repos..."
                    value={repoFilter}
                    onChange={(e) => setRepoFilter(e.target.value)}
                  />
                </div>
              )}

              {loadingRepos ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="text-muted h-3 w-3 animate-spin" />
                  <span className="text-muted text-[10px]">Loading repos...</span>
                </div>
              ) : (
                <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                  {filteredRepos.map((repo) => (
                    <button
                      key={repo.fullName}
                      type="button"
                      onClick={() => handleSelectRepo(repo)}
                      className={cn(
                        "flex items-center gap-1.5 rounded px-2 py-1 text-left text-[10px]",
                        props.repoUrl === repo.url
                          ? "bg-accent/20 text-foreground"
                          : "text-muted hover:bg-muted/10 hover:text-foreground",
                      )}
                    >
                      {repo.isPrivate && <Lock className="h-2.5 w-2.5 shrink-0" />}
                      <span className="truncate">{repo.fullName}</span>
                      {props.repoUrl === repo.url && <Check className="ml-auto h-3 w-3 shrink-0" />}
                    </button>
                  ))}
                  {filteredRepos.length === 0 && repos.length > 0 && (
                    <span className="text-muted px-2 py-1 text-[10px]">No matching repos</span>
                  )}
                  {repos.length === 0 && (
                    <span className="text-muted px-2 py-1 text-[10px]">
                      No repos found. Create one above.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual URL input */}
      {source === "manual" && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            className="border-border bg-background text-foreground placeholder:text-muted rounded border px-2 py-1.5 text-xs"
            placeholder="git@github.com:user/lattice-backup.git"
            value={props.repoUrl}
            onChange={(e) => props.onRepoUrl(e.target.value)}
            autoFocus
          />
          <span className="text-muted text-[10px]">
            SSH or HTTPS. Must be a private repo you control.
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Form
// ---------------------------------------------------------------------------

interface SetupFormProps {
  initial?: SyncConfig | null;
  onSave: (config: SyncConfig) => void;
  onCancel: () => void;
  saving: boolean;
}

function SetupForm(props: SetupFormProps) {
  const { api } = useAPI();
  const [repoUrl, setRepoUrl] = useState(props.initial?.repoUrl ?? "");
  const [autoSync, setAutoSync] = useState(props.initial?.autoSync ?? true);
  const [categories, setCategories] = useState<SyncCategories>(
    props.initial?.categories ?? { ...DEFAULT_SYNC_CATEGORIES },
  );

  const toggleCategory = (key: keyof SyncCategories) => {
    setCategories((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl.trim()) return;
    props.onSave({
      repoUrl: repoUrl.trim(),
      autoSync,
      categories,
    });
  };

  const isSensitiveOn = categories.providers || categories.secrets;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3">
      {/* Repository picker — GitHub-integrated when gh CLI available */}
      <div className="flex flex-col gap-1">
        <label className="text-foreground text-xs font-medium">Repository</label>
        {api ? (
          <RepoPicker repoUrl={repoUrl} onRepoUrl={setRepoUrl} api={api} />
        ) : (
          <input
            type="text"
            className="border-border bg-background text-foreground placeholder:text-muted rounded border px-2 py-1.5 text-xs"
            placeholder="git@github.com:user/lattice-backup.git"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            autoFocus
          />
        )}
        {repoUrl && (
          <div className="text-muted flex items-center gap-1 text-[10px]">
            <Check className="h-2.5 w-2.5 text-green-500" />
            <span className="truncate">{repoUrl}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="text-foreground text-xs font-medium">Auto-sync on change</label>
        <button
          type="button"
          role="switch"
          aria-checked={autoSync}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
            autoSync ? "bg-accent" : "bg-border",
          )}
          onClick={() => setAutoSync(!autoSync)}
        >
          <span
            className={cn(
              "bg-foreground inline-block h-3.5 w-3.5 rounded-full transition-transform",
              autoSync ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-foreground mb-1 text-xs font-medium">Categories</legend>

        {(
          [
            ["config", "Config", "config.json — global settings"] as const,
            ["mcpConfig", "MCP Servers", "mcp.jsonc — MCP server definitions"] as const,
            ["chatHistory", "Chat History", "sessions/ — conversation logs"] as const,
            ["providers", "API Keys", "providers.jsonc — contains API keys"] as const,
            ["secrets", "Secrets", "secrets.json — environment secrets"] as const,
          ] as const
        ).map(([key, label, desc]) => (
          <label key={key} className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="accent-accent mt-0.5"
              checked={categories[key]}
              onChange={() => toggleCategory(key)}
            />
            <div className="flex flex-col">
              <span className="text-foreground text-xs">{label}</span>
              <span className="text-muted text-[10px]">{desc}</span>
            </div>
          </label>
        ))}
      </fieldset>

      {isSensitiveOn && (
        <div className="border-destructive/30 bg-destructive/5 flex items-start gap-2 rounded border p-2">
          <AlertTriangle className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="text-destructive text-[10px]">
            API Keys and Secrets contain sensitive data. Only sync to a PRIVATE repo you control.
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={!repoUrl.trim() || props.saving}
          className={cn(
            "bg-accent text-accent-foreground flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium",
            (!repoUrl.trim() || props.saving) && "cursor-not-allowed opacity-50",
          )}
        >
          {props.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Save
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="text-muted hover:text-foreground flex items-center gap-1 rounded px-3 py-1.5 text-xs"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Status View (connected)
// ---------------------------------------------------------------------------

interface StatusViewProps {
  config: SyncConfig;
  status: SyncStatus;
  onPush: () => void;
  onPull: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}

function StatusView(props: StatusViewProps) {
  const { status } = props;
  const isBusy = status.state === "syncing";

  // Confirm before pull (restore overwrites local files)
  const [confirmPull, setConfirmPull] = useState(false);

  const handlePull = () => {
    if (!confirmPull) {
      setConfirmPull(true);
      return;
    }
    setConfirmPull(false);
    props.onPull();
  };

  // Confirm before disconnect
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const handleDisconnect = () => {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setConfirmDisconnect(false);
    props.onDisconnect();
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Status row */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            status.state === "idle" && "bg-muted",
            status.state === "syncing" && "bg-accent animate-pulse",
            status.state === "success" && "bg-green-500",
            status.state === "error" && "bg-destructive",
          )}
        />
        <span className="text-foreground text-xs font-medium capitalize">
          {status.state === "syncing" && status.operation
            ? `${status.operation === "push" ? "Pushing" : "Pulling"}...`
            : status.state}
        </span>
        {status.lastSyncAt && (
          <span className="text-muted text-[10px]">{formatRelativeTime(status.lastSyncAt)}</span>
        )}
      </div>

      {/* Last sync details */}
      {(status.lastSyncCommit ?? status.fileCount != null) && (
        <div className="text-muted flex items-center gap-3 text-[10px]">
          {status.lastSyncCommit && <span>Commit: {shortCommit(status.lastSyncCommit)}</span>}
          {status.fileCount != null && <span>{status.fileCount} files</span>}
        </div>
      )}

      {/* Error message */}
      {status.lastError && (
        <div className="border-destructive/30 bg-destructive/5 rounded border p-2">
          <span className="text-destructive text-[10px] break-all">{status.lastError}</span>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={props.onPush}
          className={cn(
            "bg-accent text-accent-foreground flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium",
            isBusy && "cursor-not-allowed opacity-50",
          )}
        >
          {isBusy && status.operation === "push" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          Sync Now
        </button>

        <button
          type="button"
          disabled={isBusy}
          onClick={handlePull}
          className={cn(
            "flex items-center gap-1 rounded border px-3 py-1.5 text-xs font-medium",
            confirmPull
              ? "border-destructive text-destructive"
              : "border-border text-foreground hover:bg-muted/20",
            isBusy && "cursor-not-allowed opacity-50",
          )}
        >
          {isBusy && status.operation === "pull" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {confirmPull ? "Confirm Restore?" : "Restore from Backup"}
        </button>
      </div>

      {/* Repo info + controls */}
      <div className="border-border flex flex-col gap-2 border-t pt-2">
        <div className="text-muted flex items-center gap-1 text-[10px]">
          <Cloud className="h-3 w-3 shrink-0" />
          <span className="truncate">{props.config.repoUrl}</span>
        </div>

        <div className="text-muted flex items-center gap-1 text-[10px]">
          <RefreshCw className="h-3 w-3 shrink-0" />
          <span>Auto-sync: {props.config.autoSync ? "on" : "off"}</span>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={props.onEdit}
            className="text-muted hover:text-foreground flex items-center gap-1 text-xs"
          >
            <Settings className="h-3 w-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            className={cn(
              "flex items-center gap-1 text-xs",
              confirmDisconnect ? "text-destructive" : "text-muted hover:text-foreground",
            )}
          >
            <CloudOff className="h-3 w-3" />
            {confirmDisconnect ? "Confirm Disconnect?" : "Disconnect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main SyncTab
// ---------------------------------------------------------------------------

interface SyncTabProps {
  minionId: string;
}

export function SyncTab(_props: SyncTabProps) {
  const { api } = useAPI();
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ state: "idle" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Fetch initial config and status
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void Promise.all([api.sync.getConfig(), api.sync.getStatus()]).then(([cfg, sts]) => {
      if (cancelled) return;
      setConfig(cfg ?? null);
      setStatus(sts);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  // Subscribe to status updates
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    const run = async () => {
      try {
        const iterable = await api.sync.subscribe();
        for await (const update of iterable) {
          if (cancelled) break;
          setStatus(update);
        }
      } catch {
        // Subscription ended (e.g. backend disconnect) — non-fatal
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleSave = (next: SyncConfig) => {
    if (!api) return;
    setSaving(true);

    void api.sync
      .saveConfig(next)
      .then(() => {
        setConfig(next);
        setEditing(false);
      })
      .catch((err: unknown) => {
        console.error("[SyncTab] Failed to save config:", err);
      })
      .finally(() => setSaving(false));
  };

  const handlePush = () => {
    if (!api) return;
    void api.sync.push().then(setStatus);
  };

  const handlePull = () => {
    if (!api) return;
    void api.sync.pull().then(setStatus);
  };

  const handleDisconnect = () => {
    if (!api) return;
    void api.sync.disconnect().then(() => {
      setConfig(null);
      setStatus({ state: "idle" });
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-6">
        <Loader2 className="text-muted h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Setup form — both new config and editing existing
  if (editing) {
    return (
      <SetupForm
        initial={config}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
        saving={saving}
      />
    );
  }

  // Connected view
  if (config) {
    return (
      <StatusView
        config={config}
        status={status}
        onPush={handlePush}
        onPull={handlePull}
        onEdit={() => setEditing(true)}
        onDisconnect={handleDisconnect}
      />
    );
  }

  // Unconfigured — setup prompt
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <Cloud className="text-muted h-8 w-8" />
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-sm font-medium">GitHub Config Backup</span>
        <span className="text-muted text-xs">
          Back up your configs and chat history to a private GitHub repo.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="bg-accent text-accent-foreground rounded px-4 py-1.5 text-xs font-medium"
      >
        Set Up Sync
      </button>
    </div>
  );
}
