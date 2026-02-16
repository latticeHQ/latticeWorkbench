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
import { Dialog, DialogContent, DialogTitle, VisuallyHidden } from "@/browser/components/ui/dialog";
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        maxWidth="920px"
        aria-describedby={undefined}
        className="flex h-[85vh] max-h-[680px] flex-col gap-0 overflow-hidden p-0 md:h-[75vh] md:flex-row"
      >
        {/* Visually hidden title for accessibility */}
        <VisuallyHidden>
          <DialogTitle>Settings</DialogTitle>
        </VisuallyHidden>
        {/* Sidebar - horizontal tabs on mobile, vertical on desktop */}
        <div className="bg-background-secondary/30 flex shrink-0 flex-col border-b border-border-medium md:w-52 md:border-r md:border-b-0">
          <div className="flex h-11 items-center justify-between border-b border-border-medium px-4 md:justify-start">
            <span className="text-foreground text-xs font-semibold tracking-wide uppercase">
              Settings
            </span>
            {/* Close button in header on mobile only */}
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              className="h-6 w-6 md:hidden"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <nav className="flex gap-0.5 overflow-x-auto p-1.5 md:flex-1 md:flex-col md:overflow-y-auto">
            {sections.map((section) => (
              <Button
                key={section.id}
                variant="ghost"
                onClick={() => setActiveSection(section.id)}
                className={`flex h-auto shrink-0 items-center justify-start gap-2.5 rounded-md px-3 py-1.5 text-left text-xs whitespace-nowrap md:w-full ${
                  activeSection === section.id
                    ? "bg-accent/15 text-accent hover:bg-accent/15 hover:text-accent font-medium"
                    : "text-muted hover:bg-hover hover:text-foreground"
                }`}
              >
                {section.icon}
                {section.label}
              </Button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="hidden h-11 items-center justify-between border-b border-border-medium px-6 md:flex">
            <span className="text-foreground text-sm font-medium">{currentSection.label}</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              className="h-6 w-6"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 md:px-6 md:py-5">
            <SectionComponent />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
