import React from "react";
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
} from "lucide-react";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { useExperimentValue } from "@/browser/hooks/useExperiments";
import { EXPERIMENT_IDS } from "@/common/constants/experiments";
import { VisuallyHidden } from "@/browser/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/browser/components/ui/sheet";
import { GeneralSection } from "./sections/GeneralSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { System1Section } from "./sections/System1Section";
import { Button } from "@/browser/components/ui/button";
import { ProjectSettingsSection } from "./sections/ProjectSettingsSection";
import { LayoutsSection } from "./sections/LayoutsSection";
import { ExperimentsSection } from "./sections/ExperimentsSection";
import { KeybindsSection } from "./sections/KeybindsSection";
import { ChannelsSection } from "./sections/ChannelsSection";
import { PluginPacksSection } from "./sections/PluginPacksSection";
import type { SettingsSection } from "./types";

const BASE_SECTIONS: SettingsSection[] = [
  {
    id: "general",
    label: "General",
    icon: <Settings className="h-4 w-4" />,
    component: GeneralSection,
  },
  {
    id: "providers",
    label: "Providers",
    icon: <Terminal className="h-4 w-4" />,
    component: ProvidersSection,
  },
  {
    id: "plugin-packs",
    label: "Plugins",
    icon: <Puzzle className="h-4 w-4" />,
    component: PluginPacksSection,
  },
  {
    id: "channels",
    label: "Channels",
    icon: <MessageSquare className="h-4 w-4" />,
    component: ChannelsSection,
  },
  {
    id: "projects",
    label: "Headquarters",
    icon: <Briefcase className="h-4 w-4" />,
    component: ProjectSettingsSection,
  },
  {
    id: "layouts",
    label: "Layouts",
    icon: <Layout className="h-4 w-4" />,
    component: LayoutsSection,
  },
  {
    id: "experiments",
    label: "Experiments",
    icon: <FlaskConical className="h-4 w-4" />,
    component: ExperimentsSection,
  },
  {
    id: "keybinds",
    label: "Keybinds",
    icon: <Keyboard className="h-4 w-4" />,
    component: KeybindsSection,
  },
];

export function SettingsModal() {
  const { isOpen, close, activeSection, setActiveSection } = useSettings();
  const system1Enabled = useExperimentValue(EXPERIMENT_IDS.SYSTEM_1);

  React.useEffect(() => {
    if (!system1Enabled && activeSection === "system1") {
      setActiveSection(BASE_SECTIONS[0]?.id ?? "general");
    }
  }, [activeSection, setActiveSection, system1Enabled]);

  const sections = system1Enabled
    ? [
        ...BASE_SECTIONS,
        {
          id: "system1",
          label: "System 1",
          icon: <BrainCircuit className="h-4 w-4" />,
          component: System1Section,
        },
      ]
    : BASE_SECTIONS;

  const currentSection = sections.find((s) => s.id === activeSection) ?? sections[0];
  const SectionComponent = currentSection.component;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        aria-describedby={undefined}
        className="w-[min(920px,95vw)] flex-row"
      >
        {/* Visually hidden title for accessibility */}
        <VisuallyHidden>
          <SheetTitle>Settings</SheetTitle>
        </VisuallyHidden>

        {/* Nav sidebar */}
        <div className="bg-background-secondary/30 flex w-48 shrink-0 flex-col border-r border-border-medium">
          <div className="flex h-11 shrink-0 items-center border-b border-border-medium px-4">
            <span className="text-foreground text-xs font-semibold tracking-wide uppercase">
              Settings
            </span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1.5">
            {sections.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                onClick={() => setActiveSection(section.id)}
                className={`flex h-auto w-full items-center justify-start gap-2.5 rounded-md px-3 py-1.5 text-left text-xs ${
                  activeSection === section.id
                    ? "bg-accent/10 text-foreground hover:bg-accent/10 font-medium"
                    : "text-muted hover:bg-hover hover:text-foreground"
                }`}
              >
                {section.icon}
                {section.label}
              </Button>
            ))}
          </nav>
        </div>

        {/* Content panel */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border-medium px-6">
            <span className="text-foreground text-sm font-medium">{currentSection.label}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              className="h-7 w-7"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <SectionComponent />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
