import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Briefcase,
  Command as CommandIcon,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  Settings,
  Sparkles,
} from "lucide-react";
import { SplashScreen } from "./SplashScreen";
import { DocsLink } from "@/browser/components/DocsLink";
import { CliAgentWithIcon } from "@/browser/components/CliAgentIcon";
import {
  LatticeIcon,
  DockerIcon,
  LocalIcon,
  SSHIcon,
  WorktreeIcon,
} from "@/browser/components/icons/RuntimeIcons";
import {
  ProjectCreateForm,
  type ProjectCreateFormHandle,
} from "@/browser/components/ProjectCreateModal";
import { useProjectContext } from "@/browser/contexts/ProjectContext";
import { Button } from "@/browser/components/ui/button";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { updatePersistedState } from "@/browser/hooks/usePersistedState";
import { useCliAgentDetection } from "@/browser/hooks/useCliAgentDetection";
import { KEYBINDS, formatKeybind } from "@/browser/utils/ui/keybinds";
import { getAgentsInitNudgeKey } from "@/common/constants/storage";

const KBD_CLASSNAME =
  "bg-background-secondary text-foreground border-border-medium rounded border px-2 py-0.5 font-mono text-xs";

interface WizardStep {
  key: string;
  title: string;
  icon: React.ReactNode;
  body: React.ReactNode;
}
type Direction = "forward" | "back";

function ProgressDots(props: { count: number; activeIndex: number }) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`Step ${props.activeIndex + 1} of ${props.count}`}
    >
      {Array.from({ length: props.count }).map((_, i) => (
        <span
          key={`dot-${i}`}
          className={`h-1.5 w-1.5 rounded-full ${
            i === props.activeIndex ? "bg-accent" : "bg-border-medium"
          }`}
        />
      ))}
    </div>
  );
}

function WizardHeader(props: { stepIndex: number; totalSteps: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-muted text-xs">
        {props.stepIndex + 1} / {props.totalSteps}
      </span>
      <ProgressDots count={props.totalSteps} activeIndex={props.stepIndex} />
    </div>
  );
}

