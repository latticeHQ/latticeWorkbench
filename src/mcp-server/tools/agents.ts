/**
 * Agent and agent skill tools: discover, read, and inspect agent definitions
 * and their associated skills.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerAgentTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List agents ────────────────────────────────────────────────────────
  server.tool(
    "list_agents",
    "Discover all agent definitions available in a project or minion. " +
      "Returns agent IDs, names, descriptions, and configuration.",
    {
      projectPath: z.string().optional().describe("Project path to discover agents from"),
      minionId: z.string().optional().describe("Minion ID to discover agents from"),
      disableMinionAgents: z.boolean().optional().describe("Skip minion-specific agents"),
      includeDisabled: z.boolean().optional().describe("Include disabled agents"),
    },
    (params) =>
      withErrorHandling(async () => {
        const agents = await client.agents.list({
          projectPath: params.projectPath,
          minionId: params.minionId,
          disableMinionAgents: params.disableMinionAgents,
          includeDisabled: params.includeDisabled,
        } as Parameters<typeof client.agents.list>[0]);
        return { content: [jsonContent(agents)] };
      })
  );

  // ── Get agent details ──────────────────────────────────────────────────
  server.tool(
    "get_agent",
    "Read a single agent definition package including frontmatter and content.",
    {
      agentId: z.string().describe("The agent ID to read"),
      projectPath: z.string().optional().describe("Project path context"),
      minionId: z.string().optional().describe("Minion ID context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const agent = await client.agents.get({
          agentId: params.agentId,
          projectPath: params.projectPath,
          minionId: params.minionId,
        } as Parameters<typeof client.agents.get>[0]);
        return { content: [jsonContent(agent)] };
      })
  );

  // ── List agent skills ──────────────────────────────────────────────────
  server.tool(
    "list_agent_skills",
    "Discover all agent skill descriptors available in a project or minion.",
    {
      projectPath: z.string().optional().describe("Project path to discover skills from"),
      minionId: z.string().optional().describe("Minion ID to discover skills from"),
      disableMinionAgents: z.boolean().optional().describe("Skip minion-specific agent skills"),
    },
    (params) =>
      withErrorHandling(async () => {
        const skills = await client.agentSkills.list({
          projectPath: params.projectPath,
          minionId: params.minionId,
          disableMinionAgents: params.disableMinionAgents,
        } as Parameters<typeof client.agentSkills.list>[0]);
        return { content: [jsonContent(skills)] };
      })
  );

  // ── Get agent skill ────────────────────────────────────────────────────
  server.tool(
    "get_agent_skill",
    "Read a single agent skill package definition.",
    {
      skillName: z.string().describe("The skill name to read"),
      projectPath: z.string().optional().describe("Project path context"),
      minionId: z.string().optional().describe("Minion ID context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const skill = await client.agentSkills.get({
          skillName: params.skillName,
          projectPath: params.projectPath,
          minionId: params.minionId,
        } as Parameters<typeof client.agentSkills.get>[0]);
        return { content: [jsonContent(skill)] };
      })
  );

  // ── List skill diagnostics ─────────────────────────────────────────────
  server.tool(
    "list_agent_skill_diagnostics",
    "List skills including invalid/broken ones — useful for debugging skill configurations.",
    {
      projectPath: z.string().optional().describe("Project path context"),
      minionId: z.string().optional().describe("Minion ID context"),
    },
    (params) =>
      withErrorHandling(async () => {
        const diagnostics = await client.agentSkills.listDiagnostics({
          projectPath: params.projectPath,
          minionId: params.minionId,
        } as Parameters<typeof client.agentSkills.listDiagnostics>[0]);
        return { content: [jsonContent(diagnostics)] };
      })
  );
}
