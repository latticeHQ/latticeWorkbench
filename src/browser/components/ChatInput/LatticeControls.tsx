/**
 * Lattice minion controls for the SSH-based Lattice runtime.
 * Enables creating or connecting to Lattice cloud minions.
 */
import type {
  LatticeInfo,
  LatticeTemplate,
  LatticePreset,
  LatticeMinion,
  LatticeWhoami,
} from "@/common/orpc/schemas/lattice";
import type { LatticeMinionConfig } from "@/common/types/runtime";
import { cn } from "@/common/lib/utils";
import { Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface LatticeControlsProps {
  /** Whether Lattice is enabled for this minion */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;

  /** Lattice CLI availability info (null while checking) */
  latticeInfo: LatticeInfo | null;

  /** Lattice authentication identity (null while checking) */
  latticeWhoami: LatticeWhoami | null;

  /** Current Lattice configuration */
  latticeConfig: LatticeMinionConfig | null;
  onLatticeConfigChange: (config: LatticeMinionConfig | null) => void;

  /** Data for dropdowns (loaded async) */
  templates: LatticeTemplate[];
  templatesError?: string | null;
  presets: LatticePreset[];
  presetsError?: string | null;
  existingMinions: LatticeMinion[];
  minionsError?: string | null;

  /** Loading states */
  loadingTemplates: boolean;
  loadingPresets: boolean;
  loadingMinions: boolean;

  /** Disabled state (e.g., during creation) */
  disabled: boolean;

  /** Error state for visual feedback */
  hasError?: boolean;

  /** Re-fetch Lattice CLI info (e.g. after login) */
  refreshLatticeInfo?: () => void;
}

type LatticeMode = "new" | "existing";

const LATTICE_CHECKING_LABEL = "Checking…";

/** Check if a template name exists in multiple organizations (for disambiguation in UI) */
function hasTemplateDuplicateName(template: LatticeTemplate, allTemplates: LatticeTemplate[]): boolean {
  return allTemplates.some(
    (t) => t.name === template.name && t.organizationName !== template.organizationName
  );
}

export type LatticeAvailabilityState =
  | { state: "loading"; reason: string; shouldShowRuntimeButton: false }
  | { state: "outdated"; reason: string; shouldShowRuntimeButton: true }
  | { state: "unavailable"; reason: string; shouldShowRuntimeButton: boolean }
  | { state: "unauthenticated"; reason: string; shouldShowRuntimeButton: true }
  | { state: "available"; shouldShowRuntimeButton: true };

function getLatticeOutdatedReason(latticeInfo: Extract<LatticeInfo, { state: "outdated" }>) {
  return `Lattice CLI ${latticeInfo.version} is below minimum v${latticeInfo.minVersion}.`;
}

function getLatticeUnavailableReason(latticeInfo: Extract<LatticeInfo, { state: "unavailable" }>) {
  if (latticeInfo.reason === "missing") {
    return "Lattice CLI not found. Install to enable.";
  }

  return `Lattice CLI error: ${latticeInfo.reason.message}`;
}

/**
 * Resolve combined Lattice availability from CLI info + auth state.
 * CLI availability (LatticeInfo) is checked first, then auth (LatticeWhoami).
 */
export function resolveLatticeAvailability(
  latticeInfo: LatticeInfo | null,
  latticeWhoami?: LatticeWhoami | null,
): LatticeAvailabilityState {
  if (latticeInfo === null) {
    return { state: "loading", reason: LATTICE_CHECKING_LABEL, shouldShowRuntimeButton: false };
  }

  if (latticeInfo.state === "outdated") {
    return {
      state: "outdated",
      reason: getLatticeOutdatedReason(latticeInfo),
      shouldShowRuntimeButton: true,
    };
  }

  if (latticeInfo.state === "unavailable") {
    // Show the Lattice runtime button for "missing" so users can access the Install dialog.
    const shouldShowRuntimeButton = latticeInfo.reason === "missing";

    return {
      state: "unavailable",
      reason: getLatticeUnavailableReason(latticeInfo),
      shouldShowRuntimeButton,
    };
  }

  // CLI is available — check auth state
  if (latticeWhoami && latticeWhoami.state === "unauthenticated") {
    return {
      state: "unauthenticated",
      reason: latticeWhoami.reason || "Not logged in. Click Login to authenticate.",
      shouldShowRuntimeButton: true,
    };
  }

  // CLI available + authenticated (or whoami not yet loaded — show button optimistically)
  return { state: "available", shouldShowRuntimeButton: true };
}

// Standalone availability messaging used by the Lattice runtime UI.
export function LatticeAvailabilityMessage(props: {
  latticeInfo: LatticeInfo | null;
  latticeWhoami?: LatticeWhoami | null;
  /** If provided, shows a "Login" button when the CLI is installed but not logged in. */
  onLoginClick?: () => void;
  /** If provided, shows an "Install" button when the CLI is missing. */
  onInstallClick?: () => void;
}) {
  const availability = resolveLatticeAvailability(props.latticeInfo, props.latticeWhoami);

  if (availability.state === "loading") {
    return (
      <span className="text-muted flex items-center gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        {LATTICE_CHECKING_LABEL}
      </span>
    );
  }

  if (availability.state === "outdated") {
    return <p className="text-xs text-yellow-500">{availability.reason}</p>;
  }

  if (availability.state === "unavailable") {
    const isMissing = props.latticeInfo?.state === "unavailable" && props.latticeInfo.reason === "missing";
    const showInstall = props.onInstallClick && isMissing;

    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-yellow-500">{availability.reason}</p>
        {showInstall && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-xs"
            onClick={props.onInstallClick}
          >
            Install
          </Button>
        )}
      </div>
    );
  }

  if (availability.state === "unauthenticated") {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-yellow-500">{availability.reason}</p>
        {props.onLoginClick && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-xs"
            onClick={props.onLoginClick}
          >
            Login
          </Button>
        )}
      </div>
    );
  }

  return null;
}

