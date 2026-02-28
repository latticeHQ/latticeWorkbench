import React from "react";
import {
  WORKBENCH_PANEL_TAB_KEY,
  getReviewImmersiveKey,
  getWorkbenchPanelLayoutKey,
  getTerminalTitlesKey,
} from "@/common/constants/storage";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import { getProfileDefinition } from "@/common/constants/terminalProfiles";
import {
  readPersistedState,
  updatePersistedState,
  usePersistedState,
} from "@/browser/hooks/usePersistedState";
import { useFeatureFlags } from "@/browser/contexts/FeatureFlagsContext";
import { useAPI } from "@/browser/contexts/API";
import { useRouter } from "@/browser/contexts/RouterContext";
import { CostsTab } from "./WorkbenchPanel/CostsTab";

import { ReviewPanel } from "./WorkbenchPanel/CodeReview/ReviewPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { StatsTab } from "./WorkbenchPanel/StatsTab";
import { OutputTab } from "./OutputTab";

import {
  matchesKeybind,
  KEYBINDS,
  formatKeybind,
  isDialogOpen,
  isEditableElement,
} from "@/browser/utils/ui/keybinds";
import { cn } from "@/common/lib/utils";
import type { ReviewNoteData } from "@/common/types/review";
import { TerminalTab } from "./WorkbenchPanel/TerminalTab";
import {
  WORKBENCH_PANEL_TABS,
  isTabType,
  isTerminalTab,
  isFileTab,
  getTerminalSessionId,
  getFilePath,
  makeTerminalTabType,
  makeFileTabType,
  type TabType,
} from "@/browser/types/workbenchPanel";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  addTabToFocusedTabset,
  addTabToTerminalTabset,
  collectAllTabs,
  collectAllTabsWithTabset,
  dockTabToEdge,
  findTabset,
  getDefaultWorkbenchPanelLayoutState,
  getFocusedActiveTab,
  isWorkbenchPanelLayoutState,
  moveTabToTabset,
  parseWorkbenchPanelLayoutState,
  removeTabEverywhere,
  reorderTabInTabset,
  replaceTabInLayout,
  selectTabByIndex,
  selectOrAddTab,
  selectTabInTabset,
  setFocusedTabset,
  updateSplitSizes,
  type WorkbenchPanelLayoutNode,
  type WorkbenchPanelLayoutState,
} from "@/browser/utils/workbenchPanelLayout";
import {
  WorkbenchPanelTabStrip,
  getTabName,
  type TabDragData,
  type TerminalProfileItem,
} from "./WorkbenchPanel/WorkbenchPanelTabStrip";
import {
  createTerminalSession,
  openTerminalPopout,
  type TerminalSessionCreateOptions,
} from "@/browser/utils/terminal";
import {
  CostsTabLabel,
  ExplorerTabLabel,
  KanbanTabLabel,
  IssuesTabLabel,
  InferenceTabLabel,
  SchedulesTabLabel,
  SyncTabLabel,
  OutputTabLabel,
  FileTabLabel,
  ReviewTabLabel,
  StatsTabLabel,
  TerminalTabLabel,
  getTabContentClassName,
  type ReviewStats,
} from "./WorkbenchPanel/tabs";
import { FileViewerTab } from "./WorkbenchPanel/FileViewer";
import { ExplorerTab } from "./WorkbenchPanel/ExplorerTab";
import { KanbanBoard } from "./WorkbenchPanel/KanbanBoard";
import { IssuesTab } from "./WorkbenchPanel/IssuesTab";
import { InferenceTab } from "./WorkbenchPanel/InferenceTab";
import { SchedulesTab } from "./WorkbenchPanel/SchedulesTab";
import { SyncTab } from "./WorkbenchPanel/SyncTab";
import { useMinionSidebarState } from "@/browser/stores/MinionStore";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";

// Re-export for consumers
export type { ReviewStats };

interface SidebarContainerProps {
  collapsed: boolean;
  /** Custom width from drag-resize (unified across all tabs) */
  customWidth?: number;
  /** Whether actively dragging resize handle (disables transition) */
  isResizing?: boolean;
  /** Whether running in Electron desktop mode (hides border when collapsed) */
  isDesktop?: boolean;
  /** Hide + inactivate sidebar while immersive review overlay is active. */
  immersiveHidden?: boolean;
  /** When true, sidebar stretches to fill available space (chat pane collapsed). */
  fillWidth?: boolean;
  children: React.ReactNode;
  role: string;
  "aria-label": string;
}

/**
 * SidebarContainer - Main sidebar wrapper with dynamic width
 *
 * Width priority (first match wins):
 * 1. collapsed (20px) - Shows collapse button only
 * 2. customWidth - From drag-resize (unified width from AIView)
 * 3. default (400px) - Fallback when no custom width set
 */
const SidebarContainer: React.FC<SidebarContainerProps> = ({
  collapsed,
  customWidth,
  isResizing,
  isDesktop,
  immersiveHidden = false,
  fillWidth = false,
  children,
  role,
  "aria-label": ariaLabel,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  // When fillWidth is true (chat pane collapsed), sidebar stretches via flex-1 instead of a fixed width.
  const width = fillWidth ? undefined : collapsed ? "20px" : customWidth ? `${customWidth}px` : "400px";

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (immersiveHidden) {
      container.setAttribute("inert", "");
    } else {
      container.removeAttribute("inert");
    }

    return () => {
      container.removeAttribute("inert");
    };
  }, [immersiveHidden]);

  return (
    <div
      ref={containerRef}
      aria-hidden={immersiveHidden || undefined}
      className={cn(
        "bg-sidebar border-r border-border-light flex flex-col overflow-hidden",
        // When fillWidth, use flex-1 to stretch; otherwise fixed-width with shrink-0.
        fillWidth ? "flex-1 min-w-0" : "flex-shrink-0",
        // Hide on mobile touch devices - too narrow for useful interaction
        "mobile-hide-right-sidebar",
        !isResizing && !fillWidth && "transition-[width] duration-200",
        collapsed && "sticky left-0 z-10 shadow-[2px_0_4px_rgba(0,0,0,0.2)]",
        // In desktop mode, hide the right border when collapsed to avoid
        // visual separation in the titlebar area (overlay buttons zone)
        isDesktop && collapsed && "border-r-0"
      )}
      style={fillWidth ? { maxWidth: "100%" } : { width, maxWidth: "100%" }}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
};

export { WORKBENCH_PANEL_TABS, isTabType };
export type { TabType };

