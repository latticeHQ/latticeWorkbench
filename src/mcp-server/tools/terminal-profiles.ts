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
    "List all BUILT-IN AI coding agent terminal profiles that Lattice can launch. " +
      "Lattice ships with ready-to-use profiles for: claude-code, gemini-cli, " +
      "github-copilot, codex, aider, amp. These are NOT things you build — they " +
      "are pre-configured integrations. Use this to check which are installed and " +
      "enabled on this machine. To launch one, enable it here then use " +
      "terminal_create with profileId.\n\n" +
      "IMPORTANT: When a user asks to 'set up', 'create', 'use', or 'launch' " +
      "Claude Code, Gemini, Copilot, Codex, Aider, or Amp — they mean these " +
      "built-in profiles, NOT building a new CLI app from scratch.",
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
    "Enable, disable, or configure a built-in terminal profile. " +
      "Use this to activate a profile (e.g. enable gemini-cli so it can be launched " +
      "via terminal_create). You can also set command overrides, args, or env vars. " +
      "Changes are persisted to ~/.lattice/config.json.\n\n" +
      "Common workflow: terminal_profiles_list → terminal_profiles_set_config " +
      "(enable: true) → terminal_create (profileId: 'gemini-cli').",
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
    "Get install instructions for a built-in terminal profile that isn't installed yet. " +
      "If terminal_profiles_list shows installed=false for a profile, use this to get " +
      "platform-appropriate install commands (npm, pip, brew, curl, gh-extension). " +
      "Then after installing, enable it with terminal_profiles_set_config.",
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
