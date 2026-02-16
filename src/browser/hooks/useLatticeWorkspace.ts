/**
 * Hook for managing Lattice workspace async data in the creation flow.
 * Fetches Lattice CLI info, templates, presets, and existing workspaces.
 *
 * The `latticeConfig` state is owned by the parent (via selectedRuntime.lattice) and passed in.
 * This hook only manages async-fetched data and derived state.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useAPI } from "@/browser/contexts/API";
import type {
  LatticeInfo,
  LatticeTemplate,
  LatticePreset,
  LatticeWorkspace,
} from "@/common/orpc/schemas/lattice";
import type { LatticeWorkspaceConfig } from "@/common/types/runtime";

/**
 * Returns an auto-selected template config if no template is set, otherwise null.
 * Preserves existing config fields (like preset) when auto-selecting.
 */
export function buildAutoSelectedTemplateConfig(
  currentConfig: LatticeWorkspaceConfig | null,
  templates: LatticeTemplate[]
): LatticeWorkspaceConfig | null {
  if (templates.length === 0 || currentConfig?.template || currentConfig?.existingWorkspace) {
    return null;
  }
  const firstTemplate = templates[0];
  const firstIsDuplicate = templates.some(
    (t) => t.name === firstTemplate.name && t.organizationName !== firstTemplate.organizationName
  );
  return {
    ...(currentConfig ?? {}),
    existingWorkspace: false,
    template: firstTemplate.name,
    templateOrg: firstIsDuplicate ? firstTemplate.organizationName : undefined,
  };
}

interface UseLatticeWorkspaceOptions {
  /** Current Lattice config (null = disabled, owned by parent via selectedRuntime.lattice) */
  latticeConfig: LatticeWorkspaceConfig | null;
  /** Callback to update Lattice config (updates selectedRuntime.lattice) */
  onLatticeConfigChange: (config: LatticeWorkspaceConfig | null) => void;
}

interface UseLatticeWorkspaceReturn {
  /** Whether Lattice is enabled (derived: latticeConfig != null AND latticeInfo available) */
  enabled: boolean;
  /** Toggle Lattice on/off (calls onLatticeConfigChange with config or null) */
  setEnabled: (enabled: boolean) => void;

  /** Lattice CLI availability info */
  latticeInfo: LatticeInfo | null;

  /** Current Lattice configuration (passed through from props) */
  latticeConfig: LatticeWorkspaceConfig | null;
  /** Update Lattice config (passed through from props) */
  setLatticeConfig: (config: LatticeWorkspaceConfig | null) => void;

  /** Available templates */
  templates: LatticeTemplate[];
  /** Presets for the currently selected template */
  presets: LatticePreset[];
  /** Running Lattice agents */
  existingWorkspaces: LatticeWorkspace[];

  /** Loading states */
  loadingTemplates: boolean;
  loadingPresets: boolean;
  loadingWorkspaces: boolean;
}

/**
 * Manages Lattice agent async data for the creation flow.
 *
 * Fetches data lazily:
 * - Lattice info is fetched on mount
 * - Templates are fetched when Lattice is enabled
 * - Presets are fetched when a template is selected
 * - Agents are fetched when Lattice is enabled
 *
 * State ownership: latticeConfig is owned by parent (selectedRuntime.lattice).
 * This hook derives `enabled` from latticeConfig and manages only async data.
 */
