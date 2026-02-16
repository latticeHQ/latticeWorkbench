import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAPI } from "@/browser/contexts/API";
import { useWorkspaceContext } from "@/browser/contexts/WorkspaceContext";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/browser/components/ui/tooltip";
import { Input } from "@/browser/components/ui/input";
import { Switch } from "@/browser/components/ui/switch";
import { ModelSelector } from "@/browser/components/ModelSelector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/browser/components/ui/select";
import { copyToClipboard } from "@/browser/utils/clipboard";
import { useModelsFromSettings } from "@/browser/hooks/useModelsFromSettings";
import { updatePersistedState } from "@/browser/hooks/usePersistedState";
import { AGENT_AI_DEFAULTS_KEY } from "@/common/constants/storage";
import type { AgentDefinitionDescriptor } from "@/common/types/agentDefinition";
import {
  normalizeAgentAiDefaults,
  type AgentAiDefaults,
  type AgentAiDefaultsEntry,
} from "@/common/types/agentAiDefaults";
import {
  DEFAULT_TASK_SETTINGS,
  TASK_SETTINGS_LIMITS,
  normalizeTaskSettings,
  type TaskSettings,
} from "@/common/types/tasks";
import { THINKING_LEVELS, type ThinkingLevel } from "@/common/types/thinking";
import { enforceThinkingPolicy, getThinkingPolicyForModel } from "@/common/utils/thinking/policy";
import { ChevronRight, Copy, RotateCcw } from "lucide-react";

const INHERIT = "__inherit__";
const ALL_THINKING_LEVELS = THINKING_LEVELS;

const FALLBACK_AGENTS: AgentDefinitionDescriptor[] = [
  {
    id: "plan",
    scope: "built-in",
    name: "Plan",
    description: "Create a plan before coding",
    uiSelectable: true,
    subagentRunnable: false,
    base: "plan",
  },
  {
    id: "exec",
    scope: "built-in",
    name: "Exec",
    description: "Implement changes in the repository",
    uiSelectable: true,
    subagentRunnable: true,
  },
  {
    id: "compact",
    scope: "built-in",
    name: "Compact",
    description: "History compaction (internal)",
    uiSelectable: false,
    subagentRunnable: false,
  },
  {
    id: "explore",
    scope: "built-in",
    name: "Explore",
    description: "Read-only repository exploration",
    uiSelectable: false,
    subagentRunnable: true,
    base: "exec",
  },
];

function getAgentDefinitionPath(agent: AgentDefinitionDescriptor): string | null {
  switch (agent.scope) {
    case "project":
      return `.lattice/agents/${agent.id}.md`;
    case "global":
      return `~/.lattice/agents/${agent.id}.md`;
    default:
      return null;
  }
}

function updateAgentDefaultEntry(
  previous: AgentAiDefaults,
  agentId: string,
  update: (entry: AgentAiDefaultsEntry) => void
): AgentAiDefaults {
  const normalizedId = agentId.trim().toLowerCase();

  const next = { ...previous };
  const existing = next[normalizedId] ?? {};
  const updated: AgentAiDefaultsEntry = { ...existing };
  update(updated);

  if (updated.modelString && updated.thinkingLevel) {
    updated.thinkingLevel = enforceThinkingPolicy(updated.modelString, updated.thinkingLevel);
  }

  if (!updated.modelString && !updated.thinkingLevel) {
    delete next[normalizedId];
  } else {
    next[normalizedId] = updated;
  }

  return next;
}

function getToolsSummary(agent: AgentDefinitionDescriptor): string {
  const toolAdd = agent.tools?.add ?? [];
  const toolRemove = agent.tools?.remove ?? [];
  const count = toolAdd.length + toolRemove.length;
  if (count > 0) return `${count} rule${count > 1 ? "s" : ""}`;
  if (agent.base) return "inherited";
  return "—";
}

