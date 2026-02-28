import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { ThinkingLevel } from "@/common/types/thinking";
import type { MinionSelection } from "@/browser/components/ProjectSidebar";
import type { RuntimeConfig } from "@/common/types/runtime";
import type { LatticeDeepLinkPayload } from "@/common/types/deepLink";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import {
  deleteMinionStorage,
  getAgentIdKey,
  getDraftScopeId,
  getInputAttachmentsKey,
  getInputKey,
  getModelKey,
  getPendingScopeId,
  getWorkbenchPanelLayoutKey,
  getTerminalTitlesKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
  getMinionNameStateKey,
  migrateMinionStorage,
  AGENT_AI_DEFAULTS_KEY,
  DEFAULT_MODEL_KEY,
  DEFAULT_RUNTIME_KEY,
  HIDDEN_MODELS_KEY,
  PREFERRED_COMPACTION_MODEL_KEY,
  RUNTIME_ENABLEMENT_KEY,
  SELECTED_MINION_KEY,
  MINION_DRAFTS_BY_PROJECT_KEY,
} from "@/common/constants/storage";
import { useAPI } from "@/browser/contexts/API";
import { setMinionModelWithOrigin } from "@/browser/utils/modelChange";
import {
  readPersistedState,
  readPersistedString,
  updatePersistedState,
  usePersistedState,
} from "@/browser/hooks/usePersistedState";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useMinionStoreRaw } from "@/browser/stores/MinionStore";
import { isTerminalTab } from "@/browser/types/workbenchPanel";
import {
  collectAllTabs,
  isWorkbenchPanelLayoutState,
  removeTabEverywhere,
} from "@/browser/utils/workbenchPanelLayout";
import { normalizeAgentAiDefaults } from "@/common/types/agentAiDefaults";
import { isMinionArchived } from "@/common/utils/archive";
import { getProjectRouteId } from "@/common/utils/projectRouteId";
import { resolveProjectPathFromProjectQuery } from "@/common/utils/deepLink";
import { shouldApplyMinionAiSettingsFromBackend } from "@/browser/utils/minionAiSettingsSync";
import { isAbortError } from "@/browser/utils/isAbortError";
import { findAdjacentMinionId } from "@/browser/utils/ui/minionDomNav";
import { useRouter } from "@/browser/contexts/RouterContext";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";
import type { APIClient } from "@/browser/contexts/API";
import { getErrorMessage } from "@/common/utils/errors";

/**
 * One-time best-effort migration: if the backend doesn't have model preferences yet,
 * persist non-default localStorage values so future port/origin changes keep them.
 * Called once on startup after backend config is fetched.
 */
function migrateLocalModelPrefsToBackend(
  api: APIClient,
  cfg: { defaultModel?: string; hiddenModels?: string[]; preferredCompactionModel?: string }
): void {
  if (!api.config.updateModelPreferences) return;

  const localDefaultModelRaw = readPersistedString(DEFAULT_MODEL_KEY);
  const localDefaultModel =
    typeof localDefaultModelRaw === "string"
      ? localDefaultModelRaw.trim()
      : undefined;
  const localHiddenModels = readPersistedState<string[] | null>(HIDDEN_MODELS_KEY, null);
  const localPreferredCompactionModel = readPersistedString(PREFERRED_COMPACTION_MODEL_KEY);

  const patch: {
    defaultModel?: string;
    hiddenModels?: string[];
    preferredCompactionModel?: string;
  } = {};

  if (
    cfg.defaultModel === undefined &&
    localDefaultModel &&
    localDefaultModel !== MINION_DEFAULTS.model
  ) {
    patch.defaultModel = localDefaultModel;
  }

  if (
    cfg.hiddenModels === undefined &&
    Array.isArray(localHiddenModels) &&
    localHiddenModels.length > 0
  ) {
    patch.hiddenModels = localHiddenModels;
  }

  if (
    cfg.preferredCompactionModel === undefined &&
    typeof localPreferredCompactionModel === "string" &&
    localPreferredCompactionModel.trim()
  ) {
    patch.preferredCompactionModel = localPreferredCompactionModel;
  }

  if (Object.keys(patch).length > 0) {
    api.config.updateModelPreferences(patch).catch(() => {
      // Best-effort only.
    });
  }
}

/**
 * Seed per-minion localStorage from backend minion metadata.
 *
 * This keeps a minion's model/thinking consistent across devices/browsers.
 */
function seedMinionLocalStorageFromBackend(metadata: FrontendMinionMetadata): void {
  // Cache keyed by agentId (string) - includes exec, plan, and custom agents
  type MinionAISettingsByAgentCache = Partial<
    Record<string, { model: string; thinkingLevel: ThinkingLevel }>
  >;

  const minionId = metadata.id;

  // Seed the minion agentId (tasks/sidekicks) so the UI renders correctly on reload.
  // Main minions default to the locally-selected agentId (stored in localStorage).
  const metadataAgentId = metadata.agentId ?? metadata.agentType;
  if (typeof metadataAgentId === "string" && metadataAgentId.trim().length > 0) {
    const key = getAgentIdKey(minionId);
    const normalized = metadataAgentId.trim().toLowerCase();
    const existing = readPersistedState<string | undefined>(key, undefined);
    if (existing !== normalized) {
      updatePersistedState(key, normalized);
    }
  }

  const aiByAgent =
    metadata.aiSettingsByAgent ??
    (metadata.aiSettings
      ? {
          plan: metadata.aiSettings,
          exec: metadata.aiSettings,
        }
      : undefined);

  if (!aiByAgent) {
    return;
  }

  // Merge backend values into a per-minion per-agent cache.
  const byAgentKey = getMinionAISettingsByAgentKey(minionId);
  const existingByAgent = readPersistedState<MinionAISettingsByAgentCache>(byAgentKey, {});
  const nextByAgent: MinionAISettingsByAgentCache = { ...existingByAgent };

  for (const [agentKey, entry] of Object.entries(aiByAgent)) {
    if (!entry) continue;
    if (typeof entry.model !== "string" || entry.model.length === 0) continue;

    // Protect newer local preferences from stale metadata updates (e.g., rapid thinking toggles).
    if (
      !shouldApplyMinionAiSettingsFromBackend(minionId, agentKey, {
        model: entry.model,
        thinkingLevel: entry.thinkingLevel,
      })
    ) {
      continue;
    }

    nextByAgent[agentKey] = {
      model: entry.model,
      thinkingLevel: entry.thinkingLevel,
    };
  }

  if (JSON.stringify(existingByAgent) !== JSON.stringify(nextByAgent)) {
    updatePersistedState(byAgentKey, nextByAgent);
  }

  // Seed the active agent into the existing keys to avoid UI flash.
  const activeAgentId = readPersistedState<string>(
    getAgentIdKey(minionId),
    MINION_DEFAULTS.agentId
  );
  const active = nextByAgent[activeAgentId] ?? nextByAgent.exec ?? nextByAgent.plan;
  if (!active) {
    return;
  }

  const modelKey = getModelKey(minionId);
  const existingModel = readPersistedState<string | undefined>(modelKey, undefined);
  if (existingModel !== active.model) {
    setMinionModelWithOrigin(minionId, active.model, "sync");
  }

  const thinkingKey = getThinkingLevelKey(minionId);
  const existingThinking = readPersistedState<ThinkingLevel | undefined>(thinkingKey, undefined);
  if (existingThinking !== active.thinkingLevel) {
    updatePersistedState(thinkingKey, active.thinkingLevel);
  }
}

