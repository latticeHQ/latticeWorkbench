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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/common/lib/utils";
import { getMainAreaLayoutKey, getMainAreaEmployeeMetaKey } from "@/common/constants/storage";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";
import {
  collectAllTabs,
  addTabToFocusedTabset,
  removeTabEverywhere,
  replaceTabEverywhere,
  selectTabInFocusedTabset,
  isRightSidebarLayoutState,
  getDefaultMainAreaLayoutState,
  getFocusedActiveTab,
} from "@/browser/utils/rightSidebarLayout";
import type { RightSidebarLayoutState } from "@/browser/utils/rightSidebarLayout";
import {
  isChatTab,
  isTerminalTab,
  makeTerminalTabType,
  getTerminalSessionId,
} from "@/browser/types/rightSidebar";
import type { TabType } from "@/browser/types/rightSidebar";
import { createTerminalSession } from "@/browser/utils/terminal";
import { useAPI } from "@/browser/contexts/API";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { MainAreaTabBar } from "./MainAreaTabBar";
import type { EmployeeMeta } from "./MainAreaTabBar";
import type { EmployeeSlug } from "./AgentPicker";

// Existing components
import { ChatPane } from "@/browser/components/ChatPane";
import { TerminalTab } from "@/browser/components/RightSidebar/TerminalTab";

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

/** Persisted shape of employeeMeta: Record<sessionId, EmployeeMeta> */
type PersistedEmployeeMeta = Record<string, { slug: EmployeeSlug; label: string }>;

function loadLayout(workspaceId: string): RightSidebarLayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(getMainAreaLayoutKey(workspaceId)) ?? "null");
    if (isRightSidebarLayoutState(raw)) {
      // Always ensure "chat" tab exists as first tab in the focused tabset
      const allTabs = collectAllTabs(raw.root);
      if (!allTabs.includes("chat")) {
        // Inject chat at the front
        if (raw.root.type === "tabset") {
          return {
            ...raw,
            root: { ...raw.root, tabs: ["chat", ...raw.root.tabs], activeTab: "chat" },
          };
        }
      }
      return raw;
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

function loadEmployeeMeta(workspaceId: string): Map<string, EmployeeMeta> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(getMainAreaEmployeeMetaKey(workspaceId)) ?? "null"
    ) as PersistedEmployeeMeta | null;
    if (raw && typeof raw === "object") {
      return new Map(
        Object.entries(raw).map(([sessionId, meta]) => [
          sessionId,
          { slug: meta.slug, label: meta.label, status: "idle" as const },
        ])
      );
    }
  } catch {
    // ignore parse errors
  }
  return new Map();
}

