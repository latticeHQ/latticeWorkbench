import React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

interface SidebarCollapseButtonProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Direction the sidebar expands toward (left sidebar expands right, workbench panel expands left) */
  side: "left" | "right";
  /** Optional keyboard shortcut to show in tooltip */
  shortcut?: string;
}

/**
 * Collapse/expand toggle button for sidebars.
 * Renders at the bottom of the sidebar with « » chevrons.
 */
export const SidebarCollapseButton: React.FC<SidebarCollapseButtonProps> = ({
  collapsed,
  onToggle,
  side,
  shortcut,
}) => {
  // Left sidebar: collapsed shows », expanded shows «
  // workbench panel: collapsed shows «, expanded shows »
  const chevron = side === "left" ? (collapsed ? "»" : "«") : collapsed ? "«" : "»";

  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onToggle}
          aria-label={label}
          className={
            collapsed
              ? // Collapsed: fill remaining height, large click target
                "text-muted hover:bg-hover hover:text-foreground flex w-full flex-1 cursor-pointer items-center justify-center bg-transparent p-0 text-sm transition-all duration-200"
              : // Expanded: visible pill button pinned at sidebar bottom
                "text-muted border-border hover:bg-hover hover:text-foreground flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border bg-transparent text-xs transition-all duration-200"
          }
        >
          {chevron}
        </button>
      </TooltipTrigger>
      <TooltipContent align="center">
        {label}
        {shortcut && ` (${shortcut})`}
      </TooltipContent>
    </Tooltip>
  );
};
