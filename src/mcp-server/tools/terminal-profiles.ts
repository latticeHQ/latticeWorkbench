/**
 * Terminal profile tools: detect installed CLI tools, manage profile configs,
 * and get install recipes.
 *
 * Terminal profiles represent external CLI tools (claude-code, gemini-cli,
 * github-copilot, aider, codex, amp) that can be launched in Lattice terminal
 * sessions. These tools let you discover what's installed, enable/disable
 * profiles, and get install instructions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerTerminalProfileTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List terminal profiles ──────────────────────────────────────────────
  server.tool(
    "terminal_profiles_list",
    "List all known terminal profiles (AI agents, shells, tools) with auto-detection status. " +
      "Shows which CLI tools are installed, their detected paths, user config " +
      "(enabled/disabled, command overrides), and group (platform/community). " +
      "Platform profiles: claude-code, gemini-cli, github-copilot, codex. " +
      "Community profiles: aider, amp.",
    {},
    () =>
      withErrorHandling(async () => {
        const profiles = await client.terminalProfiles.list();
        return {
          content: [
            jsonContent({
              message: `Found ${profiles.length} terminal profiles`,
              profiles: profiles.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                command: p.command,
                defaultArgs: p.defaultArgs,
                description: p.description,
                category: p.category,
                group: (p as any).group ?? "community",
                installed: p.detection.installed,
                commandPath: p.detection.commandPath,
                version: p.detection.version,
                enabled: p.config.enabled,
                commandOverride: p.config.commandOverride,
                argsOverride: p.config.argsOverride,
                env: p.config.env,
                installRecipes: p.installRecipes,
                isCustom: p.isCustom,
              })),
            }),
          ],
        };
      })
  );

  // ── Set profile config ──────────────────────────────────────────────────
  server.tool(
    "terminal_profiles_set_config",
    "Update configuration for a terminal profile. Enable/disable a profile, " +
      "set command overrides, args overrides, or environment variables. " +
      "Changes are persisted to ~/.lattice/config.json.",
    {
      profileId: z
        .string()
        .describe("Profile ID (e.g. 'claude-code', 'gemini-cli', 'aider')"),
      enabled: z.boolean().describe("Whether this profile is enabled"),
      commandOverride: z
        .string()
        .optional()
        .describe("Override the default command (e.g. custom path to binary)"),
      argsOverride: z
        .array(z.string())
        .optional()
        .describe("Override the default arguments"),
      env: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional environment variables for this profile"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.terminalProfiles.setConfig({
          profileId: params.profileId,
          config: {
            enabled: params.enabled,
            commandOverride: params.commandOverride,
            argsOverride: params.argsOverride,
            env: params.env,
          },
        });
        return {
          content: [
            jsonContent({
              message: `Profile '${params.profileId}' config updated`,
              profileId: params.profileId,
              enabled: params.enabled,
            }),
          ],
        };
      })
  );

  // ── Get install recipe ──────────────────────────────────────────────────
  server.tool(
    "terminal_profiles_get_install_recipe",
    "Get install instructions for a terminal profile on the given runtime type. " +
      "Returns install commands (npm, pip, brew, curl, gh-extension) appropriate " +
      "for the runtime environment.",
    {
      profileId: z
        .string()
        .describe("Profile ID (e.g. 'claude-code', 'gemini-cli', 'codex')"),
      runtimeType: z
        .enum(["local", "worktree", "ssh", "docker", "devcontainer"])
        .describe("The runtime environment to get install recipes for"),
    },
    (params) =>
      withErrorHandling(async () => {
        const recipes = await client.terminalProfiles.getInstallRecipe({
          profileId: params.profileId,
          runtimeType: params.runtimeType,
        });
        return {
          content: [
            jsonContent({
              profileId: params.profileId,
              runtimeType: params.runtimeType,
              recipes:
                recipes.length > 0
                  ? recipes
                  : [{ message: "No install recipe available for this profile/runtime" }],
            }),
          ],
        };
      })
  );
}
