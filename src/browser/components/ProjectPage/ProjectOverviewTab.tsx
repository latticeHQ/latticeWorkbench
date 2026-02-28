import React, { useRef, useCallback, useState, useEffect } from "react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { ChatInput } from "../ChatInput/index";
import type { ChatInputAPI, MinionCreatedOptions } from "../ChatInput/types";
import { useAPI } from "@/browser/contexts/API";
import { GitInitBanner } from "../GitInitBanner";
import { ConfiguredProvidersBar } from "../ConfiguredProvidersBar";
import { ConfigureProvidersPrompt } from "../ConfigureProvidersPrompt";
import { useProvidersConfig } from "@/browser/hooks/useProvidersConfig";
import type { ProvidersConfigMap } from "@/common/orpc/types";
import { AgentsInitBanner } from "../AgentsInitBanner";
import {
  usePersistedState,
  updatePersistedState,
} from "@/browser/hooks/usePersistedState";
import {
  getAgentIdKey,
  getAgentsInitNudgeKey,
  getDraftScopeId,
  getInputKey,
  getPendingScopeId,
  getProjectScopeId,
} from "@/common/constants/storage";
import { Skeleton } from "@/browser/components/ui/skeleton";

interface ProjectOverviewTabProps {
  projectPath: string;
  projectName: string;
  pendingDraftId?: string | null;
  pendingSectionId?: string | null;
  onMinionCreated: (
    metadata: FrontendMinionMetadata,
    options?: MinionCreatedOptions
  ) => void;
}

/** Check if any provider is configured (uses backend-computed isConfigured) */
function hasConfiguredProvider(config: ProvidersConfigMap | null): boolean {
  if (!config) return false;
  return Object.values(config).some((provider) => provider?.isConfigured);
}

/**
 * Overview tab content — extracted from the original ProjectPage.
 * Minion creation form, providers, MCP servers, and archived minions.
 */
export const ProjectOverviewTab: React.FC<ProjectOverviewTabProps> = (props) => {
  const { api } = useAPI();
  const chatInputRef = useRef<ChatInputAPI | null>(null);
  const pendingAgentsInitSendRef = useRef(false);
  const [showAgentsInitNudge, setShowAgentsInitNudge] = usePersistedState<boolean>(
    getAgentsInitNudgeKey(props.projectPath),
    false,
    { listener: true }
  );
  const { config: providersConfig, loading: providersLoading } = useProvidersConfig();
  const hasProviders = hasConfiguredProvider(providersConfig);
  const shouldShowAgentsInitBanner = !providersLoading && hasProviders && showAgentsInitNudge;

  // Git repository state for the banner
  const [branchesLoaded, setBranchesLoaded] = useState(false);
  const [hasBranches, setHasBranches] = useState(true);
  const [branchRefreshKey, setBranchRefreshKey] = useState(0);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await api.projects.listBranches({ projectPath: props.projectPath });
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
  }, [api, props.projectPath, branchRefreshKey]);

  const isNonGitRepo = branchesLoaded && !hasBranches;

  const handleGitInitSuccess = useCallback(() => {
    setBranchRefreshKey((k) => k + 1);
  }, []);

  const didAutoFocusRef = useRef(false);

  const handleDismissAgentsInit = useCallback(() => {
    setShowAgentsInitNudge(false);
  }, [setShowAgentsInitNudge]);

  const handleRunAgentsInit = useCallback(() => {
    updatePersistedState(getAgentIdKey(getProjectScopeId(props.projectPath)), "exec");

    if (chatInputRef.current) {
      chatInputRef.current.restoreText("/init");
      requestAnimationFrame(() => {
        void chatInputRef.current?.send();
      });
    } else {
      pendingAgentsInitSendRef.current = true;
      const pendingScopeId =
        typeof props.pendingDraftId === "string" && props.pendingDraftId.trim().length > 0
          ? getDraftScopeId(props.projectPath, props.pendingDraftId)
          : getPendingScopeId(props.projectPath);
      updatePersistedState(getInputKey(pendingScopeId), "/init");
    }

    setShowAgentsInitNudge(false);
  }, [props.projectPath, props.pendingDraftId, setShowAgentsInitNudge]);

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

  return (
    <div className="flex flex-col px-4 py-4">
      {/* Banners + creation form — fills sidebar width */}
      <div className="flex w-full flex-col gap-3">
          {isNonGitRepo && (
            <GitInitBanner projectPath={props.projectPath} onSuccess={handleGitInitSuccess} />
          )}
          {!providersLoading && !hasProviders ? (
            <ConfigureProvidersPrompt />
          ) : (
            <>
              {shouldShowAgentsInitBanner && (
                <AgentsInitBanner
                  onRunInit={handleRunAgentsInit}
                  onDismiss={handleDismissAgentsInit}
                />
              )}
              {providersLoading ? (
                <div className="flex items-center justify-center gap-2 py-1.5">
                  <Skeleton className="h-7 w-32" />
                </div>
              ) : (
                hasProviders &&
                providersConfig && (
                  <ConfiguredProvidersBar providersConfig={providersConfig} />
                )
              )}
              <ChatInput
                key={props.pendingDraftId ?? "__pending__"}
                variant="creation"
                projectPath={props.projectPath}
                projectName={props.projectName}
                pendingSectionId={props.pendingSectionId}
                pendingDraftId={props.pendingDraftId}
                onReady={handleChatReady}
                onMinionCreated={props.onMinionCreated}
              />
            </>
          )}
      </div>
    </div>
  );
};
