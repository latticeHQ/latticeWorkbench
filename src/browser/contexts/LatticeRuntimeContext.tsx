/**
 * Shared context for Lattice Runtime connection state.
 *
 * Centralizes CLI availability, auth identity, remote minions, and templates
 * so that TitleBar (Connection Hub), RuntimeDashboard, and the creation flow
 * all share a single data source rather than fetching independently.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useAPI } from "@/browser/contexts/API";
import type {
  LatticeInfo,
  LatticeWhoami,
  LatticeTemplate,
  LatticeMinion,
} from "@/common/orpc/schemas/lattice";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LatticeConnectionState =
  | "unavailable" // CLI not installed
  | "connecting" // Checking CLI / auth
  | "disconnected" // CLI available but not authenticated
  | "connected" // Authenticated
  | "error"; // Check failed

export interface LatticeRuntimeState {
  /** Lattice CLI availability */
  info: LatticeInfo | null;
  /** Auth identity */
  whoami: LatticeWhoami | null;
  /** Derived high-level connection state */
  connectionState: LatticeConnectionState;

  /** Remote Lattice minions (polled when connected) */
  remoteMinions: LatticeMinion[];
  remoteMinionsFetching: boolean;
  remoteMinionError: string | null;

  /** Available templates (fetched when connected) */
  templates: LatticeTemplate[];
  templatesLoading: boolean;
  templatesError: string | null;

  /** Re-fetch CLI info + auth state (e.g. after login) */
  refresh: () => void;
  /** Re-fetch remote minion list */
  refreshRemoteMinions: () => void;

  /** Login dialog controls */
  loginDialogOpen: boolean;
  openLoginDialog: () => void;
  closeLoginDialog: () => void;
}

const REMOTE_MINION_POLL_MS = 30_000;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const LatticeRuntimeContext = createContext<LatticeRuntimeState | null>(null);

// ---------------------------------------------------------------------------
// Derive connection state from info + whoami
// ---------------------------------------------------------------------------

function deriveConnectionState(
  info: LatticeInfo | null,
  whoami: LatticeWhoami | null,
  loading: boolean
): LatticeConnectionState {
  if (loading) return "connecting";
  if (!info) return "connecting";
  if (info.state === "unavailable" || info.state === "outdated") return "unavailable";
  // info.state === "available"
  if (!whoami) return "connecting";
  if (whoami.state === "authenticated") return "connected";
  return "disconnected";
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function LatticeRuntimeProvider({ children }: { children: ReactNode }) {
  const { api } = useAPI();

  // Core state
  const [info, setInfo] = useState<LatticeInfo | null>(null);
  const [whoami, setWhoami] = useState<LatticeWhoami | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  // Remote minions
  const [remoteMinions, setRemoteMinions] = useState<LatticeMinion[]>([]);
  const [remoteMinionsFetching, setRemoteMinionsFetching] = useState(false);
  const [remoteMinionError, setRemoteMinionError] = useState<string | null>(null);

  // Templates
  const [templates, setTemplates] = useState<LatticeTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Login dialog
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const connectionState = deriveConnectionState(info, whoami, infoLoading);

  // Refs for stable access in async callbacks
  const apiRef = useRef(api);
  apiRef.current = api;

  // ----- Fetch CLI info on mount -----
  const fetchInfo = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) return;
    setInfoLoading(true);
    try {
      const result = await currentApi.lattice.getInfo();
      setInfo(result);
    } catch {
      setInfo({ state: "unavailable", reason: { kind: "error", message: "Failed to fetch" } });
    } finally {
      setInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInfo();
  }, [fetchInfo, api]);

  // ----- Fetch whoami when CLI is available -----
  const fetchWhoami = useCallback(
    async (opts?: { refresh?: boolean }) => {
      const currentApi = apiRef.current;
      if (!currentApi) return;
      try {
        const result = await currentApi.lattice.whoami(opts?.refresh ? { refresh: true } : undefined);
        setWhoami(result);
      } catch {
        setWhoami({ state: "unauthenticated", reason: "Failed to check authentication" });
      }
    },
    []
  );

  useEffect(() => {
    if (info?.state === "available") {
      void fetchWhoami();
    }
  }, [info?.state, fetchWhoami]);

  // ----- Fetch templates when connected -----
  useEffect(() => {
    if (connectionState !== "connected" || !api) {
      setTemplates([]);
      setTemplatesError(null);
      return;
    }

    let mounted = true;
    setTemplatesLoading(true);
    setTemplatesError(null);

    api.lattice
      .listTemplates()
      .then((result) => {
        if (!mounted) return;
        if (result.ok) {
          setTemplates(result.templates);
          setTemplatesError(null);
        } else {
          setTemplates([]);
          setTemplatesError(result.error);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setTemplates([]);
        setTemplatesError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (mounted) setTemplatesLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [connectionState, api]);

  // ----- Fetch + poll remote minions when connected -----
  const fetchRemoteMinions = useCallback(async () => {
    const currentApi = apiRef.current;
    if (!currentApi) return;
    setRemoteMinionsFetching(true);
    setRemoteMinionError(null);
    try {
      const result = await currentApi.lattice.listMinions();
      if (result.ok) {
        setRemoteMinions(result.minions);
        setRemoteMinionError(null);
      } else {
        setRemoteMinions([]);
        setRemoteMinionError(result.error);
      }
    } catch (err) {
      setRemoteMinions([]);
      setRemoteMinionError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRemoteMinionsFetching(false);
    }
  }, []);

  useEffect(() => {
    if (connectionState !== "connected") {
      setRemoteMinions([]);
      setRemoteMinionError(null);
      return;
    }

    void fetchRemoteMinions();

    const interval = setInterval(() => {
      void fetchRemoteMinions();
    }, REMOTE_MINION_POLL_MS);

    return () => clearInterval(interval);
  }, [connectionState, fetchRemoteMinions]);

  // ----- Combined refresh (after login, etc.) -----
  const refresh = useCallback(() => {
    void fetchInfo();
    void fetchWhoami({ refresh: true });
  }, [fetchInfo, fetchWhoami]);

  // ----- Login dialog helpers -----
  const openLoginDialog = useCallback(() => setLoginDialogOpen(true), []);
  const closeLoginDialog = useCallback(() => setLoginDialogOpen(false), []);

  const value: LatticeRuntimeState = {
    info,
    whoami,
    connectionState,
    remoteMinions,
    remoteMinionsFetching,
    remoteMinionError,
    templates,
    templatesLoading,
    templatesError,
    refresh,
    refreshRemoteMinions: fetchRemoteMinions,
    loginDialogOpen,
    openLoginDialog,
    closeLoginDialog,
  };

  return (
    <LatticeRuntimeContext.Provider value={value}>
      {children}
    </LatticeRuntimeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLatticeRuntime(): LatticeRuntimeState {
  const ctx = useContext(LatticeRuntimeContext);
  if (!ctx) {
    throw new Error("useLatticeRuntime must be used within LatticeRuntimeProvider");
  }
  return ctx;
}
