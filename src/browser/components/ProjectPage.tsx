import React, { useRef, useCallback, useState, useEffect } from "react";
import { Menu, Settings, Terminal, Network, Plus, Server } from "lucide-react";
import type { FrontendWorkspaceMetadata } from "@/common/types/workspace";
import { cn } from "@/common/lib/utils";
import { AgentProvider } from "@/browser/contexts/AgentContext";
import { ProviderOptionsProvider } from "@/browser/contexts/ProviderOptionsContext";
import { ThinkingProvider } from "@/browser/contexts/ThinkingContext";
import { ChatInput } from "./ChatInput/index";
import type { ChatInputAPI } from "./ChatInput/types";
import { ProjectMCPOverview } from "./ProjectMCPOverview";
import { ArchivedWorkspaces } from "./ArchivedWorkspaces";
import { useAPI } from "@/browser/contexts/API";
import { isWorkspaceArchived } from "@/common/utils/archive";
import { GitInitBanner } from "./GitInitBanner";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { CliAgentWithIcon } from "./CliAgentIcon";
import { AgentsInitBanner } from "./AgentsInitBanner";
import { usePersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  getAgentIdKey,
  getAgentsInitNudgeKey,
  getInputKey,
  getPendingScopeId,
  getProjectScopeId,
} from "@/common/constants/storage";
import { Button } from "@/browser/components/ui/button";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { ProjectHQOverview } from "./ProjectHQOverview";
import { ArchiveIcon } from "./icons/ArchiveIcon";

type ProjectTab = "pipeline" | "workspace" | "mcp" | "archived";

interface ProjectPageProps {
  projectPath: string;
  projectName: string;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  /** Section ID to pre-select when creating (from sidebar section "+" button) */
  pendingSectionId?: string | null;
  onProviderConfig: (provider: string, keyPath: string[], value: string) => Promise<void>;
  onWorkspaceCreated: (metadata: FrontendWorkspaceMetadata) => void;
}

/** Compare archived workspace lists by ID set (order doesn't matter for equality) */
function archivedListsEqual(
  prev: FrontendWorkspaceMetadata[],
  next: FrontendWorkspaceMetadata[]
): boolean {
  if (prev.length !== next.length) return false;
  const prevIds = new Set(prev.map((w) => w.id));
  return next.every((w) => prevIds.has(w.id));
}

/**
 * Headquarter page shown when a project is selected but no workspace is active.
 * Tab-based layout: Agent Net | New Mission | MCP | Archived
 */
