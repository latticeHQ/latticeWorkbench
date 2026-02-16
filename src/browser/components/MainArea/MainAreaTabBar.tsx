/**
 * MainAreaTabBar — the tab strip for the main area.
 *
 * Layout: [ ⚡ PM Chat ] [ A Claude Code ✕ ] [ ▲ Codex ✕ ] [ + ]
 *
 * - "chat" tab is always first and cannot be closed
 * - Employee (agent) tabs show CliAgentIcon + label + close button
 * - "+" button opens AgentPicker to hire a new employee
 */
import React, { useRef, useState } from "react";
import { Plus, Sparkles, Terminal, X } from "lucide-react";
import { cn } from "@/common/lib/utils";
import { isChatTab, isTerminalTab } from "@/browser/types/rightSidebar";
import type { TabType } from "@/browser/types/rightSidebar";
import { CliAgentIcon } from "@/browser/components/CliAgentIcon";
import { AgentPicker } from "./AgentPicker";
import type { EmployeeSlug } from "./AgentPicker";

export interface EmployeeMeta {
  slug: EmployeeSlug;
  label: string;
  /** Status of the agent process */
  status?: "running" | "done" | "error" | "idle";
}

interface MainAreaTabBarProps {
  tabs: TabType[];
  activeTab: TabType;
  employeeMeta: Map<string, EmployeeMeta>;
  detectedSlugs?: Set<string>;
  /** True while CLI agent detection scan is still running */
  detectingAgents?: boolean;
  onSelectTab: (tab: TabType) => void;
  onCloseTab: (tab: TabType) => void;
  onHireEmployee: (slug: EmployeeSlug) => void;
}

export function MainAreaTabBar({
  tabs,
  activeTab,
  employeeMeta,
  detectedSlugs,
  detectingAgents,
  onSelectTab,
  onCloseTab,
  onHireEmployee,
}: MainAreaTabBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="border-border-light bg-sidebar relative flex items-center border-b">
      {/* Scrollable tab list */}
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => (
          <Tab
            key={tab}
            tab={tab}
            isActive={tab === activeTab}
            employeeMeta={employeeMeta}
            onSelect={() => onSelectTab(tab)}
            onClose={isChatTab(tab) ? undefined : () => onCloseTab(tab)}
          />
        ))}
      </div>

      {/* Hire employee (+) button */}
      <div className="relative shrink-0 px-1">
        <button
          ref={addButtonRef}
          onClick={() => setPickerOpen((v) => !v)}
          className={cn(
            "text-muted hover:text-foreground hover:bg-hover flex h-6 w-6 items-center justify-center rounded border-none bg-transparent transition-colors",
            pickerOpen && "bg-hover text-foreground"
          )}
          title="Hire employee"
        >
          <Plus size={14} />
        </button>

        {/* AgentPicker popover */}
        {pickerOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setPickerOpen(false)}
            />
            {/* Picker panel */}
            <div className="absolute top-full right-0 z-50 mt-1">
              <AgentPicker
                detectedSlugs={detectedSlugs}
                loading={detectingAgents}
                onSelect={onHireEmployee}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface TabProps {
  tab: TabType;
  isActive: boolean;
  employeeMeta: Map<string, EmployeeMeta>;
  onSelect: () => void;
  onClose?: () => void;
}

function Tab({ tab, isActive, employeeMeta, onSelect, onClose }: TabProps) {
  const { icon, label, statusBadge } = getTabDisplay(tab, employeeMeta);

  return (
    <div
      className={cn(
        "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 py-2 text-[12px] transition-colors",
        "border-border-light",
        isActive
          ? "bg-dark text-foreground after:bg-accent after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px]"
          : "text-muted hover:bg-hover hover:text-foreground"
      )}
      onClick={onSelect}
      role="tab"
      aria-selected={isActive}
    >
      {/* Icon */}
      <span className="flex shrink-0 items-center text-[13px]">{icon}</span>

      {/* Label */}
      <span className="max-w-[120px] truncate">{label}</span>

      {/* Status badge (for employee tabs) */}
      {statusBadge && (
        <span className="shrink-0">{statusBadge}</span>
      )}

      {/* Close button (employee tabs only) */}
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "text-muted hover:text-foreground ml-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border-none bg-transparent transition-colors",
            "opacity-0 group-hover:opacity-100",
            isActive && "opacity-60 hover:opacity-100"
          )}
          title="Close"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function getStatusBadge(status?: EmployeeMeta["status"]) {
  if (!status || status === "idle") return null;
  if (status === "running") {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="bg-green-400 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
        <span className="bg-green-500 relative inline-flex h-2 w-2 rounded-full" />
      </span>
    );
  }
  if (status === "done") {
    return <span className="text-green-400 text-[10px] leading-none">✓</span>;
  }
  if (status === "error") {
    return <span className="text-amber-400 text-[10px] leading-none">!</span>;
  }
  return null;
}

function getTabDisplay(tab: TabType, employeeMeta: Map<string, EmployeeMeta>) {
  if (isChatTab(tab)) {
    return {
      icon: <Sparkles size={12} />,
      label: "PM Chat",
      statusBadge: null,
    };
  }

  if (isTerminalTab(tab)) {
    const sessionId = tab.startsWith("terminal:") ? tab.slice("terminal:".length) : "";
    const meta = employeeMeta.get(sessionId);

    if (meta) {
      return {
        icon: meta.slug === "terminal"
          ? <Terminal size={12} />
          : <CliAgentIcon slug={meta.slug} className="text-[13px]" />,
        label: meta.label,
        statusBadge: getStatusBadge(meta.status),
      };
    }

    return {
      icon: <Terminal size={12} />,
      label: "Terminal",
      statusBadge: null,
    };
  }

  // Fallback
  return { icon: null, label: tab, statusBadge: null };
}
