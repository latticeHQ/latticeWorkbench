import type { TerminalSessionCreateOptions } from "@/browser/utils/terminal";
import React, { useCallback, useRef } from "react";
import { cn } from "@/common/lib/utils";
import { WORKBENCH_PANEL_WIDTH_KEY, CHAT_PANE_COLLAPSED_KEY, getReviewImmersiveKey } from "@/common/constants/storage";
import { SidebarCollapseButton } from "./ui/SidebarCollapseButton";
import { useResizableSidebar } from "@/browser/hooks/useResizableSidebar";
import { useResizeObserver } from "@/browser/hooks/useResizeObserver";
import { useOpenTerminal } from "@/browser/hooks/useOpenTerminal";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { PopoverError } from "./PopoverError";
import type { RuntimeConfig } from "@/common/types/runtime";
import { useBackgroundBashError } from "@/browser/contexts/BackgroundBashContext";
import { useMinionState } from "@/browser/stores/MinionStore";
import { useReviews } from "@/browser/hooks/useReviews";
import type { ReviewNoteData } from "@/common/types/review";
import { ConnectionStatusToast } from "./ConnectionStatusToast";
import { ChatPane } from "./ChatPane";

// ChatPane uses tailwind `min-w-96`.
const CHAT_PANE_MIN_WIDTH_PX = 384;

const WORKBENCH_PANEL_DEFAULT_WIDTH_PX = 400;
const WORKBENCH_PANEL_MIN_WIDTH_PX = 300;
const WORKBENCH_PANEL_ABS_MAX_WIDTH_PX = 1200;

// Guard against subpixel rounding (e.g. zoom/devicePixelRatio) producing a 1px horizontal
// overflow that would trigger the MinionShell scrollbar.
const WORKBENCH_PANEL_OVERFLOW_GUARD_PX = 1;

interface MinionShellProps {
  minionId: string;
  projectPath: string;
  projectName: string;
  minionName: string;
  namedMinionPath: string;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  runtimeConfig?: RuntimeConfig;
  className?: string;
  /** True if minion is still being initialized (postCreateSetup or initMinion running) */
  isInitializing?: boolean;
}

