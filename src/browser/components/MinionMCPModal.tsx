import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Server, Loader2, Globe, FolderOpen, ChevronRight } from "lucide-react";
import { Button } from "@/browser/components/ui/button";
import { Switch } from "@/browser/components/ui/switch";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useAPI } from "@/browser/contexts/API";
import { cn } from "@/common/lib/utils";
import type { MCPServerInfo, MinionMCPOverrides } from "@/common/types/mcp";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/browser/components/ui/dialog";
import { useMCPTestCache } from "@/browser/hooks/useMCPTestCache";
import { ToolSelector } from "@/browser/components/ToolSelector";

type ServerSource = "global" | "project" | "built-in";

interface MinionMCPModalProps {
  minionId: string;
  projectPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const MinionMCPModal: React.FC<MinionMCPModalProps> = ({
  minionId,
  projectPath,
  open,
  onOpenChange,
}) => {
  const settings = useSettings();
  const { api } = useAPI();

  // State for project servers and minion overrides
  const [servers, setServers] = useState<Record<string, MCPServerInfo>>({});
  const [globalServerNames, setGlobalServerNames] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<MinionMCPOverrides>({});
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use shared cache for tool test results
  const { getTools, setResult, reload: reloadCache } = useMCPTestCache(projectPath);

  // Ref so the effect can call reloadCache without depending on its identity.
  const reloadCacheRef = useRef(reloadCache);
  reloadCacheRef.current = reloadCache;

  // Load project servers and minion overrides when modal opens
  useEffect(() => {
    if (!open || !api) return;

    // Reload cache when modal opens
    reloadCacheRef.current();

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [mergedServers, globalServers, minionOverrides] = await Promise.all([
          api.mcp.list({ projectPath }),
          api.mcp.list({}),
          api.minion.mcp.get({ minionId }),
        ]);
        setServers(mergedServers ?? {});
        setGlobalServerNames(new Set(Object.keys(globalServers ?? {})));
        setOverrides(minionOverrides ?? {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load MCP configuration");
      } finally {
        setLoading(false);
      }
    };

    void loadData();
  }, [open, api, projectPath, minionId]);

  /** Determine source/scope of a server */
  const getServerSource = useCallback(
    (name: string, info: MCPServerInfo): ServerSource => {
      if (info.builtin) return "built-in";
      if (!globalServerNames.has(name)) return "project";
      return "global";
    },
    [globalServerNames]
  );

  /** Group servers by source for organized display */
  const groupedServers = useMemo(() => {
    const groups: Record<ServerSource, [string, MCPServerInfo][]> = {
      "built-in": [],
      global: [],
      project: [],
    };
    for (const [name, info] of Object.entries(servers)) {
      const source = getServerSource(name, info);
      groups[source].push([name, info]);
    }
    // Sort alphabetically within each group
    for (const group of Object.values(groups)) {
      group.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return groups;
  }, [servers, getServerSource]);

  // Fetch/refresh tools for a server
  const fetchTools = useCallback(
    async (serverName: string) => {
      if (!api) return;
      setLoadingTools((prev) => ({ ...prev, [serverName]: true }));
      try {
        const result = await api.mcp.test({ projectPath, name: serverName });
        setResult(serverName, result);
        if (!result.success) {
          setError(`Failed to fetch tools for ${serverName}: ${result.error}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to fetch tools for ${serverName}`);
      } finally {
        setLoadingTools((prev) => ({ ...prev, [serverName]: false }));
      }
    },
    [api, projectPath, setResult]
  );

  /**
   * Determine if a server is effectively enabled for this minion.
   */
  const isServerEnabled = useCallback(
    (serverName: string, projectDisabled: boolean): boolean => {
      if (overrides.enabledServers?.includes(serverName)) return true;
      if (overrides.disabledServers?.includes(serverName)) return false;
      return !projectDisabled;
    },
    [overrides.enabledServers, overrides.disabledServers]
  );

  // Toggle server enabled/disabled for minion
  const toggleServerEnabled = useCallback(
    (serverName: string, enabled: boolean, projectDisabled: boolean) => {
      setOverrides((prev) => {
        const currentEnabled = prev.enabledServers ?? [];
        const currentDisabled = prev.disabledServers ?? [];

        let newEnabled: string[];
        let newDisabled: string[];

        if (enabled) {
          newDisabled = currentDisabled.filter((s) => s !== serverName);
          if (projectDisabled) {
            newEnabled = [...currentEnabled, serverName];
          } else {
            newEnabled = currentEnabled.filter((s) => s !== serverName);
          }
        } else {
          newEnabled = currentEnabled.filter((s) => s !== serverName);
          if (projectDisabled) {
            newDisabled = currentDisabled.filter((s) => s !== serverName);
          } else {
            newDisabled = [...currentDisabled, serverName];
          }
        }

        return {
          ...prev,
          enabledServers: newEnabled.length > 0 ? newEnabled : undefined,
          disabledServers: newDisabled.length > 0 ? newDisabled : undefined,
        };
      });
    },
    []
  );

  // Check if all tools are allowed (no allowlist set)
  const hasNoAllowlist = useCallback(
    (serverName: string): boolean => {
      return !overrides.toolAllowlist?.[serverName];
    },
    [overrides.toolAllowlist]
  );

  // Toggle tool in allowlist
  const toggleToolAllowed = useCallback(
    (serverName: string, toolName: string, allowed: boolean) => {
      const allTools = getTools(serverName) ?? [];
      setOverrides((prev) => {
        const currentAllowlist = prev.toolAllowlist ?? {};
        const serverAllowlist = currentAllowlist[serverName];

        let newServerAllowlist: string[];
        if (allowed) {
          if (!serverAllowlist) {
            return prev;
          }
          newServerAllowlist = [...serverAllowlist, toolName];
        } else {
          if (!serverAllowlist) {
            newServerAllowlist = allTools.filter((t) => t !== toolName);
          } else {
            newServerAllowlist = serverAllowlist.filter((t) => t !== toolName);
          }
        }

        const newAllowlist = { ...currentAllowlist };
        if (newServerAllowlist.length === allTools.length) {
          delete newAllowlist[serverName];
        } else {
          newAllowlist[serverName] = newServerAllowlist;
        }

        return {
          ...prev,
          toolAllowlist: Object.keys(newAllowlist).length > 0 ? newAllowlist : undefined,
        };
      });
    },
    [getTools]
  );

  const setAllToolsAllowed = useCallback((serverName: string) => {
    setOverrides((prev) => {
      const newAllowlist = { ...prev.toolAllowlist };
      delete newAllowlist[serverName];
      return {
        ...prev,
        toolAllowlist: Object.keys(newAllowlist).length > 0 ? newAllowlist : undefined,
      };
    });
  }, []);

  const setNoToolsAllowed = useCallback((serverName: string) => {
    setOverrides((prev) => {
      return {
        ...prev,
        toolAllowlist: {
          ...prev.toolAllowlist,
          [serverName]: [],
        },
      };
    });
  }, []);

  // Save overrides
  const handleSave = useCallback(async () => {
    if (!api) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.minion.mcp.set({ minionId, overrides });
      if (!result.success) {
        setError(result.error);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [api, minionId, overrides, onOpenChange]);

  const handleOpenProjectSettings = useCallback(() => {
    onOpenChange(false);
    settings.open("mcp");
  }, [onOpenChange, settings]);

  const hasServers = Object.keys(servers).length > 0;

  const sourceConfig: Record<
    ServerSource,
    { label: string; icon: React.ReactNode; badgeClass: string }
  > = {
    "built-in": {
      label: "Built-in",
      icon: <Server className="h-3 w-3" />,
      badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    global: {
      label: "Global",
      icon: <Globe className="h-3 w-3" />,
      badgeClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    project: {
      label: "Project",
      icon: <FolderOpen className="h-3 w-3" />,
      badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
  };

  /** Render a single server row */
  const renderServerRow = (name: string, info: MCPServerInfo) => {
    const projectDisabled = info.disabled;
    const effectivelyEnabled = isServerEnabled(name, projectDisabled);
    const tools = getTools(name);
    const isLoadingTools = loadingTools[name];
    const allowedTools = overrides.toolAllowlist?.[name] ?? tools ?? [];
    const source = getServerSource(name, info);
    const { badgeClass } = sourceConfig[source];

    return (
      <div
        key={name}
        className={cn(
          "border-border rounded-lg border p-4",
          !effectivelyEnabled && "opacity-50"
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Switch
              checked={effectivelyEnabled}
              onCheckedChange={(checked) =>
                toggleServerEnabled(name, checked, projectDisabled)
              }
              aria-label={`Toggle ${name} MCP server`}
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{name}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    info.transport === "stdio"
                      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                  )}
                >
                  {info.transport}
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", badgeClass)}>
                  {source}
                </span>
                {tools && effectivelyEnabled && !expandedTools[name] && (
                  <span className="text-muted text-xs">
                    {allowedTools.length}/{tools.length} tools
                  </span>
                )}
              </div>
              {projectDisabled && (
                <div className="text-muted text-xs">(disabled at project level)</div>
              )}
              <div className="text-muted mt-0.5 font-mono text-[11px] break-all">
                {info.transport === "stdio" ? info.command : info.url}
              </div>
            </div>
          </div>
          {effectivelyEnabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchTools(name)}
              disabled={isLoadingTools}
            >
              {isLoadingTools ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : tools ? (
                "Refresh Tools"
              ) : (
                "Fetch Tools"
              )}
            </Button>
          )}
        </div>

        {/* Collapsible tool allowlist section */}
        {effectivelyEnabled && tools && tools.length > 0 && (
          <div className="mt-3 border-t pt-3">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() =>
                setExpandedTools((prev) => ({ ...prev, [name]: !prev[name] }))
              }
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expandedTools[name] && "rotate-90"
                )}
              />
              <span className="font-medium">
                Tools ({allowedTools.length}/{tools.length})
              </span>
              {!hasNoAllowlist(name) && (
                <span className="text-amber-700 dark:text-amber-400 ml-1">
                  filtered
                </span>
              )}
            </button>
            {expandedTools[name] && (
              <div className="mt-2 pl-5">
                <ToolSelector
                  availableTools={tools}
                  allowedTools={allowedTools}
                  onToggle={(tool, allowed) => toggleToolAllowed(name, tool, allowed)}
                  onSelectAll={() => setAllToolsAllowed(name)}
                  onSelectNone={() => setNoToolsAllowed(name)}
                />
              </div>
            )}
          </div>
        )}

        {effectivelyEnabled && tools?.length === 0 && (
          <div className="text-muted mt-2 text-sm">No tools available</div>
        )}
      </div>
    );
  };

  /** Render a group of servers with a section header */
  const renderGroup = (
    source: ServerSource,
    entries: [string, MCPServerInfo][]
  ) => {
    if (entries.length === 0) return null;
    const { label, icon, badgeClass } = sourceConfig[source];

    return (
      <div key={source}>
        <div className="mb-2 flex items-center gap-2">
          <span className={cn("flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium", badgeClass)}>
            {icon}
            {label}
          </span>
          <span className="text-muted text-xs">{entries.length} server{entries.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="space-y-2">
          {entries.map(([name, info]) => renderServerRow(name, info))}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Minion MCP Configuration
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted h-6 w-6 animate-spin" />
          </div>
        ) : !hasServers ? (
          <div className="text-muted py-8 text-center">
            <p>No MCP servers configured for this project.</p>
            <p className="mt-2 text-sm">
              Configure servers in{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 align-baseline"
                onClick={handleOpenProjectSettings}
              >
                Settings → MCP
              </Button>{" "}
              to use them here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-muted flex-1 pr-3 text-sm">
                Customize which MCP servers and tools are available in this minion. Changes only
                affect this minion.
              </p>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleSave()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>

            {error && (
              <div className="bg-danger-soft/10 text-danger-soft rounded-md p-3 text-sm">
                {error}
              </div>
            )}

            {/* Summary bar */}
            <div className="border-border bg-background-secondary flex items-center gap-4 rounded-md border px-3 py-2 text-xs">
              <span className="text-muted">
                {Object.keys(servers).length} servers total
              </span>
              {groupedServers["built-in"].length > 0 && (
                <span className="text-blue-600 dark:text-blue-400">
                  {groupedServers["built-in"].length} built-in
                </span>
              )}
              {groupedServers.global.length > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {groupedServers.global.length} global
                </span>
              )}
              {groupedServers.project.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {groupedServers.project.length} project
                </span>
              )}
            </div>

            <div className="space-y-6">
              {renderGroup("built-in", groupedServers["built-in"])}
              {renderGroup("global", groupedServers.global)}
              {renderGroup("project", groupedServers.project)}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
