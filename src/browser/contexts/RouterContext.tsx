import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { readPersistedState } from "@/browser/hooks/usePersistedState";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { SELECTED_MINION_KEY } from "@/common/constants/storage";
import { getProjectRouteId } from "@/common/utils/projectRouteId";
import type { MinionSelection } from "@/browser/components/ProjectSidebar";

export interface RouterContext {
  navigateToMinion: (minionId: string) => void;
  navigateToProject: (projectPath: string, crewId?: string, draftId?: string) => void;
  navigateToHome: () => void;
  navigateToSettings: (section?: string) => void;
  navigateFromSettings: () => void;
  navigateToAnalytics: () => void;
  navigateFromAnalytics: () => void;
  currentMinionId: string | null;

  /** Settings crew from URL (null when not on settings page). */
  currentSettingsSection: string | null;

  /** Project identifier from URL (does not include full filesystem path). */
  currentProjectId: string | null;

  /** Optional project path carried via in-memory navigation state (not persisted on refresh). */
  currentProjectPathFromState: string | null;

  /** Crew ID for pending minion creation (from URL) */
  pendingSectionId: string | null;

  /** Draft ID for UI-only minion creation drafts (from URL) */
  pendingDraftId: string | null;

  /** True when the analytics dashboard route is active. */
  isAnalyticsOpen: boolean;
}

const RouterContext = createContext<RouterContext | undefined>(undefined);

export function useRouter(): RouterContext {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error("useRouter must be used within RouterProvider");
  }
  return ctx;
}

/** Get initial route from browser URL or localStorage. */
function getInitialRoute(): string {
  // In browser mode, read route directly from URL (enables refresh restoration)
  if (window.location.protocol !== "file:" && !window.location.pathname.endsWith("iframe.html")) {
    const url = window.location.pathname + window.location.search;
    // Only use URL if it's a valid route (starts with /, not just "/" or empty)
    if (url.startsWith("/") && url !== "/") {
      return url;
    }
  }

  // In Electron (file://), fallback to localStorage for minion restoration
  const savedMinion = readPersistedState<MinionSelection | null>(
    SELECTED_MINION_KEY,
    null
  );
  if (savedMinion?.minionId) {
    return `/minion/${encodeURIComponent(savedMinion.minionId)}`;
  }
  return `/minion/${encodeURIComponent(LATTICE_HELP_CHAT_MINION_ID)}`;
}

/** Sync router state to browser URL (dev server only, not Electron/Storybook). */
function useUrlSync(): void {
  const location = useLocation();
  useEffect(() => {
    // Skip in Storybook (conflicts with story navigation)
    if (window.location.pathname.endsWith("iframe.html")) return;
    // Skip in Electron (file:// breaks on reload)
    if (window.location.protocol === "file:") return;

    const url = location.pathname + location.search;
    if (url !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, "", url);
    }
  }, [location.pathname, location.search]);
}