export type LatticeMinionFormProps = Omit<
  LatticeControlsProps,
  "enabled" | "onEnabledChange" | "latticeInfo" | "latticeWhoami"
> & {
  username?: string;
  deploymentUrl?: string;
};

export function LatticeMinionForm(props: LatticeMinionFormProps) {
  const {
    latticeConfig,
    onLatticeConfigChange,
    templates,
    templatesError,
    presets,
    presetsError,
    existingMinions,
    minionsError,
    loadingTemplates,
    loadingPresets,
    loadingMinions,
    disabled,
    hasError,
    username,
    deploymentUrl,
  } = props;

  const mode: LatticeMode = latticeConfig?.existingMinion ? "existing" : "new";
  const formHasError = Boolean(
    (hasError ?? false) ||
    (mode === "existing" && Boolean(minionsError)) ||
    (mode === "new" && Boolean(templatesError ?? presetsError))
  );
  const templateErrorId = templatesError ? "lattice-template-error" : undefined;
  const presetErrorId = presetsError ? "lattice-preset-error" : undefined;
  const minionErrorId = minionsError ? "lattice-minion-error" : undefined;

  const handleModeChange = (newMode: LatticeMode) => {
    if (newMode === "existing") {
      // Switch to existing minion mode (minionName starts empty, user selects)
      onLatticeConfigChange({
        minionName: undefined,
        existingMinion: true,
      });
    } else {
      // Switch to new minion mode (minionName omitted; backend derives from branch)
      const firstTemplate = templates[0];
      onLatticeConfigChange({
        existingMinion: false,
        template: firstTemplate?.name,
        templateOrg: firstTemplate?.organizationName,
      });
    }
  };

  const handleTemplateChange = (value: string) => {
    if (!latticeConfig) return;

    // Value is "org/name" when duplicates exist, otherwise just "name"
    const [orgOrName, maybeName] = value.split("/");
    const templateName = maybeName ?? orgOrName;

    // Always resolve the org from the templates list so --org is passed to CLI
    // even when the user belongs to multiple orgs but template names don't collide
    const matchedTemplate = templates.find(
      (t) => t.name === templateName && (maybeName ? t.organizationName === orgOrName : true)
    );
    const templateOrg = maybeName ? orgOrName : matchedTemplate?.organizationName;

    onLatticeConfigChange({
      ...latticeConfig,
      template: templateName,
      templateOrg,
      preset: undefined, // Reset preset when template changes
    });
    // Presets will be loaded by parent via effect
  };

  const handlePresetChange = (presetName: string) => {
    if (!latticeConfig) return;

    onLatticeConfigChange({
      ...latticeConfig,
      preset: presetName || undefined,
    });
  };

  const handleExistingMinionChange = (minionName: string) => {
    onLatticeConfigChange({
      minionName,
      existingMinion: true,
    });
  };

  // Preset value: hook handles auto-selection, but keep a UI fallback to avoid a brief
  // "Select preset" flash while async preset loading + config update races.
  const defaultPresetName = presets.find((p) => p.isDefault)?.name;
  const effectivePreset =
    presets.length === 0
      ? undefined
      : presets.length === 1
        ? presets[0]?.name
        : (latticeConfig?.preset ?? defaultPresetName ?? presets[0]?.name);

  const templatePlaceholder = templatesError
    ? "Error loading templates"
    : templates.length === 0
      ? "No templates"
      : "Select template...";
  const templateSelectDisabled = disabled || templates.length === 0 || Boolean(templatesError);

  const presetPlaceholder = presetsError
    ? "Error loading presets"
    : presets.length === 0
      ? "No presets"
      : "Select preset...";
  const presetSelectDisabled = disabled || presets.length === 0 || Boolean(presetsError);

  const minionPlaceholder = minionsError
    ? "Error loading minions"
    : existingMinions.length === 0
      ? "No minions found"
      : "Select minion...";
  const minionSelectDisabled =
    disabled || existingMinions.length === 0 || Boolean(minionsError);

  const headerBorderClass = formHasError
    ? "border-b border-red-500"
    : "border-b border-border-medium";

  // Only show login context when we can name the user and the deployment they're on.
  const showLoginInfo = Boolean(username && deploymentUrl);
  return (
    <div
      className={cn(
        "flex w-[22rem] flex-col rounded-md border",
        formHasError ? "border-red-500" : "border-border-medium"
      )}
      data-testid="lattice-controls-inner"
    >
      {showLoginInfo && (
        <div className={cn("text-muted-foreground px-2 py-1.5 text-xs", headerBorderClass)}>
          Logged in as <span className="text-foreground font-medium">{username}</span> on{" "}
          <span className="text-foreground font-medium">{deploymentUrl}</span>
        </div>
      )}
      <div className="flex">
        {/* Left column: New/Existing toggle buttons */}
        <div
          className="border-border-medium flex flex-col gap-1 border-r p-2 pr-3"
          role="group"
          aria-label="Lattice minion mode"
          data-testid="lattice-mode-toggle"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleModeChange("new")}
                disabled={disabled}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  mode === "new"
                    ? "border-accent bg-accent/20 text-foreground"
                    : "border-transparent bg-transparent text-muted hover:border-border-medium"
                )}
                aria-pressed={mode === "new"}
              >
                New
              </button>
            </TooltipTrigger>
            <TooltipContent>Create a new Lattice minion from a template</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => handleModeChange("existing")}
                disabled={disabled}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  mode === "existing"
                    ? "border-accent bg-accent/20 text-foreground"
                    : "border-transparent bg-transparent text-muted hover:border-border-medium"
                )}
                aria-pressed={mode === "existing"}
              >
                Existing
              </button>
            </TooltipTrigger>
            <TooltipContent>Connect to an existing Lattice minion</TooltipContent>
          </Tooltip>
        </div>

        {/* Right column: Mode-specific controls */}
        {/* New minion controls - template/preset stacked vertically */}
        {mode === "new" && (
          <div className="flex flex-col gap-1 p-2 pl-3">
            <div className="flex h-7 items-center gap-2">
              <label className="text-muted-foreground w-16 text-xs">Template</label>
              {loadingTemplates ? (
                <Loader2 className="text-muted h-4 w-4 animate-spin" />
              ) : (
                <Select
                  value={(() => {
                    const templateName = latticeConfig?.template;
                    if (!templateName) {
                      return "";
                    }

                    const matchingTemplates = templates.filter((t) => t.name === templateName);
                    const firstMatch = matchingTemplates[0];
                    const hasDuplicate =
                      firstMatch && hasTemplateDuplicateName(firstMatch, templates);

                    if (!hasDuplicate) {
                      return templateName;
                    }

                    const org =
                      latticeConfig?.templateOrg ?? firstMatch?.organizationName ?? undefined;
                    return org ? `${org}/${templateName}` : templateName;
                  })()}
                  onValueChange={handleTemplateChange}
                  disabled={templateSelectDisabled}
                >
                  <SelectTrigger
                    className="h-7 w-[180px] text-xs"
                    data-testid="lattice-template-select"
                    aria-invalid={Boolean(templatesError) || undefined}
                    aria-describedby={templateErrorId}
                  >
                    <SelectValue placeholder={templatePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => {
                      // Show org name only if there are duplicate template names
                      const hasDuplicate = hasTemplateDuplicateName(t, templates);
                      // Use org/name as value when duplicates exist for disambiguation
                      const itemValue = hasDuplicate ? `${t.organizationName}/${t.name}` : t.name;
                      return (
                        <SelectItem key={`${t.organizationName}/${t.name}`} value={itemValue}>
                          {t.displayName || t.name}
                          {hasDuplicate && (
                            <span className="text-muted ml-1">({t.organizationName})</span>
                          )}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
            {templatesError && (
              <p id={templateErrorId} role="alert" className="text-xs break-all text-red-500">
                {templatesError}
              </p>
            )}
            <div className="flex h-7 items-center gap-2">
              <label className="text-muted-foreground w-16 text-xs">Preset</label>
              {loadingPresets ? (
                <Loader2 className="text-muted h-4 w-4 animate-spin" />
              ) : (
                <Select
                  value={effectivePreset ?? ""}
                  onValueChange={handlePresetChange}
                  disabled={presetSelectDisabled}
                >
                  <SelectTrigger
                    className="h-7 w-[180px] text-xs"
                    data-testid="lattice-preset-select"
                    aria-invalid={Boolean(presetsError) || undefined}
                    aria-describedby={presetErrorId}
                  >
                    <SelectValue placeholder={presetPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => (
                      <SelectItem key={p.id} value={p.name}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {presetsError && (
              <p id={presetErrorId} role="alert" className="text-xs break-all text-red-500">
                {presetsError}
              </p>
            )}
          </div>
        )}

        {/* Existing minion controls - keep base height aligned with New mode (2×h-7 + gap-1). */}
        {mode === "existing" && (
          <div className="flex w-[17rem] flex-col gap-1 p-2 pl-3">
            <div className="flex min-h-[3.75rem] items-center gap-2">
              <label className="text-muted-foreground w-16 text-xs">Minion</label>
              {loadingMinions ? (
                <Loader2 className="text-muted h-4 w-4 animate-spin" />
              ) : (
                <Select
                  value={latticeConfig?.minionName ?? ""}
                  onValueChange={handleExistingMinionChange}
                  disabled={minionSelectDisabled}
                >
                  <SelectTrigger
                    className="h-7 w-[180px] text-xs"
                    data-testid="lattice-minion-select"
                    aria-invalid={Boolean(minionsError) || undefined}
                    aria-describedby={minionErrorId}
                  >
                    <SelectValue placeholder={minionPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {existingMinions
                      .filter((w) => w.status !== "deleted" && w.status !== "deleting")
                      .map((w) => (
                        <SelectItem key={w.name} value={w.name}>
                          {w.name}
                          <span className="text-muted ml-1">
                            ({w.templateDisplayName} • {w.status})
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {minionsError && (
              <p id={minionErrorId} role="alert" className="text-xs break-all text-red-500">
                {minionsError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