interface WorkbenchPanelProps {
  minionId: string;
  minionPath: string;
  projectPath: string;
  /** Custom width in pixels (persisted per-tab, provided by AIView) */
  width?: number;
  /** Drag start handler for resize */
  onStartResize?: (e: React.MouseEvent) => void;
  /** Whether currently resizing */
  isResizing?: boolean;
  /** Callback when user adds a review note from Code Review tab */
  onReviewNote?: (data: ReviewNoteData) => void;
  /** Minion is still being created (git operations in progress) */
  isCreating?: boolean;
  /** Hide + inactivate sidebar while immersive review overlay is active. */
  immersiveHidden?: boolean;
  /** Ref callback to expose addTerminal function to parent */
  addTerminalRef?: React.MutableRefObject<
    ((options?: TerminalSessionCreateOptions) => void) | null
  >;
  /** When true, sidebar stretches to fill all available space (chat pane collapsed). */
  fillWidth?: boolean;
}

/**
 * Wrapper component for PanelResizeHandle that disables pointer events during tab drag.
 * Uses isDragging prop passed from parent DndContext.
 */
const DragAwarePanelResizeHandle: React.FC<{
  direction: "horizontal" | "vertical";
  isDraggingTab: boolean;
}> = ({ direction, isDraggingTab }) => {
  const className = cn(
    direction === "horizontal"
      ? "w-0.5 flex-shrink-0 z-10 transition-[background] duration-150 cursor-col-resize bg-border-light hover:bg-accent"
      : "h-0.5 flex-shrink-0 z-10 transition-[background] duration-150 cursor-row-resize bg-border-light hover:bg-accent",
    isDraggingTab && "pointer-events-none"
  );

  return <PanelResizeHandle className={className} />;
};

function hasMountedReviewPanel(node: WorkbenchPanelLayoutNode): boolean {
  if (node.type === "tabset") {
    return node.activeTab === "review";
  }

  return node.children.some((child) => hasMountedReviewPanel(child));
}

type TabsetNode = Extract<WorkbenchPanelLayoutNode, { type: "tabset" }>;

interface WorkbenchPanelTabsetNodeProps {
  node: TabsetNode;
  baseId: string;
  minionId: string;
  minionPath: string;
  projectPath: string;
  isCreating: boolean;
  focusTrigger: number;
  onReviewNote?: (data: ReviewNoteData) => void;
  reviewStats: ReviewStats | null;
  onReviewStatsChange: (stats: ReviewStats | null) => void;
  statsTabEnabled: boolean;
  /** Whether any sidebar tab is currently being dragged */
  isDraggingTab: boolean;
  /** Data about the currently dragged tab (if any) */
  activeDragData: TabDragData | null;
  setLayout: (updater: (prev: WorkbenchPanelLayoutState) => WorkbenchPanelLayoutState) => void;
  /** Handler to pop out a terminal tab to a separate window */
  onPopOutTerminal: (tab: TabType) => void;
  /** Handler to add a new terminal tab (only present in terminal tabsets) */
  onAddTerminal?: () => void;
  /** Handler to add a profile-based terminal (profile ID + display name) */
  onAddProfileTerminal?: (profileId: string, profileName: string) => void;
  /** Enabled + installed terminal profiles for the "+" dropdown */
  terminalProfiles?: TerminalProfileItem[];
  /** Handler to open the analytics dashboard */
  onOpenAnalytics?: () => void;
  /** Handler to close a terminal tab */
  onCloseTerminal: (tab: TabType) => void;
  /** Handler to remove a terminal tab after the session exits */
  onTerminalExit: (tab: TabType) => void;
  /** Map of terminal tab types to their current titles (from OSC sequences) */
  terminalTitles: Map<TabType, string>;
  /** Handler to update a terminal's title */
  onTerminalTitleChange: (tab: TabType, title: string) => void;
  /** Map of tab → global position index (0-based) for keybind tooltips */
  tabPositions: Map<TabType, number>;
  /** Terminal session ID that should be auto-focused (cleared once focus lands) */
  autoFocusTerminalSession: string | null;
  /** Callback to request terminal focus when a tab is selected */
  onRequestTerminalFocus: (sessionId: string) => void;
  /** Callback to clear the auto-focus state after it's been consumed */
  onAutoFocusConsumed: () => void;
  /** Handler to open a file in a new tab */
  onOpenFile: (relativePath: string) => void;
  /** Handler to close a file tab */
  onCloseFile: (tab: TabType) => void;
}

