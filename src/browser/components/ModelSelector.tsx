import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  useImperativeHandle,
  forwardRef,
} from "react";
import { cn } from "@/common/lib/utils";
import type { AgentHealthStatus } from "@/common/orpc/types";
import { Eye, Settings, Star } from "lucide-react";
import { ProviderIcon, resolveProviderDisplayName } from "./ProviderIcon";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { formatModelDisplayName } from "@/common/utils/ai/modelDisplay";

/**
 * Parse a model string "provider:model-name" into parts.
 */
function parseModelString(model: string): { provider: string; modelName: string } {
  const colonIdx = model.indexOf(":");
  if (colonIdx === -1) return { provider: "", modelName: model };
  return { provider: model.slice(0, colonIdx), modelName: model.slice(colonIdx + 1) };
}

/**
 * Build a display label for a model: "AgentName › ModelName"
 */
function formatModelLabel(model: string): string {
  const { provider, modelName } = parseModelString(model);
  const providerLabel = resolveProviderDisplayName(provider);
  const modelLabel = formatModelDisplayName(modelName);
  return providerLabel ? `${providerLabel} › ${modelLabel}` : modelLabel;
}

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  models: string[];
  hiddenModels?: string[];
  emptyLabel?: string;
  inputPlaceholder?: string;
  onComplete?: () => void;
  defaultModel?: string | null;
  onSetDefaultModel?: (model: string) => void;
  onHideModel?: (model: string) => void;
  onUnhideModel?: (model: string) => void;
  onOpenSettings?: () => void;
  /** True when agent detection is still running — shows a subtle indicator */
  loading?: boolean;
  /** Per-provider health status — shows colored dot on group headers */
  healthMap?: Record<string, AgentHealthStatus>;
}

export interface ModelSelectorRef {
  open: () => void;
}

