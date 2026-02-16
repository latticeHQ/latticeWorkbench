/**
 * Headquarter MCP tools — list, create, branch management.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

export function registerProjectTools(server: McpServer, client: WorkbenchClient): void {
  // ── List projects ─────────────────────────────────────────────────

  server.tool(
    "workbench_list_projects",
    "List all registered projects in the workbench.",
    {},
    async () => {
      try {
        const projects = await client.listProjects();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(projects, null, 2) }],
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

  // ── Create project ────────────────────────────────────────────────

  server.tool(
    "workbench_create_project",
    "Register a new project directory in the workbench.",
    {
      projectPath: z.string().describe("Absolute path to the project directory"),
    },
    async ({ projectPath }) => {
      try {
        const result = await client.createProject(projectPath);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Headquarter registered: ${projectPath}` }],
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

  // ── List branches ─────────────────────────────────────────────────

  server.tool(
    "workbench_list_branches",
    "List git branches for a project. Also returns the recommended trunk branch.",
    {
      projectPath: z.string().describe("Absolute path to the project"),
    },
    async ({ projectPath }) => {
      try {
        const result = await client.listBranches(projectPath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
}
