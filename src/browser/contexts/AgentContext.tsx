import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { useAPI } from "@/browser/contexts/API";
import { usePersistedState } from "@/browser/hooks/usePersistedState";
import { CUSTOM_EVENTS, createCustomEvent } from "@/common/constants/events";
import { matchesKeybind, KEYBINDS } from "@/browser/utils/ui/keybinds";
import {
  getAgentIdKey,
  getProjectScopeId,
  getDisableMinionAgentsKey,
  GLOBAL_SCOPE_ID,
} from "@/common/constants/storage";
import type { AgentDefinitionDescriptor } from "@/common/types/agentDefinition";
import { sortAgentsStable } from "@/browser/utils/agents";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

export interface AgentContextValue {
  agentId: string;
  setAgentId: Dispatch<SetStateAction<string>>;
  /** The current agent's descriptor, or undefined if agents haven't loaded yet */
  currentAgent: AgentDefinitionDescriptor | undefined;
  agents: AgentDefinitionDescriptor[];
  loaded: boolean;
  loadFailed: boolean;
  /** Reload agent definitions from the backend */
  refresh: () => Promise<void>;
  /** True while a refresh is in progress */
  refreshing: boolean;
  /**
   * When true, agents are loaded from projectPath only (ignoring minion worktree).
   * Useful for unbricking when iterating on agent files in a minion.
   */
  disableMinionAgents: boolean;
  setDisableMinionAgents: Dispatch<SetStateAction<boolean>>;
}

const AgentContext = createContext<AgentContextValue | undefined>(undefined);

type AgentProviderProps =
  | { value: AgentContextValue; children: ReactNode }
  | { minionId?: string; projectPath?: string; children: ReactNode };

function getScopeId(minionId: string | undefined, projectPath: string | undefined): string {
  return minionId ?? (projectPath ? getProjectScopeId(projectPath) : GLOBAL_SCOPE_ID);
}

function coerceAgentId(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : MINION_DEFAULTS.agentId;
}

export function AgentProvider(props: AgentProviderProps) {
  if ("value" in props) {
    return <AgentContext.Provider value={props.value}>{props.children}</AgentContext.Provider>;
  }

  return <AgentProviderWithState {...props} />;
}

