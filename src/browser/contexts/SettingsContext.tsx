import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface OpenSettingsOptions {
  /** When opening the Providers settings, expand a specific agent. */
  expandAgent?: string;
}

interface SettingsContextValue {
  isOpen: boolean;
  activeSection: string;
  open: (section?: string, options?: OpenSettingsOptions) => void;
  /** Open Settings → Headquarters with a project preselected in the dropdown */
  openProjectSettings: (projectPath: string) => void;
  /** One-shot target used to preselect the project dropdown in Headquarter settings */
  projectsTargetProjectPath: string | null;
  clearProjectsTargetProjectPath: () => void;
  close: () => void;
  setActiveSection: (section: string) => void;

  /** One-shot hint for AgentsSection to expand a specific agent. */
  agentsExpandedAgent: string | null;
  setAgentsExpandedAgent: (agent: string | null) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

const DEFAULT_SECTION = "general";

export function SettingsProvider(props: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [projectsTargetProjectPath, setProjectsTargetProjectPath] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(DEFAULT_SECTION);
  const [agentsExpandedAgent, setAgentsExpandedAgent] = useState<string | null>(null);

  const clearProjectsTargetProjectPath = useCallback(() => {
    setProjectsTargetProjectPath(null);
  }, []);

  const setSection = useCallback((section: string) => {
    setActiveSection(section);

    if (section !== "providers") {
      setAgentsExpandedAgent(null);
    }

    if (section !== "projects") {
      setProjectsTargetProjectPath(null);
    }
  }, []);

  const open = useCallback(
    (section?: string, options?: OpenSettingsOptions) => {
      if (section) {
        setSection(section);
      }

      if (section === "providers") {
        setAgentsExpandedAgent(options?.expandAgent ?? null);
      }

      setIsOpen(true);
    },
    [setSection]
  );

  const openProjectSettings = useCallback(
    (projectPath: string) => {
      setProjectsTargetProjectPath(projectPath);
      open("projects");
    },
    [open]
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setAgentsExpandedAgent(null);
    setProjectsTargetProjectPath(null);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      isOpen,
      activeSection,
      open,
      openProjectSettings,
      projectsTargetProjectPath,
      clearProjectsTargetProjectPath,
      close,
      setActiveSection: setSection,
      agentsExpandedAgent,
      setAgentsExpandedAgent,
    }),
    [
      isOpen,
      activeSection,
      open,
      openProjectSettings,
      projectsTargetProjectPath,
      clearProjectsTargetProjectPath,
      close,
      setSection,
      agentsExpandedAgent,
    ]
  );

  return <SettingsContext.Provider value={value}>{props.children}</SettingsContext.Provider>;
}
