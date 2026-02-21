/**
 * MainAreaTabBar — the tab strip for the main area.
 *
 * Layout: [ 🏠 Home ] [ ⚡ PM Chat ] [ A Claude Code ✕ ] [ ▲ Codex ✕ ]
 *
 * - "home" and "chat" tabs are always pinned and cannot be closed
 * - Employee (agent) tabs show CliAgentIcon + label + close button
 * - PM Chat tab shows an orange dot when there are unread messages
 * - Hire employee (+) button lives in WorkspaceHeader
 */
import React from "react";
import { Sparkles, Terminal, X, LayoutDashboard } from "lucide-react";
import { cn } from "@/common/lib/utils";
import { isChatTab, isHomeTab, isTerminalTab } from "@/browser/types/rightSidebar";
import type { TabType } from "@/browser/types/rightSidebar";
import { CliAgentIcon } from "@/browser/components/CliAgentIcon";
import { useWorkspaceUnread } from "@/browser/hooks/useWorkspaceUnread";
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
  /** Workspace ID — used for the PM Chat unread badge */
  workspaceId: string;
  onSelectTab: (tab: TabType) => void;
  onCloseTab: (tab: TabType) => void;
}

export function MainAreaTabBar({
  tabs,
  activeTab,
  employeeMeta,
  workspaceId,
  onSelectTab,
  onCloseTab,
}: MainAreaTabBarProps) {
  const homeTab = tabs.find(isHomeTab);
  const chatTab = tabs.find(isChatTab);
  const agentTabs = tabs.filter((t) => !isChatTab(t) && !isHomeTab(t));

  return (
    <div className="border-border-light bg-background-secondary relative z-10 flex min-w-0 items-center border-b px-2">
      {/* Home tab — pinned first */}
      {homeTab && (
        <Tab
          tab={homeTab}
          isActive={homeTab === activeTab}
          employeeMeta={employeeMeta}
          workspaceId={workspaceId}
          onSelect={() => onSelectTab(homeTab)}
        />
      )}

      {/* PM Chat — always pinned, shows unread dot when away */}
      {chatTab && (
        <Tab
          tab={chatTab}
          isActive={chatTab === activeTab}
          employeeMeta={employeeMeta}
          workspaceId={workspaceId}
          onSelect={() => onSelectTab(chatTab)}
        />
      )}

      {/* Divider between pinned tabs and scrollable agent tabs */}
      {agentTabs.length > 0 && (
        <div className="bg-border-light mx-2 h-4 w-px shrink-0" />
      )}

      {/* Scrollable agent/terminal tabs */}
      <div className="scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto">
        {agentTabs.map((tab) => (
          <Tab
            key={tab}
            tab={tab}
            isActive={tab === activeTab}
            employeeMeta={employeeMeta}
            workspaceId={workspaceId}
            onSelect={() => onSelectTab(tab)}
            onClose={() => onCloseTab(tab)}
          />
        ))}
      </div>
    </div>
  );
}

interface TabProps {
  tab: TabType;
  isActive: boolean;
  employeeMeta: Map<string, EmployeeMeta>;
  workspaceId: string;
  onSelect: () => void;
  onClose?: () => void;
}

function Tab({ tab, isActive, employeeMeta, workspaceId, onSelect, onClose }: TabProps) {
  const { icon, label, statusBadge } = getTabDisplay(tab, employeeMeta);

  return (
    <div
      className={cn(
        // Bottom-border underline style — no rounded corners, flush with bar border
        "group relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium transition-colors duration-150",
        // Active: accent bottom border (slightly overlaps container's border-b)
        "border-b-2 -mb-px",
        isActive
          ? "border-b-accent text-foreground"
          : "border-b-transparent text-muted hover:text-foreground"
      )}
      onClick={onSelect}
      role="tab"
      aria-selected={isActive}
    >
      {/* Icon */}
      <span className="flex shrink-0 items-center text-[13px]">{icon}</span>

      {/* Label */}
      <span className="max-w-[120px] truncate">{label}</span>

      {/* Unread badge for PM Chat tab */}
      {isChatTab(tab) && (
        <ChatUnreadBadge workspaceId={workspaceId} isActive={isActive} />
      )}

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
            "text-muted hover:text-foreground hover:bg-white/10 relative z-10 ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-none bg-transparent transition-colors",
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

// ── Unread badge for PM Chat ──────────────────────────────────────────────────

function ChatUnreadBadge({
  workspaceId,
  isActive,
}: {
  workspaceId: string;
  isActive: boolean;
}) {
  const { isUnread } = useWorkspaceUnread(workspaceId);

  if (!isUnread || isActive) return null;

  return (
    <span
      aria-label="Unread messages"
      className="relative flex h-1.5 w-1.5 shrink-0"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-exec-mode)] opacity-50" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-exec-mode)]" />
    </span>
  );
}

// ── Tab display helpers ───────────────────────────────────────────────────────

function getStatusBadge(status?: EmployeeMeta["status"]) {
  if (!status || status === "idle") return null;
  if (status === "running") {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="bg-[var(--color-exec-mode)]/70 absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
        <span className="bg-[var(--color-exec-mode)] relative inline-flex h-2 w-2 rounded-full" />
      </span>
    );
  }
  if (status === "done") {
    return <span className="text-[var(--color-success)] text-[10px] leading-none">✓</span>;
  }
  if (status === "error") {
    return <span className="text-amber-400 text-[10px] leading-none">!</span>;
  }
  return null;
}

function getTabDisplay(tab: TabType, employeeMeta: Map<string, EmployeeMeta>) {
  if (isHomeTab(tab)) {
    return {
      icon: <LayoutDashboard size={12} />,
      label: "Home",
      statusBadge: null,
    };
  }

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
