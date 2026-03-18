/**
 * Hook for managing Lattice minion async data in the creation flow.
 *
 * Consumes shared Lattice connection state from LatticeRuntimeContext
 * for CLI info, auth, templates, and minion listing. Only manages
 * preset-fetching locally (depends on the selected template).
 *
 * The `latticeConfig` state is owned by the parent (via selectedRuntime.lattice) and passed in.
 * This hook only manages async-fetched data and derived state.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useAPI } from "@/browser/contexts/API";
import { useLatticeRuntime } from "@/browser/contexts/LatticeRuntimeContext";
import type {
  LatticeInfo,
  LatticeWhoami,
  LatticeTemplate,
  LatticePreset,
  LatticeMinion,
} from "@/common/orpc/schemas/lattice";
import type { LatticeMinionConfig } from "@/common/types/runtime";

/**
 * Returns an auto-selected template config if no template is set, otherwise null.
 * Preserves existing config fields (like preset) when auto-selecting.
 */
export function buildAutoSelectedTemplateConfig(
  currentConfig: LatticeMinionConfig | null,
  templates: LatticeTemplate[]
): LatticeMinionConfig | null {
  if (templates.length === 0 || currentConfig?.template || currentConfig?.existingMinion) {
    return null;
  }
  const firstTemplate = templates[0];
  return {
    ...(currentConfig ?? {}),
    existingMinion: false,
    template: firstTemplate.name,
    templateOrg: firstTemplate.organizationName,
  };
}

interface UseLatticeMinionOptions {
  /** Current Lattice config (null = disabled, owned by parent via selectedRuntime.lattice) */
  latticeConfig: LatticeMinionConfig | null;
  /** Callback to update Lattice config (updates selectedRuntime.lattice) */
  onLatticeConfigChange: (config: LatticeMinionConfig | null) => void;
}

interface UseLatticeMinionReturn {
  /** Whether Lattice is enabled (derived: latticeConfig != null AND latticeInfo available) */
  enabled: boolean;
  /** Toggle Lattice on/off (calls onLatticeConfigChange with config or null) */
  setEnabled: (enabled: boolean) => void;

  /** Lattice CLI availability info */
  latticeInfo: LatticeInfo | null;

  /** Lattice authentication identity (null while checking) */
  latticeWhoami: LatticeWhoami | null;

  /** Current Lattice configuration (passed through from props) */
  latticeConfig: LatticeMinionConfig | null;
  /** Update Lattice config (passed through from props) */
  setLatticeConfig: (config: LatticeMinionConfig | null) => void;

  /** Available templates */
  templates: LatticeTemplate[];
  /** Error message when templates fail to load (null = no error) */
  templatesError: string | null;
  /** Presets for the currently selected template */
  presets: LatticePreset[];
  /** Error message when presets fail to load (null = no error) */
  presetsError: string | null;
  /** Running Lattice minions */
  existingMinions: LatticeMinion[];
  /** Error message when minions fail to load (null = no error) */
  minionsError: string | null;

  /** Loading states */
  loadingTemplates: boolean;
  loadingPresets: boolean;
  loadingMinions: boolean;

  /** Re-fetch Lattice CLI info (e.g. after login) */
  refreshLatticeInfo: () => void;
}

/**
 * Manages Lattice minion async data for the creation flow.
 *
 * Shared data (info, whoami, templates, minions) comes from LatticeRuntimeContext.
 * Preset-fetching remains local since it depends on the selected template.
 *
 * State ownership: latticeConfig is owned by parent (selectedRuntime.lattice).
 * This hook derives `enabled` from latticeConfig and manages only async data.
 */
