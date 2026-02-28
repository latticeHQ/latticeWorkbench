/**
 * Project management tools: list, create, remove, clone, branches, crews,
 * secrets, MCP servers, file completions, runtime availability, idle compaction.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, errorResponse, withErrorHandling } from "../utils";

export function registerProjectTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List projects ──────────────────────────────────────────────────────
  server.tool(
    "list_projects",
    "List all registered projects. Returns project paths and their configuration (runtime settings, trunk branch, etc.).",
    {},
    () =>
      withErrorHandling(async () => {
        const projects = await client.projects.list();
        const formatted = projects.map(([projectPath, config]) => ({
          projectPath,
          ...config,
        }));
        return { content: [jsonContent(formatted)] };
      })
  );

  // ── Create project ─────────────────────────────────────────────────────
  server.tool(
    "create_project",
    "Register a local directory as a Lattice project. The directory must exist and should contain a git repository.",
    {
      projectPath: z
        .string()
        .describe("Absolute path to the project directory to register"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.create({
          projectPath: params.projectPath,
        });
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to create project");
          return errorResponse(errMsg);
        }
        return {
          content: [
            jsonContent({
              message: "Project created successfully",
              normalizedPath: result.data.normalizedPath,
              config: result.data.projectConfig,
            }),
          ],
        };
      })
  );

  // ── Remove project ─────────────────────────────────────────────────────
  server.tool(
    "remove_project",
    "Unregister a project from Lattice. Does not delete the directory, only removes Lattice's reference to it.",
    {
      projectPath: z
        .string()
        .describe("Absolute path of the project to remove"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.remove({
          projectPath: params.projectPath,
        });
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to remove project");
          return errorResponse(errMsg);
        }
        return {
          content: [
            jsonContent({ message: "Project removed successfully" }),
          ],
        };
      })
  );

  // ── List branches ──────────────────────────────────────────────────────
  server.tool(
    "list_branches",
    "List git branches for a project. Returns branch names, current branch, and merge status.",
    {
      projectPath: z
        .string()
        .describe("Absolute path of the project"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.listBranches({
          projectPath: params.projectPath,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Git init ───────────────────────────────────────────────────────────
  server.tool(
    "project_git_init",
    "Initialize a git repository in a project directory (git init).",
    {
      projectPath: z
        .string()
        .describe("Absolute path of the project directory"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.gitInit({
          projectPath: params.projectPath,
        });
        if (!result.success) {
          const errMsg =
            typeof result.error === "string"
              ? result.error
              : JSON.stringify(result.error ?? "Failed to init git");
          return errorResponse(errMsg);
        }
        return {
          content: [jsonContent({ message: "Git repository initialized", ...(result.data as unknown as Record<string, unknown>) })],
        };
      })
  );

  // ── Get file completions ───────────────────────────────────────────────
  server.tool(
    "project_file_completions",
    "Get file path completions within a project directory. Useful for autocomplete.",
    {
      projectPath: z.string().describe("Absolute path of the project"),
      query: z.string().describe("Partial file path to complete"),
      limit: z.number().optional().describe("Max results (default: 50)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.getFileCompletions({
          projectPath: params.projectPath,
          query: params.query,
          limit: params.limit,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Runtime availability ───────────────────────────────────────────────
  server.tool(
    "project_runtime_availability",
    "Check what runtimes (local, SSH, worktree) are available for a project.",
    {
      projectPath: z.string().describe("Absolute path of the project"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.runtimeAvailability({
          projectPath: params.projectPath,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Default project directory ──────────────────────────────────────────
  server.tool(
    "get_default_project_dir",
    "Get the default directory for new projects.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.projects.getDefaultProjectDir();
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "set_default_project_dir",
    "Set the default directory for new projects.",
    {
      path: z.string().describe("Absolute path to the default project directory"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.setDefaultProjectDir({ path: params.path });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Crews (minion grouping) ─────────────────────────────────────
  server.tool(
    "list_crews",
    "List minion crews (groups) in a project.",
    { projectPath: z.string().describe("Absolute project path") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.list({ projectPath: params.projectPath });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "create_crew",
    "Create a new crew (minion group) in a project.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("Section name"),
      color: z.string().optional().describe("Section color (hex or name)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.create({
          projectPath: params.projectPath,
          name: params.name,
          color: params.color,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "update_crew",
    "Update a section's name or color.",
    {
      projectPath: z.string().describe("Absolute project path"),
      crewId: z.string().describe("Section ID to update"),
      name: z.string().optional().describe("New name"),
      color: z.string().optional().describe("New color"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.update({
          projectPath: params.projectPath,
          crewId: params.crewId,
          name: params.name,
          color: params.color,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "remove_crew",
    "Delete a section from a project.",
    {
      projectPath: z.string().describe("Absolute project path"),
      crewId: z.string().describe("Section ID to delete"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.remove({
          projectPath: params.projectPath,
          crewId: params.crewId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "reorder_crews",
    "Reorder crews in a project by providing the new section ID order.",
    {
      projectPath: z.string().describe("Absolute project path"),
      crewIds: z.array(z.string()).describe("Ordered array of section IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.reorder({
          projectPath: params.projectPath,
          crewIds: params.crewIds,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "assign_minion_to_crew",
    "Assign or unassign a minion to a crew. Pass null crewId to unassign.",
    {
      projectPath: z.string().describe("Absolute project path"),
      minionId: z.string().describe("Minion ID to assign"),
      crewId: z.string().nullable().describe("Section ID (null to unassign)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.crews.assignMinion({
          projectPath: params.projectPath,
          minionId: params.minionId,
          crewId: params.crewId,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Project secrets ────────────────────────────────────────────────────
  server.tool(
    "get_project_secrets",
    "Get secrets configured for a specific project.",
    { projectPath: z.string().describe("Absolute project path") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.secrets.get({ projectPath: params.projectPath });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "update_project_secrets",
    "Update secrets for a specific project.",
    {
      projectPath: z.string().describe("Absolute project path"),
      secrets: z.array(z.object({
        name: z.string().describe("Secret name/key"),
        value: z.string().describe("Secret value"),
      })).describe("Array of secret key-value pairs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.secrets.update({
          projectPath: params.projectPath,
          secrets: params.secrets.map(s => ({ key: s.name, value: s.value })),
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Project MCP servers ────────────────────────────────────────────────
  server.tool(
    "list_project_mcp_servers",
    "List MCP servers configured for a project.",
    { projectPath: z.string().describe("Absolute project path") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.list({ projectPath: params.projectPath });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "add_project_mcp_server",
    "Add or update an MCP server in a project configuration.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("MCP server name"),
      transport: z.enum(["stdio", "sse", "streamable-http"]).describe("Transport type"),
      command: z.string().optional().describe("Command for stdio transport"),
      args: z.array(z.string()).optional().describe("Args for stdio transport"),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables"),
      url: z.string().optional().describe("URL for SSE/HTTP transport"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.add({
          projectPath: params.projectPath,
          name: params.name,
          transport: params.transport,
          command: params.command,
          args: params.args,
          env: params.env,
          url: params.url,
        } as Parameters<typeof client.projects.mcp.add>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "remove_project_mcp_server",
    "Remove an MCP server from a project configuration.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("MCP server name to remove"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.remove({
          projectPath: params.projectPath,
          name: params.name,
        } as Parameters<typeof client.projects.mcp.remove>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "test_project_mcp_server",
    "Test connectivity to an MCP server in a project.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("MCP server name to test"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.test({
          projectPath: params.projectPath,
          name: params.name,
        } as Parameters<typeof client.projects.mcp.test>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "set_project_mcp_server_enabled",
    "Enable or disable an MCP server in a project.",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("MCP server name"),
      enabled: z.boolean().describe("Whether to enable the server"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.setEnabled({
          projectPath: params.projectPath,
          name: params.name,
          enabled: params.enabled,
        } as Parameters<typeof client.projects.mcp.setEnabled>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "set_project_mcp_tool_allowlist",
    "Set the tool allowlist for a project MCP server (restrict which tools are available).",
    {
      projectPath: z.string().describe("Absolute project path"),
      name: z.string().describe("MCP server name"),
      allowlist: z.array(z.string()).nullable().describe("Array of allowed tool names, or null for all"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.mcp.setToolAllowlist({
          projectPath: params.projectPath,
          name: params.name,
          allowlist: params.allowlist,
        } as unknown as Parameters<typeof client.projects.mcp.setToolAllowlist>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Idle compaction ────────────────────────────────────────────────────
  server.tool(
    "get_idle_compaction",
    "Get the idle compaction schedule (hours) for a project.",
    { projectPath: z.string().describe("Absolute project path") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.idleCompaction.get({
          projectPath: params.projectPath,
        });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "set_idle_compaction",
    "Set or clear the idle compaction schedule for a project. Set hours to null to disable.",
    {
      projectPath: z.string().describe("Absolute project path"),
      hours: z.number().nullable().describe("Hours of inactivity before compaction (null to disable)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.projects.idleCompaction.set({
          projectPath: params.projectPath,
          hours: params.hours,
        });
        return { content: [jsonContent(result)] };
      })
  );
}