function areTaskSettingsEqual(a: TaskSettings, b: TaskSettings): boolean {
  return (
    a.maxParallelAgentTasks === b.maxParallelAgentTasks &&
    a.maxTaskNestingDepth === b.maxTaskNestingDepth &&
    a.proposePlanImplementReplacesChatHistory === b.proposePlanImplementReplacesChatHistory &&
    a.bashOutputCompactionMinLines === b.bashOutputCompactionMinLines &&
    a.bashOutputCompactionMinTotalBytes === b.bashOutputCompactionMinTotalBytes &&
    a.bashOutputCompactionMaxKeptLines === b.bashOutputCompactionMaxKeptLines &&
    a.bashOutputCompactionTimeoutMs === b.bashOutputCompactionTimeoutMs &&
    a.bashOutputCompactionHeuristicFallback === b.bashOutputCompactionHeuristicFallback
  );
}

function areAgentAiDefaultsEqual(a: AgentAiDefaults, b: AgentAiDefaults): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  aKeys.sort();
  bKeys.sort();

  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (key !== bKeys[i]) {
      return false;
    }

    const aEntry = a[key];
    const bEntry = b[key];
    if ((aEntry?.modelString ?? undefined) !== (bEntry?.modelString ?? undefined)) {
      return false;
    }
    if ((aEntry?.thinkingLevel ?? undefined) !== (bEntry?.thinkingLevel ?? undefined)) {
      return false;
    }
  }

  return true;
}

