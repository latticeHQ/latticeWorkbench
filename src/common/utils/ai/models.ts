/**
 * Model configuration and constants
 */

import { DEFAULT_MODEL, MODEL_ABBREVIATIONS } from "@/common/constants/knownModels";

export const defaultModel = DEFAULT_MODEL;

/**
 * Resolve model alias to full model string.
 * If the input is an alias (e.g., "haiku", "sonnet"), returns the full model string.
 * Otherwise returns the input unchanged.
 */
export function resolveModelAlias(modelInput: string): string {
  if (Object.hasOwn(MODEL_ABBREVIATIONS, modelInput)) {
    return MODEL_ABBREVIATIONS[modelInput];
  }
  return modelInput;
}

/**
 * Validate model string format (must be "provider:model-id").
 * Supports colons in the model ID (e.g., "ollama:gpt-oss:20b").
 */
export function isValidModelFormat(model: string): boolean {
  const colonIndex = model.indexOf(":");
  return colonIndex > 0 && colonIndex < model.length - 1;
}

/**
 * Extract the model name from a model string (e.g., "anthropic:claude-sonnet-4-5" -> "claude-sonnet-4-5")
 * @param modelString - Full model string in format "provider:model-name"
 * @returns The model name part (after the colon), or the full string if no colon is found
 */
export function getModelName(modelString: string): string {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    return modelString;
  }
  return modelString.substring(colonIndex + 1);
}

/**
 * Extract the provider from a model string (e.g., "anthropic:claude-sonnet-4-5" -> "anthropic")
 * @param modelString - Full model string in format "provider:model-name"
 * @returns The provider part (before the colon), or empty string if no colon is found
 */
export function getModelProvider(modelString: string): string {
  const colonIndex = modelString.indexOf(":");
  if (colonIndex === -1) {
    return "";
  }
  return modelString.substring(0, colonIndex);
}

/**
 * Check if a model supports the 1M context window.
 * The 1M context window is available for Claude Sonnet 4/4.5/4.6 and Opus 4.6.
 * @param modelString - Full model string in format "provider:model-name"
 * @returns True if the model supports 1M context window
 */
export function supports1MContext(modelString: string): boolean {
  const [provider, modelName] = modelString.split(":");
  if (provider !== "anthropic") {
    return false;
  }
  // Sonnet 4, Sonnet 4.5, Sonnet 4.6, and Opus 4.6 support 1M context (beta)
  return (
    (modelName?.includes("claude-sonnet-4") && !modelName.includes("claude-sonnet-3")) ||
    modelName?.includes("claude-opus-4-6") === true
  );
}
