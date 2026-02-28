/**
 * Configuration, provider, and preference tools.
 *
 * Covers global config (task settings, model prefs, runtime enablement)
 * and provider management (list, configure, set models).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerConfigTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List providers ─────────────────────────────────────────────────────
  server.tool(
    "list_providers",
    "List all configured AI provider names (e.g. 'anthropic', 'openai', 'google').",
    {},
    () =>
      withErrorHandling(async () => {
        const providers = await client.providers.list();
        return { content: [jsonContent({ providers })] };
      })
  );

  // ── Get config (read) ──────────────────────────────────────────────────
  server.tool(
    "get_config",
    "Read the global Lattice configuration including default models, runtime settings, " +
      "task concurrency, and other preferences.",
    {},
    () =>
      withErrorHandling(async () => {
        const config = await client.config.getConfig();
        return { content: [jsonContent(config)] };
      })
  );

  // ── Save config (task settings + agent AI defaults) ────────────────────
  server.tool(
    "save_config",
    "Save task concurrency/nesting settings and optionally agent AI defaults.",
    {
      taskSettings: z.object({
        maxConcurrentTasks: z.number().optional().describe("Max concurrent tasks"),
        maxTaskNesting: z.number().optional().describe("Max task nesting depth"),
      }).describe("Task concurrency settings"),
      agentAiDefaults: z.record(z.string(), z.object({
        modelString: z.string().optional(),
        thinkingLevel: z.string().optional(),
        enabled: z.boolean().optional(),
      })).optional().describe("Per-agent-type AI defaults"),
      sidekickAiDefaults: z.record(z.string(), z.object({
        modelString: z.string().optional(),
        thinkingLevel: z.string().optional(),
        enabled: z.boolean().optional(),
      })).optional().describe("Per-sidekick-type AI defaults"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.config.saveConfig({
          taskSettings: params.taskSettings,
          agentAiDefaults: params.agentAiDefaults,
          sidekickAiDefaults: params.sidekickAiDefaults,
        } as Parameters<typeof client.config.saveConfig>[0]);
        return { content: [jsonContent({ message: "Config saved", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Update agent AI defaults ───────────────────────────────────────────
  server.tool(
    "update_agent_ai_defaults",
    "Update per-agent-type model/thinking defaults (e.g. set default model for 'lattice' agent).",
    {
      agentAiDefaults: z.record(z.string(), z.object({
        modelString: z.string().optional().describe("Model string (e.g. 'claude-sonnet-4-20250514')"),
        thinkingLevel: z.string().optional().describe("Thinking level (off/low/medium/high/xhigh/max)"),
        enabled: z.boolean().optional().describe("Whether this agent type is enabled"),
      })).describe("Map of agentType → AI settings"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.config.updateAgentAiDefaults({
          agentAiDefaults: params.agentAiDefaults,
        } as Parameters<typeof client.config.updateAgentAiDefaults>[0]);
        return { content: [jsonContent({ message: "Agent AI defaults updated", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Update model preferences ───────────────────────────────────────────
  server.tool(
    "update_model_preferences",
    "Set the default model, hide specific models, or set the preferred compaction model.",
    {
      defaultModel: z.string().optional().describe("Default model string for all new minions"),
      hiddenModels: z.array(z.string()).optional().describe("List of model strings to hide from UI"),
      preferredCompactionModel: z.string().optional().describe("Model to use for context compaction"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.config.updateModelPreferences({
          defaultModel: params.defaultModel,
          hiddenModels: params.hiddenModels,
          preferredCompactionModel: params.preferredCompactionModel,
        } as Parameters<typeof client.config.updateModelPreferences>[0]);
        return { content: [jsonContent({ message: "Model preferences updated", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Update runtime enablement ──────────────────────────────────────────
  server.tool(
    "update_runtime_enablement",
    "Enable/disable runtime types (local, SSH, worktree) globally or per-project.",
    {
      projectPath: z.string().optional().describe("If set, apply to this project only; otherwise global"),
      runtimeEnablement: z.record(z.string(), z.boolean()).optional().describe("Map of runtimeType → enabled"),
      defaultRuntime: z.string().optional().describe("Default runtime type for new minions"),
      runtimeOverridesEnabled: z.boolean().optional().describe("Whether per-project runtime overrides are enabled"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.config.updateRuntimeEnablement({
          projectPath: params.projectPath,
          runtimeEnablement: params.runtimeEnablement,
          defaultRuntime: params.defaultRuntime,
          runtimeOverridesEnabled: params.runtimeOverridesEnabled,
        } as Parameters<typeof client.config.updateRuntimeEnablement>[0]);
        return { content: [jsonContent({ message: "Runtime enablement updated", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Update Lattice preferences ───────────────────────────────────────────
  server.tool(
    "update_lattice_prefs",
    "Configure Lattice minion behavior (e.g. stop Lattice minion on bench).",
    {
      stopLatticeMinionOnArchive: z.boolean().describe("Stop Lattice minion when archiving"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.config.updateLatticePrefs({
          stopLatticeMinionOnArchive: params.stopLatticeMinionOnArchive,
        });
        return { content: [jsonContent({ message: "Lattice preferences updated", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Provider config (detailed) ─────────────────────────────────────────
  server.tool(
    "get_provider_config",
    "Get full provider configuration map with API key status, enabled models, and status per provider.",
    {},
    () =>
      withErrorHandling(async () => {
        const config = await client.providers.getConfig();
        return { content: [jsonContent(config)] };
      })
  );

  // ── Set provider config field ──────────────────────────────────────────
  server.tool(
    "set_provider_config",
    "Set a specific field in a provider's config (e.g. API key, base URL).",
    {
      provider: z.string().describe("Provider name (e.g. 'anthropic', 'openai')"),
      keyPath: z.array(z.string()).describe("Path to the config field (e.g. ['apiKey'])"),
      value: z.string().describe("Value to set"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.providers.setProviderConfig({
          provider: params.provider,
          keyPath: params.keyPath,
          value: params.value,
        });
        return { content: [jsonContent({ message: "Provider config updated", ...result })] };
      })
  );

  // ── Set provider models ────────────────────────────────────────────────
  server.tool(
    "set_provider_models",
    "Set the model list for a provider.",
    {
      provider: z.string().describe("Provider name"),
      models: z.array(z.object({
        id: z.string().describe("Model ID"),
        name: z.string().optional().describe("Display name"),
        enabled: z.boolean().optional().describe("Whether model is enabled"),
      })).describe("Array of model entries"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.providers.setModels({
          provider: params.provider,
          models: params.models,
        } as Parameters<typeof client.providers.setModels>[0]);
        return { content: [jsonContent({ message: "Provider models updated", ...result })] };
      })
  );

  // ── Unenroll Lattice Governor ──────────────────────────────────────────────
  server.tool(
    "unenroll_lattice_governor",
    "Remove Lattice Governor enrollment credentials.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.config.unenrollLatticeGovernor();
        return { content: [jsonContent({ message: "Unenrolled from Lattice Governor", ...(result as unknown as Record<string, unknown>) })] };
      })
  );
}
