/**
 * InferenceSidebar — collapsible left sidebar for inference management.
 *
 * Mirrors the ResearchSidebar pattern: 40px collapsed (icons only), 180px expanded.
 * Groups inference views by category. Supports both dark and light themes
 * using CSS custom properties.
 */

import React, { useState } from "react";
import {
  Cpu,
  Database,
  MonitorSmartphone,
  Zap,
  Activity,
  Network,
  Settings,
  Play,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/common/lib/utils";

// ---------------------------------------------------------------------------
// Navigation definition
// ---------------------------------------------------------------------------

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: BarChart3 },
    ],
  },
  {
    title: "Models",
    items: [
      { key: "models", label: "Models", icon: Cpu },
      { key: "pool", label: "Model Pool", icon: Database },
    ],
  },
  {
    title: "Cluster",
    items: [
      { key: "machines", label: "Machines", icon: MonitorSmartphone },
      { key: "network", label: "Network", icon: Network },
    ],
  },
  {
    title: "Performance",
    items: [
      { key: "benchmark", label: "Benchmark", icon: Zap },
      { key: "metrics", label: "Metrics", icon: Activity },
    ],
  },
  {
    title: "System",
    items: [
      { key: "setup", label: "Setup", icon: Play },
      { key: "config", label: "Config", icon: Settings },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface InferenceSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const InferenceSidebar: React.FC<InferenceSidebarProps> = ({
  activeView,
  onViewChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r transition-[width] duration-200",
        "border-neutral-800 bg-[#0a0a0a]",
        collapsed ? "w-[40px]" : "w-[180px]",
      )}
    >
      {/* Nav groups */}
      <div className="flex-1 overflow-y-auto py-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-1">
            {/* Group label — hidden when collapsed */}
            {!collapsed && (
              <div className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-widest text-neutral-600">
                {group.title}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onViewChange(item.key)}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] transition-colors",
                    isActive
                      ? "bg-[#00ACFF]/10 text-[#00ACFF]"
                      : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Collapse / expand toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        className="flex items-center justify-center border-t border-neutral-800 py-2 text-neutral-600 transition-colors hover:text-neutral-400"
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
};