function Card(props: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-background-secondary border-border-medium rounded-lg border p-3 ${
        props.className ?? ""
      }`}
    >
      <div className="text-foreground flex items-center gap-2 text-sm font-medium">
        <span className="bg-accent/10 text-accent inline-flex h-7 w-7 items-center justify-center rounded-md">
          {props.icon}
        </span>
        {props.title}
      </div>
      <div className="text-muted mt-2 text-sm">{props.children}</div>
    </div>
  );
}

function CommandPalettePreview(props: { shortcut: string }) {
  return (
    <div
      className="font-primary overflow-hidden rounded-lg border border-[var(--color-command-border)] bg-[var(--color-command-surface)] text-[var(--color-command-foreground)]"
      aria-label="Command palette preview"
    >
      <div className="border-b border-[var(--color-command-input-border)] bg-[var(--color-command-input)] px-3.5 py-3 text-sm">
        <span className="text-[var(--color-command-subdued)]">
          Switch workspaces or type <span className="font-mono">&gt;</span> for all commands…
        </span>
      </div>

      <div className="px-1.5 py-2">
        <div className="px-2.5 py-1 text-[11px] tracking-[0.08em] text-[var(--color-command-subdued)] uppercase">
          Recent
        </div>

        <div className="hover:bg-hover mx-1 my-0.5 grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-3 py-2 text-[13px]">
          <div>
            Create New Workspace…
            <br />
            <span className="text-xs text-[var(--color-command-subdued)]">
              Start a new workspace (Local / Worktree / SSH / Docker)
            </span>
          </div>
          <span className="font-monospace text-[11px] text-[var(--color-command-subdued)]">
            &gt;new
          </span>
        </div>

        <div className="bg-hover mx-1 my-0.5 grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-3 py-2 text-[13px]">
          <div>
            Open Settings…
            <br />
            <span className="text-xs text-[var(--color-command-subdued)]">
              Jump to providers, models, MCP…
            </span>
          </div>
          <span className="font-monospace text-[11px] text-[var(--color-command-subdued)]">
            &gt;settings
          </span>
        </div>

        <div className="hover:bg-hover mx-1 my-0.5 grid grid-cols-[1fr_auto] items-center gap-2 rounded-md px-3 py-2 text-[13px]">
          <div>
            Help: Keybinds
            <br />
            <span className="text-xs text-[var(--color-command-subdued)]">
              Discover shortcuts for the whole app
            </span>
          </div>
          <span className="font-monospace text-[11px] text-[var(--color-command-subdued)]">
            {props.shortcut}
          </span>
        </div>
      </div>
    </div>
  );
}

export function OnboardingWizardSplash(props: { onDismiss: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);

  const { open: openSettings } = useSettings();
  const {
    agents,
    detectedAgents,
    loading: agentsLoading,
    refresh: refreshAgents,
  } = useCliAgentDetection();
  const { addProject, projects } = useProjectContext();

  const projectCreateFormRef = useRef<ProjectCreateFormHandle | null>(null);
  const [isProjectCreating, setIsProjectCreating] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);

  const [direction, setDirection] = useState<Direction>("forward");

  const [hasLoadedInitially, setHasLoadedInitially] = useState(false);

  useEffect(() => {
    if (hasLoadedInitially) return;
    if (!agentsLoading) {
      setHasLoadedInitially(true);
    }
  }, [agentsLoading, hasLoadedInitially]);

  const commandPaletteShortcut = formatKeybind(KEYBINDS.OPEN_COMMAND_PALETTE);
  const agentPickerShortcut = formatKeybind(KEYBINDS.TOGGLE_AGENT);
  const cycleAgentShortcut = formatKeybind(KEYBINDS.CYCLE_AGENT);

  const handleRescan = async () => {
    setIsRescanning(true);
    await refreshAgents();
    setIsRescanning(false);
  };

  const steps = useMemo((): WizardStep[] => {
    if (!hasLoadedInitially) {
      return [
        {
          key: "loading",
          title: "Getting started",
          icon: <Sparkles className="h-4 w-4" />,
          body: (
            <>
              <p>Scanning for installed providers…</p>
            </>
          ),
        },
      ];
    }

    const nextSteps: WizardStep[] = [];

    // Step 1: Provider Detection
    nextSteps.push({
      key: "providers",
      title: "Your Providers",
      icon: <Bot className="h-4 w-4" />,
      body: (
        <>
          <p>
            Lattice orchestrates your existing coding agents. Detected agents are automatically
            enabled — every model they support is available to you instantly.
          </p>

          {detectedAgents.length > 0 && (
            <p className="mt-2 text-xs">
              <span className="text-green-500 font-medium">
                {detectedAgents.length} agent{detectedAgents.length === 1 ? "" : "s"} detected
              </span>
              {" — "}
              <span className="text-muted">auto-enabled, no setup needed</span>
            </p>
          )}

          {/* Agent list */}
          <div className="mt-3 max-h-[280px] overflow-y-auto">
            <div className="space-y-1">
              {(agents ?? []).map((agent) => (
                <div
                  key={agent.slug}
                  className={`flex items-center justify-between rounded-md px-2.5 py-2 text-xs ${
                    agent.detected
                      ? "bg-background-secondary border-border-medium border"
                      : "hover:bg-background-secondary/50"
                  }`}
                >
                  <CliAgentWithIcon
                    slug={agent.slug}
                    displayName={agent.displayName}
                    className={`text-xs font-medium ${agent.detected ? "text-foreground" : "text-muted"}`}
                  />

                  <div className="flex items-center gap-2">
                    {agent.detected ? (
                      <>
                        <span className="flex items-center gap-1.5 text-[11px] text-green-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          Detected
                        </span>
                        <button
                          type="button"
                          className="text-muted hover:text-accent p-0.5 transition-colors"
                          onClick={() => openSettings("providers")}
                          title="Configure"
                        >
                          <Settings className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        {agent.installUrl && (
                          <a
                            href={agent.installUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted hover:text-accent flex items-center gap-1 p-0.5 text-[11px] transition-colors"
                            title={`Install ${agent.displayName}`}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <span className="flex items-center gap-1.5 text-[11px] text-muted">
                          <span className="bg-border-medium h-1.5 w-1.5 rounded-full" />
                          Not detected
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Rescan + Provider link */}
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              className="text-muted hover:text-accent flex items-center gap-1.5 text-xs transition-colors"
              onClick={() => void handleRescan()}
              disabled={isRescanning}
            >
              {isRescanning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {isRescanning ? "Scanning..." : "Rescan"}
            </button>

            <button
              type="button"
              className="text-muted hover:text-accent text-xs transition-colors"
              onClick={() => openSettings("providers")}
            >
              Manual API keys →
            </button>
          </div>
        </>
      ),
    });

    const projectStepIndex = nextSteps.length;

    nextSteps.push({
      key: "projects",
      title: "Add your first project",
      icon: <Briefcase className="h-4 w-4" />,
      body: (
        <>
          <p>
            Headquarters are the folders you want Lattice to work in. Choose one now, then click Next to
            add it.
          </p>

          {projects.size > 0 ? (
            <p className="mt-3 text-xs">
              <span className="text-foreground font-medium">Configured:</span> {projects.size}{" "}
              project
              {projects.size === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="mt-3 text-xs">No projects added yet.</p>
          )}

          <div className="mt-3">
            <ProjectCreateForm
              ref={projectCreateFormRef}
              autoFocus={projects.size === 0}
              hideFooter
              onIsCreatingChange={setIsProjectCreating}
              onSuccess={(normalizedPath, projectConfig) => {
                addProject(normalizedPath, projectConfig);
                updatePersistedState(getAgentsInitNudgeKey(normalizedPath), true);
                setDirection("forward");
                setStepIndex(projectStepIndex + 1);
              }}
            />
          </div>

          <p className="mt-2 text-xs">
            {projects.size > 0
              ? "Pick another folder to add, or leave this blank and click Next to continue."
              : "Click Next to add the project."}
          </p>
        </>
      ),
    });

    nextSteps.push({
      key: "agents",
      title: "Agents: Plan, Exec, and custom",
      icon: <Bot className="h-4 w-4" />,
      body: (
        <>
          <p>
            Agents are file-based definitions (system prompt + tool policy). You can create
            project-local agents in <code className="text-accent">.lattice/agents/*.md</code> or
            global agents in <code className="text-accent">~/.lattice/agents/*.md</code>.
          </p>

          <div className="mt-3 grid gap-2">
            <Card icon={<Sparkles className="h-4 w-4" />} title="Use Plan to design the spec">
              When the change is complex, switch to a plan-like agent first: write an explicit plan
              (files, steps, risks), then execute.
            </Card>

            <Card icon={<Bot className="h-4 w-4" />} title="Quick shortcuts">
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span>Agent picker</span>
                <kbd className={KBD_CLASSNAME}>{agentPickerShortcut}</kbd>
                <span className="text-muted mx-1">•</span>
                <span>Cycle agent</span>
                <kbd className={KBD_CLASSNAME}>{cycleAgentShortcut}</kbd>
              </div>
            </Card>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <DocsLink path="/agents">Agent docs</DocsLink>
            <DocsLink path="/agents/plan-mode">Plan mode</DocsLink>
          </div>
        </>
      ),
    });

    nextSteps.push({
      key: "runtimes",
      title: "Multiple runtimes",
      icon: <Boxes className="h-4 w-4" />,
      body: (
        <>
          <p>
            Each workspace can run in the environment that fits the job: keep it local, isolate with
            a git worktree, run remotely over SSH, or use a per-workspace Docker container.
          </p>

          <div className="mt-3 grid gap-2">
            <Card icon={<LocalIcon size={14} />} title="Local">
              Work directly in your project directory.
            </Card>
            <Card icon={<WorktreeIcon size={14} />} title="Worktree">
              Isolated git worktree under <code className="text-accent">~/.lattice/src</code>.
            </Card>
            <Card icon={<SSHIcon size={14} />} title="SSH">
              Remote clone and commands run on an SSH host.
            </Card>
            <Card icon={<LatticeIcon size={14} />} title="Lattice (SSH)">
              Use Lattice workspaces over SSH for a managed remote dev environment.
            </Card>
            <Card icon={<DockerIcon size={14} />} title="Docker">
              Isolated container per workspace.
            </Card>
          </div>

          <p className="mt-3">You can set a project default runtime in the workspace controls.</p>
        </>
      ),
    });

    nextSteps.push({
      key: "mcp",
      title: "MCP servers",
      icon: <Server className="h-4 w-4" />,
      body: (
        <>
          <p>
            MCP servers extend Lattice with tools (memory, ticketing, databases, internal APIs).
            Configure them per project and optionally override per workspace.
          </p>

          <div className="mt-3 grid gap-2">
            <Card icon={<Server className="h-4 w-4" />} title="Headquarter config">
              <code className="text-accent">.lattice/mcp.jsonc</code>
            </Card>
            <Card icon={<Server className="h-4 w-4" />} title="Workspace overrides">
              <code className="text-accent">.lattice/mcp.local.jsonc</code>
            </Card>
          </div>

          <p className="mt-3">
            Manage servers in <span className="text-foreground">Settings → Headquarters</span> or via{" "}
            <code className="text-accent">/mcp</code>.
          </p>
        </>
      ),
    });

    nextSteps.push({
      key: "palette",
      title: "Command palette",
      icon: <CommandIcon className="h-4 w-4" />,
      body: (
        <>
          <p>
            The command palette is the fastest way to navigate, create workspaces, and discover
            features.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-muted text-sm">Open command palette</span>
            <kbd className={KBD_CLASSNAME}>{commandPaletteShortcut}</kbd>
          </div>

          <div className="mt-3">
            <CommandPalettePreview shortcut={commandPaletteShortcut} />
          </div>

          <p className="mt-3">
            Tip: type <code className="text-accent">&gt;</code> for commands and{" "}
            <code className="text-accent">/</code> for slash commands.
          </p>
        </>
      ),
    });

    return nextSteps;
  }, [
    addProject,
    agentPickerShortcut,
    agents,
    commandPaletteShortcut,
    cycleAgentShortcut,
    detectedAgents.length,
    hasLoadedInitially,
    isRescanning,
    openSettings,
    projects.size,
  ]);

  useEffect(() => {
    setStepIndex((index) => Math.min(index, steps.length - 1));
  }, [steps.length]);

  const totalSteps = steps.length;
  const currentStep = steps[stepIndex] ?? steps[0];

  if (!currentStep) {
    return null;
  }

  const isLoading = !hasLoadedInitially;
  const canGoBack = !isLoading && stepIndex > 0;
  const canGoForward = !isLoading && stepIndex < totalSteps - 1;

  const goBack = () => {
    if (!canGoBack) {
      return;
    }
    setDirection("back");
    setStepIndex((i) => Math.max(0, i - 1));
  };

  const goForward = () => {
    if (!canGoForward) {
      return;
    }
    setDirection("forward");
    setStepIndex((i) => Math.min(totalSteps - 1, i + 1));
  };

  const isProjectStep = currentStep.key === "projects";

  const primaryLabel = isLoading ? "Next" : canGoForward ? "Next" : "Done";
  const primaryButtonLabel = isProjectStep && isProjectCreating ? "Adding..." : primaryLabel;
  const primaryDisabled = isLoading || (isProjectStep && isProjectCreating);

  return (
    <SplashScreen
      title={currentStep.title}
      onDismiss={props.onDismiss}
      dismissLabel={null}
      footerClassName="justify-between"
      footer={
        <>
          <div>
            {canGoBack && (
              <Button variant="secondary" onClick={goBack} className="min-w-24">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              className="min-w-24"
              onClick={() => {
                if (primaryDisabled) {
                  return;
                }

                if (isProjectStep) {
                  const form = projectCreateFormRef.current;
                  if (!form) {
                    goForward();
                    return;
                  }

                  const trimmedPath = form.getTrimmedPath();
                  if (!trimmedPath && projects.size > 0) {
                    goForward();
                    return;
                  }

                  void form.submit();
                  return;
                }

                if (canGoForward) {
                  goForward();
                  return;
                }

                props.onDismiss();
              }}
              disabled={primaryDisabled}
            >
              {primaryButtonLabel}
            </Button>

            <Button variant="secondary" onClick={props.onDismiss} className="min-w-24">
              Skip
            </Button>
          </div>
        </>
      }
    >
      <div className="text-muted flex flex-col gap-4">
        <WizardHeader stepIndex={stepIndex} totalSteps={totalSteps} />

        <div
          key={currentStep.key}
          className={`flex flex-col gap-3 ${
            direction === "forward"
              ? "animate-in fade-in-0 slide-in-from-right-2"
              : "animate-in fade-in-0 slide-in-from-left-2"
          }`}
        >
          <div className="text-foreground flex items-center gap-2 text-sm font-medium">
            <span className="bg-accent/10 text-accent inline-flex h-8 w-8 items-center justify-center rounded-md">
              {currentStep.icon}
            </span>
            <span>{currentStep.title}</span>
          </div>

          <div className="text-muted flex flex-col gap-3 text-sm">{currentStep.body}</div>
        </div>
      </div>
    </SplashScreen>
  );
}
