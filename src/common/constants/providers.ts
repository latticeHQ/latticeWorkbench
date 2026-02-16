/**
 * Provider Definitions - Single source of truth for all provider metadata
 *
 * When adding a new provider:
 * 1. Add entry to PROVIDER_DEFINITIONS below
 * 2. Add SVG icon + import in src/browser/components/ProviderIcon.tsx
 * 3. If provider needs custom logic, add handler in aiService.ts
 *    (simple providers using standard pattern are handled automatically)
 *
 * Simple providers (requiresApiKey + standard factory pattern) need NO aiService.ts changes.
 */

interface ProviderDefinition {
  /** Display name for UI (proper casing) */
  displayName: string;
  /** Dynamic import function for lazy loading */
  import: () => Promise<unknown>;
  /** Name of the factory function exported by the package */
  factoryName: string;
  /** Whether provider requires an API key (false for local services like Ollama) */
  requiresApiKey: boolean;
}

// Order determines display order in UI (Settings, model selectors, etc.)
export const PROVIDER_DEFINITIONS = {
  "github-copilot": {
    displayName: "GitHub Copilot (via VS Code)",
    import: () => import("@ai-sdk/openai"),
    factoryName: "createOpenAI",
    requiresApiKey: false, // Routes through VS Code LM Proxy — no API key needed
  },
  "github-copilot-direct": {
    displayName: "GitHub Copilot (Direct API)",
    import: () => import("ai-sdk-provider-github"),
    factoryName: "createCopilot",
    requiresApiKey: false, // Uses CLI credentials from ~/.config/github-copilot/apps.json
  },
  anthropic: {
    displayName: "Anthropic",
    import: () => import("@ai-sdk/anthropic"),
    factoryName: "createAnthropic",
    requiresApiKey: true,
  },
  openai: {
    displayName: "OpenAI",
    import: () => import("@ai-sdk/openai"),
    factoryName: "createOpenAI",
    requiresApiKey: true,
  },
  google: {
    displayName: "Google",
    import: () => import("@ai-sdk/google"),
    factoryName: "createGoogleGenerativeAI",
    requiresApiKey: true,
  },
  xai: {
    displayName: "xAI",
    import: () => import("@ai-sdk/xai"),
    factoryName: "createXai",
    requiresApiKey: true,
  },
  deepseek: {
    displayName: "DeepSeek",
    import: () => import("@ai-sdk/deepseek"),
    factoryName: "createDeepSeek",
    requiresApiKey: true,
  },
  openrouter: {
    displayName: "OpenRouter",
    import: () => import("@openrouter/ai-sdk-provider"),
    factoryName: "createOpenRouter",
    requiresApiKey: true,
  },
  bedrock: {
    displayName: "Bedrock",
    import: () => import("@ai-sdk/amazon-bedrock"),
    factoryName: "createAmazonBedrock",
    requiresApiKey: false, // Uses AWS credential chain
  },
  ollama: {
    displayName: "Ollama",
    import: () => import("ollama-ai-provider-v2"),
    factoryName: "createOllama",
    requiresApiKey: false, // Local service
  },
  "claude-code": {
    displayName: "Claude Code (Max/Pro)",
    import: () => Promise.resolve({}), // Custom LanguageModelV2 via claudeCodeProvider — spawns `claude` CLI
    factoryName: "",
    requiresApiKey: false, // Uses Claude Code CLI authentication (setup-token / auth login)
  },
  "lattice-inference": {
    displayName: "Lattice Inference",
    import: () => Promise.resolve({}), // No external SDK — custom LanguageModelV2 via InferenceService
    factoryName: "",
    requiresApiKey: false, // Local on-device inference, no API key needed
  },
} as const satisfies Record<string, ProviderDefinition>;

/**
 * Union type of all supported provider names
 */
export type ProviderName = keyof typeof PROVIDER_DEFINITIONS;

/**
 * Array of all supported provider names (for UI lists, iteration, etc.)
 */
export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_DEFINITIONS) as ProviderName[];

/**
 * Display names for providers (proper casing for UI)
 * Derived from PROVIDER_DEFINITIONS - do not edit directly
 */
export const PROVIDER_DISPLAY_NAMES: Record<ProviderName, string> = Object.fromEntries(
  Object.entries(PROVIDER_DEFINITIONS).map(([key, def]) => [key, def.displayName])
) as Record<ProviderName, string>;

/**
 * Legacy registry for backward compatibility with aiService.ts
 * Maps provider names to their import functions
 */
export const PROVIDER_REGISTRY = Object.fromEntries(
  Object.entries(PROVIDER_DEFINITIONS).map(([key, def]) => [key, def.import])
) as { [K in ProviderName]: (typeof PROVIDER_DEFINITIONS)[K]["import"] };

/**
 * Type guard to check if a string is a valid provider name
 */
export function isValidProvider(provider: string): provider is ProviderName {
  return provider in PROVIDER_REGISTRY;
}