const MinionPlaceholder: React.FC<{
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

export const MinionShell: React.FC<MinionShellProps> = (props) => {
  const shellRef = useRef<HTMLDivElement>(null);
  const shellSize = useResizeObserver(shellRef);

  // MinionShell switches to flex-col at this breakpoint, so in that stacked mode the
  // workbench panel doesn't need to "leave room" for ChatPane beside it.
  const isStacked =
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;

  const containerWidthPx = shellSize?.width ?? 0;
  // happy-dom / early-mount fallback: treat 0 as "unknown"
  const usableWidthPx =
    containerWidthPx > 0
      ? containerWidthPx
      : typeof window !== "undefined"
        ? window.innerWidth
        : 1200;

  // Prevent ChatPane + WorkbenchPanel from overflowing the minion shell (which would show a
  // horizontal scrollbar due to MinionShell's `overflow-x-auto`).
  const effectiveMaxWidthPx = isStacked
    ? WORKBENCH_PANEL_ABS_MAX_WIDTH_PX
    : Math.min(
        WORKBENCH_PANEL_ABS_MAX_WIDTH_PX,
        Math.max(
          WORKBENCH_PANEL_MIN_WIDTH_PX,
          usableWidthPx - CHAT_PANE_MIN_WIDTH_PX - WORKBENCH_PANEL_OVERFLOW_GUARD_PX
        )
      );

  const sidebar = useResizableSidebar({
    enabled: true,
    defaultWidth: WORKBENCH_PANEL_DEFAULT_WIDTH_PX,
    minWidth: WORKBENCH_PANEL_MIN_WIDTH_PX,
    maxWidth: effectiveMaxWidthPx,
    storageKey: WORKBENCH_PANEL_WIDTH_KEY,
    // Sidebar now renders left of ChatPane; flip drag direction accordingly
    side: "left",
  });

  const { width: sidebarWidth, isResizing, startResize } = sidebar;
  const addTerminalRef = useRef<((options?: TerminalSessionCreateOptions) => void) | null>(null);
  const openTerminalPopout = useOpenTerminal();
  const handleOpenTerminal = useCallback(
    (options?: TerminalSessionCreateOptions) => {
      // On mobile touch devices, always use popout since the workbench panel is hidden
      const isMobileTouch = window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
      if (isMobileTouch) {
        void openTerminalPopout(props.minionId, props.runtimeConfig, options);
      } else {
        addTerminalRef.current?.(options);
      }
    },
    [openTerminalPopout, props.minionId, props.runtimeConfig]
  );

  const reviews = useReviews(props.minionId);
  const { addReview } = reviews;
  const handleReviewNote = useCallback(
    (data: ReviewNoteData) => {
      addReview(data);
    },
    [addReview]
  );

  const minionState = useMinionState(props.minionId);
  const [isReviewImmersive] = usePersistedState(getReviewImmersiveKey(props.minionId), false, {
    listener: true,
  });
  // When chat pane is collapsed, the sidebar (terminal/tabs) fills all available space.
  const [chatPaneCollapsed, setChatPaneCollapsed] = usePersistedState(CHAT_PANE_COLLAPSED_KEY, false, {
    listener: true,
  });
  const backgroundBashError = useBackgroundBashError();

  if (!minionState || minionState.loading) {
    return <MinionPlaceholder title="Loading minion..." className={props.className} />;
  }

  if (!props.projectName || !props.minionName) {
    return (
      <MinionPlaceholder
        title="No Minion Selected"
        description="Select a minion from the sidebar to view and interact with Claude"
        className={props.className}
      />
    );
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative flex flex-1 flex-row bg-dark text-light overflow-x-auto overflow-y-hidden [@media(max-width:768px)]:flex-col",
        props.className
      )}
      style={{ containerType: "inline-size" }}
    >
      {/* Swapped: WorkbenchPanel renders in center, ChatPane on the right.
          When chat pane is collapsed, sidebar fills all available space (fillWidth). */}
      <WorkbenchPanel
        key={props.minionId}
        minionId={props.minionId}
        minionPath={props.namedMinionPath}
        projectPath={props.projectPath}
        width={chatPaneCollapsed ? undefined : sidebarWidth}
        onStartResize={chatPaneCollapsed ? undefined : startResize}
        isResizing={chatPaneCollapsed ? false : isResizing}
        onReviewNote={handleReviewNote}
        isCreating={props.isInitializing === true}
        immersiveHidden={isReviewImmersive}
        addTerminalRef={addTerminalRef}
        fillWidth={chatPaneCollapsed}
      />

      {/* Keyed by minionId to prevent cross-minion message-list flashes.
          When chatPaneCollapsed is true, ChatPane is hidden so the sidebar fills all space. */}
      {chatPaneCollapsed ? (
        // When chat is collapsed, show a thin column with a centered expand button
        // (mirrors the left sidebar's collapsed rail).
        <div className="border-border-light flex w-5 shrink-0 flex-col items-center border-l">
          <SidebarCollapseButton
            collapsed={true}
            onToggle={() => setChatPaneCollapsed(false)}
            side="right"
          />
        </div>
      ) : (
        <ChatPane
          key={`chat-${props.minionId}`}
          minionId={props.minionId}
          minionState={minionState}
          projectPath={props.projectPath}
          projectName={props.projectName}
          minionName={props.minionName}
          namedMinionPath={props.namedMinionPath}
          leftSidebarCollapsed={props.leftSidebarCollapsed}
          onToggleLeftSidebarCollapsed={props.onToggleLeftSidebarCollapsed}
          runtimeConfig={props.runtimeConfig}
          onOpenTerminal={handleOpenTerminal}
          immersiveHidden={isReviewImmersive}
        />
      )}

      {/* Portal target for immersive review mode overlay */}
      <div
        id="review-immersive-root"
        hidden={!isReviewImmersive}
        className="bg-dark absolute inset-0 z-50"
        data-testid="review-immersive-root"
      />

      <PopoverError
        error={backgroundBashError.error}
        prefix="Failed to terminate:"
        onDismiss={backgroundBashError.clearError}
      />
    </div>
  );
};
