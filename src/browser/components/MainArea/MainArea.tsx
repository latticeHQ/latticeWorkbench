/**
 * MainArea — the tabbed main area of AgentHQ.
 *
 * Holds the PM Chat tab and any number of employee (agent) terminal tabs.
 * Tab layout persists per-workspace in localStorage.
 *
 * Architecture:
 *   [ PM Chat ★ ] [ Claude Code ✕ ] [ Codex ✕ ] [ + ]
 *   ┌──────────────────────────────────────────────────┐
 *   │  <ChatPane> or <TerminalView>  (keep-alive)      │
 *   └──────────────────────────────────────────────────┘
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/common/lib/utils";
import {
  getMainAreaLayoutKey,
} from "@/common/constants/storage";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";
import {
  collectAllTabs,
  addTabToFocusedTabset,
  removeTabEverywhere,
  selectTabInFocusedTabset,
  isRightSidebarLayoutState,
  getDefaultMainAreaLayoutState,
  getFocusedActiveTab,
} from "@/browser/utils/rightSidebarLayout";
import type { RightSidebarLayoutState } from "@/browser/utils/rightSidebarLayout";
import {
  isChatTab,
  isHomeTab,
  isTerminalTab,
  makeTerminalTabType,
  getTerminalSessionId,
} from "@/browser/types/rightSidebar";
import type { TabType } from "@/browser/types/rightSidebar";
import { createTerminalSession } from "@/browser/utils/terminal";
import { useAPI } from "@/browser/contexts/API";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { useSessionRegistry } from "@/browser/hooks/useSessionRegistry";
import { MainAreaTabBar } from "./MainAreaTabBar";
import type { EmployeeMeta } from "./MainAreaTabBar";
import type { EmployeeSlug } from "./AgentPicker";

// Existing components
import { ChatPane } from "@/browser/components/ChatPane";
import { TerminalTab } from "@/browser/components/RightSidebar/TerminalTab";
import { WorkspaceHeader } from "@/browser/components/WorkspaceHeader";
import { HomeTab } from "./HomeTab";
import { showAgentToast } from "@/browser/stores/agentToast";

import type { RuntimeConfig } from "@/common/types/runtime";
import type { WorkspaceState } from "@/browser/stores/WorkspaceStore";
import type { TerminalSessionCreateOptions } from "@/browser/utils/terminal";

interface MainAreaProps {
  workspaceId: string;
  workspacePath: string;
  projectPath: string;
  projectName: string;
  workspaceName: string;
  workspaceState: WorkspaceState;
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  runtimeConfig?: RuntimeConfig;
  status?: "creating";
  className?: string;
  /** Ref callback so WorkspaceShell can imperatively open a terminal tab */
  addTerminalRef?: React.MutableRefObject<((options?: TerminalSessionCreateOptions) => void) | null>;
}

function loadLayout(workspaceId: string): RightSidebarLayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(getMainAreaLayoutKey(workspaceId)) ?? "null");
    if (isRightSidebarLayoutState(raw)) {
      const allTabs = collectAllTabs(raw.root);
      let patched = raw;

      // Ensure "chat" tab exists
      if (!allTabs.includes("chat")) {
        if (patched.root.type === "tabset") {
          patched = {
            ...patched,
            root: { ...patched.root, tabs: ["chat", ...patched.root.tabs], activeTab: "chat" },
          };
        }
      }

      // Inject "home" tab before "chat" if not present (migration for existing users)
      if (!collectAllTabs(patched.root).includes("home")) {
        if (patched.root.type === "tabset") {
          const chatIdx = patched.root.tabs.indexOf("chat");
          const newTabs = [...patched.root.tabs];
          newTabs.splice(chatIdx >= 0 ? chatIdx : 0, 0, "home");
          patched = { ...patched, root: { ...patched.root, tabs: newTabs } };
        }
      }

      return patched;
    }
  } catch {
    // ignore parse errors
  }
  return getDefaultMainAreaLayoutState();
}

function saveLayout(workspaceId: string, layout: RightSidebarLayoutState) {
  try {
    localStorage.setItem(getMainAreaLayoutKey(workspaceId), JSON.stringify(layout));
  } catch {
    // ignore storage errors
  }
}

