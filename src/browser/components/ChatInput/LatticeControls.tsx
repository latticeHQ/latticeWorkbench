/**
 * Lattice workspace controls for SSH runtime.
 * Enables creating or connecting to Lattice cloud workspaces.
 */
import React from "react";
import type {
  LatticeInfo,
  LatticeTemplate,
  LatticePreset,
  LatticeWorkspace,
} from "@/common/orpc/schemas/lattice";
import type { LatticeWorkspaceConfig } from "@/common/types/runtime";
import { cn } from "@/common/lib/utils";
import { Loader2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export interface LatticeControlsProps {
  /** Whether to use Lattice workspace (checkbox state) */
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;

  /** Lattice CLI availability info (null while checking) */
  latticeInfo: LatticeInfo | null;

  /** Current Lattice configuration */
  latticeConfig: LatticeWorkspaceConfig | null;
  onLatticeConfigChange: (config: LatticeWorkspaceConfig | null) => void;

  /** Data for dropdowns (loaded async) */
  templates: LatticeTemplate[];
  presets: LatticePreset[];
  existingWorkspaces: LatticeWorkspace[];

  /** Loading states */
  loadingTemplates: boolean;
  loadingPresets: boolean;
  loadingWorkspaces: boolean;

  /** Disabled state (e.g., during creation) */
  disabled: boolean;

  /** Error state for visual feedback */
  hasError?: boolean;
}

type LatticeMode = "new" | "existing";

/**
 * Lattice workspace controls component.
 * Shows checkbox to enable Lattice, then New/Existing toggle with appropriate dropdowns.
 */
/** Checkbox row with optional status indicator and tooltip for disabled state */
function LatticeCheckbox(props: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  disabled: boolean;
  status?: React.ReactNode;
  /** When provided, wraps checkbox in tooltip explaining why it's disabled */
  disabledReason?: string;
}) {
  const checkboxElement = (
    <label
      className={cn(
        "flex items-center gap-1.5 text-xs",
        props.disabledReason && "cursor-not-allowed"
      )}
    >
      <input
        type="checkbox"
        checked={props.enabled}
        onChange={(e) => props.onEnabledChange(e.target.checked)}
        disabled={props.disabled || Boolean(props.disabledReason)}
        className={cn("accent-accent", props.disabledReason && "cursor-not-allowed opacity-50")}
        data-testid="lattice-checkbox"
      />
      <span className={cn("text-muted", props.disabledReason && "opacity-50")}>
        Use Lattice Workspace
      </span>
      {props.status}
    </label>
  );

  // Wrap in tooltip when disabled with a reason
  if (props.disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">{checkboxElement}</span>
        </TooltipTrigger>
        <TooltipContent align="start" className="max-w-60">
          <p className="text-xs text-yellow-500">{props.disabledReason}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return checkboxElement;
}

export function LatticeControls(props: LatticeControlsProps) {
  const {
    enabled,
    onEnabledChange,
    latticeInfo,
    latticeConfig,
    onLatticeConfigChange,
    templates,
    presets,
    existingWorkspaces,
    loadingTemplates,
    loadingPresets,
    loadingWorkspaces,
    disabled,
    hasError,
  } = props;

  // Coder CLI status: loading (null), unavailable, outdated, or available
  if (latticeInfo === null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="lattice-controls">
        <LatticeCheckbox
          enabled={enabled}
          onEnabledChange={onEnabledChange}
          disabled={disabled}
          status={
            <span className="text-muted flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Checking…
            </span>
          }
        />
      </div>
    );
  }

  // CLI outdated: show checkbox disabled with tooltip explaining version mismatch
  if (latticeInfo.state === "outdated") {
    const reason = `Lattice CLI v${latticeInfo.version} is below the minimum required v${latticeInfo.minVersion}. Update the CLI to enable.`;
    return (
      <div className="flex flex-col gap-1.5" data-testid="lattice-controls">
        <LatticeCheckbox
          enabled={false}
          onEnabledChange={onEnabledChange}
          disabled={disabled}
          disabledReason={reason}
        />
      </div>
    );
  }

  // CLI unavailable (missing/broken): hide checkbox entirely
  if (latticeInfo.state === "unavailable") {
    return null;
  }

  const mode: LatticeMode = latticeConfig?.existingWorkspace ? "existing" : "new";

  const handleModeChange = (newMode: LatticeMode) => {
    if (newMode === "existing") {
      // Switch to existing workspace mode (workspaceName starts empty, user selects)
      onLatticeConfigChange({
        workspaceName: undefined,
        existingWorkspace: true,
      });
    } else {
      // Switch to new workspace mode (workspaceName omitted; backend derives from branch)
      const firstTemplate = templates[0];
      const firstIsDuplicate = firstTemplate
        ? templates.some(
            (t) =>
              t.name === firstTemplate.name && t.organizationName !== firstTemplate.organizationName
          )
        : false;
      onLatticeConfigChange({
        existingWorkspace: false,
        template: firstTemplate?.name,
        templateOrg: firstIsDuplicate ? firstTemplate?.organizationName : undefined,
      });
    }
  };

  const handleTemplateChange = (value: string) => {
    if (!latticeConfig) return;

    // Value is "org/name" when duplicates exist, otherwise just "name"
    const [orgOrName, maybeName] = value.split("/");
    const templateName = maybeName ?? orgOrName;
    const templateOrg = maybeName ? orgOrName : undefined;

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

  const handleExistingWorkspaceChange = (workspaceName: string) => {
    onLatticeConfigChange({
      workspaceName,
      existingWorkspace: true,
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

  return (
    <div className="flex flex-col gap-1.5" data-testid="lattice-controls">
      <LatticeCheckbox enabled={enabled} onEnabledChange={onEnabledChange} disabled={disabled} />

      {/* Lattice controls - only shown when enabled */}
      {enabled && (
        <div
          className={cn(
            "flex w-fit rounded-md border",
            hasError ? "border-red-500" : "border-border-medium"
          )}
          data-testid="lattice-controls-inner"
        >
          {/* Left column: New/Existing toggle buttons */}
          <div
            className="border-border-medium flex flex-col gap-1 border-r p-2 pr-3"
            role="group"
            aria-label="Lattice agent mode"
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
              <TooltipContent>Create a new Lattice agent from a template</TooltipContent>
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
              <TooltipContent>Connect to an existing Lattice agent</TooltipContent>
            </Tooltip>
          </div>

          {/* Right column: Mode-specific controls */}
          {/* New agent controls - template/preset stacked vertically */}
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
                      const hasDuplicate = matchingTemplates.some(
                        (t) => t.organizationName !== matchingTemplates[0]?.organizationName
                      );

                      if (!hasDuplicate) {
                        return templateName;
                      }

                      const org =
                        latticeConfig?.templateOrg ??
                        matchingTemplates[0]?.organizationName ??
                        undefined;
                      return org ? `${org}/${templateName}` : templateName;
                    })()}
                    onValueChange={handleTemplateChange}
                    disabled={disabled || templates.length === 0}
                  >
                    <SelectTrigger
                      className="h-7 w-[180px] text-xs"
                      data-testid="lattice-template-select"
                    >
                      <SelectValue placeholder="No templates" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => {
                        // Show org name only if there are duplicate template names
                        const hasDuplicate = templates.some(
                          (other) =>
                            other.name === t.name && other.organizationName !== t.organizationName
                        );
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
              <div className="flex h-7 items-center gap-2">
                <label className="text-muted-foreground w-16 text-xs">Preset</label>
                {loadingPresets ? (
                  <Loader2 className="text-muted h-4 w-4 animate-spin" />
                ) : (
                  <Select
                    value={effectivePreset ?? ""}
                    onValueChange={handlePresetChange}
                    disabled={disabled || presets.length === 0}
                  >
                    <SelectTrigger
                      className="h-7 w-[180px] text-xs"
                      data-testid="lattice-preset-select"
                    >
                      <SelectValue placeholder="No presets" />
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
            </div>
          )}

          {/* Existing agent controls - min-h matches New mode (2×h-7 + gap-1 + p-2) */}
          {mode === "existing" && (
            <div className="flex min-h-[4.75rem] min-w-[16rem] items-center gap-2 p-2 pl-3">
              <label className="text-muted-foreground text-xs">Agent</label>
              {loadingWorkspaces ? (
                <Loader2 className="text-muted h-4 w-4 animate-spin" />
              ) : (
                <Select
                  value={latticeConfig?.workspaceName ?? ""}
                  onValueChange={handleExistingWorkspaceChange}
                  disabled={disabled || existingWorkspaces.length === 0}
                >
                  <SelectTrigger
                    className="h-7 w-[180px] text-xs"
                    data-testid="lattice-agent-select"
                  >
                    <SelectValue
                      placeholder={
                        existingWorkspaces.length === 0
                          ? "No agents found"
                          : "Select agent..."
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {existingWorkspaces
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
          )}
        </div>
      )}
    </div>
  );
}
