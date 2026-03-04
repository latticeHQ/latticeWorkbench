import React, { useCallback, useEffect, useState } from "react";
import { FolderOpen, Home, Loader2, Plus } from "lucide-react";
import { useAPI } from "@/browser/contexts/API";
import { Button } from "@/browser/components/ui/button";

interface BookmarkEntry {
  path: string;
  isHome: boolean;
  createdAt: string;
}

interface SandboxInfo {
  isSandboxed: boolean;
  hasHomeAccess: boolean;
  entries: BookmarkEntry[];
}

export const FilesystemAccessSection: React.FC = () => {
  const { api } = useAPI();
  const [info, setInfo] = useState<SandboxInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInfo = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.sandbox.getInfo();
      setInfo(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sandbox info");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const handleGrantHomeAccess = useCallback(async () => {
    if (!api) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await api.sandbox.requestHomeAccess();
      if (result) {
        await loadInfo();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant home access");
    } finally {
      setActionLoading(false);
    }
  }, [api, loadInfo]);

  const handleAddDirectory = useCallback(async () => {
    if (!api) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await api.sandbox.requestDirectoryAccess();
      if (result) {
        await loadInfo();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add directory");
    } finally {
      setActionLoading(false);
    }
  }, [api, loadInfo]);

  if (loading) {
    return (
      <div className="text-muted flex items-center gap-2 py-4 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </div>
    );
  }

  if (!info || !info.isSandboxed) {
    return (
      <div className="text-muted py-2 text-sm">
        This section is only available in Mac App Store builds. Your installation has full
        filesystem access.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted text-xs">
          Lattice runs in Apple's App Sandbox. Grant access to directories so Lattice can
          reach your projects, tools, and dotfiles.
        </p>
        <p className="text-muted mt-1 text-xs">
          Granting access to your home directory (<code className="text-accent">~</code>)
          unlocks everything underneath it.
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {!info.hasHomeAccess && (
        <div className="border-accent/30 bg-accent/5 rounded-md border px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-foreground text-sm font-medium">Home directory access</div>
              <div className="text-muted mt-0.5 text-xs">
                Grant access to your home directory for full functionality (terminals, git,
                MCP servers, dotfiles).
              </div>
            </div>
            <Button
              onClick={() => void handleGrantHomeAccess()}
              disabled={actionLoading}
              size="sm"
            >
              {actionLoading ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Home className="mr-1.5 h-3.5 w-3.5" />
              )}
              Grant Access
            </Button>
          </div>
        </div>
      )}

      <div>
        <div className="text-foreground mb-2 text-sm font-medium">Bookmarked directories</div>
        {info.entries.length === 0 ? (
          <div className="text-muted border-border-medium rounded-md border border-dashed px-3 py-3 text-center text-xs">
            No directories bookmarked yet
          </div>
        ) : (
          <div className="border-border-medium divide-border-medium divide-y rounded-md border">
            {info.entries.map((entry) => (
              <div key={entry.path} className="flex items-center gap-3 px-3 py-2">
                <FolderOpen className="text-muted h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-foreground truncate font-mono text-xs">
                    {entry.path}
                  </div>
                  <div className="text-dim text-[11px]">
                    Added {new Date(entry.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {entry.isHome && (
                  <span className="bg-accent/10 text-accent rounded px-1.5 py-0.5 text-[10px] font-medium">
                    HOME
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Button
        variant="outline"
        onClick={() => void handleAddDirectory()}
        disabled={actionLoading}
        className="w-full"
      >
        {actionLoading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="mr-1.5 h-3.5 w-3.5" />
        )}
        Add Directory
      </Button>
    </div>
  );
};
