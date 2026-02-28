import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAPI } from "@/browser/contexts/API";
import type { ProjectConfig, CrewConfig } from "@/common/types/project";
import type { BranchListResult } from "@/common/orpc/types";
import type { Secret } from "@/common/types/secrets";
import type { Result } from "@/common/types/result";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import {
  MINION_DRAFTS_BY_PROJECT_KEY,
  deleteMinionStorage,
  getDraftScopeId,
} from "@/common/constants/storage";
import { getErrorMessage } from "@/common/utils/errors";

interface MinionModalState {
  isOpen: boolean;
  projectPath: string | null;
  projectName: string;
  branches: string[];
  defaultTrunkBranch?: string;
  loadErrorMessage: string | null;
  isLoading: boolean;
}

export interface ProjectContext {
  projects: Map<string, ProjectConfig>;
  /** True while initial project list is loading */
  loading: boolean;
  refreshProjects: () => Promise<void>;
  addProject: (normalizedPath: string, projectConfig: ProjectConfig) => void;
  removeProject: (path: string) => Promise<{ success: boolean; error?: string }>;

  // Project creation modal
  isProjectCreateModalOpen: boolean;
  openProjectCreateModal: () => void;
  closeProjectCreateModal: () => void;

  // Minion modal state
  minionModalState: MinionModalState;
  openMinionModal: (projectPath: string, options?: { projectName?: string }) => Promise<void>;
  closeMinionModal: () => void;

  // Helpers
  getBranchesForProject: (projectPath: string) => Promise<BranchListResult>;
  getSecrets: (projectPath: string) => Promise<Secret[]>;
  updateSecrets: (projectPath: string, secrets: Secret[]) => Promise<void>;

  // Crew operations
  createCrew: (
    projectPath: string,
    name: string,
    color?: string
  ) => Promise<Result<CrewConfig>>;
  updateCrew: (
    projectPath: string,
    crewId: string,
    updates: { name?: string; color?: string }
  ) => Promise<Result<void>>;
  removeCrew: (projectPath: string, crewId: string) => Promise<Result<void>>;
  reorderCrews: (projectPath: string, crewIds: string[]) => Promise<Result<void>>;
  assignMinionToCrew: (
    projectPath: string,
    minionId: string,
    crewId: string | null
  ) => Promise<Result<void>>;
}

const ProjectContext = createContext<ProjectContext | undefined>(undefined);

