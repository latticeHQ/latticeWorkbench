/**
 * Provider name constants — kept for backward compatibility with icon mapping,
 * display names, and type references. SDK factory infrastructure has been removed;
 * all model execution routes through CLI agents (see cliAgents.ts + cliAgentProvider.ts).
 */

import { CLI_AGENT_DISPLAY_NAMES, CLI_AGENT_SLUGS, type CliAgentSlug } from "./cliAgents";

/**
 * Legacy provider name type — now a union of CLI agent slugs plus
 * legacy string keys still referenced by ProviderIcon, display names, etc.
 */
export type ProviderName =
  | CliAgentSlug
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "deepseek"
  | "openrouter"
  | "bedrock"
  | "ollama"
  | "github-copilot-direct"
  | "lattice-inference";

/**
 * Array of all supported provider names (for UI lists, iteration, etc.)
 * Now derived from CLI agent slugs.
 */
export const SUPPORTED_PROVIDERS: string[] = [...CLI_AGENT_SLUGS];

/**
 * Display names for providers (proper casing for UI).
 * Merges CLI agent display names with legacy provider names used by icons.
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  ...CLI_AGENT_DISPLAY_NAMES,
  // Legacy display names for icons/UI that reference old provider keys
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  bedrock: "Bedrock",
  ollama: "Ollama",
  "github-copilot": "GitHub Copilot",
  "github-copilot-direct": "GitHub Copilot (Direct)",
  "lattice-inference": "Lattice Inference",
};

/**
 * Type guard to check if a string is a valid provider/agent name.
 * In the agent-only architecture, checks against CLI agent slugs.
 */
export function isValidProvider(provider: string): boolean {
  return CLI_AGENT_SLUGS.includes(provider as CliAgentSlug);
}
