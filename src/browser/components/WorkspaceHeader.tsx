import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, BellOff, Menu, Pencil, Plus, Server } from "lucide-react";
import { CUSTOM_EVENTS } from "@/common/constants/events";
import { cn } from "@/common/lib/utils";

import {
  RIGHT_SIDEBAR_COLLAPSED_KEY,
  getNotifyOnResponseKey,
  getNotifyOnResponseAutoEnableKey,
} from "@/common/constants/storage";
import { GitStatusIndicator } from "./GitStatusIndicator";
import { RuntimeBadge } from "./RuntimeBadge";
import { BranchSelector } from "./BranchSelector";
import { WorkspaceMCPModal } from "./WorkspaceMCPModal";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { formatKeybind, KEYBINDS, matchesKeybind } from "@/browser/utils/ui/keybinds";
import { useGitStatus } from "@/browser/stores/GitStatusStore";
import { useWorkspaceSidebarState } from "@/browser/stores/WorkspaceStore";
import { Button } from "@/browser/components/ui/button";
import type { RuntimeConfig } from "@/common/types/runtime";
import { useTutorial } from "@/browser/contexts/TutorialContext";
import { useOpenInEditor } from "@/browser/hooks/useOpenInEditor";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import {
  getTitlebarRightInset,
  isDesktopMode,
  DESKTOP_TITLEBAR_HEIGHT_CLASS,
} from "@/browser/hooks/useDesktopTitlebar";
import { DebugLlmRequestModal } from "./DebugLlmRequestModal";
import { WorkspaceLinks } from "./WorkspaceLinks";
import { SkillIndicator } from "./SkillIndicator";
import { useAPI } from "@/browser/contexts/API";
import type { AgentSkillDescriptor } from "@/common/types/agentSkill";
import { AgentPicker } from "./MainArea/AgentPicker";
import type { EmployeeSlug } from "./MainArea/AgentPicker";

