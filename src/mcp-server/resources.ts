/**
 * MCP Resources: expose large read-only data as browsable resources.
 *
 * Resources allow LLMs to read data efficiently without consuming tool call
 * tokens. Following Anthropic's recommendations, large data (chat history,
 * analytics, agent definitions) is better served as resources that can be
 * browsed on demand.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

/** Static orientation data — teaches LLMs the Lattice mental model. */
const ORIENTATION = {
  summary:
    "Lattice is an AI agent orchestration workbench. You control it through " +
    "200+ MCP tools organized into scoped categories. The core hierarchy is: " +
    "Server → Projects → Minions → Terminals/Tasks. Most tools require a " +
    "scoping ID (projectPath or minionId). Use list_tool_categories to browse " +
    "capabilities, then search_tools to find specific tools.",

  hierarchy: {
    server: {
      description: "The running Lattice backend (one per machine)",
      contains: ["projects", "globalConfig", "providers", "analytics", "sync", "globalMcpServers"],
      tools: "server, config, analytics, mcp-management, oauth, tokenizer, discovery",
    },
    project: {
      description: "A registered code project (has a path on disk, branches, crews, secrets)",
      scopedBy: "projectPath (absolute path)",
      contains: ["minions", "crews", "projectSecrets", "projectMcpServers", "scheduledTasks", "inbox"],
      tools: "project, secrets, scheduler, inbox",
    },
    minion: {
      description: "An isolated agent environment — has its own git branch, chat history, model config, and terminals",
      scopedBy: "minionId (UUID)",
      contains: ["terminals", "kanbanCards", "chatHistory", "plan", "sessionUsage"],
      tools: "minion, terminal, kanban, tasks",
    },
    terminal: {
      description: "A PTY session inside a minion — can run shell commands or launch built-in AI agent profiles",
      scopedBy: "sessionId",
      tools: "terminal",
    },
    terminalProfiles: {
      description: "GLOBAL pre-configured CLI tool launchers (claude-code, gemini-cli, copilot, codex, aider, amp)",
      scopedBy: "profileId",
      note: "These are built-in — do NOT build a CLI from scratch when a user says 'run Gemini' or 'launch Claude Code'. Use terminal_profiles_list → terminal_profiles_set_config → terminal_create with profileId.",
      tools: "terminal-profiles",
    },
    crew: {
      description: "A named grouping of minions within a project (organizational unit)",
      scopedBy: "crewId",
      parentTools: "project (createCrew, updateCrew, deleteCrew, listCrews)",
    },
  },

  scopeGuide: {
    global: "Server-wide: config, providers, analytics, mcp-management, oauth, terminal-profiles, sync, discovery, general, tokenizer",
    projectScoped: "Require projectPath: project, secrets, scheduler, inbox",
    minionScoped: "Require minionId: minion, terminal, kanban, tasks",
    agents: "Agent definitions are global but skill execution is project-scoped",
  },

  commonMistakes: [
    {
      mistake: "Building a CLI from scratch when user says 'run Gemini' or 'launch Claude Code'",
      fix: "Use the built-in terminal profiles: terminal_profiles_list → terminal_profiles_set_config (enable) → terminal_create with profileId",
    },
    {
      mistake: "Calling minion tools without a minionId",
      fix: "First create a minion (create_minion) or list existing ones (list_minions) to get a minionId",
    },
    {
      mistake: "Searching for tools by guessing names",
      fix: "Use list_tool_categories first, then search_tools({ category: '...' }) or search_tools({ query: '...' })",
    },
    {
      mistake: "Trying to get real-time terminal output via MCP",
      fix: "MCP is request/response only. Use send_message with bash tool calls for command execution with output capture. Terminal output requires WebSocket subscriptions.",
    },
  ],

  toolDiscoveryGuide:
    "1. Call list_tool_categories to see all 19+ categories with descriptions and tool counts. " +
    "2. Call search_tools({ category: 'minion' }) to list all tools in a category. " +
    "3. Call search_tools({ query: 'terminal profile' }) to search by keyword. " +
    "4. Use detail='full' for complete descriptions, 'names' for minimal token usage.",
};

