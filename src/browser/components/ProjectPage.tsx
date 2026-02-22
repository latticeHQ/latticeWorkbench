import React, { useRef, useCallback, useState, useEffect } from "react";
import { Menu, Settings, Terminal, Plus } from "lucide-react";
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
 * Combines workspace creation with archived workspaces view.
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

  // Git repository state for the banner
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [hasBranches, setHasBranches] = useState(true); // Assume git repo until proven otherwise
  const [branchRefreshKey, setBranchRefreshKey] = useState(0);

  // Load branches to determine if this is a git repository.
  // Uses local cancelled flag (not ref) to handle StrictMode double-renders correctly.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    (async () => {
      // Don't reset branchesLoaded - it starts false, becomes true after first load.
      // This keeps banner mounted during refetch so success message stays visible.
      try {
        const result = await api.projects.listBranches({ projectPath });
        if (cancelled) return;
        setHasBranches(result.branches.length > 0);
      } catch (err) {
        console.error("Failed to load branches:", err);
        if (cancelled) return;
        setHasBranches(true); // On error, don't show banner
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

  // Trigger branch refetch after git init to verify it worked
  const handleGitInitSuccess = useCallback(() => {
    setBranchRefreshKey((k) => k + 1);
  }, []);

  // Track archived workspaces in a ref; only update state when the list actually changes
  const archivedMapRef = useRef<Map<string, FrontendWorkspaceMetadata>>(new Map());

  const syncArchivedState = useCallback(() => {
    const next = Array.from(archivedMapRef.current.values());
    setArchivedWorkspaces((prev) => (archivedListsEqual(prev, next) ? prev : next));
  }, []);

  // Fetch archived workspaces for this project on mount
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

  // Subscribe to metadata events to reactively update archived list
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();

    (async () => {
      try {
        const iterator = await api.workspace.onMetadata(undefined, { signal: controller.signal });
        for await (const event of iterator) {
          if (controller.signal.aborted) break;

          const meta = event.metadata;
          // Only care about workspaces in this project
          if (meta && meta.projectPath !== projectPath) continue;
          // For deletions, check if it was in our map (i.e., was in this project)
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
    // Switch project-scope mode to exec.
    updatePersistedState(getAgentIdKey(getProjectScopeId(projectPath)), "exec");

    // Run the /init skill and start the creation chat.
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

    // Auto-focus the prompt once when entering the creation screen.
    // Defensive: avoid re-focusing on unrelated re-renders (e.g. workspace list updates),
    // which can move the user's caret.
    if (didAutoFocusRef.current) {
      return;
    }
    didAutoFocusRef.current = true;
    api.focus();
  }, []);

  return (
    <AgentProvider projectPath={projectPath}>
      <ProviderOptionsProvider>
        <ThinkingProvider projectPath={projectPath}>
          {/* Flex container to fill parent space */}
          <div className="bg-dark flex flex-1 flex-col overflow-hidden">
            {/* Draggable header bar - matches WorkspaceHeader for consistency */}
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
            {/* Scrollable content area */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-5xl px-4 py-6 flex flex-col gap-6">

                {/* ── HQ Hierarchy (primary view) ── */}
                <ProjectHQOverview
                  projectPath={projectPath}
                  projectName={projectName}
                />

                {/* ── Git init banner ── */}
                {isNonGitRepo && (
                  <GitInitBanner projectPath={projectPath} onSuccess={handleGitInitSuccess} />
                )}

                {/* ── New Mission creation panel ── */}
                <div className="flex flex-col gap-3">
                  {/* Section divider with label */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 border-t border-border/40" />
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted uppercase tracking-widest">
                      <Plus className="h-3 w-3" />
                      New Mission
                    </span>
                    <div className="flex-1 border-t border-border/40" />
                  </div>

                  {/* Show agent setup prompt when no agents detected, otherwise show ChatInput */}
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
                      {/* Detected agents bar */}
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
                      {/* ChatInput for workspace creation */}
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

                {/* ── MCP overview ── */}
                <ProjectMCPOverview projectPath={projectPath} />

                {/* ── Archived workspaces ── */}
                {archivedWorkspaces.length > 0 && (
                  <ArchivedWorkspaces
                    projectPath={projectPath}
                    projectName={projectName}
                    workspaces={archivedWorkspaces}
                    onWorkspacesChanged={() => {
                      if (!api) return;
                      void api.workspace.list({ archived: true }).then((all) => {
                        setArchivedWorkspaces(all.filter((w) => w.projectPath === projectPath));
                      });
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </ThinkingProvider>
      </ProviderOptionsProvider>
    </AgentProvider>
  );
};
