import React, { useCallback, useEffect } from "react";
import { RUNTIME_MODE, type RuntimeMode, type ParsedRuntime } from "@/common/types/runtime";
import { type RuntimeAvailabilityState } from "./useCreationWorkspace";
import {
  resolveDevcontainerSelection,
  DEFAULT_DEVCONTAINER_CONFIG_PATH,
} from "@/browser/utils/devcontainerSelection";
import { Select } from "../Select";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Check, ChevronDown, FolderOpen, FolderPlus, GitFork, Loader2, Wand2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { PlatformPaths } from "@/common/utils/paths";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { useWorkspaceContext } from "@/browser/contexts/WorkspaceContext";
import { cn } from "@/common/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";
import { DocsLink } from "../DocsLink";
import { RUNTIME_UI, type RuntimeIconProps } from "@/browser/utils/runtimeUi";
import type { WorkspaceNameState } from "@/browser/hooks/useWorkspaceName";
import type { SectionConfig } from "@/common/types/project";
import { resolveSectionColor } from "@/common/constants/ui";
import { LatticeControls, type LatticeControlsProps } from "./LatticeControls";

interface CreationControlsProps {
  branches: string[];
  /** Whether branches have finished loading (to distinguish loading vs non-git repo) */
  branchesLoaded: boolean;
  trunkBranch: string;
  onTrunkBranchChange: (branch: string) => void;
  /** Currently selected runtime (discriminated union: SSH has host, Docker has image) */
  selectedRuntime: ParsedRuntime;
  defaultRuntimeMode: RuntimeMode;
  /** Set the currently selected runtime (discriminated union) */
  onSelectedRuntimeChange: (runtime: ParsedRuntime) => void;
  onSetDefaultRuntime: (mode: RuntimeMode) => void;
  disabled: boolean;
  /** Project path to display (and used for project selector) */
  projectPath: string;
  /** Project name to display as header */
  projectName: string;
  /** Workspace name/title generation state and actions */
  nameState: WorkspaceNameState;
  /** Runtime availability state for each mode */
  runtimeAvailabilityState: RuntimeAvailabilityState;
  /** Available sections for this project */
  sections?: SectionConfig[];
  /** Currently selected section ID */
  selectedSectionId?: string | null;
  /** Callback when section selection changes */
  onSectionChange?: (sectionId: string | null) => void;
  /** Which runtime field (if any) is in error state for visual feedback */
  runtimeFieldError?: "docker" | "ssh" | null;
  /** Lattice workspace controls props (optional - only rendered when provided) */
  latticeProps?: Omit<LatticeControlsProps, "disabled">;
}

/** Runtime type dropdown selector with icons and colors */
interface RuntimeButtonGroupProps {
  value: RuntimeMode;
  onChange: (mode: RuntimeMode) => void;
  defaultMode: RuntimeMode;
  onSetDefault: (mode: RuntimeMode) => void;
  disabled?: boolean;
  runtimeAvailabilityState?: RuntimeAvailabilityState;
}

const RUNTIME_ORDER: RuntimeMode[] = [
  RUNTIME_MODE.LOCAL,
  RUNTIME_MODE.WORKTREE,
  RUNTIME_MODE.SSH,
  RUNTIME_MODE.DOCKER,
  RUNTIME_MODE.DEVCONTAINER,
];

