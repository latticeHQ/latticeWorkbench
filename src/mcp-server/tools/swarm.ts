/**
 * Swarm V2 — PARL-inspired Octopus Swarm Orchestrator
 *
 * Inspired by K2.5 Agent Swarm: self-directed, coordinated swarm execution
 * with dynamic role creation, parallel stages, critical path tracking,
 * and resource-aware scheduling for M3 Ultra / Mac Studio deployments.
 *
 * Architecture:
 *   Root Octopus (Orchestrator)
 *     └── Swarm Manager
 *           ├── Stage 1 (parallel)
 *           │     ├── Agent A (dynamically specialized)
 *           │     ├── Agent B (dynamically specialized)
 *           │     └── Agent C (dynamically specialized)
 *           ├── Stage 2 (depends on Stage 1)
 *           │     ├── Agent D (reuses A's workspace)
 *           │     └── Agent E (new specialist)
 *           └── Stage 3 (final merge)
 *                 └── Agent F (synthesizer)
 *
 * Key concepts:
 *   - No predefined roles — orchestrator creates specialists dynamically
 *   - Stages execute in parallel, with dependency tracking between stages
 *   - Critical path metric: total latency = max(stage latencies)
 *   - Agents can be reused, forked, or retired between stages
 *   - Resource-aware: tracks CPU/memory for M3 Ultra parallel capacity
 *   - **Persistent**: all state saved to ~/.lattice/swarm/ on every mutation
 */
import { z } from "zod";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

// ── Types ────────────────────────────────────────────────────────────

interface SwarmAgent {
  id: string;
  workspaceId: string;
  role: string;
  systemPrompt?: string;
  status: "idle" | "working" | "completed" | "failed" | "retired";
  spawnedAt: number;
  lastActiveAt: number;
  tasksCompleted: number;
  currentTaskId?: string;
}

interface SwarmTask {
  id: string;
  agentId: string;
  workspaceId: string;
  role: string;
  task: string;
  stage?: string;
  status: "queued" | "dispatched" | "running" | "completed" | "failed" | "timeout";
  priority: number;
  dispatchedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  dependsOn?: string[]; // Task IDs this depends on
  baselineMessageCount: number;
}

interface SwarmStage {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  taskIds: string[];
  dependsOn: string[]; // Stage IDs
  startedAt?: number;
  completedAt?: number;
  criticalPathMs?: number;
}

interface SwarmState {
  agents: Map<string, SwarmAgent>;
  tasks: Map<string, SwarmTask>;
  stages: Map<string, SwarmStage>;
  sharedMemory: Map<string, string>; // Key-value knowledge store shared across agents
  taskCounter: number;
  agentCounter: number;
  stageCounter: number;
  startedAt: number;
}

// ── Persistence layer ────────────────────────────────────────────────

const SWARM_DIR = path.join(os.homedir(), ".lattice", "swarm");
const STATE_FILE = path.join(SWARM_DIR, "state.json");
const MEMORY_FILE = path.join(SWARM_DIR, "memory.json");

interface SerializedSwarmState {
  agents: Array<[string, SwarmAgent]>;
  tasks: Array<[string, SwarmTask]>;
  stages: Array<[string, SwarmStage]>;
  taskCounter: number;
  agentCounter: number;
  stageCounter: number;
  startedAt: number;
}

function ensureSwarmDir(): void {
  if (!fs.existsSync(SWARM_DIR)) {
    fs.mkdirSync(SWARM_DIR, { recursive: true });
  }
}

function saveState(): void {
  try {
    ensureSwarmDir();

    const serialized: SerializedSwarmState = {
      agents: Array.from(swarm.agents.entries()),
      tasks: Array.from(swarm.tasks.entries()),
      stages: Array.from(swarm.stages.entries()),
      taskCounter: swarm.taskCounter,
      agentCounter: swarm.agentCounter,
      stageCounter: swarm.stageCounter,
      startedAt: swarm.startedAt,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(serialized, null, 2));

    // Shared memory in separate file (can be large)
    const memSerialized = Array.from(swarm.sharedMemory.entries());
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memSerialized, null, 2));
  } catch {
    // Non-fatal — log but don't crash
  }
}

function loadState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      const data = JSON.parse(raw) as SerializedSwarmState;

      swarm.agents = new Map(data.agents);
      swarm.tasks = new Map(data.tasks);
      swarm.stages = new Map(data.stages);
      swarm.taskCounter = data.taskCounter;
      swarm.agentCounter = data.agentCounter;
      swarm.stageCounter = data.stageCounter;
      swarm.startedAt = data.startedAt;

      // Mark any "running" tasks as "timeout" since we restarted
      for (const [, task] of swarm.tasks) {
        if (task.status === "running" || task.status === "dispatched") {
          task.status = "timeout";
          task.completedAt = Date.now();
          task.error = "Server restarted — task state lost";
        }
      }
      // Mark any "working" agents as "idle" since their tasks timed out
      for (const [, agent] of swarm.agents) {
        if (agent.status === "working") {
          agent.status = "idle";
          agent.currentTaskId = undefined;
        }
      }
      // Mark running stages as failed
      for (const [, stage] of swarm.stages) {
        if (stage.status === "running") {
          stage.status = "failed";
          stage.completedAt = Date.now();
        }
      }
    }

    if (fs.existsSync(MEMORY_FILE)) {
      const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
      const entries = JSON.parse(raw) as Array<[string, string]>;
      swarm.sharedMemory = new Map(entries);
    }
  } catch {
    // Corrupted state — start fresh
  }
}

// ── Initialize state ─────────────────────────────────────────────────

const swarm: SwarmState = {
  agents: new Map(),
  tasks: new Map(),
  stages: new Map(),
  sharedMemory: new Map(),
  taskCounter: 0,
  agentCounter: 0,
  stageCounter: 0,
  startedAt: Date.now(),
};

// Restore from disk on module load
loadState();

function genTaskId(): string {
  return `task-${(++swarm.taskCounter).toString().padStart(4, "0")}`;
}
function genAgentId(): string {
  return `agent-${(++swarm.agentCounter).toString().padStart(3, "0")}`;
}
function genStageId(): string {
  return `stage-${(++swarm.stageCounter).toString().padStart(2, "0")}`;
}

// ── Resource tracking ────────────────────────────────────────────────

