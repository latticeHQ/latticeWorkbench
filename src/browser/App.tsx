import { Menu } from "lucide-react";
import { useEffect, useCallback, useRef } from "react";
import { useRouter } from "./contexts/RouterContext";
import { useNavigate } from "react-router-dom";
import "./styles/globals.css";
import { useMinionContext, toMinionSelection } from "./contexts/MinionContext";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { useProjectContext } from "./contexts/ProjectContext";
import type { MinionSelection } from "./components/ProjectSidebar";
import { LeftSidebar } from "./components/LeftSidebar";
import { ProjectCreateModal } from "./components/ProjectCreateModal";
import { AIView } from "./components/AIView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  usePersistedState,
  updatePersistedState,
  readPersistedState,
} from "./hooks/usePersistedState";
import { useResizableSidebar } from "./hooks/useResizableSidebar";
import { matchesKeybind, KEYBINDS } from "./utils/ui/keybinds";
import { handleLayoutSlotHotkeys } from "./utils/ui/layoutSlotHotkeys";
import { buildSortedMinionsByProject } from "./utils/ui/minionFiltering";
import { getVisibleMinionIds } from "./utils/ui/minionDomNav";
import { useUnreadTracking } from "./hooks/useUnreadTracking";
import { useMinionStoreRaw, useMinionRecency } from "./stores/MinionStore";

import { useStableReference, compareMaps } from "./hooks/useStableReference";
import { CommandRegistryProvider, useCommandRegistry } from "./contexts/CommandRegistryContext";
import { useOpenTerminal } from "./hooks/useOpenTerminal";
import type { CommandAction } from "./contexts/CommandRegistryContext";
import { useTheme, type ThemeMode } from "./contexts/ThemeContext";
import { CommandPalette } from "./components/CommandPalette";
import { buildCoreSources, type BuildSourcesParams } from "./utils/commands/sources";

import { THINKING_LEVELS, type ThinkingLevel } from "@/common/types/thinking";
import { CUSTOM_EVENTS } from "@/common/constants/events";
import { isMinionForkSwitchEvent } from "./utils/minionEvents";
import {
  getAgentIdKey,
  getAgentsInitNudgeKey,
  getModelKey,
  getNotifyOnResponseKey,
  getThinkingLevelByModelKey,
  getThinkingLevelKey,
  getMinionAISettingsByAgentKey,
  getMinionLastReadKey,
  EXPANDED_PROJECTS_KEY,
  LEFT_SIDEBAR_COLLAPSED_KEY,
  LEFT_SIDEBAR_WIDTH_KEY,
} from "@/common/constants/storage";
import { getDefaultModel } from "@/browser/hooks/useModelsFromSettings";
import type { BranchListResult } from "@/common/orpc/types";
import { useTelemetry } from "./hooks/useTelemetry";
import { getRuntimeTypeForTelemetry } from "@/common/telemetry";
import { useStartMinionCreation, getFirstProjectPath } from "./hooks/useStartMinionCreation";
import { useAPI } from "@/browser/contexts/API";
import {
  clearPendingMinionAiSettings,
  markPendingMinionAiSettings,
} from "@/browser/utils/minionAiSettingsSync";
import { AuthTokenModal } from "@/browser/components/AuthTokenModal";
import { Button } from "./components/ui/button";
import { ProjectPage } from "@/browser/components/ProjectPage";

import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { AboutDialogProvider } from "./contexts/AboutDialogContext";
import { ConfirmDialogProvider, useConfirmDialog } from "./contexts/ConfirmDialogContext";
import { AboutDialog } from "./components/About/AboutDialog";
import { SettingsPage } from "@/browser/components/Settings/SettingsPage";
import { AnalyticsDashboard } from "@/browser/components/analytics/AnalyticsDashboard";
import { SshPromptDialog } from "./components/SshPromptDialog";
import { SplashScreenProvider } from "./components/splashScreens/SplashScreenProvider";
import { TutorialProvider } from "./contexts/TutorialContext";
import { PowerModeProvider } from "./contexts/PowerModeContext";
import { TooltipProvider } from "./components/ui/tooltip";
import { useFeatureFlags } from "./contexts/FeatureFlagsContext";
import { UILayoutsProvider, useUILayouts } from "@/browser/contexts/UILayoutsContext";
import { FeatureFlagsProvider } from "./contexts/FeatureFlagsContext";
import { ExperimentsProvider } from "./contexts/ExperimentsContext";
import { ProviderOptionsProvider } from "./contexts/ProviderOptionsContext";
import { getMinionSidebarKey } from "./utils/minion";
import { WindowsToolchainBanner } from "./components/WindowsToolchainBanner";
import { RosettaBanner } from "./components/RosettaBanner";
import { isDesktopMode } from "./hooks/useDesktopTitlebar";
import { cn } from "@/common/lib/utils";
import { getErrorMessage } from "@/common/utils/errors";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

