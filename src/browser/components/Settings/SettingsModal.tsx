import React from "react";
import { createPortal } from "react-dom";
import {
  Settings,
  X,
  Briefcase,
  FlaskConical,
  Keyboard,
  Layout,
  BrainCircuit,
  MessageSquare,
  Puzzle,
  Terminal,
  Network,
} from "lucide-react";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useExperimentValue } from "@/browser/hooks/useExperiments";
import { EXPERIMENT_IDS } from "@/common/constants/experiments";
import { cn } from "@/common/lib/utils";
import { GeneralSection } from "./sections/GeneralSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { System1Section } from "./sections/System1Section";
import { ProjectSettingsSection } from "./sections/ProjectSettingsSection";
import { LayoutsSection } from "./sections/LayoutsSection";
import { ExperimentsSection } from "./sections/ExperimentsSection";
import { KeybindsSection } from "./sections/KeybindsSection";
import { ChannelsSection } from "./sections/ChannelsSection";
import { PluginPacksSection } from "./sections/PluginPacksSection";
import { LatticeSection } from "./sections/LatticeSection";
import type { SettingsSection } from "./types";

const BASE_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    label: "General",
    icon: <Settings className="h-[14px] w-[14px] shrink-0" />,
    component: GeneralSection,
  },
  {
    id: "providers",
    label: "Providers",
    icon: <Terminal className="h-[14px] w-[14px] shrink-0" />,
    component: ProvidersSection,
  },
  {
    id: "plugin-packs",
    label: "Plugins",
    icon: <Puzzle className="h-[14px] w-[14px] shrink-0" />,
    component: PluginPacksSection,
  },
  {
    id: "lattice",
    label: "Lattice",
    icon: <Network className="h-[14px] w-[14px] shrink-0" />,
    component: LatticeSection,
  },
  {
    id: "channels",
    label: "Channels",
    icon: <MessageSquare className="h-[14px] w-[14px] shrink-0" />,
    component: ChannelsSection,
  },
  {
    id: "projects",
    label: "Headquarters",
    icon: <Briefcase className="h-[14px] w-[14px] shrink-0" />,
    component: ProjectSettingsSection,
  },
  {
    id: "layouts",
    label: "Layouts",
    icon: <Layout className="h-[14px] w-[14px] shrink-0" />,
    component: LayoutsSection,
  },
  {
    id: "experiments",
    label: "Experiments",
    icon: <FlaskConical className="h-[14px] w-[14px] shrink-0" />,
    component: ExperimentsSection,
  },
  {
    id: "keybinds",
    label: "Keybinds",
    icon: <Keyboard className="h-[14px] w-[14px] shrink-0" />,
    component: KeybindsSection,
  },
];

/**
 * Settings panel rendered inline inside the right sidebar tab area.
 * No portal, no fixed positioning — fills whatever container it's placed in.
 */
export function SettingsPanelInline() {
  const { activeSection, setActiveSection } = useSettings();
  const system1Enabled = useExperimentValue(EXPERIMENT_IDS.SYSTEM_1);

  const sections = system1Enabled
    ? [
        ...BASE_SECTIONS,
        {
          id: "system1",
          label: "System 1",
          icon: <BrainCircuit className="h-[14px] w-[14px] shrink-0" />,
          component: System1Section,
        },
      ]
    : BASE_SECTIONS;

  const currentSection = sections.find((s) => s.id === activeSection) ?? sections[0]!;
  const SectionComponent = currentSection.component;

  return (
    <div className="flex h-full flex-row overflow-hidden">
      {/* ── Left nav ──────────────────────────────────────────── */}
      <div className="flex w-[148px] shrink-0 flex-col border-r border-border">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <span className="select-none text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Settings
          </span>
        </div>
        <nav className="flex flex-1 flex-col overflow-y-auto py-1" aria-label="Settings sections">
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 border-l-2 py-[7px] pl-[14px] pr-3 text-left text-[11px] transition-all duration-150",
                  isActive
                    ? "border-l-accent bg-gradient-to-r from-accent/[0.10] to-transparent font-medium text-foreground"
                    : "border-l-transparent text-muted hover:translate-x-[1px] hover:bg-hover/70 hover:text-foreground"
                )}
              >
                {section.icon}
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Content panel ─────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-modal-bg">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <span className="text-[13px] font-medium text-foreground">{currentSection.label}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <SectionComponent />
        </div>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const { isOpen, close, activeSection, setActiveSection } = useSettings();
  const system1Enabled = useExperimentValue(EXPERIMENT_IDS.SYSTEM_1);

  // Guard: if system1 experiment is turned off mid-session, reset to first section
  React.useEffect(() => {
    if (!system1Enabled && activeSection === "system1") {
      setActiveSection(BASE_SECTIONS[0]?.id ?? "general");
    }
  }, [activeSection, setActiveSection, system1Enabled]);

  // Escape key closes the panel (capture phase so it beats global stream handlers)
  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [isOpen, close]);

  const sections = system1Enabled
    ? [
        ...BASE_SECTIONS,
        {
          id: "system1",
          label: "System 1",
          icon: <BrainCircuit className="h-[14px] w-[14px] shrink-0" />,
          component: System1Section,
        },
      ]
    : BASE_SECTIONS;

  const currentSection = sections.find((s) => s.id === activeSection) ?? sections[0]!;
  const SectionComponent = currentSection.component;

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Settings"
      aria-modal="true"
      className={cn(
        // Full viewport — covers the entire window like VS Code settings
        "fixed inset-0 z-[2000]",
        // Two-column layout: nav sidebar + content
        "flex flex-row overflow-hidden",
        // Base background
        "bg-sidebar",
        // Fade in on mount
        "animate-in fade-in duration-200 ease-in-out",
        // Override Electron's titlebar-drag region so all clicks reach React
        "titlebar-no-drag",
      )}
    >
      {/* ── Left nav ──────────────────────────────────────────── */}
      <div className="flex w-[200px] shrink-0 flex-col border-r border-border">
        {/* "SETTINGS" label row */}
        <div className="flex h-10 shrink-0 items-center border-b border-border px-5">
          <span className="select-none text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Settings
          </span>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto py-2" aria-label="Settings sections">
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 border-l-2 py-[7px] pl-[18px] pr-4 text-left text-[12px] transition-all duration-150",
                  isActive
                    ? "border-l-accent bg-gradient-to-r from-accent/[0.10] to-transparent font-medium text-foreground"
                    : "border-l-transparent text-muted hover:translate-x-[1px] hover:bg-hover/70 hover:text-foreground"
                )}
              >
                {section.icon}
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Content panel ─────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-modal-bg">
        {/* Header row */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-6">
          <span className="text-[13px] font-medium text-foreground">{currentSection.label}</span>
          <button
            onClick={close}
            aria-label="Close settings"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded",
              "text-muted hover:text-foreground hover:bg-hover",
              "transition-colors duration-150",
            )}
          >
            <X className="h-[14px] w-[14px]" />
          </button>
        </div>

        {/* Scrollable section content — max-width keeps long lines readable */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-2xl">
            <SectionComponent />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
