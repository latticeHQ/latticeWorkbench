import React from "react";
import { cn } from "@/common/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import type { TabType } from "@/browser/types/rightSidebar";
import { isDesktopMode } from "@/browser/hooks/useDesktopTitlebar";
import { SettingsButton } from "../SettingsButton";
import {
  CircleDollarSign,
  GitPullRequest,
  FolderOpen,
  Network,
  Database,
  Globe,
  Activity,
  SquareTerminal,
  FileCode,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";

// Re-export for consumers that import from this file
export { getTabName } from "./tabs";

/** Data attached to dragged sidebar tabs */
export interface TabDragData {
  tab: TabType;
  sourceTabsetId: string;
  index: number;
}

export interface RightSidebarTabStripItem {
  id: string;
  panelId: string;
  selected: boolean;
  onSelect: () => void;
  label: React.ReactNode;
  tooltip: React.ReactNode;
  disabled?: boolean;
  /** The tab type (used for drag identification) */
  tab: TabType;
  /** Optional callback to close this tab (for closeable tabs like terminals) */
  onClose?: () => void;
}

interface RightSidebarTabStripProps {
  items: RightSidebarTabStripItem[];
  ariaLabel?: string;
  /** Unique ID of this tabset (for drag/drop) */
  tabsetId: string;
  /** Whether the parent sidebar is currently collapsed */
  collapsed?: boolean;
  /** Callback to toggle the collapsed state of the sidebar */
  onCollapseToggle?: () => void;
}

/** Icon for each tab type */
function getTabIcon(tab: TabType): React.ReactNode {
  if (tab === "costs") return <CircleDollarSign className="h-[18px] w-[18px]" />;
  if (tab === "review") return <GitPullRequest className="h-[18px] w-[18px]" />;
  if (tab === "explorer") return <FolderOpen className="h-[18px] w-[18px]" />;
  if (tab === "cluster") return <Network className="h-[18px] w-[18px]" />;
  if (tab === "models") return <Database className="h-[18px] w-[18px]" />;
  if (tab === "browser") return <Globe className="h-[18px] w-[18px]" />;
  if (tab === "stats") return <Activity className="h-[18px] w-[18px]" />;
  if (typeof tab === "string" && tab.startsWith("terminal:"))
    return <SquareTerminal className="h-[18px] w-[18px]" />;
  if (typeof tab === "string" && tab.startsWith("file:"))
    return <FileCode className="h-[18px] w-[18px]" />;
  return <LayoutGrid className="h-[18px] w-[18px]" />;
}

/** Short label for vertical display (max ~7 chars for the narrow strip) */
function getTabShortLabel(tab: TabType): string {
  if (tab === "costs") return "Costs";
  if (tab === "review") return "Review";
  if (tab === "explorer") return "Files";
  if (tab === "cluster") return "Cluster";
  if (tab === "models") return "Models";
  if (tab === "browser") return "Browser";
  if (tab === "stats") return "Stats";
  if (typeof tab === "string" && tab.startsWith("terminal:")) return "Term";
  if (typeof tab === "string" && tab.startsWith("file:")) {
    const path = tab.slice("file:".length);
    const filename = path.split("/").pop() ?? "File";
    return filename.length > 6 ? filename.slice(0, 5) + "…" : filename;
  }
  return "Tab";
}

/**
 * Individual sortable tab in a vertical activity-bar layout.
 * Shows an icon + tiny label; active state uses a left accent rule.
 */
const SortableTab: React.FC<{
  item: RightSidebarTabStripItem;
  index: number;
  tabsetId: string;
}> = ({ item, index, tabsetId }) => {
  const sortableId = `${tabsetId}:${item.tab}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: {
      tab: item.tab,
      sourceTabsetId: tabsetId,
      index,
    } satisfies TabDragData,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const icon = getTabIcon(item.tab);
  const shortLabel = getTabShortLabel(item.tab);
  const sortableOnKeyDown = listeners?.onKeyDown;

  return (
    <div className="group/tab relative w-full" style={style}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...(listeners ?? {})}
            className={cn(
              // Icon-only button — centered, no text label
              "relative flex w-full cursor-pointer items-center justify-center rounded-md p-2 touch-none",
              "transition-colors duration-150",
              // Active: accent left rule + slightly lighter background
              item.selected
                ? "text-foreground bg-hover before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[2px] before:rounded-full before:bg-accent"
                : "text-muted hover:bg-hover/40 hover:text-foreground",
              item.disabled && "pointer-events-none opacity-40",
              isDragging && "opacity-40",
            )}
            onClick={item.onSelect}
            onKeyDown={(e) => {
              // Ignore bubbled key events from nested elements
              if (e.currentTarget !== e.target) return;
              sortableOnKeyDown?.(e);
              if (e.defaultPrevented) return;
              if (!item.disabled && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                item.onSelect();
              }
            }}
            onAuxClick={(e) => {
              // Middle-click closes closeable tabs
              if (e.button === 1 && item.onClose) {
                e.preventDefault();
                item.onClose();
              }
            }}
            id={item.id}
            role="tab"
            aria-selected={item.selected}
            aria-controls={item.panelId}
            aria-disabled={item.disabled ? true : undefined}
            tabIndex={item.disabled ? -1 : (attributes.tabIndex ?? 0)}
          >
            {icon}
          </div>
        </TooltipTrigger>
        {/* Tooltip on the left — points into the content area */}
        <TooltipContent side="left" align="center">
          {item.tooltip ?? shortLabel}
        </TooltipContent>
      </Tooltip>

      {/* Close button — appears on hover for closeable tabs (files, terminals) */}
      {item.onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            item.onClose!();
          }}
          aria-label="Close tab"
          className="absolute top-0.5 right-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded-sm bg-sidebar text-muted hover:text-foreground group-hover/tab:flex"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
};

/**
 * Vertical activity-bar tab strip that sits on the LEFT edge of the right sidebar.
 * Tabs are stacked vertically (icon + short label); Settings lives at the bottom.
 * This replaces the old horizontal top-strip layout.
 */
export const RightSidebarTabStrip: React.FC<RightSidebarTabStripProps> = ({
  items,
  ariaLabel = "Sidebar views",
  tabsetId,
  collapsed,
  onCollapseToggle,
}) => {
  const { active } = useDndContext();
  const activeData = active?.data.current as TabDragData | undefined;

  const isDraggingFromHere = activeData?.sourceTabsetId === tabsetId;

  // Make the strip a drop target for tabs dragged from other tabsets
  const { setNodeRef, isOver } = useDroppable({
    id: `tabstrip:${tabsetId}`,
    data: { tabsetId },
  });

  const canDrop = activeData !== undefined && activeData.sourceTabsetId !== tabsetId;
  const showDropHighlight = isOver && canDrop;

  const isDesktop = isDesktopMode();

  // Clicking a tab icon toggles the sidebar:
  //  - While collapsed → expand and select the tab
  //  - While expanded and the tab is already active → collapse
  //  - Otherwise → just select the tab (normal)
  const expandingItems = onCollapseToggle
    ? items.map((item) => ({
        ...item,
        onSelect: () => {
          if (collapsed) {
            onCollapseToggle();
            item.onSelect();
          } else if (item.selected) {
            onCollapseToggle();
          } else {
            item.onSelect();
          }
        },
      }))
    : items;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Vertical strip — narrow icon-only column on the right edge of the sidebar
        "bg-sidebar flex w-10 shrink-0 flex-col items-center px-1 py-2 transition-colors",
        showDropHighlight && "bg-accent/20",
        isDraggingFromHere && "bg-accent/10",
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      {/* Tab buttons stacked vertically */}
      <div className="flex w-full flex-1 flex-col items-center gap-0.5">
        {expandingItems.map((item, index) => (
          <SortableTab key={item.id} item={item} index={index} tabsetId={tabsetId} />
        ))}
      </div>

      {/* Settings pinned to bottom of the activity bar */}
      <div className={cn("mt-1 shrink-0", isDesktop && "titlebar-no-drag")}>
        <SettingsButton className="h-8 w-8 rounded-md" />
      </div>

      {/* Collapse / expand toggle at very bottom */}
      {onCollapseToggle && (
        <div className="mt-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onCollapseToggle}
                className="text-muted hover:bg-hover/40 hover:text-foreground relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-md p-2 transition-colors duration-150"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <PanelRightOpen className="h-[18px] w-[18px]" />
                ) : (
                  <PanelRightClose className="h-[18px] w-[18px]" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" align="center">
              {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
};
