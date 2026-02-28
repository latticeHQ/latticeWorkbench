import { useState, useEffect, useRef, useCallback } from "react";
import { readPersistedState, usePersistedState } from "./usePersistedState";
import { useThinkingLevel } from "./useThinkingLevel";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import {
  type RuntimeMode,
  type ParsedRuntime,
  type LatticeMinionConfig,
  buildRuntimeString,
  RUNTIME_MODE,
  LATTICE_RUNTIME_PLACEHOLDER,
} from "@/common/types/runtime";
import type { RuntimeChoice } from "@/browser/utils/runtimeUi";
import {
  DEFAULT_MODEL_KEY,
  DEFAULT_RUNTIME_KEY,
  getAgentIdKey,
  getModelKey,
  getRuntimeKey,
  getTrunkBranchKey,
  getLastRuntimeConfigKey,
  getProjectScopeId,
  GLOBAL_SCOPE_ID,
} from "@/common/constants/storage";
import type { ThinkingLevel } from "@/common/types/thinking";
import { MINION_DEFAULTS } from "@/constants/minionDefaults";

/**
 * Centralized draft minion settings for project-level persistence
 * All settings persist across navigation and are restored when returning to the same project
 */
export interface DraftMinionSettings {
  // Model & AI settings (synced with global state)
  model: string;
  thinkingLevel: ThinkingLevel;
  agentId: string;

  // Minion creation settings (project-specific)
  /**
   * Currently selected runtime for this minion creation.
   * Uses discriminated union so SSH has host, Docker has image, etc.
   */
  selectedRuntime: ParsedRuntime;
  /** Persisted default runtime choice for this project (used to initialize selection) */
  defaultRuntimeMode: RuntimeChoice;
  trunkBranch: string;
}

interface SshRuntimeConfig {
  host: string;
  lattice?: LatticeMinionConfig;
}

interface SshRuntimeState {
  host: string;
  latticeEnabled: boolean;
  latticeConfig: LatticeMinionConfig | null;
}

/** Stable fallback for Lattice config to avoid new object on every render */
const DEFAULT_LATTICE_CONFIG: LatticeMinionConfig = { existingMinion: false };
function coerceAgentId(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : MINION_DEFAULTS.agentId;
}

const buildRuntimeForMode = (
  mode: RuntimeMode,
  sshConfig: SshRuntimeConfig,
  dockerImage: string,
  dockerShareCredentials: boolean,
  devcontainerConfigPath: string,
  devcontainerShareCredentials: boolean
): ParsedRuntime => {
  switch (mode) {
    case RUNTIME_MODE.LOCAL:
      return { mode: "local" };
    case RUNTIME_MODE.SSH: {
      // Use placeholder when Lattice is enabled with no explicit SSH host
      // This ensures the runtime string round-trips correctly for Lattice-only users
      const effectiveHost =
        sshConfig.lattice && !sshConfig.host.trim() ? LATTICE_RUNTIME_PLACEHOLDER : sshConfig.host;

      return {
        mode: "ssh",
        host: effectiveHost,
        lattice: sshConfig.lattice,
      };
    }
    case RUNTIME_MODE.DOCKER:
      return { mode: "docker", image: dockerImage, shareCredentials: dockerShareCredentials };
    case RUNTIME_MODE.DEVCONTAINER:
      return {
        mode: "devcontainer",
        configPath: devcontainerConfigPath,
        shareCredentials: devcontainerShareCredentials,
      };
    case RUNTIME_MODE.WORKTREE:
    default:
      return { mode: "worktree" };
  }
};

const normalizeRuntimeChoice = (value: unknown): RuntimeChoice | null => {
  if (
    value === "lattice" ||
    value === RUNTIME_MODE.LOCAL ||
    value === RUNTIME_MODE.WORKTREE ||
    value === RUNTIME_MODE.SSH ||
    value === RUNTIME_MODE.DOCKER ||
    value === RUNTIME_MODE.DEVCONTAINER
  ) {
    return value;
  }

  return null;
};

