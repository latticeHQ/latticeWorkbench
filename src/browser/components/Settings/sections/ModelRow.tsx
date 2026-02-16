import React from "react";
import { Check, Eye, Info, Pencil, Star, Trash2, X } from "lucide-react";
import { createEditKeyHandler } from "@/browser/utils/ui/keybinds";
import { cn } from "@/common/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/browser/components/ui/tooltip";
import { ProviderWithIcon } from "@/browser/components/ProviderIcon";
import { getModelStats, type ModelStats } from "@/common/utils/tokens/modelStats";

/** Format tokens as human-readable string (e.g. 200000 -> "200k") */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  return tokens.toString();
}

/** Format cost per million tokens (e.g. 0.000001 -> "$1.00") */
function formatCostPerMillion(costPerToken: number): string {
  const perMillion = costPerToken * 1_000_000;
  if (perMillion < 0.01) return "~$0.00";
  return `$${perMillion.toFixed(2)}`;
}

function ModelTooltipContent(props: {
  fullId: string;
  aliases?: string[];
  stats: ModelStats | null;
}) {
  return (
    <div className="max-w-xs space-y-2 text-[11px]">
      <div className="text-foreground font-mono">{props.fullId}</div>

      {props.aliases && props.aliases.length > 0 && (
        <div className="text-muted">
          <span className="text-muted-light">Aliases: </span>
          {props.aliases.join(", ")}
        </div>
      )}

      {props.stats && (
        <>
          <div className="border-separator-light border-t pt-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="text-muted-light">Context Window</div>
              <div className="text-foreground">
                {formatTokenCount(props.stats.max_input_tokens)}
              </div>

              {props.stats.max_output_tokens && (
                <>
                  <div className="text-muted-light">Max Output</div>
                  <div className="text-foreground">
                    {formatTokenCount(props.stats.max_output_tokens)}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="border-separator-light border-t pt-2">
            <div className="text-muted-light mb-1">Pricing (per 1M tokens)</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="text-muted-light">Input</div>
              <div className="text-foreground">
                {formatCostPerMillion(props.stats.input_cost_per_token)}
              </div>

              <div className="text-muted-light">Output</div>
              <div className="text-foreground">
                {formatCostPerMillion(props.stats.output_cost_per_token)}
              </div>

              {props.stats.cache_read_input_token_cost !== undefined && (
                <>
                  <div className="text-muted-light">Cache Read</div>
                  <div className="text-foreground">
                    {formatCostPerMillion(props.stats.cache_read_input_token_cost)}
                  </div>
                </>
              )}

              {props.stats.cache_creation_input_token_cost !== undefined && (
                <>
                  <div className="text-muted-light">Cache Write</div>
                  <div className="text-foreground">
                    {formatCostPerMillion(props.stats.cache_creation_input_token_cost)}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {!props.stats && <div className="text-muted-light italic">No pricing data available</div>}
    </div>
  );
}

export interface ModelRowProps {
  provider: string;
  modelId: string;
  fullId: string;
  aliases?: string[];
  isCustom: boolean;
  isDefault: boolean;
  isEditing: boolean;
  editValue?: string;
  editError?: string | null;
  saving?: boolean;
  hasActiveEdit?: boolean;
  /** Whether this model is hidden from the selector */
  isHiddenFromSelector?: boolean;
  onSetDefault: () => void;
  onStartEdit?: () => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  onEditChange?: (value: string) => void;
  onRemove?: () => void;
  /** Toggle visibility in model selector */
  onToggleVisibility?: () => void;
}

export function ModelRow(props: ModelRowProps) {
  const stats = getModelStats(props.fullId);

  // Editing mode - render as a full-width row
  if (props.isEditing) {
    return (
      <tr className="border-border-medium border-b">
        <td colSpan={4} className="px-3 py-1.5">
          <div className="flex items-center gap-2">
            <ProviderWithIcon
              provider={props.provider}
              displayName
              className="text-muted w-16 shrink-0 overflow-hidden text-[11px] md:w-20"
            />
            <input
              type="text"
              value={props.editValue ?? props.modelId}
              onChange={(e) => props.onEditChange?.(e.target.value)}
              onKeyDown={createEditKeyHandler({
                onSave: () => props.onSaveEdit?.(),
                onCancel: () => props.onCancelEdit?.(),
              })}
              className="bg-modal-bg border-border-medium focus:border-accent min-w-0 flex-1 rounded border px-2 py-0.5 font-mono text-[11px] focus:outline-none"
              autoFocus
            />
            <button
              type="button"
              onClick={props.onSaveEdit}
              disabled={props.saving}
              className="p-0.5 text-green-500 hover:text-green-400"
              title="Save (Enter)"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={props.onCancelEdit}
              disabled={props.saving}
              className="text-muted hover:text-foreground p-0.5"
              title="Cancel (Esc)"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {props.editError && <div className="text-error mt-1 text-[11px]">{props.editError}</div>}
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={cn(
        "border-border-medium hover:bg-background-secondary/30 group border-b transition-colors",
        props.isHiddenFromSelector && "opacity-50"
      )}
    >
      {/* Provider */}
      <td className="w-20 py-1.5 pl-3 pr-2 md:w-24">
        <ProviderWithIcon
          provider={props.provider}
          displayName
          className="text-muted overflow-hidden text-[11px]"
        />
      </td>

      {/* Model ID + Aliases */}
      <td className="min-w-0 py-1.5 pr-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-foreground min-w-0 truncate font-mono text-[11px]">
            {props.modelId}
          </span>
          {props.aliases && props.aliases.length > 0 && (
            <span className="text-muted shrink-0 text-[10px]">({props.aliases[0]})</span>
          )}
        </div>
      </td>

      {/* Context Window */}
      <td className="w-14 py-1.5 pr-2 text-right md:w-16">
        <span className="text-muted text-[11px]">
          {stats ? formatTokenCount(stats.max_input_tokens) : "—"}
        </span>
      </td>

      {/* Actions */}
      <td className="w-24 py-1.5 pr-3 md:w-28">
        <div className="flex items-center justify-end gap-px">
          {/* Info tooltip */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted hover:text-foreground p-0.5 transition-colors"
                aria-label="Model details"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="p-3">
              <ModelTooltipContent fullId={props.fullId} aliases={props.aliases} stats={stats} />
            </TooltipContent>
          </Tooltip>
          {/* Visibility toggle */}
          {props.onToggleVisibility && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleVisibility?.();
              }}
              className={cn(
                "relative p-0.5 transition-colors",
                props.isHiddenFromSelector ? "text-muted-light" : "text-muted hover:text-foreground"
              )}
              aria-label={
                props.isHiddenFromSelector ? "Show in model selector" : "Hide from model selector"
              }
            >
              <Eye
                className={cn(
                  "h-3 w-3",
                  props.isHiddenFromSelector ? "opacity-30" : "opacity-70"
                )}
              />
              {props.isHiddenFromSelector && (
                <span className="bg-muted-light absolute inset-0 m-auto h-px w-3.5 rotate-45" />
              )}
            </button>
          )}
          {/* Favorite/default */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!props.isDefault) props.onSetDefault();
            }}
            className={cn(
              "p-0.5 transition-colors",
              props.isDefault
                ? "cursor-default text-yellow-400"
                : "text-muted hover:text-yellow-400"
            )}
            disabled={props.isDefault}
            aria-label={props.isDefault ? "Current default model" : "Set as default model"}
          >
            <Star className={cn("h-3 w-3", props.isDefault && "fill-current")} />
          </button>
          {/* Edit/delete for custom models */}
          {props.isCustom && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onStartEdit?.();
                }}
                disabled={Boolean(props.saving) || Boolean(props.hasActiveEdit)}
                className="text-muted hover:text-foreground p-0.5 transition-colors"
                aria-label="Edit model"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove?.();
                }}
                disabled={Boolean(props.saving) || Boolean(props.hasActiveEdit)}
                className="text-muted hover:text-error p-0.5 transition-colors"
                aria-label="Remove model"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
