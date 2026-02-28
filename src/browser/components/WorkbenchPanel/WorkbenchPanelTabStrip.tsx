import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/common/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable, useDndContext } from "@dnd-kit/core";
import { BarChart3, ChevronDown, Plus, Terminal } from "lucide-react";
import type { TabType } from "@/browser/types/workbenchPanel";
import { isDesktopMode, DESKTOP_TITLEBAR_HEIGHT_CLASS } from "@/browser/hooks/useDesktopTitlebar";

// Re-export for consumers that import from this file
export { getTabName } from "./tabs";

/** Data attached to dragged sidebar tabs */
export interface TabDragData {
  tab: TabType;
  sourceTabsetId: string;
  index: number;
}

/** Minimal profile info needed by the "+" dropdown */
export interface TerminalProfileItem {
  id: string;
  displayName: string;
  installed: boolean;
  group: "platform" | "community";
}

export interface WorkbenchPanelTabStripItem {
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

interface WorkbenchPanelTabStripProps {
  items: WorkbenchPanelTabStripItem[];
  ariaLabel?: string;
  /** Unique ID of this tabset (for drag/drop) */
  tabsetId: string;
  /** Called when user clicks the "+" button to add a new default terminal */
  onAddTerminal?: () => void;
  /**
   * Called when user selects a profile from the "+" dropdown.
   * Receives the profile ID and display name for the terminal to spawn.
   */
  onAddProfileTerminal?: (profileId: string, profileName: string) => void;
  /** Enabled + installed terminal profiles to show in the "+" dropdown */
  terminalProfiles?: TerminalProfileItem[];
  /** Called when user clicks the analytics button to open the analytics dashboard */
  onOpenAnalytics?: () => void;
}

/**
 * Individual sortable tab button using @dnd-kit.
 * Uses useSortable for drag + drop within the same tabset.
 */
const SortableTab: React.FC<{
  item: WorkbenchPanelTabStripItem;
  index: number;
  tabsetId: string;
  isDesktop: boolean;
}> = ({ item, index, tabsetId, isDesktop }) => {
  // Create a unique sortable ID that encodes tabset + tab
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

  const sortableOnKeyDown = listeners?.onKeyDown;

  return (
    <div className={cn("relative shrink-0", isDesktop && "titlebar-no-drag")} style={style}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...(listeners ?? {})}
            className={cn(
              "flex min-w-0 max-w-[240px] items-baseline gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all duration-150",
              "cursor-grab touch-none active:cursor-grabbing",
              item.selected
                ? "bg-hover text-foreground"
                : "bg-transparent text-muted hover:bg-hover/50 hover:text-foreground",
              item.disabled && "pointer-events-none opacity-50",
              isDragging && "cursor-grabbing opacity-50"
            )}
            onClick={item.onSelect}
            onKeyDown={(e) => {
              // Ignore bubbled key events from nested elements (e.g. close/pop-out buttons)
              // so Enter/Space still activates those buttons instead of selecting the tab.
              if (e.currentTarget !== e.target) {
                return;
              }

              sortableOnKeyDown?.(e);
              if (e.defaultPrevented) {
                return;
              }

              if (!item.disabled && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                item.onSelect();
              }
            }}
            onAuxClick={(e) => {
              // Middle-click (button 1) closes closeable tabs
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
            {item.label}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center">
          {item.tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export const WorkbenchPanelTabStrip: React.FC<WorkbenchPanelTabStripProps> = ({
  items,
  ariaLabel = "Sidebar views",
  tabsetId,
  onAddTerminal,
  onAddProfileTerminal,
  terminalProfiles,
  onOpenAnalytics,
}) => {
  const { active } = useDndContext();
  const activeData = active?.data.current as TabDragData | undefined;

  // Track if we're dragging from this tabset (for visual feedback)
  const isDraggingFromHere = activeData?.sourceTabsetId === tabsetId;

  // Make the tabstrip a drop target for tabs from OTHER tabsets
  const { setNodeRef, isOver } = useDroppable({
    id: `tabstrip:${tabsetId}`,
    data: { tabsetId },
  });

  const canDrop = activeData !== undefined && activeData.sourceTabsetId !== tabsetId;
  const showDropHighlight = isOver && canDrop;

  // In desktop mode, add right padding for Windows/Linux titlebar overlay buttons
  const isDesktop = isDesktopMode();

  // Determine if we should show the profile dropdown or just the simple "+" button.
  // Show dropdown when there are enabled + installed profiles to pick from.
  const enabledProfiles = terminalProfiles?.filter((p) => p.installed) ?? [];
  const showProfileDropdown = enabledProfiles.length > 0 && onAddProfileTerminal != null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Use same fixed height as TitleBar and MinionMenuBar for consistent panel headers
        "border-border-light titlebar-safe-right titlebar-safe-right-gutter-2 flex min-w-0 items-center border-b px-2 transition-colors",
        isDesktop ? DESKTOP_TITLEBAR_HEIGHT_CLASS : "h-8",
        showDropHighlight && "bg-accent/30",
        isDraggingFromHere && "bg-accent/10",
        // In desktop mode, make header draggable for window movement
        isDesktop && "titlebar-drag"
      )}
      role="tablist"
      aria-label={ariaLabel}
    >
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {items.map((item, index) => (
          <SortableTab
            key={item.id}
            item={item}
            index={index}
            tabsetId={tabsetId}
            isDesktop={isDesktop}
          />
        ))}
      </div>
      {/* Action buttons sit outside the scrollable tab area so they're always visible
          and their dropdowns aren't clipped by overflow-x-auto. */}
      {onAddTerminal && showProfileDropdown && (
        <AddTerminalDropdown
          isDesktop={isDesktop}
          onAddDefault={onAddTerminal}
          onAddProfile={onAddProfileTerminal}
          profiles={enabledProfiles}
        />
      )}
      {onAddTerminal && !showProfileDropdown && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                "text-muted hover:bg-hover hover:text-foreground shrink-0 rounded-md p-1 transition-colors",
                isDesktop && "titlebar-no-drag"
              )}
              onClick={onAddTerminal}
              aria-label="New terminal"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">New terminal</TooltipContent>
        </Tooltip>
      )}
      {onOpenAnalytics && (
        <button
          type="button"
          className={cn(
            "text-muted hover:bg-hover hover:text-foreground flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
            isDesktop && "titlebar-no-drag"
          )}
          onClick={onOpenAnalytics}
          aria-label="Open analytics"
        >
          <BarChart3 className="h-3 w-3" />
          Analytics
        </button>
      )}
    </div>
  );
};

