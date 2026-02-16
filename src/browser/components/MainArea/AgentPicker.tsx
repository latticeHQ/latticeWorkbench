/**
 * AgentPicker — popover for hiring an AI employee into the current mission.
 *
 * Shows all known CLI agents (employees). Detected/installed agents show a
 * "ready" badge; uninstalled ones show an "Install" link but are still
 * clickable (the terminal will open regardless — worst case the binary is
 * not found). While detection is in progress a subtle spinner is shown.
 */
import React from "react";
import { Terminal, Loader2 } from "lucide-react";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";
import { CliAgentIcon } from "@/browser/components/CliAgentIcon";
import { cn } from "@/common/lib/utils";

export type EmployeeSlug = keyof typeof CLI_AGENT_DEFINITIONS | "terminal";

interface AgentPickerProps {
  /** Set of agent slugs that are detected/installed on the system */
  detectedSlugs?: Set<string>;
  /** True while the detection scan is still running */
  loading?: boolean;
  onSelect: (slug: EmployeeSlug) => void;
  onClose: () => void;
  className?: string;
}

const AGENT_ORDER: EmployeeSlug[] = [
  "claude-code",
  "codex",
  "gemini",
  "amp",
  "auggie",
  "cline",
  "codebuff",
  "continue",
  "cursor",
  "droid",
  "github-copilot",
  "goose",
  "kilocode",
  "kimi",
  "kiro",
  "terminal",
];

export function AgentPicker({ detectedSlugs, loading, onSelect, onClose, className }: AgentPickerProps) {
  const handleSelect = (slug: EmployeeSlug) => {
    onSelect(slug);
    onClose();
  };

  return (
    <div
      className={cn(
        "bg-sidebar border-border-light flex w-64 flex-col overflow-hidden rounded-lg border shadow-xl",
        className
      )}
    >
      {/* Header */}
      <div className="border-border-light border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <p className="text-foreground text-[13px] font-semibold">Hire an Employee</p>
          {loading && (
            <span title="Scanning for installed agents…">
              <Loader2 size={11} className="text-muted animate-spin" />
            </span>
          )}
        </div>
        <p className="text-muted text-[11px]">Launch an AI agent in this mission</p>
      </div>

      {/* Employee list */}
      <div className="flex max-h-[360px] flex-col overflow-y-auto py-1">
        {AGENT_ORDER.map((slug) => {
          if (slug === "terminal") {
            return (
              <EmployeeRow
                key="terminal"
                slug="terminal"
                displayName="Plain Terminal"
                description="Open a bare shell"
                detected={true}
                onSelect={handleSelect}
              />
            );
          }

          const def = CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS];
          if (!def) return null;

          // Detection complete: show real state. Still loading: treat as unknown (clickable, no badge).
          const detected = !loading && detectedSlugs ? detectedSlugs.has(slug) : undefined;

          return (
            <EmployeeRow
              key={slug}
              slug={slug}
              displayName={def.displayName}
              description={def.description}
              detected={detected}
              installUrl={detected === false ? def.installUrl : undefined}
              onSelect={handleSelect}
            />
          );
        })}
      </div>
    </div>
  );
}

interface EmployeeRowProps {
  slug: EmployeeSlug;
  displayName: string;
  description: string;
  /** true = installed, false = not installed, undefined = detection still running */
  detected: boolean | undefined;
  installUrl?: string;
  onSelect: (slug: EmployeeSlug) => void;
}

function EmployeeRow({ slug, displayName, description, detected, installUrl, onSelect }: EmployeeRowProps) {
  return (
    <button
      onClick={() => onSelect(slug)}
      className="hover:bg-hover flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors"
      title={detected === false && installUrl ? `Not installed — visit ${installUrl}` : undefined}
    >
      {/* Icon */}
      <span className="text-foreground flex h-6 w-6 shrink-0 items-center justify-center text-[14px]">
        {slug === "terminal" ? (
          <Terminal size={14} />
        ) : (
          <CliAgentIcon slug={slug} className="text-[14px]" />
        )}
      </span>

      {/* Label + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-[13px] font-medium">{displayName}</span>
          {detected === true && (
            <span className="bg-green-500/15 text-green-400 rounded px-1 py-px text-[10px] font-medium leading-none">
              ready
            </span>
          )}
        </div>
        <p className="text-muted truncate text-[11px]">{description}</p>
      </div>

      {/* Install link shown only when detection finished and agent is absent */}
      {detected === false && installUrl && (
        <a
          href={installUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-accent hover:text-accent-dark shrink-0 text-[11px] underline"
        >
          Install
        </a>
      )}
    </button>
  );
}
