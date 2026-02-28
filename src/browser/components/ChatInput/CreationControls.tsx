import React, { useCallback, useEffect, useState } from "react";
import {
  RUNTIME_MODE,
  type LatticeMinionConfig,
  type RuntimeMode,
  type ParsedRuntime,
  type RuntimeEnablement,
  LATTICE_RUNTIME_PLACEHOLDER,
} from "@/common/types/runtime";
import type { RuntimeAvailabilityMap, RuntimeAvailabilityState } from "./useCreationMinion";
import {
  resolveDevcontainerSelection,
  DEFAULT_DEVCONTAINER_CONFIG_PATH,
} from "@/browser/utils/devcontainerSelection";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { GitBranch, Loader2, Sparkles } from "lucide-react";
import { PlatformPaths } from "@/common/utils/paths";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useMinionContext } from "@/browser/contexts/MinionContext";
import { RuntimeConfigInput } from "@/browser/components/RuntimeConfigInput";
import { cn } from "@/common/lib/utils";
import { formatNameGenerationError } from "@/common/utils/errors/formatNameGenerationError";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Skeleton } from "../ui/skeleton";
import { DocsLink } from "../DocsLink";
import {
  RUNTIME_CHOICE_UI,
  RUNTIME_OPTION_FIELDS,
  type RuntimeChoice,
  type RuntimeIconProps,
} from "@/browser/utils/runtimeUi";
import type { MinionNameState, MinionNameUIError } from "@/browser/hooks/useMinionName";
import type { LatticeInfo } from "@/common/orpc/schemas/lattice";
import type { CrewConfig } from "@/common/types/project";
import { resolveCrewColor } from "@/common/constants/ui";
import {
  LatticeAvailabilityMessage,
  LatticeMinionForm,
  resolveLatticeAvailability,
  type LatticeAvailabilityState,
  type LatticeControlsProps,
} from "./LatticeControls";
import { LatticeLoginDialog, extractDeploymentUrl } from "@/browser/components/LatticeLoginDialog";
import { LatticeInstallDialog } from "@/browser/components/LatticeInstallDialog";

/**
 * Shared styling for inline form controls in the creation UI.
 * Used by both Select and text inputs to ensure visual consistency.
 * Fixed width ensures Select (with chevron) and text inputs render identically.
 * Modernized with softer borders and accent focus ring for premium feel.
 */
const INLINE_CONTROL_CLASSES =
  "h-7 w-[140px] rounded-md border border-border-light bg-bg-dark/60 px-2 text-xs text-foreground transition-colors focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

/** Credential sharing checkbox - used by Docker and Devcontainer runtimes */
function CredentialSharingCheckbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  docsPath: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
        className="accent-accent"
      />
      <span className="text-muted">Share credentials (SSH, Git)</span>
      <DocsLink path={props.docsPath} />
    </label>
  );
}

function NameErrorDisplay(props: { error: MinionNameUIError }) {
  // Validation and transport errors are already human-readable plain text.
  if (props.error.kind === "validation" || props.error.kind === "transport") {
    return <span className="text-xs text-red-500">{props.error.message}</span>;
  }

  const formatted = formatNameGenerationError(props.error.error);
  return (
    <div className="text-primary rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs">
      <div className="font-medium">{formatted.title}</div>
      <div>{formatted.message}</div>
      {formatted.hint && <div className="text-secondary mt-1">Fix: {formatted.hint}</div>}
      {formatted.docsPath && (
        <DocsLink path={formatted.docsPath} className="mt-1 text-xs">
          Troubleshooting
        </DocsLink>
      )}
    </div>
  );
}

interface CreationControlsProps {
  branches: string[];
  /** Whether branches have finished loading (to distinguish loading vs non-git repo) */
  branchesLoaded: boolean;
  trunkBranch: string;
  onTrunkBranchChange: (branch: string) => void;
  /** Currently selected runtime (discriminated union: SSH has host, Docker has image) */
  selectedRuntime: ParsedRuntime;
  /** Fallback Lattice config to restore prior selections. */
  latticeConfigFallback: LatticeMinionConfig;
  /** Fallback SSH host to restore when leaving Lattice. */
  sshHostFallback: string;
  defaultRuntimeMode: RuntimeChoice;
  /** Set the currently selected runtime (discriminated union) */
  onSelectedRuntimeChange: (runtime: ParsedRuntime) => void;
  onSetDefaultRuntime: (mode: RuntimeChoice) => void;
  disabled: boolean;
  /** Project path to display (and used for project selector) */
  projectPath: string;
  /** Project name to display as header */
  projectName: string;
  /** Minion name/title generation state and actions */
  nameState: MinionNameState;
  /** Runtime availability state for each mode */
  runtimeAvailabilityState: RuntimeAvailabilityState;
  /** Runtime enablement toggles from Settings (hide disabled runtimes). */
  runtimeEnablement?: RuntimeEnablement;
  /** Available crews for this project */
  sections?: CrewConfig[];
  /** Currently selected crew ID */
  selectedSectionId?: string | null;
  /** Callback when crew selection changes */
  onSectionChange?: (crewId: string | null) => void;
  /** Which runtime field (if any) is in error state for visual feedback */
  runtimeFieldError?: "docker" | "ssh" | null;