/**
 * "+" button with dropdown for selecting terminal profiles.
 * Uses conditional rendering (not Radix Portal) for happy-dom testability.
 */
const AddTerminalDropdown: React.FC<{
  isDesktop: boolean;
  onAddDefault: () => void;
  onAddProfile: (profileId: string, profileName: string) => void;
  profiles: TerminalProfileItem[];
}> = ({ isDesktop, onAddDefault, onAddProfile, profiles }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    // Close on Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "text-muted hover:bg-hover hover:text-foreground flex shrink-0 items-center gap-0.5 rounded-md p-1 transition-colors",
              isDesktop && "titlebar-no-drag",
              isOpen && "bg-hover text-foreground"
            )}
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label="New terminal"
            aria-expanded={isOpen}
            aria-haspopup="menu"
          >
            <Plus className="h-3.5 w-3.5" />
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        </TooltipTrigger>
        {!isOpen && <TooltipContent side="bottom">New terminal</TooltipContent>}
      </Tooltip>

      {/* Inline dropdown menu — uses conditional rendering for testability */}
      {isOpen && (
        <div
          className="border-border-medium bg-background-secondary absolute top-full right-0 z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border shadow-lg"
          role="menu"
        >
          {/* Default terminal option */}
          <button
            type="button"
            className="hover:bg-hover text-foreground flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
            role="menuitem"
            onClick={() => {
              onAddDefault();
              setIsOpen(false);
            }}
          >
            <Terminal className="text-muted h-3.5 w-3.5 shrink-0" />
            Default Terminal
          </button>

          {/* Grouped profile items */}
          {(["platform", "community"] as const).map((group) => {
            const groupProfiles = profiles.filter((p) => p.group === group);
            if (groupProfiles.length === 0) return null;
            const label = group === "platform" ? "Platform" : "Community";
            return (
              <div key={group}>
                <div className="bg-border-medium my-0.5 h-px" />
                <div className="text-muted px-3 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wider uppercase">
                  {label}
                </div>
                {groupProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="hover:bg-hover text-foreground flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
                    role="menuitem"
                    onClick={() => {
                      onAddProfile(profile.id, profile.displayName);
                      setIsOpen(false);
                    }}
                  >
                    <div className="bg-success h-2 w-2 shrink-0 rounded-full" title="Installed" />
                    {profile.displayName}
                  </button>
                ))}
              </div>
            );
          })}

          {/* Divider + Manage link */}
          <div className="bg-border-medium my-0.5 h-px" />
          <ManageProfilesButton onClose={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
};

/**
 * "Manage Profiles..." link at the bottom of the dropdown — dispatches a
 * custom event to open Settings at the terminal-profiles crew. This keeps
 * the TabStrip decoupled from SettingsContext (avoids circular deps).
 */
function ManageProfilesButton(props: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="text-muted hover:bg-hover hover:text-foreground flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
      role="menuitem"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("lattice:open-settings", {
            detail: { section: "terminal-profiles" },
          })
        );
        props.onClose();
      }}
    >
      Manage Profiles...
    </button>
  );
}