export function useLatticeMinion({
  latticeConfig,
  onLatticeConfigChange,
}: UseLatticeMinionOptions): UseLatticeMinionReturn {
  const { api } = useAPI();

  // Pull shared state from the context (fetched once at app level)
  const runtimeCtx = useLatticeRuntime();
  const latticeInfo = runtimeCtx.info;
  const latticeWhoami = runtimeCtx.whoami;

  // Derived state: enabled when latticeConfig is present AND CLI is confirmed available
  // AND user is authenticated. Loading (null) and outdated/unavailable all result in enabled=false.
  const enabled =
    latticeConfig != null &&
    latticeInfo?.state === "available" &&
    latticeWhoami?.state === "authenticated";

  // Refs to access current values in async callbacks (avoids stale closures)
  const latticeConfigRef = useRef(latticeConfig);
  const onLatticeConfigChangeRef = useRef(onLatticeConfigChange);
  latticeConfigRef.current = latticeConfig;
  onLatticeConfigChangeRef.current = onLatticeConfigChange;

  // Presets (local — depends on selected template)
  const [presets, setPresets] = useState<LatticePreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [loadingPresets, setLoadingPresets] = useState(false);

  // Clear Lattice config when CLI becomes unavailable or user logs out
  useEffect(() => {
    if (latticeInfo && latticeInfo.state !== "available" && latticeConfigRef.current != null) {
      onLatticeConfigChangeRef.current(null);
    }
  }, [latticeInfo]);

  useEffect(() => {
    if (
      latticeWhoami &&
      latticeWhoami.state !== "authenticated" &&
      latticeConfigRef.current != null
    ) {
      onLatticeConfigChangeRef.current(null);
    }
  }, [latticeWhoami]);

  // Auto-select first template when templates load and none is selected
  useEffect(() => {
    if (enabled && runtimeCtx.templates.length > 0) {
      const autoConfig = buildAutoSelectedTemplateConfig(
        latticeConfigRef.current,
        runtimeCtx.templates
      );
      if (autoConfig) {
        onLatticeConfigChange(autoConfig);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally only on templates/enabled changes
  }, [enabled, runtimeCtx.templates]);

  // Fetch presets when template changes (only for "new" mode)
  useEffect(() => {
    if (!api || !enabled || !latticeConfig?.template || latticeConfig.existingMinion) {
      setPresets([]);
      setPresetsError(null);
      setLoadingPresets(false);
      return;
    }

    let mounted = true;
    setLoadingPresets(true);
    setPresetsError(null);

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

        if (result.ok) {
          setPresets(result.presets);
          setPresetsError(null);

          // Presets rules (per spec):
          // - 0 presets: no dropdown
          // - 1 preset: auto-select silently
          // - 2+ presets: dropdown shown, auto-select default if exists, otherwise user must pick
          // Use ref to get current config (avoids stale closure if user changed config during fetch)
          const currentConfig = latticeConfigRef.current;
          if (currentConfig && !currentConfig.existingMinion) {
            if (result.presets.length === 1) {
              const onlyPreset = result.presets[0];
              if (onlyPreset && currentConfig.preset !== onlyPreset.name) {
                onLatticeConfigChange({ ...currentConfig, preset: onlyPreset.name });
              }
            } else if (result.presets.length >= 2 && !currentConfig.preset) {
              // Auto-select default preset if available, otherwise first preset
              // This keeps UI and config in sync (UI falls back to first preset for display)
              const defaultPreset = result.presets.find((p) => p.isDefault);
              const presetToSelect = defaultPreset ?? result.presets[0];
              if (presetToSelect) {
                onLatticeConfigChange({ ...currentConfig, preset: presetToSelect.name });
              }
            } else if (result.presets.length === 0 && currentConfig.preset) {
              onLatticeConfigChange({ ...currentConfig, preset: undefined });
            }
          }
        } else {
          setPresets([]);
          setPresetsError(result.error);
        }
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        if (
          latticeConfigRef.current?.template !== templateAtRequest ||
          latticeConfigRef.current?.templateOrg !== orgAtRequest
        ) {
          return;
        }
        const message =
          error instanceof Error
            ? error.message.split("\n")[0].slice(0, 200).trim()
            : "Unknown error";
        setPresets([]);
        setPresetsError(message || "Unknown error");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only re-fetch on template/org/existingMinion changes, not on preset changes (would cause loop)
  }, [
    api,
    enabled,
    latticeConfig?.template,
    latticeConfig?.templateOrg,
    latticeConfig?.existingMinion,
  ]);

  // Handle enabled toggle
  const handleSetEnabled = useCallback(
    (newEnabled: boolean) => {
      if (newEnabled) {
        // Initialize config for new minion mode (minionName omitted; backend derives)
        const firstTemplate = runtimeCtx.templates[0];
        onLatticeConfigChange({
          existingMinion: false,
          template: firstTemplate?.name,
          templateOrg: firstTemplate?.organizationName,
        });
      } else {
        onLatticeConfigChange(null);
      }
    },
    [runtimeCtx.templates, onLatticeConfigChange]
  );

  return {
    enabled,
    setEnabled: handleSetEnabled,
    latticeInfo,
    latticeWhoami,
    latticeConfig,
    setLatticeConfig: onLatticeConfigChange,
    templates: runtimeCtx.templates,
    templatesError: runtimeCtx.templatesError,
    presets,
    presetsError,
    existingMinions: runtimeCtx.remoteMinions,
    minionsError: runtimeCtx.remoteMinionError,
    loadingTemplates: runtimeCtx.templatesLoading,
    loadingPresets,
    loadingMinions: runtimeCtx.remoteMinionsFetching,
    refreshLatticeInfo: runtimeCtx.refresh,
  };
}