  /** Policy: allowed runtime modes (null/undefined = allow all) */
  allowedRuntimeModes?: RuntimeMode[] | null;
  /** Policy: allow plain host SSH */
  allowSshHost?: boolean;
  /** Policy: allow Lattice-backed SSH */
  allowSshLattice?: boolean;
  /** Optional policy error message to display near runtime controls */
  runtimePolicyError?: string | null;
  /** Lattice CLI availability info (null while checking) */
  latticeInfo?: LatticeInfo | null;
  /** Lattice minion controls props (optional - only rendered when provided) */
  latticeProps?: Omit<LatticeControlsProps, "disabled">;
}

/** Runtime type button group with icons and colors */
interface RuntimeButtonGroupProps {
  value: RuntimeChoice;
  onChange: (mode: RuntimeChoice) => void;
  defaultMode: RuntimeChoice;
  onSetDefault: (mode: RuntimeChoice) => void;
  disabled?: boolean;
  runtimeAvailabilityState?: RuntimeAvailabilityState;
  runtimeEnablement?: RuntimeEnablement;
  latticeInfo?: LatticeInfo | null;
  allowedRuntimeModes?: RuntimeMode[] | null;
  allowSshHost?: boolean;
  allowSshLattice?: boolean;
}

const RUNTIME_CHOICE_ORDER: RuntimeChoice[] = [
  RUNTIME_MODE.LOCAL,
  RUNTIME_MODE.WORKTREE,
  RUNTIME_MODE.SSH,
  "lattice",
  RUNTIME_MODE.DOCKER,
  RUNTIME_MODE.DEVCONTAINER,
];

const RUNTIME_FALLBACK_ORDER: RuntimeChoice[] = [
  RUNTIME_MODE.WORKTREE,
  RUNTIME_MODE.LOCAL,
  RUNTIME_MODE.SSH,
  "lattice",
  RUNTIME_MODE.DOCKER,
  RUNTIME_MODE.DEVCONTAINER,
];

const RUNTIME_CHOICE_OPTIONS: Array<{
  value: RuntimeChoice;
  label: string;
  description: string;
  docsPath: string;
  Icon: React.ComponentType<RuntimeIconProps>;
  // Active state colors using CSS variables for theme support
  activeClass: string;
  idleClass: string;
}> = RUNTIME_CHOICE_ORDER.map((mode) => {
  const ui = RUNTIME_CHOICE_UI[mode];
  return {
    value: mode,
    label: ui.label,
    description: ui.description,
    docsPath: ui.docsPath,
    Icon: ui.Icon,
    activeClass: ui.button.activeClass,
    idleClass: ui.button.idleClass,
  };
});

interface RuntimeButtonState {
  isModeDisabled: boolean;
  isPolicyDisabled: boolean;
  disabledReason?: string;
  isDefault: boolean;
}

const resolveRuntimeButtonState = (
  value: RuntimeChoice,
  availabilityMap: RuntimeAvailabilityMap | null,
  defaultMode: RuntimeChoice,
  latticeAvailability: LatticeAvailabilityState,
  allowedModeSet: Set<RuntimeMode> | null,
  allowSshHost: boolean,
  allowSshLattice: boolean
): RuntimeButtonState => {
  const isPolicyAllowed = (): boolean => {
    if (!allowedModeSet) {
      return true;
    }

    if (value === "lattice") {
      return allowSshLattice;
    }

    if (value === RUNTIME_MODE.SSH) {
      // Host SSH is separate from Lattice; block it when policy forbids host SSH.
      return allowSshHost;
    }

    return allowedModeSet.has(value);
  };

  const isPolicyDisabled = !isPolicyAllowed();

  // Lattice availability: keep the button disabled with a reason until the CLI is ready.
  if (value === "lattice" && latticeAvailability.state !== "available") {
    return {
      isModeDisabled: true,
      isPolicyDisabled,
      disabledReason: isPolicyDisabled ? "Disabled by policy" : latticeAvailability.reason,
      isDefault: defaultMode === value,
    };
  }

  // Lattice is SSH under the hood; all other RuntimeChoice values are RuntimeMode identity.
  const availabilityKey = value === "lattice" ? RUNTIME_MODE.SSH : value;
  const availability = availabilityMap?.[availabilityKey];
  // Disable only if availability is explicitly known and unavailable.
  // When availability is undefined (loading or fetch failed), allow selection
  // as fallback - the config picker will validate before creation.
  const isModeDisabled = availability !== undefined && !availability.available;
  const disabledReason = isPolicyDisabled
    ? "Disabled by policy"
    : availability && !availability.available
      ? availability.reason
      : undefined;

  return {
    isModeDisabled,
    isPolicyDisabled,
    disabledReason,
    isDefault: defaultMode === value,
  };
};

