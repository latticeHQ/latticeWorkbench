/**
 * AgentPicker — popover for hiring an AI employee into the current mission.
 *
 * Shows all known CLI agents (employees). Detected/installed agents show a
 * green icon highlight; uninstalled ones are dimmed with a hover-only
 * install link that opens the agent's docs page.
 * While detection is in progress a subtle spinner is shown in the header.
 */
import React from "react";
import { Terminal, Loader2, RefreshCw, ExternalLink, Wrench } from "lucide-react";
import { CLI_AGENT_DEFINITIONS } from "@/common/constants/cliAgents";
import { CliAgentIcon } from "@/browser/components/CliAgentIcon";
import { cn } from "@/common/lib/utils";

export type EmployeeSlug = keyof typeof CLI_AGENT_DEFINITIONS | "terminal";

interface AgentPickerProps {
  /** Set of agent slugs that are detected/installed on the system */
  detectedSlugs?: Set<string>;
  /** Set of agent slugs that are installed but disabled in Settings > Providers */
  disabledSlugs?: Set<string>;
  /** True while the detection scan is still running */
  loading?: boolean;
  /** Callback to re-scan for installed agents */
  onRefresh?: () => void;
  onSelect: (slug: EmployeeSlug) => void;
  onClose: () => void;
  className?: string;
}

/** Sections — controls both order and grouping label */
const AGENT_SECTIONS: Array<{ label: string; slugs: EmployeeSlug[] }> = [
  {
    label: "Lab Agents",
    slugs: ["claude-code", "codex", "gemini", "github-copilot", "cursor", "kiro"],
  },
  {
    label: "Community",
    slugs: ["amp", "auggie", "cline", "codebuff", "continue", "droid", "goose", "kilocode", "kimi"],
  },
  {
    label: "Custom",
    slugs: ["terminal"],
  },
];

export function AgentPicker({ detectedSlugs, disabledSlugs, loading, onRefresh, onSelect, onClose, className }: AgentPickerProps) {
  const handleSelect = (slug: EmployeeSlug) => {
    onSelect(slug);
    onClose();
  };

  return (
    <div
      className={cn(
        "bg-sidebar border-border-light flex w-72 flex-col overflow-hidden rounded-lg border shadow-xl",
        className
      )}
    >
      {/* Header */}
      <div className="border-border-light border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <p className="text-foreground text-[13px] font-semibold">Hire an Employee</p>
          {loading ? (
            <span title="Scanning for installed agents…">
              <Loader2 size={11} className="text-muted animate-spin" />
            </span>
          ) : onRefresh ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              className="text-muted hover:text-foreground flex items-center justify-center rounded p-0.5 transition-colors"
              title="Re-scan for installed agents"
            >
              <RefreshCw size={11} />
            </button>
          ) : null}
        </div>
        <p className="text-muted text-[11px]">Launch an AI agent in this mission</p>
      </div>

      {/* Sectioned agent list */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        {AGENT_SECTIONS.map((section, sectionIdx) => (
          <div key={section.label}>
            {/* Section divider (skip top border on first section) */}
            {sectionIdx > 0 && (
              <div className="border-border-light mx-3 my-1 border-t" />
            )}

            {/* Section label */}
            <p className="text-muted px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-widest">
              {section.label}
            </p>

            {/* Rows */}
            {section.slugs.map((slug) => {
              if (slug === "terminal") {
                return (
                  <EmployeeRow
                    key="terminal"
                    slug="terminal"
                    displayName="Custom Agent"
                    description="Bare shell — install & run any CLI agent"
                    detected={true}
                    onSelect={handleSelect}
                  />
                );
              }

              const def = CLI_AGENT_DEFINITIONS[slug as keyof typeof CLI_AGENT_DEFINITIONS];
              if (!def) return null;

              const detected = !loading && detectedSlugs ? detectedSlugs.has(slug) : undefined;
              const isDisabled = !loading && disabledSlugs ? disabledSlugs.has(slug) : false;

              return (
                <EmployeeRow
                  key={slug}
                  slug={slug}
                  displayName={def.displayName}
                  description={def.description}
                  detected={detected}
                  userDisabled={isDisabled}
                  installUrl={def.installUrl}
                  onSelect={handleSelect}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface EmployeeRowProps {
  slug: EmployeeSlug;
  displayName: string;
  description: string;
  detected: boolean | undefined;
  /** True when the agent is installed but the user has disabled it in Settings > Providers */
  userDisabled?: boolean;
  installUrl?: string;
  onSelect: (slug: EmployeeSlug) => void;
}

function EmployeeRow({
  slug,
  displayName,
  description,
  detected,
  userDisabled = false,
  installUrl,
  onSelect,
}: EmployeeRowProps) {
  return (
    <div
      onClick={() => { if (!userDisabled) onSelect(slug); }}
      className={cn(
        "group flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
        userDisabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-hover cursor-pointer opacity-100",
        detected === false && !userDisabled && "opacity-60 hover:opacity-100"
      )}
      role="button"
      tabIndex={userDisabled ? -1 : 0}
      title={userDisabled ? "Enable in Settings → Providers" : undefined}
      onKeyDown={(e) => {
        if (userDisabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(slug);
        }
      }}
    >
      {/* Icon */}
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[14px]",
          detected === true && !userDisabled
            ? "bg-[var(--color-exec-mode)]/10 text-[var(--color-exec-mode)]"
            : "text-foreground"
        )}
      >
        {slug === "terminal" ? (
          <Wrench size={13} />
        ) : (
          <CliAgentIcon slug={slug} className="text-[14px]" />
        )}
      </span>

      {/* Label + description */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground text-[13px] font-medium leading-tight">{displayName}</span>
          {detected === true && !userDisabled && (
            <span className="bg-[var(--color-exec-mode)]/10 text-[var(--color-exec-mode)] rounded px-1 py-px text-[10px] font-medium leading-none">
              ready
            </span>
          )}
          {userDisabled && (
            <span className="rounded bg-muted/20 px-1 py-px text-[10px] font-medium leading-none text-muted">
              disabled
            </span>
          )}
        </div>
        <p className="text-muted truncate text-[11px] leading-tight">{description}</p>
      </div>

      {/* Install link — only for truly uninstalled agents (not disabled ones) */}
      {detected === false && !userDisabled && installUrl && (
        <a
          href={installUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted hover:text-accent flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-all group-hover:opacity-100"
          title={`Install ${displayName}`}
        >
          <ExternalLink size={9} />
          <span>Install</span>
        </a>
      )}
    </div>
  );
}
