import React from "react";
import { Menu, Settings, Network, Plus } from "lucide-react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import { cn } from "@/common/lib/utils";
import { AgentProvider } from "@/browser/contexts/AgentContext";
import { ThinkingProvider } from "@/browser/contexts/ThinkingContext";
import type { MinionCreatedOptions } from "../ChatInput/types";
import { Button } from "@/browser/components/ui/button";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { ProjectOverviewTab } from "./ProjectOverviewTab";
import { ProjectHQOverview } from "../ProjectHQOverview";

/** Tab IDs — MCP + Archived live in Settings */
type ProjectTab = "pipeline" | "minion";

interface ProjectPageProps {
  projectPath: string;
  projectName: string;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  /** Draft ID for UI-only minion creation drafts (from URL) */
  pendingDraftId?: string | null;
  /** Crew ID to pre-select when creating (from sidebar crew "+" button) */
  pendingSectionId?: string | null;
  onMinionCreated: (
    metadata: FrontendMinionMetadata,
    options?: MinionCreatedOptions
  ) => void;
}

/**
 * Headquarter page shown when a project is selected but no minion is active.
 * Tab-based layout: Agent Net | New Mission
 * MCP + Archived are accessible from Settings.
 */
export const ProjectPage: React.FC<ProjectPageProps> = (props) => {
  const settings = useSettings();

  // Active tab — persisted per project
  const [activeTab, setActiveTab] = usePersistedState<ProjectTab>(
    `projectTab:${props.projectPath}`,
    "pipeline"
  );

  // Tab definitions — MCP + Archived live in Settings
  const tabs: Array<{
    id: ProjectTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "pipeline",
      label: "Overview - Agents",
      icon: <Network size={13} />,
    },
    {
      id: "minion",
      label: "New Mission",
      icon: <Plus size={13} />,
    },
  ];

  return (
    <AgentProvider projectPath={props.projectPath}>
      <ThinkingProvider projectPath={props.projectPath}>
        <div className="bg-dark flex flex-1 flex-col overflow-hidden">
          {/* ── Title bar ── */}
          <div
            className={cn(
              "bg-sidebar border-border-light mobile-sticky-header flex shrink-0 items-center border-b px-2 [@media(max-width:768px)]:h-auto [@media(max-width:768px)]:py-2",
              isDesktopMode() ? "h-10 titlebar-drag" : "h-8"
            )}
          >
            {props.leftSidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                onClick={props.onToggleLeftSidebarCollapsed}
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

          {/* ── Tab strip — tabs centered, settings gear pinned right ── */}
          <div className="bg-sidebar border-border-light relative flex shrink-0 items-center justify-center gap-1 border-b px-3 py-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-background-secondary text-foreground"
                    : "text-muted hover:text-foreground/70 hover:bg-white/5"
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}

            {/* Settings — absolutely positioned so it doesn't shift tab centering */}
            <button
              type="button"
              onClick={() => settings.open()}
              title="Project settings"
              aria-label="Open project settings"
              className={cn(
                "absolute right-3 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "text-muted hover:text-foreground/70 hover:bg-white/5"
              )}
            >
              <Settings size={13} />
              Settings
            </button>
          </div>

          {/* ── Tab content ── */}
          <div className="min-h-0 flex-1 overflow-y-auto">

            {/* ── Agent Net ── */}
            {activeTab === "pipeline" && (
              <div className="w-full px-4 py-4">
                <ProjectHQOverview
                  projectPath={props.projectPath}
                  projectName={props.projectName}
                />
              </div>
            )}

            {/* ── New Mission ── */}
            {activeTab === "minion" && (
              <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-6">
                <div className="flex w-full max-w-2xl flex-col gap-4">
                  <ProjectOverviewTab
                    projectPath={props.projectPath}
                    projectName={props.projectName}
                    pendingDraftId={props.pendingDraftId}
                    pendingSectionId={props.pendingSectionId}
                    onMinionCreated={props.onMinionCreated}
                  />
                </div>
              </div>
            )}

          </div>
        </div>
      </ThinkingProvider>
    </AgentProvider>
  );
};