function getSystemResources() {
  const cpus = os.cpus().length;
  const totalMemGB = os.totalmem() / 1024 ** 3;
  const freeMemGB = os.freemem() / 1024 ** 3;
  const usedMemGB = totalMemGB - freeMemGB;
  const activeAgents = Array.from(swarm.agents.values()).filter(
    (a) => a.status === "working"
  ).length;

  // Each Claude Code process uses ~2-4GB RAM
  const estimatedPerAgentGB = 3;
  const maxParallelAgents = Math.floor(freeMemGB / estimatedPerAgentGB);
  const canSpawnMore = activeAgents < maxParallelAgents;

  return {
    cpus,
    totalMemGB: +totalMemGB.toFixed(1),
    freeMemGB: +freeMemGB.toFixed(1),
    usedMemGB: +usedMemGB.toFixed(1),
    usedPercent: +((usedMemGB / totalMemGB) * 100).toFixed(1),
    activeAgents,
    maxParallelAgents,
    canSpawnMore,
    estimatedCapacity: maxParallelAgents - activeAgents,
  };
}

// ── Critical path calculation ────────────────────────────────────────

function calculateCriticalPath(): {
  totalMs: number;
  criticalStages: string[];
  parallelEfficiency: number;
} {
  const completedStages = Array.from(swarm.stages.values()).filter((s) => s.status === "completed");

  if (completedStages.length === 0) {
    return { totalMs: 0, criticalStages: [], parallelEfficiency: 0 };
  }

  // Critical path = longest chain of dependent stages
  let maxPathMs = 0;
  let criticalPath: string[] = [];

  function dfs(stageId: string, pathMs: number, path: string[]): void {
    const stage = swarm.stages.get(stageId);
    if (!stage || !stage.criticalPathMs) return;

    const currentMs = pathMs + stage.criticalPathMs;
    const currentPath = [...path, stageId];

    if (currentMs > maxPathMs) {
      maxPathMs = currentMs;
      criticalPath = currentPath;
    }

    // Find stages that depend on this one
    for (const [id, s] of swarm.stages) {
      if (s.dependsOn.includes(stageId) && s.status === "completed") {
        dfs(id, currentMs, currentPath);
      }
    }
  }

  // Start from root stages (no dependencies)
  for (const [id, stage] of swarm.stages) {
    if (stage.dependsOn.length === 0 && stage.status === "completed") {
      dfs(id, 0, []);
    }
  }

  // Sequential time = sum of all task durations
  const allTaskDurations = Array.from(swarm.tasks.values())
    .filter((t) => t.status === "completed" && t.completedAt)
    .map((t) => t.completedAt! - t.dispatchedAt);
  const sequentialMs = allTaskDurations.reduce((a, b) => a + b, 0);

  const parallelEfficiency = sequentialMs > 0 ? sequentialMs / Math.max(maxPathMs, 1) : 0;

  return {
    totalMs: maxPathMs,
    criticalStages: criticalPath,
    parallelEfficiency: +parallelEfficiency.toFixed(2),
  };
}

// ── Background task completion watcher ────────────────────────────────
// Uses waitForResponse (WS streaming with polling fallback) instead of
// raw polling for lower latency task completion detection.

async function pollTaskCompletion(client: WorkbenchClient, taskId: string): Promise<void> {
  const task = swarm.tasks.get(taskId);
  if (!task || task.status !== "running") return;

  try {
    const response = await client.waitForResponse(
      task.workspaceId,
      task.baselineMessageCount,
      600_000 // 10 min timeout for complex tasks
    );

    // Re-check task status (might have been cancelled)
    const currentTask = swarm.tasks.get(taskId);
    if (!currentTask || currentTask.status !== "running") return;

    if (response.startsWith("[Timeout")) {
      currentTask.status = "timeout";
      currentTask.completedAt = Date.now();
      currentTask.error = "Agent did not respond within 10 minutes";
    } else {
      currentTask.status = "completed";
      currentTask.completedAt = Date.now();
      currentTask.result = response;
    }

    // Update agent state
    const agent = swarm.agents.get(currentTask.agentId);
    if (agent) {
      agent.status = "idle";
      agent.lastActiveAt = Date.now();
      if (currentTask.status === "completed") agent.tasksCompleted++;
      agent.currentTaskId = undefined;
    }

    // Check if stage is complete
    if (currentTask.stage) {
      checkStageCompletion(currentTask.stage);
    }

    saveState();
  } catch {
    // Fatal error — mark task as failed
    const failedTask = swarm.tasks.get(taskId);
    if (failedTask && failedTask.status === "running") {
      failedTask.status = "timeout";
      failedTask.completedAt = Date.now();
      failedTask.error = "Response watcher failed";

      const agent = swarm.agents.get(failedTask.agentId);
      if (agent) {
        agent.status = "idle";
        agent.currentTaskId = undefined;
      }
      saveState();
    }
  }
}

function checkStageCompletion(stageId: string): void {
  const stage = swarm.stages.get(stageId);
  if (!stage || stage.status !== "running") return;

  const tasks = stage.taskIds.map((id) => swarm.tasks.get(id)).filter(Boolean) as SwarmTask[];

  const allDone = tasks.every(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "timeout"
  );

  if (allDone) {
    stage.status = tasks.some((t) => t.status === "completed") ? "completed" : "failed";
    stage.completedAt = Date.now();
    // Critical path for this stage = max task duration
    const durations = tasks
      .filter((t) => t.completedAt)
      .map((t) => t.completedAt! - t.dispatchedAt);
    stage.criticalPathMs = durations.length > 0 ? Math.max(...durations) : 0;

    saveState();
  }
}

// ── Register all swarm tools ─────────────────────────────────────────

