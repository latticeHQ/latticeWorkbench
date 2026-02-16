/**
 * Workspace MCP tools — create, list, message, execute in workspaces.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

export function registerWorkspaceTools(server: McpServer, client: WorkbenchClient): void {
  // ── List workspaces ───────────────────────────────────────────────

  server.tool(
    "workbench_list_workspaces",
    "List all workspaces in the workbench with their metadata (id, title, project, status)",
    { archived: z.boolean().optional().describe("Include archived workspaces (default: false)") },
    async ({ archived }) => {
      try {
        const workspaces = await client.listWorkspaces(archived);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(workspaces, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Create workspace ──────────────────────────────────────────────

  server.tool(
    "workbench_create_workspace",
    "Create a new workspace in a project. Returns the workspace ID.",
    {
      projectPath: z.string().describe("Absolute path to the project"),
      branchName: z.string().describe("Git branch name for the workspace"),
      title: z.string().optional().describe("Human-readable title for the workspace"),
      trunkBranch: z.string().optional().describe("Base branch to create from (default: main/master)"),
    },
    async ({ projectPath, branchName, title, trunkBranch }) => {
      try {
        const result = await client.createWorkspace({
          projectPath,
          branchName,
          title,
          trunkBranch,
        });

        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed to create workspace: ${result.error}` }],
            isError: true,
          };
        }

        const workspaceId = result.data?.metadata?.id ?? "unknown";
        return {
          content: [
            {
              type: "text" as const,
              text: `Workspace created successfully.\nWorkspace ID: ${workspaceId}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Remove workspace ──────────────────────────────────────────────

  server.tool(
    "workbench_remove_workspace",
    "Delete a workspace. Use force=true to skip confirmation.",
    {
      workspaceId: z.string().describe("ID of the workspace to remove"),
      force: z.boolean().optional().describe("Force removal without confirmation"),
    },
    async ({ workspaceId, force }) => {
      try {
        const result = await client.removeWorkspace(workspaceId, force);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Workspace ${workspaceId} removed.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Send message ──────────────────────────────────────────────────

  server.tool(
    "workbench_send_message",
    "Send a message to a workspace agent and wait for the full response. This triggers the AI agent to process the message and return a complete reply.",
    {
      workspaceId: z.string().describe("ID of the target workspace"),
      message: z.string().describe("The message to send to the agent"),
      timeoutMs: z
        .number()
        .optional()
        .describe("Max time to wait for response in ms (default: 120000)"),
    },
    async ({ workspaceId, message, timeoutMs }) => {
      try {
        // Get current message count for polling baseline
        const beforeReplay = (await client.getFullReplay(workspaceId)) as unknown[];
        const beforeCount = beforeReplay.length;

        // Send the message
        const sendResult = await client.sendMessage(workspaceId, message);
        if (!sendResult.success) {
          return {
            content: [
              { type: "text" as const, text: `Failed to send message: ${sendResult.error}` },
            ],
            isError: true,
          };
        }

        // Wait for the agent's response (streaming with polling fallback)
        const response = await client.waitForResponse(
          workspaceId,
          beforeCount,
          timeoutMs ?? 120_000
        );

        return {
          content: [{ type: "text" as const, text: response }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Get chat history ──────────────────────────────────────────────

  server.tool(
    "workbench_get_chat_history",
    "Get the full conversation history for a workspace.",
    {
      workspaceId: z.string().describe("ID of the workspace"),
    },
    async ({ workspaceId }) => {
      try {
        const replay = await client.getFullReplay(workspaceId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(replay, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Interrupt stream ──────────────────────────────────────────────

  server.tool(
    "workbench_interrupt",
    "Interrupt an active agent stream in a workspace (stop the AI from generating).",
    {
      workspaceId: z.string().describe("ID of the workspace"),
    },
    async ({ workspaceId }) => {
      try {
        const result = await client.interruptStream(workspaceId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Stream interrupted in workspace ${workspaceId}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Execute bash ──────────────────────────────────────────────────

  server.tool(
    "workbench_execute_bash",
    "Execute a bash script in a workspace's runtime environment. Returns stdout, stderr, and exit code.",
    {
      workspaceId: z.string().describe("ID of the workspace to execute in"),
      script: z.string().describe("The bash script/command to execute"),
      timeout: z.number().optional().describe("Timeout in seconds (default: 30)"),
    },
    async ({ workspaceId, script, timeout }) => {
      try {
        const result = await client.executeBash(workspaceId, script, timeout);
        const parts: string[] = [];

        if (result.stdout) {
          parts.push(`STDOUT:\n${result.stdout}`);
        }
        if (result.stderr) {
          parts.push(`STDERR:\n${result.stderr}`);
        }
        parts.push(`Exit code: ${result.exitCode}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n\n") }],
          isError: result.exitCode !== 0,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Workspace info ────────────────────────────────────────────────

  server.tool(
    "workbench_workspace_info",
    "Get detailed information about a specific workspace (metadata, status, config).",
    {
      workspaceId: z.string().describe("ID of the workspace"),
    },
    async ({ workspaceId }) => {
      try {
        const info = await client.getWorkspaceInfo(workspaceId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Fork workspace ────────────────────────────────────────────────

  server.tool(
    "workbench_fork_workspace",
    "Fork an existing workspace to a new branch. Creates a copy with shared history but independent from this point. Great for branching off experiments.",
    {
      workspaceId: z.string().describe("ID of the workspace to fork"),
      branchName: z.string().describe("Name for the new branch"),
      title: z.string().optional().describe("Title for the forked workspace"),
    },
    async ({ workspaceId, branchName, title }) => {
      try {
        const result = await client.forkWorkspace(workspaceId, branchName, title);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        const newId = result.data?.metadata?.id ?? "unknown";
        return {
          content: [{ type: "text" as const, text: `Forked workspace.\nNew workspace ID: ${newId}\nBranch: ${branchName}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Rename workspace ──────────────────────────────────────────────

  server.tool(
    "workbench_rename_workspace",
    "Rename a workspace's title.",
    {
      workspaceId: z.string().describe("ID of the workspace"),
      title: z.string().describe("New title"),
    },
    async ({ workspaceId, title }) => {
      try {
        const result = await client.renameWorkspace(workspaceId, title);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Workspace renamed to: ${title}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  // ── Archive/unarchive workspace ───────────────────────────────────

  server.tool(
    "workbench_archive_workspace",
    "Archive a workspace (hide from default list, keep history).",
    {
      workspaceId: z.string().describe("ID of the workspace"),
    },
    async ({ workspaceId }) => {
      try {
        const result = await client.archiveWorkspace(workspaceId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Workspace ${workspaceId} archived.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "workbench_unarchive_workspace",
    "Unarchive a previously archived workspace.",
    {
      workspaceId: z.string().describe("ID of the workspace"),
    },
    async ({ workspaceId }) => {
      try {
        const result = await client.unarchiveWorkspace(workspaceId);
        if (!result.success) {
          return {
            content: [{ type: "text" as const, text: `Failed: ${result.error}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: `Workspace ${workspaceId} unarchived.` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
