/**
 * Centralized model metadata. Update model versions here and everywhere else will follow.
 *
 * Agent-only architecture: The `provider` field MUST match a CLI agent slug from
 * CLI_AGENT_DEFINITIONS in cliAgents.ts. The model string "provider:providerModelId"
 * is passed directly to aiService.createModel() which routes through CLI binaries.
 */

import { formatModelDisplayName } from "../utils/ai/modelDisplay";
import type { CliAgentSlug } from "./cliAgents";

/**
 * Model provider type — must be a valid CLI agent slug so that model strings
 * (e.g., "claude-code:claude-sonnet-4-5") can be routed by aiService.createModel().
 */
type ModelProvider = CliAgentSlug;

interface KnownModelDefinition {
  /** CLI agent slug used for routing (must exist in CLI_AGENT_DEFINITIONS) */
  provider: ModelProvider;
  /** Model name passed to the CLI agent (provider-specific) */
  providerModelId: string;
  /** Aliases that should resolve to this model */
  aliases?: string[];
  /** Preload tokenizer encodings at startup */
  warm?: boolean;
  /** Optional tokenizer override for ai-tokenizer */
  tokenizerOverride?: string;
}

interface KnownModel extends KnownModelDefinition {
  /** Full model id string in the format agent-slug:model-id */
  id: `${string}:${string}`;
}

// Model definitions. Each model maps to a CLI agent slug + model ID that the agent understands.
const MODEL_DEFINITIONS = {
  // Claude Code agent (Anthropic models via Claude CLI)
  SONNET: {
    provider: "claude-code" as ModelProvider,
    providerModelId: "claude-sonnet-4-5",
    aliases: ["sonnet", "copilot", "copilot-sonnet", "copilot-direct"],
    warm: true,
    tokenizerOverride: "anthropic/claude-sonnet-4.5",
  },
  OPUS: {
    provider: "claude-code" as ModelProvider,
    providerModelId: "claude-opus-4-5",
    aliases: ["opus"],
    warm: true,
  },
  HAIKU: {
    provider: "claude-code" as ModelProvider,
    providerModelId: "claude-haiku-4-5",
    aliases: ["haiku"],
    tokenizerOverride: "anthropic/claude-3.5-haiku",
  },

  // Codex agent (OpenAI models via Codex CLI)
  GPT: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.2",
    aliases: ["gpt"],
    warm: true,
    tokenizerOverride: "openai/gpt-5",
  },
  GPT_PRO: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.2-pro",
    aliases: ["gpt-pro"],
  },
  GPT_52_CODEX: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.2-codex",
    aliases: ["codex"],
    warm: true,
    tokenizerOverride: "openai/gpt-5",
  },
  GPT_CODEX: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.1-codex",
    aliases: ["codex-5.1"],
    warm: true,
    tokenizerOverride: "openai/gpt-5",
  },
  GPT_MINI: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.1-codex-mini",
    aliases: ["codex-mini"],
  },
  GPT_CODEX_MAX: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-5.1-codex-max",
    aliases: ["codex-max"],
    warm: true,
    tokenizerOverride: "openai/gpt-5",
  },
  GPT_4O: {
    provider: "codex" as ModelProvider,
    providerModelId: "gpt-4o",
    aliases: ["copilot-gpt", "copilot-direct-gpt", "copilot-proxy-gpt"],
    warm: true,
    tokenizerOverride: "openai/gpt-5",
  },

  // Gemini agent (Google models via Gemini CLI)
  GEMINI_3_PRO: {
    provider: "gemini" as ModelProvider,
    providerModelId: "gemini-3-pro-preview",
    aliases: ["gemini", "gemini-3", "gemini-3-pro"],
    tokenizerOverride: "google/gemini-2.5-pro",
  },
  GEMINI_3_FLASH: {
    provider: "gemini" as ModelProvider,
    providerModelId: "gemini-3-flash-preview",
    aliases: ["gemini-3-flash"],
    tokenizerOverride: "google/gemini-2.5-pro",
  },

  // GitHub Copilot agent (via gh copilot CLI)
  COPILOT_PROXY_SONNET: {
    provider: "github-copilot" as ModelProvider,
    providerModelId: "claude-sonnet-4.5",
    aliases: ["copilot-proxy", "copilot-proxy-sonnet"],
    warm: false,
    tokenizerOverride: "anthropic/claude-sonnet-4.5",
  },
  COPILOT_PROXY_GPT: {
    provider: "github-copilot" as ModelProvider,
    providerModelId: "gpt-4o",
    aliases: ["copilot-proxy-gpt-alt"],
    warm: false,
    tokenizerOverride: "openai/gpt-5",
  },

} as const satisfies Record<string, KnownModelDefinition>;

export type KnownModelKey = keyof typeof MODEL_DEFINITIONS;
const MODEL_DEFINITION_ENTRIES = Object.entries(MODEL_DEFINITIONS) as Array<
  [KnownModelKey, KnownModelDefinition]
>;

export const KNOWN_MODELS = Object.fromEntries(
  MODEL_DEFINITION_ENTRIES.map(([key, definition]) => toKnownModelEntry(key, definition))
);
function toKnownModelEntry<K extends KnownModelKey>(
  key: K,
  definition: KnownModelDefinition
): [K, KnownModel] {
  return [
    key,
    {
      ...definition,
      id: `${definition.provider}:${definition.providerModelId}`,
    },
  ];
}

export function getKnownModel(key: KnownModelKey): KnownModel {
  return KNOWN_MODELS[key];
}

// ------------------------------------------------------------------------------------
// Derived collections
// ------------------------------------------------------------------------------------

/** The default model key - change this single line to update the global default */
export const DEFAULT_MODEL_KEY: KnownModelKey = "SONNET";

export const DEFAULT_MODEL = KNOWN_MODELS[DEFAULT_MODEL_KEY].id;

export const DEFAULT_WARM_MODELS = Object.values(KNOWN_MODELS)
  .filter((model) => model.warm)
  .map((model) => model.id);

export const MODEL_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  Object.values(KNOWN_MODELS)
    .flatMap((model) => (model.aliases ?? []).map((alias) => [alias, model.id] as const))
    .sort(([a], [b]) => a.localeCompare(b))
);

export const TOKENIZER_MODEL_OVERRIDES: Record<string, string> = Object.fromEntries(
  Object.values(KNOWN_MODELS)
    .filter((model) => Boolean(model.tokenizerOverride))
    .map((model) => [model.id, model.tokenizerOverride!])
);

export const MODEL_NAMES: Record<string, Record<string, string>> = Object.entries(
  KNOWN_MODELS
).reduce<Record<string, Record<string, string>>>(
  (acc, [key, model]) => {
    if (!acc[model.provider]) {
      const emptyRecord: Record<string, string> = {};
      acc[model.provider] = emptyRecord;
    }
    acc[model.provider][key] = model.providerModelId;
    return acc;
  },
  {} as Record<string, Record<string, string>>
);

/** Picker-friendly list: { label, value } for each known model */
export const KNOWN_MODEL_OPTIONS = Object.values(KNOWN_MODELS).map((model) => ({
  label: formatModelDisplayName(model.providerModelId),
  value: model.id,
}));

/** Tooltip-friendly abbreviation examples: show representative shortcuts */
export const MODEL_ABBREVIATION_EXAMPLES = (["opus", "sonnet"] as const).map((abbrev) => ({
  abbrev,
  displayName: formatModelDisplayName(MODEL_ABBREVIATIONS[abbrev]?.split(":")[1] ?? abbrev),
}));
