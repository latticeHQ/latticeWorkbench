/**
 * MCP tool registrations for authentication operations.
 *
 * Authentication flow:
 * 1. Launch Chrome with remote debugging:
 *    agent-browser --profile ~/.lattice/notebooklm/chrome-profiles/default open https://notebooklm.google.com --headed
 *    Or: google-chrome --remote-debugging-port=9223 https://notebooklm.google.com
 * 2. Log in to Google in the browser
 * 3. Call nlm_auth_extract_cookies to grab the auth cookies
 * 4. Or use nlm_auth_launch_and_login for automated flow
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";
import {
  loadDefaultProfile,
  listProfiles,
} from "../auth/cookieManager";
import { extractCookiesFromCdp, launchAndExtract } from "../auth/cdpExtractor";

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
    "Extract Google authentication cookies from a running Chrome instance via CDP. " +
      "IMPORTANT: Do NOT use port 9222 (that's Electron). " +
      "First launch Chrome with debugging enabled:\n" +
      "  google-chrome --remote-debugging-port=9223 https://notebooklm.google.com\n" +
      "Then log in to Google and call this tool.",
    {
      port: z
        .number()
        .optional()
        .describe("Chrome remote debugging port (default: 9223). Do NOT use 9222 — that's Electron."),
      profile: z
        .string()
        .optional()
        .describe("Profile name to save cookies under (default: 'default')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const cookies = await extractCookiesFromCdp({
          host: "127.0.0.1",
          port: params.port ?? 9223,
        });

        if (Object.keys(cookies).length === 0) {
          return {
            content: [
              jsonContent({
                success: false,
                message: "No Google cookies found. Make sure you're logged in to Google in Chrome.",
                hint: "Launch Chrome: google-chrome --remote-debugging-port=9223 https://notebooklm.google.com",
              }),
            ],
          };
        }

        // Re-initialize the client with new cookies
        await client.init();

        return {
          content: [
            jsonContent({
              success: true,
              message: "Cookies extracted and client re-initialized.",
              cookieCount: Object.keys(cookies).length,
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_auth_launch_and_login",
    "Launch Chrome with Google NotebookLM and wait for the user to log in. " +
      "Opens a headed Chrome window pointing to notebooklm.google.com. " +
      "Polls for valid auth cookies until login is complete (up to 2 minutes). " +
      "Cookies are saved automatically for future sessions.",
    {
      profile: z
        .string()
        .optional()
        .describe("Profile name for persistent login (default: 'default')"),
      timeout: z
        .number()
        .optional()
        .describe("Max wait time in ms for login (default: 120000)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await launchAndExtract(
          params.profile ?? "default",
          params.timeout ?? 120_000,
        );

        // Re-initialize client with new cookies
        await client.init();

        return {
          content: [
            jsonContent({
              success: true,
              message: "Google login detected. Cookies saved and client initialized.",
              cookieCount: Object.keys(result.cookies).length,
              email: result.email,
            }),
          ],
        };
      }),
  );
}
