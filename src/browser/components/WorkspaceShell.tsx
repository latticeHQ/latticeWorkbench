import type { TerminalSessionCreateOptions } from "@/browser/utils/terminal";
import React, { useCallback, useEffect, useRef } from "react";
import { cn } from "@/common/lib/utils";
import { RIGHT_SIDEBAR_WIDTH_KEY } from "@/common/constants/storage";
import { useResizableSidebar } from "@/browser/hooks/useResizableSidebar";
import { RightSidebar } from "./RightSidebar";
import { PopoverError } from "./PopoverError";
import type { RuntimeConfig } from "@/common/types/runtime";
import { useBackgroundBashError } from "@/browser/contexts/BackgroundBashContext";
import { useWorkspaceState } from "@/browser/stores/WorkspaceStore";
import { useWorkspaceContext } from "@/browser/contexts/WorkspaceContext";
import { useReviews } from "@/browser/hooks/useReviews";
import type { ReviewNoteData } from "@/common/types/review";
import { ConnectionStatusToast } from "./ConnectionStatusToast";
import { FileOpenerProvider } from "@/browser/contexts/FileOpenerContext";
import { MainArea } from "./MainArea/MainArea";
import { StatusBar } from "./StatusBar";
import { AgentToastRenderer } from "./AgentToastRenderer";
import { showAgentToast } from "@/browser/stores/agentToast";

interface WorkspaceShellProps {
  workspaceId: string;
  projectPath: string;
  projectName: string;
  workspaceName: string;
  namedWorkspacePath: string;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  runtimeConfig?: RuntimeConfig;
  className?: string;
  /** If 'creating', mission is still being set up (git operations in progress) */
  status?: "creating";
}

const WorkspacePlaceholder: React.FC<{
  title: string;
  description?: string;
  className?: string;
}> = (props) => (
  <div
    className={cn(
      "relative flex flex-1 flex-row bg-dark text-light overflow-x-auto overflow-y-hidden [@media(max-width:768px)]:flex-col",
      props.className
    )}
    style={{ containerType: "inline-size" }}
  >
    <div className="pointer-events-none absolute right-[15px] bottom-[15px] left-[15px] z-[1000] [&>*]:pointer-events-auto">
      <ConnectionStatusToast wrap={false} />
    </div>

    <div className="text-placeholder flex h-full flex-1 flex-col items-center justify-center text-center">
      <h3 className="m-0 mb-2.5 text-base font-medium">{props.title}</h3>
      {props.description && <p className="m-0 text-[13px]">{props.description}</p>}
    </div>
  </div>
);

// ── Workspace completion watcher ──────────────────────────────────────────────
// Watches child workspace taskStatus and fires a toast when a task reports back.

function WorkspaceCompletionWatcher({ workspaceId }: { workspaceId: string }) {
  const { workspaceMetadata } = useWorkspaceContext();
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);

  useEffect(() => {
    const children = Array.from(workspaceMetadata.values()).filter(
      (ws) => ws.parentWorkspaceId === workspaceId
    );

    if (!seededRef.current) {
      // First pass: just seed the map, don't fire toasts for existing statuses
      for (const child of children) {
        if (child.taskStatus) {
          prevStatusRef.current.set(child.id, child.taskStatus);
        }
      }
      seededRef.current = true;
      return;
    }

    for (const child of children) {
      const prev = prevStatusRef.current.get(child.id);
      const current = child.taskStatus;

      // Fire toast when a task transitions to "reported" or "awaiting_report"
      if (
        current !== prev &&
        (current === "reported" || current === "awaiting_report") &&
        prev !== "reported" &&
        prev !== "awaiting_report"
      ) {
        const title = child.title ?? child.agentId ?? child.name;
        showAgentToast(title, {
          label: current === "reported" ? "Task Done" : "Awaiting Review",
          type: current === "reported" ? "done" : "info",
        });
      }

      if (current) {
        prevStatusRef.current.set(child.id, current);
      }
    }
  }, [workspaceMetadata, workspaceId]);

  return null;
}

// ── Main shell ────────────────────────────────────────────────────────────────

export const WorkspaceShell: React.FC<WorkspaceShellProps> = (props) => {
  const sidebar = useResizableSidebar({
    enabled: true,
    defaultWidth: 400,
    minWidth: 300,
    maxWidth: 1200,
    storageKey: RIGHT_SIDEBAR_WIDTH_KEY,
  });

  const { width: sidebarWidth, isResizing, startResize } = sidebar;

  // addTerminalRef is wired to MainArea for employee (agent) terminal tabs via "+" button
  const addTerminalRef = useRef<((options?: TerminalSessionCreateOptions) => void) | null>(null);
  const openFileRef = useRef<((relativePath: string) => void) | null>(null);

  const handleOpenFile = useCallback((relativePath: string) => {
    openFileRef.current?.(relativePath);
  }, []);

  const reviews = useReviews(props.workspaceId);
  const { addReview } = reviews;
  const handleReviewNote = useCallback(
    (data: ReviewNoteData) => {
      addReview(data);
    },
    [addReview]
  );

  const workspaceState = useWorkspaceState(props.workspaceId);
  const backgroundBashError = useBackgroundBashError();

  if (!workspaceState || workspaceState.loading) {
    return <WorkspacePlaceholder title="Loading mission..." className={props.className} />;
  }

  if (!props.projectName || !props.workspaceName) {
    return (
      <WorkspacePlaceholder
        title="No Mission Selected"
        description="Select a mission from the sidebar to get started"
        className={props.className}
      />
    );
  }

  return (
    <FileOpenerProvider openFile={handleOpenFile}>
      {/* Completion watcher fires toasts when child workspaces report back */}
      <WorkspaceCompletionWatcher workspaceId={props.workspaceId} />

      {/* Global agent toast notifications (portal at body level) */}
      <AgentToastRenderer />

      <div
        className={cn(
          "flex flex-1 flex-col bg-dark text-light",
          props.className
        )}
      >
        {/* Main content row: MainArea + RightSidebar */}
        <div
          className="flex min-h-0 flex-1 flex-row overflow-x-auto overflow-y-hidden [@media(max-width:768px)]:flex-col"
          style={{ containerType: "inline-size" }}
        >
          {/* MainArea: PM Chat tab + employee (agent) terminal tabs */}
          <MainArea
            workspaceId={props.workspaceId}
            workspacePath={props.namedWorkspacePath}
            projectPath={props.projectPath}
            projectName={props.projectName}
            workspaceName={props.workspaceName}
            workspaceState={workspaceState}
            leftSidebarCollapsed={props.leftSidebarCollapsed}
            onToggleLeftSidebarCollapsed={props.onToggleLeftSidebarCollapsed}
            runtimeConfig={props.runtimeConfig}
            status={props.status}
            addTerminalRef={addTerminalRef}
          />

          <RightSidebar
            key={props.workspaceId}
            workspaceId={props.workspaceId}
            workspacePath={props.namedWorkspacePath}
            projectPath={props.projectPath}
            width={sidebarWidth}
            onStartResize={startResize}
            isResizing={isResizing}
            onReviewNote={handleReviewNote}
            isCreating={props.status === "creating"}
            openFileRef={openFileRef}
          />

          <PopoverError
            error={backgroundBashError.error}
            prefix="Failed to terminate:"
            onDismiss={backgroundBashError.clearError}
          />
        </div>

        {/* Persistent status bar */}
        <StatusBar workspaceId={props.workspaceId} />
      </div>
    </FileOpenerProvider>
  );
};
