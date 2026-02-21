/**
 * MainAreaTabBar — the tab strip for the main area.
 *
 * Layout: [ ⚡ PM Chat ] [ A Claude Code ✕ ] [ ▲ Codex ✕ ] [ + ]
 *
 * - "chat" tab is always first and cannot be closed
 * - Employee (agent) tabs show CliAgentIcon + label + close button
 * - "+" button opens AgentPicker to hire a new employee
 */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  /** Callback to re-scan for installed agents */
  onRefreshAgents?: () => void;
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
  onRefreshAgents,
  onSelectTab,
  onCloseTab,
  onHireEmployee,
}: MainAreaTabBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const chatTab = tabs.find(isChatTab);
  const agentTabs = tabs.filter((t) => !isChatTab(t));

  return (
    <div className="border-border-light bg-sidebar relative z-10 flex min-w-0 items-center border-b px-2 py-1.5">
      {/* PM Chat — always pinned, never scrolls off */}
      {chatTab && (
        <Tab
          tab={chatTab}
          isActive={chatTab === activeTab}
          employeeMeta={employeeMeta}
          onSelect={() => onSelectTab(chatTab)}
        />
      )}

      {/* Divider between pinned PM Chat and scrollable agent tabs */}
      {agentTabs.length > 0 && (
        <div className="bg-border-light mx-1.5 h-4 w-px shrink-0" />
      )}

      {/* Scrollable agent/terminal tabs */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {agentTabs.map((tab) => (
          <Tab
            key={tab}
            tab={tab}
            isActive={tab === activeTab}
            employeeMeta={employeeMeta}
            onSelect={() => onSelectTab(tab)}
            onClose={() => onCloseTab(tab)}
          />
        ))}
      </div>

      {/* Hire employee (+) button */}
      <div className="relative shrink-0 pl-1">
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

        {/* AgentPicker popover — viewport-aware positioning */}
        {pickerOpen && (
          <AgentPickerPopover
            buttonRef={addButtonRef}
            detectedSlugs={detectedSlugs}
            detectingAgents={detectingAgents}
            onRefreshAgents={onRefreshAgents}
            onHireEmployee={onHireEmployee}
            onClose={() => setPickerOpen(false)}
          />
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

/**
 * Portalled popover for AgentPicker. Rendered into document.body so it's
 * never clipped by parent overflow:hidden or CSS transforms. Positioned
 * using the trigger button's bounding rect.
 */
function AgentPickerPopover({
  buttonRef,
  detectedSlugs,
  detectingAgents,
  onRefreshAgents,
  onHireEmployee,
  onClose,
}: {
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  detectedSlugs?: Set<string>;
  detectingAgents?: boolean;
  onRefreshAgents?: () => void;
  onHireEmployee: (slug: EmployeeSlug) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, [buttonRef]);

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      {/* Picker panel — fixed position, max-height keeps it inside viewport */}
      <div
        ref={panelRef}
        className="fixed z-50 flex flex-col overflow-hidden"
        style={
          pos
            ? { top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top + 8}px)` }
            : { top: 0, right: 0, visibility: "hidden" }
        }
      >
        <AgentPicker
          detectedSlugs={detectedSlugs}
          loading={detectingAgents}
          onRefresh={onRefreshAgents}
          onSelect={onHireEmployee}
          onClose={onClose}
        />
      </div>
    </>,
    document.body
  );
}

function Tab({ tab, isActive, employeeMeta, onSelect, onClose }: TabProps) {
  const { icon, label, statusBadge } = getTabDisplay(tab, employeeMeta);

  return (
    <div
      className={cn(
        "group relative flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-all duration-150",
        isActive
          ? "bg-hover text-foreground"
          : "text-muted hover:bg-hover/50 hover:text-foreground"
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
            e.preventDefault();
            onClose();
          }}
          onPointerDown={(e) => {
            // Prevent the parent div's onClick from firing on pointer down
            e.stopPropagation();
          }}
          className={cn(
            "text-muted hover:text-foreground hover:bg-white/10 relative z-10 ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border-none bg-transparent transition-colors",
            "opacity-0 group-hover:opacity-100",
            isActive && "opacity-60 hover:opacity-100"
          )}
          title="Close"
          aria-label={`Close ${label}`}
        >
          <X size={12} />
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
