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
  getMainAreaEmployeeMetaKey,
  getClosingSessionsKey,
} from "@/common/constants/storage";
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
  isHomeTab,
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

/** Persisted shape of employeeMeta: Record<sessionId, EmployeeMeta> */
type PersistedEmployeeMeta = Record<string, { slug: EmployeeSlug; label: string }>;

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

/**
 * TTL for persisted closing-session IDs (30 s).
 * After this window the backend has certainly torn down the PTY, so we no
 * longer need to suppress session-sync from re-adding it.
 */
const CLOSING_SESSION_TTL_MS = 30_000;

/** Load sessionIds that were being closed when the page last unloaded. */
function loadClosingSessions(workspaceId: string): Set<string> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(getClosingSessionsKey(workspaceId)) ?? "null"
    ) as Record<string, number> | null;
    if (raw && typeof raw === "object") {
      const now = Date.now();
      const live = new Set<string>();
      for (const [sid, ts] of Object.entries(raw)) {
        if (now - ts < CLOSING_SESSION_TTL_MS) live.add(sid);
      }
      return live;
    }
  } catch {
    // ignore parse errors
  }
  return new Set();
}

function addClosingSession(workspaceId: string, sessionId: string) {
  try {
    const raw = JSON.parse(
      localStorage.getItem(getClosingSessionsKey(workspaceId)) ?? "{}"
    ) as Record<string, number>;
    raw[sessionId] = Date.now();
    localStorage.setItem(getClosingSessionsKey(workspaceId), JSON.stringify(raw));
  } catch {
    // ignore storage errors
  }
}

