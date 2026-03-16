/**
 * ResearchSidebar — collapsible left sidebar with Bloomberg-terminal dark theme.
 *
 * 40 px collapsed (icons only), 180 px expanded (icon + label).
 * Items grouped by category, active item highlighted with #00ACFF.
 */

import React, { useState } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  Bitcoin,
  DollarSign,
  Gem,
  BarChart3,
  GitBranch,
  Timer,
  Globe,
  Landmark,
  BookOpen,
  Activity,
  PieChart,
  LineChart as LineChartIcon,
  Newspaper,
  FileText,
  List,
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
    title: "Markets",
    items: [
      { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { key: "equity", label: "Equity", icon: TrendingUp },
      { key: "crypto", label: "Crypto", icon: Bitcoin },
      { key: "fx", label: "FX", icon: DollarSign },
      { key: "commodities", label: "Commodities", icon: Gem },
      { key: "indices", label: "Indices", icon: BarChart3 },
    ],
  },
  {
    title: "Derivatives",
    items: [
      { key: "options", label: "Options", icon: GitBranch },
      { key: "futures", label: "Futures", icon: Timer },
    ],
  },
  {
    title: "Economy",
    items: [
      { key: "economy", label: "Economy", icon: Globe },
      { key: "fixed-income", label: "Fixed Income", icon: Landmark },
      { key: "fred", label: "FRED", icon: BookOpen },
    ],
  },
  {
    title: "Analysis",
    items: [
      { key: "technicals", label: "Technicals", icon: Activity },
      { key: "fundamentals", label: "Fundamentals", icon: PieChart },
      { key: "econometrics", label: "Econometrics", icon: LineChartIcon },
    ],
  },
  {
    title: "News",
    items: [
      { key: "news", label: "News", icon: Newspaper },
      { key: "sec-filings", label: "SEC Filings", icon: FileText },
    ],
  },
  {
    title: "Manage",
    items: [
      { key: "watchlist", label: "Watchlist", icon: List },
    ],
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ResearchSidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const ResearchSidebar: React.FC<ResearchSidebarProps> = ({
  activeView,
  onViewChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-neutral-800 bg-[#0a0a0a] transition-[width] duration-200",
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
