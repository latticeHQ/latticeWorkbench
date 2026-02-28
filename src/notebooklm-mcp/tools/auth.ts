/**
 * MCP tool registrations for authentication operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";
import {
  loadDefaultProfile,
  listProfiles,
} from "../auth/cookieManager";
import { extractCookiesFromCdp } from "../auth/cdpExtractor";

export function registerAuthTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_auth_status",
    "Check the current NotebookLM authentication status. Returns whether cookies and tokens are loaded and which profile is active.",
    {},
    () =>
      withErrorHandling(async () => {
        const isAuthenticated = client.isAuthenticated();
        const profile = loadDefaultProfile();
        const profiles = listProfiles();

        return {
          content: [
            jsonContent({
              authenticated: isAuthenticated,
              activeProfile: profile ? "default" : null,
              hasCookies: profile !== null,
              availableProfiles: profiles,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_auth_extract_cookies",
    "Extract Google authentication cookies from a running Chrome instance via Chrome DevTools Protocol. Chrome must be running with --remote-debugging-port enabled.",
    {
      port: z
        .number()
        .optional()
        .describe("Chrome remote debugging port (default: 9222)"),
      profile: z
        .string()
        .optional()
        .describe("Profile name to save cookies under (default: 'default')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const cookies = await extractCookiesFromCdp(params.port ?? 9222);

        // Re-initialize the client with new cookies
        await client.init();

        return {
          content: [
            jsonContent({
              success: true,
              message: "Cookies extracted and saved. Client re-initialized.",
              cookieCount: Object.keys(cookies).length,
            }),
          ],
        };
      }),
  );
}
