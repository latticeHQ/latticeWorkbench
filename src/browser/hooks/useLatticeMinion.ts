/**
 * Hook for managing Lattice minion async data in the creation flow.
 * Fetches Lattice CLI info, templates, presets, and existing minions.
 *
 * The `latticeConfig` state is owned by the parent (via selectedRuntime.lattice) and passed in.
 * This hook only manages async-fetched data and derived state.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useAPI } from "@/browser/contexts/API";
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
 * Fetches data lazily:
 * - Lattice info is fetched on mount
 * - Templates are fetched when Lattice is enabled
 * - Presets are fetched when a template is selected
 * - Minions are fetched when Lattice is enabled
 *
 * State ownership: latticeConfig is owned by parent (selectedRuntime.lattice).
 * This hook derives `enabled` from latticeConfig and manages only async data.
 */
export function useLatticeMinion({
  latticeConfig,
  onLatticeConfigChange,
}: UseLatticeMinionOptions): UseLatticeMinionReturn {
  const { api } = useAPI();

  // Async-fetched data (owned by this hook)
  const [latticeInfo, setLatticeInfo] = useState<LatticeInfo | null>(null);
  const [latticeWhoami, setLatticeWhoami] = useState<LatticeWhoami | null>(null);

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
  const [templates, setTemplates] = useState<LatticeTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [presets, setPresets] = useState<LatticePreset[]>([]);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [existingMinions, setExistingMinions] = useState<LatticeMinion[]>([]);
  const [minionsError, setMinionsError] = useState<string | null>(null);

  // Loading states
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [loadingMinions, setLoadingMinions] = useState(false);

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

  // Fetch whoami when CLI is available
  useEffect(() => {
    if (!api || latticeInfo?.state !== "available") {
      return;
    }

    let mounted = true;

    api.lattice
      .whoami()
      .then((whoami) => {
        if (mounted) {
          setLatticeWhoami(whoami);
          // Clear Lattice config when not authenticated
          if (whoami.state !== "authenticated" && latticeConfigRef.current != null) {
            onLatticeConfigChangeRef.current(null);
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setLatticeWhoami({ state: "unauthenticated", reason: "Failed to check authentication" });
          if (latticeConfigRef.current != null) {
            onLatticeConfigChangeRef.current(null);
          }
        }
      });

    return () => {
      mounted = false;
    };
  }, [api, latticeInfo?.state]);

  // Fetch templates when Lattice is enabled
  useEffect(() => {
    if (!api || !enabled || latticeInfo?.state !== "available") {
      setTemplates([]);
      setTemplatesError(null);
      setLoadingTemplates(false);
      return;
    }

    let mounted = true;
    setLoadingTemplates(true);
    setTemplatesError(null);

    api.lattice
      .listTemplates()
      .then((result) => {
        if (!mounted) return;
        if (result.ok) {
          setTemplates(result.templates);
          setTemplatesError(null);
          // Auto-select first template if none selected
          const autoConfig = buildAutoSelectedTemplateConfig(
            latticeConfigRef.current,
            result.templates
          );
          if (autoConfig) {
            onLatticeConfigChange(autoConfig);
          }
        } else {
          setTemplates([]);
          setTemplatesError(result.error);
        }
      })
      .catch((error) => {
        if (!mounted) return;
        const message =
          error instanceof Error
            ? error.message.split("\n")[0].slice(0, 200).trim()
            : "Unknown error";
        setTemplates([]);
        setTemplatesError(message || "Unknown error");
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

  // Fetch existing minions when Lattice is enabled
  useEffect(() => {
    if (!api || !enabled || latticeInfo?.state !== "available") {
      setExistingMinions([]);
      setMinionsError(null);
      setLoadingMinions(false);
      return;
    }

    let mounted = true;
    setLoadingMinions(true);
    setMinionsError(null);

    api.lattice
      .listMinions()
      .then((result) => {
        if (!mounted) return;
        if (result.ok) {
          setExistingMinions(result.minions);
          setMinionsError(null);
        } else {
          // Users reported "No minions found" even when the CLI failed; surface the error.
          setExistingMinions([]);
          setMinionsError(result.error);
        }
      })
      .catch((error) => {
        if (!mounted) return;
        const message =
          error instanceof Error
            ? error.message.split("\n")[0].slice(0, 200).trim()
            : "Unknown error";
        setExistingMinions([]);
        setMinionsError(message || "Unknown error");
      })
      .finally(() => {
        if (mounted) {
          setLoadingMinions(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [api, enabled, latticeInfo?.state]);

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

  // Re-fetch Lattice CLI info and auth state (e.g. after login completes)
  const refreshLatticeInfo = useCallback(() => {
    if (!api) return;
    api.lattice
      .getInfo()
      .then((info) => {
        setLatticeInfo(info);
        if (info.state !== "available" && latticeConfigRef.current != null) {
          onLatticeConfigChangeRef.current(null);
        }
      })
      .catch(() => {
        // Best-effort — leave current info intact on failure.
      });
    // Also refresh whoami (force cache clear)
    api.lattice
      .whoami({ refresh: true })
      .then((whoami) => {
        setLatticeWhoami(whoami);
        if (whoami.state !== "authenticated" && latticeConfigRef.current != null) {
          onLatticeConfigChangeRef.current(null);
        }
      })
      .catch(() => {
        // Best-effort — leave current whoami intact on failure.
      });
  }, [api]);

  // Handle enabled toggle
  const handleSetEnabled = useCallback(
    (newEnabled: boolean) => {
      if (newEnabled) {
        // Initialize config for new minion mode (minionName omitted; backend derives)
        const firstTemplate = templates[0];
        onLatticeConfigChange({
          existingMinion: false,
          template: firstTemplate?.name,
          templateOrg: firstTemplate?.organizationName,
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
    latticeWhoami,
    latticeConfig,
    setLatticeConfig: onLatticeConfigChange,
    templates,
    templatesError,
    presets,
    presetsError,
    existingMinions,
    minionsError,
    loadingTemplates,
    loadingPresets,
    loadingMinions,
    refreshLatticeInfo,
  };
}