export const ModelSelector = forwardRef<ModelSelectorRef, ModelSelectorProps>(
  (
    {
      value,
      onChange,
      models,
      hiddenModels = [],
      emptyLabel,
      inputPlaceholder,
      onComplete,
      defaultModel,
      onSetDefaultModel,
      onHideModel,
      onUnhideModel,
      onOpenSettings,
      loading = false,
      healthMap = {},
    },
    ref
  ) => {
    useSettings(); // Context must be available for nested components
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(value);
    const [error, setError] = useState<string | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);
    const [showAllModels, setShowAllModels] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownItemRefs = useRef<Array<HTMLDivElement | null>>([]);

    // Update input value when prop changes
    useEffect(() => {
      if (!isEditing) {
        setInputValue(value);
      }
    }, [value, isEditing]);

    // Focus input when editing starts
    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    const handleCancel = useCallback(() => {
      setIsEditing(false);
      setInputValue(value);
      setError(null);
      setShowDropdown(false);
      setShowAllModels(false);
      setHighlightedIndex(-1);
    }, [value]);

    // Handle click outside to close
    useEffect(() => {
      if (!isEditing) return;

      const handleClickOutside = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          handleCancel();
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [isEditing, handleCancel]);

    // Build model list: visible models + (if showAllModels) hidden models
    const baseModels = showAllModels ? [...models, ...hiddenModels] : models;

    // Filter models based on input — search across provider display name and model name
    const filteredModels = useMemo(() => {
      const query = inputValue.trim().toLowerCase();
      if (query === "") return baseModels;
      return baseModels.filter((model) => {
        // Match against the full label (e.g., "Claude Code › Sonnet 4.5")
        const label = formatModelLabel(model).toLowerCase();
        // Also match against the raw model string (e.g., "claude-code:claude-sonnet-4-5")
        return label.includes(query) || model.toLowerCase().includes(query);
      });
    }, [inputValue, baseModels]);

    // Track which models are hidden (for rendering)
    const hiddenSet = new Set(hiddenModels);

    // If the list shrinks (e.g., a model is hidden), keep the highlight in-bounds.
    useEffect(() => {
      if (filteredModels.length === 0) {
        setHighlightedIndex(-1);
        return;
      }
      if (highlightedIndex >= filteredModels.length) {
        setHighlightedIndex(filteredModels.length - 1);
      }
    }, [filteredModels.length, highlightedIndex]);

    const handleSave = () => {
      // No matches - do nothing, let user keep typing or cancel
      if (filteredModels.length === 0) {
        return;
      }

      // Use highlighted item, or first item if none highlighted
      const selectedIndex = highlightedIndex >= 0 ? highlightedIndex : 0;
      const valueToSave = filteredModels[selectedIndex];

      onChange(valueToSave);
      setIsEditing(false);
      setError(null);
      setShowDropdown(false);
      setHighlightedIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        // Only call onComplete if save succeeded (had matches)
        if (filteredModels.length > 0) {
          handleSave();
          onComplete?.();
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        // Tab auto-completes the highlighted item without closing
        if (highlightedIndex >= 0 && highlightedIndex < filteredModels.length) {
          setInputValue(filteredModels[highlightedIndex]);
          setHighlightedIndex(-1);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredModels.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, -1));
      }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      setError(null);

      // Highlight first result if any, otherwise no highlight
      const query = newValue.trim().toLowerCase();
      const filtered =
        query === ""
          ? models
          : models.filter((model) => {
              const label = formatModelLabel(model).toLowerCase();
              return label.includes(query) || model.toLowerCase().includes(query);
            });

      setHighlightedIndex(filtered.length > 0 ? 0 : -1);

      // Keep dropdown visible if there are models (filtering happens automatically)
      setShowDropdown(models.length > 0);
    };

    const handleSelectModel = (model: string) => {
      setInputValue(model);
      onChange(model);
      setIsEditing(false);
      setError(null);
      setShowDropdown(false);
    };

    const handleClick = useCallback(() => {
      setIsEditing(true);
      setInputValue(""); // Clear input to show all models
      setShowDropdown(models.length > 0);

      // Start with current value highlighted
      const currentIndex = models.indexOf(value);
      setHighlightedIndex(currentIndex);
    }, [models, value]);

    const handleSetDefault = (e: React.MouseEvent, model: string) => {
      e.preventDefault();
      e.stopPropagation();
      if (defaultModel !== model && onSetDefaultModel) {
        onSetDefaultModel(model);
      }
    };

    // Expose open method to parent via ref
    useImperativeHandle(
      ref,
      () => ({
        open: handleClick,
      }),
      [handleClick]
    );

    // Scroll highlighted item into view
    useEffect(() => {
      if (highlightedIndex >= 0 && dropdownItemRefs.current[highlightedIndex]) {
        dropdownItemRefs.current[highlightedIndex]?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }, [highlightedIndex]);

    // Group models by provider for section headers in dropdown.
    // Uses a map to merge non-contiguous models from the same provider into one group.
    const groupedModels = useMemo(() => {
      const groupMap = new Map<
        string,
        { provider: string; providerLabel: string; models: Array<{ model: string; index: number }> }
      >();
      const groupOrder: string[] = [];
      let flatIndex = 0;

      for (const model of filteredModels) {
        const { provider } = parseModelString(model);
        let group = groupMap.get(provider);
        if (!group) {
          group = {
            provider,
            providerLabel: resolveProviderDisplayName(provider),
            models: [],
          };
          groupMap.set(provider, group);
          groupOrder.push(provider);
        }
        group.models.push({ model, index: flatIndex });
        flatIndex++;
      }

      return groupOrder.map((p) => groupMap.get(p)!);
    }, [filteredModels]);

    if (!isEditing) {
      if (value.trim().length === 0) {
        return (
          <div ref={containerRef} className="relative flex items-center gap-1">
            <div
              className="text-muted-light hover:bg-hover flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] transition-colors duration-200"
              onClick={handleClick}
            >
              <span>{emptyLabel ?? ""}</span>
            </div>
          </div>
        );
      }

      // Parse provider and model name from value (format: "provider:model-name")
      const { provider, modelName } = parseModelString(value);
      const providerLabel = resolveProviderDisplayName(provider);

      return (
        <div ref={containerRef} className="relative flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="text-muted-light hover:bg-hover flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[11px] transition-colors duration-200"
                onClick={handleClick}
              >
                <ProviderIcon provider={provider} className="h-3 w-3 shrink-0 opacity-70" />
                <span className="opacity-60">{providerLabel}</span>
                <span className="opacity-40">›</span>
                <span>{formatModelDisplayName(modelName)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent align="center">{value}</TooltipContent>
          </Tooltip>
        </div>
      );
    }

    return (
      <div ref={containerRef} className="relative flex items-center gap-1">
        <div>
          <input
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder ?? "Search agents & models…"}
            className="text-light bg-dark border-border-light font-monospace focus:border-exec-mode w-56 rounded-sm border px-1 py-0.5 text-[10px] leading-[11px] outline-none"
          />
          {error && (
            <div className="text-danger-soft font-monospace mt-0.5 text-[9px]">{error}</div>
          )}
        </div>
        {showDropdown && (
          <div className="bg-separator border-border-light absolute bottom-full left-0 z-[1020] mb-1 max-h-[280px] min-w-80 overflow-y-auto rounded border shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
            {/* Loading indicator when detection is in progress */}
            {loading && (
              <div className="text-muted-light flex items-center gap-1.5 px-2.5 py-1 text-[10px]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current opacity-50" />
                <span>Detecting installed agents…</span>
              </div>
            )}
            {filteredModels.length === 0 ? (
              <div className="text-muted-light font-monospace px-2.5 py-1.5 text-[11px]">
                No matching models
              </div>
            ) : (
              groupedModels.map((group) => (
                <div key={group.provider}>
                  {/* Provider group header */}
                  <div className="text-muted-light bg-separator/80 sticky top-0 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide">
                    <ProviderIcon
                      provider={group.provider}
                      className="h-3 w-3 shrink-0 opacity-50"
                    />
                    <span>{group.providerLabel}</span>
                    {/* Health indicator dot */}
                    {healthMap[group.provider] && (
                      <span
                        className={cn(
                          "ml-auto h-1.5 w-1.5 shrink-0 rounded-full",
                          healthMap[group.provider].status === "healthy" && "bg-green-500",
                          healthMap[group.provider].status === "unhealthy" && "bg-orange-500",
                          healthMap[group.provider].status === "checking" && "bg-blue-400 animate-pulse",
                          healthMap[group.provider].status === "unknown" && "bg-border-medium"
                        )}
                        title={healthMap[group.provider].message ?? healthMap[group.provider].status}
                      />
                    )}
                  </div>
                  {/* Models in this group */}
                  {group.models.map(({ model, index }) => {
                    const { modelName } = parseModelString(model);
                    return (
                      <div
                        key={model}
                        ref={(el) => (dropdownItemRefs.current[index] = el)}
                        className={cn(
                          "text-[11px] py-1.5 px-2.5 pl-7 cursor-pointer transition-colors duration-100",
                          hiddenSet.has(model) && "opacity-50",
                          index === highlightedIndex
                            ? "text-foreground bg-hover"
                            : "text-light bg-transparent hover:bg-hover hover:text-foreground"
                        )}
                        onClick={() => handleSelectModel(model)}
                      >
                        {/* Grid: model name | visibility | default */}
                        <div className="grid w-full grid-cols-[1fr_20px_20px] items-center gap-1">
                          <span className="min-w-0 truncate">
                            {formatModelDisplayName(modelName)}
                          </span>
                          {/* Visibility toggle - Eye with line-through when hidden */}
                          {(onHideModel ?? onUnhideModel) ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (hiddenSet.has(model)) {
                                      onUnhideModel?.(model);
                                    } else {
                                      onHideModel?.(model);
                                    }
                                  }}
                                  className={cn(
                                    "relative flex h-5 w-5 items-center justify-center rounded-sm border transition-colors duration-150",
                                    hiddenSet.has(model)
                                      ? "text-muted-light border-muted-light/40"
                                      : "text-muted-light border-border-light/40 hover:border-foreground/60 hover:text-foreground"
                                  )}
                                  aria-label={
                                    hiddenSet.has(model)
                                      ? "Show model in selector"
                                      : "Hide model from selector"
                                  }
                                >
                                  <Eye
                                    className={cn(
                                      "h-3 w-3",
                                      hiddenSet.has(model) ? "opacity-30" : "opacity-70"
                                    )}
                                  />
                                  {hiddenSet.has(model) && (
                                    <span className="bg-muted-light absolute h-px w-3 rotate-45" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent align="center">
                                {hiddenSet.has(model)
                                  ? "Show model in selector"
                                  : "Hide model from selector"}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span /> // Empty cell for alignment
                          )}
                          {/* Default star */}
                          {onSetDefaultModel ? (
                            hiddenSet.has(model) ? (
                              <span /> // Empty cell - can't set hidden model as default
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => handleSetDefault(e, model)}
                                    className={cn(
                                      "flex h-5 w-5 items-center justify-center rounded-sm border transition-colors duration-150",
                                      defaultModel === model
                                        ? "text-yellow-400 border-yellow-400/40 cursor-default"
                                        : "text-muted-light border-border-light/40 hover:border-foreground/60 hover:text-foreground"
                                    )}
                                    aria-label={
                                      defaultModel === model
                                        ? "Current default model"
                                        : "Set as default model"
                                    }
                                    disabled={defaultModel === model}
                                  >
                                    <Star className="h-3 w-3" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent align="center">
                                  {defaultModel === model
                                    ? "Current default model"
                                    : "Set as default model"}
                                </TooltipContent>
                              </Tooltip>
                            )
                          ) : (
                            <span /> // Empty cell for alignment
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}

            {/* Footer actions */}
            {(hiddenModels.length > 0 || onOpenSettings) && (
              <div className="border-border-light flex items-center justify-between gap-2 border-t px-2.5 py-1.5">
                {hiddenModels.length > 0 && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowAllModels((prev) => !prev);
                    }}
                    className="text-muted-light hover:text-foreground text-[10px] transition-colors"
                  >
                    {showAllModels ? "Show fewer models" : "Show all models…"}
                  </button>
                )}
                {onOpenSettings && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onOpenSettings();
                        }}
                        className="text-muted-light hover:text-foreground ml-auto flex items-center text-[10px] transition-colors"
                        aria-label="Model Settings"
                      >
                        <Settings className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent align="center">Model Settings</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
);

ModelSelector.displayName = "ModelSelector";