export function TasksSection() {
  const { api } = useAPI();
  const { selectedWorkspace } = useWorkspaceContext();

  const [taskSettings, setTaskSettings] = useState<TaskSettings>(DEFAULT_TASK_SETTINGS);
  const [agentAiDefaults, setAgentAiDefaults] = useState<AgentAiDefaults>({});

  const [agents, setAgents] = useState<AgentDefinitionDescriptor[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [agentsLoadFailed, setAgentsLoadFailed] = useState(false);

  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef<{
    taskSettings: TaskSettings;
    agentAiDefaults: AgentAiDefaults;
  } | null>(null);

  const { models, hiddenModels } = useModelsFromSettings();
  const lastSyncedTaskSettingsRef = useRef<TaskSettings | null>(null);
  const lastSyncedAgentAiDefaultsRef = useRef<AgentAiDefaults | null>(null);

  useEffect(() => {
    if (!api) return;

    setLoaded(false);
    setLoadFailed(false);
    setSaveError(null);

    void api.config
      .getConfig()
      .then((cfg) => {
        const normalizedTaskSettings = normalizeTaskSettings(cfg.taskSettings);
        setTaskSettings(normalizedTaskSettings);
        const normalizedAgentDefaults = normalizeAgentAiDefaults(cfg.agentAiDefaults);
        setAgentAiDefaults(normalizedAgentDefaults);
        updatePersistedState(AGENT_AI_DEFAULTS_KEY, normalizedAgentDefaults);

        setLoadFailed(false);
        lastSyncedTaskSettingsRef.current = normalizedTaskSettings;
        lastSyncedAgentAiDefaultsRef.current = normalizedAgentDefaults;

        setLoaded(true);
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : String(error));
        setLoadFailed(true);
        setLoaded(true);
      });
  }, [api]);

  useEffect(() => {
    if (!api) return;

    const projectPath = selectedWorkspace?.projectPath;
    const workspaceId = selectedWorkspace?.workspaceId;
    if (!projectPath) {
      setAgents([]);
      setAgentsLoaded(true);
      setAgentsLoadFailed(false);
      return;
    }

    let cancelled = false;
    setAgentsLoaded(false);
    setAgentsLoadFailed(false);

    void api.agents
      .list({ projectPath, workspaceId })
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        setAgentsLoadFailed(false);
        setAgentsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAgents([]);
        setAgentsLoadFailed(true);
        setAgentsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [api, selectedWorkspace?.projectPath, selectedWorkspace?.workspaceId]);

  useEffect(() => {
    if (!api) return;
    if (!loaded) return;
    if (loadFailed) return;

    pendingSaveRef.current = { taskSettings, agentAiDefaults };
    const lastTaskSettings = lastSyncedTaskSettingsRef.current;
    const lastAgentDefaults = lastSyncedAgentAiDefaultsRef.current;

    if (
      lastTaskSettings &&
      lastAgentDefaults &&
      areTaskSettingsEqual(lastTaskSettings, taskSettings) &&
      areAgentAiDefaultsEqual(lastAgentDefaults, agentAiDefaults)
    ) {
      pendingSaveRef.current = null;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      return;
    }

    // Keep agent defaults cache up-to-date for any syncers/non-react readers.
    updatePersistedState(AGENT_AI_DEFAULTS_KEY, agentAiDefaults);

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    saveTimerRef.current = setTimeout(() => {
      const flush = () => {
        if (savingRef.current) return;
        if (!api) return;

        const payload = pendingSaveRef.current;
        if (!payload) return;

        pendingSaveRef.current = null;
        savingRef.current = true;
        void api.config
          .saveConfig({
            taskSettings: payload.taskSettings,
            agentAiDefaults: payload.agentAiDefaults,
          })
          .then(() => {
            lastSyncedTaskSettingsRef.current = payload.taskSettings;
            lastSyncedAgentAiDefaultsRef.current = payload.agentAiDefaults;
            setSaveError(null);
          })
          .catch((error: unknown) => {
            setSaveError(error instanceof Error ? error.message : String(error));
          })
          .finally(() => {
            savingRef.current = false;
            flush();
          });
      };

      flush();
    }, 400);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [api, agentAiDefaults, loaded, loadFailed, taskSettings]);

  // Flush any pending debounced save on unmount so changes aren't lost.
  useEffect(() => {
    if (!api) return;
    if (!loaded) return;
    if (loadFailed) return;

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (savingRef.current) return;
      const payload = pendingSaveRef.current;
      if (!payload) return;

      pendingSaveRef.current = null;
      savingRef.current = true;
      void api.config
        .saveConfig({
          taskSettings: payload.taskSettings,
          agentAiDefaults: payload.agentAiDefaults,
        })
        .catch(() => undefined)
        .finally(() => {
          savingRef.current = false;
        });
    };
  }, [api, loaded, loadFailed]);

  const setMaxParallelAgentTasks = (rawValue: string) => {
    const parsed = Number(rawValue);
    setTaskSettings((prev) => normalizeTaskSettings({ ...prev, maxParallelAgentTasks: parsed }));
  };

  const setMaxTaskNestingDepth = (rawValue: string) => {
    const parsed = Number(rawValue);
    setTaskSettings((prev) => normalizeTaskSettings({ ...prev, maxTaskNestingDepth: parsed }));
  };

  const setProposePlanImplementReplacesChatHistory = (value: boolean) => {
    setTaskSettings((prev) =>
      normalizeTaskSettings({ ...prev, proposePlanImplementReplacesChatHistory: value })
    );
  };

  const setAgentModel = (agentId: string, value: string) => {
    setAgentAiDefaults((prev) =>
      updateAgentDefaultEntry(prev, agentId, (updated) => {
        if (value === INHERIT) {
          delete updated.modelString;
        } else {
          updated.modelString = value;
        }
      })
    );
  };

  const setAgentThinking = (agentId: string, value: string) => {
    setAgentAiDefaults((prev) =>
      updateAgentDefaultEntry(prev, agentId, (updated) => {
        if (value === INHERIT) {
          delete updated.thinkingLevel;
          return;
        }

        updated.thinkingLevel = value as ThinkingLevel;
      })
    );
  };

  const listedAgents = agents.length > 0 ? agents : FALLBACK_AGENTS;

  const uiAgents = useMemo(
    () =>
      [...listedAgents]
        .filter((agent) => agent.uiSelectable)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [listedAgents]
  );

  const subagents = useMemo(
    () =>
      [...listedAgents]
        .filter((agent) => agent.subagentRunnable && !agent.uiSelectable)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [listedAgents]
  );

  const internalAgents = useMemo(
    () =>
      [...listedAgents]
        .filter((agent) => !agent.uiSelectable && !agent.subagentRunnable)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [listedAgents]
  );

  const unknownAgentIds = useMemo(() => {
    const known = new Set(listedAgents.map((agent) => agent.id));
    return Object.keys(agentAiDefaults)
      .filter((id) => !known.has(id))
      .sort((a, b) => a.localeCompare(b));
  }, [agentAiDefaults, listedAgents]);

  const toggleAgent = (id: string) => {
    setExpandedAgent((prev) => (prev === id ? null : id));
  };

  // ── Expanded detail row for an agent ──
  const renderExpandedRow = (agentId: string, agent?: AgentDefinitionDescriptor) => {
    const entry = agentAiDefaults[agentId];
    const modelValue = entry?.modelString ?? INHERIT;
    const thinkingValue = entry?.thinkingLevel ?? INHERIT;
    const allowedThinkingLevels =
      modelValue !== INHERIT ? getThinkingPolicyForModel(modelValue) : ALL_THINKING_LEVELS;

    const agentDefinitionPath = agent ? getAgentDefinitionPath(agent) : null;
    const hasOverride = modelValue !== INHERIT || thinkingValue !== INHERIT;

    return (
      <tr key={`${agentId}-detail`}>
        <td colSpan={6} className="p-0">
          <div className="bg-background-secondary/20 border-t border-border-medium/50 px-4 py-2.5">
            <div className="ml-4 space-y-2.5">
              {/* Model row */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Model</span>
                <div className="flex items-center gap-2">
                  <ModelSelector
                    value={modelValue === INHERIT ? "" : modelValue}
                    emptyLabel="Inherit"
                    onChange={(value) => setAgentModel(agentId, value)}
                    models={models}
                    hiddenModels={hiddenModels}
                  />
                  {modelValue !== INHERIT ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="text-muted hover:text-foreground"
                          onClick={() => setAgentModel(agentId, INHERIT)}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="text-[11px]">Reset to inherit</TooltipContent>
                    </Tooltip>
                  ) : null}
                </div>
              </div>

              {/* Reasoning row */}
              <div className="flex items-center gap-3">
                <span className="text-muted w-20 shrink-0 text-[11px]">Reasoning</span>
                <Select
                  value={thinkingValue}
                  onValueChange={(value) => setAgentThinking(agentId, value)}
                >
                  <SelectTrigger className="border-border-medium bg-modal-bg h-6 w-32 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT} className="text-[11px]">
                      Inherit
                    </SelectItem>
                    {allowedThinkingLevels.map((level) => (
                      <SelectItem key={level} value={level} className="text-[11px]">
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {thinkingValue !== INHERIT ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted hover:text-foreground"
                        onClick={() => setAgentThinking(agentId, INHERIT)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="text-[11px]">Reset to inherit</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              {/* Agent file path */}
              {agentDefinitionPath ? (
                <div className="flex items-center gap-3">
                  <span className="text-muted w-20 shrink-0 text-[11px]">File</span>
                  <button
                    type="button"
                    className="text-muted hover:text-foreground flex items-center gap-1 bg-transparent p-0 text-[11px] font-mono"
                    onClick={() => void copyToClipboard(agentDefinitionPath)}
                  >
                    <code>{agentDefinitionPath}</code>
                    <Copy className="h-2.5 w-2.5 opacity-50" />
                  </button>
                </div>
              ) : null}

              {/* Tools detail */}
              {agent && (agent.tools?.add?.length || agent.tools?.remove?.length) ? (
                <div className="flex items-start gap-3">
                  <span className="text-muted w-20 shrink-0 text-[11px]">Tools</span>
                  <div className="flex flex-wrap gap-1">
                    {(agent.tools?.add ?? []).map((pattern) => (
                      <span
                        key={`add:${pattern}`}
                        className="bg-green-500/10 text-green-400 rounded px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        +{pattern}
                      </span>
                    ))}
                    {(agent.tools?.remove ?? []).map((pattern) => (
                      <span
                        key={`rm:${pattern}`}
                        className="bg-red-500/10 text-red-400 rounded px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        −{pattern}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Reset all overrides */}
              {hasOverride ? (
                <div className="flex items-center gap-3">
                  <span className="w-20 shrink-0" />
                  <button
                    type="button"
                    className="text-muted hover:text-foreground text-[10px] underline decoration-dotted underline-offset-2"
                    onClick={() => {
                      setAgentModel(agentId, INHERIT);
                      setAgentThinking(agentId, INHERIT);
                    }}
                  >
                    Reset all overrides
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // ── Table row for a single agent ──
  const renderAgentRow = (agent: AgentDefinitionDescriptor) => {
    const entry = agentAiDefaults[agent.id];
    const modelValue = entry?.modelString ?? INHERIT;
    const thinkingValue = entry?.thinkingLevel ?? INHERIT;
    const isExpanded = expandedAgent === agent.id;
    const hasOverride = modelValue !== INHERIT || thinkingValue !== INHERIT;

    return (
      <React.Fragment key={agent.id}>
        <tr
          className="hover:bg-background-secondary/30 cursor-pointer transition-colors"
          onClick={() => toggleAgent(agent.id)}
        >
          {/* Chevron + Name */}
          <td className="px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
              <span className="text-foreground text-[11px] font-medium">{agent.name}</span>
            </div>
          </td>
          {/* Scope */}
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px]">{agent.scope}</span>
          </td>
          {/* Base */}
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px] font-mono">{agent.base ?? "—"}</span>
          </td>
          {/* Model override */}
          <td className="px-2 py-1.5">
            {modelValue !== INHERIT ? (
              <span className="text-accent text-[10px] font-mono truncate max-w-[120px] block">
                {modelValue.split(":").pop()}
              </span>
            ) : (
              <span className="text-muted text-[10px]">inherit</span>
            )}
          </td>
          {/* Reasoning override */}
          <td className="px-2 py-1.5">
            {thinkingValue !== INHERIT ? (
              <span className="text-accent text-[10px]">{thinkingValue}</span>
            ) : (
              <span className="text-muted text-[10px]">inherit</span>
            )}
          </td>
          {/* Tools */}
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px]">{getToolsSummary(agent)}</span>
          </td>
        </tr>
        {isExpanded ? renderExpandedRow(agent.id, agent) : null}
      </React.Fragment>
    );
  };

  // ── Table row for unknown agent ──
  const renderUnknownAgentRow = (agentId: string) => {
    const entry = agentAiDefaults[agentId];
    const modelValue = entry?.modelString ?? INHERIT;
    const thinkingValue = entry?.thinkingLevel ?? INHERIT;
    const isExpanded = expandedAgent === agentId;

    return (
      <React.Fragment key={agentId}>
        <tr
          className="hover:bg-background-secondary/30 cursor-pointer transition-colors"
          onClick={() => toggleAgent(agentId)}
        >
          <td className="px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
              />
              <span className="text-foreground text-[11px] font-medium">{agentId}</span>
            </div>
          </td>
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px] italic">unknown</span>
          </td>
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px]">—</span>
          </td>
          <td className="px-2 py-1.5">
            {modelValue !== INHERIT ? (
              <span className="text-accent text-[10px] font-mono truncate max-w-[120px] block">
                {modelValue.split(":").pop()}
              </span>
            ) : (
              <span className="text-muted text-[10px]">inherit</span>
            )}
          </td>
          <td className="px-2 py-1.5">
            {thinkingValue !== INHERIT ? (
              <span className="text-accent text-[10px]">{thinkingValue}</span>
            ) : (
              <span className="text-muted text-[10px]">inherit</span>
            )}
          </td>
          <td className="px-2 py-1.5">
            <span className="text-muted text-[10px]">—</span>
          </td>
        </tr>
        {isExpanded ? renderExpandedRow(agentId) : null}
      </React.Fragment>
    );
  };

  // ── Category separator row ──
  const renderCategoryHeader = (label: string) => (
    <tr key={`cat-${label}`} className="bg-background-secondary/40">
      <td
        colSpan={6}
        className="px-3 py-1 text-[10px] font-semibold tracking-wide uppercase text-muted"
      >
        {label}
      </td>
    </tr>
  );

  // Determine which categories to show
  const hasMultipleCategories =
    [
      uiAgents.length > 0,
      subagents.length > 0,
      internalAgents.length > 0,
      unknownAgentIds.length > 0,
    ].filter(Boolean).length > 1;

  return (
    <div className="space-y-4">
      {/* ── Task Settings card ── */}
      <div className="border-border-medium rounded-md border">
        <div className="bg-background-secondary/40 border-b border-border-medium/50 px-3 py-1.5">
          <span className="text-[10px] font-semibold tracking-wide uppercase text-muted">
            Task Settings
          </span>
        </div>
        <div className="divide-y divide-border-medium/50">
          {/* Max Parallel */}
          <div className="flex items-center justify-between gap-4 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-[11px]">Max Parallel Tasks</div>
              <div className="text-muted text-[10px]">
                {TASK_SETTINGS_LIMITS.maxParallelAgentTasks.min}–
                {TASK_SETTINGS_LIMITS.maxParallelAgentTasks.max} (default{" "}
                {TASK_SETTINGS_LIMITS.maxParallelAgentTasks.default})
              </div>
            </div>
            <Input
              type="number"
              value={taskSettings.maxParallelAgentTasks}
              min={TASK_SETTINGS_LIMITS.maxParallelAgentTasks.min}
              max={TASK_SETTINGS_LIMITS.maxParallelAgentTasks.max}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMaxParallelAgentTasks(e.target.value)
              }
              className="border-border-medium bg-background-secondary h-7 w-20 text-[11px]"
            />
          </div>

          {/* Nesting Depth */}
          <div className="flex items-center justify-between gap-4 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-[11px]">Max Nesting Depth</div>
              <div className="text-muted text-[10px]">
                {TASK_SETTINGS_LIMITS.maxTaskNestingDepth.min}–
                {TASK_SETTINGS_LIMITS.maxTaskNestingDepth.max} (default{" "}
                {TASK_SETTINGS_LIMITS.maxTaskNestingDepth.default})
              </div>
            </div>
            <Input
              type="number"
              value={taskSettings.maxTaskNestingDepth}
              min={TASK_SETTINGS_LIMITS.maxTaskNestingDepth.min}
              max={TASK_SETTINGS_LIMITS.maxTaskNestingDepth.max}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setMaxTaskNestingDepth(e.target.value)
              }
              className="border-border-medium bg-background-secondary h-7 w-20 text-[11px]"
            />
          </div>

          {/* Plan: Implement replaces */}
          <div className="flex items-center justify-between gap-4 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-[11px]">Plan Implement replaces chat</div>
              <div className="text-muted text-[10px]">
                Clicking Implement clears history and shows the plan before Exec.
              </div>
            </div>
            <Switch
              checked={taskSettings.proposePlanImplementReplacesChatHistory ?? false}
              onCheckedChange={setProposePlanImplementReplacesChatHistory}
              aria-label="Toggle plan Implement replaces conversation with plan"
            />
          </div>
        </div>

        {saveError ? (
          <div className="text-danger-light border-t border-border-medium/50 px-3 py-1.5 text-[10px]">
            {saveError}
          </div>
        ) : null}
      </div>

      {/* ── Agents table ── */}
      <div className="border-border-medium rounded-md border">
        <div className="bg-background-secondary/40 flex items-center justify-between border-b border-border-medium/50 px-3 py-1.5">
          <span className="text-[10px] font-semibold tracking-wide uppercase text-muted">
            Agents
          </span>
          <span className="text-[10px] text-muted">
            {agentsLoadFailed
              ? "Failed to load"
              : !agentsLoaded
                ? "Loading…"
                : `${listedAgents.length} agent${listedAgents.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        <div className="text-muted px-3 py-1.5 text-[10px] border-b border-border-medium/50">
          Defaults apply globally. Per-agent model/reasoning overrides are set below.
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-border-medium/50">
              <th className="px-3 py-1 text-left text-[10px] font-medium text-muted">Agent</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Scope</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Base</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Model</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Reasoning</th>
              <th className="px-2 py-1 text-left text-[10px] font-medium text-muted">Tools</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-medium/30">
            {uiAgents.length > 0 ? (
              <>
                {hasMultipleCategories ? renderCategoryHeader("UI Agents") : null}
                {uiAgents.map(renderAgentRow)}
              </>
            ) : null}

            {subagents.length > 0 ? (
              <>
                {hasMultipleCategories ? renderCategoryHeader("Sub-agents") : null}
                {subagents.map(renderAgentRow)}
              </>
            ) : null}

            {internalAgents.length > 0 ? (
              <>
                {hasMultipleCategories ? renderCategoryHeader("Internal") : null}
                {internalAgents.map(renderAgentRow)}
              </>
            ) : null}

            {unknownAgentIds.length > 0 ? (
              <>
                {renderCategoryHeader("Unknown")}
                {unknownAgentIds.map(renderUnknownAgentRow)}
              </>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