export function registerResources(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Static: Orientation (hierarchy + mental model) ─────────────────────
  server.resource(
    "orientation",
    "lattice://orientation",
    {
      description:
        "Lattice mental model: entity hierarchy, scoping rules, common mistakes, " +
        "and tool discovery guide. Read this FIRST to understand how Lattice works.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [{
        uri: "lattice://orientation",
        mimeType: "application/json",
        text: JSON.stringify(ORIENTATION, null, 2),
      }],
    })
  );
  // ── Static: Projects list ──────────────────────────────────────────────
  server.resource(
    "projects",
    "lattice://projects",
    { description: "List of all registered Lattice projects", mimeType: "application/json" },
    async () => {
      const projects = await client.projects.list();
      const formatted = projects.map(([path, config]) => ({ projectPath: path, ...config }));
      return {
        contents: [{
          uri: "lattice://projects",
          mimeType: "application/json",
          text: JSON.stringify(formatted, null, 2),
        }],
      };
    }
  );

  // ── Static: Global config ──────────────────────────────────────────────
  server.resource(
    "config",
    "lattice://config",
    { description: "Global Lattice configuration (models, runtimes, task settings)", mimeType: "application/json" },
    async () => {
      const config = await client.config.getConfig();
      return {
        contents: [{
          uri: "lattice://config",
          mimeType: "application/json",
          text: JSON.stringify(config, null, 2),
        }],
      };
    }
  );

  // ── Static: Minions list ────────────────────────────────────────────
  server.resource(
    "minions",
    "lattice://minions",
    { description: "List of all active minions with metadata", mimeType: "application/json" },
    async () => {
      const minions = await client.minion.list();
      const summary = minions.map((w) => ({
        id: w.id, name: w.name, title: w.title,
        projectPath: w.projectPath, projectName: w.projectName,
        createdAt: w.createdAt, taskStatus: w.taskStatus,
      }));
      return {
        contents: [{
          uri: "lattice://minions",
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        }],
      };
    }
  );

  // ── Static: Agents list ────────────────────────────────────────────────
  server.resource(
    "agents",
    "lattice://agents",
    { description: "List of all available agent definitions", mimeType: "application/json" },
    async () => {
      try {
        const agents = await client.agents.list({} as Parameters<typeof client.agents.list>[0]);
        return {
          contents: [{
            uri: "lattice://agents",
            mimeType: "application/json",
            text: JSON.stringify(agents, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: "lattice://agents",
            mimeType: "application/json",
            text: JSON.stringify({ error: "No agents available (no project context)" }),
          }],
        };
      }
    }
  );

  // ── Static: Provider config ────────────────────────────────────────────
  server.resource(
    "providers",
    "lattice://providers",
    { description: "AI provider configuration (API key status, models, status)", mimeType: "application/json" },
    async () => {
      const config = await client.providers.getConfig();
      return {
        contents: [{
          uri: "lattice://providers",
          mimeType: "application/json",
          text: JSON.stringify(config, null, 2),
        }],
      };
    }
  );

  // ── Static: Analytics summary ──────────────────────────────────────────
  server.resource(
    "analytics-summary",
    "lattice://analytics/summary",
    { description: "Aggregate spend/usage summary across all projects", mimeType: "application/json" },
    async () => {
      const summary = await client.analytics.getSummary({} as Parameters<typeof client.analytics.getSummary>[0]);
      return {
        contents: [{
          uri: "lattice://analytics/summary",
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        }],
      };
    }
  );

  // ── Static: Activity (all minions) ──────────────────────────────────
  server.resource(
    "activity",
    "lattice://activity",
    { description: "Current streaming/activity status for all minions", mimeType: "application/json" },
    async () => {
      const activity = await client.minion.activity.list();
      return {
        contents: [{
          uri: "lattice://activity",
          mimeType: "application/json",
          text: JSON.stringify(activity, null, 2),
        }],
      };
    }
  );

  // ── Template: Minion chat history ───────────────────────────────────
  const chatTemplate = new ResourceTemplate("lattice://minions/{minionId}/chat", {
    list: async () => {
      const minions = await client.minion.list();
      return {
        resources: minions.map((w) => ({
          uri: `lattice://minions/${w.id}/chat`,
          name: `Chat history: ${w.title || w.name}`,
          description: `Full chat replay for minion ${w.name}`,
          mimeType: "application/json",
        })),
      };
    },
  });

  server.resource("minion-chat", chatTemplate, { description: "Chat history for a minion", mimeType: "application/json" }, async (uri, { minionId }) => {
    const wsId = minionId as string;
    const events = await client.minion.getFullReplay({ minionId: wsId });
    const messages: Array<{ role: string; content: string; type: string }> = [];
    for (const event of events) {
      if (typeof event === "object" && event != null && "type" in event) {
        const evt = event as Record<string, unknown>;
        if (evt.type === "user-message" && typeof evt.text === "string") {
          messages.push({ role: "user", content: evt.text, type: "user-message" });
        }
        if (evt.type === "completed-message-part") {
          const part = evt;
          if (part.partType === "text" && typeof part.text === "string") {
            messages.push({ role: "assistant", content: part.text, type: "text" });
          }
          if (part.partType === "tool-call") {
            messages.push({
              role: "assistant",
              content: JSON.stringify({ tool: part.toolName, args: part.args, result: part.result }),
              type: "tool-call",
            });
          }
        }
      }
    }
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify({ totalEvents: events.length, messageCount: messages.length, messages }, null, 2),
      }],
    };
  });

  // ── Template: Minion plan ───────────────────────────────────────────
  const planTemplate = new ResourceTemplate("lattice://minions/{minionId}/plan", {
    list: async () => {
      const minions = await client.minion.list();
      return {
        resources: minions.map((w) => ({
          uri: `lattice://minions/${w.id}/plan`,
          name: `Plan: ${w.title || w.name}`,
          description: `Plan file for minion ${w.name}`,
          mimeType: "text/plain",
        })),
      };
    },
  });

  server.resource("minion-plan", planTemplate, { description: "Plan file content for a minion", mimeType: "text/plain" }, async (uri, { minionId }) => {
    const wsId = minionId as string;
    try {
      const result = await client.minion.getPlanContent({ minionId: wsId });
      const text = result.success ? JSON.stringify(result.data, null, 2) : `No plan: ${JSON.stringify(result.error)}`;
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/plain",
          text,
        }],
      };
    } catch {
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: "No plan file found" }],
      };
    }
  });

  // ── Template: Minion session usage ──────────────────────────────────
  const usageTemplate = new ResourceTemplate("lattice://minions/{minionId}/usage", {
    list: async () => {
      const minions = await client.minion.list();
      return {
        resources: minions.map((w) => ({
          uri: `lattice://minions/${w.id}/usage`,
          name: `Usage: ${w.title || w.name}`,
          description: `Token usage and cost data for minion ${w.name}`,
          mimeType: "application/json",
        })),
      };
    },
  });

  server.resource("minion-usage", usageTemplate, { description: "Session usage data for a minion", mimeType: "application/json" }, async (uri, { minionId }) => {
    const wsId = minionId as string;
    const usage = await client.minion.getSessionUsage({ minionId: wsId });
    return {
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(usage ?? { message: "No usage data" }, null, 2),
      }],
    };
  });

  // ── Static: Inbox adapter connection status ─────────────────────────
  server.resource(
    "inbox-status",
    "lattice://inbox/status",
    { description: "Connection status of all inbox adapters (Slack, Discord, etc.)", mimeType: "application/json" },
    async () => {
      try {
        const status = await client.inbox.connectionStatus();
        return {
          contents: [{
            uri: "lattice://inbox/status",
            mimeType: "application/json",
            text: JSON.stringify(status, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: "lattice://inbox/status",
            mimeType: "application/json",
            text: JSON.stringify({ message: "Inbox not available" }),
          }],
        };
      }
    }
  );

  // ── Static: Sync status ────────────────────────────────────────────────
  server.resource(
    "sync-status",
    "lattice://sync/status",
    { description: "Current git sync status and configuration", mimeType: "application/json" },
    async () => {
      try {
        const status = await client.sync.getStatus();
        return {
          contents: [{
            uri: "lattice://sync/status",
            mimeType: "application/json",
            text: JSON.stringify(status, null, 2),
          }],
        };
      } catch {
        return {
          contents: [{
            uri: "lattice://sync/status",
            mimeType: "application/json",
            text: JSON.stringify({ message: "Sync not available" }),
          }],
        };
      }
    }
  );
}
