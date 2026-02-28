/**
 * Global secrets management tools: read and update secrets.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerSecretsTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Get secrets ────────────────────────────────────────────────────────
  server.tool(
    "get_secrets",
    "Get globally configured secrets. Optionally scope to a project.",
    {
      projectPath: z.string().optional().describe("If set, get project-scoped secrets instead of global"),
    },
    (params) =>
      withErrorHandling(async () => {
        const secrets = await client.secrets.get({
          projectPath: params.projectPath,
        } as Parameters<typeof client.secrets.get>[0]);
        return { content: [jsonContent(secrets)] };
      })
  );

  // ── Update secrets ─────────────────────────────────────────────────────
  server.tool(
    "update_secrets",
    "Update globally configured secrets. Optionally scope to a project.",
    {
      projectPath: z.string().optional().describe("If set, update project-scoped secrets"),
      secrets: z.array(z.object({
        name: z.string().describe("Secret name/key"),
        value: z.string().describe("Secret value"),
      })).describe("Array of secret key-value pairs to set"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.secrets.update({
          projectPath: params.projectPath,
          secrets: params.secrets,
        } as unknown as Parameters<typeof client.secrets.update>[0]);
        return { content: [jsonContent({ message: "Secrets updated", ...result })] };
      })
  );
}