function AgentProviderWithState(props: {
  minionId?: string;
  projectPath?: string;
  children: ReactNode;
}) {
  const { api } = useAPI();

  const scopeId = getScopeId(props.minionId, props.projectPath);
  const isProjectScope = !props.minionId && Boolean(props.projectPath);

  const [globalDefaultAgentId] = usePersistedState<string>(
    getAgentIdKey(GLOBAL_SCOPE_ID),
    MINION_DEFAULTS.agentId,
    {
      listener: true,
    }
  );

  const [scopedAgentId, setAgentIdRaw] = usePersistedState<string | null>(
    getAgentIdKey(scopeId),
    isProjectScope ? null : MINION_DEFAULTS.agentId,
    {
      listener: true,
    }
  );

  const [disableMinionAgents, setDisableMinionAgents] = usePersistedState<boolean>(
    getDisableMinionAgentsKey(scopeId),
    false,
    { listener: true }
  );

  const setAgentId: Dispatch<SetStateAction<string>> = useCallback(
    (value) => {
      setAgentIdRaw((prev) => {
        const previousAgentId = coerceAgentId(
          isProjectScope ? (prev ?? globalDefaultAgentId) : prev
        );
        const next = typeof value === "function" ? value(previousAgentId) : value;
        return coerceAgentId(next);
      });
    },
    [globalDefaultAgentId, isProjectScope, setAgentIdRaw]
  );

  const [agents, setAgents] = useState<AgentDefinitionDescriptor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [refreshing, setRefreshing] = useState(false);

  const fetchParamsRef = useRef({
    projectPath: props.projectPath,
    minionId: props.minionId,
    disableMinionAgents,
  });

  const fetchAgents = useCallback(
    async (
      projectPath: string | undefined,
      minionId: string | undefined,
      minionAgentsDisabled: boolean
    ) => {
      fetchParamsRef.current = {
        projectPath,
        minionId,
        disableMinionAgents: minionAgentsDisabled,
      };

      if (!api || (!projectPath && !minionId)) {
        if (isMountedRef.current) {
          setAgents([]);
          setLoaded(true);
          setLoadFailed(false);
        }
        return;
      }

      try {
        const result = await api.agents.list({
          projectPath,
          minionId,
          disableMinionAgents: minionAgentsDisabled || undefined,
        });
        const current = fetchParamsRef.current;
        if (
          current.projectPath === projectPath &&
          current.minionId === minionId &&
          current.disableMinionAgents === minionAgentsDisabled &&
          isMountedRef.current
        ) {
          setAgents(result);
          setLoadFailed(false);
          setLoaded(true);
        }
      } catch {
        const current = fetchParamsRef.current;
        if (
          current.projectPath === projectPath &&
          current.minionId === minionId &&
          current.disableMinionAgents === minionAgentsDisabled &&
          isMountedRef.current
        ) {
          setAgents([]);
          setLoadFailed(true);
          setLoaded(true);
        }
      }
    },
    [api]
  );

  useEffect(() => {
    setAgents([]);
    setLoaded(false);
    setLoadFailed(false);
    void fetchAgents(props.projectPath, props.minionId, disableMinionAgents);
  }, [fetchAgents, props.projectPath, props.minionId, disableMinionAgents]);

  const refresh = useCallback(async () => {
    if (!props.projectPath && !props.minionId) return;
    if (!isMountedRef.current) return;

    setRefreshing(true);
    try {
      await fetchAgents(props.projectPath, props.minionId, disableMinionAgents);
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [fetchAgents, props.projectPath, props.minionId, disableMinionAgents]);

  const selectableAgents = useMemo(
    () => sortAgentsStable(agents.filter((a) => a.uiSelectable)),
    [agents]
  );

  const cycleToNextAgent = useCallback(() => {
    if (selectableAgents.length < 2) return;

    const activeAgentId = coerceAgentId(
      isProjectScope ? (scopedAgentId ?? globalDefaultAgentId) : scopedAgentId
    );
    const currentIndex = selectableAgents.findIndex((a) => a.id === activeAgentId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % selectableAgents.length;
    const nextAgent = selectableAgents[nextIndex];
    if (nextAgent) {
      setAgentId(nextAgent.id);
    }
  }, [globalDefaultAgentId, isProjectScope, scopedAgentId, selectableAgents, setAgentId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesKeybind(e, KEYBINDS.TOGGLE_AGENT)) {
        e.preventDefault();
        window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.OPEN_AGENT_PICKER));
        return;
      }

      if (matchesKeybind(e, KEYBINDS.CYCLE_AGENT)) {
        e.preventDefault();
        cycleToNextAgent();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cycleToNextAgent]);

  useEffect(() => {
    const handleRefreshRequested = () => {
      void refresh();
    };

    window.addEventListener(CUSTOM_EVENTS.AGENTS_REFRESH_REQUESTED, handleRefreshRequested);
    return () =>
      window.removeEventListener(CUSTOM_EVENTS.AGENTS_REFRESH_REQUESTED, handleRefreshRequested);
  }, [refresh]);

  // Project-scoped providers should inherit the global default agent until a
  // project-scoped preference is explicitly set.
  const normalizedAgentId = coerceAgentId(
    isProjectScope ? (scopedAgentId ?? globalDefaultAgentId) : scopedAgentId
  );
  const currentAgent = loaded ? agents.find((a) => a.id === normalizedAgentId) : undefined;

  const agentContextValue = useMemo(
    () => ({
      agentId: normalizedAgentId,
      setAgentId,
      currentAgent,
      agents,
      loaded,
      loadFailed,
      refresh,
      refreshing,
      disableMinionAgents,
      setDisableMinionAgents,
    }),
    [
      normalizedAgentId,
      setAgentId,
      currentAgent,
      agents,
      loaded,
      loadFailed,
      refresh,
      refreshing,
      disableMinionAgents,
      setDisableMinionAgents,
    ]
  );

  return <AgentContext.Provider value={agentContextValue}>{props.children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error("useAgent must be used within an AgentProvider");
  }
  return ctx;
}
