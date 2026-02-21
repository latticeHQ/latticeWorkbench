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
import { RIGHT_SIDEBAR_WIDTH_KEY } from "@/common/constants/storage";
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
 * Read the persisted right-sidebar width so the settings panel slides into
 * the same visual slot as the right sidebar (no jarring size mismatch).
 */
function readSidebarWidth(min = 380): number {
  const raw = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_KEY);
  const parsed = raw ? parseInt(raw, 10) : 400;
  const n = isNaN(parsed) ? 400 : parsed;
  return Math.max(min, n);
}

export function SettingsModal() {
  const { isOpen, close, activeSection, setActiveSection } = useSettings();
  const system1Enabled = useExperimentValue(EXPERIMENT_IDS.SYSTEM_1);

  // Capture sidebar width once when the panel opens to avoid layout jumps
  // while the panel is visible.
  const [panelWidth, setPanelWidth] = React.useState(400);
  React.useEffect(() => {
    if (isOpen) setPanelWidth(readSidebarWidth());
  }, [isOpen]);

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
      aria-modal="false"
      className={cn(
        // Position: hugs the right edge, spans full viewport height
        "fixed inset-y-0 right-0 z-[1500]",
        // Two-column row layout (nav + content)
        "flex flex-row overflow-hidden",
        // Warm sidebar background with left divider
        "bg-sidebar border-l border-border",
        // Subtle depth shadow toward the main content area
        "shadow-[-6px_0_24px_rgba(0,0,0,0.15)]",
        // Slide in from the right on mount — no overlay, no modal backdrop
        "animate-in slide-in-from-right duration-300 ease-in-out",
      )}
      style={{ width: panelWidth }}
    >
      {/* ── Left nav ──────────────────────────────────────────── */}
      <div className="flex w-[148px] shrink-0 flex-col border-r border-border">
        {/* "SETTINGS" label row — same height as WorkspaceHeader toolbar rows */}
        <div className="flex h-10 shrink-0 items-center px-4 border-b border-border">
          <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted select-none">
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
                    ? "border-l-accent bg-gradient-to-r from-accent/[0.10] to-transparent text-foreground font-medium"
                    : "border-l-transparent text-muted hover:bg-hover/70 hover:text-foreground hover:translate-x-[1px]"
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
        {/* Header row — same height as nav header */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
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

        {/* Scrollable section content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <SectionComponent />
        </div>
      </div>
    </div>,
    document.body
  );
}