export const ProjectPage: React.FC<ProjectPageProps> = ({
  projectPath,
  projectName,
  leftSidebarCollapsed,
  onToggleLeftSidebarCollapsed,
  pendingSectionId,
  onProviderConfig,
  onWorkspaceCreated,
}) => {
  const { api } = useAPI();
  const settings = useSettings();
  const chatInputRef = useRef<ChatInputAPI | null>(null);
  const pendingAgentsInitSendRef = useRef(false);
  const [archivedWorkspaces, setArchivedWorkspaces] = useState<FrontendWorkspaceMetadata[]>([]);
  const [showAgentsInitNudge, setShowAgentsInitNudge] = usePersistedState<boolean>(
    getAgentsInitNudgeKey(projectPath),
    false,
    { listener: true }
  );
  const { detectedAgents, loading: agentsLoading } = useCliAgentDetection();
  const hasAgents = detectedAgents.length > 0;
  const shouldShowAgentsInitBanner = !agentsLoading && hasAgents && showAgentsInitNudge;

  // Active tab — persisted per project
  const [activeTab, setActiveTab] = usePersistedState<ProjectTab>(
    `projectTab:${projectPath}`,
    "pipeline"
  );

  // Git repository state for the banner
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [hasBranches, setHasBranches] = useState(true);
  const [branchRefreshKey, setBranchRefreshKey] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await api.projects.listBranches({ projectPath });
        if (cancelled) return;
        setHasBranches(result.branches.length > 0);
      } catch (err) {
        console.error("Failed to load branches:", err);
        if (cancelled) return;
        setHasBranches(true);
      } finally {
        if (!cancelled) {
          setBranchesLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, projectPath, branchRefreshKey]);

  const isNonGitRepo = branchesLoaded && !hasBranches;

  const handleGitInitSuccess = useCallback(() => {
    setBranchRefreshKey((k) => k + 1);
  }, []);

  // Track archived workspaces
  const archivedMapRef = useRef<Map<string, FrontendWorkspaceMetadata>>(new Map());

  const syncArchivedState = useCallback(() => {
    const next = Array.from(archivedMapRef.current.values());
    setArchivedWorkspaces((prev) => (archivedListsEqual(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    const loadArchived = async () => {
      try {
        const allArchived = await api.workspace.list({ archived: true });
        if (cancelled) return;
        const projectArchived = allArchived.filter((w) => w.projectPath === projectPath);
        archivedMapRef.current = new Map(projectArchived.map((w) => [w.id, w]));
        syncArchivedState();
      } catch (error) {
        console.error("Failed to load archived workspaces:", error);
      }
    };

    void loadArchived();
    return () => {
      cancelled = true;
    };
  }, [api, projectPath, syncArchivedState]);

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();

    (async () => {
      try {
        const iterator = await api.workspace.onMetadata(undefined, { signal: controller.signal });
        for await (const event of iterator) {
          if (controller.signal.aborted) break;

          const meta = event.metadata;
          if (meta && meta.projectPath !== projectPath) continue;
          if (!meta && !archivedMapRef.current.has(event.workspaceId)) continue;

          const isArchived = meta && isWorkspaceArchived(meta.archivedAt, meta.unarchivedAt);

          if (isArchived) {
            archivedMapRef.current.set(meta.id, meta);
          } else {
            archivedMapRef.current.delete(event.workspaceId);
          }

          syncArchivedState();
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error("Failed to subscribe to metadata for archived workspaces:", err);
        }
      }
    })();

    return () => controller.abort();
  }, [api, projectPath, syncArchivedState]);

  const didAutoFocusRef = useRef(false);

  const handleDismissAgentsInit = useCallback(() => {
    setShowAgentsInitNudge(false);
  }, [setShowAgentsInitNudge]);

  const handleRunAgentsInit = useCallback(() => {
    updatePersistedState(getAgentIdKey(getProjectScopeId(projectPath)), "exec");

    if (chatInputRef.current) {
      chatInputRef.current.restoreText("/init");
      requestAnimationFrame(() => {
        void chatInputRef.current?.send();
      });
    } else {
      pendingAgentsInitSendRef.current = true;
      const pendingScopeId = getPendingScopeId(projectPath);
      updatePersistedState(getInputKey(pendingScopeId), "/init");
    }

    setShowAgentsInitNudge(false);
  }, [projectPath, setShowAgentsInitNudge]);

  const handleChatReady = useCallback((api: ChatInputAPI) => {
    chatInputRef.current = api;

    if (pendingAgentsInitSendRef.current) {
      pendingAgentsInitSendRef.current = false;
      didAutoFocusRef.current = true;
      api.restoreText("/init");
      requestAnimationFrame(() => {
        void api.send();
      });
      return;
    }

    if (didAutoFocusRef.current) {
      return;
    }
    didAutoFocusRef.current = true;
    api.focus();
  }, []);

  const refreshArchived = useCallback(() => {
    if (!api) return;
    void api.workspace.list({ archived: true }).then((all) => {
      setArchivedWorkspaces(all.filter((w) => w.projectPath === projectPath));
    });
  }, [api, projectPath]);

  // Tab definitions
  const tabs: Array<{
    id: ProjectTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: "pipeline",
      label: "Agent Net",
      icon: <Network size={13} />,
    },
    {
      id: "workspace",
      label: "New Mission",
      icon: <Plus size={13} />,
    },
    {
      id: "mcp",
      label: "MCP",
      icon: <Server size={13} />,
    },
    {
      id: "archived",
      label: "Archived",
      icon: <ArchiveIcon className="h-3 w-3" />,
      badge: archivedWorkspaces.length > 0 ? archivedWorkspaces.length : undefined,
    },
  ];

  return (
    <AgentProvider projectPath={projectPath}>
      <ProviderOptionsProvider>
        <ThinkingProvider projectPath={projectPath}>
          <div className="bg-dark flex flex-1 flex-col overflow-hidden">
            {/* ── Title bar ── */}
            <div
              className={cn(
                "bg-sidebar border-border-light mobile-sticky-header flex shrink-0 items-center border-b px-2 [@media(max-width:768px)]:h-auto [@media(max-width:768px)]:py-2",
                isDesktopMode() ? "h-10 titlebar-drag" : "h-8"
              )}
            >
              {leftSidebarCollapsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleLeftSidebarCollapsed}
                  title="Open sidebar"
                  aria-label="Open sidebar menu"
                  className={cn(
                    "hidden mobile-menu-btn h-6 w-6 shrink-0 text-muted hover:text-foreground",
                    isDesktopMode() && "titlebar-no-drag"
                  )}
                >
                  <Menu className="h-4 w-4" />
                </Button>
              )}
            </div>

            {/* ── Tab strip ── */}
            <div className="bg-sidebar border-border-light flex shrink-0 items-center gap-0.5 border-b px-3">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
                    activeTab === tab.id
                      ? "text-foreground"
                      : "text-muted hover:text-foreground/70"
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span className="text-muted bg-white/8 rounded px-1 py-0.5 text-[10px] tabular-nums">
                      {tab.badge}
                    </span>
                  )}
                  {/* Active indicator */}
                  {activeTab === tab.id && (
                    <span className="bg-accent absolute right-2 bottom-0 left-2 h-[2px] rounded-t-sm" />
                  )}
                </button>
              ))}

              {/* Settings gear — right-aligned */}
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => settings.openProjectSettings(projectPath)}
                  title="Project settings"
                  aria-label="Open project settings"
                  className="text-muted hover:text-foreground flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-white/8"
                >
                  <Settings size={13} />
                </button>
              </div>
            </div>

            {/* ── Tab content ── */}
            <div className="min-h-0 flex-1 overflow-y-auto">

              {/* ── Agent Net ── */}
              {activeTab === "pipeline" && (
                <div className="w-full px-4 py-4">
                  <ProjectHQOverview
                    projectPath={projectPath}
                    projectName={projectName}
                  />
                </div>
              )}

              {/* ── New Mission ── */}
              {activeTab === "workspace" && (
                <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-6">
                  <div className="flex w-full max-w-2xl flex-col gap-4">
                    {isNonGitRepo && (
                      <GitInitBanner projectPath={projectPath} onSuccess={handleGitInitSuccess} />
                    )}
                    {!agentsLoading && !hasAgents ? (
                      <div
                        className="border-border bg-card/50 flex flex-col items-center justify-center gap-4 rounded-lg border p-8 text-center"
                        data-testid="configure-agents-prompt"
                      >
                        <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-full">
                          <Terminal className="text-primary h-6 w-6" />
                        </div>
                        <div className="space-y-2">
                          <h2 className="text-foreground text-lg font-semibold">
                            No Providers Detected
                          </h2>
                          <p className="text-muted-foreground max-w-sm text-sm">
                            Install at least one provider (like Claude Code, Codex, or Gemini) to
                            start a workspace.
                          </p>
                        </div>
                        <Button onClick={() => settings.open("providers")} className="gap-2">
                          <Settings className="h-4 w-4" />
                          Install Providers
                        </Button>
                      </div>
                    ) : (
                      <>
                        {shouldShowAgentsInitBanner && (
                          <AgentsInitBanner
                            onRunInit={handleRunAgentsInit}
                            onDismiss={handleDismissAgentsInit}
                          />
                        )}
                        {hasAgents && (
                          <div className="text-muted-foreground flex items-center justify-center gap-2 py-1 text-sm">
                            <span className="inline-flex items-center gap-1.5 rounded border border-border/50 px-2 py-1 text-sm">
                              {detectedAgents.slice(0, 5).map((agent) => (
                                <CliAgentWithIcon
                                  key={agent.slug}
                                  slug={agent.slug}
                                  displayName=""
                                  iconClassName="h-3.5 w-3.5"
                                />
                              ))}
                              {detectedAgents.length > 5 && (
                                <span className="text-muted text-xs">
                                  +{detectedAgents.length - 5}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() => settings.open("providers")}
                              className="text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                            >
                              <Settings className="h-3 w-3" />
                              <span>Agents</span>
                            </button>
                          </div>
                        )}
                        <ChatInput
                          variant="creation"
                          projectPath={projectPath}
                          projectName={projectName}
                          pendingSectionId={pendingSectionId}
                          onProviderConfig={onProviderConfig}
                          onReady={handleChatReady}
                          onWorkspaceCreated={onWorkspaceCreated}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── MCP ── */}
              {activeTab === "mcp" && (
                <div className="mx-auto w-full max-w-2xl px-4 py-6">
                  <ProjectMCPOverview projectPath={projectPath} />
                </div>
              )}

              {/* ── Archived ── */}
              {activeTab === "archived" && (
                <div className="mx-auto w-full max-w-2xl px-4 py-6">
                  {archivedWorkspaces.length > 0 ? (
                    <ArchivedWorkspaces
                      projectPath={projectPath}
                      projectName={projectName}
                      workspaces={archivedWorkspaces}
                      onWorkspacesChanged={refreshArchived}
                    />
                  ) : (
                    <div className="text-muted flex flex-col items-center gap-2 py-16 text-center text-sm">
                      <ArchiveIcon className="h-8 w-8 opacity-30" />
                      <p>No archived workspaces yet.</p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </ThinkingProvider>
      </ProviderOptionsProvider>
    </AgentProvider>
  );
};
