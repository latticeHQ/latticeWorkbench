import React from "react";
import GitHubCopilotIcon from "@/browser/assets/icons/github-copilot.svg?react";
import AnthropicIcon from "@/browser/assets/icons/anthropic.svg?react";
import OpenAIIcon from "@/browser/assets/icons/openai.svg?react";
import GoogleIcon from "@/browser/assets/icons/google.svg?react";
import XAIIcon from "@/browser/assets/icons/xai.svg?react";
import OpenRouterIcon from "@/browser/assets/icons/openrouter.svg?react";
import OllamaIcon from "@/browser/assets/icons/ollama.svg?react";
import DeepSeekIcon from "@/browser/assets/icons/deepseek.svg?react";
import AWSIcon from "@/browser/assets/icons/aws.svg?react";
import LatticeIcon from "@/browser/assets/icons/lattice.svg?react";
import { PROVIDER_DISPLAY_NAMES, type ProviderName } from "@/common/constants/providers";
import { CLI_AGENT_DISPLAY_NAMES, type CliAgentSlug } from "@/common/constants/cliAgents";
import { cn } from "@/common/lib/utils";

/**
 * Provider icons mapped by provider name.
 * When adding a new provider, add its icon import above and entry here.
 */
const PROVIDER_ICONS: Partial<Record<ProviderName, React.FC>> = {
  "github-copilot": GitHubCopilotIcon,
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  xai: XAIIcon,
  deepseek: DeepSeekIcon,
  openrouter: OpenRouterIcon,
  bedrock: AWSIcon,
  ollama: OllamaIcon,
  "claude-code": AnthropicIcon,
  "lattice-inference": LatticeIcon,
};

/**
 * CLI agent slug → icon mapping.
 * Falls back to PROVIDER_ICONS when a CLI agent slug matches a provider key
 * (e.g., "claude-code" → AnthropicIcon).
 */
const CLI_AGENT_ICONS: Record<string, React.FC> = {
  "claude-code": AnthropicIcon,
  codex: OpenAIIcon,
  gemini: GoogleIcon,
  "github-copilot": GitHubCopilotIcon,
  kiro: AWSIcon,
};

/**
 * Check if a provider or CLI agent slug has an icon available.
 */
export function hasProviderIcon(provider: string): boolean {
  return provider in PROVIDER_ICONS || provider in CLI_AGENT_ICONS;
}

/**
 * Resolve an icon component for a provider key or CLI agent slug.
 */
function resolveIcon(provider: string): React.FC | undefined {
  return PROVIDER_ICONS[provider as ProviderName] ?? CLI_AGENT_ICONS[provider];
}

export interface ProviderIconProps {
  provider: string;
  className?: string;
}

/**
 * Renders a provider's icon if one exists, otherwise returns null.
 * Supports both SDK provider names and CLI agent slugs.
 * Icons are sized to 1em by default to match surrounding text.
 */
export function ProviderIcon(props: ProviderIconProps) {
  const IconComponent = resolveIcon(props.provider);
  if (!IconComponent) return null;

  return (
    <span
      className={cn(
        "inline-block h-[1em] w-[1em] align-[-0.125em] [&_svg]:block [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-current [&_svg_.st0]:fill-current",
        props.className
      )}
    >
      <IconComponent />
    </span>
  );
}

export interface ProviderWithIconProps {
  provider: string;
  className?: string;
  iconClassName?: string;
  /** Show display name instead of raw provider key */
  displayName?: boolean;
}

/**
 * Resolve the display name for a provider key or CLI agent slug.
 */
export function resolveProviderDisplayName(provider: string): string {
  return (
    PROVIDER_DISPLAY_NAMES[provider as ProviderName] ??
    CLI_AGENT_DISPLAY_NAMES[provider as CliAgentSlug] ??
    provider
  );
}

/**
 * Renders a provider name with its icon (if available).
 * Falls back to just the name if no icon exists for the provider.
 * Supports both SDK provider names and CLI agent slugs.
 */
export function ProviderWithIcon(props: ProviderWithIconProps) {
  const name = props.displayName ? resolveProviderDisplayName(props.provider) : props.provider;

  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", props.className)}>
      <ProviderIcon provider={props.provider} className={props.iconClassName} />
      <span>{name}</span>
    </span>
  );
}
