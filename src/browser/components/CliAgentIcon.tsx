import React from "react";
import { Terminal } from "lucide-react";
import AnthropicIcon from "@/browser/assets/icons/anthropic.svg?react";
import OpenAIIcon from "@/browser/assets/icons/openai.svg?react";
import GoogleIcon from "@/browser/assets/icons/google.svg?react";
import GitHubCopilotIcon from "@/browser/assets/icons/github-copilot.svg?react";
import AWSIcon from "@/browser/assets/icons/aws.svg?react";
import { cn } from "@/common/lib/utils";

/**
 * CLI Agent icons mapped by slug.
 * Reuses existing provider SVGs where the agent is from the same company.
 * Falls back to a terminal icon for agents without a custom icon.
 */
const CLI_AGENT_ICONS: Partial<Record<string, React.FC>> = {
  "claude-code": AnthropicIcon,
  codex: OpenAIIcon,
  gemini: GoogleIcon,
  "github-copilot": GitHubCopilotIcon,
  kiro: AWSIcon,
};

export interface CliAgentIconProps {
  slug: string;
  className?: string;
}

/**
 * Renders a CLI agent's icon. Falls back to a Terminal icon if no custom icon exists.
 */
export function CliAgentIcon(props: CliAgentIconProps) {
  const IconComponent = CLI_AGENT_ICONS[props.slug];

  if (IconComponent) {
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

  return <Terminal className={cn("h-[1em] w-[1em]", props.className)} />;
}

export interface CliAgentWithIconProps {
  slug: string;
  displayName: string;
  className?: string;
  iconClassName?: string;
}

/**
 * Renders a CLI agent name with its icon.
 */
export function CliAgentWithIcon(props: CliAgentWithIconProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", props.className)}>
      <CliAgentIcon slug={props.slug} className={props.iconClassName} />
      <span>{props.displayName}</span>
    </span>
  );
}
