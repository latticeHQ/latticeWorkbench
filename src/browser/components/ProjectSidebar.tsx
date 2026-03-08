import React, { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/common/lib/utils";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import LatticeLogoDark from "@/browser/assets/logos/lattice-logo-dark.svg?react";
import LatticeLogoLight from "@/browser/assets/logos/lattice-logo-light.svg?react";
import { useTheme } from "@/browser/contexts/ThemeContext";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import {
  readPersistedState,
  updatePersistedState,
  usePersistedState,
} from "@/browser/hooks/usePersistedState";
import { useDebouncedValue } from "@/browser/hooks/useDebouncedValue";
import { useMinionFallbackModel } from "@/browser/hooks/useMinionFallbackModel";
import { useMinionUnread } from "@/browser/hooks/useMinionUnread";
import { useMinionStoreRaw } from "@/browser/stores/MinionStore";
import {
  EXPANDED_PROJECTS_KEY,
  MOBILE_LEFT_SIDEBAR_SCROLL_TOP_KEY,
  getDraftScopeId,
  getInputKey,
  getMinionNameStateKey,
} from "@/common/constants/storage";
import { getDisplayTitleFromPersistedState } from "@/browser/hooks/useMinionName";
import { DndProvider } from "react-dnd";
import { HTML5Backend, getEmptyImage } from "react-dnd-html5-backend";
import { useDrag, useDrop, useDragLayer } from "react-dnd";
import {
  sortProjectsByOrder,
  reorderProjects,
  normalizeOrder,
} from "@/common/utils/projectOrdering";
import {
  matchesKeybind,
  formatKeybind,
  isEditableElement,
  KEYBINDS,
} from "@/browser/utils/ui/keybinds";
import { useAPI } from "@/browser/contexts/API";
import { CUSTOM_EVENTS, type CustomEventType } from "@/common/constants/events";
import { PlatformPaths } from "@/common/utils/paths";
import {
  partitionMinionsByAge,
  partitionMinionsByStage,
  formatDaysThreshold,
  AGE_THRESHOLDS_DAYS,
  computeMinionDepthMap,
  findNextNonEmptyTier,
  getTierKey,
  getStageExpandedKey,
  getStageTierKey,
  sortStagesByLinkedList,
} from "@/browser/utils/ui/minionFiltering";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { SidebarCollapseButton } from "./ui/SidebarCollapseButton";
import { ConfirmationModal } from "./ConfirmationModal";
import SecretsModal from "./SecretsModal";
import type { Secret } from "@/common/types/secrets";

import { MinionListItem, type MinionSelection } from "./MinionListItem";
import { MinionStatusIndicator } from "./MinionStatusIndicator";
import { TitleEditProvider, useTitleEdit } from "@/browser/contexts/MinionTitleEditContext";
import { useConfirmDialog } from "@/browser/contexts/ConfirmDialogContext";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { ChevronRight, CircleHelp, KeyRound } from "lucide-react";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { useMinionActions } from "@/browser/contexts/MinionContext";
import { useRouter } from "@/browser/contexts/RouterContext";
import { usePopoverError } from "@/browser/hooks/usePopoverError";
import { forkMinion } from "@/browser/utils/chatCommands";
import { PopoverError } from "./PopoverError";
import { StageHeader } from "./StageHeader";
import { AddStageButton } from "./AddStageButton";
import { MinionStageDropZone } from "./MinionStageDropZone";
import { MinionDragLayer } from "./MinionDragLayer";
import { StageDragLayer } from "./StageDragLayer";
import { DraggableStage } from "./DraggableStage";
import { getErrorMessage } from "@/common/utils/errors";

// Re-export MinionSelection for backwards compatibility
export type { MinionSelection } from "./MinionListItem";

// Draggable project item moved to module scope to avoid remounting on every parent render.
// Defining components inside another component causes a new function identity each render,
// which forces React to unmount/remount the subtree. That led to hover flicker and high CPU.

/**
 * Compact button for opening Chat with Lattice, showing an unread dot when there are
 * new messages since the user last viewed the minion.
 */
const LatticeChatHelpButton: React.FC<{
  onClick: () => void;
  isSelected: boolean;
}> = ({ onClick, isSelected }) => {
  const { isUnread: hasUnread } = useMinionUnread(LATTICE_HELP_CHAT_MINION_ID);
  const isUnread = hasUnread && !isSelected;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className="text-muted hover:text-primary relative flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0 transition-colors"
          aria-label="Open Chat with Lattice"
        >
          <CircleHelp className="h-3.5 w-3.5" />
          {isUnread && (
            <span
              className="bg-accent absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full"
              aria-label="Unread messages"
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Chat with Lattice</TooltipContent>
    </Tooltip>
  );
};

// Keep the project header visible while scrolling through long minion lists.
const PROJECT_ITEM_BASE_CLASS =
  "sticky top-0 z-10 py-2 pl-2 pr-3 flex items-center border-l-transparent bg-sidebar transition-colors duration-150";

function getProjectItemClassName(opts: {
  isDragging: boolean;
  isOver: boolean;
  selected: boolean;
}): string {
  return cn(
    PROJECT_ITEM_BASE_CLASS,
    opts.isDragging ? "cursor-grabbing opacity-35 [&_*]:!cursor-grabbing" : "cursor-grab",
    opts.isOver && "bg-accent/[0.08]",
    opts.selected && "bg-hover border-l-accent",
    "hover:[&_button]:opacity-100 hover:[&_[data-drag-handle]]:opacity-100"
  );
}
type DraggableProjectItemProps = React.PropsWithChildren<{
  projectPath: string;
  onReorder: (draggedPath: string, targetPath: string) => void;
  selected?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  role?: string;
  tabIndex?: number;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-label"?: string;
  "data-project-path"?: string;
}>;

const DraggableProjectItemBase: React.FC<DraggableProjectItemProps> = ({
  projectPath,
  onReorder,
  children,
  selected,
  ...rest
}) => {
  const [{ isDragging }, drag, dragPreview] = useDrag(
    () => ({
      type: "PROJECT",
      item: { type: "PROJECT" as const, projectPath },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [projectPath]
  );

  // Hide native drag preview; we render a custom preview via DragLayer
  useEffect(() => {
    dragPreview(getEmptyImage(), { captureDraggingState: true });
  }, [dragPreview]);

  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: "PROJECT",
      drop: (item: { projectPath: string }) => {
        if (item.projectPath !== projectPath) {
          onReorder(item.projectPath, projectPath);
        }
      },
      collect: (monitor) => ({ isOver: monitor.isOver({ shallow: true }) }),
    }),
    [projectPath, onReorder]
  );

  return (
    <div
      ref={(node) => drag(drop(node))}
      className={getProjectItemClassName({
        isDragging,
        isOver,
        selected: !!selected,
      })}
      {...rest}
    >
      {children}
    </div>
  );
};

const DraggableProjectItem = React.memo(
  DraggableProjectItemBase,
  (prev, next) =>
    prev.projectPath === next.projectPath &&
    prev.onReorder === next.onReorder &&
    (prev["aria-expanded"] ?? false) === (next["aria-expanded"] ?? false)
);
/**
 * Wrapper that fetches draft data from localStorage and renders via unified MinionListItem.
 * Keeps data-fetching logic colocated with sidebar while delegating rendering to shared component.
 */
interface DraftMinionListItemWrapperProps {
  projectPath: string;
  draftId: string;
  draftNumber: number;
  isSelected: boolean;
  onOpen: () => void;
  onDelete: () => void;
}

// Debounce delay for sidebar preview updates during typing.
// Prevents constant re-renders while still providing timely feedback.
const DRAFT_PREVIEW_DEBOUNCE_MS = 1000;

function DraftMinionListItemWrapper(props: DraftMinionListItemWrapperProps) {
  const scopeId = getDraftScopeId(props.projectPath, props.draftId);

  const [draftPrompt] = usePersistedState<string>(getInputKey(scopeId), "", {
    listener: true,
  });

  const [minionNameState] = usePersistedState<unknown>(getMinionNameStateKey(scopeId), null, {
    listener: true,
  });

  // Debounce the preview values to avoid constant sidebar updates while typing.
  const debouncedPrompt = useDebouncedValue(draftPrompt, DRAFT_PREVIEW_DEBOUNCE_MS);
  const debouncedNameState = useDebouncedValue(minionNameState, DRAFT_PREVIEW_DEBOUNCE_MS);

  const minionTitle = getDisplayTitleFromPersistedState(debouncedNameState);

  // Collapse whitespace so multi-line prompts show up nicely as a single-line preview.
  const promptPreview =
    typeof debouncedPrompt === "string" ? debouncedPrompt.trim().replace(/\s+/g, " ") : "";

  const titleText = minionTitle.trim().length > 0 ? minionTitle.trim() : "Draft";

  return (
    <MinionListItem
      variant="draft"
      projectPath={props.projectPath}
      isSelected={props.isSelected}
      draft={{
        draftId: props.draftId,
        draftNumber: props.draftNumber,
        title: titleText,
        promptPreview,
        onOpen: props.onOpen,
        onDelete: props.onDelete,
      }}
    />
  );
}

// Custom drag layer to show a semi-transparent preview and enforce grabbing cursor
interface ProjectDragItem {
  type: "PROJECT";
  projectPath: string;
}
interface StageDragItemLocal {
  type: "SECTION_REORDER";
  stageId: string;
  projectPath: string;
}
type DragItem = ProjectDragItem | StageDragItemLocal | null;

const ProjectDragLayer: React.FC = () => {
  const dragState = useDragLayer<{
    isDragging: boolean;
    item: unknown;
    currentOffset: { x: number; y: number } | null;
  }>((monitor) => ({
    isDragging: monitor.isDragging(),
    item: monitor.getItem(),
    currentOffset: monitor.getClientOffset(),
  }));
  const isDragging = dragState.isDragging;
  const item = dragState.item as DragItem;
  const currentOffset = dragState.currentOffset;

  React.useEffect(() => {
    if (!isDragging) return;
    const originalBody = document.body.style.cursor;
    const originalHtml = document.documentElement.style.cursor;
    document.body.style.cursor = "grabbing";
    document.documentElement.style.cursor = "grabbing";
    return () => {
      document.body.style.cursor = originalBody;
      document.documentElement.style.cursor = originalHtml;
    };
  }, [isDragging]);

  // Only render for PROJECT type drags (not stage reorder)
  if (!isDragging || !currentOffset || !item?.projectPath || item.type !== "PROJECT") return null;

  const abbrevPath = PlatformPaths.abbreviate(item.projectPath);
  const { basename } = PlatformPaths.splitAbbreviated(abbrevPath);

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] cursor-grabbing">
      <div style={{ transform: `translate(${currentOffset.x + 10}px, ${currentOffset.y + 10}px)` }}>
        <div className={cn(PROJECT_ITEM_BASE_CLASS, "w-fit max-w-64 rounded-sm shadow-lg")}>
          <span className="text-secondary mr-2 flex h-5 w-5 shrink-0 items-center justify-center">
            <ChevronRight size={12} />
          </span>
          <div className="flex min-w-0 flex-1 items-center pr-2">
            <span className="text-foreground truncate text-sm font-medium">{basename}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

function LatticeChatStatusIndicator() {
  const fallbackModel = useMinionFallbackModel(LATTICE_HELP_CHAT_MINION_ID);

  return (
    <MinionStatusIndicator
      minionId={LATTICE_HELP_CHAT_MINION_ID}
      fallbackModel={fallbackModel}
      isCreating={false}
    />
  );
}

/**
 * Handles F2 (edit title) and Shift+F2 (generate new title) keybinds.
 * Rendered inside TitleEditProvider so it can access useTitleEdit().
 */
function SidebarTitleEditKeybinds(props: {
  selectedMinion: MinionSelection | undefined;
  sortedMinionsByProject: Map<string, FrontendMinionMetadata[]>;
  collapsed: boolean;
}) {
  const { requestEdit, wrapGenerateTitle } = useTitleEdit();
  const { api } = useAPI();

  const regenerateTitleForMinion = useCallback(
    (minionId: string) => {
      if (minionId === LATTICE_HELP_CHAT_MINION_ID) {
        return;
      }
      wrapGenerateTitle(minionId, () => {
        if (!api) {
          return Promise.resolve({ success: false, error: "Not connected to server" });
        }
        return api.minion.regenerateTitle({ minionId });
      });
    },
    [wrapGenerateTitle, api]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (props.collapsed) return;
      if (!props.selectedMinion) return;
      if (isEditableElement(e.target)) return;
      const wsId = props.selectedMinion.minionId;
      if (wsId === LATTICE_HELP_CHAT_MINION_ID) return;

      if (matchesKeybind(e, KEYBINDS.EDIT_MINION_TITLE)) {
        e.preventDefault();
        const meta = props.sortedMinionsByProject
          .get(props.selectedMinion.projectPath)
          ?.find((m) => m.id === wsId);
        const displayTitle = meta?.title ?? meta?.name ?? "";
        requestEdit(wsId, displayTitle);
      } else if (matchesKeybind(e, KEYBINDS.GENERATE_MINION_TITLE)) {
        e.preventDefault();
        regenerateTitleForMinion(wsId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    props.collapsed,
    props.selectedMinion,
    props.sortedMinionsByProject,
    requestEdit,
    regenerateTitleForMinion,
  ]);

  useEffect(() => {
    const handleGenerateTitleRequest: EventListener = (event) => {
      const customEvent = event as CustomEventType<
        typeof CUSTOM_EVENTS.MINION_GENERATE_TITLE_REQUESTED
      >;
      regenerateTitleForMinion(customEvent.detail.minionId);
    };

    window.addEventListener(
      CUSTOM_EVENTS.MINION_GENERATE_TITLE_REQUESTED,
      handleGenerateTitleRequest
    );
    return () => {
      window.removeEventListener(
        CUSTOM_EVENTS.MINION_GENERATE_TITLE_REQUESTED,
        handleGenerateTitleRequest
      );
    };
  }, [regenerateTitleForMinion]);

  return null;
}

interface ProjectSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sortedMinionsByProject: Map<string, FrontendMinionMetadata[]>;
  minionRecency: Record<string, number>;
  /** Pre-computed from metadata in App.tsx so the sidebar doesn't subscribe to
   *  the MinionMetadataContext (which changes on every minion op). */
  latticeChatProjectPath: string | null;
}

const ProjectSidebarInner: React.FC<ProjectSidebarProps> = ({
  collapsed,
  onToggleCollapsed,
  sortedMinionsByProject,
  minionRecency,
  latticeChatProjectPath,
}) => {
  // Use the narrow actions context — does NOT subscribe to minionMetadata
  // changes, preventing the entire sidebar tree from re-rendering on every
  // minion create/archive/rename.
  const {
    selectedMinion,
    setSelectedMinion: onSelectMinion,
    archiveMinion: onArchiveMinion,
    removeMinion,
    updateMinionTitle: onUpdateTitle,
    refreshMinionMetadata,
    pendingNewMinionProject,
    pendingNewMinionDraftId,
    minionDraftsByProject,
    minionDraftPromotionsByProject,
    createMinionDraft,
    openMinionDraft,
    deleteMinionDraft,
  } = useMinionActions();
  const minionStore = useMinionStoreRaw();
  const { navigateToProject } = useRouter();
  const { api } = useAPI();
  const { confirm: confirmDialog } = useConfirmDialog();

  // Get project state and operations from context
  const {
    projects,
    openProjectCreateModal: onAddProject,
    removeProject: onRemoveProject,
    getSecrets: onGetSecrets,
    updateSecrets: onUpdateSecrets,
    createStage,
    updateStage,
    removeStage,
    reorderStages,
    assignMinionToStage,
  } = useProjectContext();

  // Theme for logo variant
  const { theme } = useTheme();
  const LatticeLogo = theme === "dark" || theme.endsWith("-dark") ? LatticeLogoDark : LatticeLogoLight;

  // Mobile breakpoint for auto-closing sidebar
  const MOBILE_BREAKPOINT = 768;
  const projectListScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileScrollTopRef = useRef(0);
  const wasCollapsedRef = useRef(collapsed);

  const normalizeMobileScrollTop = useCallback((scrollTop: number): number => {
    return Number.isFinite(scrollTop) ? Math.max(0, Math.round(scrollTop)) : 0;
  }, []);

  const persistMobileSidebarScrollTop = useCallback(
    (scrollTop: number) => {
      if (window.innerWidth > MOBILE_BREAKPOINT) {
        return;
      }

      // Keep the last viewed list position so reopening the touch sidebar returns
      // users to where they were browsing instead of jumping back to the top.
      const normalizedScrollTop = normalizeMobileScrollTop(scrollTop);
      updatePersistedState<number>(MOBILE_LEFT_SIDEBAR_SCROLL_TOP_KEY, normalizedScrollTop, 0);
    },
    [MOBILE_BREAKPOINT, normalizeMobileScrollTop]
  );

  useEffect(() => {
    if (collapsed || window.innerWidth > MOBILE_BREAKPOINT) {
      return;
    }

    const persistedScrollTop = readPersistedState<unknown>(MOBILE_LEFT_SIDEBAR_SCROLL_TOP_KEY, 0);
    const normalizedScrollTop =
      typeof persistedScrollTop === "number" ? normalizeMobileScrollTop(persistedScrollTop) : 0;
    mobileScrollTopRef.current = normalizedScrollTop;

    if (projectListScrollRef.current) {
      projectListScrollRef.current.scrollTop = normalizedScrollTop;
    }
  }, [collapsed, MOBILE_BREAKPOINT, normalizeMobileScrollTop]);

  useEffect(() => {
    const wasCollapsed = wasCollapsedRef.current;

    if (!wasCollapsed && collapsed) {
      persistMobileSidebarScrollTop(mobileScrollTopRef.current);
    }

    wasCollapsedRef.current = collapsed;
  }, [collapsed, persistMobileSidebarScrollTop]);

  const handleProjectListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      mobileScrollTopRef.current = normalizeMobileScrollTop(event.currentTarget.scrollTop);
    },
    [normalizeMobileScrollTop]
  );

  // Wrapper to close sidebar on mobile after minion selection
  const handleSelectMinion = useCallback(
    (selection: MinionSelection) => {
      onSelectMinion(selection);
      if (window.innerWidth <= MOBILE_BREAKPOINT && !collapsed) {
        persistMobileSidebarScrollTop(mobileScrollTopRef.current);
        onToggleCollapsed();
      }
    },
    [onSelectMinion, collapsed, onToggleCollapsed, persistMobileSidebarScrollTop]
  );

  // Wrapper to close sidebar on mobile after adding minion
  const handleAddMinion = useCallback(
    (projectPath: string, stageId?: string) => {
      createMinionDraft(projectPath, stageId);
      if (window.innerWidth <= MOBILE_BREAKPOINT && !collapsed) {
        persistMobileSidebarScrollTop(mobileScrollTopRef.current);
        onToggleCollapsed();
      }
    },
    [createMinionDraft, collapsed, onToggleCollapsed, persistMobileSidebarScrollTop]
  );

  // Wrapper to close sidebar on mobile after opening an existing draft
  const handleOpenMinionDraft = useCallback(
    (projectPath: string, draftId: string, stageId?: string | null) => {
      openMinionDraft(projectPath, draftId, stageId);
      if (window.innerWidth <= MOBILE_BREAKPOINT && !collapsed) {
        persistMobileSidebarScrollTop(mobileScrollTopRef.current);
        onToggleCollapsed();
      }
    },
    [openMinionDraft, collapsed, onToggleCollapsed, persistMobileSidebarScrollTop]
  );

  const handleOpenLatticeChat = useCallback(() => {
    // Read metadata imperatively from the store (no subscription) to avoid
    // making this callback depend on the metadata Map.
    const meta = minionStore.getMinionMetadata(LATTICE_HELP_CHAT_MINION_ID);

    handleSelectMinion(
      meta
        ? {
            minionId: meta.id,
            projectPath: meta.projectPath,
            projectName: meta.projectName,
            namedMinionPath: meta.namedMinionPath,
          }
        : {
            // Fallback: navigate by ID; metadata will fill in once refreshed.
            minionId: LATTICE_HELP_CHAT_MINION_ID,
            projectPath: "",
            projectName: "Lattice",
            namedMinionPath: "",
          }
    );

    if (!meta) {
      refreshMinionMetadata().catch((error) => {
        console.error("Failed to refresh minion metadata", error);
      });
    }
  }, [handleSelectMinion, refreshMinionMetadata, minionStore]);
  // Minion-specific subscriptions moved to MinionListItem component

  // Store as array in localStorage, convert to Set for usage
  const [expandedProjectsArray, setExpandedProjectsArray] = usePersistedState<string[]>(
    EXPANDED_PROJECTS_KEY,
    []
  );
  // Handle corrupted localStorage data (old Set stored as {}).
  // Use a plain array with .includes() instead of new Set() on every render —
  // the React Compiler cannot stabilize Set allocations (see AGENTS.md).
  // For typical sidebar sizes (< 20 projects) .includes() is equivalent perf.
  const expandedProjectsList = Array.isArray(expandedProjectsArray) ? expandedProjectsArray : [];

  // Track which projects have old minions expanded (per-project, per-tier)
  // Key format: getTierKey(projectPath, tierIndex) where tierIndex is 0, 1, 2 for 1/7/30 days
  const [expandedOldMinions, setExpandedOldMinions] = usePersistedState<
    Record<string, boolean>
  >("expandedOldMinions", {});

  // Track which stages are expanded
  const [expandedStages, setExpandedStages] = usePersistedState<Record<string, boolean>>(
    "expandedStages",
    {}
  );

  const [archivingMinionIds, setArchivingMinionIds] = useState<Set<string>>(new Set());
  const [removingMinionIds, setRemovingMinionIds] = useState<Set<string>>(new Set());
  const minionArchiveError = usePopoverError();
  const minionForkError = usePopoverError();
  const minionRemoveError = usePopoverError();
  const [archiveConfirmation, setArchiveConfirmation] = useState<{
    minionId: string;
    displayTitle: string;
    buttonElement?: HTMLElement;
  } | null>(null);
  const projectRemoveError = usePopoverError();
  const stageRemoveError = usePopoverError();
  const [secretsModalState, setSecretsModalState] = useState<{
    isOpen: boolean;
    projectPath: string;
    projectName: string;
    secrets: Secret[];
  } | null>(null);

  const getProjectName = (path: string) => {
    if (!path || typeof path !== "string") {
      return "Unknown";
    }
    return PlatformPaths.getProjectName(path);
  };

  // Use functional update to avoid stale closure issues when clicking rapidly
  const toggleProject = useCallback(
    (projectPath: string) => {
      setExpandedProjectsArray((prev) => {
        const prevSet = new Set(Array.isArray(prev) ? prev : []);
        if (prevSet.has(projectPath)) {
          prevSet.delete(projectPath);
        } else {
          prevSet.add(projectPath);
        }
        return Array.from(prevSet);
      });
    },
    [setExpandedProjectsArray]
  );

  const toggleStage = (projectPath: string, stageId: string) => {
    const key = getStageExpandedKey(projectPath, stageId);
    setExpandedStages((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCreateStage = async (projectPath: string, name: string) => {
    const result = await createStage(projectPath, name);
    if (result.success) {
      // Auto-expand the new stage
      const key = getStageExpandedKey(projectPath, result.data.id);
      setExpandedStages((prev) => ({ ...prev, [key]: true }));
    }
  };

  const handleForkMinion = useCallback(
    async (minionId: string, buttonElement?: HTMLElement) => {
      if (!api) {
        minionForkError.showError(minionId, "Not connected to server");
        return;
      }

      let anchor: { top: number; left: number } | undefined;
      if (buttonElement) {
        const rect = buttonElement.getBoundingClientRect();
        anchor = {
          top: rect.top + window.scrollY,
          left: rect.right + 10,
        };
      }

      try {
        const result = await forkMinion({
          client: api,
          sourceMinionId: minionId,
        });
        if (result.success) {
          return;
        }
        minionForkError.showError(minionId, result.error ?? "Failed to fork chat", anchor);
      } catch (error) {
        // IPC/transport failures throw instead of returning { success: false }
        const message = getErrorMessage(error);
        minionForkError.showError(minionId, message, anchor);
      }
    },
    [api, minionForkError]
  );

  const performArchiveMinion = useCallback(
    async (minionId: string, buttonElement?: HTMLElement) => {
      // Mark minion as being archived for UI feedback
      setArchivingMinionIds((prev) => new Set(prev).add(minionId));

      try {
        const result = await onArchiveMinion(minionId);
        if (!result.success) {
          const error = result.error ?? "Failed to archive chat";
          let anchor: { top: number; left: number } | undefined;
          if (buttonElement) {
            const rect = buttonElement.getBoundingClientRect();
            anchor = {
              top: rect.top + window.scrollY,
              left: rect.right + 10,
            };
          }
          minionArchiveError.showError(minionId, error, anchor);
        }
      } finally {
        // Clear archiving state
        setArchivingMinionIds((prev) => {
          const next = new Set(prev);
          next.delete(minionId);
          return next;
        });
      }
    },
    [onArchiveMinion, minionArchiveError]
  );

  const hasActiveStream = useCallback(
    (minionId: string) => {
      const aggregator = minionStore.getAggregator(minionId);
      if (!aggregator) return false;
      const hasActiveStreams = aggregator.getActiveStreams().length > 0;
      const isStarting = aggregator.getPendingStreamStartTime() !== null && !hasActiveStreams;
      const awaitingUserQuestion = aggregator.hasAwaitingUserQuestion();
      return (hasActiveStreams || isStarting) && !awaitingUserQuestion;
    },
    [minionStore]
  );

  const handleArchiveMinion = useCallback(
    async (minionId: string, buttonElement?: HTMLElement) => {
      if (hasActiveStream(minionId)) {
        // Read metadata imperatively (no subscription) to build the display title.
        const metadata = minionStore.getMinionMetadata(minionId);
        const displayTitle = metadata?.title ?? metadata?.name ?? minionId;
        // Confirm before archiving if a stream is active so users don't interrupt in-progress work.
        setArchiveConfirmation({ minionId, displayTitle, buttonElement });
        return;
      }

      await performArchiveMinion(minionId, buttonElement);
    },
    [hasActiveStream, performArchiveMinion, minionStore]
  );

  const handleArchiveMinionConfirm = useCallback(async () => {
    if (!archiveConfirmation) {
      return;
    }

    try {
      await performArchiveMinion(
        archiveConfirmation.minionId,
        archiveConfirmation.buttonElement
      );
    } finally {
      setArchiveConfirmation(null);
    }
  }, [archiveConfirmation, performArchiveMinion]);

  const handleArchiveMinionCancel = useCallback(() => {
    setArchiveConfirmation(null);
  }, []);

  const handleCancelMinionCreation = useCallback(
    async (minionId: string) => {
      // Give immediate UI feedback (spinner / disabled row) while deletion is in-flight.
      setRemovingMinionIds((prev) => new Set(prev).add(minionId));

      try {
        const result = await removeMinion(minionId, { force: true });
        if (!result.success) {
          minionRemoveError.showError(
            minionId,
            result.error ?? "Failed to cancel minion summoning"
          );
        }
      } finally {
        setRemovingMinionIds((prev) => {
          const next = new Set(prev);
          next.delete(minionId);
          return next;
        });
      }
    },
    [removeMinion, minionRemoveError]
  );

  const handleRemoveStage = async (
    projectPath: string,
    stageId: string,
    buttonElement: HTMLElement
  ) => {
    // removeStage unstages every minion in the project (including archived),
    // so confirmation needs to count from the full project config.
    const minionsInStage = (projects.get(projectPath)?.minions ?? []).filter(
      (minion) => minion.stageId === stageId
    );

    if (minionsInStage.length > 0) {
      const ok = await confirmDialog({
        title: "Delete stage?",
        description: `${minionsInStage.length} campaign(s) in this stage will be moved to unstaged.`,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
      });
      if (!ok) {
        return;
      }
    }

    const result = await removeStage(projectPath, stageId);
    if (!result.success) {
      const error = result.error ?? "Failed to remove stage";
      const rect = buttonElement.getBoundingClientRect();
      const anchor = {
        top: rect.top + window.scrollY,
        left: rect.right + 10,
      };
      stageRemoveError.showError(stageId, error, anchor);
    }
  };

  const handleOpenSecrets = async (projectPath: string) => {
    const secrets = await onGetSecrets(projectPath);
    setSecretsModalState({
      isOpen: true,
      projectPath,
      projectName: getProjectName(projectPath),
      secrets,
    });
  };

  const handleSaveSecrets = async (secrets: Secret[]) => {
    if (secretsModalState) {
      await onUpdateSecrets(secretsModalState.projectPath, secrets);
    }
  };

  const handleCloseSecrets = () => {
    setSecretsModalState(null);
  };

  // UI preference: project order persists in localStorage
  const [projectOrder, setProjectOrder] = usePersistedState<string[]>("lattice:projectOrder", []);

  // Build a stable signature of the project keys so effects don't fire on Map identity churn
  const projectPathsSignature = React.useMemo(() => {
    // sort to avoid order-related churn
    const keys = Array.from(projects.keys()).sort();
    return keys.join("\u0001"); // use non-printable separator
  }, [projects]);

  // Normalize order when the set of projects changes (not on every parent render)
  useEffect(() => {
    // Skip normalization if projects haven't loaded yet (empty Map on initial render)
    // This prevents clearing projectOrder before projects load from backend
    if (projects.size === 0) {
      return;
    }

    const normalized = normalizeOrder(projectOrder, projects);
    if (
      normalized.length !== projectOrder.length ||
      normalized.some((p, i) => p !== projectOrder[i])
    ) {
      setProjectOrder(normalized);
    }
    // Only re-run when project keys change (projectPathsSignature captures projects Map keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPathsSignature]);

  // Memoize sorted project PATHS (not entries) to avoid capturing stale config objects.
  // Sorting depends only on keys + order; we read configs from the live Map during render.
  const sortedProjectPaths = React.useMemo(
    () => sortProjectsByOrder(projects, projectOrder).map(([p]) => p),
    // projectPathsSignature captures projects Map keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectPathsSignature, projectOrder]
  );

  // Hide the built-in Chat with Lattice system project from the normal projects list.
  // We still render the lattice-chat minion as a dedicated pinned row above projects.
  // latticeChatProjectPath is pre-computed in App.tsx and passed as a prop so we don't
  // need to subscribe to the MinionMetadataContext here.
  const visibleProjectPaths = React.useMemo(
    () =>
      latticeChatProjectPath
        ? sortedProjectPaths.filter((projectPath) => projectPath !== latticeChatProjectPath)
        : sortedProjectPaths,
    [sortedProjectPaths, latticeChatProjectPath]
  );

  const handleReorder = useCallback(
    (draggedPath: string, targetPath: string) => {
      const next = reorderProjects(projectOrder, projects, draggedPath, targetPath);
      setProjectOrder(next);
    },
    [projectOrder, projects, setProjectOrder]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Create new minion for the project of the selected minion
      if (matchesKeybind(e, KEYBINDS.NEW_MINION) && selectedMinion) {
        e.preventDefault();
        if (selectedMinion.minionId === LATTICE_HELP_CHAT_MINION_ID) {
          return;
        }
        handleAddMinion(selectedMinion.projectPath);
      } else if (matchesKeybind(e, KEYBINDS.ARCHIVE_MINION) && selectedMinion) {
        e.preventDefault();
        void handleArchiveMinion(selectedMinion.minionId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedMinion, handleAddMinion, handleArchiveMinion]);

  return (
    <TitleEditProvider onUpdateTitle={onUpdateTitle}>
      <SidebarTitleEditKeybinds
        selectedMinion={selectedMinion ?? undefined}
        sortedMinionsByProject={sortedMinionsByProject}
        collapsed={collapsed}
      />
      <DndProvider backend={HTML5Backend}>
        <ProjectDragLayer />
        <MinionDragLayer />
        <StageDragLayer />
        <div
          className={cn(
            "font-primary bg-sidebar border-border-light flex flex-1 flex-col overflow-hidden border-r",
            // In desktop mode when collapsed, hide border (LeftSidebar handles the partial border)
            isDesktopMode() && collapsed && "border-r-0"
          )}
          role="navigation"
          aria-label="Projects"
        >
          {!collapsed && (
            <>
              {/* Building header — elevator panel branding */}
              <div className="border-dark border-b">
                <div className="flex items-center justify-between py-3 pr-3 pl-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      onClick={handleOpenLatticeChat}
                      className="shrink-0 cursor-pointer border-none bg-transparent p-0"
                      aria-label="Open Chat with Lattice"
                    >
                      <LatticeLogo className="h-5 w-[44px]" aria-hidden="true" />
                    </button>
                    {latticeChatProjectPath && (
                      <>
                        <LatticeChatHelpButton
                          onClick={handleOpenLatticeChat}
                          isSelected={selectedMinion?.minionId === LATTICE_HELP_CHAT_MINION_ID}
                        />
                        <LatticeChatStatusIndicator />
                      </>
                    )}
                  </div>
                  <button
                    onClick={onAddProject}
                    aria-label="Add project"
                    className="text-secondary hover:bg-hover hover:border-border-light flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border border-transparent bg-transparent px-1.5 text-xs transition-all duration-200"
                  >
                    <span className="text-base leading-none">+</span>
                    <span>Add Project</span>
                  </button>
                </div>
              </div>
              <div
                ref={projectListScrollRef}
                onScroll={handleProjectListScroll}
                className="flex-1 overflow-x-hidden overflow-y-auto"
              >
                {visibleProjectPaths.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <p className="text-muted mb-4 text-[13px]">No projects</p>
                    <button
                      onClick={onAddProject}
                      className="bg-accent hover:bg-accent-dark cursor-pointer rounded border-none px-4 py-2 text-[13px] text-white transition-colors duration-200"
                    >
                      Add Project
                    </button>
                  </div>
                ) : (
                  visibleProjectPaths.map((projectPath, projectIndex) => {
                    const config = projects.get(projectPath);
                    if (!config) return null;
                    const projectName = getProjectName(projectPath);
                    const sanitizedProjectId =
                      projectPath.replace(/[^a-zA-Z0-9_-]/g, "-") || "root";
                    const minionListId = `minion-list-${sanitizedProjectId}`;
                    const isExpanded = expandedProjectsList.includes(projectPath);
                    const floorNumber = visibleProjectPaths.length - projectIndex;

                    // Distinct color per floor — mirrors the stage color palette approach
                    const FLOOR_COLORS = [
                      "#5a9bd4", // Blue
                      "#d4a05a", // Amber
                      "#7dd47d", // Green
                      "#d465a5", // Pink
                      "#9580d4", // Purple
                      "#48b0a0", // Teal
                      "#d46565", // Red
                      "#64748b", // Slate
                    ];
                    const floorColor = FLOOR_COLORS[(floorNumber - 1) % FLOOR_COLORS.length];

                    return (
                      <div
                        key={projectPath}
                        className="flex last:border-b-0"
                        style={{ borderBottom: `2px dashed ${floorColor}30` }}
                      >
                        {/* Vertical floor tab strip — floor-colored */}
                        <button
                          onClick={() => toggleProject(projectPath)}
                          className="flex w-7 shrink-0 cursor-pointer items-center justify-center border-none py-3 transition-colors"
                          style={{
                            backgroundColor: `${floorColor}${isExpanded ? "20" : "10"}`,
                            borderRight: `2px solid ${floorColor}${isExpanded ? "80" : "40"}`,
                          }}
                        >
                          <span
                            className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.2em]"
                            style={{
                              writingMode: "vertical-rl",
                              textOrientation: "mixed",
                              transform: "rotate(180deg)",
                              color: floorColor,
                            }}
                          >
                            {floorNumber === 1 ? "First" : floorNumber === 2 ? "Second" : floorNumber === 3 ? "Third" : `${floorNumber}th`} Floor
                          </span>
                        </button>

                        {/* Content column */}
                        <div className="min-w-0 flex-1">
                        <DraggableProjectItem
                          projectPath={projectPath}
                          onReorder={handleReorder}
                          selected={false}
                          onClick={() => navigateToProject(projectPath)}
                          onKeyDown={(e: React.KeyboardEvent) => {
                            // Ignore key events from child buttons
                            if (e.target instanceof HTMLElement && e.target !== e.currentTarget) {
                              return;
                            }
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              navigateToProject(projectPath);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          aria-controls={minionListId}
                          aria-label={`Open workbench for ${projectName}`}
                          data-project-path={projectPath}
                        >
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleProject(projectPath);
                            }}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} project ${projectName}`}
                            data-project-path={projectPath}
                            className="text-secondary hover:bg-hover hover:border-border-light mr-1.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-transparent bg-transparent p-0 transition-all duration-200"
                          >
                            <ChevronRight
                              size={12}
                              className="transition-transform duration-200"
                              style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                            />
                          </button>
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-2">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="text-muted-dark flex min-w-0 gap-2 truncate text-sm">
                                  {(() => {
                                    const abbrevPath = PlatformPaths.abbreviate(projectPath);
                                    const { basename } = PlatformPaths.splitAbbreviated(abbrevPath);
                                    return (
                                      <span className="text-foreground truncate font-medium">
                                        {basename}
                                      </span>
                                    );
                                  })()}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent align="start">Floor {floorNumber} — {projectPath}</TooltipContent>
                            </Tooltip>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleOpenSecrets(projectPath);
                                }}
                                aria-label={`Manage secrets for ${projectName}`}
                                data-project-path={projectPath}
                                className="text-muted-dark mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-none bg-transparent text-sm opacity-0 transition-all duration-200 hover:bg-yellow-500/10 hover:text-yellow-500"
                              >
                                <KeyRound size={12} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent align="end">Manage secrets</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const buttonElement = event.currentTarget;
                                  void (async () => {
                                    const result = await onRemoveProject(projectPath);
                                    if (!result.success) {
                                      const error = result.error ?? "Failed to remove project";
                                      const rect = buttonElement.getBoundingClientRect();
                                      const anchor = {
                                        top: rect.top + window.scrollY,
                                        left: rect.right + 10,
                                      };
                                      projectRemoveError.showError(projectPath, error, anchor);
                                    }
                                  })();
                                }}
                                aria-label={`Remove project ${projectName}`}
                                data-project-path={projectPath}
                                className="text-muted-dark hover:text-danger-light hover:bg-danger-light/10 mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border-none bg-transparent text-base opacity-0 transition-all duration-200"
                              >
                                ×
                              </button>
                            </TooltipTrigger>
                            <TooltipContent align="end">Remove project</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleAddMinion(projectPath);
                                }}
                                aria-label={`Launch campaign in ${projectName}`}
                                data-project-path={projectPath}
                                className="text-secondary hover:bg-hover hover:border-border-light flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-transparent bg-transparent text-sm leading-none transition-all duration-200"
                              >
                                +
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Launch campaign ({formatKeybind(KEYBINDS.NEW_MINION)})
                            </TooltipContent>
                          </Tooltip>
                        </DraggableProjectItem>

                        {isExpanded && (
                          <div
                            id={minionListId}
                            role="region"
                            aria-label={`Campaigns for ${projectName}`}
                            className="pt-1"
                            style={{ backgroundColor: `${floorColor}08` }}
                          >
                            {(() => {
                              // Archived minions are excluded from minionMetadata so won't appear here

                              const allMinions =
                                sortedMinionsByProject.get(projectPath) ?? [];

                              const draftsForProject = minionDraftsByProject[projectPath] ?? [];
                              const activeDraftIds = new Set(
                                draftsForProject.map((draft) => draft.draftId)
                              );
                              const draftPromotionsForProject =
                                minionDraftPromotionsByProject[projectPath] ?? {};
                              const activeDraftPromotions = Object.fromEntries(
                                Object.entries(draftPromotionsForProject).filter(([draftId]) =>
                                  activeDraftIds.has(draftId)
                                )
                              );
                              const promotedMinionIds = new Set(
                                Object.values(activeDraftPromotions).map((metadata) => metadata.id)
                              );
                              const minionsForNormalRendering = allMinions.filter(
                                (minion) => !promotedMinionIds.has(minion.id)
                              );
                              const stages = sortStagesByLinkedList(config.stages ?? []);
                              const depthByMinionId = computeMinionDepthMap(allMinions);
                              const sortedDrafts = draftsForProject
                                .slice()
                                .sort((a, b) => b.createdAt - a.createdAt);
                              const draftNumberById = new Map(
                                sortedDrafts.map(
                                  (draft, index) => [draft.draftId, index + 1] as const
                                )
                              );
                              const stageIds = new Set(stages.map(stage => stage.id));
                              const normalizeDraftStageId = (
                                draft: (typeof sortedDrafts)[number]
                              ): string | null => {
                                return typeof draft.stageId === "string" &&
                                  stageIds.has(draft.stageId)
                                  ? draft.stageId
                                  : null;
                              };

                              // Drafts can reference a stage that has since been deleted.
                              // Treat those as unstaged so they remain accessible.
                              const unstagedDrafts: typeof sortedDrafts = [];
                              const draftsByStageId = new Map<string, typeof sortedDrafts>();
                              for (const draft of sortedDrafts) {
                                const stageId = normalizeDraftStageId(draft);
                                if (stageId === null) {
                                  unstagedDrafts.push(draft);
                                  continue;
                                }

                                const existing = draftsByStageId.get(stageId);
                                if (existing) {
                                  existing.push(draft);
                                } else {
                                  draftsByStageId.set(stageId, [draft]);
                                }
                              }

                              const renderMinion = (
                                metadata: FrontendMinionMetadata,
                                stageId?: string
                              ) => (
                                <MinionListItem
                                  key={metadata.id}
                                  metadata={metadata}
                                  projectPath={projectPath}
                                  projectName={projectName}
                                  isSelected={selectedMinion?.minionId === metadata.id}
                                  isArchiving={archivingMinionIds.has(metadata.id)}
                                  isRemoving={
                                    removingMinionIds.has(metadata.id) ||
                                    metadata.isRemoving === true
                                  }
                                  onSelectMinion={handleSelectMinion}
                                  onForkMinion={handleForkMinion}
                                  onArchiveMinion={handleArchiveMinion}
                                  onCancelCreation={handleCancelMinionCreation}
                                  depth={depthByMinionId[metadata.id] ?? 0}
                                  stageId={stageId}
                                />
                              );

                              const renderDraft = (
                                draft: (typeof sortedDrafts)[number]
                              ): React.ReactNode => {
                                const stageId = normalizeDraftStageId(draft);
                                const promotedMetadata = activeDraftPromotions[draft.draftId];

                                if (promotedMetadata) {
                                  const liveMetadata =
                                    allMinions.find(
                                      (minion) => minion.id === promotedMetadata.id
                                    ) ?? promotedMetadata;
                                  return renderMinion(liveMetadata, stageId ?? undefined);
                                }

                                const draftNumber = draftNumberById.get(draft.draftId) ?? 0;
                                const isSelected =
                                  pendingNewMinionProject === projectPath &&
                                  pendingNewMinionDraftId === draft.draftId;

                                return (
                                  <DraftMinionListItemWrapper
                                    key={draft.draftId}
                                    projectPath={projectPath}
                                    draftId={draft.draftId}
                                    draftNumber={draftNumber}
                                    isSelected={isSelected}
                                    onOpen={() =>
                                      handleOpenMinionDraft(
                                        projectPath,
                                        draft.draftId,
                                        stageId
                                      )
                                    }
                                    onDelete={() => {
                                      if (isSelected) {
                                        const currentIndex = sortedDrafts.findIndex(
                                          (d) => d.draftId === draft.draftId
                                        );
                                        const fallback =
                                          currentIndex >= 0
                                            ? (sortedDrafts[currentIndex + 1] ??
                                              sortedDrafts[currentIndex - 1])
                                            : undefined;

                                        if (fallback) {
                                          openMinionDraft(
                                            projectPath,
                                            fallback.draftId,
                                            normalizeDraftStageId(fallback)
                                          );
                                        } else {
                                          navigateToProject(projectPath, stageId ?? undefined);
                                        }
                                      }

                                      deleteMinionDraft(projectPath, draft.draftId);
                                    }}
                                  />
                                );
                              };

                              // Render age tiers for a list of minions
                              const renderAgeTiers = (
                                minions: FrontendMinionMetadata[],
                                tierKeyPrefix: string,
                                stageId?: string
                              ): React.ReactNode => {
                                const { recent, buckets } = partitionMinionsByAge(
                                  minions,
                                  minionRecency
                                );

                                const renderTier = (tierIndex: number): React.ReactNode => {
                                  const bucket = buckets[tierIndex];
                                  const remainingCount = buckets
                                    .slice(tierIndex)
                                    .reduce((sum, b) => sum + b.length, 0);

                                  if (remainingCount === 0) return null;

                                  const tierKey = `${tierKeyPrefix}:${tierIndex}`;
                                  const isTierExpanded = expandedOldMinions[tierKey] ?? false;
                                  const thresholdDays = AGE_THRESHOLDS_DAYS[tierIndex];
                                  const thresholdLabel = formatDaysThreshold(thresholdDays);
                                  const displayCount = isTierExpanded
                                    ? bucket.length
                                    : remainingCount;

                                  return (
                                    <React.Fragment key={tierKey}>
                                      <button
                                        onClick={() => {
                                          setExpandedOldMinions((prev) => ({
                                            ...prev,
                                            [tierKey]: !prev[tierKey],
                                          }));
                                        }}
                                        aria-label={
                                          isTierExpanded
                                            ? `Collapse minions older than ${thresholdLabel}`
                                            : `Expand minions older than ${thresholdLabel}`
                                        }
                                        aria-expanded={isTierExpanded}
                                        className="text-muted border-hover hover:text-label [&:hover_.arrow]:text-label flex w-full cursor-pointer items-center justify-between border-t border-none bg-transparent px-3 py-2 pl-[22px] text-xs font-medium transition-all duration-150 hover:bg-white/[0.03]"
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <span>Older than {thresholdLabel}</span>
                                          <span className="text-dim font-normal">
                                            ({displayCount})
                                          </span>
                                        </div>
                                        <span
                                          className="arrow text-dim text-[11px] transition-transform duration-200 ease-in-out"
                                          style={{
                                            transform: isTierExpanded
                                              ? "rotate(90deg)"
                                              : "rotate(0deg)",
                                          }}
                                        >
                                          <ChevronRight size={12} />
                                        </span>
                                      </button>
                                      {isTierExpanded && (
                                        <>
                                          {bucket.map((ws) => renderMinion(ws, stageId))}
                                          {(() => {
                                            const nextTier = findNextNonEmptyTier(
                                              buckets,
                                              tierIndex + 1
                                            );
                                            return nextTier !== -1 ? renderTier(nextTier) : null;
                                          })()}
                                        </>
                                      )}
                                    </React.Fragment>
                                  );
                                };

                                const firstTier = findNextNonEmptyTier(buckets, 0);

                                return (
                                  <>
                                    {recent.map((ws) => renderMinion(ws, stageId))}
                                    {firstTier !== -1 && renderTier(firstTier)}
                                  </>
                                );
                              };

                              // Partition minions by stage
                              const { unstaged, byStageId } = partitionMinionsByStage(
                                minionsForNormalRendering,
                                stages
                              );

                              // Handle minion drop into stage
                              const handleMinionStageDrop = (
                                minionId: string,
                                targetStageId: string | null
                              ) => {
                                void (async () => {
                                  const result = await assignMinionToStage(
                                    projectPath,
                                    minionId,
                                    targetStageId
                                  );
                                  if (result.success) {
                                    // Refresh minion metadata so UI shows updated stageId
                                    await refreshMinionMetadata();
                                  }
                                })();
                              };

                              // Handle stage reorder (drag stage onto another stage)
                              const handleStageReorder = (
                                draggedStageId: string,
                                targetStageId: string
                              ) => {
                                void (async () => {
                                  // Compute new order: move dragged stage to position of target
                                  const currentOrder = stages.map((s) => s.id);
                                  const draggedIndex = currentOrder.indexOf(draggedStageId);
                                  const targetIndex = currentOrder.indexOf(targetStageId);

                                  if (draggedIndex === -1 || targetIndex === -1) return;

                                  // Remove dragged from current position
                                  const newOrder = [...currentOrder];
                                  newOrder.splice(draggedIndex, 1);
                                  // Insert at target position
                                  newOrder.splice(targetIndex, 0, draggedStageId);

                                  await reorderStages(projectPath, newOrder);
                                })();
                              };

                              return (
                                <>
                                  {/* Unstaged minions first - always show drop zone when stages exist */}
                                  {stages.length > 0 ? (
                                    <MinionStageDropZone
                                      projectPath={projectPath}
                                      stageId={null}
                                      onDrop={handleMinionStageDrop}
                                      testId="unstaged-drop-zone"
                                    >
                                      {unstagedDrafts.map((draft) => renderDraft(draft))}
                                      {unstaged.length > 0 ? (
                                        renderAgeTiers(
                                          unstaged,
                                          getTierKey(projectPath, 0).replace(":0", "")
                                        )
                                      ) : unstagedDrafts.length === 0 ? (
                                        <div className="text-muted px-3 py-2 text-center text-xs italic">
                                          No unstaged minions
                                        </div>
                                      ) : null}
                                    </MinionStageDropZone>
                                  ) : (
                                    <>
                                      {unstagedDrafts.map((draft) => renderDraft(draft))}
                                      {unstaged.length > 0 &&
                                        renderAgeTiers(
                                          unstaged,
                                          getTierKey(projectPath, 0).replace(":0", "")
                                        )}
                                    </>
                                  )}

                                  {/* Stages */}
                                  {stages.map((stage) => {
                                    const stageMinions = byStageId.get(stage.id) ?? [];
                                    const stageDrafts = draftsByStageId.get(stage.id) ?? [];
                                    const stageExpandedKey = getStageExpandedKey(projectPath, stage.id);
                                    const isStageExpanded = expandedStages[stageExpandedKey] ?? true;

                                    return (
                                      <DraggableStage
                                        key={stage.id}
                                        stageId={stage.id}
                                        stageName={stage.name}
                                        projectPath={projectPath}
                                        onReorder={handleStageReorder}
                                      >
                                        <MinionStageDropZone
                                          projectPath={projectPath}
                                          stageId={stage.id}
                                          onDrop={handleMinionStageDrop}
                                        >
                                          <StageHeader
                                            stage={stage}
                                            isExpanded={isStageExpanded}
                                            minionCount={stageMinions.length + stageDrafts.length}
                                            onToggleExpand={() => toggleStage(projectPath, stage.id)}
                                            onAddMinion={() => handleAddMinion(projectPath, stage.id)}
                                            onRename={(name) => { void updateStage(projectPath, stage.id, { name }); }}
                                            onChangeColor={(color) => { void updateStage(projectPath, stage.id, { color }); }}
                                            onDelete={(e) => { void handleRemoveStage(projectPath, stage.id, e.currentTarget); }}
                                          />
                                          {isStageExpanded && (
                                            <div className="pb-1 pl-2">
                                              {stageDrafts.map((draft) => renderDraft(draft))}
                                              {stageMinions.length > 0 ? (
                                                renderAgeTiers(
                                                  stageMinions,
                                                  getStageTierKey(projectPath, stage.id, 0).replace(
                                                    ":tier:0",
                                                    ":tier"
                                                  ),
                                                  stage.id
                                                )
                                              ) : stageDrafts.length === 0 ? (
                                                <div className="text-muted px-3 py-2 text-center text-xs italic">
                                                  No minions in this stage
                                                </div>
                                              ) : null}
                                            </div>
                                          )}
                                        </MinionStageDropZone>
                                      </DraggableStage>
                                    );
                                  })}

                                  {/* Add Stage button */}
                                  <AddStageButton
                                    onCreateStage={(name) => {
                                      void handleCreateStage(projectPath, name);
                                    }}
                                  />
                                </>
                              );
                            })()}
                          </div>
                        )}
                        </div>{/* end content column */}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
          {/* Collapse toggle — when expanded, sits in a bottom bar; when collapsed, fills the sidebar */}
          {collapsed ? (
            <SidebarCollapseButton
              collapsed={collapsed}
              onToggle={onToggleCollapsed}
              side="left"
              shortcut={formatKeybind(KEYBINDS.TOGGLE_SIDEBAR)}
            />
          ) : (
            <div className="border-border-light flex shrink-0 items-center justify-center border-t py-1.5">
              <SidebarCollapseButton
                collapsed={collapsed}
                onToggle={onToggleCollapsed}
                side="left"
                shortcut={formatKeybind(KEYBINDS.TOGGLE_SIDEBAR)}
              />
            </div>
          )}
          {secretsModalState && (
            <SecretsModal
              isOpen={secretsModalState.isOpen}
              projectPath={secretsModalState.projectPath}
              projectName={secretsModalState.projectName}
              initialSecrets={secretsModalState.secrets}
              onClose={handleCloseSecrets}
              onSave={handleSaveSecrets}
            />
          )}
          <ConfirmationModal
            isOpen={archiveConfirmation !== null}
            title={
              archiveConfirmation
                ? `Archive "${archiveConfirmation.displayTitle}" while streaming?`
                : "Archive chat?"
            }
            description="This minion is currently streaming a response."
            warning="Archiving will interrupt the active stream."
            confirmLabel="Archive"
            onConfirm={handleArchiveMinionConfirm}
            onCancel={handleArchiveMinionCancel}
          />
          <PopoverError
            error={minionArchiveError.error}
            prefix="Failed to archive chat"
            onDismiss={minionArchiveError.clearError}
          />
          <PopoverError
            error={minionForkError.error}
            prefix="Failed to fork chat"
            onDismiss={minionForkError.clearError}
          />
          <PopoverError
            error={minionRemoveError.error}
            prefix="Failed to cancel minion summoning"
            onDismiss={minionRemoveError.clearError}
          />
          <PopoverError
            error={projectRemoveError.error}
            prefix="Failed to remove project"
            onDismiss={projectRemoveError.clearError}
          />
          <PopoverError
            error={stageRemoveError.error}
            prefix="Failed to remove stage"
            onDismiss={stageRemoveError.clearError}
          />
        </div>
      </DndProvider>
    </TitleEditProvider>
  );
};

// Memoize to prevent re-renders when props haven't changed
const ProjectSidebar = React.memo(ProjectSidebarInner);

export default ProjectSidebar;
