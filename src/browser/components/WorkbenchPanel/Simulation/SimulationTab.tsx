/**
 * Simulation Tab — fully enriched multi-agent prediction engine UI.
 *
 * Inspired by MiroFish: network graph, platform progress cards, live activity
 * feed with avatars, sentiment charts, trending topics, and simulation monitor.
 *
 * Layout:
 * ┌────────────────────────────────────────────────────────┐
 * │ Header: Title, scenario selector, status, run controls│
 * ├──────────────────┬──────────┬──────────────────────────┤
 * │                  │ Platform │                          │
 * │  Network Graph   │ Cards +  │   Activity Feed          │
 * │  (force-directed)│ Metrics  │   (social-style)         │
 * │                  │          │                          │
 * ├──────────────────┴──────────┴──────────────────────────┤
 * │ Simulation Monitor (console log)                       │
 * └────────────────────────────────────────────────────────┘
 */

import React, { useState, useCallback, useMemo } from "react";
import {
  useSimulationStatus,
  useSimulationScenarios,
  useCreateScenario,
  useSimulationRun,
  useSimulationSetup,
  useSimulationModels,
  useSimulationReport,
  type SimulationRoundResult,
  type SimulationScenario,
  type SimulationModelInfo,
} from "./useSimulation";
import { useSettings } from "@/browser/contexts/SettingsContext";
import { NetworkGraph, type GraphNode, type GraphEdge } from "./NetworkGraph";
import { ActivityFeed } from "./ActivityFeed";
import { SimulationMonitor, type MonitorEntry } from "./SimulationMonitor";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Database,
  Flame,
  Globe,
  Hash,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sliders,
  Square,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEPARTMENT_PRESETS = [
  { id: "marketing", name: "Marketing", description: "Social media, content, brand advocacy simulations" },
  { id: "engineering", name: "Engineering", description: "Technical decisions, architecture, team dynamics" },
  { id: "sales", name: "Sales", description: "B2B pipeline, buyer committees, competitive deals" },
  { id: "strategy", name: "Strategy", description: "Market landscape, regulatory, competitive intelligence" },
  { id: "product", name: "Product", description: "User segments, feature adoption, migration paths" },
];

const ROUTE_LABELS: Record<string, { label: string; description: string }> = {
  tier1_reasoning: { label: "Tier 1 — Reasoning", description: "Key decision-makers (highest quality)" },
  tier2_agents: { label: "Tier 2 — Agents", description: "Active participants (fast, high volume)" },
  tier3_agents: { label: "Tier 3 — Local", description: "Background actors (free, local inference)" },
  ontology: { label: "Ontology", description: "Knowledge graph extraction" },
  persona_generation: { label: "Persona Gen", description: "Agent profile creation" },
  report_react: { label: "Report (ReACT)", description: "Analysis report generation" },
  embeddings: { label: "Embeddings", description: "Semantic embeddings" },
  classification: { label: "Classification", description: "Content classification" },
};

// Platform icons/colors
const PLATFORM_CONFIG: Record<string, { icon: typeof Globe; color: string; bg: string }> = {
  forum: { icon: Globe, color: "text-blue-400", bg: "bg-blue-500/10" },
  chat: { icon: MessageSquare, color: "text-green-400", bg: "bg-green-500/10" },
  meeting: { icon: Users, color: "text-purple-400", bg: "bg-purple-500/10" },
  market: { icon: BarChart3, color: "text-amber-400", bg: "bg-amber-500/10" },
};

// ---------------------------------------------------------------------------
// Utility: Build graph data from simulation rounds
// ---------------------------------------------------------------------------