export function useLatticeWorkspace({
  latticeConfig,
  onLatticeConfigChange,
}: UseLatticeWorkspaceOptions): UseLatticeWorkspaceReturn {
  const { api } = useAPI();

  // Async-fetched data (owned by this hook)
  const [latticeInfo, setLatticeInfo] = useState<LatticeInfo | null>(null);

  // Derived state: enabled when latticeConfig is present AND CLI is confirmed available
  // Loading (null) and outdated/unavailable all result in enabled=false
  const enabled = latticeConfig != null && latticeInfo?.state === "available";

  // Refs to access current values in async callbacks (avoids stale closures)
  const latticeConfigRef = useRef(latticeConfig);
  const onLatticeConfigChangeRef = useRef(onLatticeConfigChange);
  latticeConfigRef.current = latticeConfig;
  onLatticeConfigChangeRef.current = onLatticeConfigChange;
  const [templates, setTemplates] = useState<LatticeTemplate[]>([]);
  const [presets, setPresets] = useState<LatticePreset[]>([]);
  const [existingWorkspaces, setExistingWorkspaces] = useState<LatticeWorkspace[]>([]);

  // Loading states
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);

  // Fetch Lattice info on mount
  useEffect(() => {
    if (!api) return;

    let mounted = true;

    api.lattice
      .getInfo()
      .then((info) => {
        if (mounted) {
          setLatticeInfo(info);
          // Clear Lattice config when CLI is not available (outdated or unavailable)
          if (info.state !== "available" && latticeConfigRef.current != null) {
            onLatticeConfigChangeRef.current(null);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setLatticeInfo({
            state: "unavailable",
            reason: { kind: "error", message: "Failed to fetch" },
          });
          // Clear Lattice config on fetch failure
          if (latticeConfigRef.current != null) {
            onLatticeConfigChangeRef.current(null);
          }
        }
      });

    return () => {
      mounted = false;
    };
  }, [api]);

  // Fetch templates when Lattice is enabled
  useEffect(() => {
    if (!api || !enabled || latticeInfo?.state !== "available") {
      setTemplates([]);
      setLoadingTemplates(false);
      return;
    }

    let mounted = true;
    setLoadingTemplates(true);

    api.lattice
      .listTemplates()
      .then((result) => {
        if (mounted) {
          setTemplates(result);
          // Auto-select first template if none selected
          const autoConfig = buildAutoSelectedTemplateConfig(latticeConfigRef.current, result);
          if (autoConfig) {
            onLatticeConfigChange(autoConfig);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setTemplates([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingTemplates(false);
        }
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only re-fetch on enable/state changes, not on latticeConfig changes
  }, [api, enabled, latticeInfo?.state]);

  // Fetch existing agents when Lattice is enabled
  useEffect(() => {
    if (!api || !enabled || latticeInfo?.state !== "available") {
      setExistingWorkspaces([]);
      setLoadingWorkspaces(false);
      return;
    }

    let mounted = true;
    setLoadingWorkspaces(true);

    api.lattice
      .listWorkspaces()
      .then((result) => {
        if (mounted) {
          // Backend already filters to running workspaces by default
          setExistingWorkspaces(result);
        }
      })
      .catch(() => {
        if (mounted) {
          setExistingWorkspaces([]);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoadingWorkspaces(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [api, enabled, latticeInfo?.state]);

  // Fetch presets when template changes (only for "new" mode)
  useEffect(() => {
    if (!api || !enabled || !latticeConfig?.template || latticeConfig.existingWorkspace) {
      setPresets([]);
      setLoadingPresets(false);
      return;
    }

    let mounted = true;
    setLoadingPresets(true);

    // Capture template/org at request time to detect stale responses
    const templateAtRequest = latticeConfig.template;
    const orgAtRequest = latticeConfig.templateOrg;

    api.lattice
      .listPresets({ template: templateAtRequest, org: orgAtRequest })
      .then((result) => {
        if (!mounted) {
          return;
        }

        // Stale response guard: if user changed template/org while request was in-flight, ignore this response
        if (
          latticeConfigRef.current?.template !== templateAtRequest ||
          latticeConfigRef.current?.templateOrg !== orgAtRequest
        ) {
          return;
        }

        setPresets(result);

        // Presets rules (per spec):
        // - 0 presets: no dropdown
        // - 1 preset: auto-select silently
        // - 2+ presets: dropdown shown, auto-select default if exists, otherwise user must pick
        // Use ref to get current config (avoids stale closure if user changed config during fetch)
        const currentConfig = latticeConfigRef.current;
        if (currentConfig && !currentConfig.existingWorkspace) {
          if (result.length === 1) {
            const onlyPreset = result[0];
            if (onlyPreset && currentConfig.preset !== onlyPreset.name) {
              onLatticeConfigChange({ ...currentConfig, preset: onlyPreset.name });
            }
          } else if (result.length >= 2 && !currentConfig.preset) {
            // Auto-select default preset if available, otherwise first preset
            // This keeps UI and config in sync (UI falls back to first preset for display)
            const defaultPreset = result.find((p) => p.isDefault);
            const presetToSelect = defaultPreset ?? result[0];
            if (presetToSelect) {
              onLatticeConfigChange({ ...currentConfig, preset: presetToSelect.name });
            }
          } else if (result.length === 0 && currentConfig.preset) {
            onLatticeConfigChange({ ...currentConfig, preset: undefined });
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setPresets([]);
        }
      })
      .finally(() => {
        // Only clear loading for the active request (not stale ones)
        if (
          mounted &&
          latticeConfigRef.current?.template === templateAtRequest &&
          latticeConfigRef.current?.templateOrg === orgAtRequest
        ) {
          setLoadingPresets(false);
        }
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-fetch on template/org/existingWorkspace changes, not on preset changes (would cause loop)
  }, [
    api,
    enabled,
    latticeConfig?.template,
    latticeConfig?.templateOrg,
    latticeConfig?.existingWorkspace,
  ]);

  // Handle enabled toggle
  const handleSetEnabled = useCallback(
    (newEnabled: boolean) => {
      if (newEnabled) {
        // Initialize config for new workspace mode (workspaceName omitted; backend derives)
        const firstTemplate = templates[0];
        const firstIsDuplicate = firstTemplate
          ? templates.some(
              (t) =>
                t.name === firstTemplate.name &&
                t.organizationName !== firstTemplate.organizationName
            )
          : false;
        onLatticeConfigChange({
          existingWorkspace: false,
          template: firstTemplate?.name,
          templateOrg: firstIsDuplicate ? firstTemplate?.organizationName : undefined,
        });
      } else {
        onLatticeConfigChange(null);
      }
    },
    [templates, onLatticeConfigChange]
  );

  return {
    enabled,
    setEnabled: handleSetEnabled,
    latticeInfo,
    latticeConfig,
    setLatticeConfig: onLatticeConfigChange,
    templates,
    presets,
    existingWorkspaces,
    loadingTemplates,
    loadingPresets,
    loadingWorkspaces,
  };
}