const WorkbenchPanelTabsetNode: React.FC<WorkbenchPanelTabsetNodeProps> = (props) => {
  const tabsetBaseId = `${props.baseId}-${props.node.id}`;

  // Content container class comes from tab registry - each tab defines its own padding/overflow
  const tabsetContentClassName = cn(
    "relative flex-1 min-h-0",
    getTabContentClassName(props.node.activeTab)
  );

  // Drop zones using @dnd-kit's useDroppable
  const { setNodeRef: contentRef, isOver: isOverContent } = useDroppable({
    id: `content:${props.node.id}`,
    data: { type: "content", tabsetId: props.node.id },
  });

  const { setNodeRef: topRef, isOver: isOverTop } = useDroppable({
    id: `edge:${props.node.id}:top`,
    data: { type: "edge", tabsetId: props.node.id, edge: "top" },
  });

  const { setNodeRef: bottomRef, isOver: isOverBottom } = useDroppable({
    id: `edge:${props.node.id}:bottom`,
    data: { type: "edge", tabsetId: props.node.id, edge: "bottom" },
  });

  const { setNodeRef: leftRef, isOver: isOverLeft } = useDroppable({
    id: `edge:${props.node.id}:left`,
    data: { type: "edge", tabsetId: props.node.id, edge: "left" },
  });

  const { setNodeRef: rightRef, isOver: isOverRight } = useDroppable({
    id: `edge:${props.node.id}:right`,
    data: { type: "edge", tabsetId: props.node.id, edge: "right" },
  });

  const showDockHints =
    props.isDraggingTab &&
    (isOverContent || isOverTop || isOverBottom || isOverLeft || isOverRight);

  const setFocused = () => {
    props.setLayout((prev) => setFocusedTabset(prev, props.node.id));
  };

  const selectTab = (tab: TabType) => {
    if (isTerminalTab(tab)) {
      const sessionId = getTerminalSessionId(tab);
      if (sessionId) {
        props.onRequestTerminalFocus(sessionId);
      }
    }

    props.setLayout((prev) => {
      const withFocus = setFocusedTabset(prev, props.node.id);
      return selectTabInTabset(withFocus, props.node.id, tab);
    });
  };

  // Count terminal tabs in this tabset for numbering (Terminal, Terminal 2, etc.)
  const terminalTabs = props.node.tabs.filter(isTerminalTab);

  const items = props.node.tabs.flatMap((tab) => {
    if (tab === "stats" && !props.statsTabEnabled) {
      return [];
    }

    const tabId = `${tabsetBaseId}-tab-${tab}`;
    const panelId = `${tabsetBaseId}-panel-${tab}`;

    // Show keybind for tabs 1-9 based on their position in the layout
    const isTerminal = isTerminalTab(tab);
    const isFile = isFileTab(tab);
    const tabPosition = props.tabPositions.get(tab);
    const keybinds = [
      KEYBINDS.SIDEBAR_TAB_1,
      KEYBINDS.SIDEBAR_TAB_2,
      KEYBINDS.SIDEBAR_TAB_3,
      KEYBINDS.SIDEBAR_TAB_4,
      KEYBINDS.SIDEBAR_TAB_5,
      KEYBINDS.SIDEBAR_TAB_6,
      KEYBINDS.SIDEBAR_TAB_7,
      KEYBINDS.SIDEBAR_TAB_8,
      KEYBINDS.SIDEBAR_TAB_9,
    ];
    const keybindStr =
      tabPosition !== undefined && tabPosition < keybinds.length
        ? formatKeybind(keybinds[tabPosition])
        : undefined;

    // For file tabs, show path + keybind; for others just keybind
    let tooltip: React.ReactNode;
    if (isFile) {
      const filePath = getFilePath(tab);
      tooltip = (
        <div className="flex flex-col">
          <span>{filePath}</span>
          {keybindStr && <span className="text-muted-foreground">{keybindStr}</span>}
        </div>
      );
    } else {
      tooltip = keybindStr;
    }

    // Build label using tab-specific label components
    let label: React.ReactNode;

    if (tab === "costs") {
      label = <CostsTabLabel minionId={props.minionId} />;
    } else if (tab === "review") {
      label = <ReviewTabLabel reviewStats={props.reviewStats} />;
    } else if (tab === "explorer") {
      label = <ExplorerTabLabel />;
    } else if (tab === "stats") {
      label = <StatsTabLabel minionId={props.minionId} />;
    } else if (tab === "output") {
      label = <OutputTabLabel />;
    } else if (tab === "kanban") {
      label = <KanbanTabLabel />;
    } else if (tab === "issues") {
      label = <IssuesTabLabel />;
    } else if (tab === "inference") {
      label = <InferenceTabLabel />;
    } else if (tab === "schedules") {
      label = <SchedulesTabLabel />;
    } else if (tab === "sync") {
      label = <SyncTabLabel />;
    } else if (isTerminal) {
      const terminalIndex = terminalTabs.indexOf(tab);
      label = (
        <TerminalTabLabel
          dynamicTitle={props.terminalTitles.get(tab)}
          terminalIndex={terminalIndex}
          onPopOut={() => props.onPopOutTerminal(tab)}
          onClose={() => props.onCloseTerminal(tab)}
        />
      );
    } else if (isFileTab(tab)) {
      const filePath = getFilePath(tab);
      label = <FileTabLabel filePath={filePath ?? tab} onClose={() => props.onCloseFile(tab)} />;
    } else {
      label = tab;
    }

    return [
      {
        id: tabId,
        panelId,
        selected: props.node.activeTab === tab,
        onSelect: () => selectTab(tab),
        label,
        tooltip,
        tab,
        // Terminal and file tabs are closeable
        onClose: isTerminal
          ? () => props.onCloseTerminal(tab)
          : isFileTab(tab)
            ? () => props.onCloseFile(tab)
            : undefined,
      },
    ];
  });

  const costsPanelId = `${tabsetBaseId}-panel-costs`;
  const reviewPanelId = `${tabsetBaseId}-panel-review`;
  const explorerPanelId = `${tabsetBaseId}-panel-explorer`;
  const statsPanelId = `${tabsetBaseId}-panel-stats`;
  const outputPanelId = `${tabsetBaseId}-panel-output`;

  const costsTabId = `${tabsetBaseId}-tab-costs`;
  const reviewTabId = `${tabsetBaseId}-tab-review`;
  const explorerTabId = `${tabsetBaseId}-tab-explorer`;
  const statsTabId = `${tabsetBaseId}-tab-stats`;
  const outputTabId = `${tabsetBaseId}-tab-output`;

  // Generate sortable IDs for tabs in this tabset
  const sortableIds = items.map((item) => `${props.node.id}:${item.tab}`);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onMouseDownCapture={setFocused}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        <WorkbenchPanelTabStrip
          ariaLabel="Sidebar views"
          items={items}
          tabsetId={props.node.id}
          onAddTerminal={props.onAddTerminal}
          onAddProfileTerminal={props.onAddProfileTerminal}
          terminalProfiles={props.terminalProfiles}
          onOpenAnalytics={props.onOpenAnalytics}
        />
      </SortableContext>
      <div
        ref={contentRef}
        className={cn(
          tabsetContentClassName,
          props.isDraggingTab && isOverContent && "bg-accent/10 ring-1 ring-accent/50"
        )}
      >
        {/* Edge docking zones - always rendered but only visible/interactive during drag */}
        <div
          ref={topRef}
          className={cn(
            "absolute inset-x-0 top-0 z-10 h-10 transition-opacity",
            props.isDraggingTab
              ? showDockHints
                ? "opacity-100"
                : "opacity-0"
              : "opacity-0 pointer-events-none",
            isOverTop ? "bg-accent/20 border-b border-accent" : "bg-accent/5"
          )}
        />
        <div
          ref={bottomRef}
          className={cn(
            "absolute inset-x-0 bottom-0 z-10 h-10 transition-opacity",
            props.isDraggingTab
              ? showDockHints
                ? "opacity-100"
                : "opacity-0"
              : "opacity-0 pointer-events-none",
            isOverBottom ? "bg-accent/20 border-t border-accent" : "bg-accent/5"
          )}
        />
        <div
          ref={leftRef}
          className={cn(
            "absolute inset-y-0 left-0 z-10 w-10 transition-opacity",
            props.isDraggingTab
              ? showDockHints
                ? "opacity-100"
                : "opacity-0"
              : "opacity-0 pointer-events-none",
            isOverLeft ? "bg-accent/20 border-r border-accent" : "bg-accent/5"
          )}
        />
        <div
          ref={rightRef}
          className={cn(
            "absolute inset-y-0 right-0 z-10 w-10 transition-opacity",
            props.isDraggingTab
              ? showDockHints
                ? "opacity-100"
                : "opacity-0"
              : "opacity-0 pointer-events-none",
            isOverRight ? "bg-accent/20 border-l border-accent" : "bg-accent/5"
          )}
        />

        {props.node.activeTab === "costs" && (
          <div role="tabpanel" id={costsPanelId} aria-labelledby={costsTabId}>
            <CostsTab minionId={props.minionId} />
          </div>
        )}

        {props.node.activeTab === "output" && (
          <div role="tabpanel" id={outputPanelId} aria-labelledby={outputTabId} className="h-full">
            <OutputTab minionId={props.minionId} />
          </div>
        )}

        {/* Render all terminal tabs (keep-alive: hidden but mounted) */}
        {terminalTabs.map((terminalTab) => {
          const terminalTabId = `${tabsetBaseId}-tab-${terminalTab}`;
          const terminalPanelId = `${tabsetBaseId}-panel-${terminalTab}`;
          const isActive = props.node.activeTab === terminalTab;
          // Check if this terminal should be auto-focused (was just opened via keybind)
          const terminalSessionId = getTerminalSessionId(terminalTab);
          const shouldAutoFocus = isActive && terminalSessionId === props.autoFocusTerminalSession;

          return (
            <div
              key={terminalPanelId}
              role="tabpanel"
              id={terminalPanelId}
              aria-labelledby={terminalTabId}
              className="h-full"
              hidden={!isActive}
            >
              <TerminalTab
                minionId={props.minionId}
                tabType={terminalTab}
                visible={isActive}
                onTitleChange={(title) => props.onTerminalTitleChange(terminalTab, title)}
                autoFocus={shouldAutoFocus}
                onAutoFocusConsumed={shouldAutoFocus ? props.onAutoFocusConsumed : undefined}
                onExit={() => props.onTerminalExit(terminalTab)}
              />
            </div>
          );
        })}

        {props.node.tabs.includes("stats") && props.statsTabEnabled && (
          <div
            role="tabpanel"
            id={statsPanelId}
            aria-labelledby={statsTabId}
            hidden={props.node.activeTab !== "stats"}
          >
            <ErrorBoundary minionInfo="Stats tab">
              <StatsTab minionId={props.minionId} />
            </ErrorBoundary>
          </div>
        )}

        {props.node.activeTab === "explorer" && (
          <div
            role="tabpanel"
            id={explorerPanelId}
            aria-labelledby={explorerTabId}
            className="h-full"
          >
            <ExplorerTab
              minionId={props.minionId}
              minionPath={props.minionPath}
              onOpenFile={props.onOpenFile}
            />
          </div>
        )}

        {/* Render file viewer tabs */}
        {props.node.tabs.filter(isFileTab).map((fileTab) => {
          const filePath = getFilePath(fileTab);
          const fileTabId = `${tabsetBaseId}-tab-${fileTab}`;
          const filePanelId = `${tabsetBaseId}-panel-${fileTab}`;
          const isActive = props.node.activeTab === fileTab;

          return (
            <div
              key={filePanelId}
              role="tabpanel"
              id={filePanelId}
              aria-labelledby={fileTabId}
              className="h-full"
              hidden={!isActive}
            >
              {isActive && filePath && (
                <FileViewerTab
                  minionId={props.minionId}
                  relativePath={filePath}
                  onReviewNote={props.onReviewNote}
                />
              )}
            </div>
          );
        })}

        {props.node.activeTab === "review" && (
          <div role="tabpanel" id={reviewPanelId} aria-labelledby={reviewTabId} className="h-full">
            <ReviewPanel
              key={`${props.minionId}:${props.node.id}`}
              minionId={props.minionId}
              minionPath={props.minionPath}
              projectPath={props.projectPath}
              onReviewNote={props.onReviewNote}
              focusTrigger={props.focusTrigger}
              isCreating={props.isCreating}
              onStatsChange={props.onReviewStatsChange}
              onOpenFile={props.onOpenFile}
            />
          </div>
        )}

        {props.node.activeTab === "kanban" && (
          <div role="tabpanel" className="h-full">
            <KanbanBoard minionId={props.minionId} />
          </div>
        )}

        {props.node.activeTab === "issues" && (
          <div role="tabpanel" className="h-full">
            <IssuesTab minionId={props.minionId} />
          </div>
        )}
        {props.node.activeTab === "inference" && (
          <div role="tabpanel" className="h-full">
            <InferenceTab minionId={props.minionId} />
          </div>
        )}

        {props.node.activeTab === "schedules" && (
          <div role="tabpanel" className="h-full">
            <SchedulesTab minionId={props.minionId} projectPath={props.projectPath} />
          </div>
        )}

        {props.node.activeTab === "sync" && (
          <div role="tabpanel" className="h-full">
            <SyncTab minionId={props.minionId} />
          </div>
        )}
      </div>
    </div>
  );
};