function buildGraphData(
  rounds: SimulationRoundResult[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const agentActions = new Map<string, { name: string; count: number; types: Set<string> }>();
  const interactions = new Map<string, { source: string; target: string; count: number; type: string }>();

  for (const round of rounds) {
    for (const action of round.actions) {
      if (action.actionType === "DO_NOTHING") continue;

      // Track agents
      const existing = agentActions.get(action.agentId);
      if (existing) {
        existing.count++;
        existing.types.add(action.actionType);
      } else {
        agentActions.set(action.agentId, {
          name: action.agentName,
          count: 1,
          types: new Set([action.actionType]),
        });
      }

      // Track interactions (agent → target)
      if (action.target) {
        const key = `${action.agentId}→${action.target}`;
        const existing = interactions.get(key);
        if (existing) {
          existing.count++;
        } else {
          interactions.set(key, {
            source: action.agentId,
            target: action.target,
            count: 1,
            type: action.actionType === "LIKE" ? "like" : action.actionType === "SHARE" ? "share" : "reply",
          });
        }
      }
    }
  }

  const nodes: GraphNode[] = Array.from(agentActions.entries()).map(([id, data]) => ({
    id,
    label: data.name,
    type: inferNodeType(data.name, data.count),
    size: Math.min(Math.max(data.count * 0.5, 3), 12),
  }));

  const edges: GraphEdge[] = Array.from(interactions.values()).map((i) => ({
    source: i.source,
    target: i.target,
    weight: Math.min(i.count, 5),
    type: i.type,
  }));

  return { nodes, edges };
}

function inferNodeType(name: string, actionCount: number): string {
  const lower = name.toLowerCase();
  if (lower.includes("exec") || lower.includes("ceo") || lower.includes("director")) return "tier1";
  if (lower.includes("influencer") || lower.includes("analyst")) return "tier2";
  if (actionCount > 10) return "tier2";
  if (actionCount > 3) return "tier3";
  return "tier4";
}

// ---------------------------------------------------------------------------
// Build monitor entries from rounds
// ---------------------------------------------------------------------------

function buildMonitorEntries(
  rounds: SimulationRoundResult[],
  running: boolean,
): MonitorEntry[] {
  const entries: MonitorEntry[] = [];

  for (const round of rounds) {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    // Platform actions summary
    const platformCounts = new Map<string, number>();
    for (const action of round.actions) {
      if (action.actionType !== "DO_NOTHING") {
        const p = action.platform ?? "unknown";
        const count = platformCounts.get(p) ?? 0;
        platformCounts.set(p, count + 1);
      }
    }

    for (const [platform, count] of platformCounts) {
      entries.push({
        timestamp: time,
        type: "action",
        message: `[${platform.charAt(0).toUpperCase() + platform.slice(1)}] R${round.round}/${rounds.length} | T:${round.simulatedHour}h | A:${count}`,
      });
    }

    // Graph update
    const totalNodes = round.activeAgentCount ?? round.actions.length;
    entries.push({
      timestamp: time,
      type: "graph",
      message: `Graph Update, Active Agents: ${totalNodes}, Simulation Progress: ${Math.round((round.round / Math.max(rounds.length, 1)) * 100)}%`,
    });

    // Viral posts
    for (const viral of round.viralPosts) {
      entries.push({
        timestamp: time,
        type: "viral",
        message: `Viral content detected: "${viral.content?.slice(0, 60) ?? "post"}..."`,
      });
    }
  }

  if (rounds.length > 0 && !running) {
    entries.push({
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type: "complete",
      message: "Simulation completed",
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Sub-components: Setup / Error views
// ---------------------------------------------------------------------------

const RequirementRow: React.FC<{ label: string; ok: boolean; detail?: string }> = ({ label, ok, detail }) => (
  <div className="flex items-center gap-1.5 text-[11px]">
    {ok ? <Check className="h-3 w-3 shrink-0 text-green-500" /> : <X className="h-3 w-3 shrink-0 text-red-500" />}
    <span className="font-medium">{label}</span>
    {detail && <span className="text-muted-foreground truncate">{detail}</span>}
  </div>
);

const NotConfiguredView: React.FC = () => {
  const { setup, checking, checkSetup, startFalkorDb, startingFalkorDb, startError } = useSimulationSetup();
  const { open: openSettings } = useSettings();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gradient-to-b from-background to-muted/20">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <Zap className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Simulation Engine
      </h3>
      <p className="text-sm text-muted-foreground max-w-md mb-6">
        Multi-agent prediction system with LLM-powered agents, social dynamics,
        network graph analysis, and knowledge graphs.
      </p>

      {setup && (
        <div className="w-full max-w-sm space-y-2 mb-6 text-left bg-card border border-border rounded-lg p-4">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            System Requirements
          </h4>
          <RequirementRow label="LLM Provider" ok={setup.llmProviderConfigured}
            detail={setup.llmProviderConfigured ? "Configured" : "Configure in Settings > Providers"} />
          <RequirementRow label="Docker" ok={setup.dockerAvailable}
            detail={setup.dockerAvailable ? "Available" : "Install Docker Desktop"} />
          <RequirementRow label="FalkorDB" ok={setup.graphDbConnected}
            detail={setup.graphDbConnected ? `Connected (${setup.graphDbHost}:${setup.graphDbPort})` :
              setup.falkorDbContainerRunning ? "Container running, not connected" : "Not running"} />
          <RequirementRow label="Graph DB Config" ok={setup.graphDbConfigured}
            detail={setup.graphDbConfigured ? `${setup.graphDbHost}:${setup.graphDbPort}` : "Not configured"} />
        </div>
      )}

      {startError && (
        <div className="w-full max-w-sm mb-4 p-2 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive text-left">
          {startError}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-center">
        <button onClick={() => openSettings("simulation")}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
          <Settings className="h-3.5 w-3.5" /> Configure
        </button>
        <button onClick={() => void checkSetup()} disabled={checking}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 transition-colors">
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Check Status
        </button>
        {setup && !setup.graphDbConnected && setup.dockerAvailable && (
          <button onClick={() => void startFalkorDb()} disabled={startingFalkorDb}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {startingFalkorDb ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
            Start FalkorDB
          </button>
        )}
      </div>
    </div>
  );
};

const InitializingView: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full p-8">
    <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
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
// Platform Progress Card
// ---------------------------------------------------------------------------

const PlatformCard: React.FC<{
  name: string;
  type: string;
  round: number;
  totalRounds: number;
  actionsCount: number;
  completed: boolean;
  elapsedHours: number;
}> = ({ name, type, round, totalRounds, actionsCount, completed, elapsedHours }) => {
  const config = PLATFORM_CONFIG[type] ?? PLATFORM_CONFIG.forum;
  const Icon = config.icon;
  const progress = totalRounds > 0 ? (round / totalRounds) * 100 : 0;

  return (
    <div className={`relative border border-border rounded-lg p-3 ${config.bg} overflow-hidden`}>
      {/* Completion check */}
      {completed && (
        <div className="absolute top-2 right-2">
          <Check className="h-4 w-4 text-green-400" />
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${config.color}`} />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{name}</span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-2">
        <span>
          <span className="text-foreground font-bold text-sm">{round}</span>
          <span className="text-muted-foreground/60">/{totalRounds}</span>
        </span>
        <span className="text-muted-foreground/40">|</span>
        <span>ELAPSED TIME <span className="text-foreground">{elapsedHours}h 0m</span></span>
        <span className="text-muted-foreground/40">|</span>
        <span>ACTS <span className="text-foreground font-medium">{actionsCount}</span></span>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-background/40 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 rounded-full ${completed ? "bg-green-400" : "bg-primary"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sentiment Distribution
// ---------------------------------------------------------------------------

const SentimentBar: React.FC<{
  positive: number;
  neutral: number;
  negative: number;
}> = ({ positive, neutral, negative }) => {
  const total = positive + neutral + negative || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted-foreground uppercase tracking-wider font-medium">Sentiment</span>
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-muted/50">
        <div className="bg-green-500/80 transition-all" style={{ width: `${(positive / total) * 100}%` }} />
        <div className="bg-slate-400/50 transition-all" style={{ width: `${(neutral / total) * 100}%` }} />
        <div className="bg-red-500/70 transition-all" style={{ width: `${(negative / total) * 100}%` }} />
      </div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-green-400">{(positive * 100).toFixed(0)}% positive</span>
        <span className="text-slate-400">{(neutral * 100).toFixed(0)}% neutral</span>
        <span className="text-red-400">{(negative * 100).toFixed(0)}% negative</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Metrics Cards Row
// ---------------------------------------------------------------------------

const MetricCard: React.FC<{
  label: string;
  value: string | number;
  icon: typeof Activity;
  color?: string;
}> = ({ label, value, icon: Icon, color = "text-primary" }) => (
  <div className="bg-card border border-border rounded-lg px-3 py-2">
    <div className="flex items-center gap-1.5 mb-0.5">
      <Icon className={`h-3 w-3 ${color}`} />
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
    <div className="text-lg font-bold text-foreground">{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Trending Topics
// ---------------------------------------------------------------------------

const TrendingTopics: React.FC<{ topics: string[] }> = ({ topics }) => {
  if (topics.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        <TrendingUp className="h-3 w-3" /> Trending
      </div>
      <div className="flex flex-wrap gap-1">
        {topics.slice(0, 8).map((topic, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-muted/60 rounded-full text-[10px] text-foreground/80">
            <Hash className="h-2.5 w-2.5 text-muted-foreground" />
            {topic}
          </span>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Model Routing Config (collapsible in sidebar)
// ---------------------------------------------------------------------------

const ModelRoutingConfig: React.FC = () => {
  const { models, currentRouting, loading, updateRoute } = useSimulationModels();
  const { open: openSettings } = useSettings();
  const [expanded, setExpanded] = useState(false);

  if (loading && models.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading models...
      </div>
    );
  }

  const modelsByProvider = models.reduce<Record<string, SimulationModelInfo[]>>(
    (acc, m) => { (acc[m.providerDisplayName] ??= []).push(m); return acc; }, {},
  );

  return (
    <div className="space-y-2">
      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full">
        <Sliders className="h-3.5 w-3.5" /> Model Routing
        <ChevronRight className={`h-3 w-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <span className="ml-auto text-[10px] text-muted-foreground/60">{models.length} models</span>
      </button>

      {expanded && (
        <div className="space-y-2 pl-1">
          <p className="text-[10px] text-muted-foreground mb-2">
            Choose which model handles each task.{" "}
            <button onClick={() => openSettings("providers")} className="text-primary hover:underline">Settings</button>
          </p>
          {Object.keys(ROUTE_LABELS).map((routeKey) => {
            const routeInfo = ROUTE_LABELS[routeKey];
            const current = currentRouting[routeKey];
            const currentModelId = current ? `${current.provider}:${current.model}` : "";
            return (
              <div key={routeKey} className="flex items-center gap-2">
                <div className="w-24 shrink-0">
                  <div className="text-[10px] font-medium truncate" title={routeInfo.description}>{routeInfo.label}</div>
                </div>
                <select value={currentModelId}
                  onChange={(e) => {
                    const [provider, ...modelParts] = e.target.value.split(":");
                    const model = modelParts.join(":");
                    if (provider && model) void updateRoute(routeKey, provider, model);
                  }}
                  className="flex-1 px-2 py-0.5 text-[10px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring min-w-0">
                  {!currentModelId && <option value="">Select...</option>}
                  {Object.entries(modelsByProvider).map(([providerName, providerModels]) => (
                    <optgroup key={providerName} label={providerName}>
                      {providerModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.modelId}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Scenario Builder (modal-style card)
// ---------------------------------------------------------------------------

const ScenarioBuilder: React.FC<{
  onCreated: (scenario: SimulationScenario) => void;
  onCancel: () => void;
}> = ({ onCreated, onCancel }) => {
  const { createScenario, creating, error } = useCreateScenario();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("marketing");
  const [rounds, setRounds] = useState(10);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
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
  }, [name, description, department, rounds, createScenario, onCreated]);

  return (
    <div className="bg-card border border-border rounded-xl p-6 max-w-lg mx-auto shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus className="h-4 w-4 text-primary" /> New Simulation
        </h3>
        <button onClick={onCancel} className="p-1 hover:bg-muted rounded transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Scenario Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q3 Product Launch Impact"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">What do you want to simulate?</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the scenario, context, and what outcomes you want to predict..."
            rows={3}
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Department</label>
            <select value={department} onChange={(e) => setDepartment(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring">
              {DEPARTMENT_PRESETS.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {d.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Rounds</label>
            <input type="number" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} min={1} max={100}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-2 pt-2">
          <button type="submit" disabled={creating || !description.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Create & Run
          </button>
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Scenario Sidebar Item
// ---------------------------------------------------------------------------

const ScenarioItem: React.FC<{
  scenario: SimulationScenario;
  selected: boolean;
  onSelect: () => void;
}> = ({ scenario, selected, onSelect }) => {
  const statusColors: Record<string, string> = {
    created: "bg-blue-500",
    ready: "bg-green-500",
    running: "bg-amber-500 animate-pulse",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  };

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
        selected ? "bg-accent text-accent-foreground shadow-sm" : "hover:bg-muted/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[scenario.status] ?? "bg-muted"}`} />
        <span className="text-[12px] font-medium truncate flex-1">{scenario.name}</span>
      </div>
      <p className="text-[10px] text-muted-foreground truncate mt-0.5 pl-4">
        {scenario.description}
      </p>
    </button>
  );
};

// ---------------------------------------------------------------------------
// Main Tab Component
// ---------------------------------------------------------------------------

interface SimulationTabProps {
  minionId: string;
}

const SimulationTabComponent: React.FC<SimulationTabProps> = ({ minionId: _minionId }) => {
  const status = useSimulationStatus();
  const { scenarios, refresh } = useSimulationScenarios();
  const { rounds, running, error: runError, run, stop } = useSimulationRun();
  const { report, generating: generatingReport, error: reportError, generate: generateReport } = useSimulationReport();
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [monitorExpanded, setMonitorExpanded] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [_selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const showEdgeLabels = false;

  const selectedScenario = scenarios.find((s) => s.id === selectedScenarioId);

  // Build graph data from rounds
  const graphData = useMemo(() => buildGraphData(rounds), [rounds]);

  // Build monitor entries
  const monitorEntries = useMemo(() => buildMonitorEntries(rounds, running), [rounds, running]);

  // Latest round data
  const latestRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;

  // Aggregate stats
  const totalActions = useMemo(() => {
    let count = 0;
    for (const r of rounds) {
      for (const a of r.actions) {
        if (a.actionType !== "DO_NOTHING") count++;
      }
    }
    return count;
  }, [rounds]);

  const totalViralPosts = useMemo(() =>
    rounds.reduce((sum, r) => sum + r.viralPosts.length, 0), [rounds]);

  // All trending topics across rounds
  const allTrending = useMemo(() => {
    const topics = new Set<string>();
    for (const r of rounds) {
      for (const t of r.trending ?? []) topics.add(t);
    }
    return Array.from(topics);
  }, [rounds]);

  const handleCreated = useCallback((scenario: SimulationScenario) => {
    setSelectedScenarioId(scenario.id);
    setShowBuilder(false);
    void refresh();
    // Auto-run after creation
    void run(scenario.id);
  }, [refresh, run]);

  const handleRun = useCallback((scenarioId: string) => void run(scenarioId), [run]);
  const handleStop = useCallback((scenarioId: string) => void stop(scenarioId), [stop]);

  // Loading/null state
  if (!status) return <InitializingView />;

  // Status switch
  switch (status.status) {
    case "not_configured": return <NotConfiguredView />;
    case "initializing": return <InitializingView />;
    case "error": return <ErrorView message={status.message} />;
    case "running":
    case "ready":
      break;
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* ── Header Bar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card/50">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {selectedScenario?.name ?? "Simulation Engine"}
            </h2>
            {selectedScenario && (
              <p className="text-[10px] text-muted-foreground truncate max-w-[300px]">
                {selectedScenario.description}
              </p>
            )}
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2 ml-4">
          <span className={`inline-block w-2 h-2 rounded-full ${
            running ? "bg-amber-400 animate-pulse" :
            rounds.length > 0 ? "bg-green-400" : "bg-slate-400"
          }`} />
          <span className="text-[10px] text-muted-foreground font-medium">
            {running ? "Running" : rounds.length > 0 ? "Completed" : "Ready"}
          </span>
          {status.status === "ready" && status.graphDbConnected && (
            <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
              <Database className="h-2.5 w-2.5" /> Graph DB
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Progress */}
          {running && latestRound && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">R{latestRound.round}</span>
              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all rounded-full"
                  style={{ width: `${Math.min((latestRound.round / (selectedScenario?.totalRounds ?? 10)) * 100, 100)}%` }} />
              </div>
            </div>
          )}

          {/* Run/Stop */}
          {selectedScenarioId && (
            running ? (
              <button onClick={() => handleStop(selectedScenarioId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/20 transition-colors">
                <Square className="h-3 w-3" /> Stop
              </button>
            ) : (
              <button onClick={() => handleRun(selectedScenarioId)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                <Play className="h-3 w-3" /> Run
              </button>
            )
          )}

          {/* New scenario */}
          <button onClick={() => setShowBuilder(true)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors">
            <Plus className="h-3 w-3" /> New
          </button>
        </div>
      </div>

      {/* ── Builder overlay ── */}
      {showBuilder && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-8">
          <ScenarioBuilder onCreated={handleCreated} onCancel={() => setShowBuilder(false)} />
        </div>
      )}

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Scenarios + Model Routing */}
        <div className="w-56 border-r border-border flex flex-col shrink-0 bg-card/30">
          <div className="p-2 border-b border-border">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
              Scenarios
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {scenarios.map((s) => (
              <ScenarioItem key={s.id} scenario={s} selected={selectedScenarioId === s.id}
                onSelect={() => setSelectedScenarioId(s.id)} />
            ))}
            {scenarios.length === 0 && (
              <div className="text-center py-8 text-xs text-muted-foreground/40">
                <Users className="h-6 w-6 mx-auto mb-2 opacity-30" />
                No scenarios yet
              </div>
            )}
          </div>
          <div className="border-t border-border p-2">
            <ModelRoutingConfig />
          </div>
        </div>

        {/* Main content: Graph + Metrics + Feed */}
        {selectedScenarioId ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Top Section: Metrics + Platform Cards ── */}
            {latestRound && (
              <div className="px-4 py-3 border-b border-border bg-card/20 space-y-3">
                {/* Metrics row */}
                <div className="grid grid-cols-4 gap-2">
                  <MetricCard label="Total Actions" value={totalActions} icon={Activity} color="text-blue-400" />
                  <MetricCard label="Active Agents" value={graphData.nodes.length} icon={Users} color="text-green-400" />
                  <MetricCard label="Viral Posts" value={totalViralPosts} icon={Flame} color="text-amber-400" />
                  <MetricCard label="Round" value={`${latestRound.round}/${selectedScenario?.totalRounds ?? "?"}`} icon={Hash} color="text-purple-400" />
                </div>

                {/* Platform progress cards */}
                {selectedScenario && (() => {
                  // Infer platforms from actions
                  const platformTypes = Array.from(
                    new Set(rounds.flatMap((r) => r.actions.map((a) => a.platform).filter(Boolean) as string[])),
                  );
                  if (platformTypes.length === 0) return null;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {platformTypes.map((type) => (
                        <PlatformCard
                          key={type}
                          name={type.charAt(0).toUpperCase() + type.slice(1)}
                          type={type}
                          round={latestRound.round}
                          totalRounds={selectedScenario.totalRounds ?? 10}
                          actionsCount={rounds.reduce((sum, r) => sum + r.actions.filter((a) => a.platform === type && a.actionType !== "DO_NOTHING").length, 0)}
                          completed={!running && latestRound.round >= (selectedScenario.totalRounds ?? 10)}
                          elapsedHours={latestRound.simulatedHour}
                        />
                      ))}
                    </div>
                  );
                })()}

                {/* Sentiment + Trending row */}
                <div className="grid grid-cols-2 gap-4">
                  <SentimentBar
                    positive={latestRound.sentimentDistribution.positive}
                    neutral={latestRound.sentimentDistribution.neutral}
                    negative={latestRound.sentimentDistribution.negative}
                  />
                  <TrendingTopics topics={allTrending} />
                </div>
              </div>
            )}

            {/* ── Bottom Section: Graph + Feed ── */}
            <div className="flex-1 flex overflow-hidden">
              {/* Network Graph */}
              <div className="flex-1 border-r border-border relative">
                {graphData.nodes.length > 0 ? (
                  <>
                    <div className="absolute top-2 left-2 z-10 text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm rounded px-2 py-1">
                      Agent Interaction Network
                      <span className="text-muted-foreground/50 ml-2">
                        {graphData.nodes.length} nodes · {graphData.edges.length} edges
                      </span>
                    </div>
                    <NetworkGraph
                      nodes={graphData.nodes}
                      edges={graphData.edges}
                      onNodeClick={setSelectedAgentId}
                      showEdgeLabels={showEdgeLabels}
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
                      <Play className="h-8 w-8 text-muted-foreground/20" />
                    </div>
                    <p className="text-sm text-muted-foreground">Click <strong>Run</strong> to start</p>
                    <p className="text-xs text-muted-foreground/50 mt-1">
                      Agent interactions will appear as a network graph
                    </p>
                  </div>
                )}
              </div>

              {/* Activity Feed */}
              <div className="w-[380px] shrink-0 flex flex-col">
                <ActivityFeed
                  rounds={rounds}
                  maxItems={150}
                  onAgentClick={setSelectedAgentId}
                />
              </div>
            </div>

            {/* Run error */}
            {runError && (
              <div className="px-4 py-2 bg-destructive/10 border-t border-destructive/20 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {runError}
              </div>
            )}

            {/* Generate Reports button + report display */}
            {!running && rounds.length > 0 && selectedScenarioId && (
              <div className="border-t border-border bg-card/30">
                {/* Report content */}
                {showReport && report?.markdownContent && (
                  <div className="px-4 py-3 max-h-[300px] overflow-y-auto">
                    <div className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed">
                      <pre className="whitespace-pre-wrap bg-muted/30 rounded-lg p-4 text-[11px]">
                        {report.markdownContent}
                      </pre>
                    </div>
                  </div>
                )}
                {reportError && (
                  <div className="px-4 py-2 text-xs text-destructive flex items-center gap-2">
                    <AlertCircle className="h-3 w-3" /> {reportError}
                  </div>
                )}
                <div className="px-4 py-2 flex items-center justify-between">
                  {report?.markdownContent && (
                    <button
                      onClick={() => setShowReport(!showReport)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showReport ? "Hide Report" : "Show Report"}
                    </button>
                  )}
                  <div className="ml-auto">
                    <button
                      onClick={() => {
                        void generateReport(selectedScenarioId);
                        setShowReport(true);
                      }}
                      disabled={generatingReport}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
                    >
                      {generatingReport ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {report?.status === "planning" ? "Planning Report..." : "Generating Report..."}
                        </>
                      ) : report?.markdownContent ? (
                        <>Regenerate Report <ArrowRight className="h-4 w-4" /></>
                      ) : (
                        <>Start Generating Results Reports <ArrowRight className="h-4 w-4" /></>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* No scenario selected */
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-muted/20 flex items-center justify-center mb-4">
              <ChevronRight className="h-10 w-10 text-muted-foreground/15" />
            </div>
            <p className="text-sm text-muted-foreground font-medium">Select a scenario</p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Or create a new one to start simulating
            </p>
            <button onClick={() => setShowBuilder(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> New Simulation
            </button>
          </div>
        )}
      </div>

      {/* ── Simulation Monitor ── */}
      <SimulationMonitor
        entries={monitorEntries}
        expanded={monitorExpanded}
        onToggle={() => setMonitorExpanded(!monitorExpanded)}
        simulationId={selectedScenarioId ?? undefined}
      />
    </div>
  );
};

export const SimulationTab = React.memo(SimulationTabComponent);
