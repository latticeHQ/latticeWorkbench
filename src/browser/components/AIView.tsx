import React from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/common/lib/utils";
import type { RuntimeConfig } from "@/common/types/runtime";
import { ThinkingProvider } from "@/browser/contexts/ThinkingContext";
import { MinionModeAISync } from "@/browser/components/MinionModeAISync";
import { AgentProvider } from "@/browser/contexts/AgentContext";
import { BackgroundBashProvider } from "@/browser/contexts/BackgroundBashContext";
import { MinionShell } from "./MinionShell";

interface AIViewProps {
  minionId: string;
  projectPath: string;
  projectName: string;
  minionName: string;
  namedMinionPath: string; // User-friendly path for display and terminal
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebarCollapsed: () => void;
  runtimeConfig?: RuntimeConfig;
  className?: string;
  /** If set, minion is incompatible (from newer lattice version) and this error should be displayed */
  incompatibleRuntime?: string;
  /** True if minion is still being initialized (postCreateSetup or initMinion running) */
  isInitializing?: boolean;
}

/**
 * Incompatible minion error display.
 * Shown when a minion was created with a newer version of lattice.
 */
const IncompatibleMinionView: React.FC<{ message: string; className?: string }> = ({
  message,
  className,
}) => (
  <div className={cn("flex h-full w-full flex-col items-center justify-center p-8", className)}>
    <div className="max-w-md text-center">
      <div className="mb-4 flex justify-center">
        <AlertTriangle aria-hidden="true" className="text-warning h-10 w-10" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-[var(--color-text-primary)]">
        Incompatible Minion
      </h2>
      <p className="mb-4 text-[var(--color-text-secondary)]">{message}</p>
      <p className="text-sm text-[var(--color-text-tertiary)]">
        You can delete this minion and create a new one, or upgrade lattice to use it.
      </p>
    </div>
  </div>
);

// Wrapper component that provides the agent and thinking contexts
export const AIView: React.FC<AIViewProps> = (props) => {
  // Early return for incompatible minions - no hooks called in this path
  if (props.incompatibleRuntime) {
    return (
      <IncompatibleMinionView message={props.incompatibleRuntime} className={props.className} />
    );
  }

  return (
    <AgentProvider minionId={props.minionId} projectPath={props.projectPath}>
      <MinionModeAISync minionId={props.minionId} />
      <ThinkingProvider minionId={props.minionId}>
        <BackgroundBashProvider minionId={props.minionId}>
          <MinionShell {...props} />
        </BackgroundBashProvider>
      </ThinkingProvider>
    </AgentProvider>
  );
};