function RouterContextInner(props: { children: ReactNode }) {
  function getProjectPathFromLocationState(state: unknown): string | null {
    if (!state || typeof state !== "object") return null;
    if (!("projectPath" in state)) return null;
    const projectPath = (state as { projectPath?: unknown }).projectPath;
    return typeof projectPath === "string" ? projectPath : null;
  }

  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const location = useLocation();
  const [searchParams] = useSearchParams();
  useUrlSync();

  const minionMatch = /^\/minion\/(.+)$/.exec(location.pathname);
  const currentMinionId = minionMatch ? decodeURIComponent(minionMatch[1]) : null;
  const currentProjectId =
    location.pathname === "/project"
      ? (searchParams.get("project") ?? searchParams.get("path"))
      : null;
  const currentProjectPathFromState =
    location.pathname === "/project" ? getProjectPathFromLocationState(location.state) : null;
  const settingsMatch = /^\/settings\/([^/]+)$/.exec(location.pathname);
  const currentSettingsSection = settingsMatch ? decodeURIComponent(settingsMatch[1]) : null;
  const isAnalyticsOpen = location.pathname === "/analytics";

  interface NonSettingsLocationSnapshot {
    url: string;
    state: unknown;
  }

  // When leaving settings, we need to restore the *full* previous location including
  // any in-memory navigation state (e.g. /project relies on { projectPath } state, and
  // the legacy ?path= deep link rewrite stores that path in location.state).
  // Include /analytics so Settings opened from Analytics can close back to Analytics.
  const lastNonSettingsLocationRef = useRef<NonSettingsLocationSnapshot>({
    url: getInitialRoute(),
    state: null,
  });
  // Keep a separate "close analytics" snapshot that intentionally excludes /analytics so
  // closing analytics still returns to the last non-analytics route.
  const lastNonAnalyticsLocationRef = useRef<NonSettingsLocationSnapshot>({
    url: getInitialRoute(),
    state: null,
  });
  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) {
      const locationSnapshot: NonSettingsLocationSnapshot = {
        url: location.pathname + location.search,
        state: location.state,
      };
      lastNonSettingsLocationRef.current = locationSnapshot;
      if (location.pathname !== "/analytics") {
        lastNonAnalyticsLocationRef.current = locationSnapshot;
      }
    }
  }, [location.pathname, location.search, location.state]);

  // Back-compat: if we ever land on a legacy deep link (/project?path=<full path>),
  // immediately replace it with the non-path project id URL.
  useEffect(() => {
    if (location.pathname !== "/project") return;

    const params = new URLSearchParams(location.search);
    const legacyPath = params.get("path");
    const projectParam = params.get("project");
    if (!projectParam && legacyPath) {
      const section = params.get("section");
      const draft = params.get("draft");
      const projectId = getProjectRouteId(legacyPath);
      const nextParams = new URLSearchParams();
      nextParams.set("project", projectId);
      if (section) {
        nextParams.set("section", section);
      }
      if (draft) {
        nextParams.set("draft", draft);
      }
      const url = `/project?${nextParams.toString()}`;
      void navigateRef.current(url, { replace: true, state: { projectPath: legacyPath } });
    }
  }, [location.pathname, location.search]);
  const pendingSectionId = location.pathname === "/project" ? searchParams.get("section") : null;
  const pendingDraftId = location.pathname === "/project" ? searchParams.get("draft") : null;

  // Navigation functions use push (not replace) to build history for back/forward navigation.
  // See App.tsx handleMouseNavigation and KEYBINDS.NAVIGATE_BACK/FORWARD.
  const navigateToMinion = useCallback((id: string) => {
    void navigateRef.current(`/minion/${encodeURIComponent(id)}`);
  }, []);

  const navigateToProject = useCallback((path: string, crewId?: string, draftId?: string) => {
    const projectId = getProjectRouteId(path);
    const params = new URLSearchParams();
    params.set("project", projectId);
    if (crewId) {
      params.set("section", crewId);
    }
    if (draftId) {
      params.set("draft", draftId);
    }
    const url = `/project?${params.toString()}`;
    void navigateRef.current(url, { state: { projectPath: path } });
  }, []);

  const navigateToHome = useCallback(() => {
    void navigateRef.current("/");
  }, []);

  const navigateToSettings = useCallback((section?: string) => {
    const nextSection = section ?? "general";
    void navigateRef.current(`/settings/${encodeURIComponent(nextSection)}`);
  }, []);

  const navigateFromSettings = useCallback(() => {
    const lastLocation = lastNonSettingsLocationRef.current;
    if (!lastLocation.url || lastLocation.url.startsWith("/settings")) {
      void navigateRef.current("/");
      return;
    }
    void navigateRef.current(lastLocation.url, { state: lastLocation.state });
  }, []);

  const navigateToAnalytics = useCallback(() => {
    void navigateRef.current("/analytics");
  }, []);

  const navigateFromAnalytics = useCallback(() => {
    const lastLocation = lastNonAnalyticsLocationRef.current;
    if (
      !lastLocation.url ||
      lastLocation.url.startsWith("/settings") ||
      lastLocation.url === "/analytics"
    ) {
      void navigateRef.current("/");
      return;
    }
    void navigateRef.current(lastLocation.url, { state: lastLocation.state });
  }, []);

  const value = useMemo<RouterContext>(
    () => ({
      navigateToMinion,
      navigateToProject,
      navigateToHome,
      navigateToSettings,
      navigateFromSettings,
      navigateToAnalytics,
      navigateFromAnalytics,
      currentMinionId,
      currentSettingsSection,
      currentProjectId,
      currentProjectPathFromState,
      pendingSectionId,
      pendingDraftId,
      isAnalyticsOpen,
    }),
    [
      navigateToHome,
      navigateToProject,
      navigateToSettings,
      navigateFromSettings,
      navigateToAnalytics,
      navigateFromAnalytics,
      navigateToMinion,
      currentMinionId,
      currentSettingsSection,
      currentProjectId,
      currentProjectPathFromState,
      pendingSectionId,
      pendingDraftId,
      isAnalyticsOpen,
    ]
  );

  return <RouterContext.Provider value={value}>{props.children}</RouterContext.Provider>;
}

// Disable startTransition wrapping for navigation state updates so they
// batch with other normal-priority React state updates in the same tick.
// Without this, React processes navigation at transition (lower) priority,
// causing a flash of stale UI between normal-priority updates (e.g.
// setIsSending(false)) and the deferred route change.
export function RouterProvider(props: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[getInitialRoute()]} unstable_useTransitions={false}>
      <RouterContextInner>{props.children}</RouterContextInner>
    </MemoryRouter>
  );
}
