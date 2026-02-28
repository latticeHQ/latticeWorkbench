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

export function registerResources(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
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
}