function removeClosingSession(workspaceId: string, sessionId: string) {
  try {
    const raw = JSON.parse(
      localStorage.getItem(getClosingSessionsKey(workspaceId)) ?? "{}"
    ) as Record<string, number>;
    delete raw[sessionId];
    localStorage.setItem(getClosingSessionsKey(workspaceId), JSON.stringify(raw));
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
  const { detectedAgents, loading: detectingAgents, refresh: refreshAgents } = useCliAgentDetection(workspaceId);
  const detectedSlugs = new Set(detectedAgents.map((a) => a.slug));

  const [layout, setLayout] = useState<RightSidebarLayoutState>(() => loadLayout(workspaceId));
  const [employeeMeta, setEmployeeMeta] = useState<Map<string, EmployeeMeta>>(
    () => loadEmployeeMeta(workspaceId)
  );

  // Track sessions that are being closed so the session-sync effect doesn't
  // re-add them before the backend has finished tearing down the PTY.
  // Seeded from localStorage so closes-in-progress survive page reloads.
  const closingSessionIds = useRef(loadClosingSessions(workspaceId));

  // Always-fresh refs so the session-sync effect (intentionally not re-run on
  // every layout/meta change) can still read the LATEST state and avoid
  // relaunching tabs that were just explicitly closed by the user.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const employeeMetaRef = useRef(employeeMeta);
  employeeMetaRef.current = employeeMeta;

  // Persist layout whenever it changes
  useEffect(() => {
    saveLayout(workspaceId, layout);
  }, [workspaceId, layout]);

  // Persist employeeMeta whenever it changes
  useEffect(() => {
    saveEmployeeMeta(workspaceId, employeeMeta);
  }, [workspaceId, employeeMeta]);

  // Reset layout + meta + closing-sessions when workspace changes
  useEffect(() => {
    setLayout(loadLayout(workspaceId));
    setEmployeeMeta(loadEmployeeMeta(workspaceId));
    closingSessionIds.current = loadClosingSessions(workspaceId);
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

      // Clean up closing sessions whose PTY the backend has confirmed is gone.
      // This replaces the old 2-second setTimeout approach: we only lift the
      // "closing" guard once we KNOW the session no longer exists in the backend,
      // so session-sync can never race and re-add a tab the user just closed.
      for (const sid of [...closingSessionIds.current]) {
        if (!backendSessionSet.has(sid)) {
          closingSessionIds.current.delete(sid);
          removeClosingSession(workspaceId, sid);
        }
      }

      // Current terminal tabs in this layout — use refs so we read the latest
      // state even if the effect closure is stale (avoids relaunching tabs the
      // user just explicitly closed).
      const currentTabs = collectAllTabs(layoutRef.current.root);
      const currentTerminalTabs = currentTabs.filter(isTerminalTab);
      const currentTerminalSessionIds = new Set(
        currentTerminalTabs.map(getTerminalSessionId).filter(Boolean)
      );

      // Sessions that exist in backend but have no tab yet → restore them.
      // Exclude sessions that are in the process of being closed by the user
      // (the backend may not have fully torn them down yet).
      const missingSessions = backendSessionIds.filter(
        (sid) => !currentTerminalSessionIds.has(sid) && !closingSessionIds.current.has(sid)
      );

      // Tabs whose backend session is gone → split by whether we can relaunch them
      type Relaunchable = { oldTab: TabType; oldSid: string; meta: EmployeeMeta };
      const toRelaunch: Relaunchable[] = [];
      const toRemove: TabType[] = [];

      for (const tab of currentTerminalTabs) {
        const sid = getTerminalSessionId(tab);
        if (!sid || backendSessionSet.has(sid)) continue; // still alive — skip

        const meta = employeeMetaRef.current.get(sid);
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
        // Guard against historical event replay: if this session is already
        // tracked (loaded from localStorage on mount), skip re-adding it.
        // New hires (never seen before) won't be in the map, so they still
        // get added and their tab opened normally.
        let isNew = false;
        setEmployeeMeta((prev) => {
          if (prev.has(sessionId)) return prev;
          isNew = true;
          const next = new Map(prev);
          next.set(sessionId, { slug: slug as EmployeeSlug, label, status: "running" });
          saveEmployeeMeta(workspaceId, next);
          return next;
        });
        if (!isNew) continue;
        setLayout((prev) => {
          const existing = collectAllTabs(prev.root);
          if (existing.includes(tabType)) return prev;
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

  // Expose plain terminal launch to WorkspaceShell via ref.
  // Use a stable wrapper so the ref is never temporarily null during React
  // re-renders (avoids parent's fallback path firing unexpectedly).
  const addTerminalHandler = useCallback(
    (options?: TerminalSessionCreateOptions) => {
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
    },
    [api, workspaceId]
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
        // Mark as closing so session-sync doesn't re-add this tab while the
        // backend is still tearing down the PTY process.  Persisted to
        // localStorage so the guard also works across page reloads.
        closingSessionIds.current.add(sessionId);
        addClosingSession(workspaceId, sessionId);

        setEmployeeMeta((prev) => {
          const next = new Map(prev);
          next.delete(sessionId);
          // Persist immediately — same as hireEmployee — so a fast app restart
          // doesn't reload stale meta and try to relaunch the closed session.
          saveEmployeeMeta(workspaceId, next);
          return next;
        });
        // Clear disk-backed scrollback then close the PTY session.
        // closingSessionIds cleanup is handled inside the session-sync effect once
        // the backend confirms the session is truly gone — do NOT use a timer here,
        // as the PTY may still be alive after an arbitrary delay and session-sync
        // would incorrectly re-add the tab.
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
    [api, workspaceId]
  );

  // ── Terminal exit handler — marks session "done" + fires toast ───────────
  const handleTerminalDone = useCallback((sessionId: string, label: string) => {
    setEmployeeMeta((prev) => {
      const meta = prev.get(sessionId);
      if (!meta || meta.status === "done") return prev; // already marked
      const next = new Map(prev);
      next.set(sessionId, { ...meta, status: "done" });
      return next;
    });
    showAgentToast(label, { label: "Agent Done", type: "done" });
  }, []);

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

  // Opens a plain terminal in MainArea's own layout.
  // Used by ChatPane's code-block "run in terminal" button (via MessageListContext).
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
