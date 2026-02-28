/**
 * MCP tool registrations for sharing operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerSharingTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_share_status",
    "Get the sharing status of a notebook — whether it has a public link, who has access, etc.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const status = await client.sharing.getStatus(params.notebookId);
        return { content: [jsonContent(status)] };
      }),
  );

  server.tool(
    "nlm_toggle_public_link",
    "Enable or disable the public sharing link for a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
      enabled: z.boolean().describe("true to enable public link, false to disable"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.sharing.togglePublicLink(
          params.notebookId,
          params.enabled,
        );
        return {
          content: [
            jsonContent({
              success: true,
              message: `Public link ${params.enabled ? "enabled" : "disabled"}`,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_invite_collaborator",
    "Invite a collaborator to a notebook by email.",
    {
      notebookId: z.string().describe("The notebook ID"),
      email: z.string().email().describe("Email address of the collaborator"),
      role: z
        .enum(["editor", "viewer"])
        .optional()
        .describe("Role to assign (default: viewer)"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.sharing.inviteCollaborator(
          params.notebookId,
          params.email,
          params.role,
        );
        return {
          content: [
            jsonContent({
              success: true,
              message: `Invited ${params.email} as ${params.role ?? "viewer"}`,
            }),
          ],
        };
      }),
  );
}