interface WorkspaceHeaderProps {
  workspaceId: string;
  projectName: string;
  projectPath: string;
  workspaceName: string;
  namedWorkspacePath: string;
  runtimeConfig?: RuntimeConfig;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  /** Callback to hire (spawn) a new employee agent */
  onHireEmployee: (slug: EmployeeSlug) => void;
  /** Set of detected/installed agent slugs */
  detectedSlugs?: Set<string>;
  /** True while agent detection scan is running */
  detectingAgents?: boolean;
  /** Callback to re-scan for installed agents */
  onRefreshAgents?: () => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  workspaceId,
  projectName,
  projectPath,
  workspaceName,
  namedWorkspacePath,
  runtimeConfig,
  leftSidebarCollapsed,
  onToggleLeftSidebarCollapsed,
  onHireEmployee,
  detectedSlugs,
  detectingAgents,
  onRefreshAgents,
}) => {
  const { api } = useAPI();
  const openInEditor = useOpenInEditor();
  const gitStatus = useGitStatus(workspaceId);
  const { canInterrupt, isStarting, awaitingUserQuestion, loadedSkills } =
    useWorkspaceSidebarState(workspaceId);
  const isWorking = (canInterrupt || isStarting) && !awaitingUserQuestion;
  const { startSequence: startTutorial } = useTutorial();
  const [editorError, setEditorError] = useState<string | null>(null);
  const [debugLlmRequestOpen, setDebugLlmRequestOpen] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [availableSkills, setAvailableSkills] = useState<AgentSkillDescriptor[]>([]);

  const [rightSidebarCollapsed] = usePersistedState<boolean>(RIGHT_SIDEBAR_COLLAPSED_KEY, false, {
    // This state is toggled from RightSidebar, so we need cross-component updates.
    listener: true,
  });

  // Notification on response toggle (workspace-level) - defaults to disabled
  const [notifyOnResponse, setNotifyOnResponse] = usePersistedState<boolean>(
    getNotifyOnResponseKey(workspaceId),
    false
  );

  // Auto-enable notifications for new workspaces (project-level)
  const [autoEnableNotifications, setAutoEnableNotifications] = usePersistedState<boolean>(
    getNotifyOnResponseAutoEnableKey(projectPath),
    false
  );

  // Popover state for notification settings (interactive on click)
  const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);

  const handleOpenInEditor = useCallback(async () => {
    setEditorError(null);
    const result = await openInEditor(workspaceId, namedWorkspacePath, runtimeConfig);
    if (!result.success && result.error) {
      setEditorError(result.error);
      // Clear error after 3 seconds
      setTimeout(() => setEditorError(null), 3000);
    }
  }, [workspaceId, namedWorkspacePath, openInEditor, runtimeConfig]);

  // Start workspace tutorial on first entry
  useEffect(() => {
    // Small delay to ensure UI is rendered
    const timer = setTimeout(() => {
      startTutorial("workspace");
    }, 300);
    return () => clearTimeout(timer);
  }, [startTutorial]);

  // Listen for /debug-llm-request command to open modal
  useEffect(() => {
    const handler = () => setDebugLlmRequestOpen(true);
    window.addEventListener(CUSTOM_EVENTS.OPEN_DEBUG_LLM_REQUEST, handler);
    return () => window.removeEventListener(CUSTOM_EVENTS.OPEN_DEBUG_LLM_REQUEST, handler);
  }, []);

  // Keybind for toggling notifications
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesKeybind(e, KEYBINDS.TOGGLE_NOTIFICATIONS)) {
        e.preventDefault();
        setNotifyOnResponse((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setNotifyOnResponse]);

  // Fetch available skills for this project
  useEffect(() => {
    if (!api) {
      setAvailableSkills([]);
      return;
    }

    let isMounted = true;

    const loadSkills = async () => {
      try {
        const skills = await api.agentSkills.list({ projectPath });
        if (isMounted && Array.isArray(skills)) {
          setAvailableSkills(skills);
        }
      } catch (error) {
        console.error("Failed to load available skills:", error);
        if (isMounted) {
          setAvailableSkills([]);
        }
      }
    };

    void loadSkills();

    return () => {
      isMounted = false;
    };
  }, [api, projectPath]);

  // On Windows/Linux, the native window controls overlay the top-right of the app.
  // When the right sidebar is collapsed (20px), this header stretches underneath
  // those controls and the MCP/editor buttons become unclickable.
  const titlebarRightInset = getTitlebarRightInset();
  const headerRightPadding =
    rightSidebarCollapsed && titlebarRightInset > 0 ? Math.max(0, titlebarRightInset - 20) : 0;
  const isDesktop = isDesktopMode();

  return (
    <div
      style={headerRightPadding > 0 ? { paddingRight: headerRightPadding } : undefined}
      data-testid="workspace-header"
      className={cn(
        "bg-background-secondary border-border-light flex items-center justify-between border-b px-2",
        isDesktop ? DESKTOP_TITLEBAR_HEIGHT_CLASS : "h-10",
        // In desktop mode, make header draggable for window movement
        isDesktop && "titlebar-drag",
        // Keep header visible when iOS keyboard opens and causes scroll
        "mobile-sticky-header"
      )}
    >
      <div
        className={cn(
          "text-foreground flex min-w-0 items-center gap-2.5 overflow-hidden font-semibold",
          isDesktop && "titlebar-no-drag"
        )}
      >
        {leftSidebarCollapsed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleLeftSidebarCollapsed}
            title="Open sidebar"
            aria-label="Open sidebar menu"
            className="mobile-menu-btn text-muted hover:text-foreground hidden h-6 w-6 shrink-0"
          >
            <Menu className="h-3.5 w-3.5" />
          </Button>
        )}
        <RuntimeBadge
          runtimeConfig={runtimeConfig}
          isWorking={isWorking}
          workspacePath={namedWorkspacePath}
          workspaceName={workspaceName}
          tooltipSide="bottom"
        />
        <span className="min-w-0 truncate font-mono text-xs">{projectName}</span>
        <div className="flex items-center gap-1">
          <BranchSelector workspaceId={workspaceId} workspaceName={workspaceName} />
          <GitStatusIndicator
            gitStatus={gitStatus}
            workspaceId={workspaceId}
            projectPath={projectPath}
            tooltipPosition="bottom"
            isWorking={isWorking}
          />
        </div>
      </div>
      <div className={cn("flex items-center gap-2", isDesktop && "titlebar-no-drag")}>
        <WorkspaceLinks workspaceId={workspaceId} />

        <Popover open={notificationPopoverOpen} onOpenChange={setNotificationPopoverOpen}>
          <Tooltip {...(notificationPopoverOpen ? { open: false } : {})}>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setNotifyOnResponse((prev) => !prev)}
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-none",
                    notifyOnResponse
                      ? "text-foreground"
                      : "text-muted hover:bg-hover hover:text-foreground"
                  )}
                  data-testid="notify-on-response-button"
                  aria-pressed={notifyOnResponse}
                >
                  {notifyOnResponse ? (
                    <Bell className="h-4 w-4" />
                  ) : (
                    <BellOff className="h-4 w-4" />
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={notifyOnResponse}
                    onCheckedChange={(checked) => setNotifyOnResponse(checked === true)}
                  />
                  <span className="text-foreground">
                    Notify on all responses{" "}
                    <span className="text-muted-foreground">
                      ({formatKeybind(KEYBINDS.TOGGLE_NOTIFICATIONS)})
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    checked={autoEnableNotifications}
                    onCheckedChange={(checked) => setAutoEnableNotifications(checked === true)}
                  />
                  <span className="text-muted-foreground">
                    Auto-enable for new workspaces in this project
                  </span>
                </label>
                <p className="text-muted-foreground border-separator-light border-t pt-2">
                  Agents can also notify on specific events.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>

          <PopoverContent
            side="bottom"
            align="end"
            className="bg-modal-bg border-separator-light w-64 overflow-visible rounded px-[10px] py-[6px] text-[11px] font-normal shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
          >
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={notifyOnResponse}
                  onCheckedChange={(checked) => setNotifyOnResponse(checked === true)}
                />
                <span className="text-foreground">
                  Notify on all responses{" "}
                  <span className="text-muted-foreground">
                    ({formatKeybind(KEYBINDS.TOGGLE_NOTIFICATIONS)})
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  checked={autoEnableNotifications}
                  onCheckedChange={(checked) => setAutoEnableNotifications(checked === true)}
                />
                <span className="text-muted-foreground">
                  Auto-enable for new workspaces in this project
                </span>
              </label>
              <p className="text-muted-foreground border-separator-light border-t pt-2">
                Agents can also notify on specific events.
              </p>
            </div>
          </PopoverContent>
        </Popover>
        <SkillIndicator loadedSkills={loadedSkills} availableSkills={availableSkills} />
        {editorError && <span className="text-danger-soft text-xs">{editorError}</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMcpModalOpen(true)}
              className="text-muted hover:text-foreground h-10 w-10 shrink-0 rounded-none [&_svg]:h-4 [&_svg]:w-4"
              data-testid="workspace-mcp-button"
            >
              <Server className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center">
            Configure MCP servers for this workspace
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleOpenInEditor()}
              className="text-muted hover:text-foreground h-10 w-10 shrink-0 rounded-none [&_svg]:h-4 [&_svg]:w-4"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="center">
            Open in editor ({formatKeybind(KEYBINDS.OPEN_IN_EDITOR)})
          </TooltipContent>
        </Tooltip>

        {/* Hire employee (+) button — far right */}
        <div className="relative">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={addButtonRef}
                onClick={() => setPickerOpen((v) => !v)}
                className={cn(
                  "text-muted hover:text-foreground hover:bg-hover flex h-10 w-10 shrink-0 items-center justify-center rounded-none border-none bg-transparent transition-colors",
                  pickerOpen && "bg-hover text-foreground"
                )}
                aria-label="Hire employee"
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              Hire employee
            </TooltipContent>
          </Tooltip>

          {pickerOpen && (
            <HeaderAgentPickerPopover
              buttonRef={addButtonRef}
              detectedSlugs={detectedSlugs}
              detectingAgents={detectingAgents}
              onRefreshAgents={onRefreshAgents}
              onHireEmployee={onHireEmployee}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
      <WorkspaceMCPModal
        workspaceId={workspaceId}
        projectPath={projectPath}
        open={mcpModalOpen}
        onOpenChange={setMcpModalOpen}
      />
      <DebugLlmRequestModal
        workspaceId={workspaceId}
        open={debugLlmRequestOpen}
        onOpenChange={setDebugLlmRequestOpen}
      />
    </div>
  );
};

/**
 * Portalled popover for AgentPicker in the workspace header.
 * Rendered into document.body so it's never clipped by parent overflow/transforms.
 */
function HeaderAgentPickerPopover({
  buttonRef,
  detectedSlugs,
  detectingAgents,
  onRefreshAgents,
  onHireEmployee,
  onClose,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  detectedSlugs?: Set<string>;
  detectingAgents?: boolean;
  onRefreshAgents?: () => void;
  onHireEmployee: (slug: EmployeeSlug) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, [buttonRef]);

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Picker panel */}
      <div
        ref={panelRef}
        className="fixed z-50 flex flex-col overflow-hidden"
        style={
          pos
            ? { top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top + 8}px)` }
            : { top: 0, right: 0, visibility: "hidden" }
        }
      >
        <AgentPicker
          detectedSlugs={detectedSlugs}
          loading={detectingAgents}
          onRefresh={onRefreshAgents}
          onSelect={onHireEmployee}
          onClose={onClose}
        />
      </div>
    </>,
    document.body
  );
}
