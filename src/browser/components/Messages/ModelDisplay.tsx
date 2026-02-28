import React from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/browser/components/ui/tooltip";
import { ProviderIcon } from "@/browser/components/ProviderIcon";
import { formatModelDisplayName } from "@/common/utils/ai/modelDisplay";

interface ModelDisplayProps {
  modelString: string;
  /** Whether to show the tooltip on hover (default: true, set to false when used within another tooltip) */
  showTooltip?: boolean;
}

/**
 * Parse a model string into provider and model name.
 * Format: "provider:model-name" (e.g., "anthropic:claude-sonnet-4-5")
 */
function parseModelString(modelString: string): {
  provider: string;
  modelName: string;
} {
  const [provider, rest] = modelString.includes(":")
    ? modelString.split(":", 2)
    : ["", modelString];

  return { provider, modelName: rest };
}

/**
 * Display a model name with its provider icon.
 * Supports format "provider:model-name" (e.g., "anthropic:claude-sonnet-4-5")
 *
 * Uses standard inline layout for natural text alignment.
 * Icon is 1em (matches font size) with vertical-align: middle.
 */
export const ModelDisplay: React.FC<ModelDisplayProps> = ({
  modelString,
  showTooltip = true,
}) => {
  const { provider, modelName } = parseModelString(modelString);

  const displayName = formatModelDisplayName(modelName);

  const iconClass =
    "mr-[0.3em] inline-block h-[1.1em] w-[1.1em] align-[-0.19em] [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg_.st0]:fill-current [&_svg_circle]:!fill-current [&_svg_path]:!fill-current [&_svg_rect]:!fill-current";

  const content = (
    <span className="inline normal-case" data-model-display>
      <ProviderIcon provider={provider} className={iconClass} data-model-icon />
      <span className="inline">
        {displayName}
      </span>
    </span>
  );

  if (!showTooltip) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-model-display-tooltip>{content}</span>
      </TooltipTrigger>
      <TooltipContent align="center" data-model-tooltip-text>
        {modelString}
      </TooltipContent>
    </Tooltip>
  );
};
