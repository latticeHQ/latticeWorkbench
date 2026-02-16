/**
 * Config MCP tools — providers, models, workbench info, workspace activity.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbenchClient } from "../client.js";

export function registerConfigTools(server: McpServer, client: WorkbenchClient): void {
  // ── List providers ────────────────────────────────────────────────

  server.tool(
    "workbench_list_providers",
    "List all configured AI providers (OpenAI, Anthropic, Google, etc.) and their status.",
    {},
    async () => {
      try {
        const providers = await client.listProviders();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(providers, null, 2) }],
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

  // ── List models ───────────────────────────────────────────────────

  server.tool(
    "workbench_list_models",
    "List all available AI models (local and remote) with their format, size, and backend info.",
    {},
    async () => {
      try {
        const models = await client.listModels();

        if (!models || models.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No models available." }],
          };
        }

        const lines: string[] = [];
        lines.push(`MODELS (${models.length})\n`);

        for (const m of models) {
          const size = m.sizeBytes ? `${(m.sizeBytes / 1e9).toFixed(1)}GB` : "?";
          lines.push(`  ${m.id}`);
          lines.push(`    Name: ${m.name} | Format: ${m.format ?? "?"} | Size: ${size}`);
          if (m.quantization) lines.push(`    Quant: ${m.quantization}`);
          if (m.backend) lines.push(`    Backend: ${m.backend}`);
          lines.push("");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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

  // ── Inference status ──────────────────────────────────────────────

  server.tool(
    "workbench_inference_status",
    "Check if the local inference engine is available and which model is loaded.",
    {},
    async () => {
      try {
        const status = await client.getInferenceStatus();
        const text = status.available
          ? `Inference: AVAILABLE\nLoaded model: ${status.loadedModelId ?? "none"}`
          : "Inference: NOT AVAILABLE";
        return { content: [{ type: "text" as const, text }] };
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

  // ── Workspace activity status ─────────────────────────────────────

  server.tool(
    "workbench_workspace_activity",
    "Get activity status for all workspaces — shows which are idle, streaming, or busy.",
    {},
    async () => {
      try {
        const activity = await client.listWorkspaceActivity();
        const entries = Object.entries(activity);

        if (entries.length === 0) {
          return { content: [{ type: "text" as const, text: "No workspace activity." }] };
        }

        const lines: string[] = [];
        lines.push(`WORKSPACE ACTIVITY (${entries.length})\n`);

        for (const [wsId, info] of entries) {
          const streaming = info.streaming ? " [STREAMING]" : "";
          const status = info.status ?? "unknown";
          lines.push(`  ${wsId.slice(0, 12)}… — ${status}${streaming}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
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

  // ── List directory ────────────────────────────────────────────────

  server.tool(
    "workbench_list_directory",
    "List files and folders in a directory. Returns a tree structure.",
    {
      path: z.string().describe("Absolute path to the directory"),
    },
    async ({ path: dirPath }) => {
      try {
        const tree = await client.listDirectory(dirPath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tree, null, 2) }],
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

  // ── Ping/health check ────────────────────────────────────────────

  server.tool(
    "workbench_ping",
    "Check if the workbench server is running and reachable.",
    {},
    async () => {
      try {
        const alive = await client.ping();
        return {
          content: [
            {
              type: "text" as const,
              text: alive ? "Workbench is running and healthy." : "Workbench is not responding.",
            },
          ],
          isError: !alive,
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