export function toMinionSelection(metadata: FrontendMinionMetadata): MinionSelection {
  return {
    minionId: metadata.id,
    projectPath: metadata.projectPath,
    projectName: metadata.projectName,
    namedMinionPath: metadata.namedMinionPath,
  };
}

/**
 * Ensure minion metadata has createdAt timestamp.
 * DEFENSIVE: Backend guarantees createdAt, but default to 2025-01-01 if missing.
 * This prevents crashes if backend contract is violated.
 */
function ensureCreatedAt(metadata: FrontendMinionMetadata): void {
  if (!metadata.createdAt) {
    console.warn(
      `[Frontend] Minion ${metadata.id} missing createdAt - using default (2025-01-01)`
    );
    metadata.createdAt = "2025-01-01T00:00:00.000Z";
  }
}

export interface MinionDraft {
  draftId: string;
  crewId: string | null;
  createdAt: number;
}

type MinionDraftsByProject = Record<string, MinionDraft[]>;

type MinionDraftPromotionsByProject = Record<string, Record<string, FrontendMinionMetadata>>;

function isMinionDraft(value: unknown): value is MinionDraft {
  if (!value || typeof value !== "object") return false;

  const record = value as { draftId?: unknown; crewId?: unknown; createdAt?: unknown };
  return (
    typeof record.draftId === "string" &&
    record.draftId.trim().length > 0 &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt) &&
    (record.crewId === null ||
      record.crewId === undefined ||
      typeof record.crewId === "string")
  );
}

function normalizeMinionDraftsByProject(value: unknown): MinionDraftsByProject {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: MinionDraftsByProject = {};

  for (const [projectPath, drafts] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(drafts)) continue;

    const nextDrafts: MinionDraft[] = [];
    for (const draft of drafts) {
      if (!isMinionDraft(draft)) continue;

      const normalizedSectionId =
        typeof draft.crewId === "string" && draft.crewId.trim().length > 0
          ? draft.crewId
          : null;

      nextDrafts.push({
        draftId: draft.draftId,
        crewId: normalizedSectionId,
        createdAt: draft.createdAt,
      });
    }

    if (nextDrafts.length > 0) {
      result[projectPath] = nextDrafts;
    }
  }

  return result;
}

