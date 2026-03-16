/**
 * Simulation Tab — multi-agent prediction engine UI.
 *
 * Status-switch pattern (like ResearchTab):
 * - not_configured: Setup prompt
 * - initializing: Loading spinner
 * - ready: Scenario builder + past results
 * - running: Live timeline with streaming results
 * - error: Error state with retry
 */

import React, { useState, useCallback } from "react";
import {
  useSimulationStatus,
  useSimulationScenarios,
  useCreateScenario,
  useSimulationRun,
  useSimulationSetup,
  type SimulationRoundResult,
  type SimulationScenario,
} from "./useSimulation";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronRight,
  Database,
  Download,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Square,
  Users,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Departement presets for quick setup
// ---------------------------------------------------------------------------

const DEPARTMENT_PRESETS = [
  { id: "marketing", name: "Marketing", description: "Social media, content, brand advocacy simulations" },
  { id: "engineering", name: "Engineering", description: "Technical decisions, architecture, team dynamics" },
  { id: "sales", name: "Sales", description: "B2B pipeline, buyer committees, competitive deals" },
  { id: "strategy", name: "Strategy", description: "Market landscape, regulatory, competitive intelligence" },
  { id: "product", name: "Product", description: "User segments, feature adoption, migration paths" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Requirement Row (matches InferenceTab pattern)
// ---------------------------------------------------------------------------

const RequirementRow: React.FC<{
  label: string;
  ok: boolean;
  detail?: string;
}> = ({ label, ok, detail }) => (
  <div className="flex items-center gap-1.5 text-[11px]">
    {ok ? (
      <Check className="h-3 w-3 shrink-0 text-green-500" />
    ) : (
      <X className="h-3 w-3 shrink-0 text-red-500" />
    )}
    <span className="font-medium">{label}</span>
    {detail && (
      <span className="text-muted-foreground truncate">{detail}</span>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Not Configured View — setup wizard (matches Inference tab pattern)
// ---------------------------------------------------------------------------

const NotConfiguredView: React.FC = () => {
  const {
    setup,
    checking,
    checkSetup,
    startFalkorDb,
    startingFalkorDb,
    startError,
  } = useSimulationSetup();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <Download className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">
        Simulation Engine Setup
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Multi-agent prediction system with LLM-powered agents, social dynamics,
        and knowledge graphs. Check requirements below to get started.
      </p>

      {/* Requirements checklist */}
      {setup && (
        <div className="w-full max-w-sm space-y-2 mb-6 text-left">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
            System Requirements
          </h4>

          <RequirementRow
            label="LLM Provider"
            ok={setup.llmProviderConfigured}
            detail={
              setup.llmProviderConfigured
                ? "Configured"
                : "Configure a provider in Settings"
            }
          />

          <RequirementRow
            label="Docker"
            ok={setup.dockerAvailable}
            detail={
              setup.dockerAvailable
                ? "Available"
                : "Install Docker Desktop"
            }
          />

          <RequirementRow
            label="FalkorDB"
            ok={setup.graphDbConnected}
            detail={
              setup.graphDbConnected
                ? `Connected (${setup.graphDbHost}:${setup.graphDbPort})`
                : setup.falkorDbContainerRunning
                  ? "Container running, not connected"
                  : "Not running"
            }
          />

          <RequirementRow
            label="Graph DB Config"
            ok={setup.graphDbConfigured}
            detail={
              setup.graphDbConfigured
                ? `${setup.graphDbHost}:${setup.graphDbPort}`
                : "Not configured"
            }
          />
        </div>
      )}

      {/* Error message */}
      {startError && (
        <div className="w-full max-w-sm mb-4 p-2 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive text-left">
          {startError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => void checkSetup()}
          disabled={checking}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-muted text-foreground rounded-md hover:bg-muted/80 disabled:opacity-50"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Check Status
        </button>

        {setup && !setup.graphDbConnected && setup.dockerAvailable && (
          <button
            onClick={() => void startFalkorDb()}
            disabled={startingFalkorDb}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
          >
            {startingFalkorDb ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Database className="h-3.5 w-3.5" />
            )}
            Start FalkorDB
          </button>
        )}
      </div>

      {/* Help text */}
      {setup && !setup.dockerAvailable && (
        <p className="text-xs text-muted-foreground mt-4 max-w-sm">
          FalkorDB requires Docker. Install{" "}
          <span className="font-mono text-foreground/70">Docker Desktop</span>{" "}
          then click Check Status. Without FalkorDB, simulations run without
          graph-based agent memory.
        </p>
      )}

      {setup && setup.dockerAvailable && !setup.graphDbConnected && !setup.falkorDbContainerRunning && (
        <p className="text-xs text-muted-foreground mt-4 max-w-sm">
          Click <strong>Start FalkorDB</strong> to launch a Docker container, or
          run manually:{" "}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded font-mono">
            docker run -d -p {setup.graphDbPort}:6379 falkordb/falkordb
          </code>
        </p>
      )}
    </div>
  );
};

const InitializingView: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
    <p className="text-sm text-muted-foreground">Initializing simulation engine...</p>
  </div>
);

const ErrorView: React.FC<{ message: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
    <AlertCircle className="h-10 w-10 text-destructive/60 mb-3" />
    <h3 className="text-sm font-medium text-destructive mb-1">Simulation Error</h3>
    <p className="text-xs text-muted-foreground max-w-sm">{message}</p>
  </div>
);

// ---------------------------------------------------------------------------
// Scenario Builder
// ---------------------------------------------------------------------------

const ScenarioBuilder: React.FC<{
  onCreated: (scenario: SimulationScenario) => void;
}> = ({ onCreated }) => {
  const { createScenario, creating, error } = useCreateScenario();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("marketing");
  const [rounds, setRounds] = useState(10);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const scenario = await createScenario({
        name: name || "Untitled Simulation",
        description,
        seedDocuments: [],
        department,
        rounds,
      });
      if (scenario) {
        onCreated(scenario);
        setName("");
        setDescription("");
      }
    },
    [name, description, department, rounds, createScenario, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Scenario Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Q3 Product Launch Impact"
          className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          What do you want to simulate?
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the scenario, context, and what outcomes you want to predict..."
          rows={3}
          className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Department
          </label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {DEPARTMENT_PRESETS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Rounds
          </label>
          <input
            type="number"
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
            min={1}
            max={100}
            className="w-full px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={creating || !description.trim()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {creating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        Create Scenario
      </button>
    </form>
  );
};

// ---------------------------------------------------------------------------
// Round Timeline
// ---------------------------------------------------------------------------

const RoundTimeline: React.FC<{
  rounds: SimulationRoundResult[];
  running: boolean;
}> = ({ rounds, running }) => {
  const latestRound = rounds[rounds.length - 1];

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      {running && latestRound && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Round {latestRound.round}</span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(latestRound.round / Math.max(latestRound.round + 5, 10)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Sentiment summary */}
      {latestRound && (
        <div className="grid grid-cols-3 gap-2">
          <SentimentCard
            label="Positive"
            value={latestRound.sentimentDistribution.positive}
            color="text-green-500"
          />
          <SentimentCard
            label="Neutral"
            value={latestRound.sentimentDistribution.neutral}
            color="text-muted-foreground"
          />
          <SentimentCard
            label="Negative"
            value={latestRound.sentimentDistribution.negative}
            color="text-red-500"
          />
        </div>
      )}

      {/* Action feed */}
      <div className="max-h-[400px] overflow-y-auto space-y-1">
        {rounds
          .slice()
          .reverse()
          .slice(0, 50)
          .map((round, i) => (
            <div key={i} className="text-xs border-l-2 border-muted pl-3 py-1">
              <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                <Activity className="h-3 w-3" />
                <span className="font-medium">Round {round.round}</span>
                <span>-</span>
                <span>{round.actions.length} actions</span>
                {round.viralPosts.length > 0 && (
                  <span className="text-amber-500 font-medium">
                    - {round.viralPosts.length} viral
                  </span>
                )}
              </div>
              {round.actions.slice(0, 3).map((action, j) => (
                <div key={j} className="text-muted-foreground/80 truncate">
                  <span className="font-medium text-foreground/70">{action.agentName}</span>
                  {" "}
                  <span className="text-muted-foreground/60">{action.actionType}</span>
                  {action.content && (
                    <span className="text-muted-foreground/50">
                      {" — "}
                      {action.content.slice(0, 80)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
};

const SentimentCard: React.FC<{
  label: string;
  value: number;
  color: string;
}> = ({ label, value, color }) => (
  <div className="bg-muted/50 rounded-md p-2 text-center">
    <div className={`text-lg font-semibold ${color}`}>
      {(value * 100).toFixed(0)}%
    </div>
    <div className="text-xs text-muted-foreground">{label}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Scenario List
// ---------------------------------------------------------------------------

const ScenarioList: React.FC<{
  scenarios: SimulationScenario[];
  onSelect: (id: string) => void;
  selectedId?: string;
}> = ({ scenarios, onSelect, selectedId }) => {
  if (scenarios.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Scenarios
      </h4>
      {scenarios.map((s) => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
            selectedId === s.id
              ? "bg-accent text-accent-foreground"
              : "hover:bg-muted/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium truncate">{s.name}</span>
            <StatusBadge status={s.status} />
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {s.description}
          </p>
        </button>
      ))}
    </div>
  );
};

const STATUS_COLORS: Record<string, string> = {
  created: "bg-blue-500/20 text-blue-400",
  ready: "bg-green-500/20 text-green-400",
  running: "bg-amber-500/20 text-amber-400",
  completed: "bg-emerald-500/20 text-emerald-400",
  failed: "bg-red-500/20 text-red-400",
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span
    className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
      STATUS_COLORS[status] ?? "bg-muted text-muted-foreground"
    }`}
  >
    {status}
  </span>
);

// ---------------------------------------------------------------------------
// Main Tab
// ---------------------------------------------------------------------------

interface SimulationTabProps {
  minionId: string;
}

const SimulationTabComponent: React.FC<SimulationTabProps> = ({ minionId: _minionId }) => {
  const status = useSimulationStatus();
  const { scenarios, refresh } = useSimulationScenarios();
  const { rounds, running, error: runError, run, stop } = useSimulationRun();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);

  const handleCreated = useCallback(
    (scenario: SimulationScenario) => {
      setSelectedScenarioId(scenario.id);
      setShowBuilder(false);
      void refresh();
    },
    [refresh],
  );

  const handleRun = useCallback(
    (scenarioId: string) => {
      void run(scenarioId);
    },
    [run],
  );

  const handleStop = useCallback(
    (scenarioId: string) => {
      void stop(scenarioId);
    },
    [stop],
  );

  // Loading/null state
  if (!status) {
    return <InitializingView />;
  }

  // Status switch
  switch (status.status) {
    case "not_configured":
      return <NotConfiguredView />;
    case "initializing":
      return <InitializingView />;
    case "error":
      return <ErrorView message={status.message} />;
    case "running":
    case "ready":
      break;
  }

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-64 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            Simulations
          </h3>
          <button
            onClick={() => setShowBuilder(!showBuilder)}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="New scenario"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {status.status === "ready" && (
            <div className="mb-3 px-2 py-1 text-xs text-muted-foreground">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${
                  status.graphDbConnected ? "bg-green-500" : "bg-amber-500"
                }`}
              />
              Graph DB {status.graphDbConnected ? "connected" : "disconnected"}
            </div>
          )}

          <ScenarioList
            scenarios={scenarios}
            onSelect={setSelectedScenarioId}
            selectedId={selectedScenarioId ?? undefined}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4">
        {showBuilder ? (
          <div>
            <h3 className="text-sm font-medium mb-3">New Simulation Scenario</h3>
            <ScenarioBuilder onCreated={handleCreated} />
          </div>
        ) : selectedScenarioId ? (
          <div className="space-y-4">
            {/* Scenario header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">
                  {scenarios.find((s) => s.id === selectedScenarioId)?.name ?? "Scenario"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {scenarios.find((s) => s.id === selectedScenarioId)?.description}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {running ? (
                  <button
                    onClick={() => handleStop(selectedScenarioId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => handleRun(selectedScenarioId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run
                  </button>
                )}
              </div>
            </div>

            {/* Run error */}
            {runError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive">
                {runError}
              </div>
            )}

            {/* Timeline */}
            {rounds.length > 0 && (
              <RoundTimeline rounds={rounds} running={running} />
            )}

            {/* Empty state */}
            {!running && rounds.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Play className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  Click <strong>Run</strong> to start the simulation
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Multi-agent predictions will stream in real-time
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ChevronRight className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              Select a scenario or create a new one
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export const SimulationTab = React.memo(SimulationTabComponent);