const RUNTIME_OPTIONS: Array<{
  value: RuntimeMode;
  label: string;
  description: string;
  docsPath: string;
  Icon: React.ComponentType<RuntimeIconProps>;
  // Active state colors using CSS variables for theme support
  activeClass: string;
  idleClass: string;
}> = RUNTIME_ORDER.map((mode) => {
  const ui = RUNTIME_UI[mode];
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

/** Aesthetic section picker with color accent */
interface SectionPickerProps {
  sections: SectionConfig[];
  selectedSectionId: string | null;
  onSectionChange: (sectionId: string | null) => void;
  disabled?: boolean;
}

function SectionPicker(props: SectionPickerProps) {
  const { sections, selectedSectionId, onSectionChange, disabled } = props;

  const selectedSection = selectedSectionId
    ? sections.find((s) => s.id === selectedSectionId)
    : null;
  const sectionColor = resolveSectionColor(selectedSection?.color);

  return (
    <div
      className="inline-flex w-fit items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors"
      style={{
        borderColor: selectedSection ? sectionColor : "var(--color-border-medium)",
        borderLeftWidth: selectedSection ? "3px" : "1px",
        backgroundColor: selectedSection ? `${sectionColor}08` : "transparent",
      }}
      data-testid="section-selector"
      data-selected-section={selectedSectionId ?? ""}
    >
      {/* Color indicator dot */}
      <div
        className="size-2.5 shrink-0 rounded-full transition-colors"
        style={{
          backgroundColor: selectedSection ? sectionColor : "var(--color-muted)",
          opacity: selectedSection ? 1 : 0.4,
        }}
      />
      <label className="text-muted-foreground shrink-0 text-xs">Section</label>
      <RadixSelect
        value={selectedSectionId ?? ""}
        onValueChange={onSectionChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-auto border-0 bg-transparent px-0 py-0 text-sm font-medium shadow-none focus:ring-0",
            selectedSection ? "text-foreground" : "text-muted"
          )}
        >
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {sections.map((section) => (
            <SelectItem key={section.id} value={section.id}>
              {section.name}
            </SelectItem>
          ))}
        </SelectContent>
      </RadixSelect>
    </div>
  );
}

/** Project picker dropdown matching Claude Code reference style */
interface ProjectPickerDropdownProps {
  projectPath: string;
  projectName: string;
  projects: Map<string, unknown>;
  onSelect: (path: string) => void;
  disabled?: boolean;
}

function ProjectPickerDropdown(props: ProjectPickerDropdownProps) {
  const { openProjectCreateModal } = useProjectContext();
  const [open, setOpen] = React.useState(false);
  const projectPaths = Array.from(props.projects.keys());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={props.disabled}
          data-testid="project-selector"
          className={cn(
            "border-border-medium flex h-10 min-w-[200px] max-w-[380px] items-center gap-2 rounded-lg border px-3 text-sm font-medium",
            "hover:bg-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          <FolderOpen size={14} className="text-muted-foreground shrink-0" />
          <span className="text-foreground truncate">{props.projectName}</span>
          <ChevronDown size={12} className="text-muted-foreground ml-auto shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[420px] p-0"
        sideOffset={4}
      >
        <div className="flex flex-col">
          <div className="text-muted-foreground px-3 pb-1 pt-3 text-xs font-medium">Recent</div>
          <div className="flex flex-col py-1">
            {projectPaths.map((path) => {
              const basename = PlatformPaths.basename(path);
              const isSelected = path === props.projectPath;
              // Check if path looks like it has a git remote (org/repo format)
              const hasSlash = basename.includes("/");
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => {
                    props.onSelect(path);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                    "hover:bg-hover",
                    isSelected && "bg-hover/50"
                  )}
                >
                  {hasSlash ? (
                    <GitFork size={16} className="text-muted-foreground shrink-0" />
                  ) : (
                    <FolderOpen size={16} className="text-muted-foreground shrink-0" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-foreground truncate text-sm font-medium">{basename}</span>
                    <span className="text-muted-foreground truncate text-xs">
                      {PlatformPaths.abbreviate(path)}
                    </span>
                  </div>
                  {isSelected && (
                    <Check size={16} className="text-accent shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-border-medium border-t">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                openProjectCreateModal();
              }}
              className="hover:bg-hover flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
            >
              <FolderPlus size={16} className="text-muted-foreground shrink-0" />
              <span className="text-foreground text-sm font-medium">Choose a different folder</span>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RuntimeDropdown(props: RuntimeButtonGroupProps) {
  const state = props.runtimeAvailabilityState;
  const availabilityMap = state?.status === "loaded" ? state.data : null;

  // Hide only during loading (prevents flash), show on failed (allows fallback selection)
  const hideDevcontainer =
    state?.status === "loading" ||
    (availabilityMap?.devcontainer?.available === false &&
      availabilityMap.devcontainer.reason === "No devcontainer.json found");

  const runtimeOptions = hideDevcontainer
    ? RUNTIME_OPTIONS.filter((option) => option.value !== RUNTIME_MODE.DEVCONTAINER)
    : RUNTIME_OPTIONS;

  const selectedOption = runtimeOptions.find((o) => o.value === props.value) ?? runtimeOptions[0];
  const SelectedIcon = selectedOption.Icon;

  return (
    <RadixSelect
      value={props.value}
      onValueChange={(value) => props.onChange(value as RuntimeMode)}
      disabled={props.disabled}
    >
      <SelectTrigger
        aria-label="Select runtime"
        data-testid="runtime-selector"
        className="border-border-medium h-10 w-auto min-w-[160px] gap-2 rounded-lg border px-3 text-sm font-medium shadow-none"
      >
        <SelectedIcon size={14} className="shrink-0" />
        <SelectValue placeholder="Select runtime" />
      </SelectTrigger>
      <SelectContent>
        {runtimeOptions.map((option) => {
          const availability = availabilityMap?.[option.value];
          const isModeDisabled = availability !== undefined && !availability.available;

          return (
            <SelectItem
              key={option.value}
              value={option.value}
              disabled={isModeDisabled}
            >
              {option.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </RadixSelect>
  );
}

/**
 * Prominent controls shown above the input during workspace creation.
 * Displays project name as header, workspace name with magic wand, and runtime/branch selectors.
 */
export function CreationControls(props: CreationControlsProps) {
  const { projects } = useProjectContext();
  const { beginWorkspaceCreation } = useWorkspaceContext();
  const { nameState, runtimeAvailabilityState } = props;

  // Extract mode from discriminated union for convenience
  const runtimeMode = props.selectedRuntime.mode;
  const { selectedRuntime, onSelectedRuntimeChange } = props;

  // Local runtime doesn't need a trunk branch selector (uses project dir as-is)
  const availabilityMap =
    runtimeAvailabilityState.status === "loaded" ? runtimeAvailabilityState.data : null;
  const showTrunkBranchSelector = props.branches.length > 0 && runtimeMode !== RUNTIME_MODE.LOCAL;

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

  // Keep selected runtime aligned with availability constraints
  useEffect(() => {
    if (isNonGitRepo) {
      if (selectedRuntime.mode !== RUNTIME_MODE.LOCAL) {
        onSelectedRuntimeChange({ mode: "local" });
      }
      return;
    }

    if (isDevcontainerMissing && selectedRuntime.mode === RUNTIME_MODE.DEVCONTAINER) {
      onSelectedRuntimeChange({ mode: "worktree" });
    }
  }, [isDevcontainerMissing, isNonGitRepo, selectedRuntime.mode, onSelectedRuntimeChange]);

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

  return (
    <div className="mb-3 flex flex-col gap-3">
      {/* Row 1: Workspace name */}
      <div className="flex items-center gap-1" data-component="WorkspaceNameGroup">
        <Tooltip>
          <TooltipTrigger asChild>
            <input
              id="workspace-name"
              type="text"
              value={nameState.name}
              onChange={handleNameChange}
              onFocus={handleInputFocus}
              placeholder={nameState.isGenerating ? "Generating..." : "workspace-name"}
              disabled={props.disabled}
              className={cn(
                `border-border-medium focus:border-accent h-7 rounded-md
                 border border-transparent bg-transparent text-lg font-semibold
                 field-sizing-content focus:border focus:bg-bg-dark focus:outline-none
                 disabled:opacity-50 max-w-[50vw] sm:max-w-[40vw] lg:max-w-[30vw]`,
                nameState.autoGenerate ? "text-muted" : "text-foreground",
                nameState.error && "border-red-500"
              )}
            />
          </TooltipTrigger>
          <TooltipContent align="start" className="max-w-64">
            A stable identifier used for git branches, worktree folders, and session directories.
          </TooltipContent>
        </Tooltip>
        {nameState.isGenerating ? (
          <Loader2 className="text-accent h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleWandClick}
                disabled={props.disabled}
                className="flex shrink-0 items-center disabled:opacity-50"
                aria-label={nameState.autoGenerate ? "Disable auto-naming" : "Enable auto-naming"}
              >
                <Wand2
                  className={cn(
                    "h-3.5 w-3.5 transition-colors",
                    nameState.autoGenerate
                      ? "text-accent"
                      : "text-muted-foreground opacity-50 hover:opacity-75"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent align="center">
              {nameState.autoGenerate ? "Auto-naming enabled" : "Click to enable auto-naming"}
            </TooltipContent>
          </Tooltip>
        )}
        {nameState.error && <span className="text-xs text-red-500">{nameState.error}</span>}

        {/* Section selector - right-aligned */}
        {props.sections && props.sections.length > 0 && props.onSectionChange && (
          <>
            <div className="flex-1" />
            <SectionPicker
              sections={props.sections}
              selectedSectionId={props.selectedSectionId ?? null}
              onSectionChange={props.onSectionChange}
              disabled={props.disabled}
            />
          </>
        )}
      </div>

      {/* Row 2: Project + Runtime dropdowns */}
      <div className="flex items-center gap-3" data-component="ProjectRuntimeRow">
        {/* Project selector - popover with full project list */}
        <ProjectPickerDropdown
          projectPath={props.projectPath}
          projectName={props.projectName}
          projects={projects}
          onSelect={(path) => beginWorkspaceCreation(path)}
          disabled={props.disabled}
        />

        {/* Runtime selector */}
        <RuntimeDropdown
          value={runtimeMode}
          onChange={(mode) => {
            switch (mode) {
              case RUNTIME_MODE.SSH:
                onSelectedRuntimeChange({
                  mode: "ssh",
                  host: selectedRuntime.mode === "ssh" ? selectedRuntime.host : "",
                });
                break;
              case RUNTIME_MODE.DOCKER:
                onSelectedRuntimeChange({
                  mode: "docker",
                  image: selectedRuntime.mode === "docker" ? selectedRuntime.image : "",
                });
                break;
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
        />
      </div>

      {/* Row 3: Runtime sub-options (branch, host, image) */}
      {(showTrunkBranchSelector ||
        (selectedRuntime.mode === "ssh" && !props.latticeProps?.enabled) ||
        selectedRuntime.mode === "docker") && (
        <div className="flex flex-wrap items-center gap-3">
          {showTrunkBranchSelector && (
            <div
              className="flex items-center gap-2"
              data-component="TrunkBranchGroup"
              data-tutorial="trunk-branch"
            >
              <label htmlFor="trunk-branch" className="text-muted-foreground text-xs">
                from
              </label>
              <Select
                id="trunk-branch"
                value={props.trunkBranch}
                options={props.branches}
                onChange={props.onTrunkBranchChange}
                disabled={props.disabled}
                className="h-7 max-w-[140px]"
              />
            </div>
          )}

          {selectedRuntime.mode === "ssh" && !props.latticeProps?.enabled && (
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground text-xs">host</label>
              <input
                type="text"
                value={selectedRuntime.host}
                onChange={(e) => onSelectedRuntimeChange({ mode: "ssh", host: e.target.value })}
                placeholder="user@host"
                disabled={props.disabled}
                className={cn(
                  "bg-bg-dark text-foreground border-border-medium focus:border-accent h-7 w-48 rounded-md border px-2 text-sm focus:outline-none disabled:opacity-50",
                  props.runtimeFieldError === "ssh" && "border-red-500"
                )}
              />
            </div>
          )}

          {selectedRuntime.mode === "docker" && (
            <div className="flex items-center gap-2">
              <label htmlFor="docker-image" className="text-muted-foreground text-xs">
                image
              </label>
              <input
                id="docker-image"
                aria-label="Docker image"
                type="text"
                value={selectedRuntime.image}
                onChange={(e) =>
                  onSelectedRuntimeChange({
                    mode: "docker",
                    image: e.target.value,
                    shareCredentials: selectedRuntime.shareCredentials,
                  })
                }
                placeholder="node:20"
                disabled={props.disabled}
                className={cn(
                  "bg-bg-dark text-foreground border-border-medium focus:border-accent h-7 w-48 rounded-md border px-2 text-sm focus:outline-none disabled:opacity-50",
                  props.runtimeFieldError === "docker" && "border-red-500"
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* Docker credential sharing */}
      {selectedRuntime.mode === "docker" && (
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={selectedRuntime.shareCredentials ?? false}
            onChange={(e) =>
              onSelectedRuntimeChange({
                mode: "docker",
                image: selectedRuntime.image,
                shareCredentials: e.target.checked,
              })
            }
            disabled={props.disabled}
            className="accent-accent"
          />
          <span className="text-muted">Share credentials (SSH, Git)</span>
          <DocsLink path="/runtime/docker#credential-sharing" />
        </label>
      )}

      {/* Dev container controls */}
      {selectedRuntime.mode === "devcontainer" && devcontainerSelection.uiMode !== "hidden" && (
        <div className="border-border-medium flex w-fit flex-col gap-1.5 rounded-md border p-2">
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Config</label>
            {devcontainerSelection.uiMode === "dropdown" ? (
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
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={selectedRuntime.shareCredentials ?? false}
              onChange={(e) =>
                onSelectedRuntimeChange({
                  mode: "devcontainer",
                  configPath: devcontainerSelection.configPath,
                  shareCredentials: e.target.checked,
                })
              }
              disabled={props.disabled}
              className="accent-accent"
            />
            <span className="text-muted">Share credentials (SSH, Git)</span>
            <DocsLink path="/runtime/docker#credential-sharing" />
          </label>
        </div>
      )}

      {/* Lattice Controls */}
      {selectedRuntime.mode === "ssh" && props.latticeProps && (
        <LatticeControls
          {...props.latticeProps}
          disabled={props.disabled}
          hasError={props.runtimeFieldError === "ssh"}
        />
      )}
    </div>
  );
}