const WorkbenchPanelComponent: React.FC<WorkbenchPanelProps> = ({
  minionId,
  minionPath,
  projectPath,
  width,
  onStartResize,
  isResizing = false,
  onReviewNote,
  isCreating = false,
  immersiveHidden = false,
  addTerminalRef,
  fillWidth = false,
}) => {
  // Subscribe to terminal activity from MinionStore. The `terminalSessionCount`
  // drives the session-sync effect below so that externally created terminals
  // (e.g. via MCP `terminal_create`) are automatically picked up as tabs.
  const { terminalSessionCount } = useMinionSidebarState(minionId);

  // Trigger for focusing Review panel (preserves hunk selection)
  const [focusTrigger, _setFocusTrigger] = React.useState(0);

  // Review stats reported by ReviewPanel
  const [reviewStats, setReviewStats] = React.useState<ReviewStats | null>(null);

  // Terminal session ID that should be auto-focused (new terminal or explicit tab focus).
  const [autoFocusTerminalSession, setAutoFocusTerminalSession] = React.useState<string | null>(
    null
  );

  // Sidebar collapse is now controlled by the chat pane (CHAT_PANE_COLLAPSED_KEY).
  // The sidebar itself is always expanded when rendered.
  const collapsed = false;
  const setCollapsed = (_v: boolean) => {};
  const [isReviewImmersive, setIsReviewImmersive] = usePersistedState<boolean>(
    getReviewImmersiveKey(minionId),
    false,
    { listener: true }
  );

  // Stats tab feature flag
  const { statsTabState } = useFeatureFlags();
  const statsTabEnabled = Boolean(statsTabState?.enabled);

  // Analytics navigation — exposed as a quick-launch button in the tab strip
  const { navigateToAnalytics } = useRouter();

  // Read last-used focused tab for better defaults when initializing a new layout.
  const initialActiveTab = React.useMemo<TabType>(() => {
    const raw = readPersistedState<string>(WORKBENCH_PANEL_TAB_KEY, "costs");
    return isTabType(raw) ? raw : "costs";
  }, []);

  const defaultLayout = React.useMemo(
    () => getDefaultWorkbenchPanelLayoutState(initialActiveTab),
    [initialActiveTab]
  );

  // Layout is per-minion so each minion can have its own split/tab configuration
  // (e.g., different numbers of terminals). Width and collapsed state remain global.
  const layoutKey = getWorkbenchPanelLayoutKey(minionId);
  const [layoutRaw, setLayoutRaw] = usePersistedState<WorkbenchPanelLayoutState>(
    layoutKey,
    defaultLayout,
    {
      listener: true,
    }
  );

  // While dragging tabs (hover-based reorder), keep layout changes in-memory and
  // commit once on drop to avoid localStorage writes on every mousemove.
  const [layoutDraft, setLayoutDraft] = React.useState<WorkbenchPanelLayoutState | null>(null);
  const layoutDraftRef = React.useRef<WorkbenchPanelLayoutState | null>(null);

  // Ref to access latest layoutRaw without causing callback recreation
  const layoutRawRef = React.useRef(layoutRaw);
  layoutRawRef.current = layoutRaw;

  const isSidebarTabDragInProgressRef = React.useRef(false);

  const handleSidebarTabDragStart = React.useCallback(() => {
    isSidebarTabDragInProgressRef.current = true;
    layoutDraftRef.current = null;
  }, []);

  const handleSidebarTabDragEnd = React.useCallback(() => {
    isSidebarTabDragInProgressRef.current = false;

    const draft = layoutDraftRef.current;
    if (draft) {
      setLayoutRaw(draft);
    }

    layoutDraftRef.current = null;
    setLayoutDraft(null);
  }, [setLayoutRaw]);

  const layout = React.useMemo(
    () => parseWorkbenchPanelLayoutState(layoutDraft ?? layoutRaw, initialActiveTab),
    [layoutDraft, layoutRaw, initialActiveTab]
  );

  const hasReviewPanelMounted = React.useMemo(
    () => !collapsed && hasMountedReviewPanel(layout.root),
    [collapsed, layout.root]
  );

  // If immersive mode is active but no ReviewPanel is mounted (e.g., user switched tabs),
  // clear the persisted immersive flag to avoid leaving a blank overlay mounted.
  React.useEffect(() => {
    if (!isReviewImmersive || hasReviewPanelMounted) {
      return;
    }

    setIsReviewImmersive(false);
  }, [hasReviewPanelMounted, isReviewImmersive, setIsReviewImmersive]);

  // If the Stats tab feature is enabled, ensure it exists in the layout.
  // If disabled, ensure it doesn't linger in persisted layouts.
  React.useEffect(() => {
    setLayoutRaw((prevRaw) => {
      const prev = parseWorkbenchPanelLayoutState(prevRaw, initialActiveTab);
      const hasStats = collectAllTabs(prev.root).includes("stats");

      if (statsTabEnabled && !hasStats) {
        // Add stats tab to the focused tabset without stealing focus.
        return addTabToFocusedTabset(prev, "stats", false);
      }

      if (!statsTabEnabled && hasStats) {
        return removeTabEverywhere(prev, "stats");
      }

      return prev;
    });
  }, [initialActiveTab, setLayoutRaw, statsTabEnabled]);
  // If we ever deserialize an invalid layout (e.g. schema changes), reset to defaults.
  React.useEffect(() => {
    if (!isWorkbenchPanelLayoutState(layoutRaw)) {
      setLayoutRaw(layout);
    }
  }, [layout, layoutRaw, setLayoutRaw]);

  const getBaseLayout = React.useCallback(() => {
    return (
      layoutDraftRef.current ?? parseWorkbenchPanelLayoutState(layoutRawRef.current, initialActiveTab)
    );
  }, [initialActiveTab]);

  const focusActiveTerminal = React.useCallback(
    (state: WorkbenchPanelLayoutState) => {
      const activeTab = getFocusedActiveTab(state, initialActiveTab);
      if (!isTerminalTab(activeTab)) {
        return;
      }
      const sessionId = getTerminalSessionId(activeTab);
      if (sessionId) {
        setAutoFocusTerminalSession(sessionId);
      }
    },
    [initialActiveTab, setAutoFocusTerminalSession]
  );

  const setLayout = React.useCallback(
    (updater: (prev: WorkbenchPanelLayoutState) => WorkbenchPanelLayoutState) => {
      if (isSidebarTabDragInProgressRef.current) {
        // Use ref to get latest layoutRaw without dependency
        const base =
          layoutDraftRef.current ??
          parseWorkbenchPanelLayoutState(layoutRawRef.current, initialActiveTab);
        const next = updater(base);
        layoutDraftRef.current = next;
        setLayoutDraft(next);
        return;
      }

      setLayoutRaw((prevRaw) => updater(parseWorkbenchPanelLayoutState(prevRaw, initialActiveTab)));
    },
    [initialActiveTab, setLayoutRaw]
  );

  const selectOrOpenReviewTab = React.useCallback(() => {
    setLayout((prev) => selectOrAddTab(prev, "review"));
    _setFocusTrigger((prev) => prev + 1);
  }, [setLayout]);

  // Keyboard shortcuts for tab switching by position (Cmd/Ctrl+1-9)
  // Auto-expands sidebar if collapsed
  React.useEffect(() => {
    const tabKeybinds = [
      KEYBINDS.SIDEBAR_TAB_1,
      KEYBINDS.SIDEBAR_TAB_2,
      KEYBINDS.SIDEBAR_TAB_3,
      KEYBINDS.SIDEBAR_TAB_4,
      KEYBINDS.SIDEBAR_TAB_5,
      KEYBINDS.SIDEBAR_TAB_6,
      KEYBINDS.SIDEBAR_TAB_7,
      KEYBINDS.SIDEBAR_TAB_8,
      KEYBINDS.SIDEBAR_TAB_9,
    ];

    const handleKeyDown = (e: KeyboardEvent) => {
      for (let i = 0; i < tabKeybinds.length; i++) {
        if (matchesKeybind(e, tabKeybinds[i])) {
          e.preventDefault();

          const currentLayout = parseWorkbenchPanelLayoutState(
            layoutRawRef.current,
            initialActiveTab
          );
          const allTabs = collectAllTabsWithTabset(currentLayout.root);
          const target = allTabs[i];
          if (target && isTerminalTab(target.tab)) {
            const sessionId = getTerminalSessionId(target.tab);
            if (sessionId) {
              setAutoFocusTerminalSession(sessionId);
            }
          } else if (target?.tab === "review") {
            // Review panel keyboard navigation (j/k) is gated on focus. If the user explicitly
            // opened the tab via shortcut, focus the panel so it works immediately.
            _setFocusTrigger((prev) => prev + 1);
          }

          setLayout((prev) => selectTabByIndex(prev, i));
          setCollapsed(false);
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [initialActiveTab, setAutoFocusTerminalSession, setCollapsed, setLayout, _setFocusTrigger]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesKeybind(e, KEYBINDS.TOGGLE_REVIEW_IMMERSIVE)) {
        return;
      }

      if (isEditableElement(e.target)) {
        return;
      }

      e.preventDefault();
      setCollapsed(false);
      selectOrOpenReviewTab();
      setIsReviewImmersive((prev) => !prev);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isReviewImmersive, selectOrOpenReviewTab, setCollapsed, setIsReviewImmersive]);

  const baseId = `right-sidebar-${minionId}`;

  // Build map of tab → position for keybind tooltips
  const tabPositions = React.useMemo(() => {
    const allTabs = collectAllTabsWithTabset(layout.root);
    const positions = new Map<TabType, number>();
    allTabs.forEach(({ tab }, index) => {
      positions.set(tab, index);
    });
    return positions;
  }, [layout.root]);

  // @dnd-kit state for tracking active drag
  const [activeDragData, setActiveDragData] = React.useState<TabDragData | null>(null);

  // Terminal titles from OSC sequences (e.g., shell setting window title)
  // Persisted to localStorage so they survive reload
  const terminalTitlesKey = getTerminalTitlesKey(minionId);
  const [terminalTitles, setTerminalTitles] = React.useState<Map<TabType, string>>(() => {
    const stored = readPersistedState<Record<string, string>>(terminalTitlesKey, {});
    return new Map(Object.entries(stored) as Array<[TabType, string]>);
  });

  // API for opening terminal windows and managing sessions
  const { api } = useAPI();

  const removeTerminalTab = React.useCallback(
    (tab: TabType) => {
      // User request: close terminal panes when the session exits.
      const nextLayout = removeTabEverywhere(getBaseLayout(), tab);
      setLayout(() => nextLayout);
      focusActiveTerminal(nextLayout);

      setTerminalTitles((prev) => {
        const next = new Map(prev);
        next.delete(tab);
        updatePersistedState(terminalTitlesKey, Object.fromEntries(next));
        return next;
      });
    },
    [focusActiveTerminal, getBaseLayout, setLayout, terminalTitlesKey]
  );

  // Keyboard shortcut for closing active tab (Ctrl/Cmd+W)
  // Works for terminal tabs and file tabs
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesKeybind(e, KEYBINDS.CLOSE_TAB)) return;
      // Always prevent platform default (Cmd/Ctrl+W closes window), even during dialogs.
      e.preventDefault();
      if (isDialogOpen()) return;

      const focusedTabset = findTabset(layout.root, layout.focusedTabsetId);
      if (focusedTabset?.type !== "tabset") return;

      const activeTab = focusedTabset.activeTab;

      // Handle terminal tabs
      if (isTerminalTab(activeTab)) {
        e.preventDefault();

        // Close the backend session
        const sessionId = getTerminalSessionId(activeTab);
        if (sessionId) {
          api?.terminal.close({ sessionId }).catch((err) => {
            console.warn("[WorkbenchPanel] Failed to close terminal session:", err);
          });
        }

        removeTerminalTab(activeTab);
        return;
      }

      // Handle file tabs
      if (isFileTab(activeTab)) {
        e.preventDefault();
        const nextLayout = removeTabEverywhere(layout, activeTab);
        setLayout(() => nextLayout);
        focusActiveTerminal(nextLayout);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [api, focusActiveTerminal, layout, removeTerminalTab, setLayout]);

  // Sync terminal tabs with live backend sessions. Only sessions with running
  // PTY processes get tabs — this prevents blank terminals for dead sessions.
  // Kanban active cards are fetched in parallel to enrich profile display names
  // (e.g. "Google Gemini" instead of "Terminal 2") but do NOT drive tab creation.
  // The `await reconcileActiveCards` on the backend ensures the kanban board
  // stays consistent with listSessions (dead sessions move to "completed").
  // Re-runs on minion mount and whenever terminalSessionCount changes
  // (MinionStore's terminal.activity subscription).
  React.useEffect(() => {
    if (!api) return;

    let cancelled = false;

    void Promise.all([
      api.terminal.listSessions({ minionId }),
      api.kanban.list({ minionId }).catch(() => []),
    ]).then(([backendSessions, kanbanCards]) => {
      if (cancelled) return;

      // listSessions is the source of truth for which tabs to show (live PTYs only).
      const backendSessionSet = new Set(backendSessions.map((s) => s.sessionId));

      // Build a profileId/profileName lookup from both sources for name enrichment.
      const profileLookup = new Map<
        string,
        { profileId?: string | null; profileName?: string }
      >();
      for (const s of backendSessions) {
        profileLookup.set(s.sessionId, { profileId: s.profileId });
      }
      // Enrich with kanban card metadata (profileName is the display name).
      for (const card of kanbanCards) {
        if (!backendSessionSet.has(card.sessionId)) continue; // Only enrich live sessions
        const existing = profileLookup.get(card.sessionId);
        profileLookup.set(card.sessionId, {
          profileId: existing?.profileId ?? card.profileId ?? null,
          profileName: card.profileName,
        });
      }

      // Get current terminal tabs in layout
      const currentTabs = collectAllTabs(layout.root);
      const currentTerminalTabs = currentTabs.filter(isTerminalTab);
      const currentTerminalSessionIds = new Set(
        currentTerminalTabs.map(getTerminalSessionId).filter(Boolean)
      );

      // Find live sessions that don't have tabs yet (add them)
      const missingSessions = backendSessions.filter(
        (s) => !currentTerminalSessionIds.has(s.sessionId)
      );

      // Find tabs for sessions that no longer exist in backend (remove them)
      const ghostTabs = currentTerminalTabs.filter((tab) => {
        const sessionId = getTerminalSessionId(tab);
        return sessionId && !backendSessionSet.has(sessionId);
      });

      if (missingSessions.length > 0 || ghostTabs.length > 0) {
        setLayout((prev) => {
          let next = prev;

          // Remove ghost tabs first
          for (const ghostTab of ghostTabs) {
            next = removeTabEverywhere(next, ghostTab);
          }

          // Add tabs for live sessions that don't have tabs.
          // Use addTabToTerminalTabset so new terminals land in the terminal panel
          // (tabset-1), not the info panel (tabset-2) which is focused by default.
          for (const session of missingSessions) {
            next = addTabToTerminalTabset(next, makeTerminalTabType(session.sessionId), false);
          }

          // After removing ghost tabs, if no terminal tabs remain (e.g. after app
          // restart when all backend sessions are gone), reset to the default
          // two-pane layout. This restores the terminal/info split with a bare
          // "terminal" placeholder that the promotion effect will convert to a
          // real session. Without this, the split collapses to a single tabset
          // and the terminal panel disappears.
          const remainingTabs = collectAllTabs(next.root);
          const hasTerminal = remainingTabs.some((t) => isTerminalTab(t) || t === "terminal");
          if (!hasTerminal) {
            const focusedTab = getFocusedActiveTab(next, "costs");
            next = getDefaultWorkbenchPanelLayoutState(focusedTab);
          }

          return next;
        });

        // Seed profile display names as initial tab titles for newly added sessions.
        // This gives tabs like "Google Gemini" instead of "Terminal 2".
        // OSC title changes from the shell will override these later.
        if (missingSessions.length > 0) {
          setTerminalTitles((prev) => {
            const next = new Map(prev);
            for (const session of missingSessions) {
              const tab = makeTerminalTabType(session.sessionId);
              if (next.has(tab)) continue; // Don't overwrite existing titles

              const meta = profileLookup.get(session.sessionId);
              if (meta?.profileName && meta.profileName !== "Default Terminal") {
                // Kanban card has a meaningful display name — use it directly
                next.set(tab, meta.profileName);
              } else if (meta?.profileId) {
                // Resolve profileId to display name from definitions
                const def = getProfileDefinition(meta.profileId);
                next.set(tab, def?.displayName ?? meta.profileId);
              } else if (session.profileId) {
                const def = getProfileDefinition(session.profileId);
                next.set(tab, def?.displayName ?? session.profileId);
              }
            }
            updatePersistedState(terminalTitlesKey, Object.fromEntries(next));
            return next;
          });
        }
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layout.root excluded to avoid infinite loop. terminalSessionCount triggers re-sync when sessions are created/destroyed externally (e.g. MCP).
  }, [api, minionId, setLayout, terminalSessionCount]);

  // Promote bare "terminal" placeholders to real "terminal:<sessionId>" tabs.
  // The default layout seeds a bare "terminal" tab so the split is visible immediately;
  // this effect creates the backend session and swaps in the real tab type.
  React.useEffect(() => {
    if (!api) return;

    const allTabs = collectAllTabs(layout.root);
    // Bare "terminal" has no session ID — needs promotion
    const barePlaceholders = allTabs.filter((t) => t === "terminal");
    if (barePlaceholders.length === 0) return;

    let cancelled = false;

    void createTerminalSession(api, minionId).then((session) => {
      if (cancelled) return;

      const realTab = makeTerminalTabType(session.sessionId);
      setLayout((prev) => replaceTabInLayout(prev, "terminal", realTab));
      setAutoFocusTerminalSession(session.sessionId);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only promote on mount/minion change; layout.root would loop.
  }, [api, minionId, setLayout]);

  // Handler to update a terminal's title (from OSC sequences)
  // Also persists to localStorage for reload survival
  const handleTerminalTitleChange = React.useCallback(
    (tab: TabType, title: string) => {
      setTerminalTitles((prev) => {
        const next = new Map(prev);
        next.set(tab, title);
        // Persist to localStorage
        updatePersistedState(terminalTitlesKey, Object.fromEntries(next));
        return next;
      });
    },
    [terminalTitlesKey]
  );

  // Handler to add a new terminal tab.
  // Creates the backend session first, then adds the tab with the real sessionId.
  // This ensures the tabType (and React key) never changes, preventing remounts.
  const handleAddTerminal = React.useCallback(
    (options?: TerminalSessionCreateOptions) => {
      if (!api) return;

      // Also expand sidebar if collapsed
      setCollapsed(false);

      void createTerminalSession(api, minionId, options).then((session) => {
        const newTab = makeTerminalTabType(session.sessionId);
        setLayout((prev) => addTabToFocusedTabset(prev, newTab));
        // Schedule focus for this terminal (will be consumed when the tab mounts)
        setAutoFocusTerminalSession(session.sessionId);

        // Seed terminal title from profile name for immediate tab label display.
        // OSC title changes from the shell will override this later.
        if (options?.profileName) {
          setTerminalTitles((prev) => {
            const next = new Map(prev);
            next.set(newTab, options.profileName!);
            updatePersistedState(terminalTitlesKey, Object.fromEntries(next));
            return next;
          });
        }
      });
    },
    [api, minionId, setLayout, setCollapsed, terminalTitlesKey]
  );

  // Expose handleAddTerminal to parent via ref (for Cmd/Ctrl+T keybind)
  React.useEffect(() => {
    if (addTerminalRef) {
      addTerminalRef.current = handleAddTerminal;
    }
    return () => {
      if (addTerminalRef) {
        addTerminalRef.current = null;
      }
    };
  }, [addTerminalRef, handleAddTerminal]);

  // ---------- Terminal profiles for "+" dropdown ----------
  // Fetch once on mount; profiles are lightweight and rarely change.
  const [terminalProfileItems, setTerminalProfileItems] = React.useState<TerminalProfileItem[]>([]);

  React.useEffect(() => {
    if (!api) return;
    api.terminalProfiles
      .list()
      .then((profiles) => {
        setTerminalProfileItems(
          profiles
            .filter((p) => p.config.enabled)
            .map((p) => ({
              id: p.id,
              displayName: p.displayName,
              installed: p.detection.installed,
              group: p.group,
            }))
        );
      })
      .catch(() => {
        // Non-critical; just means no profile dropdown
      });
  }, [api]);

  // Handler for launching a profile-based terminal from the "+" dropdown.
  // Delegates to handleAddTerminal with profile-specific options.
  const handleAddProfileTerminal = React.useCallback(
    (profileId: string, profileName: string) => {
      handleAddTerminal({ profileId, profileName });
    },
    [handleAddTerminal]
  );

  // Handler to close a terminal tab
  const handleCloseTerminal = React.useCallback(
    (tab: TabType) => {
      // Close the backend session
      const sessionId = getTerminalSessionId(tab);
      if (sessionId) {
        api?.terminal.close({ sessionId }).catch((err) => {
          console.warn("[WorkbenchPanel] Failed to close terminal session:", err);
        });
      }

      removeTerminalTab(tab);
    },
    [api, removeTerminalTab]
  );

  // Handler to pop out a terminal to a separate window, then remove the tab
  const handlePopOutTerminal = React.useCallback(
    (tab: TabType) => {
      if (!api) return;

      // Session ID is embedded in the tab type
      const sessionId = getTerminalSessionId(tab);
      if (!sessionId) return; // Can't pop out without a session

      // Open the pop-out window (handles browser vs Electron modes)
      openTerminalPopout(api, minionId, sessionId);

      // Remove the tab from the sidebar (terminal now lives in its own window)
      // Don't close the session - the pop-out window takes over
      setLayout((prev) => removeTabEverywhere(prev, tab));

      // Clean up title (and persist)
      setTerminalTitles((prev) => {
        const next = new Map(prev);
        next.delete(tab);
        updatePersistedState(terminalTitlesKey, Object.fromEntries(next));
        return next;
      });
    },
    [minionId, api, setLayout, terminalTitlesKey]
  );

  // Configure sensors with distance threshold for click vs drag disambiguation

  // Handler to open a file in a new tab
  const handleOpenFile = React.useCallback(
    (relativePath: string) => {
      const fileTabType = makeFileTabType(relativePath);

      // Check if the file is already open
      const allTabs = collectAllTabs(layout.root);
      if (allTabs.includes(fileTabType)) {
        // File already open - just select it
        const tabsetId = collectAllTabsWithTabset(layout.root).find(
          (t) => t.tab === fileTabType
        )?.tabsetId;
        if (tabsetId) {
          setLayout((prev) => {
            const withFocus = setFocusedTabset(prev, tabsetId);
            return selectTabInTabset(withFocus, tabsetId, fileTabType);
          });
        }
        return;
      }

      // Add new file tab to the focused tabset
      setLayout((prev) => addTabToFocusedTabset(prev, fileTabType));
    },
    [layout.root, setLayout]
  );

  // Handler to close a file tab
  const handleCloseFile = React.useCallback(
    (tab: TabType) => {
      const nextLayout = removeTabEverywhere(getBaseLayout(), tab);
      setLayout(() => nextLayout);
      focusActiveTerminal(nextLayout);
    },
    [focusActiveTerminal, getBaseLayout, setLayout]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    })
  );

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as TabDragData | undefined;
      if (data) {
        setActiveDragData(data);
        handleSidebarTabDragStart();
      }
    },
    [handleSidebarTabDragStart]
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      const activeData = active.data.current as TabDragData | undefined;

      if (activeData && over) {
        const overData = over.data.current as
          | { type: "edge"; tabsetId: string; edge: "top" | "bottom" | "left" | "right" }
          | { type: "content"; tabsetId: string }
          | { tabsetId: string }
          | TabDragData
          | undefined;

        if (overData) {
          // Handle dropping on edge zones (create splits)
          if ("type" in overData && overData.type === "edge") {
            setLayout((prev) =>
              dockTabToEdge(
                prev,
                activeData.tab,
                activeData.sourceTabsetId,
                overData.tabsetId,
                overData.edge
              )
            );
          }
          // Handle dropping on content area (move to tabset)
          else if ("type" in overData && overData.type === "content") {
            if (activeData.sourceTabsetId !== overData.tabsetId) {
              setLayout((prev) =>
                moveTabToTabset(prev, activeData.tab, activeData.sourceTabsetId, overData.tabsetId)
              );
            }
          }
          // Handle dropping on another tabstrip (move to tabset)
          else if ("tabsetId" in overData && !("tab" in overData)) {
            if (activeData.sourceTabsetId !== overData.tabsetId) {
              setLayout((prev) =>
                moveTabToTabset(prev, activeData.tab, activeData.sourceTabsetId, overData.tabsetId)
              );
            }
          }
          // Handle reordering within same tabset (sortable handles this via arrayMove pattern)
          else if ("tab" in overData && "sourceTabsetId" in overData) {
            // Both are tabs - check if same tabset for reorder
            if (activeData.sourceTabsetId === overData.sourceTabsetId) {
              const fromIndex = activeData.index;
              const toIndex = overData.index;
              if (fromIndex !== toIndex) {
                setLayout((prev) =>
                  reorderTabInTabset(prev, activeData.sourceTabsetId, fromIndex, toIndex)
                );
              }
            } else {
              // Different tabsets - move tab
              setLayout((prev) =>
                moveTabToTabset(
                  prev,
                  activeData.tab,
                  activeData.sourceTabsetId,
                  overData.sourceTabsetId
                )
              );
            }
          }
        }
      }

      setActiveDragData(null);
      handleSidebarTabDragEnd();
    },
    [setLayout, handleSidebarTabDragEnd]
  );

  const isDraggingTab = activeDragData !== null;

  const renderLayoutNode = (node: WorkbenchPanelLayoutNode): React.ReactNode => {
    if (node.type === "split") {
      // Our layout uses "horizontal" to mean a horizontal divider (top/bottom panes).
      // react-resizable-panels uses "vertical" for top/bottom.
      const groupDirection = node.direction === "horizontal" ? "vertical" : "horizontal";

      return (
        <PanelGroup
          direction={groupDirection}
          className="flex min-h-0 min-w-0 flex-1"
          onLayout={(sizes) => {
            if (sizes.length !== 2) return;
            const nextSizes: [number, number] = [
              typeof sizes[0] === "number" ? sizes[0] : 50,
              typeof sizes[1] === "number" ? sizes[1] : 50,
            ];
            setLayout((prev) => updateSplitSizes(prev, node.id, nextSizes));
          }}
        >
          <Panel defaultSize={node.sizes[0]} minSize={15} className="flex min-h-0 min-w-0 flex-col">
            {renderLayoutNode(node.children[0])}
          </Panel>
          <DragAwarePanelResizeHandle direction={groupDirection} isDraggingTab={isDraggingTab} />
          <Panel defaultSize={node.sizes[1]} minSize={15} className="flex min-h-0 min-w-0 flex-col">
            {renderLayoutNode(node.children[1])}
          </Panel>
        </PanelGroup>
      );
    }

    return (
      <WorkbenchPanelTabsetNode
        key={node.id}
        node={node}
        baseId={baseId}
        minionId={minionId}
        minionPath={minionPath}
        projectPath={projectPath}
        isCreating={Boolean(isCreating)}
        focusTrigger={focusTrigger}
        onReviewNote={onReviewNote}
        reviewStats={reviewStats}
        statsTabEnabled={statsTabEnabled}
        onReviewStatsChange={setReviewStats}
        isDraggingTab={isDraggingTab}
        activeDragData={activeDragData}
        setLayout={setLayout}
        onPopOutTerminal={handlePopOutTerminal}
        // Only show "+" terminal button in tabsets that contain terminal tabs;
        // only show analytics launcher in non-terminal tabsets.
        onAddTerminal={node.tabs.some((t) => isTerminalTab(t)) ? handleAddTerminal : undefined}
        onAddProfileTerminal={
          node.tabs.some((t) => isTerminalTab(t)) ? handleAddProfileTerminal : undefined
        }
        terminalProfiles={
          node.tabs.some((t) => isTerminalTab(t)) ? terminalProfileItems : undefined
        }
        onOpenAnalytics={node.tabs.some((t) => isTerminalTab(t)) ? undefined : navigateToAnalytics}
        onCloseTerminal={handleCloseTerminal}
        onTerminalExit={removeTerminalTab}
        terminalTitles={terminalTitles}
        onTerminalTitleChange={handleTerminalTitleChange}
        tabPositions={tabPositions}
        onRequestTerminalFocus={setAutoFocusTerminalSession}
        autoFocusTerminalSession={autoFocusTerminalSession}
        onAutoFocusConsumed={() => setAutoFocusTerminalSession(null)}
        onOpenFile={handleOpenFile}
        onCloseFile={handleCloseFile}
      />
    );
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <SidebarContainer
        collapsed={collapsed}
        isResizing={isResizing}
        isDesktop={isDesktopMode()}
        immersiveHidden={immersiveHidden}
        customWidth={width}
        fillWidth={fillWidth}
        role="complementary"
        aria-label="Minion insights"
      >
        {!collapsed && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-row">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {renderLayoutNode(layout.root)}
            </div>

            {/* Resize handle (right edge — sidebar now sits left of ChatPane) */}
            {onStartResize && (
              <div
                className={cn(
                  "w-0.5 flex-shrink-0 z-10 transition-[background] duration-150 cursor-col-resize",
                  isResizing ? "bg-accent" : "bg-border-light hover:bg-accent"
                )}
                onMouseDown={(e) => onStartResize(e as unknown as React.MouseEvent)}
              />
            )}
          </div>
        )}
        {/* Sidebar collapse is now controlled by the chat pane toggle;
            no standalone collapsed rail needed here. */}
      </SidebarContainer>

      {/* Drag overlay - shows tab being dragged at cursor position */}
      <DragOverlay>
        {activeDragData ? (
          <div className="border-border bg-background/95 cursor-grabbing rounded-md border px-3 py-1 text-xs font-medium shadow">
            {getTabName(activeDragData.tab)}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

// Memoize to prevent re-renders when parent (AIView) re-renders during streaming
// Only re-renders when minionId or chatAreaRef changes, or internal state updates
export const WorkbenchPanel = React.memo(WorkbenchPanelComponent);
