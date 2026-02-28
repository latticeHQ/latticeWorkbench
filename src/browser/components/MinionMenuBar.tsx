import React, { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, GitBranch, Link2, Menu, Pencil, Server, Settings, X } from "lucide-react";
import { ArchiveIcon } from "./icons/ArchiveIcon";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { CUSTOM_EVENTS } from "@/common/constants/events";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { cn } from "@/common/lib/utils";
import { getErrorMessage } from "@/common/utils/errors";

import {
  WORKBENCH_PANEL_COLLAPSED_KEY,
  getNotifyOnResponseKey,
  getNotifyOnResponseAutoEnableKey,
} from "@/common/constants/storage";
import { GitStatusIndicator } from "./GitStatusIndicator";
import { RuntimeBadge } from "./RuntimeBadge";
import { BranchSelector } from "./BranchSelector";
import { MinionMCPModal } from "./MinionMCPModal";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Checkbox } from "./ui/checkbox";
import { formatKeybind, KEYBINDS, matchesKeybind } from "@/browser/utils/ui/keybinds";
import { useGitStatus } from "@/browser/stores/GitStatusStore";
import { useMinionSidebarState } from "@/browser/stores/MinionStore";
import { Button } from "@/browser/components/ui/button";
import type { RuntimeConfig } from "@/common/types/runtime";
import { useLinkSharingEnabled } from "@/browser/contexts/TelemetryEnabledContext";
import { useTutorial } from "@/browser/contexts/TutorialContext";

import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { usePopoverError } from "@/browser/hooks/usePopoverError";
import { useOpenInEditor } from "@/browser/hooks/useOpenInEditor";
import { isDesktopMode, DESKTOP_TITLEBAR_HEIGHT_CLASS } from "@/browser/hooks/useDesktopTitlebar";
import { DebugLlmRequestModal } from "./DebugLlmRequestModal";
import { MinionLinks } from "./MinionLinks";
import { ShareTranscriptDialog } from "./ShareTranscriptDialog";
import { ConfirmationModal } from "./ConfirmationModal";
import { PopoverError } from "./PopoverError";

import { SkillIndicator } from "./SkillIndicator";
import { useAPI } from "@/browser/contexts/API";
import { useAgent } from "@/browser/contexts/AgentContext";

import { useMinionActions } from "@/browser/contexts/MinionContext";
import { forkMinion } from "@/browser/utils/chatCommands";
import type { AgentSkillDescriptor, AgentSkillIssue } from "@/common/types/agentSkill";

interface MinionMenuBarProps {
  minionId: string;
  projectName: string;
  projectPath: string;
  minionName: string;
  minionTitle?: string;
  namedMinionPath: string;
  runtimeConfig?: RuntimeConfig;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
}