export function registerSwarmTools(server: McpServer, client: WorkbenchClient): void {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AGENT LIFECYCLE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_spawn",
    `Create one or more workspace sub-agents dynamically. No predefined roles — YOU decide what specialists to create based on the task at hand.

Examples: spawn a "react-expert" to build UI, a "go-backend" for API, a "security-auditor" for review — all created on-the-fly.

The orchestrator should analyze the task, decompose it, then spawn exactly the specialists needed.`,
    {
      projectPath: z.string().describe("Headquarter path for workspaces"),
      agents: z
        .array(
          z.object({
            role: z
              .string()
              .describe("Dynamic role name you're creating (e.g., 'react-ui-specialist')"),
            systemPrompt: z
              .string()
              .optional()
              .describe("System prompt to specialize this agent's behavior"),
            title: z.string().optional().describe("Workspace title"),
          })
        )
        .describe("Specialists to spawn"),
      trunkBranch: z.string().optional().describe("Base branch"),
    },
    async ({ projectPath, agents, trunkBranch }) => {
      try {
        const resources = getSystemResources();

        if (agents.length > resources.estimatedCapacity + 5) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Warning: Requesting ${agents.length} agents but system estimates capacity for ~${resources.maxParallelAgents} parallel agents (${resources.freeMemGB}GB free RAM, ~3GB per agent).\nProceeding anyway — adjust if you hit memory pressure.`,
              },
            ],
          };
        }

        let trunk = trunkBranch;
        if (!trunk) {
          try {
            const branchInfo = await client.listBranches(projectPath);
            trunk = branchInfo.recommendedTrunk ?? "main";
          } catch {
            trunk = "main";
          }
        }

        const results: Array<{
          agentId: string;
          role: string;
          workspaceId: string;
          status: string;
        }> = [];

        const promises = agents.map(async (spec) => {
          const agentId = genAgentId();
          const branchName = `swarm-${spec.role.replace(/[^a-z0-9-]/gi, "-")}-${Date.now().toString(36)}`;
          const title = spec.title ?? `[swarm] ${spec.role}`;

          try {
            const result = await client.createWorkspace({
              projectPath,
              branchName,
              trunkBranch: trunk,
              title,
            });

            if (result.success && result.data?.metadata?.id) {
              const wsId = result.data.metadata.id;

              // Register agent
              const agent: SwarmAgent = {
                id: agentId,
                workspaceId: wsId,
                role: spec.role,
                systemPrompt: spec.systemPrompt,
                status: "idle",
                spawnedAt: Date.now(),
                lastActiveAt: Date.now(),
                tasksCompleted: 0,
              };
              swarm.agents.set(agentId, agent);

              // If system prompt provided, send it as the first message to prime the agent
              if (spec.systemPrompt) {
                try {
                  await client.sendMessage(
                    wsId,
                    `[SYSTEM] You are a specialized agent with role: ${spec.role}\n\n${spec.systemPrompt}\n\nAcknowledge your role briefly.`
                  );
                } catch {
                  // Non-fatal
                }
              }

              return { agentId, role: spec.role, workspaceId: wsId, status: "ready" };
            }
            return { agentId, role: spec.role, workspaceId: "", status: `failed: ${result.error}` };
          } catch (error) {
            return {
              agentId,
              role: spec.role,
              workspaceId: "",
              status: `error: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        });

        const settled = await Promise.all(promises);
        results.push(...settled);

        const ready = results.filter((r) => r.status === "ready");
        const failed = results.filter((r) => r.status !== "ready");

        saveState();

        const lines: string[] = [];
        lines.push(`Swarm: ${ready.length}/${agents.length} agents spawned`);
        lines.push(
          `System: ${resources.freeMemGB}GB free, ${resources.cpus} CPUs, ~${resources.estimatedCapacity} more agents possible\n`
        );

        for (const r of results) {
          const icon = r.status === "ready" ? "[OK]" : "[FAIL]";
          lines.push(`${icon} ${r.agentId} [${r.role}]: ${r.workspaceId || r.status}`);
        }

        if (ready.length > 0) {
          lines.push("");
          lines.push("Next: use swarm_dispatch or swarm_execute_stage to assign work.");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: failed.length > 0 && ready.length === 0,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Spawn failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Specialize an existing agent ───────────────────────────────────

  server.tool(
    "swarm_specialize",
    "Re-specialize an existing idle agent with a new role and system prompt. Reuses the workspace — no need to spawn a new one.",
    {
      agentId: z.string().describe("Agent ID to re-specialize"),
      newRole: z.string().describe("New role name"),
      systemPrompt: z.string().describe("New specialization instructions"),
    },
    async ({ agentId, newRole, systemPrompt }) => {
      const agent = swarm.agents.get(agentId);
      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent ${agentId} not found` }],
          isError: true,
        };
      }
      if (agent.status === "working") {
        return {
          content: [
            { type: "text" as const, text: `Agent ${agentId} is busy — wait or interrupt first` },
          ],
          isError: true,
        };
      }

      agent.role = newRole;
      agent.systemPrompt = systemPrompt;
      agent.status = "idle";

      // Send new specialization
      try {
        await client.sendMessage(
          agent.workspaceId,
          `[SYSTEM] Your role has changed. You are now: ${newRole}\n\n${systemPrompt}\n\nAcknowledge briefly.`
        );
      } catch {
        // Non-fatal
      }

      saveState();

      return {
        content: [
          { type: "text" as const, text: `Agent ${agentId} re-specialized as "${newRole}"` },
        ],
      };
    }
  );

  // ── Retire agent ───────────────────────────────────────────────────

  server.tool(
    "swarm_retire",
    "Retire an agent — marks it as done and optionally archives the workspace.",
    {
      agentId: z.string().describe("Agent ID to retire"),
      archive: z.boolean().optional().describe("Archive the workspace (default: true)"),
    },
    async ({ agentId, archive }) => {
      const agent = swarm.agents.get(agentId);
      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent ${agentId} not found` }],
          isError: true,
        };
      }

      agent.status = "retired";

      if (archive !== false) {
        try {
          await client.archiveWorkspace(agent.workspaceId);
        } catch {
          // Non-fatal
        }
      }

      saveState();

      return {
        content: [
          {
            type: "text" as const,
            text: `Agent ${agentId} [${agent.role}] retired. Completed ${agent.tasksCompleted} tasks.`,
          },
        ],
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TASK DISPATCH
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_dispatch",
    "Send a task to a specific agent. Returns immediately — agent works in background. Use swarm_status to monitor.",
    {
      agentId: z.string().describe("Agent ID to send task to"),
      task: z.string().describe("The task/instruction for this agent"),
      priority: z
        .number()
        .optional()
        .describe("Priority 1-10, higher = more important (default: 5)"),
    },
    async ({ agentId, task, priority }) => {
      try {
        const agent = swarm.agents.get(agentId);
        if (!agent) {
          return {
            content: [{ type: "text" as const, text: `Agent ${agentId} not found` }],
            isError: true,
          };
        }

        const taskId = genTaskId();

        // Get baseline
        let baselineCount = 0;
        try {
          const replay = (await client.getFullReplay(agent.workspaceId)) as unknown[];
          baselineCount = replay.length;
        } catch {}

        // Include shared memory context if available
        let taskMessage = task;
        if (swarm.sharedMemory.size > 0) {
          const memoryContext = Array.from(swarm.sharedMemory.entries())
            .map(([k, v]) => `[${k}]: ${v}`)
            .join("\n");
          taskMessage = `[SHARED CONTEXT]\n${memoryContext}\n\n[TASK]\n${task}`;
        }

        const sendResult = await client.sendMessage(agent.workspaceId, taskMessage);
        if (!sendResult.success) {
          const swarmTask: SwarmTask = {
            id: taskId,
            agentId,
            workspaceId: agent.workspaceId,
            role: agent.role,
            task,
            status: "failed",
            priority: priority ?? 5,
            dispatchedAt: Date.now(),
            error: sendResult.error,
            baselineMessageCount: baselineCount,
          };
          swarm.tasks.set(taskId, swarmTask);
          saveState();
          return {
            content: [{ type: "text" as const, text: `Dispatch failed: ${sendResult.error}` }],
            isError: true,
          };
        }

        const swarmTask: SwarmTask = {
          id: taskId,
          agentId,
          workspaceId: agent.workspaceId,
          role: agent.role,
          task,
          status: "running",
          priority: priority ?? 5,
          dispatchedAt: Date.now(),
          baselineMessageCount: baselineCount,
        };
        swarm.tasks.set(taskId, swarmTask);

        agent.status = "working";
        agent.currentTaskId = taskId;
        agent.lastActiveAt = Date.now();

        saveState();

        // Background poll
        pollTaskCompletion(client, taskId).catch(() => {});

        return {
          content: [
            {
              type: "text" as const,
              text: `Dispatched to ${agent.role} (${agentId})\nTask ID: ${taskId}\nStatus: running`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── Execute a parallel stage ───────────────────────────────────────

  server.tool(
    "swarm_execute_stage",
    `Execute a parallel stage — dispatch multiple tasks simultaneously, forming a logical group.

This is the core parallelism primitive. Each stage runs tasks concurrently.
Stages can depend on previous stages (tasks won't start until dependencies complete).

Think of it like K2.5 PARL: decompose into parallelizable subtasks, execute concurrently, minimize critical path.`,
    {
      name: z.string().describe("Stage name (e.g., 'implementation', 'testing', 'review')"),
      tasks: z
        .array(
          z.object({
            agentId: z.string().describe("Agent to assign this task to"),
            task: z.string().describe("Task instruction"),
          })
        )
        .describe("Tasks to execute in parallel within this stage"),
      dependsOnStages: z
        .array(z.string())
        .optional()
        .describe("Stage IDs that must complete first"),
    },
    async ({ name, tasks, dependsOnStages }) => {
      try {
        const stageId = genStageId();
        const deps = dependsOnStages ?? [];

        // Check dependencies
        for (const depId of deps) {
          const depStage = swarm.stages.get(depId);
          if (!depStage) {
            return {
              content: [{ type: "text" as const, text: `Dependency stage ${depId} not found` }],
              isError: true,
            };
          }
          if (depStage.status !== "completed") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Dependency stage ${depId} not yet complete (status: ${depStage.status})`,
                },
              ],
              isError: true,
            };
          }
        }

        const stage: SwarmStage = {
          id: stageId,
          name,
          status: "running",
          taskIds: [],
          dependsOn: deps,
          startedAt: Date.now(),
        };

        // Dispatch all tasks in parallel
        const results: Array<{ taskId: string; agentId: string; role: string; status: string }> =
          [];

        const promises = tasks.map(async (t) => {
          const agent = swarm.agents.get(t.agentId);
          if (!agent) {
            return { taskId: "", agentId: t.agentId, role: "unknown", status: "agent not found" };
          }

          const taskId = genTaskId();
          stage.taskIds.push(taskId);

          let baselineCount = 0;
          try {
            const replay = (await client.getFullReplay(agent.workspaceId)) as unknown[];
            baselineCount = replay.length;
          } catch {}

          // Include shared memory
          let taskMessage = t.task;
          if (swarm.sharedMemory.size > 0) {
            const memCtx = Array.from(swarm.sharedMemory.entries())
              .map(([k, v]) => `[${k}]: ${v}`)
              .join("\n");
            taskMessage = `[SHARED CONTEXT]\n${memCtx}\n\n[TASK]\n${t.task}`;
          }

          const sendResult = await client.sendMessage(agent.workspaceId, taskMessage);

          const swarmTask: SwarmTask = {
            id: taskId,
            agentId: t.agentId,
            workspaceId: agent.workspaceId,
            role: agent.role,
            task: t.task,
            stage: stageId,
            status: sendResult.success ? "running" : "failed",
            priority: 5,
            dispatchedAt: Date.now(),
            error: sendResult.success ? undefined : sendResult.error,
            baselineMessageCount: baselineCount,
          };
          swarm.tasks.set(taskId, swarmTask);

          if (sendResult.success) {
            agent.status = "working";
            agent.currentTaskId = taskId;
            agent.lastActiveAt = Date.now();
            pollTaskCompletion(client, taskId).catch(() => {});
          }

          return { taskId, agentId: t.agentId, role: agent.role, status: swarmTask.status };
        });

        const settled = await Promise.all(promises);
        results.push(...settled);

        swarm.stages.set(stageId, stage);
        saveState();

        const running = results.filter((r) => r.status === "running");
        const lines: string[] = [];
        lines.push(
          `Stage "${name}" (${stageId}): ${running.length}/${tasks.length} tasks launched`
        );
        if (deps.length > 0) lines.push(`   Dependencies: ${deps.join(", ")}`);
        lines.push("");

        for (const r of results) {
          const icon = r.status === "running" ? "[RUN]" : "[FAIL]";
          lines.push(`${icon} ${r.taskId} -> ${r.role} (${r.agentId}): ${r.status}`);
        }

        lines.push("");
        lines.push("Use swarm_status for live monitoring, swarm_collect to wait for results.");

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Stage execution failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MONITORING & COLLECTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_status",
    "Full swarm dashboard — agents, tasks, stages, resource usage, critical path metrics. The control center.",
    {},
    async () => {
      const agents = Array.from(swarm.agents.values());
      const tasks = Array.from(swarm.tasks.values());
      const stages = Array.from(swarm.stages.values());
      const resources = getSystemResources();
      const criticalPath = calculateCriticalPath();

      const working = agents.filter((a) => a.status === "working");
      const idle = agents.filter((a) => a.status === "idle");
      const retired = agents.filter((a) => a.status === "retired");

      const runningTasks = tasks.filter((t) => t.status === "running");
      const completedTasks = tasks.filter((t) => t.status === "completed");
      const failedTasks = tasks.filter((t) => t.status === "failed" || t.status === "timeout");

      const lines: string[] = [];

      lines.push("=== OCTOPUS SWARM DASHBOARD ===");
      lines.push("");

      // Resources
      lines.push(
        `SYSTEM: ${resources.cpus} CPUs | ${resources.totalMemGB}GB RAM (${resources.usedPercent}% used)`
      );
      lines.push(
        `   Free: ${resources.freeMemGB}GB | Capacity: ~${resources.maxParallelAgents} parallel agents`
      );
      lines.push("");

      // Agents
      lines.push(
        `AGENTS: ${working.length} working, ${idle.length} idle, ${retired.length} retired (${agents.length} total)`
      );
      for (const a of [...working, ...idle]) {
        const statusIcon = a.status === "working" ? "[BUSY]" : "[IDLE]";
        const elapsed = a.currentTaskId
          ? `${Math.round((Date.now() - a.lastActiveAt) / 1000)}s`
          : "";
        lines.push(
          `   ${statusIcon} ${a.id} [${a.role}] ${a.status} ${elapsed} (${a.tasksCompleted} tasks done)`
        );
      }
      lines.push("");

      // Stages
      if (stages.length > 0) {
        lines.push(`STAGES:`);
        for (const s of stages) {
          const icon =
            s.status === "completed"
              ? "[DONE]"
              : s.status === "running"
                ? "[RUN]"
                : s.status === "failed"
                  ? "[FAIL]"
                  : "[WAIT]";
          const duration =
            s.completedAt && s.startedAt
              ? `${Math.round((s.completedAt - s.startedAt) / 1000)}s`
              : s.startedAt
                ? `${Math.round((Date.now() - s.startedAt) / 1000)}s...`
                : "";
          lines.push(
            `   ${icon} ${s.id} "${s.name}" — ${s.status} ${duration} (${s.taskIds.length} tasks)`
          );
        }
        lines.push("");
      }

      // Tasks summary
      lines.push(
        `TASKS: ${runningTasks.length} running, ${completedTasks.length} done, ${failedTasks.length} failed`
      );

      if (runningTasks.length > 0) {
        lines.push("   Running:");
        for (const t of runningTasks) {
          const elapsed = Math.round((Date.now() - t.dispatchedAt) / 1000);
          lines.push(`   [RUN] ${t.id} [${t.role}] — ${elapsed}s: ${t.task.slice(0, 80)}...`);
        }
      }
      lines.push("");

      // Critical Path
      if (criticalPath.totalMs > 0) {
        lines.push(`CRITICAL PATH: ${Math.round(criticalPath.totalMs / 1000)}s`);
        lines.push(
          `   Parallel efficiency: ${criticalPath.parallelEfficiency}x speedup vs sequential`
        );
        if (criticalPath.criticalStages.length > 0) {
          lines.push(`   Bottleneck stages: ${criticalPath.criticalStages.join(" -> ")}`);
        }
      }

      // Shared memory
      if (swarm.sharedMemory.size > 0) {
        lines.push("");
        lines.push(`SHARED MEMORY: ${swarm.sharedMemory.size} entries`);
        for (const [key] of swarm.sharedMemory) {
          lines.push(`   - ${key}`);
        }
      }

      // Persistence info
      lines.push("");
      lines.push(
        `PERSISTENCE: ${fs.existsSync(STATE_FILE) ? "state.json saved" : "not persisted"} | ${fs.existsSync(MEMORY_FILE) ? "memory.json saved" : "no memory file"}`
      );

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ── Collect results ────────────────────────────────────────────────

  server.tool(
    "swarm_collect",
    "Wait for tasks/stages to complete and return results. Blocks until done or timeout.",
    {
      stageId: z.string().optional().describe("Wait for a specific stage to complete"),
      taskIds: z.array(z.string()).optional().describe("Wait for specific tasks"),
      timeoutMs: z.number().optional().describe("Max wait time (default: 600000 = 10 min)"),
    },
    async ({ stageId, taskIds, timeoutMs }) => {
      const timeout = timeoutMs ?? 600_000;
      const startTime = Date.now();

      // Determine what to wait for
      let targetTaskIds: string[];

      if (stageId) {
        const stage = swarm.stages.get(stageId);
        if (!stage)
          return {
            content: [{ type: "text" as const, text: `Stage ${stageId} not found` }],
            isError: true,
          };
        targetTaskIds = stage.taskIds;
      } else if (taskIds) {
        targetTaskIds = taskIds;
      } else {
        // All running tasks
        targetTaskIds = Array.from(swarm.tasks.entries())
          .filter(([, t]) => t.status === "running" || t.status === "dispatched")
          .map(([id]) => id);
      }

      if (targetTaskIds.length === 0) {
        return { content: [{ type: "text" as const, text: "No running tasks to collect." }] };
      }

      // Poll until done
      while (Date.now() - startTime < timeout) {
        const allDone = targetTaskIds.every((id) => {
          const task = swarm.tasks.get(id);
          return (
            task &&
            (task.status === "completed" || task.status === "failed" || task.status === "timeout")
          );
        });
        if (allDone) break;
        await new Promise((r) => setTimeout(r, 3000));
      }

      // Mark stragglers as timeout
      for (const id of targetTaskIds) {
        const task = swarm.tasks.get(id);
        if (task && (task.status === "running" || task.status === "dispatched")) {
          task.status = "timeout";
          task.completedAt = Date.now();
          task.error = "Collection timeout";
        }
      }

      saveState();

      // Build results
      const lines: string[] = [];
      const collected = targetTaskIds
        .map((id) => swarm.tasks.get(id))
        .filter(Boolean) as SwarmTask[];
      const completed = collected.filter((t) => t.status === "completed");
      const failed = collected.filter((t) => t.status !== "completed");

      lines.push(
        `Collected ${completed.length}/${collected.length} results${stageId ? ` (stage: ${stageId})` : ""}\n`
      );

      for (const t of collected) {
        const icon = t.status === "completed" ? "[OK]" : "[FAIL]";
        const duration = t.completedAt
          ? `${Math.round((t.completedAt - t.dispatchedAt) / 1000)}s`
          : "?";
        lines.push(`${icon} ${t.id} [${t.role}] — ${t.status} (${duration})`);
        if (t.result) {
          lines.push(`Result:\n${t.result}\n`);
        }
        if (t.error) {
          lines.push(`Error: ${t.error}\n`);
        }
        lines.push("---");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        isError: failed.length > 0 && completed.length === 0,
      };
    }
  );

  // ── Get task details ───────────────────────────────────────────────

  server.tool(
    "swarm_get_task",
    "Get full details and result of a specific task.",
    { taskId: z.string() },
    async ({ taskId }) => {
      const task = swarm.tasks.get(taskId);
      if (!task)
        return {
          content: [{ type: "text" as const, text: `Task ${taskId} not found` }],
          isError: true,
        };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                ...task,
                elapsed: task.completedAt
                  ? `${Math.round((task.completedAt - task.dispatchedAt) / 1000)}s`
                  : `${Math.round((Date.now() - task.dispatchedAt) / 1000)}s (running)`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SHARED MEMORY — agents share knowledge across the swarm
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_memory_set",
    "Store a key-value entry in shared swarm memory. All agents receive shared memory as context when they get dispatched tasks.",
    {
      key: z
        .string()
        .describe("Memory key (e.g., 'api-schema', 'design-decisions', 'test-results')"),
      value: z.string().describe("The value/content to store"),
    },
    async ({ key, value }) => {
      swarm.sharedMemory.set(key, value);
      saveState();
      return {
        content: [
          {
            type: "text" as const,
            text: `Stored in shared memory: "${key}" (${value.length} chars)\n${swarm.sharedMemory.size} total entries`,
          },
        ],
      };
    }
  );

  server.tool(
    "swarm_memory_get",
    "Retrieve an entry from shared swarm memory.",
    {
      key: z.string().optional().describe("Key to retrieve (omit for all entries)"),
    },
    async ({ key }) => {
      if (key) {
        const value = swarm.sharedMemory.get(key);
        if (!value)
          return {
            content: [{ type: "text" as const, text: `Key "${key}" not found in shared memory` }],
            isError: true,
          };
        return { content: [{ type: "text" as const, text: `${key}:\n${value}` }] };
      }

      // All entries
      if (swarm.sharedMemory.size === 0) {
        return { content: [{ type: "text" as const, text: "Shared memory is empty." }] };
      }

      const lines = Array.from(swarm.sharedMemory.entries()).map(
        ([k, v]) => `${k}: ${v.slice(0, 200)}${v.length > 200 ? "..." : ""}`
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Shared Memory (${swarm.sharedMemory.size} entries):\n\n${lines.join("\n\n")}`,
          },
        ],
      };
    }
  );

  server.tool(
    "swarm_memory_delete",
    "Delete an entry from shared swarm memory.",
    { key: z.string() },
    async ({ key }) => {
      const deleted = swarm.sharedMemory.delete(key);
      saveState();
      return {
        content: [
          {
            type: "text" as const,
            text: deleted ? `Deleted "${key}" from shared memory.` : `Key "${key}" not found.`,
          },
        ],
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // RESOURCE MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_resources",
    "Check system resource usage and parallel capacity. Essential for M3 Ultra / Mac Studio deployments — know how many more agents you can spawn.",
    {},
    async () => {
      const r = getSystemResources();

      const lines: string[] = [];
      lines.push("SYSTEM RESOURCES");
      lines.push(`   CPU: ${r.cpus} cores`);
      lines.push(`   RAM: ${r.totalMemGB}GB total, ${r.freeMemGB}GB free (${r.usedPercent}% used)`);
      lines.push("");
      lines.push("SWARM CAPACITY");
      lines.push(`   Active agents: ${r.activeAgents}`);
      lines.push(`   Max parallel: ~${r.maxParallelAgents} (at ~3GB per agent)`);
      lines.push(`   Available slots: ${r.estimatedCapacity}`);
      lines.push(`   Can spawn more: ${r.canSpawnMore ? "YES" : "MEMORY PRESSURE"}`);

      // M3 Ultra specific guidance
      if (r.totalMemGB >= 192) {
        lines.push("");
        lines.push("M3 Ultra detected! You can run 50+ parallel agents comfortably.");
        lines.push("   Recommended: 40-60 concurrent agents for optimal throughput.");
      } else if (r.totalMemGB >= 96) {
        lines.push("");
        lines.push("High-memory machine — 20-30 parallel agents recommended.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SWARM MANAGEMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_clear",
    "Clear completed/failed tasks and retired agents. Running tasks and active agents are kept.",
    {},
    async () => {
      let clearedTasks = 0;
      let clearedAgents = 0;

      for (const [id, task] of swarm.tasks) {
        if (task.status !== "running" && task.status !== "dispatched") {
          swarm.tasks.delete(id);
          clearedTasks++;
        }
      }

      for (const [id, agent] of swarm.agents) {
        if (agent.status === "retired") {
          swarm.agents.delete(id);
          clearedAgents++;
        }
      }

      // Clear completed stages
      let clearedStages = 0;
      for (const [id, stage] of swarm.stages) {
        if (stage.status === "completed" || stage.status === "failed") {
          swarm.stages.delete(id);
          clearedStages++;
        }
      }

      saveState();

      return {
        content: [
          {
            type: "text" as const,
            text: `Cleared: ${clearedTasks} tasks, ${clearedAgents} agents, ${clearedStages} stages.\nActive: ${swarm.tasks.size} tasks, ${swarm.agents.size} agents, ${swarm.stages.size} stages.`,
          },
        ],
      };
    }
  );

  server.tool(
    "swarm_reset",
    "Full swarm reset — clear ALL state (agents, tasks, stages, memory). Nuclear option.",
    {},
    async () => {
      const stats = {
        agents: swarm.agents.size,
        tasks: swarm.tasks.size,
        stages: swarm.stages.size,
        memory: swarm.sharedMemory.size,
      };

      swarm.agents.clear();
      swarm.tasks.clear();
      swarm.stages.clear();
      swarm.sharedMemory.clear();
      swarm.taskCounter = 0;
      swarm.agentCounter = 0;
      swarm.stageCounter = 0;
      swarm.startedAt = Date.now();

      saveState();

      return {
        content: [
          {
            type: "text" as const,
            text: `Swarm reset. Cleared ${stats.agents} agents, ${stats.tasks} tasks, ${stats.stages} stages, ${stats.memory} memory entries.`,
          },
        ],
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LIST AGENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_list_agents",
    "List all swarm agents with their roles, workspace IDs, and status.",
    {
      status: z
        .enum(["all", "idle", "working", "retired"])
        .optional()
        .describe("Filter by status (default: all active)"),
    },
    async ({ status }) => {
      const agents = Array.from(swarm.agents.values());
      const filtered =
        status === "all" || !status
          ? agents.filter((a) => a.status !== "retired")
          : agents.filter((a) => a.status === status);

      if (filtered.length === 0) {
        return { content: [{ type: "text" as const, text: "No agents found." }] };
      }

      const lines = filtered.map((a) => {
        const icon = a.status === "working" ? "[BUSY]" : a.status === "idle" ? "[IDLE]" : "[OFF]";
        return `${icon} ${a.id} [${a.role}] ws:${a.workspaceId} — ${a.status} (${a.tasksCompleted} done)`;
      });

      return {
        content: [
          { type: "text" as const, text: `Agents (${filtered.length}):\n${lines.join("\n")}` },
        ],
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HEALTH CHECK & HEARTBEAT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_health_check",
    "Run a health check on all working agents — verify their workspaces are still alive and responsive. Marks stale agents as failed.",
    {
      staleThresholdMs: z
        .number()
        .optional()
        .describe("Mark agents stale after this many ms of inactivity (default: 300000 = 5min)"),
    },
    async ({ staleThresholdMs }) => {
      const threshold = staleThresholdMs ?? 300_000;
      const agents = Array.from(swarm.agents.values()).filter(
        (a) => a.status === "working" || a.status === "idle"
      );

      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "No active agents to check." }] };
      }

      const results: Array<{ agentId: string; role: string; status: string; detail: string }> = [];

      const checks = agents.map(async (agent) => {
        try {
          // Try to ping the workspace by getting its info
          const info = await client.getWorkspaceInfo(agent.workspaceId);
          const alive = info !== null && info !== undefined;

          if (!alive) {
            agent.status = "failed";
            saveState();
            return {
              agentId: agent.id,
              role: agent.role,
              status: "DEAD",
              detail: "Workspace not found",
            };
          }

          // Check staleness
          const inactiveMs = Date.now() - agent.lastActiveAt;
          if (agent.status === "working" && inactiveMs > threshold) {
            // Agent has been "working" but no activity for too long
            // Mark the current task as timeout BEFORE clearing the reference
            if (agent.currentTaskId) {
              const task = swarm.tasks.get(agent.currentTaskId);
              if (task && task.status === "running") {
                task.status = "timeout";
                task.completedAt = Date.now();
                task.error = `Agent stale — no activity for ${Math.round(inactiveMs / 1000)}s`;
              }
            }
            agent.status = "idle";
            agent.currentTaskId = undefined;
            saveState();
            return {
              agentId: agent.id,
              role: agent.role,
              status: "STALE",
              detail: `Inactive ${Math.round(inactiveMs / 1000)}s → reset to idle`,
            };
          }

          return {
            agentId: agent.id,
            role: agent.role,
            status: "OK",
            detail: `Active ${Math.round(inactiveMs / 1000)}s ago`,
          };
        } catch (error) {
          agent.status = "failed";
          saveState();
          return {
            agentId: agent.id,
            role: agent.role,
            status: "ERROR",
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      });

      const settled = await Promise.all(checks);
      results.push(...settled);

      const healthy = results.filter((r) => r.status === "OK");
      const unhealthy = results.filter((r) => r.status !== "OK");

      const lines: string[] = [];
      lines.push(`HEALTH CHECK: ${healthy.length}/${results.length} healthy\n`);

      for (const r of results) {
        const icon = r.status === "OK" ? "[OK]" : r.status === "STALE" ? "[STALE]" : "[DEAD]";
        lines.push(`${icon} ${r.agentId} [${r.role}] — ${r.detail}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        isError: unhealthy.length > 0 && healthy.length === 0,
      };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TASK RETRY / DEAD-LETTER QUEUE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_retry_task",
    "Retry a failed/timed-out task — re-dispatches to the same or a different agent. Failed tasks are moved to a dead-letter queue after max retries.",
    {
      taskId: z.string().describe("Task ID to retry"),
      targetAgentId: z
        .string()
        .optional()
        .describe("Retry on a different agent (default: same agent)"),
      maxRetries: z
        .number()
        .optional()
        .describe("Max retry attempts before dead-letter (default: 3)"),
    },
    async ({ taskId, targetAgentId, maxRetries }) => {
      const task = swarm.tasks.get(taskId);
      if (!task)
        return {
          content: [{ type: "text" as const, text: `Task ${taskId} not found` }],
          isError: true,
        };

      if (task.status === "running" || task.status === "dispatched") {
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${taskId} is still running — interrupt first or wait for completion`,
            },
          ],
          isError: true,
        };
      }

      // Track retries via metadata
      const retryKey = `retry:${taskId}`;
      const retryCountStr = swarm.sharedMemory.get(retryKey) ?? "0";
      const retryCount = parseInt(retryCountStr, 10);
      const maxR = maxRetries ?? 3;

      if (retryCount >= maxR) {
        // Dead-letter: mark in shared memory for inspection
        swarm.sharedMemory.set(
          `dead-letter:${taskId}`,
          JSON.stringify({
            task: task.task,
            role: task.role,
            error: task.error,
            retries: retryCount,
            failedAt: task.completedAt,
          })
        );
        saveState();
        return {
          content: [
            {
              type: "text" as const,
              text: `Task ${taskId} exceeded max retries (${maxR}). Moved to dead-letter queue.\nInspect with: swarm_memory_get key="dead-letter:${taskId}"`,
            },
          ],
          isError: true,
        };
      }

      // Determine target agent
      const agentId = targetAgentId ?? task.agentId;
      const agent = swarm.agents.get(agentId);
      if (!agent)
        return {
          content: [{ type: "text" as const, text: `Agent ${agentId} not found` }],
          isError: true,
        };
      if (agent.status === "working")
        return {
          content: [{ type: "text" as const, text: `Agent ${agentId} is busy` }],
          isError: true,
        };

      // Create a new task (clone of failed one)
      const newTaskId = genTaskId();
      let baselineCount = 0;
      try {
        const replay = (await client.getFullReplay(agent.workspaceId)) as unknown[];
        baselineCount = replay.length;
      } catch {}

      let taskMessage = `[RETRY ${retryCount + 1}/${maxR}] ${task.task}`;
      if (task.error) {
        taskMessage += `\n\n[Previous attempt failed: ${task.error}]`;
      }
      if (swarm.sharedMemory.size > 0) {
        const memCtx = Array.from(swarm.sharedMemory.entries())
          .filter(([k]) => !k.startsWith("retry:") && !k.startsWith("dead-letter:"))
          .map(([k, v]) => `[${k}]: ${v}`)
          .join("\n");
        if (memCtx) taskMessage = `[SHARED CONTEXT]\n${memCtx}\n\n${taskMessage}`;
      }

      const sendResult = await client.sendMessage(agent.workspaceId, taskMessage);

      const newTask: SwarmTask = {
        id: newTaskId,
        agentId,
        workspaceId: agent.workspaceId,
        role: agent.role,
        task: task.task,
        stage: task.stage,
        status: sendResult.success ? "running" : "failed",
        priority: task.priority,
        dispatchedAt: Date.now(),
        error: sendResult.success ? undefined : sendResult.error,
        baselineMessageCount: baselineCount,
      };
      swarm.tasks.set(newTaskId, newTask);

      if (sendResult.success) {
        agent.status = "working";
        agent.currentTaskId = newTaskId;
        agent.lastActiveAt = Date.now();
        pollTaskCompletion(client, newTaskId).catch(() => {});
      }

      // Track retry count
      swarm.sharedMemory.set(retryKey, String(retryCount + 1));
      saveState();

      return {
        content: [
          {
            type: "text" as const,
            text: `Retry ${retryCount + 1}/${maxR} for task ${taskId}\nNew task: ${newTaskId}\nAgent: ${agentId} [${agent.role}]\nStatus: ${newTask.status}`,
          },
        ],
        isError: !sendResult.success,
      };
    }
  );

  server.tool(
    "swarm_dead_letters",
    "List all tasks in the dead-letter queue (failed after max retries).",
    {},
    async () => {
      const deadLetters: Array<{ key: string; data: unknown }> = [];

      for (const [key, value] of swarm.sharedMemory) {
        if (key.startsWith("dead-letter:")) {
          try {
            deadLetters.push({ key, data: JSON.parse(value) });
          } catch {
            deadLetters.push({ key, data: value });
          }
        }
      }

      if (deadLetters.length === 0) {
        return { content: [{ type: "text" as const, text: "Dead-letter queue is empty." }] };
      }

      const lines: string[] = [];
      lines.push(`DEAD-LETTER QUEUE (${deadLetters.length})\n`);

      for (const dl of deadLetters) {
        const taskId = dl.key.replace("dead-letter:", "");
        const data = dl.data as Record<string, unknown>;
        lines.push(`[DEAD] ${taskId}`);
        lines.push(`   Role: ${data.role ?? "?"} | Retries: ${data.retries ?? "?"}`);
        lines.push(`   Error: ${data.error ?? "unknown"}`);
        lines.push(`   Task: ${String(data.task ?? "").slice(0, 100)}`);
        lines.push("");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SWARM METRICS / DASHBOARD RESOURCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  server.tool(
    "swarm_metrics",
    "Get structured swarm metrics — throughput, latency, error rate, efficiency. For programmatic consumption.",
    {},
    async () => {
      const tasks = Array.from(swarm.tasks.values());
      const agents = Array.from(swarm.agents.values());
      const stages = Array.from(swarm.stages.values());

      const completed = tasks.filter((t) => t.status === "completed");
      const failed = tasks.filter((t) => t.status === "failed" || t.status === "timeout");
      const running = tasks.filter((t) => t.status === "running");

      const durations = completed
        .filter((t) => t.completedAt)
        .map((t) => t.completedAt! - t.dispatchedAt);

      const avgDurationMs =
        durations.length > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
          : 0;
      const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
      const minDurationMs = durations.length > 0 ? Math.min(...durations) : 0;

      const uptime = Date.now() - swarm.startedAt;
      const throughputPerMin = uptime > 0 ? +(completed.length / (uptime / 60_000)).toFixed(2) : 0;
      const errorRate = tasks.length > 0 ? +((failed.length / tasks.length) * 100).toFixed(1) : 0;

      const criticalPath = calculateCriticalPath();
      const resources = getSystemResources();

      const metrics = {
        uptime: `${Math.round(uptime / 1000)}s`,
        agents: {
          total: agents.length,
          working: agents.filter((a) => a.status === "working").length,
          idle: agents.filter((a) => a.status === "idle").length,
          retired: agents.filter((a) => a.status === "retired").length,
          failed: agents.filter((a) => a.status === "failed").length,
        },
        tasks: {
          total: tasks.length,
          running: running.length,
          completed: completed.length,
          failed: failed.length,
          throughputPerMin,
          errorRate: `${errorRate}%`,
        },
        latency: {
          avgMs: avgDurationMs,
          maxMs: maxDurationMs,
          minMs: minDurationMs,
        },
        stages: {
          total: stages.length,
          completed: stages.filter((s) => s.status === "completed").length,
          running: stages.filter((s) => s.status === "running").length,
        },
        criticalPath: {
          totalMs: criticalPath.totalMs,
          parallelEfficiency: criticalPath.parallelEfficiency,
        },
        resources: {
          cpus: resources.cpus,
          freeMemGB: resources.freeMemGB,
          estimatedCapacity: resources.estimatedCapacity,
        },
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(metrics, null, 2) }],
      };
    }
  );
}
