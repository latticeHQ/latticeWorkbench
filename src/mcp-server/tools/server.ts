/**
 * Server management tools: API server status, SSH host, auth sessions,
 * feature flags, policy, and update management.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerServerTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── API server status ──────────────────────────────────────────────────
  server.tool(
    "get_api_server_status",
    "Get current API server status including running state, port, URLs, and auth token.",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await client.server.getApiServerStatus();
        return { content: [jsonContent(status)] };
      })
  );

  // ── Set API server settings ────────────────────────────────────────────
  server.tool(
    "set_api_server_settings",
    "Configure and restart the API server with new bind settings.",
    {
      bindHost: z.string().nullable().optional().describe("Bind host (null for default)"),
      port: z.number().nullable().optional().describe("Port number (null for default)"),
      serveWebUi: z.boolean().nullable().optional().describe("Whether to serve the web UI"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.server.setApiServerSettings({
          bindHost: params.bindHost ?? null,
          port: params.port ?? null,
          serveWebUi: params.serveWebUi,
        });
        return { content: [jsonContent({ message: "API server settings updated", ...result })] };
      })
  );

  // ── SSH host ───────────────────────────────────────────────────────────
  server.tool(
    "get_ssh_host",
    "Get the SSH host configured for the server.",
    {},
    () =>
      withErrorHandling(async () => {
        const host = await client.server.getSshHost();
        return { content: [jsonContent({ sshHost: host })] };
      })
  );

  server.tool(
    "set_ssh_host",
    "Set or clear the SSH host for the server.",
    {
      sshHost: z.string().nullable().describe("SSH host string (null to clear)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.server.setSshHost({ sshHost: params.sshHost });
        return { content: [jsonContent({ message: "SSH host updated", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Launch project ─────────────────────────────────────────────────────
  server.tool(
    "get_launch_project",
    "Get the project path configured to open on launch.",
    {},
    () =>
      withErrorHandling(async () => {
        const project = await client.server.getLaunchProject();
        return { content: [jsonContent(project)] };
      })
  );

  // ── Auth sessions ──────────────────────────────────────────────────────
  server.tool(
    "list_auth_sessions",
    "List all active server auth sessions. Current session is marked.",
    {},
    () =>
      withErrorHandling(async () => {
        const sessions = await client.serverAuth.listSessions();
        return { content: [jsonContent(sessions)] };
      })
  );

  server.tool(
    "revoke_auth_session",
    "Revoke a specific auth session token.",
    {
      sessionId: z.string().describe("Session ID to revoke"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.serverAuth.revokeSession({ sessionId: params.sessionId });
        return { content: [jsonContent({ message: "Session revoked", ...result })] };
      })
  );

  server.tool(
    "revoke_other_auth_sessions",
    "Revoke all auth sessions except the current one.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.serverAuth.revokeOtherSessions();
        return { content: [jsonContent({ message: "Other sessions revoked", ...result })] };
      })
  );

  // ── Feature flags ──────────────────────────────────────────────────────
  server.tool(
    "get_stats_tab_state",
    "Get the current stats tab feature flag state (variant + override).",
    {},
    () =>
      withErrorHandling(async () => {
        const state = await client.features.getStatsTabState();
        return { content: [jsonContent(state)] };
      })
  );

  server.tool(
    "set_stats_tab_override",
    "Manually override the stats tab feature flag.",
    {
      override: z.enum(["default", "on", "off"]).describe("Override value"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.features.setStatsTabOverride({ override: params.override });
        return { content: [jsonContent({ message: "Stats tab override set", ...result })] };
      })
  );

  // ── Policy ─────────────────────────────────────────────────────────────
  server.tool(
    "get_policy",
    "Get the current effective policy (admin-enforced configuration).",
    {},
    () =>
      withErrorHandling(async () => {
        const policy = await client.policy.get();
        return { content: [jsonContent(policy)] };
      })
  );

  server.tool(
    "refresh_policy",
    "Force re-read of the policy file from disk.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.policy.refreshNow();
        return { content: [jsonContent({ message: "Policy refreshed", ...result })] };
      })
  );

  // ── Update management ──────────────────────────────────────────────────
  server.tool(
    "check_for_updates",
    "Trigger an update check for the Lattice application.",
    {
      source: z.enum(["auto", "manual"]).optional().describe("Check source type"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.update.check({ source: params.source });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "download_update",
    "Download the available update.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.update.download();
        return { content: [jsonContent({ message: "Update download started", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  server.tool(
    "install_update",
    "Install a downloaded update and relaunch the application.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.update.install();
        return { content: [jsonContent({ message: "Update installed", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  server.tool(
    "get_update_channel",
    "Get the current update channel ('stable' or 'nightly').",
    {},
    () =>
      withErrorHandling(async () => {
        const channel = await client.update.getChannel();
        return { content: [jsonContent(channel)] };
      })
  );

  server.tool(
    "set_update_channel",
    "Switch the update channel between 'stable' and 'nightly'.",
    {
      channel: z.enum(["stable", "nightly"]).describe("Update channel"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.update.setChannel({ channel: params.channel });
        return { content: [jsonContent({ message: "Update channel changed", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Signing ────────────────────────────────────────────────────────────
  server.tool(
    "get_signing_capabilities",
    "Get SSH signing capabilities (public key, GitHub user, errors).",
    {},
    () =>
      withErrorHandling(async () => {
        const caps = await client.signing.capabilities({});
        return { content: [jsonContent(caps)] };
      })
  );

  server.tool(
    "sign_message",
    "Sign content with the SSH key. Returns a signature envelope.",
    {
      content: z.string().describe("Content to sign"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.signing.signMessage({ content: params.content });
        return { content: [jsonContent(result)] };
      })
  );

  server.tool(
    "clear_identity_cache",
    "Clear cached GitHub identity detection results.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.signing.clearIdentityCache({});
        return { content: [jsonContent({ message: "Identity cache cleared", ...result })] };
      })
  );

  // ── Lattice integration ──────────────────────────────────────────────────
  server.tool(
    "get_lattice_info",
    "Get Lattice CLI availability status and version info.",
    {},
    () =>
      withErrorHandling(async () => {
        const info = await client.lattice.getInfo();
        return { content: [jsonContent(info)] };
      })
  );

  server.tool(
    "list_lattice_templates",
    "List available Lattice minion templates.",
    {},
    () =>
      withErrorHandling(async () => {
        const templates = await client.lattice.listTemplates();
        return { content: [jsonContent(templates)] };
      })
  );

  server.tool(
    "list_lattice_presets",
    "List presets for a Lattice minion template.",
    {
      template: z.string().describe("Template name"),
      org: z.string().optional().describe("Organization name"),
    },
    (params) =>
      withErrorHandling(async () => {
        const presets = await client.lattice.listPresets({
          template: params.template,
          org: params.org,
        });
        return { content: [jsonContent(presets)] };
      })
  );

  server.tool(
    "list_lattice_minions",
    "List existing Lattice minions.",
    {},
    () =>
      withErrorHandling(async () => {
        const minions = await client.lattice.listMinions();
        return { content: [jsonContent(minions)] };
      })
  );

  // ── Name generation ────────────────────────────────────────────────────
  server.tool(
    "generate_name",
    "Generate a git-safe branch name and human-readable title from a message using AI.",
    {
      message: z.string().describe("The message/description to generate a name from"),
      candidates: z.array(z.string()).optional().describe("Existing branch names to avoid conflicts"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.nameGeneration.generate({
          message: params.message,
          candidates: params.candidates ?? [],
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Telemetry status ───────────────────────────────────────────────────
  server.tool(
    "get_telemetry_status",
    "Get telemetry enabled state and whether it was explicitly disabled.",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await client.telemetry.status();
        return { content: [jsonContent(status)] };
      })
  );

  // ── Experiments ────────────────────────────────────────────────────────
  server.tool(
    "get_experiments",
    "Get all PostHog experiment values (value + source per experiment).",
    {},
    () =>
      withErrorHandling(async () => {
        const experiments = await client.experiments.getAll();
        return { content: [jsonContent(experiments)] };
      })
  );

  server.tool(
    "reload_experiments",
    "Force refresh all experiment values from PostHog.",
    {},
    () =>
      withErrorHandling(async () => {
        const result = await client.experiments.reload();
        return { content: [jsonContent({ message: "Experiments reloaded", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Telemetry tracking ─────────────────────────────────────────────────
  server.tool(
    "track_telemetry_event",
    "Report a structured telemetry event. Used for analytics and usage tracking.",
    {
      eventType: z.string().describe("Event type identifier"),
      properties: z.record(z.string(), z.unknown()).optional().describe("Event properties"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.telemetry.track({
          eventType: params.eventType,
          properties: params.properties,
        } as unknown as Parameters<typeof client.telemetry.track>[0]);
        return { content: [jsonContent({ message: "Telemetry event tracked" })] };
      })
  );

  // ── Voice transcription ────────────────────────────────────────────────
  server.tool(
    "transcribe_audio",
    "Transcribe base64-encoded audio via OpenAI Whisper. Returns the transcribed text.",
    {
      audioBase64: z.string().describe("Base64-encoded audio data"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.voice.transcribe({ audioBase64: params.audioBase64 });
        return { content: [jsonContent(result)] };
      })
  );

  // ── SSH prompt response ────────────────────────────────────────────────
  server.tool(
    "respond_to_ssh_prompt",
    "Respond to an interactive SSH prompt (e.g. passphrase, host key acceptance). " +
      "Note: SSH prompts arrive via subscription events — this tool sends the response.",
    {
      requestId: z.string().describe("The SSH prompt request ID"),
      response: z.string().describe("The response to the prompt"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.ssh.prompt.respond({
          requestId: params.requestId,
          response: params.response,
        } as Parameters<typeof client.ssh.prompt.respond>[0]);
        return { content: [jsonContent({ message: "SSH prompt response sent" })] };
      })
  );

  // ── UI Layouts ─────────────────────────────────────────────────────────
  server.tool(
    "get_ui_layouts",
    "Get all saved panel layout presets configuration.",
    {},
    () =>
      withErrorHandling(async () => {
        const layouts = await client.uiLayouts.getAll();
        return { content: [jsonContent(layouts)] };
      })
  );

  server.tool(
    "save_ui_layouts",
    "Save all panel layout presets configuration.",
    {
      layouts: z.unknown().describe("The complete layouts configuration object to save"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.uiLayouts.saveAll(
          params.layouts as Parameters<typeof client.uiLayouts.saveAll>[0]
        );
        return { content: [jsonContent({ message: "UI layouts saved", ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Lattice identity ──────────────────────────────────────────────────
  server.tool(
    "lattice_whoami",
    "Get the currently authenticated Lattice identity (user info, org, role).",
    {},
    () =>
      withErrorHandling(async () => {
        const identity = await client.lattice.whoami();
        return { content: [jsonContent(identity)] };
      })
  );

  server.tool(
    "lattice_login",
    "Log in to the Lattice service. Provide the deployment URL and session token.",
    {
      url: z.string().describe("Lattice deployment URL"),
      sessionToken: z.string().describe("Session token for authentication"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.lattice.login({
          url: params.url,
          sessionToken: params.sessionToken,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Telemetry control ─────────────────────────────────────────────────
  server.tool(
    "set_telemetry_enabled",
    "Enable or disable telemetry data collection.",
    {
      enabled: z.boolean().describe("Whether to enable telemetry"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.telemetry.setEnabled({
          enabled: params.enabled,
        } as Parameters<typeof client.telemetry.setEnabled>[0]);
        return { content: [jsonContent({ message: `Telemetry ${params.enabled ? "enabled" : "disabled"}`, ...(result as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Inference status ──────────────────────────────────────────────────
  server.tool(
    "get_inference_status",
    "Get the current status of the inference engine (model loading, availability, errors).",
    {},
    () =>
      withErrorHandling(async () => {
        const status = await client.inference.getStatus();
        return { content: [jsonContent(status)] };
      })
  );
}
