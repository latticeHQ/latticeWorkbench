/**
 * Project and minion configuration types.
 * Kept lightweight for preload script usage.
 */

import type { z } from "zod";
import type {
  ProjectConfigSchema,
  CrewConfigSchema,
  MinionConfigSchema,
} from "../orpc/schemas";
import type { TaskSettings, SidekickAiDefaults } from "./tasks";
import type { LayoutPresetsConfig } from "./uiLayouts";
import type { AgentAiDefaults } from "./agentAiDefaults";
import type { RuntimeEnablementId } from "./runtime";
import type { TerminalProfileConfig } from "./terminalProfile";
import type { ScheduledJob } from "./scheduler";
import type { SyncConfig } from "./sync";

export type Minion = z.infer<typeof MinionConfigSchema>;

export type CrewConfig = z.infer<typeof CrewConfigSchema>;

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export type FeatureFlagOverride = "default" | "on" | "off";

/**
 * Update channel preference for Electron desktop app.
 * Keep in sync with `UpdateChannelSchema` in `src/common/orpc/schemas/api.ts`.
 */
export type UpdateChannel = "stable" | "nightly";

export interface ProjectsConfig {
  projects: Map<string, ProjectConfig>;
  /**
   * Update channel preference for Electron desktop app. Defaults to "stable".
   */
  updateChannel?: UpdateChannel;
  /**
   * Bind host/interface for the desktop HTTP/WS API server.
   *
   * When unset, lattice binds to 127.0.0.1 (localhost only).
   * When set to 0.0.0.0 or ::, lattice can be reachable from other devices on your LAN/VPN.
   */
  apiServerBindHost?: string;
  /**
   * Port for the desktop HTTP/WS API server.
   *
   * When unset, lattice binds to port 0 (random available port).
   */
  apiServerPort?: number;
  /**
   * When true, the desktop HTTP server also serves the lattice web UI at /.
   *
   * This enables other devices (LAN/VPN) to open lattice in a browser.
   */
  apiServerServeWebUi?: boolean;
  /**
   * Advertise the API server on the local network via mDNS/Bonjour (DNS-SD).
   *
   * When unset, lattice uses "auto" behavior (advertise only when apiServerBindHost is non-loopback).
   */
  mdnsAdvertisementEnabled?: boolean;
  /** Optional mDNS DNS-SD service instance name override. */
  mdnsServiceName?: string;
  /** SSH hostname/alias for this machine (used for editor deep links in browser mode) */
  serverSshHost?: string;
  /**
   * Optional GitHub username allowed to authenticate server/browser mode via Device Flow.
   *
   * When unset, GitHub login is disabled and token-only auth remains in effect.
   */
  serverAuthGithubOwner?: string;
  /**
   * Default parent directory for new projects (cloning and bare-name creation).
   *
   * When unset, falls back to getLatticeProjectsDir() (~/.lattice/projects).
   */
  defaultProjectDir?: string;
  /** IDs of splash screens that have been viewed */
  viewedSplashScreens?: string[];
  /** Cross-client feature flag overrides (shared via ~/.lattice/config.json). */
  featureFlagOverrides?: Record<string, FeatureFlagOverride>;
  /** Global task settings (agent sub-minions, queue limits, nesting depth) */
  taskSettings?: TaskSettings;
  /** UI layout presets + hotkeys (shared via ~/.lattice/config.json). */
  layoutPresets?: LayoutPresetsConfig;
  /**
   * Lattice Gateway routing preferences (shared via ~/.lattice/config.json).
   * Mirrors browser localStorage so switching server ports doesn't reset the UI.
   */
  latticeGatewayEnabled?: boolean;
  latticeGatewayModels?: string[];

  /**
   * Default model used for new minions (shared via ~/.lattice/config.json).
   * Mirrors the browser localStorage cache (DEFAULT_MODEL_KEY).
   */
  defaultModel?: string;
  /**
   * Hidden model IDs (shared via ~/.lattice/config.json).
   * Mirrors the browser localStorage cache (HIDDEN_MODELS_KEY).
   */
  hiddenModels?: string[];
  /**
   * Preferred model for compaction requests (shared via ~/.lattice/config.json).
   * Mirrors the browser localStorage cache (PREFERRED_COMPACTION_MODEL_KEY).
   */
  preferredCompactionModel?: string;

  /** Default model + thinking overrides per agentId (applies to UI agents and sidekicks). */
  agentAiDefaults?: AgentAiDefaults;
  /** @deprecated Legacy per-sidekick default model + thinking overrides. */
  sidekickAiDefaults?: SidekickAiDefaults;
  /** Use built-in SSH2 library instead of system OpenSSH for remote connections (non-Windows only) */
  useSSH2Transport?: boolean;

  /** Lattice Governor server URL (normalized origin, no trailing slash) */
  latticeGovernorUrl?: string;
  /** Lattice Governor OAuth access token (secret - never return to UI) */
  latticeGovernorToken?: string;

  /**
   * When true (default), archiving a Lattice minion will stop its dedicated lattice-created Lattice
   * minion first, and unarchiving will attempt to start it again.
   *
   * Stored as `false` only (undefined behaves as true) to keep config.json minimal.
   */
  stopLatticeMinionOnArchive?: boolean;

  /** Global default runtime for new minions. */
  defaultRuntime?: RuntimeEnablementId;

  /**
   * Override the default shell for local integrated terminals.
   *
   * When set, all local terminals (not SSH/Docker/Devcontainer) spawn this shell
   * instead of auto-detecting from $SHELL or platform defaults.
   *
   * Accepts an absolute path (e.g. "/usr/bin/fish") or a command name (e.g. "fish").
   */
  terminalDefaultShell?: string;

  /**
   * Runtime enablement overrides (shared via ~/.lattice/config.json).
   * Defaults to enabled; store `false` only to keep config.json minimal.
   */
  runtimeEnablement?: Partial<Record<RuntimeEnablementId, false>>;

  /**
   * Terminal profile user configs (keyed by profile ID).
   * Known profiles use IDs from TERMINAL_PROFILE_DEFINITIONS;
   * custom profiles have additional fields (displayName, command, isCustom).
   */
  terminalProfiles?: Record<string, TerminalProfileConfig>;

  /** Scheduled agent jobs — global list, each job references a minion by ID. */
  schedules?: ScheduledJob[];

  /** GitHub sync backup configuration. */
  sync?: SyncConfig;

  /**
   * Lattice gateway WebSocket URL for inbox channel routing.
   * @deprecated — Use direct channel adapters (telegramBotToken, etc.) instead.
   */
  latticeGatewayUrl?: string;

  /**
   * Telegram bot token for the direct Telegram adapter.
   * Obtained from @BotFather on Telegram. When set, Lattice connects
   * directly to Telegram's Bot API via grammY long-polling.
   * Env var LATTICE_TELEGRAM_BOT_TOKEN takes precedence.
   */
  telegramBotToken?: string;

  /**
   * Whether telemetry (PostHog analytics) is enabled.
   *
   * Default ON (undefined = enabled). Stored as `false` only to keep config.json minimal.
   * The env var LATTICE_DISABLE_TELEMETRY=1 always takes precedence over this setting.
   */
  telemetryEnabled?: boolean;

  /**
   * NotebookLM integration configuration.
   *
   * Controls the built-in NotebookLM MCP server that provides AI notebook,
   * audio/video generation, research, and studio artifact tools via Google's
   * NotebookLM service.
   *
   * Default ON (undefined = enabled).
   */
  notebooklm?: {
    enabled?: boolean;
  };
}