// ── Terminal exit subscriber ──────────────────────────────────────────────────
// Renders nothing; subscribes to a single terminal session's exit stream.
// When the process exits, marks the session "done" and fires a global toast.

interface TerminalExitSubscriberProps {
  sessionId: string;
  label: string;
  onDone: (sessionId: string, label: string) => void;
}

function TerminalExitSubscriber({ sessionId, label, onDone }: TerminalExitSubscriberProps) {
  const { api } = useAPI();
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void (async () => {
      try {
        const iterator = await api.terminal.onExit({ sessionId });
        for await (const _exitCode of iterator) {
          if (cancelled) break;
          onDone(sessionId, label);
          break;
        }
      } catch {
        // Session closed externally or before exit — ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, label, onDone]);
  return null;
}

/** Shell process names that should never replace a tab label (too generic). */
const GENERIC_SHELL_TITLES = new Set([
  "bash", "zsh", "sh", "fish", "csh", "tcsh", "ksh", "dash", "pwsh", "cmd", "powershell",
]);

/**
 * Map from CLI binary name (lowercase) → agent display name.
 * Built from CLI_AGENT_DEFINITIONS so it stays in sync automatically.
 * e.g. "claude" → "Claude Code", "codex" → "Codex", "gemini" → "Gemini"
 * Used to convert an OSC terminal title like "claude" to "Claude Code" for
 * the tab label when a bare binary name is used as the process title.
 */
const BINARY_TO_DISPLAY_NAME: Record<string, string> = Object.fromEntries(
  Object.values(CLI_AGENT_DEFINITIONS).flatMap((def) =>
    def.binaryNames.map((bin) => [bin.toLowerCase(), def.displayName])
  )
);

export function MainArea({
  workspaceId,
  workspacePath,
  projectPath,
  projectName,
  workspaceName,
  workspaceState,
  leftSidebarCollapsed,
  onToggleLeftSidebarCollapsed,
  runtimeConfig,
  status,
  className,
  addTerminalRef,
}: MainAreaProps) {
  const { api } = useAPI();
  const { detectedAgents, disabledSlugs, loading: detectingAgents, refresh: refreshAgents } = useCliAgentDetection(workspaceId);
  const detectedSlugs = new Set(detectedAgents.map((a) => a.slug));

  const [layout, setLayout] = useState<RightSidebarLayoutState>(() => loadLayout(workspaceId));
  const [employeeMeta, sessionActions] = useSessionRegistry(workspaceId);

  // Always-fresh ref so effects that intentionally don't re-run on every
  // layout change can still read the latest layout state.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Persist layout whenever it changes
  useEffect(() => {
    saveLayout(workspaceId, layout);
  }, [workspaceId, layout]);

  // Reset layout when workspace changes (session state is handled by the hook)
  useEffect(() => {
    setLayout(loadLayout(workspaceId));
  }, [workspaceId]);

  const activeTab = getFocusedActiveTab(layout, "chat");
  const allTabs = collectAllTabs(layout.root);

  // ── Hire an employee (open agent terminal tab) ──────────────────────────
  const hireEmployee = useCallback(
    async (slug: EmployeeSlug) => {
      if (!api) return;
      const isTerminal = slug === "terminal";
      const initialCommand = isTerminal
        ? undefined
        : CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS]?.binaryNames[0] ?? slug;

      const label = isTerminal
        ? "Custom Agent"
        : (CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS]?.displayName ?? slug);

      let session: { sessionId: string; workspaceId: string; cols: number; rows: number };
      try {
        session = await createTerminalSession(api, workspaceId, {
          initialCommand,
          slug,
          label,
          // Spawn the agent binary directly — no shell wrapper so no echo/prompt visible
          directExec: !isTerminal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showAgentToast(`Failed to open ${label}: ${msg}`, { type: "error" });
        return;
      }
      const tabType = makeTerminalTabType(session.sessionId);

      sessionActions.registerSession(session.sessionId, slug, label);

      setLayout((prev) => {
        const withTab = addTabToFocusedTabset(prev, tabType);
        return selectTabInFocusedTabset(withTab, tabType);
      });
    },
    [api, workspaceId, sessionActions]
  );

  // Expose plain terminal launch to WorkspaceShell via ref.
  // Use a stable wrapper so the ref is never temporarily null during React
  // re-renders (avoids parent's fallback path firing unexpectedly).
  const addTerminalHandler = useCallback(
    (options?: TerminalSessionCreateOptions) => {
      if (!api) return;
      void (async () => {
        const session = await createTerminalSession(api, workspaceId, options);
        const tabType = makeTerminalTabType(session.sessionId);
        const metaSlug = (options?.slug ?? "terminal") as EmployeeSlug;
        const metaLabel = options?.label ?? "Terminal";
        sessionActions.registerSession(session.sessionId, metaSlug, metaLabel);
        setLayout((prev) => {
          const withTab = addTabToFocusedTabset(prev, tabType);
          return selectTabInFocusedTabset(withTab, tabType);
        });
      })();
    },
    [api, workspaceId, sessionActions]
  );

  const addTerminalHandlerRef = useRef(addTerminalHandler);
  addTerminalHandlerRef.current = addTerminalHandler;

  useEffect(() => {
    if (!addTerminalRef) return;
    addTerminalRef.current = (options?: TerminalSessionCreateOptions) => {
      addTerminalHandlerRef.current(options);
    };
    return () => {
      addTerminalRef.current = null;
    };
    // addTerminalRef is a stable useRef from parent — runs once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTerminalRef]);

  // ── Tab selection ────────────────────────────────────────────────────────
  const handleSelectTab = useCallback((tab: TabType) => {
    setLayout((prev) => selectTabInFocusedTabset(prev, tab));
  }, []);

  // ── Close (fire) an employee tab ─────────────────────────────────────────
  const handleCloseTab = useCallback(
    (tab: TabType) => {
      const sessionId = getTerminalSessionId(tab);
      if (sessionId) {
        sessionActions.unregisterSession(sessionId);
        // Clear disk-backed scrollback then close the PTY session.
        void api?.terminal.scrollback.clear({ sessionId }).catch(() => undefined);
        void api?.terminal.close({ sessionId }).catch(() => undefined);
      }
      setLayout((prev) => {
        const next = removeTabEverywhere(prev, tab);
        // Ensure "chat" always survives — if layout somehow lost it, restore default
        const remaining = collectAllTabs(next.root);
        const finalLayout = remaining.includes("chat") ? next : getDefaultMainAreaLayoutState();
        // Persist immediately so a fast app restart doesn't reload a stale layout
        // with the closed tab still present (useEffect save is async/post-paint).
        saveLayout(workspaceId, finalLayout);
        return finalLayout;
      });
    },
    [api, workspaceId, sessionActions]
  );

  // ── Terminal exit handler — marks session "done" + fires toast ───────────
  const handleTerminalDone = useCallback((sessionId: string, label: string) => {
    sessionActions.markDone(sessionId);
    showAgentToast(label, { label: "Agent Done", type: "done" });
  }, [sessionActions]);

  // ── Employee status + label updates ──────────────────────────────────────
  const handleTerminalTitleChange = useCallback((tab: TabType, title: string) => {
    const sessionId = getTerminalSessionId(tab);
    if (!sessionId) return;

    // Decide if the OSC title is meaningful enough to use as a tab label.
    const trimmed = title.trim();
    const lc = trimmed.toLowerCase();
    const isMeaningful = trimmed.length > 0 && !GENERIC_SHELL_TITLES.has(lc);

    // Map bare binary names to their human-readable display names.
    // e.g. "claude" → "Claude Code", "codex" → "Codex", "gh" → "GitHub Copilot"
    const resolvedTitle = BINARY_TO_DISPLAY_NAME[lc] ?? trimmed;

    // Update label from title only when the current label is the generic placeholder
    // and the new title is not a shell name. This captures agent names for terminals
    // that were opened as plain "Terminal" tabs and had an agent launched inside them.
    const meta = employeeMeta.get(sessionId);
    if (!meta) return;

    if (isMeaningful && meta.label === "Terminal") {
      sessionActions.updateLabel(sessionId, resolvedTitle);
    }
  }, [employeeMeta, sessionActions]);

  // Opens a plain terminal in MainArea's own layout.
  // Used by ChatPane's code-block "run in terminal" button (via MessageListContext).
  const handleOpenTerminal = useCallback(
    (options?: TerminalSessionCreateOptions) => {
      if (!api) return;
      void (async () => {
        const session = await createTerminalSession(api, workspaceId, options);
        const tabType = makeTerminalTabType(session.sessionId);
        sessionActions.registerSession(session.sessionId, "terminal", "Terminal");
        setLayout((prev) => {
          const withTab = addTabToFocusedTabset(prev, tabType);
          return selectTabInFocusedTabset(withTab, tabType);
        });
      })();
    },
    [api, workspaceId, sessionActions]
  );

  return (
    <div className={cn("flex flex-1 flex-col overflow-hidden", className)}>
      {/* Workspace header — sits above the tab bar */}
      <WorkspaceHeader
        workspaceId={workspaceId}
        projectName={projectName}
        projectPath={projectPath}
        workspaceName={workspaceName}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebarCollapsed={onToggleLeftSidebarCollapsed}
        namedWorkspacePath={workspacePath}
        runtimeConfig={runtimeConfig}
        onHireEmployee={(slug) => void hireEmployee(slug)}
        detectedSlugs={detectedSlugs}
        disabledSlugs={disabledSlugs}
        detectingAgents={detectingAgents}
        onRefreshAgents={refreshAgents}
      />

      {/* Terminal exit subscribers — one per active CLI agent session.
          Renders nothing; fires a toast + marks status "done" on process exit. */}
      {Array.from(employeeMeta.entries()).map(([sessionId, meta]) =>
        meta.status !== "done" ? (
          <TerminalExitSubscriber
            key={sessionId}
            sessionId={sessionId}
            label={meta.label}
            onDone={handleTerminalDone}
          />
        ) : null
      )}

      {/* Tab bar */}
      <MainAreaTabBar
        tabs={allTabs}
        activeTab={activeTab}
        employeeMeta={employeeMeta}
        workspaceId={workspaceId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
      />

      {/* Tab content panels — all mounted, inactive hidden (keep-alive).
          Uses absolute positioning so only one panel occupies space at a time.
          Note: we use inline style display:none instead of the HTML `hidden`
          attribute because Tailwind v4 resets [hidden] with zero specificity
          (:where([hidden])), which the `flex` utility class overrides. Inline
          styles always win regardless of cascade layer order. */}
      <div className="relative flex-1 overflow-hidden">
        {allTabs.map((tab) => {
          const isActive = tab === activeTab;

          if (isHomeTab(tab)) {
            return (
              <div
                key="home"
                className="absolute inset-0 flex flex-col overflow-hidden"
                style={isActive ? undefined : { display: "none" }}
              >
                <HomeTab
                  workspaceId={workspaceId}
                  workspaceName={workspaceName}
                  projectName={projectName}
                  employeeMeta={employeeMeta}
                  onOpenSession={(sessionId) =>
                    handleSelectTab(makeTerminalTabType(sessionId))
                  }
                  onCloseSession={(sessionId) =>
                    handleCloseTab(makeTerminalTabType(sessionId))
                  }
                />
              </div>
            );
          }

          if (isChatTab(tab)) {
            return (
              <div
                key="chat"
                className="absolute inset-0 flex flex-col overflow-hidden"
                style={isActive ? undefined : { display: "none" }}
              >
                <ChatPane
                  workspaceId={workspaceId}
                  workspaceState={workspaceState}
                  projectPath={projectPath}
                  projectName={projectName}
                  workspaceName={workspaceName}
                  namedWorkspacePath={workspacePath}
                  runtimeConfig={runtimeConfig}
                  status={status}
                  onOpenTerminal={handleOpenTerminal}
                />
              </div>
            );
          }

          if (isTerminalTab(tab)) {
            return (
              <div
                key={tab}
                className="absolute inset-0 flex flex-col overflow-hidden"
                style={isActive ? undefined : { display: "none" }}
              >
                <TerminalTab
                  workspaceId={workspaceId}
                  tabType={tab}
                  visible={isActive}
                  onTitleChange={(title) => handleTerminalTitleChange(tab, title)}
                  persistScrollback
                />
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