const buildRuntimeFromChoice = (choice: RuntimeChoice): ParsedRuntime => {
  switch (choice) {
    case "lattice":
      return { mode: RUNTIME_MODE.SSH, host: LATTICE_RUNTIME_PLACEHOLDER };
    case RUNTIME_MODE.LOCAL:
      return { mode: RUNTIME_MODE.LOCAL };
    case RUNTIME_MODE.WORKTREE:
      return { mode: RUNTIME_MODE.WORKTREE };
    case RUNTIME_MODE.SSH:
      return { mode: RUNTIME_MODE.SSH, host: "" };
    case RUNTIME_MODE.DOCKER:
      return { mode: RUNTIME_MODE.DOCKER, image: "" };
    case RUNTIME_MODE.DEVCONTAINER:
      return { mode: RUNTIME_MODE.DEVCONTAINER, configPath: "" };
  }
};

/**
 * Hook to manage all draft minion settings with centralized persistence
 * Loads saved preferences when projectPath changes, persists all changes automatically
 *
 * @param projectPath - Path to the project (used as key prefix for localStorage)
 * @param branches - Available branches (used to set default trunk branch)
 * @param recommendedTrunk - Backend-recommended trunk branch
 * @returns Settings object and setters
 */
export function useDraftMinionSettings(
  projectPath: string,
  branches: string[],
  recommendedTrunk: string | null
): {
  settings: DraftMinionSettings;
  /** Restores prior Lattice selections when re-entering Lattice mode. */
  latticeConfigFallback: LatticeMinionConfig;
  /** Preserves the last SSH host when leaving Lattice so the input stays populated. */
  sshHostFallback: string;
  /** Set the currently selected runtime (discriminated union) */
  setSelectedRuntime: (runtime: ParsedRuntime) => void;
  /** Set the default runtime choice for this project (persists via checkbox) */
  setDefaultRuntimeChoice: (choice: RuntimeChoice) => void;
  setTrunkBranch: (branch: string) => void;
  getRuntimeString: () => string | undefined;
} {
  // Global AI settings (read-only from global state)
  const [thinkingLevel] = useThinkingLevel();

  const projectScopeId = getProjectScopeId(projectPath);
  const { projects } = useProjectContext();
  const projectConfig = projects.get(projectPath);

  const [globalDefaultAgentId] = usePersistedState<string>(
    getAgentIdKey(GLOBAL_SCOPE_ID),
    MINION_DEFAULTS.agentId,
    { listener: true }
  );
  const [projectAgentId] = usePersistedState<string | null>(getAgentIdKey(projectScopeId), null, {
    listener: true,
  });
  const agentId = coerceAgentId(projectAgentId ?? globalDefaultAgentId);

  // Subscribe to the global default model preference so backend-seeded values apply
  // immediately on fresh origins (e.g., when switching ports).
  const [defaultModelPref] = usePersistedState<string>(
    DEFAULT_MODEL_KEY,
    MINION_DEFAULTS.model,
    { listener: true }
  );
  const defaultModel = defaultModelPref.trim() || MINION_DEFAULTS.model;

  // Project-scoped model preference (persisted per project). If unset, fall back to the global
  // default model preference.
  const [modelOverride] = usePersistedState<string | null>(getModelKey(projectScopeId), null, {
    listener: true,
  });
  const model =
    typeof modelOverride === "string" && modelOverride.trim().length > 0
      ? modelOverride.trim()
      : defaultModel;

  const [rawGlobalDefaultRuntime] = usePersistedState<unknown>(DEFAULT_RUNTIME_KEY, null, {
    listener: true,
  });
  const globalDefaultRuntime = normalizeRuntimeChoice(rawGlobalDefaultRuntime);

  // Project-scoped default runtime (persisted when the creation tooltip checkbox is used).
  // Legacy per-project default (only write-side used by setDefaultRuntimeChoice; reads
  // now come from settingsDefaultRuntime above).
  const [, setDefaultRuntimeString] = usePersistedState<string | undefined>(
    getRuntimeKey(projectPath),
    undefined,
    { listener: true }
  );

  const hasProjectRuntimeOverrides =
    projectConfig?.runtimeOverridesEnabled === true ||
    Boolean(projectConfig?.runtimeEnablement) ||
    projectConfig?.defaultRuntime !== undefined;
  const settingsDefaultRuntime: RuntimeChoice = hasProjectRuntimeOverrides
    ? (projectConfig?.defaultRuntime ?? globalDefaultRuntime ?? RUNTIME_MODE.WORKTREE)
    : (globalDefaultRuntime ?? RUNTIME_MODE.WORKTREE);

  // Always use the Settings-configured default as the canonical source of truth.
  // The old per-project localStorage key (getRuntimeKey) is now stale since the creation
  // tooltip default toggle was removed; new defaults come from the Runtimes settings panel.
  const parsedDefault = buildRuntimeFromChoice(settingsDefaultRuntime);
  const defaultRuntimeMode: RuntimeMode = parsedDefault?.mode ?? RUNTIME_MODE.WORKTREE;

  // Project-scoped trunk branch preference (persisted per project)
  const [trunkBranch, setTrunkBranch] = usePersistedState<string>(
    getTrunkBranchKey(projectPath),
    "",
    { listener: true }
  );

  type LastRuntimeConfigs = Partial<Record<RuntimeMode, unknown>>;

  // Project-scoped last runtime config (persisted per provider, stored as an object)
  const [lastRuntimeConfigs, setLastRuntimeConfigs] = usePersistedState<LastRuntimeConfigs>(
    getLastRuntimeConfigKey(projectPath),
    {},
    { listener: true }
  );

  const readRuntimeConfigFrom = <T>(
    configs: LastRuntimeConfigs,
    mode: RuntimeMode,
    field: string,
    defaultValue: T
  ): T => {
    const modeConfig = configs[mode];
    if (!modeConfig || typeof modeConfig !== "object" || Array.isArray(modeConfig)) {
      return defaultValue;
    }
    const fieldValue = (modeConfig as Record<string, unknown>)[field];
    // Type-specific validation based on default value type
    if (typeof defaultValue === "string") {
      return (typeof fieldValue === "string" ? fieldValue : defaultValue) as T;
    }
    if (typeof defaultValue === "boolean") {
      return (fieldValue === true) as unknown as T;
    }
    // Object type (null default means optional object)
    if (fieldValue && typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
      return fieldValue as T;
    }
    return defaultValue;
  };

  // Generic reader for lastRuntimeConfigs fields
  const readRuntimeConfig = <T>(mode: RuntimeMode, field: string, defaultValue: T): T => {
    return readRuntimeConfigFrom(lastRuntimeConfigs, mode, field, defaultValue);
  };

  // Hide Lattice-specific persistence fields behind helpers so callsites stay clean.
  const readSshRuntimeState = (configs: LastRuntimeConfigs): SshRuntimeState => ({
    host: readRuntimeConfigFrom(configs, RUNTIME_MODE.SSH, "host", ""),
    latticeEnabled: readRuntimeConfigFrom(configs, RUNTIME_MODE.SSH, "latticeEnabled", false),
    latticeConfig: readRuntimeConfigFrom<LatticeMinionConfig | null>(
      configs,
      RUNTIME_MODE.SSH,
      "latticeConfig",
      null
    ),
  });

  const readSshRuntimeConfig = (configs: LastRuntimeConfigs): SshRuntimeConfig => {
    const sshState = readSshRuntimeState(configs);

    return {
      host: sshState.host,
      lattice: sshState.latticeEnabled && sshState.latticeConfig ? sshState.latticeConfig : undefined,
    };
  };

  const lastSshState = readSshRuntimeState(lastRuntimeConfigs);

  // Preserve the last SSH host when switching out of Lattice so the input stays populated.
  const sshHostFallback = lastSshState.host;

  // Restore prior Lattice selections when switching back into Lattice mode.
  const latticeConfigFallback = lastSshState.latticeConfig ?? DEFAULT_LATTICE_CONFIG;
  const lastSsh = readSshRuntimeConfig(lastRuntimeConfigs);
  const lastDockerImage = readRuntimeConfig(RUNTIME_MODE.DOCKER, "image", "");
  const lastShareCredentials = readRuntimeConfig(RUNTIME_MODE.DOCKER, "shareCredentials", false);
  const lastDevcontainerConfigPath = readRuntimeConfig(RUNTIME_MODE.DEVCONTAINER, "configPath", "");
  const lastDevcontainerShareCredentials = readRuntimeConfig(
    RUNTIME_MODE.DEVCONTAINER,
    "shareCredentials",
    false
  );

  const latticeDefaultFromString =
    parsedDefault?.mode === RUNTIME_MODE.SSH && parsedDefault.host === LATTICE_RUNTIME_PLACEHOLDER;
  // Defaults must stay explicit and sticky; last-used SSH state should only seed inputs.
  const defaultRuntimeChoice: RuntimeChoice =
    defaultRuntimeMode === RUNTIME_MODE.SSH && latticeDefaultFromString
      ? "lattice"
      : defaultRuntimeMode;

  const setLastRuntimeConfig = useCallback(
    (mode: RuntimeMode, field: string, value: string | boolean | object | null) => {
      setLastRuntimeConfigs((prev) => {
        const existing = prev[mode];
        const existingObj =
          existing && typeof existing === "object" && !Array.isArray(existing)
            ? (existing as Record<string, unknown>)
            : {};

        return { ...prev, [mode]: { ...existingObj, [field]: value } };
      });
    },
    [setLastRuntimeConfigs]
  );

  // Persist SSH config while keeping the legacy field shape hidden from callsites.
  const writeSshRuntimeConfig = useCallback(
    (config: SshRuntimeConfig) => {
      if (config.host.trim() && config.host !== LATTICE_RUNTIME_PLACEHOLDER) {
        setLastRuntimeConfig(RUNTIME_MODE.SSH, "host", config.host);
      }
      const latticeEnabled = config.lattice !== undefined;
      setLastRuntimeConfig(RUNTIME_MODE.SSH, "latticeEnabled", latticeEnabled);
      if (config.lattice) {
        setLastRuntimeConfig(RUNTIME_MODE.SSH, "latticeConfig", config.lattice);
      }
    },
    [setLastRuntimeConfig]
  );

  // If the default runtime string contains a host/image (e.g. older persisted values like "ssh devbox"),
  // prefer it as the initial remembered value.
  useEffect(() => {
    if (
      parsedDefault?.mode === RUNTIME_MODE.SSH &&
      !lastSsh.host.trim() &&
      parsedDefault.host.trim()
    ) {
      setLastRuntimeConfig(RUNTIME_MODE.SSH, "host", parsedDefault.host);
    }
    if (
      parsedDefault?.mode === RUNTIME_MODE.DOCKER &&
      !lastDockerImage.trim() &&
      parsedDefault.image.trim()
    ) {
      setLastRuntimeConfig(RUNTIME_MODE.DOCKER, "image", parsedDefault.image);
    }
    if (
      parsedDefault?.mode === RUNTIME_MODE.DEVCONTAINER &&
      !lastDevcontainerConfigPath.trim() &&
      parsedDefault.configPath.trim()
    ) {
      setLastRuntimeConfig(RUNTIME_MODE.DEVCONTAINER, "configPath", parsedDefault.configPath);
    }
  }, [
    projectPath,
    parsedDefault,
    lastSsh.host,
    lastDockerImage,
    lastDevcontainerConfigPath,
    setLastRuntimeConfig,
  ]);

  const defaultSshHost =
    parsedDefault?.mode === RUNTIME_MODE.SSH && parsedDefault.host.trim()
      ? parsedDefault.host
      : lastSsh.host;

  // When the settings default says "Lattice", reuse the saved config even if last-used SSH disabled it.
  // When settings say plain "ssh", don't reattach the last-used lattice config.
  const defaultSshLattice = latticeDefaultFromString
    ? (lastSshState.latticeConfig ?? DEFAULT_LATTICE_CONFIG)
    : settingsDefaultRuntime === RUNTIME_MODE.SSH
      ? undefined
      : lastSsh.lattice;

  const defaultDockerImage =
    parsedDefault?.mode === RUNTIME_MODE.DOCKER && parsedDefault.image.trim()
      ? parsedDefault.image
      : lastDockerImage;

  const defaultDevcontainerConfigPath =
    parsedDefault?.mode === RUNTIME_MODE.DEVCONTAINER && parsedDefault.configPath.trim()
      ? parsedDefault.configPath
      : lastDevcontainerConfigPath;

  const defaultRuntime = buildRuntimeForMode(
    defaultRuntimeMode,
    { host: defaultSshHost, lattice: defaultSshLattice },
    defaultDockerImage,
    lastShareCredentials,
    defaultDevcontainerConfigPath,
    lastDevcontainerShareCredentials
  );

  // Currently selected runtime for this session (initialized from default)
  // Uses discriminated union: SSH has host, Docker has image
  const [selectedRuntime, setSelectedRuntimeState] = useState<ParsedRuntime>(() => defaultRuntime);

  const prevProjectPathRef = useRef<string | null>(null);
  // Track settingsDefaultRuntime (RuntimeChoice) instead of defaultRuntimeMode (RuntimeMode)
  // so that switching between "lattice" and "ssh" in Settings is detected as a change.
  const prevSettingsDefaultRef = useRef<RuntimeChoice | null>(null);

  // When switching projects or changing the persisted default mode, reset the selection.
  // Importantly: do NOT reset selection when lastSsh.host/lastDockerImage changes while typing.
  useEffect(() => {
    const projectChanged = prevProjectPathRef.current !== projectPath;
    const defaultModeChanged = prevSettingsDefaultRef.current !== settingsDefaultRuntime;

    if (projectChanged || defaultModeChanged) {
      setSelectedRuntimeState(
        buildRuntimeForMode(
          defaultRuntimeMode,
          { host: defaultSshHost, lattice: defaultSshLattice },
          defaultDockerImage,
          lastShareCredentials,
          defaultDevcontainerConfigPath,
          lastDevcontainerShareCredentials
        )
      );
    }

    prevProjectPathRef.current = projectPath;
    prevSettingsDefaultRef.current = settingsDefaultRuntime;
  }, [
    projectPath,
    settingsDefaultRuntime,
    defaultRuntimeMode,
    defaultSshHost,
    defaultDockerImage,
    lastShareCredentials,
    defaultSshLattice,
    defaultDevcontainerConfigPath,
    lastDevcontainerShareCredentials,
  ]);

  // When the user switches into SSH/Docker/Devcontainer mode, seed the field with the remembered config.
  // This avoids clearing the last values when the UI switches modes with an empty field.
  // Skip on initial mount (prevMode === null) since useState initializer handles that case.
  const prevSelectedRuntimeModeRef = useRef<RuntimeMode | null>(null);
  useEffect(() => {
    const prevMode = prevSelectedRuntimeModeRef.current;
    if (prevMode !== null && prevMode !== selectedRuntime.mode) {
      if (selectedRuntime.mode === RUNTIME_MODE.SSH) {
        const needsHostRestore = !selectedRuntime.host.trim() && lastSsh.host.trim();
        const needsLatticeRestore = selectedRuntime.lattice === undefined && lastSsh.lattice != null;
        if (needsHostRestore || needsLatticeRestore) {
          setSelectedRuntimeState({
            mode: RUNTIME_MODE.SSH,
            host: needsHostRestore ? lastSsh.host : selectedRuntime.host,
            lattice: needsLatticeRestore ? lastSsh.lattice : selectedRuntime.lattice,
          });
        }
      }

      if (selectedRuntime.mode === RUNTIME_MODE.DEVCONTAINER) {
        const needsConfigRestore =
          !selectedRuntime.configPath.trim() && lastDevcontainerConfigPath.trim();
        const needsCredentialsRestore =
          selectedRuntime.shareCredentials === undefined && lastDevcontainerShareCredentials;
        if (needsConfigRestore || needsCredentialsRestore) {
          setSelectedRuntimeState({
            mode: RUNTIME_MODE.DEVCONTAINER,
            configPath: needsConfigRestore
              ? lastDevcontainerConfigPath
              : selectedRuntime.configPath,
            shareCredentials: lastDevcontainerShareCredentials,
          });
        }
      }
      if (selectedRuntime.mode === RUNTIME_MODE.DOCKER) {
        const needsImageRestore = !selectedRuntime.image.trim() && lastDockerImage.trim();
        const needsCredentialsRestore =
          selectedRuntime.shareCredentials === undefined && lastShareCredentials;
        if (needsImageRestore || needsCredentialsRestore) {
          setSelectedRuntimeState({
            mode: RUNTIME_MODE.DOCKER,
            image: needsImageRestore ? lastDockerImage : selectedRuntime.image,
            shareCredentials: lastShareCredentials,
          });
        }
      }
    }

    prevSelectedRuntimeModeRef.current = selectedRuntime.mode;
  }, [
    selectedRuntime,
    lastSsh.host,
    lastDockerImage,
    lastShareCredentials,
    lastSsh.lattice,
    lastDevcontainerConfigPath,
    lastDevcontainerShareCredentials,
  ]);

  // Initialize trunk branch from backend recommendation or first branch
  useEffect(() => {
    if (branches.length > 0 && (!trunkBranch || !branches.includes(trunkBranch))) {
      const defaultBranch = recommendedTrunk ?? branches[0];
      setTrunkBranch(defaultBranch);
    }
  }, [branches, recommendedTrunk, trunkBranch, setTrunkBranch]);

  // Setter for selected runtime (also persists host/image/lattice for future mode switches)
  const setSelectedRuntime = (runtime: ParsedRuntime) => {
    setSelectedRuntimeState(runtime);

    // Persist host/image/lattice so they're remembered when switching modes.
    // Avoid wiping the remembered value when the UI switches modes with an empty field.
    // Avoid persisting the Lattice placeholder as the remembered SSH host.
    if (runtime.mode === RUNTIME_MODE.SSH) {
      writeSshRuntimeConfig({ host: runtime.host, lattice: runtime.lattice });
    } else if (runtime.mode === RUNTIME_MODE.DOCKER) {
      if (runtime.image.trim()) {
        setLastRuntimeConfig(RUNTIME_MODE.DOCKER, "image", runtime.image);
      }
      if (runtime.shareCredentials !== undefined) {
        setLastRuntimeConfig(RUNTIME_MODE.DOCKER, "shareCredentials", runtime.shareCredentials);
      }
    } else if (runtime.mode === RUNTIME_MODE.DEVCONTAINER) {
      if (runtime.configPath.trim()) {
        setLastRuntimeConfig(RUNTIME_MODE.DEVCONTAINER, "configPath", runtime.configPath);
      }
      if (runtime.shareCredentials !== undefined) {
        setLastRuntimeConfig(
          RUNTIME_MODE.DEVCONTAINER,
          "shareCredentials",
          runtime.shareCredentials
        );
      }
    }
  };

  // Setter for default runtime choice (persists via checkbox in tooltip)
  const setDefaultRuntimeChoice = (choice: RuntimeChoice) => {
    // Defaults should only change when the checkbox is toggled, not when last-used SSH flips.
    const freshRuntimeConfigs = readPersistedState<LastRuntimeConfigs>(
      getLastRuntimeConfigKey(projectPath),
      {}
    );
    const freshSshState = readSshRuntimeState(freshRuntimeConfigs);

    const newMode = choice === "lattice" ? RUNTIME_MODE.SSH : choice;
    const sshConfig: SshRuntimeConfig =
      choice === "lattice"
        ? {
            host: LATTICE_RUNTIME_PLACEHOLDER,
            lattice: freshSshState.latticeConfig ?? DEFAULT_LATTICE_CONFIG,
          }
        : {
            host: freshSshState.host,
            lattice: undefined,
          };

    const newRuntime = buildRuntimeForMode(
      newMode,
      sshConfig,
      lastDockerImage,
      lastShareCredentials,
      defaultDevcontainerConfigPath,
      lastDevcontainerShareCredentials
    );
    const newRuntimeString = buildRuntimeString(newRuntime);
    setDefaultRuntimeString(newRuntimeString);
    // Also update selection to match new default
    setSelectedRuntimeState(newRuntime);
  };

  // Helper to get runtime string for IPC calls
  const getRuntimeString = (): string | undefined => {
    return buildRuntimeString(selectedRuntime);
  };

  return {
    settings: {
      model,
      thinkingLevel,
      agentId,
      selectedRuntime,
      defaultRuntimeMode: defaultRuntimeChoice,
      trunkBranch,
    },
    latticeConfigFallback,
    sshHostFallback,
    setSelectedRuntime,
    setDefaultRuntimeChoice,
    setTrunkBranch,
    getRuntimeString,
  };
}