function normalizeProjectPathForComparison(projectPath: string): string {
  let normalized = projectPath.trim();

  // Be forgiving: lattice:// links may include trailing path separators.
  normalized = normalized.replace(/[\\/]+$/, "");

  // Paths are case-insensitive on Windows.
  if (globalThis.window?.api?.platform === "win32") {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

function createMinionDraftId(): string {
  const maybeCrypto = globalThis.crypto;
  if (maybeCrypto && typeof maybeCrypto.randomUUID === "function") {
    const id = maybeCrypto.randomUUID();
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Check if a draft minion is empty (no input text, no attachments, and no minion name set).
 * An empty draft can be reused when the user clicks "New Minion" instead of creating another.
 */
function isDraftEmpty(projectPath: string, draftId: string): boolean {
  const scopeId = getDraftScopeId(projectPath, draftId);

  // Check for input text
  const inputText = readPersistedState<string>(getInputKey(scopeId), "");
  if (inputText.trim().length > 0) {
    return false;
  }

  // Check for attachments
  const attachments = readPersistedState<unknown[]>(getInputAttachmentsKey(scopeId), []);
  if (Array.isArray(attachments) && attachments.length > 0) {
    return false;
  }

  // Check for minion name state (auto-generated or manual)
  const nameState = readPersistedState<unknown>(getMinionNameStateKey(scopeId), null);
  if (nameState !== null) {
    return false;
  }

  return true;
}

/**
 * Find an existing empty draft for a project (optionally within a specific crew).
 * Returns the draft ID if found, or null if no empty draft exists.
 */
function findExistingEmptyDraft(
  minionDrafts: MinionDraft[],
  projectPath: string,
  crewId?: string
): string | null {
  const normalizedSectionId = crewId ?? null;

  for (const draft of minionDrafts) {
    // Keep draft reuse scoped to the current section. When crewId is undefined
    // (project-level "New Minion"), only reuse drafts with a null crew so
    // we don't silently move crew-specific drafts into the root flow.
    if ((draft.crewId ?? null) !== normalizedSectionId) {
      continue;
    }
    if (isDraftEmpty(projectPath, draft.draftId)) {
      return draft.draftId;
    }
  }
  return null;
}

// ─── Metadata context (changes on every minion create/archive/rename) ─────
// Separated so components that only need actions/selection don't re-render on
// metadata map changes.

export interface MinionMetadataContextValue {
  minionMetadata: Map<string, FrontendMinionMetadata>;
  loading: boolean;
}

const MinionMetadataContext = createContext<MinionMetadataContextValue | undefined>(
  undefined
);

// ─── Actions context (stable unless selection/drafts change) ─────────────────

export interface MinionContext extends MinionMetadataContextValue {
  // UI-only draft minion promotions (draftId -> created minion).
  // This is intentionally ephemeral: it makes the sidebar feel like the draft
  // "turns into" the created minion, but doesn't pin ordering permanently.
  minionDraftPromotionsByProject: MinionDraftPromotionsByProject;
  promoteMinionDraft: (
    projectPath: string,
    draftId: string,
    metadata: FrontendMinionMetadata
  ) => void;

  // Minion operations
  createMinion: (
    projectPath: string,
    branchName: string,
    trunkBranch: string,
    runtimeConfig?: RuntimeConfig
  ) => Promise<{
    projectPath: string;
    projectName: string;
    namedMinionPath: string;
    minionId: string;
  }>;
  removeMinion: (
    minionId: string,
    options?: { force?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
  updateMinionTitle: (
    minionId: string,
    newTitle: string
  ) => Promise<{ success: boolean; error?: string }>;
  archiveMinion: (minionId: string) => Promise<{ success: boolean; error?: string }>;
  unarchiveMinion: (minionId: string) => Promise<{ success: boolean; error?: string }>;
  refreshMinionMetadata: () => Promise<void>;
  setMinionMetadata: React.Dispatch<
    React.SetStateAction<Map<string, FrontendMinionMetadata>>
  >;

  // Selection
  selectedMinion: MinionSelection | null;
  setSelectedMinion: React.Dispatch<React.SetStateAction<MinionSelection | null>>;

  // Minion creation flow
  pendingNewMinionProject: string | null;
  /** Crew ID to pre-select when creating a new minion (from URL) */
  pendingNewMinionSectionId: string | null;
  /** Draft ID to open when creating a UI-only minion draft (from URL) */
  pendingNewMinionDraftId: string | null;
  /** Legacy entry point: open the creation screen (no new draft is created) */
  beginMinionCreation: (projectPath: string, crewId?: string) => void;

  // UI-only minion creation drafts (placeholders)
  minionDraftsByProject: MinionDraftsByProject;
  createMinionDraft: (projectPath: string, crewId?: string) => void;
  updateMinionDraftSection: (
    projectPath: string,
    draftId: string,
    crewId: string | null
  ) => void;
  openMinionDraft: (projectPath: string, draftId: string, crewId?: string | null) => void;
  deleteMinionDraft: (projectPath: string, draftId: string) => void;

  // Helpers
  getMinionInfo: (minionId: string) => Promise<FrontendMinionMetadata | null>;
}

const MinionActionsContext = createContext<
  Omit<MinionContext, "minionMetadata" | "loading"> | undefined
>(undefined);

interface MinionProviderProps {
  children: ReactNode;
}

export function MinionProvider(props: MinionProviderProps) {
  const { api } = useAPI();

  // Cache global agent defaults (plus legacy mode defaults) so non-react code paths can read them.
  useEffect(() => {
    if (!api?.config?.getConfig) return;

    void api.config
      .getConfig()
      .then((cfg) => {
        updatePersistedState(
          AGENT_AI_DEFAULTS_KEY,
          normalizeAgentAiDefaults(cfg.agentAiDefaults ?? {})
        );

        // Seed global model preferences from backend so switching ports doesn't reset the UI.
        if (cfg.defaultModel !== undefined) {
          updatePersistedState(DEFAULT_MODEL_KEY, cfg.defaultModel);
        }
        if (cfg.hiddenModels !== undefined) {
          updatePersistedState(HIDDEN_MODELS_KEY, cfg.hiddenModels);
        }
        if (cfg.preferredCompactionModel !== undefined) {
          updatePersistedState(PREFERRED_COMPACTION_MODEL_KEY, cfg.preferredCompactionModel);
        }

        // Seed runtime enablement from backend so switching ports doesn't reset the UI.
        if (cfg.runtimeEnablement !== undefined) {
          updatePersistedState(RUNTIME_ENABLEMENT_KEY, cfg.runtimeEnablement);
        }

        // Seed global default runtime so minion defaults survive port changes.
        if (cfg.defaultRuntime !== undefined) {
          updatePersistedState(DEFAULT_RUNTIME_KEY, cfg.defaultRuntime);
        }

        // One-time best-effort migration: if the backend doesn't have model prefs yet,
        // persist non-default localStorage values so future port changes keep them.
        migrateLocalModelPrefsToBackend(api, cfg);

      })
      .catch(() => {
        // Best-effort only.
      });
  }, [api]);
  // Get project refresh function from ProjectContext
  const { projects, refreshProjects, loading: projectsLoading } = useProjectContext();
  // Get router navigation functions and current route state
  const {
    navigateToMinion,
    navigateToProject,
    navigateToHome,
    currentMinionId,
    currentProjectId,
    currentProjectPathFromState,
    currentSettingsSection,
    isAnalyticsOpen,
    pendingSectionId,
    pendingDraftId,
  } = useRouter();

  const minionStore = useMinionStoreRaw();

  useLayoutEffect(() => {
    // When the user navigates to settings, currentMinionId becomes null
    // (URL is /settings/...). Preserve the active minion subscription so
    // chat messages aren't cleared. Only null it out when truly leaving a
    // minion context (e.g., navigating to Home).
    if (currentMinionId) {
      minionStore.setActiveMinionId(currentMinionId);
    } else if (!currentSettingsSection && !isAnalyticsOpen) {
      // Only null out the active minion when truly leaving a minion
      // context (e.g., navigating to Home). Settings and analytics pages
      // should preserve the subscription so chat messages aren't cleared.
      minionStore.setActiveMinionId(null);
    }
  }, [minionStore, currentMinionId, currentSettingsSection, isAnalyticsOpen]);
  const [minionMetadata, setMinionMetadataState] = useState<
    Map<string, FrontendMinionMetadata>
  >(new Map());
  const setMinionMetadata = useCallback(
    (update: SetStateAction<Map<string, FrontendMinionMetadata>>) => {
      setMinionMetadataState((prev) => {
        const next = typeof update === "function" ? update(prev) : update;
        // IMPORTANT: Sync the imperative MinionStore first so hooks (AIView,
        // LeftSidebar, etc.) never render with a selected minion ID before
        // the store has subscribed and created its aggregator. Otherwise the
        // render path hits MinionStore.assertGet() and throws the
        // "Minion <id> not found - must call addMinion() first" assert.
        minionStore.syncMinions(next);
        return next;
      });
    },
    [minionStore]
  );
  const [loading, setLoading] = useState(true);

  const [minionDraftPromotionsByProject, setMinionDraftPromotionsByProject] =
    useState<MinionDraftPromotionsByProject>({});
  const [minionDraftsByProjectState, setMinionDraftsByProjectState] =
    usePersistedState<MinionDraftsByProject>(
      MINION_DRAFTS_BY_PROJECT_KEY,
      {},
      { listener: true }
    );

  const minionDraftsByProject = useMemo(
    () => normalizeMinionDraftsByProject(minionDraftsByProjectState),
    [minionDraftsByProjectState]
  );

  const pendingDeepLinksRef = useRef<LatticeDeepLinkPayload[]>([]);

  const handleDeepLink = useCallback(
    (payload: LatticeDeepLinkPayload) => {
      if (payload.type !== "new_chat") {
        return;
      }

      let resolvedProjectPath: string | null = null;

      const projectPathFromPayload =
        typeof payload.projectPath === "string" && payload.projectPath.trim().length > 0
          ? payload.projectPath
          : null;

      if (projectPathFromPayload) {
        const target = normalizeProjectPathForComparison(projectPathFromPayload);

        for (const projectPath of projects.keys()) {
          if (normalizeProjectPathForComparison(projectPath) === target) {
            resolvedProjectPath = projectPath;
            break;
          }
        }
      }

      const projectIdFromPayload =
        resolvedProjectPath === null &&
        typeof payload.projectId === "string" &&
        payload.projectId.trim().length > 0
          ? payload.projectId
          : null;

      if (projectIdFromPayload) {
        for (const projectPath of projects.keys()) {
          if (getProjectRouteId(projectPath) === projectIdFromPayload) {
            resolvedProjectPath = projectPath;
            break;
          }
        }
      }

      const projectQueryFromPayload =
        resolvedProjectPath === null &&
        typeof payload.project === "string" &&
        payload.project.trim().length > 0
          ? payload.project
          : null;

      // Back-compat/ergonomics: if a deep link passed a projectPath that doesn't match
      // exactly (e.g., different machine), still try matching by its final path segment.
      const inferredProjectQueryFromPath =
        resolvedProjectPath === null && projectQueryFromPayload === null && projectPathFromPayload
          ? projectPathFromPayload
          : null;

      const projectQuery = projectQueryFromPayload ?? inferredProjectQueryFromPath;
      if (resolvedProjectPath === null && projectQuery) {
        resolvedProjectPath = resolveProjectPathFromProjectQuery(projects.keys(), projectQuery);
      }

      // If no project is specified (or matching failed), default to the first project in the list.
      if (resolvedProjectPath === null) {
        const firstProjectPath = projects.keys().next().value;
        if (typeof firstProjectPath === "string") {
          resolvedProjectPath = firstProjectPath;
        }
      }

      if (!resolvedProjectPath) {
        // Startup deep links can arrive before the projects list is populated.
        //
        // NOTE: ProjectContext can set `projectsLoading=false` even when the API isn't
        // connected yet (refreshProjects() returns early but the effect still flips loading).
        // In that window, buffer unresolved links in-memory and retry once projects load.
        const shouldBuffer = projectsLoading || !api || projects.size === 0;
        if (shouldBuffer) {
          const queue = pendingDeepLinksRef.current;
          if (queue.length >= 10) {
            queue.shift();
          }
          queue.push(payload);
        }
        return;
      }

      const normalizedSectionId =
        typeof payload.crewId === "string" && payload.crewId.trim().length > 0
          ? payload.crewId
          : null;

      // IMPORTANT: Deep links should always create a fresh draft, even if an existing draft
      // is empty. This keeps deep-link navigations predictable and avoids surprising reuse.
      const draftId = createMinionDraftId();
      const createdAt = Date.now();

      setMinionDraftsByProjectState((prev) => {
        const current = normalizeMinionDraftsByProject(prev);
        const existing = current[resolvedProjectPath] ?? [];

        return {
          ...current,
          [resolvedProjectPath]: [
            ...existing,
            {
              draftId,
              crewId: normalizedSectionId,
              createdAt,
            },
          ],
        };
      });

      const prompt =
        typeof payload.prompt === "string" && payload.prompt.trim().length > 0
          ? payload.prompt
          : null;

      if (prompt) {
        updatePersistedState(getInputKey(getDraftScopeId(resolvedProjectPath, draftId)), prompt);
      }

      navigateToProject(resolvedProjectPath, normalizedSectionId ?? undefined, draftId);
    },
    [api, navigateToProject, projects, projectsLoading, setMinionDraftsByProjectState]
  );

  const deepLinkHandlerRef = useRef(handleDeepLink);
  deepLinkHandlerRef.current = handleDeepLink;

  useEffect(() => {
    const unsubscribe = window.api?.onDeepLink?.((payload) => {
      deepLinkHandlerRef.current(payload);
    });

    const pending = window.api?.consumePendingDeepLinks?.() ?? [];
    for (const payload of pending) {
      deepLinkHandlerRef.current(payload);
    }

    return () => {
      unsubscribe?.();
    };
  }, [deepLinkHandlerRef]);

  useEffect(() => {
    if (pendingDeepLinksRef.current.length === 0) {
      return;
    }

    const queued = pendingDeepLinksRef.current;
    pendingDeepLinksRef.current = [];

    for (const payload of queued) {
      deepLinkHandlerRef.current(payload);
    }
  }, [projects, projectsLoading, deepLinkHandlerRef]);

  // Clean up promotions that point at removed drafts or archived minions so
  // promoted entries never hide the real minion list.
  useEffect(() => {
    if (loading) {
      return;
    }

    setMinionDraftPromotionsByProject((prev) => {
      let changed = false;
      const next: MinionDraftPromotionsByProject = {};

      for (const [projectPath, promotions] of Object.entries(prev)) {
        const draftIds = new Set(
          (minionDraftsByProject[projectPath] ?? []).map((draft) => draft.draftId)
        );
        if (draftIds.size === 0) {
          if (Object.keys(promotions).length > 0) {
            changed = true;
          }
          continue;
        }

        const nextPromotions: Record<string, FrontendMinionMetadata> = {};
        for (const [draftId, metadata] of Object.entries(promotions)) {
          if (!draftIds.has(draftId)) {
            changed = true;
            continue;
          }

          const liveMetadata = minionMetadata.get(metadata.id);
          if (!liveMetadata) {
            changed = true;
            continue;
          }

          nextPromotions[draftId] = liveMetadata;
        }

        if (Object.keys(nextPromotions).length > 0) {
          next[projectPath] = nextPromotions;
          if (Object.keys(nextPromotions).length !== Object.keys(promotions).length) {
            changed = true;
          }
        } else if (Object.keys(promotions).length > 0) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [loading, minionDraftsByProject, minionMetadata]);

  const currentProjectPath = useMemo(() => {
    if (currentProjectPathFromState) return currentProjectPathFromState;
    if (!currentProjectId) return null;

    // Legacy: older deep links stored the full path under ?path=...
    if (projects.has(currentProjectId)) {
      return currentProjectId;
    }

    // Current: project ids are derived from the configured project path.
    for (const projectPath of projects.keys()) {
      if (getProjectRouteId(projectPath) === currentProjectId) {
        return projectPath;
      }
    }

    return null;
  }, [currentProjectId, currentProjectPathFromState, projects]);

  // pendingNewMinionProject is derived from current project in URL/state
  const pendingNewMinionProject = currentProjectPath;
  // pendingNewMinionSectionId is derived from crew URL param
  const pendingNewMinionSectionId = pendingSectionId;
  const pendingNewMinionDraftId = pendingNewMinionProject ? pendingDraftId : null;

  // selectedMinion is derived from currentMinionId in URL + minionMetadata
  const selectedMinion = useMemo(() => {
    if (!currentMinionId) return null;
    const metadata = minionMetadata.get(currentMinionId);
    if (!metadata) return null;
    return toMinionSelection(metadata);
  }, [currentMinionId, minionMetadata]);

  // Keep a ref to the current selectedMinion for use in functional updates.
  // Update synchronously so route-driven selection changes are visible before
  // any async creation callbacks decide whether to auto-navigate.
  const selectedMinionRef = useRef(selectedMinion);
  selectedMinionRef.current = selectedMinion;

  // setSelectedMinion navigates to the minion URL (or clears if null)
  const setSelectedMinion = useCallback(
    (update: SetStateAction<MinionSelection | null>) => {
      // Handle functional updates by resolving against the ref (always fresh)
      const current = selectedMinionRef.current;
      const newValue = typeof update === "function" ? update(current) : update;

      // Keep the ref in sync immediately so async handlers (metadata events, etc.) can
      // reliably see the user's latest navigation intent.
      selectedMinionRef.current = newValue;

      if (newValue) {
        navigateToMinion(newValue.minionId);
        // Persist to localStorage for next session
        updatePersistedState(SELECTED_MINION_KEY, newValue);
      } else {
        navigateToHome();
        updatePersistedState(SELECTED_MINION_KEY, null);
      }
    },
    [navigateToMinion, navigateToHome]
  );

  /**
   * Clear the minion selection and navigate to a specific project page
   * instead of home.  Use this when deselecting a minion where we know
   * which project the user was working in (archive, delete fallback, etc.).
   */
  const clearSelectionToProject = useCallback(
    (projectPath: string) => {
      selectedMinionRef.current = null;
      updatePersistedState(SELECTED_MINION_KEY, null);
      navigateToProject(projectPath);
    },
    [navigateToProject]
  );

  // Used by async subscription handlers to safely access the most recent metadata map
  // without triggering render-phase state updates.
  const minionMetadataRef = useRef(minionMetadata);
  useEffect(() => {
    minionMetadataRef.current = minionMetadata;
  }, [minionMetadata]);

  const initialMinionResolvedRef = useRef(false);

  useEffect(() => {
    if (loading) return;
    if (!currentMinionId) return;

    if (currentMinionId === LATTICE_HELP_CHAT_MINION_ID) {
      initialMinionResolvedRef.current = true;
      return;
    }

    if (minionMetadata.has(currentMinionId)) {
      initialMinionResolvedRef.current = true;
      return;
    }

    // Only auto-redirect on initial restore so we don't fight archive/delete navigation.
    if (initialMinionResolvedRef.current) return;

    const latticeChatMetadata = minionMetadata.get(LATTICE_HELP_CHAT_MINION_ID);
    if (!latticeChatMetadata) return;

    // If the last-restored minion no longer exists, recover to lattice-chat instead
    // of leaving the user on a dead-end "Minion not found" screen.
    initialMinionResolvedRef.current = true;
    setSelectedMinion(toMinionSelection(latticeChatMetadata));
  }, [currentMinionId, loading, setSelectedMinion, minionMetadata]);

  const loadMinionMetadata = useCallback(async () => {
    if (!api) return false; // Return false to indicate metadata wasn't loaded
    try {
      const metadataList = await api.minion.list();
      const metadataMap = new Map<string, FrontendMinionMetadata>();
      for (const metadata of metadataList) {
        // Skip archived minions - they should not be tracked by the app
        if (isMinionArchived(metadata.archivedAt, metadata.unarchivedAt)) continue;
        ensureCreatedAt(metadata);
        // Use stable minion ID as key (not path, which can change)
        seedMinionLocalStorageFromBackend(metadata);
        metadataMap.set(metadata.id, metadata);
      }
      setMinionMetadata(metadataMap);
      return true; // Return true to indicate metadata was loaded
    } catch (error) {
      console.error("Failed to load minion metadata:", error);
      setMinionMetadata(new Map());
      return true; // Still return true - we tried to load, just got empty result
    }
  }, [setMinionMetadata, api]);

  // Load metadata once on mount (and again when api becomes available)
  useEffect(() => {
    void (async () => {
      const loaded = await loadMinionMetadata();
      if (!loaded) {
        // api not available yet - effect will run again when api connects
        return;
      }
      // After loading metadata (which may trigger migration), reload projects
      // to ensure frontend has the updated config with minion IDs
      await refreshProjects();
      setLoading(false);
    })();
  }, [loadMinionMetadata, refreshProjects]);

  // URL restoration is now handled by RouterContext which parses the URL on load
  // and provides currentMinionId/currentProjectId that we derive state from.

  // Check for launch project from server (for --add-project flag)
  // This only applies in server mode, runs after metadata loads
  useEffect(() => {
    if (loading || !api) return;

    // Skip if we already have a selected minion (from localStorage or URL hash)
    if (selectedMinion) return;

    // Skip if user is on the settings or analytics page — navigating to
    // /settings/:crew or /analytics clears the minion from the URL,
    // making selectedMinion null. Without this guard the effect would
    // auto-select a minion and navigate away immediately.
    if (currentSettingsSection) return;
    if (isAnalyticsOpen) return;

    // Skip if user is in the middle of creating a minion
    if (pendingNewMinionProject) return;

    let cancelled = false;

    const checkLaunchProject = async () => {
      // Only available in server mode (checked via platform/capabilities in future)
      // For now, try the call - it will return null if not applicable
      try {
        const launchProjectPath = await api.server.getLaunchProject(undefined);
        if (cancelled || !launchProjectPath) return;

        // Find first minion in this project
        const projectMinions = Array.from(minionMetadata.values()).filter(
          (meta) => meta.projectPath === launchProjectPath
        );

        if (cancelled || projectMinions.length === 0) return;

        // Select the first minion in the project.
        // Use functional update to avoid race: user may have clicked a minion
        // while this async call was in flight.
        const metadata = projectMinions[0];
        setSelectedMinion((current) => current ?? toMinionSelection(metadata));
      } catch (error) {
        if (!cancelled) {
          // Ignore errors (e.g. method not found if running against old backend)
          console.debug("Failed to check launch project:", error);
        }
      }
      // If no minions exist yet, just leave the project in the sidebar
      // The user will need to create a minion
    };

    void checkLaunchProject();

    return () => {
      cancelled = true;
    };
  }, [
    api,
    loading,
    selectedMinion,
    currentSettingsSection,
    isAnalyticsOpen,
    pendingNewMinionProject,
    minionMetadata,
    setSelectedMinion,
  ]);

  // Subscribe to metadata updates (for create/rename/delete operations)
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      try {
        const iterator = await api.minion.onMetadata(undefined, { signal });

        for await (const event of iterator) {
          if (signal.aborted) break;

          const meta = event.metadata;

          // 1. ALWAYS normalize incoming metadata first - this is the critical data update.
          if (meta !== null) {
            ensureCreatedAt(meta);
            seedMinionLocalStorageFromBackend(meta);
          }

          const isNowArchived =
            meta !== null && isMinionArchived(meta.archivedAt, meta.unarchivedAt);

          // If the currently-selected minion is being archived, navigate away *before*
          // removing it from the active metadata map. Otherwise we can briefly render the
          // welcome screen while still on `/minion/:id`.
          //
          // Prefer the next minion in sidebar DOM order (like Ctrl+J) so the user
          // stays in flow; fall back to the project page when no siblings remain.
          if (meta !== null && isNowArchived) {
            const currentSelection = selectedMinionRef.current;
            if (currentSelection?.minionId === event.minionId) {
              const nextId = findAdjacentMinionId(event.minionId);
              const nextMeta = nextId ? minionMetadataRef.current.get(nextId) : null;

              if (nextMeta) {
                setSelectedMinion(toMinionSelection(nextMeta));
              } else {
                clearSelectionToProject(meta.projectPath);
              }
            }
          }

          // Capture deleted minion info before removing from map (needed for navigation)
          const deletedMeta =
            meta === null ? minionMetadataRef.current.get(event.minionId) : null;

          setMinionMetadata((prev) => {
            const updated = new Map(prev);
            const isNewMinion = !prev.has(event.minionId) && meta !== null;
            const existingMeta = prev.get(event.minionId);
            const wasInitializing = existingMeta?.isInitializing === true;
            const isNowReady = meta !== null && meta.isInitializing !== true;

            if (meta === null || isNowArchived) {
              // Remove deleted or newly-archived minions from active map
              updated.delete(event.minionId);
            } else {
              // Only add/update non-archived minions (including unarchived ones)
              updated.set(event.minionId, meta);
            }

            // Reload projects when:
            // 1. New minion appears (e.g., from fork)
            // 2. Minion transitions from initializing to ready (init completed)
            if (isNewMinion || (wasInitializing && isNowReady)) {
              void refreshProjects();
            }

            return updated;
          });

          // 2. THEN handle side effects (cleanup, navigation) - these can't break data updates
          if (meta === null) {
            deleteMinionStorage(event.minionId);

            // Navigate away only if the deleted minion was selected
            const currentSelection = selectedMinionRef.current;
            if (currentSelection?.minionId !== event.minionId) continue;

            // Try parent minion first
            const parentMinionId = deletedMeta?.parentMinionId;
            const parentMeta = parentMinionId
              ? minionMetadataRef.current.get(parentMinionId)
              : null;

            if (parentMeta) {
              setSelectedMinion({
                minionId: parentMeta.id,
                projectPath: parentMeta.projectPath,
                projectName: parentMeta.projectName,
                namedMinionPath: parentMeta.namedMinionPath,
              });
              continue;
            }

            // Try sibling minion in same project
            const projectPath = deletedMeta?.projectPath;
            const fallbackMeta =
              (projectPath
                ? Array.from(minionMetadataRef.current.values()).find(
                    (meta) => meta.projectPath === projectPath && meta.id !== event.minionId
                  )
                : null) ??
              Array.from(minionMetadataRef.current.values()).find(
                (meta) => meta.id !== event.minionId
              );

            if (fallbackMeta) {
              setSelectedMinion(toMinionSelection(fallbackMeta));
            } else if (projectPath) {
              clearSelectionToProject(projectPath);
            } else {
              setSelectedMinion(null);
            }
          }
        }
      } catch (err) {
        if (!signal.aborted && !isAbortError(err)) {
          console.error("Failed to subscribe to metadata:", err);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [clearSelectionToProject, refreshProjects, setSelectedMinion, setMinionMetadata, api]);

  const createMinion = useCallback(
    async (
      projectPath: string,
      branchName: string,
      trunkBranch: string,
      runtimeConfig?: RuntimeConfig
    ) => {
      if (!api) throw new Error("API not connected");
      console.assert(
        typeof trunkBranch === "string" && trunkBranch.trim().length > 0,
        "Expected trunk branch to be provided when summoning a minion"
      );
      const result = await api.minion.create({
        projectPath,
        branchName,
        trunkBranch,
        runtimeConfig,
      });
      if (result.success) {
        // Backend has already updated the config - reload projects to get updated state
        await refreshProjects();

        // Update metadata immediately to avoid race condition with validation effect
        ensureCreatedAt(result.metadata);
        seedMinionLocalStorageFromBackend(result.metadata);
        setMinionMetadata((prev) => {
          const updated = new Map(prev);
          updated.set(result.metadata.id, result.metadata);
          return updated;
        });

        // Return the new minion selection
        return {
          projectPath,
          projectName: result.metadata.projectName,
          namedMinionPath: result.metadata.namedMinionPath,
          minionId: result.metadata.id,
        };
      } else {
        throw new Error(result.error);
      }
    },
    [api, refreshProjects, setMinionMetadata]
  );

  const removeMinion = useCallback(
    async (
      minionId: string,
      options?: { force?: boolean }
    ): Promise<{ success: boolean; error?: string }> => {
      if (!api) return { success: false, error: "API not connected" };

      // Capture state before the async operation.
      // We check currentMinionId (from URL) rather than selectedMinion
      // because it's the source of truth for what's actually selected.
      const wasSelected = currentMinionId === minionId;
      const projectPath = selectedMinion?.projectPath;

      try {
        const result = await api.minion.remove({ minionId, options });
        if (result.success) {
          // Clean up minion-specific localStorage keys
          deleteMinionStorage(minionId);

          // Optimistically remove from the local metadata map so the sidebar updates immediately.
          // Relying on the metadata subscription can leave the item visible until the next refresh.
          setMinionMetadata((prev) => {
            const updated = new Map(prev);
            updated.delete(minionId);
            return updated;
          });

          // Backend has already updated the config - reload projects to get updated state
          await refreshProjects();

          // Minion metadata subscription handles the removal automatically.
          // No need to refetch all metadata - this avoids expensive post-compaction
          // state checks for all minions.

          // If the removed minion was selected (URL was on this minion),
          // navigate to its project page instead of going home
          if (wasSelected && projectPath) {
            navigateToProject(projectPath);
          }
          // If not selected, don't navigate at all - stay where we are
          return { success: true };
        } else {
          console.error("Failed to remove minion:", result.error);
          return { success: false, error: result.error };
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Failed to remove minion:", errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [
      currentMinionId,
      navigateToProject,
      refreshProjects,
      selectedMinion,
      api,
      setMinionMetadata,
    ]
  );

  /**
   * Update minion title (formerly "rename").
   * Unlike the old rename which changed the git branch/directory name,
   * this only updates the display title and can be called during streaming.
   *
   * Note: This is simpler than the old rename because the minion ID doesn't change.
   * We just reload metadata after the update - no need to update selectedMinion
   * since the ID stays the same and the metadata map refresh handles the title update.
   */
  const updateMinionTitle = useCallback(
    async (
      minionId: string,
      newTitle: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!api) return { success: false, error: "API not connected" };
      try {
        const result = await api.minion.updateTitle({ minionId, title: newTitle });
        if (result.success) {
          // Minion metadata subscription handles the title update automatically.
          // No need to refetch all metadata - this avoids expensive post-compaction
          // state checks for all minions (which can be slow for SSH minions).
          return { success: true };
        } else {
          console.error("Failed to update minion title:", result.error);
          return { success: false, error: result.error };
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Failed to update minion title:", errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [api]
  );

  const archiveMinion = useCallback(
    async (minionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!api) return { success: false, error: "API not connected" };

      try {
        const result = await api.minion.archive({ minionId });
        if (result.success) {
          // Terminal PTYs are killed on archive; clear persisted terminal tabs so
          // unarchive doesn't briefly flash dead terminal tabs.
          const layoutKey = getWorkbenchPanelLayoutKey(minionId);
          const rawLayout = readPersistedState<unknown>(layoutKey, null);

          if (isWorkbenchPanelLayoutState(rawLayout)) {
            const terminalTabs = collectAllTabs(rawLayout.root).filter(isTerminalTab);
            let cleanedLayout = rawLayout;
            for (const tab of terminalTabs) {
              cleanedLayout = removeTabEverywhere(cleanedLayout, tab);
            }
            updatePersistedState(layoutKey, cleanedLayout);
          }

          // Also clear persisted terminal titles since those sessions are gone.
          updatePersistedState(getTerminalTitlesKey(minionId), {});

          // Minion list + navigation are driven by the minion metadata subscription.
          return { success: true };
        }

        console.error("Failed to bench minion:", result.error);
        return { success: false, error: result.error };
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Failed to bench minion:", errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [api]
  );

  const unarchiveMinion = useCallback(
    async (minionId: string): Promise<{ success: boolean; error?: string }> => {
      if (!api) return { success: false, error: "API not connected" };
      try {
        const result = await api.minion.unarchive({ minionId });
        if (result.success) {
          // Minion metadata subscription handles the state update automatically.
          return { success: true };
        } else {
          console.error("Failed to unbench minion:", result.error);
          return { success: false, error: result.error };
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Failed to unbench minion:", errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [api]
  );

  const refreshMinionMetadata = useCallback(async () => {
    await loadMinionMetadata();
  }, [loadMinionMetadata]);

  const getMinionInfo = useCallback(
    async (minionId: string) => {
      if (!api) return null;
      const metadata = await api.minion.getInfo({ minionId });
      if (metadata) {
        ensureCreatedAt(metadata);
        seedMinionLocalStorageFromBackend(metadata);
      }
      return metadata;
    },
    [api]
  );

  const promoteMinionDraft = useCallback(
    (projectPath: string, draftId: string, metadata: FrontendMinionMetadata) => {
      if (projectPath.trim().length === 0) return;
      if (draftId.trim().length === 0) return;

      setMinionDraftPromotionsByProject((prev) => {
        const currentProject = prev[projectPath] ?? {};
        const existing = currentProject[draftId];
        if (existing?.id === metadata.id) {
          return prev;
        }

        return {
          ...prev,
          [projectPath]: {
            ...currentProject,
            [draftId]: metadata,
          },
        };
      });
    },
    []
  );
  const beginMinionCreation = useCallback(
    (projectPath: string, crewId?: string) => {
      if (minionMetadata.get(LATTICE_HELP_CHAT_MINION_ID)?.projectPath === projectPath) {
        navigateToMinion(LATTICE_HELP_CHAT_MINION_ID);
        return;
      }

      navigateToProject(projectPath, crewId);
    },
    [navigateToProject, navigateToMinion, minionMetadata]
  );
  // Persist crew selection + URL updates so draft crew switches stick across navigation.
  const updateMinionDraftSection = useCallback(
    (projectPath: string, draftId: string, crewId: string | null) => {
      if (projectPath.trim().length === 0) return;
      if (draftId.trim().length === 0) return;

      const normalizedSectionId =
        typeof crewId === "string" && crewId.trim().length > 0 ? crewId : null;

      setMinionDraftsByProjectState((prev) => {
        const current = normalizeMinionDraftsByProject(prev);
        const existing = current[projectPath] ?? [];
        if (existing.length === 0) {
          return prev;
        }

        let didUpdate = false;
        const nextDrafts = existing.map((draft) => {
          if (draft.draftId !== draftId) {
            return draft;
          }
          if (draft.crewId === normalizedSectionId) {
            return draft;
          }
          didUpdate = true;
          return {
            ...draft,
            crewId: normalizedSectionId,
          };
        });

        if (!didUpdate) {
          return prev;
        }

        return {
          ...current,
          [projectPath]: nextDrafts,
        };
      });

      navigateToProject(projectPath, normalizedSectionId ?? undefined, draftId);
    },
    [navigateToProject, setMinionDraftsByProjectState]
  );

  const createMinionDraft = useCallback(
    (projectPath: string, crewId?: string) => {
      // Read directly from localStorage to get the freshest value, avoiding stale closure issues.
      // The React state (minionDraftsByProject) may be out of date if this is called rapidly.
      const freshDrafts = normalizeMinionDraftsByProject(
        readPersistedState<MinionDraftsByProject>(MINION_DRAFTS_BY_PROJECT_KEY, {})
      );
      const existingDrafts = freshDrafts[projectPath] ?? [];

      // If there's an existing empty draft (optionally in the same crew), reuse it
      // instead of creating yet another empty draft.
      const existingEmptyDraftId = findExistingEmptyDraft(existingDrafts, projectPath, crewId);
      if (existingEmptyDraftId) {
        navigateToProject(projectPath, crewId, existingEmptyDraftId);
        return;
      }

      const draftId = createMinionDraftId();
      const createdAt = Date.now();
      const draft: MinionDraft = {
        draftId,
        crewId: crewId ?? null,
        createdAt,
      };

      setMinionDraftsByProjectState((prev) => {
        const current = normalizeMinionDraftsByProject(prev);
        const existing = current[projectPath] ?? [];

        // One-time migration: if the user has an old per-project pending draft, move it
        // into the first draft scope so it stays accessible.
        if (existing.length === 0) {
          const pendingScopeId = getPendingScopeId(projectPath);
          const legacyInput = readPersistedState<string>(getInputKey(pendingScopeId), "");
          const legacyAttachments = readPersistedState<unknown>(
            getInputAttachmentsKey(pendingScopeId),
            []
          );
          const hasLegacyAttachments =
            Array.isArray(legacyAttachments) && legacyAttachments.length > 0;
          if (legacyInput.trim().length > 0 || hasLegacyAttachments) {
            migrateMinionStorage(pendingScopeId, getDraftScopeId(projectPath, draftId));
          }
        }

        return {
          ...current,
          [projectPath]: [...existing, draft],
        };
      });

      navigateToProject(projectPath, crewId, draftId);
    },
    [navigateToProject, setMinionDraftsByProjectState]
  );

  const openMinionDraft = useCallback(
    (projectPath: string, draftId: string, crewId?: string | null) => {
      const normalizedSectionId =
        typeof crewId === "string" && crewId.trim().length > 0 ? crewId : undefined;
      navigateToProject(projectPath, normalizedSectionId, draftId);
    },
    [navigateToProject]
  );

  const deleteMinionDraft = useCallback(
    (projectPath: string, draftId: string) => {
      setMinionDraftPromotionsByProject((prev) => {
        const currentProject = prev[projectPath];
        if (!currentProject || !(draftId in currentProject)) {
          return prev;
        }

        const nextProject = { ...currentProject };
        delete nextProject[draftId];

        const next: MinionDraftPromotionsByProject = { ...prev };
        if (Object.keys(nextProject).length === 0) {
          delete next[projectPath];
        } else {
          next[projectPath] = nextProject;
        }
        return next;
      });

      deleteMinionStorage(getDraftScopeId(projectPath, draftId));

      setMinionDraftsByProjectState((prev) => {
        const current = normalizeMinionDraftsByProject(prev);
        const existing = current[projectPath] ?? [];
        const nextDrafts = existing.filter((draft) => draft.draftId !== draftId);

        const next: MinionDraftsByProject = { ...current };
        if (nextDrafts.length === 0) {
          delete next[projectPath];
        } else {
          next[projectPath] = nextDrafts;
        }
        return next;
      });
    },
    [setMinionDraftPromotionsByProject, setMinionDraftsByProjectState]
  );

  // Split into two context values so metadata-Map churn doesn't re-render
  // components that only need actions/selection/drafts.
  const metadataValue = useMemo<MinionMetadataContextValue>(
    () => ({ minionMetadata, loading }),
    [minionMetadata, loading]
  );

  const actionsValue = useMemo(
    () => ({
      createMinion,
      removeMinion,
      updateMinionTitle,
      archiveMinion,
      unarchiveMinion,
      refreshMinionMetadata,
      setMinionMetadata,
      selectedMinion,
      setSelectedMinion,
      pendingNewMinionProject,
      pendingNewMinionSectionId,
      pendingNewMinionDraftId,
      beginMinionCreation,
      minionDraftsByProject,
      minionDraftPromotionsByProject,
      promoteMinionDraft,
      createMinionDraft,
      updateMinionDraftSection,
      openMinionDraft,
      deleteMinionDraft,
      getMinionInfo,
    }),
    [
      createMinion,
      removeMinion,
      updateMinionTitle,
      archiveMinion,
      unarchiveMinion,
      refreshMinionMetadata,
      setMinionMetadata,
      selectedMinion,
      setSelectedMinion,
      pendingNewMinionProject,
      pendingNewMinionSectionId,
      pendingNewMinionDraftId,
      beginMinionCreation,
      minionDraftsByProject,
      minionDraftPromotionsByProject,
      promoteMinionDraft,
      createMinionDraft,
      updateMinionDraftSection,
      openMinionDraft,
      deleteMinionDraft,
      getMinionInfo,
    ]
  );

  return (
    <MinionMetadataContext.Provider value={metadataValue}>
      <MinionActionsContext.Provider value={actionsValue}>
        {props.children}
      </MinionActionsContext.Provider>
    </MinionMetadataContext.Provider>
  );
}

/**
 * Subscribe to minion metadata only. Use this in components that need the
 * metadata Map but don't need actions/selection (avoids re-rendering on
 * selection or draft changes).
 */
export function useMinionMetadata(): MinionMetadataContextValue {
  const context = useContext(MinionMetadataContext);
  if (!context) {
    throw new Error("useMinionMetadata must be used within MinionProvider");
  }
  return context;
}

/**
 * Subscribe to minion actions/selection/drafts only. This context value is
 * stable across metadata-Map changes, so sidebar-like components that don't
 * need the full Map can avoid re-renders.
 */
export function useMinionActions(): Omit<MinionContext, "minionMetadata" | "loading"> {
  const context = useContext(MinionActionsContext);
  if (!context) {
    throw new Error("useMinionActions must be used within MinionProvider");
  }
  return context;
}

/**
 * Backward-compatible hook that merges both contexts into the full
 * MinionContext shape. Subscribes to BOTH metadata and actions contexts,
 * so it re-renders on any change. Prefer the narrower hooks above when possible.
 */
export function useMinionContext(): MinionContext {
  const metadata = useMinionMetadata();
  const actions = useMinionActions();
  return useMemo(() => ({ ...metadata, ...actions }), [metadata, actions]);
}

/**
 * Optional version of useMinionContext.
 *
 * This is useful for environments that render message/tool components without the full
 * minion shell (e.g. VS Code webviews).
 */
export function useOptionalMinionContext(): MinionContext | null {
  const metadataCtx = useContext(MinionMetadataContext);
  const actionsCtx = useContext(MinionActionsContext);
  if (!metadataCtx || !actionsCtx) return null;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- both arms are stable across renders
  return useMemo(() => ({ ...metadataCtx, ...actionsCtx }), [metadataCtx, actionsCtx]);
}