function AppInner() {
  // Get minion state from context
  const {
    minionMetadata,
    loading,
    setMinionMetadata,
    removeMinion,
    updateMinionTitle,
    refreshMinionMetadata,
    selectedMinion,
    setSelectedMinion,
    pendingNewMinionProject,
    pendingNewMinionSectionId,
    pendingNewMinionDraftId,
    beginMinionCreation,
  } = useMinionContext();
  const {
    currentMinionId,
    currentSettingsSection,
    isAnalyticsOpen,
    navigateToAnalytics,
    navigateFromAnalytics,
  } = useRouter();
  const { theme, setTheme, toggleTheme } = useTheme();
  const { open: openSettings, isOpen: isSettingsOpen } = useSettings();
  const { confirm: confirmDialog } = useConfirmDialog();
  const setThemePreference = useCallback(
    (nextTheme: ThemeMode) => {
      setTheme(nextTheme);
    },
    [setTheme]
  );
  const { layoutPresets, applySlotToMinion, saveCurrentMinionToSlot } = useUILayouts();
  const { api, status, error, authenticate, retry } = useAPI();

  const {
    projects,
    refreshProjects,
    removeProject,
    openProjectCreateModal,
    isProjectCreateModalOpen,
    closeProjectCreateModal,
    addProject,
  } = useProjectContext();

  // Auto-collapse sidebar on mobile by default
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState(
    LEFT_SIDEBAR_COLLAPSED_KEY,
    isMobile,
    {
      listener: true,
    }
  );

  // Left sidebar is drag-resizable (mirrors WorkbenchPanel). Width is persisted globally;
  // collapse remains a separate toggle and the drag handle is hidden in mobile-touch overlay mode.
  const leftSidebar = useResizableSidebar({
    enabled: true,
    defaultWidth: 288,
    minWidth: 200,
    maxWidth: 600,
    // Keep enough room for the main content so you can't drag-resize the left sidebar
    // to a point where the chat pane becomes unusably narrow.
    getMaxWidthPx: () => {
      // Match LeftSidebar's mobile overlay gate. In that mode we don't want viewport-based clamping
      // because the sidebar width is controlled by CSS and shouldn't rewrite the user's desktop
      // width preference.
      const isMobileTouch =
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 768px) and (pointer: coarse)").matches;
      if (isMobileTouch) {
        return Number.POSITIVE_INFINITY;
      }

      const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
      // ChatPane uses tailwind `min-w-96`.
      return viewportWidth - 384;
    },
    storageKey: LEFT_SIDEBAR_WIDTH_KEY,
    side: "left",
  });
  // Sync sidebar collapse state to root element for CSS-based titlebar insets
  useEffect(() => {
    document.documentElement.dataset.leftSidebarCollapsed = String(sidebarCollapsed);
  }, [sidebarCollapsed]);
  const defaultProjectPath = getFirstProjectPath(projects);
  const creationProjectPath =
    !selectedMinion && !currentMinionId
      ? (pendingNewMinionProject ?? defaultProjectPath)
      : null;

  // History navigation (back/forward)
  const navigate = useNavigate();

  const startMinionCreation = useStartMinionCreation({
    projects,
    beginMinionCreation,
  });

  // ProjectPage handles its own focus when mounted

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, [setSidebarCollapsed]);

  // Telemetry tracking
  const telemetry = useTelemetry();

  // Get minion store for command palette
  const minionStore = useMinionStoreRaw();

  const { statsTabState } = useFeatureFlags();
  useEffect(() => {
    minionStore.setStatsEnabled(Boolean(statsTabState?.enabled));
  }, [minionStore, statsTabState?.enabled]);

  // Track telemetry when minion selection changes
  const prevMinionRef = useRef<MinionSelection | null>(null);
  // Ref for selectedMinion to access in callbacks without stale closures
  const selectedMinionRef = useRef(selectedMinion);
  selectedMinionRef.current = selectedMinion;
  // Ref for route-level minion visibility to avoid stale closure in response callbacks
  const currentMinionIdRef = useRef(currentMinionId);
  currentMinionIdRef.current = currentMinionId;
  useEffect(() => {
    const prev = prevMinionRef.current;
    if (prev && selectedMinion && prev.minionId !== selectedMinion.minionId) {
      telemetry.minionSwitched(prev.minionId, selectedMinion.minionId);
    }
    prevMinionRef.current = selectedMinion;
  }, [selectedMinion, telemetry]);

  // Track last-read timestamps for unread indicators.
  // Read-marking is gated on chat-route visibility (currentMinionId).
  useUnreadTracking(selectedMinion, currentMinionId);

  const minionMetadataRef = useRef(minionMetadata);
  useEffect(() => {
    minionMetadataRef.current = minionMetadata;
  }, [minionMetadata]);

  const handleOpenLatticeChat = useCallback(() => {
    // User requested an F1 shortcut to jump straight into Chat with Lattice.
    const metadata = minionMetadataRef.current.get(LATTICE_HELP_CHAT_MINION_ID);
    setSelectedMinion(
      metadata
        ? toMinionSelection(metadata)
        : {
            minionId: LATTICE_HELP_CHAT_MINION_ID,
            projectPath: "",
            projectName: "Lattice",
            namedMinionPath: "",
          }
    );

    if (!metadata) {
      refreshMinionMetadata().catch((error) => {
        console.error("Failed to refresh minion metadata", error);
      });
    }
  }, [refreshMinionMetadata, setSelectedMinion]);

  // Update window title based on selected minion
  // URL syncing is now handled by RouterContext
  useEffect(() => {
    if (selectedMinion) {
      // Update window title with minion title (or name for legacy minions)
      const metadata = minionMetadata.get(selectedMinion.minionId);
      const minionTitle = metadata?.title ?? metadata?.name ?? selectedMinion.minionId;
      const title = `${minionTitle} - ${selectedMinion.projectName} - lattice`;
      // Set document.title locally for browser mode, call backend for Electron
      document.title = title;
      void api?.window.setTitle({ title });
    } else {
      // Set document.title locally for browser mode, call backend for Electron
      document.title = "lattice";
      void api?.window.setTitle({ title: "lattice" });
    }
  }, [selectedMinion, minionMetadata, api]);

  // Validate selected minion exists and has all required fields
  // Note: minion validity is now primarily handled by RouterContext deriving
  // selectedMinion from URL + metadata. This effect handles edge cases like
  // stale localStorage or missing fields in legacy minions.
  useEffect(() => {
    if (selectedMinion) {
      const metadata = minionMetadata.get(selectedMinion.minionId);

      if (!metadata) {
        // Minion was deleted - navigate home (clears selection)
        console.warn(
          `Minion ${selectedMinion.minionId} no longer exists, clearing selection`
        );
        setSelectedMinion(null);
      } else if (!selectedMinion.namedMinionPath && metadata.namedMinionPath) {
        // Old localStorage entry missing namedMinionPath - update it once
        console.log(`Updating minion ${selectedMinion.minionId} with missing fields`);
        setSelectedMinion(toMinionSelection(metadata));
      }
    }
  }, [selectedMinion, minionMetadata, setSelectedMinion]);

  const openMinionInTerminal = useOpenTerminal();

  const handleRemoveProject = useCallback(
    async (path: string): Promise<{ success: boolean; error?: string }> => {
      if (selectedMinion?.projectPath === path) {
        setSelectedMinion(null);
      }
      return removeProject(path);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMinion, setSelectedMinion]
  );

  // Memoize callbacks to prevent LeftSidebar/ProjectSidebar re-renders

  // NEW: Get minion recency from store
  const minionRecency = useMinionRecency();

  // Build sorted minions map including pending minions
  // Use stable reference to prevent sidebar re-renders when sort order hasn't changed
  const sortedMinionsByProject = useStableReference(
    () => buildSortedMinionsByProject(projects, minionMetadata, minionRecency),
    (prev, next) =>
      compareMaps(prev, next, (a, b) => {
        if (a.length !== b.length) return false;
        return a.every((meta, i) => {
          const other = b[i];
          // Compare all fields that affect sidebar display.
          // If you add a new display-relevant field to MinionMetadata,
          // add it to getMinionSidebarKey() in src/browser/utils/minion.ts
          return other && getMinionSidebarKey(meta) === getMinionSidebarKey(other);
        });
      }),
    [projects, minionMetadata, minionRecency]
  );

  // Pre-compute for the sidebar so it doesn't need MinionMetadataContext
  const latticeChatProjectPath = minionMetadata.get(LATTICE_HELP_CHAT_MINION_ID)?.projectPath ?? null;

  const handleNavigateMinion = useCallback(
    (direction: "next" | "prev") => {
      // Read actual rendered minion order from DOM — impossible to drift from sidebar.
      const visibleIds = getVisibleMinionIds();
      if (visibleIds.length === 0) return;

      const currentIndex = selectedMinion
        ? visibleIds.indexOf(selectedMinion.minionId)
        : -1;

      let targetIndex: number;
      if (currentIndex === -1) {
        targetIndex = direction === "next" ? 0 : visibleIds.length - 1;
      } else if (direction === "next") {
        targetIndex = (currentIndex + 1) % visibleIds.length;
      } else {
        targetIndex = currentIndex === 0 ? visibleIds.length - 1 : currentIndex - 1;
      }

      const targetMeta = minionMetadata.get(visibleIds[targetIndex]);
      if (targetMeta) setSelectedMinion(toMinionSelection(targetMeta));
    },
    [selectedMinion, minionMetadata, setSelectedMinion]
  );

  // Register command sources with registry
  const {
    registerSource,
    isOpen: isCommandPaletteOpen,
    open: openCommandPalette,
    close: closeCommandPalette,
  } = useCommandRegistry();

  /**
   * Get model for a minion, returning canonical format.
   */
  const getModelForMinion = useCallback((minionId: string): string => {
    const defaultModel = getDefaultModel();
    const rawModel = readPersistedState<string>(getModelKey(minionId), defaultModel);
    return rawModel || defaultModel;
  }, []);

  const getThinkingLevelForMinion = useCallback(
    (minionId: string): ThinkingLevel => {
      if (!minionId) {
        return "off";
      }

      const scopedKey = getThinkingLevelKey(minionId);
      const scoped = readPersistedState<ThinkingLevel | undefined>(scopedKey, undefined);
      if (scoped !== undefined) {
        return THINKING_LEVELS.includes(scoped) ? scoped : "off";
      }

      // Migration: fall back to legacy per-model thinking and seed the minion-scoped key.
      const model = getModelForMinion(minionId);
      const legacy = readPersistedState<ThinkingLevel | undefined>(
        getThinkingLevelByModelKey(model),
        undefined
      );
      if (legacy !== undefined && THINKING_LEVELS.includes(legacy)) {
        updatePersistedState(scopedKey, legacy);
        return legacy;
      }

      return "off";
    },
    [getModelForMinion]
  );

  const setThinkingLevelFromPalette = useCallback(
    (minionId: string, level: ThinkingLevel) => {
      if (!minionId) {
        return;
      }

      const normalized = THINKING_LEVELS.includes(level) ? level : "off";
      const model = getModelForMinion(minionId);
      const key = getThinkingLevelKey(minionId);

      // Use the utility function which handles localStorage and event dispatch
      // ThinkingProvider will pick this up via its listener
      updatePersistedState(key, normalized);

      type MinionAISettingsByAgentCache = Partial<
        Record<string, { model: string; thinkingLevel: ThinkingLevel }>
      >;

      const normalizedAgentId =
        readPersistedState<string>(getAgentIdKey(minionId), MINION_DEFAULTS.agentId)
          .trim()
          .toLowerCase() || MINION_DEFAULTS.agentId;

      updatePersistedState<MinionAISettingsByAgentCache>(
        getMinionAISettingsByAgentKey(minionId),
        (prev) => {
          const record: MinionAISettingsByAgentCache =
            prev && typeof prev === "object" ? prev : {};
          return {
            ...record,
            [normalizedAgentId]: { model, thinkingLevel: normalized },
          };
        },
        {}
      );

      // Persist to backend so the palette change follows the minion across devices.
      if (api) {
        markPendingMinionAiSettings(minionId, normalizedAgentId, {
          model,
          thinkingLevel: normalized,
        });

        api.minion
          .updateAgentAISettings({
            minionId,
            agentId: normalizedAgentId,
            aiSettings: { model, thinkingLevel: normalized },
          })
          .then((result) => {
            if (!result.success) {
              clearPendingMinionAiSettings(minionId, normalizedAgentId);
            }
          })
          .catch(() => {
            clearPendingMinionAiSettings(minionId, normalizedAgentId);
            // Best-effort only.
          });
      }

      // Dispatch toast notification event for UI feedback
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(CUSTOM_EVENTS.THINKING_LEVEL_TOAST, {
            detail: { minionId, level: normalized },
          })
        );
      }
    },
    [api, getModelForMinion]
  );

  const registerParamsRef = useRef<BuildSourcesParams | null>(null);

  const openNewMinionFromPalette = useCallback(
    (projectPath: string) => {
      startMinionCreation(projectPath);
    },
    [startMinionCreation]
  );

  const archiveMergedMinionsInProjectFromPalette = useCallback(
    async (projectPath: string): Promise<void> => {
      const trimmedProjectPath = projectPath.trim();
      if (!trimmedProjectPath) return;

      if (!api) {
        if (typeof window !== "undefined") {
          window.alert("Cannot bench merged minions: API not connected");
        }
        return;
      }

      try {
        const result = await api.minion.archiveMergedInProject({
          projectPath: trimmedProjectPath,
        });

        if (!result.success) {
          if (typeof window !== "undefined") {
            window.alert(result.error);
          }
          return;
        }

        const errorCount = result.data.errors.length;
        if (errorCount > 0) {
          const archivedCount = result.data.archivedMinionIds.length;
          const skippedCount = result.data.skippedMinionIds.length;

          const MAX_ERRORS_TO_SHOW = 5;
          const shownErrors = result.data.errors
            .slice(0, MAX_ERRORS_TO_SHOW)
            .map((e) => `- ${e.minionId}: ${e.error}`)
            .join("\n");
          const remainingCount = Math.max(0, errorCount - MAX_ERRORS_TO_SHOW);
          const remainingSuffix = remainingCount > 0 ? `\n… and ${remainingCount} more.` : "";

          if (typeof window !== "undefined") {
            window.alert(
              `Benched merged minions with some errors.\n\nArchived: ${archivedCount}\nSkipped: ${skippedCount}\nErrors: ${errorCount}\n\nErrors:\n${shownErrors}${remainingSuffix}`
            );
          }
        }
      } catch (error) {
        const message = getErrorMessage(error);
        if (typeof window !== "undefined") {
          window.alert(message);
        }
      }
    },
    [api]
  );

  const getBranchesForProject = useCallback(
    async (projectPath: string): Promise<BranchListResult> => {
      if (!api) {
        return { branches: [], recommendedTrunk: null };
      }
      const branchResult = await api.projects.listBranches({ projectPath });
      const sanitizedBranches = branchResult.branches.filter(
        (branch): branch is string => typeof branch === "string"
      );

      const recommended =
        branchResult.recommendedTrunk && sanitizedBranches.includes(branchResult.recommendedTrunk)
          ? branchResult.recommendedTrunk
          : (sanitizedBranches[0] ?? null);

      return {
        branches: sanitizedBranches,
        recommendedTrunk: recommended,
      };
    },
    [api]
  );

  const selectMinionFromPalette = useCallback(
    (selection: MinionSelection) => {
      setSelectedMinion(selection);
    },
    [setSelectedMinion]
  );

  const removeMinionFromPalette = useCallback(
    async (minionId: string) => removeMinion(minionId),
    [removeMinion]
  );

  const updateTitleFromPalette = useCallback(
    async (minionId: string, newTitle: string) => updateMinionTitle(minionId, newTitle),
    [updateMinionTitle]
  );

  const addProjectFromPalette = useCallback(() => {
    openProjectCreateModal();
  }, [openProjectCreateModal]);

  const removeProjectFromPalette = useCallback(
    (path: string) => {
      void handleRemoveProject(path);
    },
    [handleRemoveProject]
  );

  const toggleSidebarFromPalette = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, [setSidebarCollapsed]);

  const navigateMinionFromPalette = useCallback(
    (dir: "next" | "prev") => {
      handleNavigateMinion(dir);
    },
    [handleNavigateMinion]
  );

  registerParamsRef.current = {
    projects,
    minionMetadata,
    selectedMinion,
    theme,
    getThinkingLevel: getThinkingLevelForMinion,
    onSetThinkingLevel: setThinkingLevelFromPalette,
    onStartMinionCreation: openNewMinionFromPalette,
    onArchiveMergedMinionsInProject: archiveMergedMinionsInProjectFromPalette,
    getBranchesForProject,
    onSelectMinion: selectMinionFromPalette,
    onRemoveMinion: removeMinionFromPalette,
    onUpdateTitle: updateTitleFromPalette,
    onAddProject: addProjectFromPalette,
    onRemoveProject: removeProjectFromPalette,
    onToggleSidebar: toggleSidebarFromPalette,
    onNavigateMinion: navigateMinionFromPalette,
    onOpenMinionInTerminal: (minionId, runtimeConfig) => {
      // Best-effort only. Palette actions should never throw.
      void openMinionInTerminal(minionId, runtimeConfig).catch(() => {
        // Errors are surfaced elsewhere (toasts/logs) and users can retry.
      });
    },
    onToggleTheme: toggleTheme,
    onSetTheme: setThemePreference,
    onOpenSettings: openSettings,
    layoutPresets,
    onApplyLayoutSlot: (minionId, slot) => {
      void applySlotToMinion(minionId, slot).catch(() => {
        // Best-effort only.
      });
    },
    onCaptureLayoutSlot: async (minionId, slot, name) => {
      try {
        await saveCurrentMinionToSlot(minionId, slot, name);
      } catch {
        // Best-effort only.
      }
    },
    onClearTimingStats: (minionId: string) => minionStore.clearTimingStats(minionId),
    api,
    confirmDialog,
  };

  useEffect(() => {
    const unregister = registerSource(() => {
      const params = registerParamsRef.current;
      if (!params) return [];

      // Compute streaming models here (only when command palette opens)
      const allStates = minionStore.getAllStates();
      const selectedMinionState = params.selectedMinion
        ? (allStates.get(params.selectedMinion.minionId) ?? null)
        : null;
      const streamingModels = new Map<string, string>();
      for (const [minionId, state] of allStates) {
        if (state.canInterrupt && state.currentModel) {
          streamingModels.set(minionId, state.currentModel);
        }
      }

      const factories = buildCoreSources({
        ...params,
        streamingModels,
        selectedMinionState,
      });
      const actions: CommandAction[] = [];
      for (const factory of factories) {
        actions.push(...factory());
      }
      return actions;
    });
    return unregister;
  }, [registerSource, minionStore]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) {
        return;
      }

      if (matchesKeybind(e, KEYBINDS.NEXT_MINION)) {
        e.preventDefault();
        handleNavigateMinion("next");
      } else if (matchesKeybind(e, KEYBINDS.PREV_MINION)) {
        e.preventDefault();
        handleNavigateMinion("prev");
      } else if (
        matchesKeybind(e, KEYBINDS.OPEN_COMMAND_PALETTE) ||
        matchesKeybind(e, KEYBINDS.OPEN_COMMAND_PALETTE_ACTIONS)
      ) {
        e.preventDefault();
        if (isCommandPaletteOpen) {
          closeCommandPalette();
        } else {
          // Alternate palette shortcut opens in command mode (with ">") while the
          // primary Ctrl/Cmd+Shift+P shortcut opens default minion-switch mode.
          const initialQuery = matchesKeybind(e, KEYBINDS.OPEN_COMMAND_PALETTE_ACTIONS)
            ? ">"
            : undefined;
          openCommandPalette(initialQuery);
        }
      } else if (matchesKeybind(e, KEYBINDS.OPEN_LATTICE_CHAT)) {
        e.preventDefault();
        handleOpenLatticeChat();
      } else if (matchesKeybind(e, KEYBINDS.TOGGLE_SIDEBAR)) {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      } else if (matchesKeybind(e, KEYBINDS.OPEN_SETTINGS)) {
        e.preventDefault();
        openSettings();
      } else if (matchesKeybind(e, KEYBINDS.OPEN_ANALYTICS)) {
        e.preventDefault();
        if (isAnalyticsOpen) {
          navigateFromAnalytics();
        } else {
          navigateToAnalytics();
        }
      } else if (matchesKeybind(e, KEYBINDS.NAVIGATE_BACK)) {
        e.preventDefault();
        void navigate(-1);
      } else if (matchesKeybind(e, KEYBINDS.NAVIGATE_FORWARD)) {
        e.preventDefault();
        void navigate(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleNavigateMinion,
    handleOpenLatticeChat,
    setSidebarCollapsed,
    isCommandPaletteOpen,
    closeCommandPalette,
    openCommandPalette,
    openSettings,
    isAnalyticsOpen,
    navigateToAnalytics,
    navigateFromAnalytics,
    navigate,
  ]);
  // Mouse back/forward buttons (buttons 3 and 4)
  const handleMouseNavigation = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        void navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        void navigate(1);
      }
    },
    [navigate]
  );

  // Layout slot hotkeys (Ctrl/Cmd+Alt+1..9 by default)
  useEffect(() => {
    const handleKeyDownCapture = (e: KeyboardEvent) => {
      handleLayoutSlotHotkeys(e, {
        isCommandPaletteOpen,
        isSettingsOpen,
        selectedMinionId: selectedMinion?.minionId ?? null,
        layoutPresets,
        applySlotToMinion,
      });
    };

    window.addEventListener("keydown", handleKeyDownCapture, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDownCapture, { capture: true });
  }, [
    isCommandPaletteOpen,
    isSettingsOpen,
    selectedMinion,
    layoutPresets,
    applySlotToMinion,
  ]);

  // Subscribe to menu bar "Open Settings" (macOS Cmd+, from app menu)
  useEffect(() => {
    if (!api) return;

    const abortController = new AbortController();
    const signal = abortController.signal;

    (async () => {
      try {
        const iterator = await api.menu.onOpenSettings(undefined, { signal });
        for await (const _ of iterator) {
          if (signal.aborted) break;
          openSettings();
        }
      } catch {
        // Subscription cancelled via abort signal - expected on cleanup
      }
    })();

    return () => abortController.abort();
  }, [api, openSettings]);

  // Handle minion fork switch event
  useEffect(() => {
    const handleForkSwitch = (e: Event) => {
      if (!isMinionForkSwitchEvent(e)) return;

      const minionInfo = e.detail;

      // Ensure the minion's project is present in the sidebar config.
      //
      // IMPORTANT: don't early-return here. In practice this event can fire before
      // ProjectContext has finished loading (or before a refresh runs), and returning
      // would make the forked minion appear "missing" until a later refresh.
      const project = projects.get(minionInfo.projectPath);
      if (!project) {
        console.warn(
          `[Frontend] Project not found for forked minion path: ${minionInfo.projectPath} (will refresh)`
        );
        void refreshProjects();
      }

      // DEFENSIVE: Ensure createdAt exists
      if (!minionInfo.createdAt) {
        console.warn(
          `[Frontend] Minion ${minionInfo.id} missing createdAt in fork switch - using default (2025-01-01)`
        );
        minionInfo.createdAt = "2025-01-01T00:00:00.000Z";
      }

      // Update metadata Map immediately (don't wait for async metadata event)
      // This ensures the title bar effect has the minion name available
      setMinionMetadata((prev) => {
        const updated = new Map(prev);
        updated.set(minionInfo.id, minionInfo);
        return updated;
      });

      // Switch to the new minion
      setSelectedMinion(toMinionSelection(minionInfo));
    };

    window.addEventListener(CUSTOM_EVENTS.MINION_FORK_SWITCH, handleForkSwitch as EventListener);
    return () =>
      window.removeEventListener(
        CUSTOM_EVENTS.MINION_FORK_SWITCH,
        handleForkSwitch as EventListener
      );
  }, [projects, refreshProjects, setSelectedMinion, setMinionMetadata]);

  // Set up navigation callback for notification clicks
  useEffect(() => {
    const navigateToMinion = (minionId: string) => {
      const metadata = minionMetadataRef.current.get(minionId);
      if (metadata) {
        setSelectedMinion(toMinionSelection(metadata));
      }
    };

    // Single source of truth: MinionStore owns the navigation callback.
    // Browser notifications and Electron notification clicks both route through this.
    minionStore.setNavigateToMinion(navigateToMinion);

    // Callback for "notify on response" feature - fires when any assistant response completes.
    // Only notify when isFinal=true (assistant done with all work, no more active streams).
    // finalText is extracted by the aggregator (text after tool calls).
    // compaction is provided when this was a compaction stream (includes continue metadata).
    const handleResponseComplete = (
      minionId: string,
      _messageId: string,
      isFinal: boolean,
      finalText: string,
      compaction?: { hasContinueMessage: boolean; isIdle?: boolean },
      completedAt?: number | null
    ) => {
      // Only notify on final message (when assistant is done with all work)
      if (!isFinal) return;

      // Only mark read when the user is actively viewing this minion's chat.
      // Checking currentMinionIdRef ensures we don't advance lastRead when
      // a non-chat route (e.g. /settings) is active — the minion remains
      // "selected" but the chat content is not visible.
      const isChatVisible = document.hasFocus() && currentMinionIdRef.current === minionId;
      if (completedAt != null && isChatVisible) {
        updatePersistedState(getMinionLastReadKey(minionId), completedAt);
      }

      // Skip notification for idle compaction (background maintenance, not user-initiated).
      if (compaction?.isIdle) return;

      // Skip notification if compaction completed with a continue message.
      // We use the compaction metadata instead of queued state since the queue
      // can be drained before compaction finishes.
      if (compaction?.hasContinueMessage) return;

      // Skip notification if the selected minion is focused (Slack-like behavior).
      // Notification suppression intentionally follows selection state, not chat-route visibility.
      const isMinionFocused =
        document.hasFocus() && selectedMinionRef.current?.minionId === minionId;
      if (isMinionFocused) return;

      // Check if notifications are enabled for this minion
      const notifyEnabled = readPersistedState(getNotifyOnResponseKey(minionId), false);
      if (!notifyEnabled) return;

      const metadata = minionMetadataRef.current.get(minionId);
      const title = metadata?.title ?? metadata?.name ?? "Response complete";

      // For compaction completions, use a specific message instead of the summary text
      const body = compaction
        ? "Compaction complete"
        : finalText
          ? finalText.length > 200
            ? `${finalText.slice(0, 197)}…`
            : finalText
          : "Response complete";

      // Send browser notification
      if ("Notification" in window) {
        const showNotification = () => {
          const notification = new Notification(title, { body });
          notification.onclick = () => {
            window.focus();
            navigateToMinion(minionId);
          };
        };

        if (Notification.permission === "granted") {
          showNotification();
        } else if (Notification.permission !== "denied") {
          void Notification.requestPermission().then((perm) => {
            if (perm === "granted") {
              showNotification();
            }
          });
        }
      }
    };

    minionStore.setOnResponseComplete(handleResponseComplete);

    const unsubscribe = window.api?.onNotificationClicked?.((data) => {
      minionStore.navigateToMinion(data.minionId);
    });

    return () => {
      unsubscribe?.();
    };
  }, [setSelectedMinion, minionStore]);

  // Show auth modal if authentication is required
  if (status === "auth_required") {
    return (
      <AuthTokenModal
        isOpen={true}
        onSubmit={authenticate}
        onSessionAuthenticated={retry}
        error={error}
      />
    );
  }

  return (
    <>
      <div
        className="bg-bg-dark mobile-layout flex h-full overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[min(env(safe-area-inset-bottom,0px),40px)] pl-[env(safe-area-inset-left)]"
        onMouseUp={handleMouseNavigation}
      >
        <LeftSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebar}
          widthPx={leftSidebar.width}
          isResizing={leftSidebar.isResizing}
          onStartResize={leftSidebar.startResize}
          sortedMinionsByProject={sortedMinionsByProject}
          minionRecency={minionRecency}
          latticeChatProjectPath={latticeChatProjectPath}
        />
        <div className="mobile-main-content flex min-w-0 flex-1 flex-col overflow-hidden">
          <WindowsToolchainBanner />
          <RosettaBanner />
          <div className="mobile-layout flex flex-1 overflow-hidden">
            {/* Route-driven settings and analytics render in the main pane so project/minion navigation stays visible. */}
            {isAnalyticsOpen ? (
              <AnalyticsDashboard
                leftSidebarCollapsed={sidebarCollapsed}
                onToggleLeftSidebarCollapsed={handleToggleSidebar}
              />
            ) : currentSettingsSection ? (
              <SettingsPage
                leftSidebarCollapsed={sidebarCollapsed}
                onToggleLeftSidebarCollapsed={handleToggleSidebar}
              />
            ) : selectedMinion ? (
              (() => {
                const currentMetadata = minionMetadata.get(selectedMinion.minionId);
                // Guard: Don't render AIView if minion metadata not found.
                // This can happen when selectedMinion (from localStorage) refers to a
                // deleted minion, or during a race condition on reload before the
                // validation effect clears the stale selection.
                if (!currentMetadata) {
                  return null;
                }
                // Use metadata.name for minion name (works for both worktree and local runtimes)
                // Fallback to path-based derivation for legacy compatibility
                const minionName =
                  currentMetadata.name ??
                  selectedMinion.namedMinionPath?.split("/").pop() ??
                  selectedMinion.minionId;
                // Use live metadata path (updates on rename) with fallback to initial path
                const minionPath =
                  currentMetadata.namedMinionPath ?? selectedMinion.namedMinionPath ?? "";
                return (
                  <ErrorBoundary
                    minionInfo={`${selectedMinion.projectName}/${minionName}`}
                  >
                    <AIView
                      minionId={selectedMinion.minionId}
                      projectPath={selectedMinion.projectPath}
                      projectName={selectedMinion.projectName}
                      leftSidebarCollapsed={sidebarCollapsed}
                      onToggleLeftSidebarCollapsed={handleToggleSidebar}
                      minionName={minionName}
                      namedMinionPath={minionPath}
                      runtimeConfig={currentMetadata.runtimeConfig}
                      incompatibleRuntime={currentMetadata.incompatibleRuntime}
                      isInitializing={currentMetadata.isInitializing === true}
                    />
                  </ErrorBoundary>
                );
              })()
            ) : creationProjectPath ? (
              (() => {
                const projectPath = creationProjectPath;
                const projectName =
                  projectPath.split("/").pop() ?? projectPath.split("\\").pop() ?? "Project";
                return (
                  <ProjectPage
                    projectPath={projectPath}
                    projectName={projectName}
                    leftSidebarCollapsed={sidebarCollapsed}
                    onToggleLeftSidebarCollapsed={handleToggleSidebar}
                    pendingSectionId={pendingNewMinionSectionId}
                    pendingDraftId={pendingNewMinionDraftId}
                    onMinionCreated={(metadata, options) => {
                      // IMPORTANT: Add minion to store FIRST (synchronous) to ensure
                      // the store knows about it before React processes the state updates.
                      // This prevents race conditions where the UI tries to access the
                      // minion before the store has created its aggregator.
                      minionStore.addMinion(metadata);

                      // Add to minion metadata map (triggers React state update)
                      setMinionMetadata((prev) => new Map(prev).set(metadata.id, metadata));

                      if (options?.autoNavigate !== false) {
                        // Only switch to new minion if user hasn't selected another one
                        // during the creation process (selectedMinion was null when creation started)
                        setSelectedMinion((current) => {
                          if (current !== null) {
                            // User has already selected another minion - don't override
                            return current;
                          }
                          return toMinionSelection(metadata);
                        });
                      }

                      // Track telemetry
                      telemetry.minionCreated(
                        metadata.id,
                        getRuntimeTypeForTelemetry(metadata.runtimeConfig)
                      );

                      // Note: No need to call clearPendingMinionCreation() here.
                      // Navigating to the minion URL automatically clears the pending
                      // state since pendingNewMinionProject is derived from the URL.
                    }}
                  />
                );
              })()
            ) : (
              <div className="bg-dark flex flex-1 flex-col overflow-hidden">
                <div
                  className={cn(
                    "bg-sidebar border-border-light flex shrink-0 items-center border-b px-[15px] [@media(max-width:768px)]:h-auto [@media(max-width:768px)]:py-2",
                    isDesktopMode() ? "h-10 titlebar-drag" : "h-8"
                  )}
                >
                  {sidebarCollapsed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleToggleSidebar}
                      title="Open sidebar"
                      aria-label="Open sidebar menu"
                      className={cn(
                        "mobile-menu-btn text-muted hover:text-foreground hidden h-6 w-6 shrink-0",
                        isDesktopMode() && "titlebar-no-drag"
                      )}
                    >
                      <Menu className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div
                  className="[&_p]:text-muted [&_h2]:text-foreground mx-auto w-full max-w-3xl flex-1 text-center [&_h2]:mb-4 [&_h2]:font-bold [&_h2]:tracking-tight [&_p]:leading-[1.6]"
                  style={{
                    padding: "clamp(40px, 10vh, 100px) 20px",
                    fontSize: "clamp(14px, 2vw, 16px)",
                  }}
                >
                  <h2 style={{ fontSize: "clamp(24px, 5vw, 36px)", letterSpacing: "-1px" }}>
                    {currentMinionId ? "Summoning minion…" : "Welcome to Lattice"}
                  </h2>
                  <p>
                    {currentMinionId
                      ? loading
                        ? "Loading minion metadata…"
                        : "Minion not found."
                      : "Add a project from the sidebar to get started."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        <CommandPalette getSlashContext={() => ({ minionId: selectedMinion?.minionId })} />
        <ProjectCreateModal
          isOpen={isProjectCreateModalOpen}
          onClose={closeProjectCreateModal}
          onSuccess={(normalizedPath, projectConfig) => {
            addProject(normalizedPath, projectConfig);
            updatePersistedState(getAgentsInitNudgeKey(normalizedPath), true);
            // Auto-expand new project in sidebar
            updatePersistedState<string[]>(
              EXPANDED_PROJECTS_KEY,
              (prev) => [...(Array.isArray(prev) ? prev : []), normalizedPath],
              []
            );
            beginMinionCreation(normalizedPath);
          }}
        />
        <AboutDialog />
        <SshPromptDialog />
      </div>
    </>
  );
}

function App() {
  return (
    <ExperimentsProvider>
      <FeatureFlagsProvider>
        <UILayoutsProvider>
          <TooltipProvider delayDuration={200}>
            <SettingsProvider>
              <AboutDialogProvider>
                <ProviderOptionsProvider>
                  <SplashScreenProvider>
                    <TutorialProvider>
                      <CommandRegistryProvider>
                        <PowerModeProvider>
                          <ConfirmDialogProvider>
                            <AppInner />
                          </ConfirmDialogProvider>
                        </PowerModeProvider>
                      </CommandRegistryProvider>
                    </TutorialProvider>
                  </SplashScreenProvider>
                </ProviderOptionsProvider>
              </AboutDialogProvider>
            </SettingsProvider>
          </TooltipProvider>
        </UILayoutsProvider>
      </FeatureFlagsProvider>
    </ExperimentsProvider>
  );
}

export default App;