function saveEmployeeMeta(workspaceId: string, meta: Map<string, EmployeeMeta>) {
  try {
    const obj: PersistedEmployeeMeta = {};
    for (const [sessionId, m] of meta) {
      obj[sessionId] = { slug: m.slug, label: m.label };
    }
    localStorage.setItem(getMainAreaEmployeeMetaKey(workspaceId), JSON.stringify(obj));
  } catch {
    // ignore storage errors
  }
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
  const { detectedAgents, loading: detectingAgents } = useCliAgentDetection();
  const detectedSlugs = new Set(detectedAgents.map((a) => a.slug));

  const [layout, setLayout] = useState<RightSidebarLayoutState>(() => loadLayout(workspaceId));
  const [employeeMeta, setEmployeeMeta] = useState<Map<string, EmployeeMeta>>(
    () => loadEmployeeMeta(workspaceId)
  );

  // Persist layout whenever it changes
  useEffect(() => {
    saveLayout(workspaceId, layout);
  }, [workspaceId, layout]);

  // Persist employeeMeta whenever it changes
  useEffect(() => {
    saveEmployeeMeta(workspaceId, employeeMeta);
  }, [workspaceId, employeeMeta]);

  // Reset layout + meta when workspace changes
  useEffect(() => {
    setLayout(loadLayout(workspaceId));
    setEmployeeMeta(loadEmployeeMeta(workspaceId));
  }, [workspaceId]);

  // ── Session sync: restore tabs for live backend sessions, relaunch dead agents ──
  //
  // On every mount / workspace change we compare the persisted layout against the
  // live backend session list.  Three categories of terminal tab are handled:
  //
  //  1. Alive in backend but missing from layout  → re-add the tab (no focus steal)
  //  2. Ghost agent tab  (session dead, slug ≠ "terminal") → relaunch the binary,
  //     swap the old tab-type for the new one so the tab stays in the same position
  //  3. Ghost plain-terminal tab (session dead, slug = "terminal") → remove silently;
  //     a bare shell cannot be meaningfully restored
  //
  // This means agent tabs survive app restarts (Electron) and page reloads (browser)
  // even when the backend restarts and destroys all PTY processes.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void (async () => {
      const backendSessionIds = await api.terminal.listSessions({ workspaceId });
      if (cancelled) return;

      const backendSessionSet = new Set(backendSessionIds);

      // Current terminal tabs in this layout (captured at effect-creation time)
      const currentTabs = collectAllTabs(layout.root);
      const currentTerminalTabs = currentTabs.filter(isTerminalTab);
      const currentTerminalSessionIds = new Set(
        currentTerminalTabs.map(getTerminalSessionId).filter(Boolean)
      );

      // Sessions that exist in backend but have no tab yet → restore them
      const missingSessions = backendSessionIds.filter(
        (sid) => !currentTerminalSessionIds.has(sid)
      );

      // Tabs whose backend session is gone → split by whether we can relaunch them
      type Relaunchable = { oldTab: TabType; oldSid: string; meta: EmployeeMeta };
      const toRelaunch: Relaunchable[] = [];
      const toRemove: TabType[] = [];

      for (const tab of currentTerminalTabs) {
        const sid = getTerminalSessionId(tab);
        if (!sid || backendSessionSet.has(sid)) continue; // still alive — skip

        const meta = employeeMeta.get(sid);
        if (meta && meta.slug !== "terminal") {
          // Named agent — we can relaunch it
          toRelaunch.push({ oldTab: tab, oldSid: sid, meta });
        } else {
          // Plain terminal or unknown — just remove
          toRemove.push(tab);
        }
      }

      if (missingSessions.length === 0 && toRelaunch.length === 0 && toRemove.length === 0) {
        return;
      }

      // Re-spawn each relaunachable agent (sequentially to avoid overwhelming the backend)
      type Spawned = { oldTab: TabType; oldSid: string; newSid: string; meta: EmployeeMeta };
      const spawned: Spawned[] = [];

      for (const { oldTab, oldSid, meta } of toRelaunch) {
        if (cancelled) return;
        try {
          const agentDef =
            CLI_AGENT_DEFINITIONS[meta.slug as keyof typeof CLI_AGENT_DEFINITIONS];
          const initialCommand = agentDef?.binaryNames[0] ?? meta.slug;
          const session = await createTerminalSession(api, workspaceId, {
            initialCommand,
            slug: meta.slug,
            label: meta.label,
            directExec: true,
          });
          spawned.push({ oldTab, oldSid, newSid: session.sessionId, meta });
        } catch {
          // Couldn't spawn (binary missing, workspace unavailable, etc.) → remove the tab
          toRemove.push(oldTab);
        }
      }

      if (cancelled) return;

      // Apply layout changes atomically
      setLayout((prev) => {
        let next = prev;

        // Swap old terminal tab-type for new one (preserves position + active state)
        for (const { oldTab, newSid } of spawned) {
          next = replaceTabEverywhere(next, oldTab, makeTerminalTabType(newSid));
        }

        // Remove tabs that couldn't be restored
        for (const deadTab of toRemove) {
          next = removeTabEverywhere(next, deadTab);
        }

        // Re-add tabs for sessions that exist in backend but had no tab
        for (const sessionId of missingSessions) {
          next = addTabToFocusedTabset(next, makeTerminalTabType(sessionId), false);
        }

        // Ensure "chat" always survives
        if (!collectAllTabs(next.root).includes("chat")) {
          return getDefaultMainAreaLayoutState();
        }

        return next;
      });

      // Update meta: new session IDs for relaunched agents, delete removed ones
      setEmployeeMeta((prev) => {
        const next = new Map(prev);

        for (const { oldSid, newSid, meta } of spawned) {
          next.delete(oldSid);
          next.set(newSid, { ...meta, status: "running" });
          void api?.terminal.scrollback.clear({ sessionId: oldSid }).catch(() => undefined);
        }

        for (const deadTab of toRemove) {
          const sid = getTerminalSessionId(deadTab);
          if (sid) {
            next.delete(sid);
            void api?.terminal.scrollback.clear({ sessionId: sid }).catch(() => undefined);
          }
        }

        saveEmployeeMeta(workspaceId, next);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on workspace change, not layout/meta change
  }, [api, workspaceId]);

  const activeTab = getFocusedActiveTab(layout, "chat");
  const allTabs = collectAllTabs(layout.root);

  // ── AI-hired employee subscription (PM Chat → hire_employee tool) ────────
  // Subscribe to onEmployeeHired so that when PM Chat calls hire_employee(),
  // the new tab appears automatically without any manual interaction.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    void (async () => {
      const iterator = await api.terminal.onEmployeeHired({ workspaceId });
      for await (const { sessionId, slug, label } of iterator) {
        if (cancelled) break;
        const tabType = makeTerminalTabType(sessionId);
        setEmployeeMeta((prev) => {
          const next = new Map(prev);
          next.set(sessionId, { slug: slug as EmployeeSlug, label, status: "running" });
          saveEmployeeMeta(workspaceId, next);
          return next;
        });
        setLayout((prev) => {
          const withTab = addTabToFocusedTabset(prev, tabType);
          return selectTabInFocusedTabset(withTab, tabType);
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  // ── Hire an employee (open agent terminal tab) ──────────────────────────
  const hireEmployee = useCallback(
    async (slug: EmployeeSlug) => {
      if (!api) return;
      const isTerminal = slug === "terminal";
      const initialCommand = isTerminal
        ? undefined
        : CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS]?.binaryNames[0] ?? slug;

      const label = isTerminal
        ? "Terminal"
        : (CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS]?.displayName ?? slug);

      const session = await createTerminalSession(api, workspaceId, {
        initialCommand,
        slug,
        label,
        // Spawn the agent binary directly — no shell wrapper so no echo/prompt visible
        directExec: !isTerminal,
      });
      const tabType = makeTerminalTabType(session.sessionId);

      setEmployeeMeta((prev) => {
        const next = new Map(prev);
        next.set(session.sessionId, { slug, label, status: "running" });
        // Persist immediately so the label survives a fast page reload even if the
        // async useEffect flush hasn't run yet.
        saveEmployeeMeta(workspaceId, next);
        return next;
      });

      setLayout((prev) => {
        const withTab = addTabToFocusedTabset(prev, tabType);
        return selectTabInFocusedTabset(withTab, tabType);
      });
    },
    [api, workspaceId]
  );

  // Expose plain terminal launch to WorkspaceShell via ref
  useEffect(() => {
    if (addTerminalRef) {
      addTerminalRef.current = (options?: TerminalSessionCreateOptions) => {
        if (!api) return;
        void (async () => {
          const session = await createTerminalSession(api, workspaceId, options);
          const tabType = makeTerminalTabType(session.sessionId);
          setEmployeeMeta((prev) => {
            const next = new Map(prev);
            const metaSlug = (options?.slug ?? "terminal") as EmployeeSlug;
            const metaLabel = options?.label ?? "Terminal";
            next.set(session.sessionId, { slug: metaSlug, label: metaLabel, status: "running" });
            // Persist immediately so the label survives a fast page reload even if the
            // async useEffect flush hasn't run yet.
            saveEmployeeMeta(workspaceId, next);
            return next;
          });
          setLayout((prev) => {
            const withTab = addTabToFocusedTabset(prev, tabType);
            return selectTabInFocusedTabset(withTab, tabType);
          });
        })();
      };
    }
    return () => {
      if (addTerminalRef) addTerminalRef.current = null;
    };
  }, [api, workspaceId, addTerminalRef]);

  // ── Tab selection ────────────────────────────────────────────────────────
  const handleSelectTab = useCallback((tab: TabType) => {
    setLayout((prev) => selectTabInFocusedTabset(prev, tab));
  }, []);

  // ── Close (fire) an employee tab ─────────────────────────────────────────
  const handleCloseTab = useCallback(
    (tab: TabType) => {
      const sessionId = getTerminalSessionId(tab);
      if (sessionId) {
        setEmployeeMeta((prev) => {
          const next = new Map(prev);
          next.delete(sessionId);
          return next;
        });
        // Clear disk-backed scrollback then close the PTY session
        void api?.terminal.scrollback.clear({ sessionId }).catch(() => undefined);
        void api?.terminal.close({ sessionId }).catch(() => undefined);
      }
      setLayout((prev) => {
        const next = removeTabEverywhere(prev, tab);
        // Ensure "chat" always survives — if layout somehow lost it, restore default
        const remaining = collectAllTabs(next.root);
        if (!remaining.includes("chat")) return getDefaultMainAreaLayoutState();
        return next;
      });
    },
    [api]
  );

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

    setEmployeeMeta((prev) => {
      const meta = prev.get(sessionId);
      if (!meta) return prev;

      // Always upgrade status to "running" on title change (agent is active).
      const newStatus: EmployeeMeta["status"] = "running";
      // Update label from title only when the current label is the generic placeholder
      // and the new title is not a shell name. This captures agent names for terminals
      // that were opened as plain "Terminal" tabs and had an agent launched inside them.
      const newLabel =
        isMeaningful && meta.label === "Terminal" ? resolvedTitle : meta.label;

      if (newStatus === meta.status && newLabel === meta.label) return prev;

      const next = new Map(prev);
      next.set(sessionId, { ...meta, status: newStatus, label: newLabel });
      return next;
    });
  }, []);

  // ChatPane's onOpenTerminal — opens a plain terminal tab
  const handleOpenTerminal = useCallback(
    (options?: TerminalSessionCreateOptions) => {
      if (!api) return;
      void (async () => {
        const session = await createTerminalSession(api, workspaceId, options);
        const tabType = makeTerminalTabType(session.sessionId);
        setEmployeeMeta((prev) => {
          const next = new Map(prev);
          next.set(session.sessionId, { slug: "terminal", label: "Terminal", status: "running" });
          return next;
        });
        setLayout((prev) => {
          const withTab = addTabToFocusedTabset(prev, tabType);
          return selectTabInFocusedTabset(withTab, tabType);
        });
      })();
    },
    [api, workspaceId]
  );

  return (
    <div className={cn("flex flex-1 flex-col overflow-hidden", className)}>
      {/* Tab bar */}
      <MainAreaTabBar
        tabs={allTabs}
        activeTab={activeTab}
        employeeMeta={employeeMeta}
        detectedSlugs={detectedSlugs}
        detectingAgents={detectingAgents}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onHireEmployee={(slug) => void hireEmployee(slug)}
      />

      {/* Tab content panels — all mounted, inactive hidden (keep-alive).
          Uses absolute positioning so only one panel occupies space at a time. */}
      <div className="relative flex-1 overflow-hidden">
        {allTabs.map((tab) => {
          const isActive = tab === activeTab;

          if (isChatTab(tab)) {
            return (
              <div
                key="chat"
                className="absolute inset-0 flex flex-col overflow-hidden"
                hidden={!isActive}
              >
                <ChatPane
                  workspaceId={workspaceId}
                  workspaceState={workspaceState}
                  projectPath={projectPath}
                  projectName={projectName}
                  workspaceName={workspaceName}
                  namedWorkspacePath={workspacePath}
                  leftSidebarCollapsed={leftSidebarCollapsed}
                  onToggleLeftSidebarCollapsed={onToggleLeftSidebarCollapsed}
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
                hidden={!isActive}
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