function deriveProjectName(projectPath: string): string {
  if (!projectPath) {
    return "Project";
  }
  const segments = projectPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

const PROJECT_REMOVE_ACTIVE_MINIONS_ERROR_PREFIX =
  "Cannot remove project with active minions";

function isExpectedProjectRemovalValidationError(error: string | undefined): boolean {
  return (
    typeof error === "string" && error.startsWith(PROJECT_REMOVE_ACTIVE_MINIONS_ERROR_PREFIX)
  );
}

export function ProjectProvider(props: { children: ReactNode }) {
  const { api } = useAPI();
  const [projects, setProjects] = useState<Map<string, ProjectConfig>>(new Map());
  const [loading, setLoading] = useState(true);
  const [isProjectCreateModalOpen, setProjectCreateModalOpen] = useState(false);
  const [minionModalState, setMinionModalState] = useState<MinionModalState>({
    isOpen: false,
    projectPath: null,
    projectName: "",
    branches: [],
    defaultTrunkBranch: undefined,
    loadErrorMessage: null,
    isLoading: false,
  });
  const minionModalProjectRef = useRef<string | null>(null);

  // Used to guard against refreshProjects() races.
  //
  // Example: the initial refresh (on mount) can start before a minion fork, then
  // resolve after a fork-triggered refresh. Without this guard, the stale response
  // could overwrite the newer project list and make the forked minion disappear
  // from the sidebar again.
  const projectsRefreshSeqRef = useRef(0);
  const latestAppliedProjectsRefreshSeqRef = useRef(0);

  const refreshProjects = useCallback(async () => {
    if (!api) return;

    const refreshSeq = projectsRefreshSeqRef.current + 1;
    projectsRefreshSeqRef.current = refreshSeq;

    try {
      const projectsList = await api.projects.list();

      // Ignore out-of-date refreshes so an older response can't clobber a newer success.
      if (refreshSeq < latestAppliedProjectsRefreshSeqRef.current) {
        return;
      }

      latestAppliedProjectsRefreshSeqRef.current = refreshSeq;
      setProjects(new Map(projectsList));
    } catch (error) {
      // Ignore out-of-date refreshes so an older error can't clobber a newer success.
      if (refreshSeq < latestAppliedProjectsRefreshSeqRef.current) {
        return;
      }

      // Keep the previous project list on error to avoid emptying the sidebar.
      console.error("Failed to load projects:", error);
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      await refreshProjects();
      setLoading(false);
    })();
  }, [refreshProjects]);

  const addProject = useCallback((normalizedPath: string, projectConfig: ProjectConfig) => {
    setProjects((prev) => {
      const next = new Map(prev);
      next.set(normalizedPath, projectConfig);
      return next;
    });
  }, []);

  const removeProject = useCallback(
    async (path: string): Promise<{ success: boolean; error?: string }> => {
      if (!api) return { success: false, error: "API not connected" };
      try {
        const result = await api.projects.remove({ projectPath: path });
        if (result.success) {
          setProjects((prev) => {
            const next = new Map(prev);
            next.delete(path);
            return next;
          });

          // Clean up any UI-only minion drafts for this project.
          const draftsValue = readPersistedState<unknown>(MINION_DRAFTS_BY_PROJECT_KEY, {});
          if (draftsValue && typeof draftsValue === "object") {
            const record = draftsValue as Record<string, unknown>;
            const drafts = record[path];
            if (drafts !== undefined) {
              if (Array.isArray(drafts)) {
                for (const draft of drafts) {
                  if (!draft || typeof draft !== "object") continue;
                  const draftId = (draft as { draftId?: unknown }).draftId;
                  if (typeof draftId === "string" && draftId.trim().length > 0) {
                    deleteMinionStorage(getDraftScopeId(path, draftId));
                  }
                }
              }

              updatePersistedState<Record<string, unknown>>(
                MINION_DRAFTS_BY_PROJECT_KEY,
                (prev) => {
                  const next = prev && typeof prev === "object" ? { ...prev } : {};
                  delete next[path];
                  return next;
                },
                {}
              );
            }
          }

          return { success: true };
        } else {
          if (isExpectedProjectRemovalValidationError(result.error)) {
            // Expected user-facing validation failures (for example, active minions still present)
            // should surface in UI without polluting error-level console output.
            console.warn("Failed to remove project:", result.error);
          } else {
            console.error("Failed to remove project:", result.error);
          }
          return { success: false, error: result.error };
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error("Failed to remove project:", errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [api]
  );

  const getBranchesForProject = useCallback(
    async (projectPath: string): Promise<BranchListResult> => {
      if (!api) {
        return { branches: [], recommendedTrunk: "" };
      }
      const branchResult = await api.projects.listBranches({ projectPath });
      const branches = branchResult.branches;
      const sanitizedBranches = Array.isArray(branches)
        ? branches.filter((branch): branch is string => typeof branch === "string")
        : [];

      const recommended =
        typeof branchResult?.recommendedTrunk === "string" &&
        sanitizedBranches.includes(branchResult.recommendedTrunk)
          ? branchResult.recommendedTrunk
          : (sanitizedBranches[0] ?? "");

      return {
        branches: sanitizedBranches,
        recommendedTrunk: recommended,
      };
    },
    [api]
  );

  const openMinionModal = useCallback(
    async (projectPath: string, options?: { projectName?: string }) => {
      const projectName = options?.projectName ?? deriveProjectName(projectPath);
      minionModalProjectRef.current = projectPath;
      setMinionModalState((prev) => ({
        ...prev,
        isOpen: true,
        projectPath,
        projectName,
        branches: [],
        defaultTrunkBranch: undefined,
        loadErrorMessage: null,
        isLoading: true,
      }));

      try {
        const { branches, recommendedTrunk } = await getBranchesForProject(projectPath);
        if (minionModalProjectRef.current !== projectPath) {
          return;
        }
        setMinionModalState((prev) => ({
          ...prev,
          branches,
          defaultTrunkBranch: recommendedTrunk ?? undefined,
          loadErrorMessage: null,
          isLoading: false,
        }));
      } catch (error) {
        console.error("Failed to load branches for project:", error);
        if (minionModalProjectRef.current !== projectPath) {
          return;
        }
        const errorMessage =
          error instanceof Error ? error.message : "Failed to load branches for project";
        setMinionModalState((prev) => ({
          ...prev,
          branches: [],
          defaultTrunkBranch: undefined,
          loadErrorMessage: errorMessage,
          isLoading: false,
        }));
      }
    },
    [getBranchesForProject]
  );

  const closeMinionModal = useCallback(() => {
    minionModalProjectRef.current = null;
    setMinionModalState({
      isOpen: false,
      projectPath: null,
      projectName: "",
      branches: [],
      defaultTrunkBranch: undefined,
      loadErrorMessage: null,
      isLoading: false,
    });
  }, []);

  const getSecrets = useCallback(
    async (projectPath: string): Promise<Secret[]> => {
      if (!api) return [];
      return await api.secrets.get({ projectPath });
    },
    [api]
  );

  const updateSecrets = useCallback(
    async (projectPath: string, secrets: Secret[]) => {
      if (!api) return;
      const result = await api.secrets.update({ projectPath, secrets });
      if (!result.success) {
        console.error("Failed to update secrets:", result.error);
      }
    },
    [api]
  );

  // Crew operations
  const createCrew = useCallback(
    async (projectPath: string, name: string, color?: string): Promise<Result<CrewConfig>> => {
      if (!api) return { success: false, error: "API not connected" };
      const result = await api.projects.crews.create({ projectPath, name, color });
      if (result.success) {
        await refreshProjects();
      }
      return result;
    },
    [api, refreshProjects]
  );

  const updateCrew = useCallback(
    async (
      projectPath: string,
      crewId: string,
      updates: { name?: string; color?: string }
    ): Promise<Result<void>> => {
      if (!api) return { success: false, error: "API not connected" };
      const result = await api.projects.crews.update({ projectPath, crewId, ...updates });
      if (result.success) {
        await refreshProjects();
      }
      return result;
    },
    [api, refreshProjects]
  );

  const removeCrew = useCallback(
    async (projectPath: string, crewId: string): Promise<Result<void>> => {
      if (!api) return { success: false, error: "API not connected" };
      const result = await api.projects.crews.remove({ projectPath, crewId });
      if (result.success) {
        await refreshProjects();
      }
      return result;
    },
    [api, refreshProjects]
  );

  const reorderCrews = useCallback(
    async (projectPath: string, crewIds: string[]): Promise<Result<void>> => {
      if (!api) return { success: false, error: "API not connected" };
      const result = await api.projects.crews.reorder({ projectPath, crewIds });
      if (result.success) {
        await refreshProjects();
      }
      return result;
    },
    [api, refreshProjects]
  );

  const assignMinionToCrew = useCallback(
    async (
      projectPath: string,
      minionId: string,
      crewId: string | null
    ): Promise<Result<void>> => {
      if (!api) return { success: false, error: "API not connected" };
      const result = await api.projects.crews.assignMinion({
        projectPath,
        minionId,
        crewId,
      });
      if (result.success) {
        await refreshProjects();
      }
      return result;
    },
    [api, refreshProjects]
  );

  const value = useMemo<ProjectContext>(
    () => ({
      projects,
      loading,
      refreshProjects,
      addProject,
      removeProject,
      isProjectCreateModalOpen,
      openProjectCreateModal: () => setProjectCreateModalOpen(true),
      closeProjectCreateModal: () => setProjectCreateModalOpen(false),
      minionModalState,
      openMinionModal,
      closeMinionModal,
      getBranchesForProject,
      getSecrets,
      updateSecrets,
      createCrew,
      updateCrew,
      removeCrew,
      reorderCrews,
      assignMinionToCrew,
    }),
    [
      projects,
      loading,
      refreshProjects,
      addProject,
      removeProject,
      isProjectCreateModalOpen,
      minionModalState,
      openMinionModal,
      closeMinionModal,
      getBranchesForProject,
      getSecrets,
      updateSecrets,
      createCrew,
      updateCrew,
      removeCrew,
      reorderCrews,
      assignMinionToCrew,
    ]
  );

  return <ProjectContext.Provider value={value}>{props.children}</ProjectContext.Provider>;
}

export function useProjectContext(): ProjectContext {
  const context = useContext(ProjectContext);
  if (!context) {
    throw new Error("useProjectContext must be used within ProjectProvider");
  }
  return context;
}