export const MinionMenuBar: React.FC<MinionMenuBarProps> = ({
  minionId,
  projectName,
  projectPath,
  minionName,
  minionTitle,
  namedMinionPath,
  runtimeConfig,
  leftSidebarCollapsed,
  onToggleLeftSidebarCollapsed,
}) => {
  const isLatticeHelpChat = minionId === LATTICE_HELP_CHAT_MINION_ID;
  const linkSharingEnabled = useLinkSharingEnabled();
  const gitStatus = useGitStatus(minionId);
  const { canInterrupt, isStarting, awaitingUserQuestion } = useMinionSidebarState(minionId);
  const isWorking = (canInterrupt || isStarting) && !awaitingUserQuestion;
  const { startSequence: startTutorial } = useTutorial();
  const [debugLlmRequestOpen, setDebugLlmRequestOpen] = useState(false);
  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [shareTranscriptOpen, setShareTranscriptOpen] = useState(false);

  const [workbenchPanelCollapsed] = usePersistedState<boolean>(WORKBENCH_PANEL_COLLAPSED_KEY, false, {
    listener: true,
  });

  // Notification toggle keybind (minion-level)
  const [, setNotifyOnResponse] = usePersistedState<boolean>(
    getNotifyOnResponseKey(minionId),
    false
  );

  // Start minion tutorial on first entry
  useEffect(() => {
    const timer = setTimeout(() => {
      startTutorial("minion");
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

  // Keybind for opening MCP configuration
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (matchesKeybind(e, KEYBINDS.CONFIGURE_MCP)) {
        e.preventDefault();
        setMcpModalOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Keybind for sharing transcript
  useEffect(() => {
    if (isLatticeHelpChat || linkSharingEnabled !== true) return;

    const handler = (e: KeyboardEvent) => {
      if (matchesKeybind(e, KEYBINDS.SHARE_TRANSCRIPT)) {
        e.preventDefault();
        setShareTranscriptOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isLatticeHelpChat, linkSharingEnabled]);

  // On Windows/Linux, the native window controls overlay the top-right of the app.
  // When the workbench panel is collapsed (20px), this header stretches underneath
  // those controls and the MCP/editor/terminal buttons become unclickable.
  const isDesktop = isDesktopMode();

  return (
    <div
      data-testid="minion-menu-bar"
      className={cn(
        "bg-sidebar border-border-light flex items-center justify-between border-b px-2",
        isDesktop ? DESKTOP_TITLEBAR_HEIGHT_CLASS : "h-8",
        workbenchPanelCollapsed && "titlebar-safe-right-minus-sidebar titlebar-safe-right-gutter-2",
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleLeftSidebarCollapsed}
                aria-label="Open sidebar menu"
                className="mobile-menu-btn text-muted hover:text-foreground hidden h-6 w-6 shrink-0"
              >
                <Menu className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open sidebar ({formatKeybind(KEYBINDS.TOGGLE_SIDEBAR)})</TooltipContent>
          </Tooltip>
        )}
        <RuntimeBadge
          runtimeConfig={runtimeConfig}
          isWorking={isWorking}
          minionPath={namedMinionPath}
          minionName={minionName}
          tooltipSide="bottom"
        />
        <span className="min-w-0 truncate font-mono text-xs">{projectName}</span>
        <div className="flex items-center gap-1">
          <BranchSelector minionId={minionId} minionName={minionName} />
          <GitStatusIndicator
            gitStatus={gitStatus}
            minionId={minionId}
            projectPath={projectPath}
            tooltipPosition="bottom"
            isWorking={isWorking}
          />
        </div>
      </div>
      {/* Icon actions moved to MinionIconStrip (vertical right edge) */}
      <div className={cn("flex items-center gap-2", isDesktop && "titlebar-no-drag")}>
        <MinionLinks minionId={minionId} />
      </div>
      <MinionMCPModal
        minionId={minionId}
        projectPath={projectPath}
        open={mcpModalOpen}
        onOpenChange={setMcpModalOpen}
      />
      <DebugLlmRequestModal
        minionId={minionId}
        open={debugLlmRequestOpen}
        onOpenChange={setDebugLlmRequestOpen}
      />
      {linkSharingEnabled === true && !isLatticeHelpChat && (
        <ShareTranscriptDialog
          minionId={minionId}
          minionName={minionName}
          minionTitle={minionTitle}
          open={shareTranscriptOpen}
          onOpenChange={setShareTranscriptOpen}
        />
      )}
    </div>
  );
};

/**
 * Vertical icon strip rendered on the right edge of the chat pane.
 * Contains minion action buttons that were previously in the horizontal menu bar.
 */
export const MinionIconStrip: React.FC<{
  minionId: string;
  projectPath: string;
  minionName: string;
  minionTitle: string;
  namedMinionPath: string;
}> = (props) => {
  const { api } = useAPI();
  const linkSharingEnabled = useLinkSharingEnabled();
  const isLatticeHelpChat = props.minionId === LATTICE_HELP_CHAT_MINION_ID;
  const sidebarState = useMinionSidebarState(props.minionId);
  const isWorking =
    (sidebarState.canInterrupt || sidebarState.isStarting) && !sidebarState.awaitingUserQuestion;
  const { isOpen: isSettingsOpen, open: openSettings, close: closeSettings } = useSettings();
  const { disableMinionAgents } = useAgent();
  const [availableSkills, setAvailableSkills] = useState<AgentSkillDescriptor[]>([]);
  const [invalidSkills, setInvalidSkills] = useState<AgentSkillIssue[]>([]);
  const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);

  const openInEditor = useOpenInEditor();

  // Fetch available skills for the SkillIndicator
  useEffect(() => {
    if (!api) {
      setAvailableSkills([]);
      setInvalidSkills([]);
      return;
    }

    let isMounted = true;
    const load = async () => {
      try {
        const diagnostics = await api.agentSkills.listDiagnostics({
          minionId: props.minionId,
          disableMinionAgents: disableMinionAgents || undefined,
        });
        if (!isMounted) return;
        setAvailableSkills(Array.isArray(diagnostics.skills) ? diagnostics.skills : []);
        setInvalidSkills(Array.isArray(diagnostics.invalidSkills) ? diagnostics.invalidSkills : []);
      } catch {
        if (isMounted) {
          setAvailableSkills([]);
          setInvalidSkills([]);
        }
      }
    };
    void load();
    return () => {
      isMounted = false;
    };
  }, [api, props.minionId, disableMinionAgents]);

  const [mcpModalOpen, setMcpModalOpen] = useState(false);
  const [shareTranscriptOpen, setShareTranscriptOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [notifyOnResponse, setNotifyOnResponse] = usePersistedState<boolean>(
    getNotifyOnResponseKey(props.minionId),
    false,
    { listener: true }
  );
  const [autoEnableNotifications, setAutoEnableNotifications] = usePersistedState<boolean>(
    getNotifyOnResponseAutoEnableKey(props.namedMinionPath),
    false,
    { listener: true }
  );

  const archiveError = usePopoverError();
  const forkError = usePopoverError();

  const { archiveMinion } = useMinionActions();

  const handleArchiveChat = useCallback(
    async (anchorEl?: HTMLElement) => {
      if (isArchiving) return;
      setIsArchiving(true);
      try {
        const res = await archiveMinion(props.minionId);
        if (!res.success) {
          const rect = anchorEl?.getBoundingClientRect();
          archiveError.showError(
            props.minionId,
            res.error ?? "Failed to archive chat",
            rect ? { top: rect.top + window.scrollY, left: rect.right + 10 } : undefined
          );
        }
      } finally {
        setIsArchiving(false);
      }
    },
    [isArchiving, archiveMinion, props.minionId, archiveError]
  );

  const handleForkChat = useCallback(
    async (anchorEl?: HTMLElement) => {
      if (!api) {
        const rect = anchorEl?.getBoundingClientRect();
        forkError.showError(
          props.minionId,
          "Not connected to server",
          rect ? { top: rect.top + window.scrollY, left: rect.right + 10 } : undefined
        );
        return;
      }
      const rect = anchorEl?.getBoundingClientRect();
      const anchor = rect ? { top: rect.top + window.scrollY, left: rect.right + 10 } : undefined;
      try {
        const result = await forkMinion({
          client: api,
          sourceMinionId: props.minionId,
        });
        if (!result.success) {
          forkError.showError(props.minionId, result.error ?? "Failed to fork chat", anchor);
        }
      } catch (error) {
        forkError.showError(props.minionId, getErrorMessage(error), anchor);
      }
    },
    [api, props.minionId, forkError]
  );

  const handleOpenInEditor = useCallback(async () => {
    await openInEditor(props.minionId, props.namedMinionPath);
  }, [openInEditor, props.minionId, props.namedMinionPath]);

  const btnClass =
    "text-muted hover:text-foreground hover:bg-hover flex h-7 w-7 shrink-0 items-center justify-center rounded";

  return (
    <>
      <div className="bg-sidebar border-border-light flex flex-col items-center gap-1 border-l px-1 py-2">
        {/* Notification toggle with settings popover */}
        <Popover open={notificationPopoverOpen} onOpenChange={setNotificationPopoverOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={() => setNotifyOnResponse((prev) => !prev)}
                  className={cn(btnClass, notifyOnResponse && "text-foreground")}
                  data-testid="notify-on-response-button"
                  aria-pressed={notifyOnResponse}
                >
                  {notifyOnResponse ? (
                    <Bell className="h-3.5 w-3.5" />
                  ) : (
                    <BellOff className="h-3.5 w-3.5" />
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            {!notificationPopoverOpen && (
              <TooltipContent side="left">
                {notifyOnResponse ? "Notifications on" : "Notifications off"} (
                {formatKeybind(KEYBINDS.TOGGLE_NOTIFICATIONS)})
              </TooltipContent>
            )}
          </Tooltip>
          <PopoverContent
            side="left"
            align="start"
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
                  Auto-enable for new minions in this project
                </span>
              </label>
            </div>
          </PopoverContent>
        </Popover>

        {/* Skills indicator */}
        <SkillIndicator
          loadedSkills={sidebarState.loadedSkills}
          availableSkills={availableSkills}
          invalidSkills={invalidSkills}
          skillLoadErrors={sidebarState.skillLoadErrors}
        />

        {/* Open in editor */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => void handleOpenInEditor()} className={btnClass}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Open in editor ({formatKeybind(KEYBINDS.OPEN_IN_EDITOR)})
          </TooltipContent>
        </Tooltip>

        {/* Configure MCP */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={btnClass}
              aria-label="Configure MCP servers"
              data-testid="minion-mcp-button"
              onClick={() => setMcpModalOpen(true)}
            >
              <Server className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Configure MCP servers ({formatKeybind(KEYBINDS.CONFIGURE_MCP)})
          </TooltipContent>
        </Tooltip>

        {/* Fork chat */}
        {!isLatticeHelpChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={btnClass}
                aria-label="Fork chat"
                onClick={(e) => {
                  void handleForkChat(e.currentTarget);
                }}
              >
                <GitBranch className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Fork chat</TooltipContent>
          </Tooltip>
        )}

        {/* Share transcript */}
        {linkSharingEnabled === true && !isLatticeHelpChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={btnClass}
                aria-label="Share transcript"
                onClick={() => setShareTranscriptOpen(true)}
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Share transcript ({formatKeybind(KEYBINDS.SHARE_TRANSCRIPT)})
            </TooltipContent>
          </Tooltip>
        )}

        {/* Archive chat */}
        {!isLatticeHelpChat && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={btnClass}
                aria-label="Archive chat"
                onClick={(e) => {
                  if (isWorking) {
                    setArchiveConfirmOpen(true);
                  } else {
                    void handleArchiveChat(e.currentTarget);
                  }
                }}
              >
                <ArchiveIcon className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Archive chat ({formatKeybind(KEYBINDS.ARCHIVE_MINION)})
            </TooltipContent>
          </Tooltip>
        )}

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={btnClass}
              aria-label={isSettingsOpen ? "Close settings" : "Open settings"}
              data-testid="settings-button"
              onClick={() => {
                if (isSettingsOpen) {
                  closeSettings();
                } else {
                  openSettings();
                }
              }}
            >
              {isSettingsOpen ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <Settings className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {isSettingsOpen
              ? "Close settings"
              : `Open settings (${formatKeybind(KEYBINDS.OPEN_SETTINGS)})`}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Modals/dialogs scoped to the icon strip */}
      <MinionMCPModal
        minionId={props.minionId}
        projectPath={props.projectPath}
        open={mcpModalOpen}
        onOpenChange={setMcpModalOpen}
      />
      {linkSharingEnabled === true && !isLatticeHelpChat && (
        <ShareTranscriptDialog
          minionId={props.minionId}
          minionName={props.minionName}
          minionTitle={props.minionTitle}
          open={shareTranscriptOpen}
          onOpenChange={setShareTranscriptOpen}
        />
      )}
      <ConfirmationModal
        isOpen={archiveConfirmOpen}
        title={
          props.minionTitle
            ? `Archive "${props.minionTitle}" while streaming?`
            : "Archive chat?"
        }
        description="This minion is currently streaming a response."
        warning="Archiving will interrupt the active stream."
        confirmLabel="Archive"
        onConfirm={() => {
          setArchiveConfirmOpen(false);
          void handleArchiveChat();
        }}
        onCancel={() => setArchiveConfirmOpen(false)}
      />
      <PopoverError
        error={forkError.error}
        prefix="Failed to fork chat"
        onDismiss={forkError.clearError}
      />
      <PopoverError
        error={archiveError.error}
        prefix="Failed to archive chat"
        onDismiss={archiveError.clearError}
      />
    </>
  );
};
