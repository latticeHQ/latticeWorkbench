/**
 * subagents — Unified fleet management tool for PM Chat.
 *
 * Combines task subagents (from TaskService) and PTY terminal sessions
 * (from TerminalService) into a single control surface.
 *
 * Actions:
 *   list  — enumerate all active task subagents + PTY sessions
 *   kill  — terminate a specific agent or all agents (cascade for tasks)
 *   steer — redirect a PTY session: interrupt (Ctrl+C) + inject new directive
 *
 * ID convention:
 *   Task IDs  → plain UUID (matches TaskService task IDs)
 *   PTY IDs   → prefixed "sess:<sessionId>" (from TerminalService)
 */

import { tool } from "ai";

import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

const SESS_PREFIX = "sess:";

function toSessId(sessionId: string): string {
  return `${SESS_PREFIX}${sessionId}`;
}

/** Returns raw sessionId if the id has a sess: prefix, null otherwise. */
function fromSessId(id: string): string | null {
  return id.startsWith(SESS_PREFIX) ? id.slice(SESS_PREFIX.length) : null;
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export const createSubagentsTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.subagents.description,
    inputSchema: TOOL_DEFINITIONS.subagents.schema,

    execute: async (args): Promise<unknown> => {
      const { action } = args;

      // -----------------------------------------------------------------------
      // ACTION: list
      // -----------------------------------------------------------------------
      if (action === "list") {
        const agents: Array<{
          id: string;
          type: "task" | "session";
          label: string;
          slug?: string;
          status?: string;
          createdAt?: string;
          modelString?: string;
          depth?: number;
        }> = [];

        // --- Task subagents (all statuses by default, callers can filter) ---
        if (config.taskService && config.workspaceId) {
          const tasks = config.taskService.listDescendantAgentTasks(config.workspaceId);
          for (const t of tasks) {
            agents.push({
              id: t.taskId,
              type: "task",
              label: t.title ?? t.workspaceName ?? t.taskId,
              status: t.status,
              createdAt: t.createdAt,
              modelString: t.modelString,
              depth: t.depth,
            });
          }
        }

        // --- PTY terminal sessions (hired employees / spawned background agents) ---
        if (config.terminalService && config.workspaceId) {
          const sessions = config.terminalService.listWorkspaceSessions(config.workspaceId);
          for (const s of sessions) {
            agents.push({
              id: toSessId(s.sessionId),
              type: "session",
              label: s.label,
              slug: s.slug,
              status: "running",
              createdAt: new Date(s.createdAt).toISOString(),
            });
          }
        }

        const taskCount = agents.filter((a) => a.type === "task").length;
        const sessCount = agents.filter((a) => a.type === "session").length;

        return {
          success: true,
          agents,
          count: agents.length,
          summary: `${taskCount} task subagent(s), ${sessCount} PTY session(s)`,
          hint:
            agents.length === 0
              ? "No active agents. Use task to spawn sub-agent tasks, hire_employee to open a visible agent tab, or sessions_spawn for a background agent session."
              : 'Use subagents({action:"kill",target:"<id>"}) to stop an agent, or subagents({action:"steer",target:"sess:<id>",message:"..."}) to redirect a PTY session.',
        };
      }

      // -----------------------------------------------------------------------
      // ACTION: kill
      // -----------------------------------------------------------------------
      if (action === "kill") {
        const { target } = args;
        const killed: string[] = [];
        const errors: Record<string, string> = {};

        const killAll = !target || target === "all";

        // Collect what to kill
        const taskTargets: string[] = [];
        const sessRawIds: string[] = []; // raw sessionIds (no prefix)

        if (killAll) {
          if (config.taskService && config.workspaceId) {
            const tasks = config.taskService.listDescendantAgentTasks(config.workspaceId, {
              statuses: ["queued", "running", "awaiting_report"],
            });
            for (const t of tasks) taskTargets.push(t.taskId);
          }
          if (config.terminalService && config.workspaceId) {
            const sessions = config.terminalService.listWorkspaceSessions(config.workspaceId);
            for (const s of sessions) sessRawIds.push(s.sessionId);
          }
        } else {
          const rawSession = fromSessId(target);
          if (rawSession) {
            sessRawIds.push(rawSession);
          } else {
            taskTargets.push(target);
          }
        }

        // Kill task subagents (cascade — includes descendants)
        for (const taskId of taskTargets) {
          if (!config.taskService || !config.workspaceId) {
            errors[taskId] = "Task service not available";
            continue;
          }
          try {
            const result = await config.taskService.terminateDescendantAgentTask(
              config.workspaceId,
              taskId
            );
            if (result.success) {
              // Record all cascade-killed IDs
              for (const id of result.data.terminatedTaskIds) {
                if (!killed.includes(id)) killed.push(id);
              }
            } else {
              errors[taskId] = result.error;
            }
          } catch (e) {
            errors[taskId] = e instanceof Error ? e.message : String(e);
          }
        }

        // Kill PTY sessions
        for (const sessionId of sessRawIds) {
          if (!config.terminalService) {
            errors[toSessId(sessionId)] = "Terminal service not available";
            continue;
          }
          try {
            config.terminalService.close(sessionId);
            killed.push(toSessId(sessionId));
          } catch (e) {
            errors[toSessId(sessionId)] = e instanceof Error ? e.message : String(e);
          }
        }

        const hasErrors = Object.keys(errors).length > 0;
        return {
          success: killed.length > 0 || !hasErrors,
          killed,
          ...(hasErrors ? { errors } : {}),
          hint:
            killed.length > 0
              ? `Killed ${killed.length} agent(s). Use subagents({action:"list"}) to verify fleet state.`
              : "Nothing was killed — agent may not exist or already terminated.",
        };
      }

      // -----------------------------------------------------------------------
      // ACTION: steer
      // -----------------------------------------------------------------------
      if (action === "steer") {
        const { target, message, interrupt } = args;

        if (!target) {
          return { success: false, error: "target is required for steer action." };
        }
        if (!message) {
          return { success: false, error: "message is required for steer action." };
        }

        const rawSessionId = fromSessId(target);
        if (!rawSessionId) {
          return {
            success: false,
            error:
              `steer only works on PTY sessions (IDs prefixed "sess:"). Received: "${target}". ` +
              "Task subagents run autonomously in isolated workspaces and cannot be steered mid-flight. " +
              "Use kill to stop a task and spawn a new one with the updated directive instead.",
          };
        }

        if (!config.terminalService) {
          return { success: false, error: "Terminal service not available." };
        }

        const meta = config.terminalService.getSessionMeta(rawSessionId);
        if (!meta) {
          return {
            success: false,
            error: `Session not found: ${target}. Use subagents({action:"list"}) to see active sessions.`,
          };
        }

        const shouldInterrupt = interrupt !== false; // default true

        try {
          if (shouldInterrupt) {
            // Ctrl+C — interrupt whatever the agent is currently doing
            config.terminalService.sendInput(rawSessionId, "\x03");
            // Brief pause to let the interrupt land before sending new directive
            await new Promise<void>((resolve) => setTimeout(resolve, 500));
          }

          // Send the new directive with newline to submit
          config.terminalService.sendInput(rawSessionId, `${message}\n`);

          return {
            success: true,
            id: target,
            label: meta.label,
            slug: meta.slug,
            message,
            interrupted: shouldInterrupt,
            hint: `Directive sent to "${meta.label}". Use sessions_history({sessionId:"${rawSessionId}"}) to monitor its response.`,
          };
        } catch (e) {
          return {
            success: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }

      return { success: false, error: `Unknown action: ${String(action)}` };
    },
  });
};