/** Inline chip-based crew picker — no dropdown, just clickable pills.
 *  Eliminates floating-element positioning issues entirely. */
interface SectionPickerProps {
  sections: CrewConfig[];
  selectedSectionId: string | null;
  onSectionChange: (crewId: string | null) => void;
  disabled?: boolean;
}

function SectionPicker(props: SectionPickerProps) {
  const { sections, selectedSectionId, onSectionChange, disabled } = props;

  const normalizedSelectedSectionId =
    selectedSectionId && selectedSectionId.trim().length > 0 ? selectedSectionId : null;

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="section-selector"
      data-selected-section={normalizedSelectedSectionId ?? ""}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Section">
        {sections.map((section) => {
          const color = resolveCrewColor(section.color);
          const isSelected = section.id === normalizedSelectedSectionId;
          return (
            <button
              key={section.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              onClick={() => onSectionChange(isSelected ? null : section.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all duration-200",
                isSelected
                  ? "creation-section-chip-glow text-foreground"
                  : "border-transparent text-muted hover:text-foreground hover:bg-hover",
                disabled && "cursor-not-allowed opacity-50"
              )}
              style={
                isSelected
                  ? ({
                      borderColor: color,
                      backgroundColor: `${color}12`,
                      "--section-glow-color": `${color}40`,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color, opacity: isSelected ? 1 : 0.5 }}
              />
              {section.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuntimeButtonGroup(props: RuntimeButtonGroupProps) {
  const state = props.runtimeAvailabilityState;
  const availabilityMap = state?.status === "loaded" ? state.data : null;
  const latticeInfo = props.latticeInfo ?? null;
  const latticeAvailability = resolveLatticeAvailability(latticeInfo);
  const runtimeEnablement = props.runtimeEnablement;

  const allowSshHost = props.allowSshHost ?? true;
  const allowSshLattice = props.allowSshLattice ?? true;
  const allowedModeSet = props.allowedRuntimeModes ? new Set(props.allowedRuntimeModes) : null;
  const isSshModeAllowed = !allowedModeSet || allowedModeSet.has(RUNTIME_MODE.SSH);

  const isDevcontainerMissing =
    availabilityMap?.devcontainer?.available === false &&
    availabilityMap.devcontainer.reason === "No devcontainer.json found";
  // Hide devcontainer while loading OR when confirmed missing.
  // Only show when availability is loaded and devcontainer is available.
  // This prevents layout flash for projects without devcontainer.json (the common case).
  const hideDevcontainer = state?.status === "loading" || isDevcontainerMissing;
  // Keep Devcontainer visible when policy requires it so the selector doesn't go empty.
  const isDevcontainerOnlyPolicy =
    allowedModeSet?.size === 1 && allowedModeSet.has(RUNTIME_MODE.DEVCONTAINER);
  const shouldForceShowDevcontainer =
    props.value === RUNTIME_MODE.DEVCONTAINER ||
    (isDevcontainerOnlyPolicy && isDevcontainerMissing);

  // Match devcontainer UX: only surface Lattice once availability is confirmed (no flash),
  // but keep it visible when policy requires it or when already selected to avoid an empty selector.
  const shouldForceShowLattice =
    props.value === "lattice" || (allowSshLattice && !allowSshHost && isSshModeAllowed);
  const shouldShowLattice = latticeAvailability.shouldShowRuntimeButton || shouldForceShowLattice;

  const runtimeVisibilityOverrides: Partial<Record<RuntimeChoice, boolean>> = {
    [RUNTIME_MODE.DEVCONTAINER]: !hideDevcontainer || shouldForceShowDevcontainer,
    lattice: shouldShowLattice,
  };

  // Policy filtering keeps forbidden runtimes out of the selector so users don't
  // get stuck with defaults that can never be created.
  const runtimeOptions = RUNTIME_CHOICE_OPTIONS.filter((option) => {
    if (runtimeVisibilityOverrides[option.value] === false) {
      return false;
    }

    // User request: hide Settings-disabled runtimes (selection auto-switches elsewhere).
    // Keep the currently active runtime visible even if disabled to avoid trapping the user
    // when the fallback can't find a replacement (e.g., non-git repo with Local disabled).
    const isEnablementDisabled = runtimeEnablement?.[option.value] === false;
    if (isEnablementDisabled && option.value !== props.value) {
      return false;
    }

    const { isPolicyDisabled } = resolveRuntimeButtonState(
      option.value,
      availabilityMap,
      props.defaultMode,
      latticeAvailability,
      allowedModeSet,
      allowSshHost,
      allowSshLattice
    );

    if (isPolicyDisabled && props.value !== option.value) {
      return false;
    }

    return true;
  });

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Runtime type">
      {runtimeOptions.map((option) => {
        const isActive = props.value === option.value;
        const {
          isModeDisabled,
          isPolicyDisabled,
          disabledReason: resolvedDisabledReason,
        } = resolveRuntimeButtonState(
          option.value,
          availabilityMap,
          props.defaultMode,
          latticeAvailability,
          allowedModeSet,
          allowSshHost,
          allowSshLattice
        );
        const disabledReason = resolvedDisabledReason;
        const isDisabled = Boolean(props.disabled) || isModeDisabled || isPolicyDisabled;
        const showDisabledReason = isModeDisabled || isPolicyDisabled;

        const Icon = option.Icon;

        return (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => props.onChange(option.value)}
                disabled={isDisabled}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-200",
                  isActive ? option.activeClass : option.idleClass,
                  isDisabled && "cursor-not-allowed opacity-50"
                )}
              >
                <Icon size={12} />
                {option.label}
              </button>
            </TooltipTrigger>
            <TooltipContent
              align="center"
              side="bottom"
              className="pointer-events-auto whitespace-normal"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span>{option.description}</span>
                <DocsLink path={option.docsPath} />
              </div>
              {showDisabledReason ? (
                <p className="mt-1 text-yellow-500">{disabledReason ?? "Unavailable"}</p>
              ) : null}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * Prominent controls shown above the input during minion creation.
 * Compact flat layout with thin dividers between crews.
 */
export function CreationControls(props: CreationControlsProps) {
  const { projects } = useProjectContext();
  const settings = useSettings();
  const { beginMinionCreation } = useMinionContext();
  const { nameState, runtimeAvailabilityState } = props;

  // Extract mode from discriminated union for convenience
  const runtimeMode = props.selectedRuntime.mode;
  const { selectedRuntime, onSelectedRuntimeChange } = props;
  // Lattice is surfaced as a separate runtime option while keeping SSH as the config mode.
  const isLatticeSelected =
    selectedRuntime.mode === RUNTIME_MODE.SSH && selectedRuntime.lattice != null;
  const runtimeChoice: RuntimeChoice = isLatticeSelected ? "lattice" : runtimeMode;
  const latticeInfo = props.latticeInfo ?? props.latticeProps?.latticeInfo ?? null;
  const latticeWhoami = props.latticeProps?.latticeWhoami ?? null;
  const latticeAvailability = resolveLatticeAvailability(latticeInfo, latticeWhoami);
  const isLatticeAvailable = latticeAvailability.state === "available";
  const latticeUsername = latticeWhoami?.state === "authenticated" ? latticeWhoami.username : undefined;
  const latticeDeploymentUrl = latticeWhoami?.state === "authenticated" ? latticeWhoami.deploymentUrl : undefined;
  const latticeNotLoggedIn = latticeAvailability.state === "unauthenticated";
  const latticeMissing =
    latticeInfo?.state === "unavailable" && latticeInfo.reason === "missing";
  const latticeLoginDefaultUrl = latticeNotLoggedIn && latticeWhoami?.state === "unauthenticated"
    ? extractDeploymentUrl(latticeWhoami.reason)
    : undefined;
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);

  const availabilityMap =
    runtimeAvailabilityState.status === "loaded" ? runtimeAvailabilityState.data : null;

  // Centralized devcontainer selection logic
  const devcontainerSelection = resolveDevcontainerSelection({
    selectedRuntime,
    availabilityState: runtimeAvailabilityState,
  });

  const isDevcontainerMissing =
    availabilityMap?.devcontainer?.available === false &&
    availabilityMap.devcontainer.reason === "No devcontainer.json found";

  // Check if git is required (worktree unavailable due to git or no branches)
  const isNonGitRepo =
    (availabilityMap?.worktree?.available === false &&
      availabilityMap.worktree.reason === "Requires git repository") ||
    (props.branchesLoaded && props.branches.length === 0);

  const branchOptions =
    props.trunkBranch && !props.branches.includes(props.trunkBranch)
      ? [props.trunkBranch, ...props.branches]
      : props.branches;
  const isBranchSelectorDisabled =
    Boolean(props.disabled) || isNonGitRepo || branchOptions.length === 0;

  // Keep selected runtime aligned with availability + Settings enablement constraints.
  // All constraint checks (non-git, devcontainer missing, enablement, policy) are unified
  // into a single firstEnabled fallback so every edge combination is handled consistently.
  useEffect(() => {
    const runtimeEnablement = props.runtimeEnablement;

    // Determine if the current selection needs correction.
    const isCurrentDisabledBySettings = runtimeEnablement?.[runtimeChoice] === false;
    // In non-git repos all modes except Local are unavailable (not just Worktree).
    const isCurrentUnavailable =
      (isNonGitRepo && selectedRuntime.mode !== RUNTIME_MODE.LOCAL) ||
      (isDevcontainerMissing && selectedRuntime.mode === RUNTIME_MODE.DEVCONTAINER);

    if (!isCurrentDisabledBySettings && !isCurrentUnavailable) {
      return;
    }

    // Build a policy set matching RuntimeButtonGroup's eligibility logic so the
    // auto-switch fallback never lands on a policy-forbidden runtime.
    const allowedModes = props.allowedRuntimeModes
      ? new Set<RuntimeMode>(props.allowedRuntimeModes)
      : null;

    const firstEnabled = RUNTIME_FALLBACK_ORDER.find((mode) => {
      if (runtimeEnablement?.[mode] === false) {
        return false;
      }
      if (mode === "lattice") {
        if (!props.latticeProps) {
          return false;
        }
        if (!isLatticeAvailable) {
          return false;
        }
      }
      // Filter by availability to avoid selecting unavailable runtimes (e.g., Docker
      // when daemon is down, devcontainer when config missing, non-git projects).
      if (isDevcontainerMissing && mode === RUNTIME_MODE.DEVCONTAINER) {
        return false;
      }
      if (isNonGitRepo && mode !== RUNTIME_MODE.LOCAL) {
        return false;
      }
      // Check the general availability map for any other unavailable runtimes.
      if (mode !== "lattice") {
        const avail = availabilityMap?.[mode];
        if (avail !== undefined && !avail.available) {
          return false;
        }
      }
      // Filter by policy constraints to avoid selecting a blocked runtime.
      if (allowedModes) {
        if (mode === "lattice" && !(props.allowSshLattice ?? true)) {
          return false;
        }
        if (mode === RUNTIME_MODE.SSH && !(props.allowSshHost ?? true)) {
          return false;
        }
        if (mode !== "lattice" && mode !== RUNTIME_MODE.SSH && !allowedModes.has(mode)) {
          return false;
        }
      }
      return true;
    });
    if (!firstEnabled || firstEnabled === runtimeChoice) {
      return;
    }

    // User request: auto-switch away from Settings-disabled runtimes.
    if (firstEnabled === "lattice") {
      if (!props.latticeProps || !isLatticeAvailable) {
        return;
      }
      onSelectedRuntimeChange({
        mode: "ssh",
        host: LATTICE_RUNTIME_PLACEHOLDER,
        lattice: props.latticeConfigFallback,
      });
      return;
    }

    switch (firstEnabled) {
      case RUNTIME_MODE.SSH: {
        const sshHost =
          selectedRuntime.mode === RUNTIME_MODE.SSH &&
          selectedRuntime.host !== LATTICE_RUNTIME_PLACEHOLDER
            ? selectedRuntime.host
            : props.sshHostFallback;
        onSelectedRuntimeChange({
          mode: "ssh",
          host: sshHost,
        });
        return;
      }
      case RUNTIME_MODE.DOCKER:
        onSelectedRuntimeChange({
          mode: "docker",
          image: selectedRuntime.mode === "docker" ? selectedRuntime.image : "",
        });
        return;
      case RUNTIME_MODE.DEVCONTAINER: {
        const initialSelection = resolveDevcontainerSelection({
          selectedRuntime: { mode: "devcontainer", configPath: "" },
          availabilityState: runtimeAvailabilityState,
        });
        onSelectedRuntimeChange({
          mode: "devcontainer",
          configPath:
            selectedRuntime.mode === "devcontainer"
              ? selectedRuntime.configPath
              : initialSelection.configPath,
          shareCredentials:
            selectedRuntime.mode === "devcontainer" ? selectedRuntime.shareCredentials : false,
        });
        return;
      }
      case RUNTIME_MODE.LOCAL:
        onSelectedRuntimeChange({ mode: "local" });
        return;
      case RUNTIME_MODE.WORKTREE:
      default:
        onSelectedRuntimeChange({ mode: "worktree" });
        return;
    }
  }, [
    isDevcontainerMissing,
    isNonGitRepo,
    onSelectedRuntimeChange,
    props.latticeConfigFallback,
    props.latticeProps,
    props.runtimeEnablement,
    props.sshHostFallback,
    props.allowedRuntimeModes,
    props.allowSshHost,
    props.allowSshLattice,
    availabilityMap,
    runtimeAvailabilityState,
    runtimeChoice,
    selectedRuntime,
    isLatticeAvailable,
  ]);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      nameState.setName(e.target.value);
    },
    [nameState]
  );

  // Clicking into the input disables auto-generation so user can edit
  const handleInputFocus = useCallback(() => {
    if (nameState.autoGenerate) {
      nameState.setAutoGenerate(false);
    }
  }, [nameState]);

  // Toggle auto-generation via wand button
  const handleWandClick = useCallback(() => {
    nameState.setAutoGenerate(!nameState.autoGenerate);
  }, [nameState]);

  const hasSections = props.sections && props.sections.length > 0 && props.onSectionChange;

  return (
    <div className="mb-3 flex flex-col gap-4">
      {/* ── Name ── */}
      <div className="flex flex-col gap-2">
        <span className="creation-section-label">Name</span>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1 text-xs" data-component="MinionNameGroup">
            {projects.size > 1 ? (
              <RadixSelect
                value={props.projectPath}
                onValueChange={(path) => beginMinionCreation(path)}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <SelectTrigger
                      aria-label="Select project"
                      data-testid="project-selector"
                      className="text-muted-foreground hover:text-foreground h-5 w-auto max-w-[280px] shrink-0 border-transparent bg-transparent px-0 text-xs font-medium shadow-none"
                    >
                      <SelectValue placeholder={props.projectName} />
                    </SelectTrigger>
                  </TooltipTrigger>
                  <TooltipContent align="start">{props.projectPath}</TooltipContent>
                </Tooltip>
                <SelectContent>
                  {Array.from(projects.keys()).map((path) => (
                    <SelectItem key={path} value={path}>
                      {PlatformPaths.basename(path)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </RadixSelect>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-muted-foreground text-xs font-medium">
                    {props.projectName}
                  </span>
                </TooltipTrigger>
                <TooltipContent align="start">{props.projectPath}</TooltipContent>
              </Tooltip>
            )}
            <span className="text-muted-foreground">/</span>
          </div>

          {/* Minion name — hero input with refined focus state */}
          <div className="flex min-w-0 flex-col gap-1" data-component="MinionNameInputBlock">
            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <input
                    id="minion-name"
                    type="text"
                    value={nameState.name}
                    onChange={handleNameChange}
                    onFocus={handleInputFocus}
                    placeholder={nameState.isGenerating ? "Generating..." : "minion-name"}
                    disabled={props.disabled}
                    className={cn(
                      "h-9 w-full rounded-lg border bg-bg-dark/60 px-3 text-base font-semibold",
                      "text-foreground placeholder:text-muted-foreground/60",
                      "border-border-light transition-all duration-200",
                      "focus:border-accent/60 focus:ring-1 focus:ring-accent/20 focus:outline-none",
                      "disabled:opacity-50",
                      nameState.autoGenerate && "text-muted",
                      nameState.error && "border-red-500 focus:border-red-500 focus:ring-red-500/20"
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent align="start" className="max-w-64">
                  A stable identifier used for git branches, worktree folders, and session
                  directories.
                </TooltipContent>
              </Tooltip>
              {nameState.isGenerating ? (
                <Loader2 className="text-accent h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleWandClick}
                      disabled={props.disabled}
                      className="flex shrink-0 items-center rounded-md p-1 transition-colors duration-200 hover:bg-hover disabled:opacity-50"
                      aria-label={
                        nameState.autoGenerate ? "Disable auto-naming" : "Enable auto-naming"
                      }
                    >
                      <Sparkles
                        className={cn(
                          "h-4 w-4 transition-all duration-200",
                          nameState.autoGenerate
                            ? "text-accent"
                            : "text-muted-foreground/50 hover:text-muted-foreground/75"
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent align="center">
                    {nameState.autoGenerate ? "Auto-naming enabled" : "Click to enable auto-naming"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {nameState.error && <NameErrorDisplay error={nameState.error} />}
          </div>
        </div>
      </div>

      <div className="creation-divider" />

      {/* ── Environment ── */}
      <div className="flex flex-col gap-2.5">
        <span className="creation-section-label">Environment</span>
        <div className="flex flex-col gap-2.5" data-component="RuntimeTypeGroup">
          <RuntimeButtonGroup
            value={runtimeChoice}
            onChange={(mode) => {
              if (mode === "lattice") {
                if (!props.latticeProps) {
                  return;
                }
                // Switch to SSH mode with the last known Lattice config so prior selections restore.
                onSelectedRuntimeChange({
                  mode: "ssh",
                  host: LATTICE_RUNTIME_PLACEHOLDER,
                  lattice: props.latticeConfigFallback,
                });
                return;
              }
              // Convert mode to ParsedRuntime with appropriate defaults
              switch (mode) {
                case RUNTIME_MODE.SSH: {
                  const sshHost =
                    selectedRuntime.mode === "ssh" &&
                    selectedRuntime.host !== LATTICE_RUNTIME_PLACEHOLDER
                      ? selectedRuntime.host
                      : props.sshHostFallback;
                  onSelectedRuntimeChange({
                    mode: "ssh",
                    host: sshHost,
                  });
                  break;
                }
                case RUNTIME_MODE.DOCKER:
                  onSelectedRuntimeChange({
                    mode: "docker",
                    image: selectedRuntime.mode === "docker" ? selectedRuntime.image : "",
                  });
                  break;
                case RUNTIME_MODE.DEVCONTAINER: {
                  // Use resolver to get initial config path (prefers first available config)
                  const initialSelection = resolveDevcontainerSelection({
                    selectedRuntime: { mode: "devcontainer", configPath: "" },
                    availabilityState: runtimeAvailabilityState,
                  });
                  onSelectedRuntimeChange({
                    mode: "devcontainer",
                    configPath:
                      selectedRuntime.mode === "devcontainer"
                        ? selectedRuntime.configPath
                        : initialSelection.configPath,
                    shareCredentials:
                      selectedRuntime.mode === "devcontainer"
                        ? selectedRuntime.shareCredentials
                        : false,
                  });
                  break;
                }
                case RUNTIME_MODE.LOCAL:
                  onSelectedRuntimeChange({ mode: "local" });
                  break;
                case RUNTIME_MODE.WORKTREE:
                default:
                  onSelectedRuntimeChange({ mode: "worktree" });
                  break;
              }
            }}
            defaultMode={props.defaultRuntimeMode}
            onSetDefault={props.onSetDefaultRuntime}
            disabled={props.disabled}
            runtimeAvailabilityState={runtimeAvailabilityState}
            runtimeEnablement={props.runtimeEnablement}
            latticeInfo={latticeInfo}
            allowedRuntimeModes={props.allowedRuntimeModes}
            allowSshHost={props.allowSshHost}
            allowSshLattice={props.allowSshLattice}
          />

          {/* Branch + set defaults */}
          <div
            className="flex items-center gap-2.5"
            data-component="BranchSelector"
            data-tutorial="trunk-branch"
          >
            <label className="text-muted-foreground/80 flex items-center gap-1.5 text-xs">
              <GitBranch className="h-3 w-3" />
              <span>Branch</span>
            </label>
            {props.branchesLoaded ? (
              <RadixSelect
                value={props.trunkBranch}
                onValueChange={props.onTrunkBranchChange}
                disabled={isBranchSelectorDisabled}
              >
                <SelectTrigger className={INLINE_CONTROL_CLASSES} aria-label="Select branch">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent className="border-border-medium">
                  {branchOptions.map((branch) => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </RadixSelect>
            ) : (
              <Skeleton className="h-7 w-[140px] rounded" />
            )}
            {/* Subtle set-defaults link, highlighted when runtime differs from default */}
            <button
              type="button"
              onClick={() => settings.open("runtimes", { runtimesProjectPath: props.projectPath })}
              className={cn(
                "ml-auto text-[10px] transition-colors duration-200",
                runtimeChoice !== props.defaultRuntimeMode
                  ? "text-warning/90 hover:text-warning"
                  : "text-muted/60 hover:text-muted-foreground"
              )}
            >
              defaults
            </button>
          </div>

          {/* SSH Host Input */}
          {selectedRuntime.mode === "ssh" &&
            !isLatticeSelected &&
            (props.allowSshHost ?? true) &&
            !props.latticeProps?.enabled &&
            !(props.latticeProps?.latticeInfo === null && props.latticeProps?.latticeConfig) && (
              <RuntimeConfigInput
                id="ssh-host"
                label={RUNTIME_OPTION_FIELDS.ssh.label}
                value={selectedRuntime.host}
                onChange={(value) => onSelectedRuntimeChange({ mode: "ssh", host: value })}
                placeholder={RUNTIME_OPTION_FIELDS.ssh.placeholder}
                disabled={props.disabled}
                hasError={props.runtimeFieldError === "ssh"}
                inputClassName={INLINE_CONTROL_CLASSES}
              />
            )}

          {/* Docker image input */}
          {selectedRuntime.mode === "docker" && (
            <RuntimeConfigInput
              label={RUNTIME_OPTION_FIELDS.docker.label}
              value={selectedRuntime.image}
              onChange={(value) =>
                onSelectedRuntimeChange({
                  mode: "docker",
                  image: value,
                  shareCredentials: selectedRuntime.shareCredentials,
                })
              }
              placeholder={RUNTIME_OPTION_FIELDS.docker.placeholder}
              disabled={props.disabled}
              hasError={props.runtimeFieldError === "docker"}
              id="docker-image"
              ariaLabel="Docker image"
              inputClassName={INLINE_CONTROL_CLASSES}
            />
          )}

          {props.runtimePolicyError && (
            <p className="text-xs text-red-500">{props.runtimePolicyError}</p>
          )}

          {/* Dev container controls */}
          {selectedRuntime.mode === "devcontainer" && devcontainerSelection.uiMode !== "hidden" && (
            <div className="border-border-medium flex w-fit flex-col gap-1.5 rounded-md border p-2">
              <div className="flex flex-col gap-1">
                <label className="text-muted-foreground text-xs">
                  {RUNTIME_OPTION_FIELDS.devcontainer.label}
                </label>
                {devcontainerSelection.uiMode === "loading" ? (
                  <Skeleton className="h-6 w-[280px] rounded-md" />
                ) : devcontainerSelection.uiMode === "dropdown" ? (
                  <RadixSelect
                    value={devcontainerSelection.configPath}
                    onValueChange={(value) =>
                      onSelectedRuntimeChange({
                        mode: "devcontainer",
                        configPath: value,
                        shareCredentials: selectedRuntime.shareCredentials,
                      })
                    }
                    disabled={props.disabled}
                  >
                    <SelectTrigger
                      className="h-6 w-[280px] text-xs"
                      aria-label="Dev container config"
                    >
                      <SelectValue placeholder="Select config" />
                    </SelectTrigger>
                    <SelectContent>
                      {devcontainerSelection.configs.map((config) => (
                        <SelectItem key={config.path} value={config.path}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </RadixSelect>
                ) : (
                  <input
                    type="text"
                    value={devcontainerSelection.configPath}
                    onChange={(e) =>
                      onSelectedRuntimeChange({
                        mode: "devcontainer",
                        configPath: e.target.value,
                        shareCredentials: selectedRuntime.shareCredentials,
                      })
                    }
                    placeholder={DEFAULT_DEVCONTAINER_CONFIG_PATH}
                    disabled={props.disabled}
                    className={cn(
                      "bg-bg-dark text-foreground border-border-medium focus:border-accent h-7 w-[280px] rounded-md border px-2 text-xs focus:outline-none disabled:opacity-50"
                    )}
                    aria-label="Dev container config path"
                  />
                )}
              </div>
              {devcontainerSelection.helperText && (
                <p className="text-muted-foreground text-xs">{devcontainerSelection.helperText}</p>
              )}
              <CredentialSharingCheckbox
                checked={selectedRuntime.shareCredentials ?? false}
                onChange={(checked) =>
                  onSelectedRuntimeChange({
                    mode: "devcontainer",
                    configPath: devcontainerSelection.configPath,
                    shareCredentials: checked,
                  })
                }
                disabled={props.disabled}
                docsPath="/runtime/docker#credential-sharing"
              />
            </div>
          )}

          {/* Docker credential sharing */}
          {selectedRuntime.mode === "docker" && (
            <CredentialSharingCheckbox
              checked={selectedRuntime.shareCredentials ?? false}
              onChange={(checked) =>
                onSelectedRuntimeChange({
                  mode: "docker",
                  image: selectedRuntime.image,
                  shareCredentials: checked,
                })
              }
              disabled={props.disabled}
              docsPath="/runtime/docker#credential-sharing"
            />
          )}

          {/* Lattice Controls */}
          {isLatticeSelected && props.latticeProps && (
            <div className="flex flex-col gap-1.5" data-testid="lattice-controls">
              <LatticeAvailabilityMessage
                latticeInfo={props.latticeProps.latticeInfo}
                latticeWhoami={props.latticeProps.latticeWhoami}
                onLoginClick={latticeNotLoggedIn ? () => setLoginDialogOpen(true) : undefined}
                onInstallClick={latticeMissing ? () => setInstallDialogOpen(true) : undefined}
              />
              {props.latticeProps.enabled && (
                <LatticeMinionForm
                  latticeConfig={props.latticeProps.latticeConfig}
                  username={latticeUsername}
                  deploymentUrl={latticeDeploymentUrl}
                  onLatticeConfigChange={props.latticeProps.onLatticeConfigChange}
                  templates={props.latticeProps.templates}
                  templatesError={props.latticeProps.templatesError}
                  presets={props.latticeProps.presets}
                  presetsError={props.latticeProps.presetsError}
                  existingMinions={props.latticeProps.existingMinions}
                  minionsError={props.latticeProps.minionsError}
                  loadingTemplates={props.latticeProps.loadingTemplates}
                  loadingPresets={props.latticeProps.loadingPresets}
                  loadingMinions={props.latticeProps.loadingMinions}
                  disabled={props.disabled}
                  hasError={props.runtimeFieldError === "ssh"}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Crew (only when project has crews) ── */}
      {hasSections && (
        <>
          <div className="creation-divider" />
          <div className="flex flex-col gap-2">
            <span className="creation-section-label">Section</span>
            <SectionPicker
              sections={props.sections!}
              selectedSectionId={props.selectedSectionId ?? null}
              onSectionChange={props.onSectionChange!}
              disabled={props.disabled}
            />
          </div>
        </>
      )}

      <LatticeLoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        onLoginSuccess={() => props.latticeProps?.refreshLatticeInfo?.()}
        defaultUrl={latticeLoginDefaultUrl}
      />
      <LatticeInstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        onInstallSuccess={() => props.latticeProps?.refreshLatticeInfo?.()}
      />
    </div>
  );
}
