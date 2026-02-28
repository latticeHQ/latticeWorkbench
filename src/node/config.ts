import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as jsonc from "jsonc-parser";
import writeFileAtomic from "write-file-atomic";
import { log } from "@/node/services/log";
import type { MinionMetadata, FrontendMinionMetadata } from "@/common/types/minion";
import { secretsToRecord, type Secret, type SecretsConfig } from "@/common/types/secrets";
import type {
  Minion,
  ProjectConfig,
  ProjectsConfig,
  FeatureFlagOverride,
  UpdateChannel,
} from "@/common/types/project";
import type { TerminalProfileConfig } from "@/common/types/terminalProfile";
import {
  DEFAULT_TASK_SETTINGS,
  normalizeSidekickAiDefaults,
  normalizeTaskSettings,
} from "@/common/types/tasks";
import { isLayoutPresetsConfigEmpty, normalizeLayoutPresetsConfig } from "@/common/types/uiLayouts";
import { normalizeAgentAiDefaults } from "@/common/types/agentAiDefaults";
import { RUNTIME_ENABLEMENT_IDS, type RuntimeEnablementId } from "@/common/types/runtime";
import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";
import { isIncompatibleRuntimeConfig } from "@/common/utils/runtimeCompatibility";
import { getLatticeHome } from "@/common/constants/paths";
import { PlatformPaths } from "@/common/utils/paths";
import { isValidModelFormat } from "@/common/utils/ai/models";
import { stripTrailingSlashes } from "@/node/utils/pathUtils";
import { getContainerName as getDockerContainerName } from "@/node/runtime/DockerRuntime";

// Re-export project types from dedicated types file (for preload usage)
export type { Minion, ProjectConfig, ProjectsConfig };

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

function parseOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalEnvBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return undefined;
}
function parseOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseUpdateChannel(value: unknown): UpdateChannel | undefined {
  if (value === "stable" || value === "nightly") {
    return value;
  }

  return undefined;
}

function normalizeOptionalModelString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!isValidModelFormat(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function normalizeOptionalModelStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const out: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    const normalized = normalizeOptionalModelString(item);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function parseOptionalPort(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }

  if (value < 0 || value > 65535) {
    return undefined;
  }

  return value;
}

function normalizeRuntimeEnablementId(value: unknown): RuntimeEnablementId | undefined {
  const trimmed = parseOptionalNonEmptyString(value);
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (RUNTIME_ENABLEMENT_IDS.includes(normalized as RuntimeEnablementId)) {
    return normalized as RuntimeEnablementId;
  }

  return undefined;
}

function normalizeRuntimeEnablementOverrides(
  value: unknown
): Partial<Record<RuntimeEnablementId, false>> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const overrides: Partial<Record<RuntimeEnablementId, false>> = {};

  for (const runtimeId of RUNTIME_ENABLEMENT_IDS) {
    // Default ON: store `false` only so config.json stays minimal.
    if (record[runtimeId] === false) {
      overrides[runtimeId] = false;
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

/**
 * Defensive parse for terminal profiles stored in config.json.
 * Each entry must have `enabled: boolean` at minimum. Custom profiles also
 * carry displayName/command. Invalid entries are silently dropped.
 */
function normalizeTerminalProfiles(
  value: unknown
): Record<string, TerminalProfileConfig> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const result: Record<string, TerminalProfileConfig> = {};

  for (const [id, entry] of Object.entries(record)) {
    if (!id || typeof id !== "string" || !entry || typeof entry !== "object") continue;

    const cfg = entry as Record<string, unknown>;
    // Must have `enabled` boolean to be valid
    if (typeof cfg.enabled !== "boolean") continue;

    // Construct validated config; additional fields (commandOverride, argsOverride,
    // env, displayName, command, isCustom) are preserved for custom profiles.
    const profileConfig: TerminalProfileConfig = { enabled: cfg.enabled };
    if (typeof cfg.commandOverride === "string")
      profileConfig.commandOverride = cfg.commandOverride;
    if (Array.isArray(cfg.argsOverride)) profileConfig.argsOverride = cfg.argsOverride as string[];
    if (cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)) {
      profileConfig.env = cfg.env as Record<string, string>;
    }
    result[id] = profileConfig;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeProjectRuntimeSettings(projectConfig: ProjectConfig): ProjectConfig {
  // Per-project runtime overrides are optional; keep config.json sparse by persisting only explicit
  // overrides (false enablement + explicit default runtime selections).
  if (!projectConfig || typeof projectConfig !== "object") {
    return { minions: [] };
  }

  const record = projectConfig as ProjectConfig & {
    runtimeEnablement?: unknown;
    defaultRuntime?: unknown;
    runtimeOverridesEnabled?: unknown;
  };
  const runtimeEnablement = normalizeRuntimeEnablementOverrides(record.runtimeEnablement);
  const defaultRuntime = normalizeRuntimeEnablementId(record.defaultRuntime);
  const runtimeOverridesEnabled = record.runtimeOverridesEnabled === true ? true : undefined;

  const next = { ...record };
  if (runtimeEnablement) {
    next.runtimeEnablement = runtimeEnablement;
  } else {
    delete next.runtimeEnablement;
  }

  if (runtimeOverridesEnabled) {
    next.runtimeOverridesEnabled = runtimeOverridesEnabled;
  } else {
    delete next.runtimeOverridesEnabled;
  }

  if (defaultRuntime) {
    next.defaultRuntime = defaultRuntime;
  } else {
    delete next.defaultRuntime;
  }

  return next;
}
export type ProvidersConfig = Record<string, ProviderConfig>;

/**
 * Config - Centralized configuration management
 *
 * Encapsulates all config paths and operations, making them dependency-injectable
 * and testable. Pass a custom rootDir for tests to avoid polluting ~/.lattice
 */
export class Config {
  readonly rootDir: string;
  readonly sessionsDir: string;
  readonly srcDir: string;
  private readonly configFile: string;
  private readonly providersFile: string;
  private readonly secretsFile: string;

  constructor(rootDir?: string) {
    this.rootDir = rootDir ?? getLatticeHome();
    this.sessionsDir = path.join(this.rootDir, "sessions");
    this.srcDir = path.join(this.rootDir, "src");
    this.configFile = path.join(this.rootDir, "config.json");
    this.providersFile = path.join(this.rootDir, "providers.jsonc");
    this.secretsFile = path.join(this.rootDir, "secrets.json");
  }

  loadConfigOrDefault(): ProjectsConfig {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, "utf-8");
        const parsed = JSON.parse(data) as {
          projects?: unknown;
          apiServerBindHost?: unknown;
          apiServerPort?: unknown;
          apiServerServeWebUi?: unknown;
          mdnsAdvertisementEnabled?: unknown;
          mdnsServiceName?: unknown;
          serverSshHost?: string;
          serverAuthGithubOwner?: unknown;
          defaultProjectDir?: unknown;
          viewedSplashScreens?: string[];
          featureFlagOverrides?: Record<string, "default" | "on" | "off">;
          layoutPresets?: unknown;
          taskSettings?: unknown;
          defaultModel?: unknown;
          hiddenModels?: unknown;
          preferredCompactionModel?: unknown;
          agentAiDefaults?: unknown;
          sidekickAiDefaults?: unknown;
          useSSH2Transport?: unknown;
          latticeGovernorUrl?: unknown;
          latticeGovernorToken?: unknown;
          stopLatticeMinionOnArchive?: unknown;
          terminalDefaultShell?: unknown;
          updateChannel?: unknown;
          runtimeEnablement?: unknown;
          defaultRuntime?: unknown;
          terminalProfiles?: unknown;
          schedules?: unknown;
          sync?: unknown;
          latticeGatewayUrl?: unknown;
          telegramBotToken?: unknown;
          telemetryEnabled?: unknown;
        };

        // Config is stored as array of [path, config] pairs
        if (parsed.projects && Array.isArray(parsed.projects)) {
          const rawPairs = parsed.projects as Array<[string, ProjectConfig]>;
          // Migrate: normalize project paths by stripping trailing slashes
          // This fixes configs created with paths like "/home/user/project/"
          // Also filter out any malformed entries (null/undefined paths)
          const normalizedPairs = rawPairs
            .filter(([projectPath]) => {
              if (!projectPath || typeof projectPath !== "string") {
                log.warn("Filtering out project with invalid path", { projectPath });
                return false;
              }
              return true;
            })
            .map(([projectPath, projectConfig]) => {
              const normalizedProjectConfig = normalizeProjectRuntimeSettings(projectConfig);
              // Ensure minions array exists (old configs may lack this key)
              normalizedProjectConfig.minions ??= [];
              return [stripTrailingSlashes(projectPath), normalizedProjectConfig] as [
                string,
                ProjectConfig,
              ];
            });
          const projectsMap = new Map<string, ProjectConfig>(normalizedPairs);

          const taskSettings = normalizeTaskSettings(parsed.taskSettings);

          const defaultModel = normalizeOptionalModelString(parsed.defaultModel);
          const hiddenModels = normalizeOptionalModelStringArray(parsed.hiddenModels);
          const preferredCompactionModel = normalizeOptionalModelString(
            parsed.preferredCompactionModel
          );
          const legacySidekickAiDefaults = normalizeSidekickAiDefaults(parsed.sidekickAiDefaults);

          // Default ON: store `false` only so config.json stays minimal.
          const stopLatticeMinionOnArchive =
            parseOptionalBoolean(parsed.stopLatticeMinionOnArchive) === false ? false : undefined;
          const updateChannel = parseUpdateChannel(parsed.updateChannel);

          const runtimeEnablement = normalizeRuntimeEnablementOverrides(parsed.runtimeEnablement);
          const defaultRuntime = normalizeRuntimeEnablementId(parsed.defaultRuntime);

          // Terminal profiles: defensive parse — drop invalid entries, keep the rest
          const terminalProfiles = normalizeTerminalProfiles(parsed.terminalProfiles);

          // Default ON: store `false` only so config.json stays minimal.
          const telemetryEnabled =
            parseOptionalBoolean(parsed.telemetryEnabled) === false ? false : undefined;

          const agentAiDefaults =
            parsed.agentAiDefaults !== undefined
              ? normalizeAgentAiDefaults(parsed.agentAiDefaults)
              : normalizeAgentAiDefaults(legacySidekickAiDefaults);

          const layoutPresetsRaw = normalizeLayoutPresetsConfig(parsed.layoutPresets);
          const layoutPresets = isLayoutPresetsConfigEmpty(layoutPresetsRaw)
            ? undefined
            : layoutPresetsRaw;

          return {
            projects: projectsMap,
            apiServerBindHost: parseOptionalNonEmptyString(parsed.apiServerBindHost),
            apiServerServeWebUi: parseOptionalBoolean(parsed.apiServerServeWebUi)
              ? true
              : undefined,
            apiServerPort: parseOptionalPort(parsed.apiServerPort),
            mdnsAdvertisementEnabled: parseOptionalBoolean(parsed.mdnsAdvertisementEnabled),
            mdnsServiceName: parseOptionalNonEmptyString(parsed.mdnsServiceName),
            serverSshHost: parsed.serverSshHost,
            serverAuthGithubOwner: parseOptionalNonEmptyString(parsed.serverAuthGithubOwner),
            defaultProjectDir: parseOptionalNonEmptyString(parsed.defaultProjectDir),
            viewedSplashScreens: parsed.viewedSplashScreens,
            layoutPresets,
            taskSettings,
            defaultModel,
            hiddenModels,
            preferredCompactionModel,
            agentAiDefaults,
            // Legacy fields are still parsed and returned for downgrade compatibility.
            sidekickAiDefaults: legacySidekickAiDefaults,
            featureFlagOverrides: parsed.featureFlagOverrides,
            useSSH2Transport: parseOptionalBoolean(parsed.useSSH2Transport),
            latticeGovernorUrl: parseOptionalNonEmptyString(parsed.latticeGovernorUrl),
            latticeGovernorToken: parseOptionalNonEmptyString(parsed.latticeGovernorToken),
            stopLatticeMinionOnArchive,
            terminalDefaultShell: parseOptionalNonEmptyString(parsed.terminalDefaultShell),
            updateChannel,
            defaultRuntime,
            runtimeEnablement,
            terminalProfiles,
            schedules: Array.isArray(parsed.schedules) ? parsed.schedules as ProjectsConfig["schedules"] : undefined,
            // Sync config: pass through if it looks valid (has repoUrl string)
            sync: parsed.sync && typeof (parsed.sync as Record<string, unknown>).repoUrl === "string"
              ? parsed.sync as ProjectsConfig["sync"]
              : undefined,
            latticeGatewayUrl: parseOptionalNonEmptyString(parsed.latticeGatewayUrl),
            telegramBotToken: parseOptionalNonEmptyString(parsed.telegramBotToken),
            telemetryEnabled,
          };
        }
      }
    } catch (error) {
      log.error("Error loading config:", error);
    }

    // Return default config
    return {
      projects: new Map(),
      taskSettings: DEFAULT_TASK_SETTINGS,
      agentAiDefaults: {},
      sidekickAiDefaults: {},
    };
  }

  async saveConfig(config: ProjectsConfig): Promise<void> {
    try {
      if (!fs.existsSync(this.rootDir)) {
        fs.mkdirSync(this.rootDir, { recursive: true });
      }

      const data: {
        projects: Array<[string, ProjectConfig]>;
        apiServerBindHost?: string;
        apiServerPort?: number;
        apiServerServeWebUi?: boolean;
        mdnsAdvertisementEnabled?: boolean;
        mdnsServiceName?: string;
        serverSshHost?: string;
        serverAuthGithubOwner?: string;
        defaultProjectDir?: string;
        viewedSplashScreens?: string[];
        layoutPresets?: ProjectsConfig["layoutPresets"];
        featureFlagOverrides?: ProjectsConfig["featureFlagOverrides"];
        taskSettings?: ProjectsConfig["taskSettings"];
        defaultModel?: ProjectsConfig["defaultModel"];
        hiddenModels?: ProjectsConfig["hiddenModels"];
        preferredCompactionModel?: ProjectsConfig["preferredCompactionModel"];
        agentAiDefaults?: ProjectsConfig["agentAiDefaults"];
        sidekickAiDefaults?: ProjectsConfig["sidekickAiDefaults"];
        useSSH2Transport?: boolean;
        latticeGovernorUrl?: string;
        latticeGovernorToken?: string;
        stopLatticeMinionOnArchive?: boolean;
        terminalDefaultShell?: string;
        updateChannel?: UpdateChannel;
        runtimeEnablement?: ProjectsConfig["runtimeEnablement"];
        defaultRuntime?: ProjectsConfig["defaultRuntime"];
        terminalProfiles?: ProjectsConfig["terminalProfiles"];
        schedules?: ProjectsConfig["schedules"];
        sync?: ProjectsConfig["sync"];
        telegramBotToken?: string;
        telemetryEnabled?: boolean;
      } = {
        projects: Array.from(config.projects.entries()).map(
          ([projectPath, projectConfig]) =>
            [projectPath, normalizeProjectRuntimeSettings(projectConfig)] as [string, ProjectConfig]
        ),
        taskSettings: config.taskSettings ?? DEFAULT_TASK_SETTINGS,
      };

      const defaultModel = normalizeOptionalModelString(config.defaultModel);
      if (defaultModel !== undefined) {
        data.defaultModel = defaultModel;
      }

      const hiddenModels = normalizeOptionalModelStringArray(config.hiddenModels);
      if (hiddenModels !== undefined) {
        data.hiddenModels = hiddenModels;
      }

      const preferredCompactionModel = normalizeOptionalModelString(
        config.preferredCompactionModel
      );
      if (preferredCompactionModel !== undefined) {
        data.preferredCompactionModel = preferredCompactionModel;
      }
      const apiServerBindHost = parseOptionalNonEmptyString(config.apiServerBindHost);
      if (apiServerBindHost) {
        data.apiServerBindHost = apiServerBindHost;
      }

      const apiServerServeWebUi = parseOptionalBoolean(config.apiServerServeWebUi);
      if (apiServerServeWebUi) {
        data.apiServerServeWebUi = true;
      }

      const apiServerPort = parseOptionalPort(config.apiServerPort);
      if (apiServerPort !== undefined) {
        data.apiServerPort = apiServerPort;
      }

      const mdnsAdvertisementEnabled = parseOptionalBoolean(config.mdnsAdvertisementEnabled);
      if (mdnsAdvertisementEnabled !== undefined) {
        data.mdnsAdvertisementEnabled = mdnsAdvertisementEnabled;
      }

      const mdnsServiceName = parseOptionalNonEmptyString(config.mdnsServiceName);
      if (mdnsServiceName) {
        data.mdnsServiceName = mdnsServiceName;
      }

      if (config.serverSshHost) {
        data.serverSshHost = config.serverSshHost;
      }
      const serverAuthGithubOwner = parseOptionalNonEmptyString(config.serverAuthGithubOwner);
      if (serverAuthGithubOwner) {
        data.serverAuthGithubOwner = serverAuthGithubOwner;
      }
      const defaultProjectDir = parseOptionalNonEmptyString(config.defaultProjectDir);
      if (defaultProjectDir) {
        data.defaultProjectDir = defaultProjectDir;
      }
      if (config.featureFlagOverrides) {
        data.featureFlagOverrides = config.featureFlagOverrides;
      }
      if (config.layoutPresets) {
        const normalized = normalizeLayoutPresetsConfig(config.layoutPresets);
        if (!isLayoutPresetsConfigEmpty(normalized)) {
          data.layoutPresets = normalized;
        }
      }
      if (config.viewedSplashScreens) {
        data.viewedSplashScreens = config.viewedSplashScreens;
      }
      if (config.agentAiDefaults && Object.keys(config.agentAiDefaults).length > 0) {
        data.agentAiDefaults = config.agentAiDefaults;

        const legacySidekick: Record<string, unknown> = {};
        for (const [id, entry] of Object.entries(config.agentAiDefaults)) {
          if (id === "plan" || id === "exec" || id === "compact") continue;
          legacySidekick[id] = entry;
        }
        if (Object.keys(legacySidekick).length > 0) {
          data.sidekickAiDefaults = legacySidekick as ProjectsConfig["sidekickAiDefaults"];
        }
      } else {
        // Legacy only.
        if (config.sidekickAiDefaults && Object.keys(config.sidekickAiDefaults).length > 0) {
          data.sidekickAiDefaults = config.sidekickAiDefaults;
        }
      }

      if (config.useSSH2Transport !== undefined) {
        data.useSSH2Transport = config.useSSH2Transport;
      }

      const latticeGovernorUrl = parseOptionalNonEmptyString(config.latticeGovernorUrl);
      if (latticeGovernorUrl) {
        data.latticeGovernorUrl = latticeGovernorUrl;
      }

      const latticeGovernorToken = parseOptionalNonEmptyString(config.latticeGovernorToken);
      if (latticeGovernorToken) {
        data.latticeGovernorToken = latticeGovernorToken;
      }

      // Default ON: persist `false` only.
      if (config.stopLatticeMinionOnArchive === false) {
        data.stopLatticeMinionOnArchive = false;
      }

      const terminalDefaultShell = parseOptionalNonEmptyString(config.terminalDefaultShell);
      if (terminalDefaultShell) {
        data.terminalDefaultShell = terminalDefaultShell;
      }

      const updateChannel = parseUpdateChannel(config.updateChannel);
      if (updateChannel) {
        data.updateChannel = updateChannel;
      }

      const runtimeEnablement = normalizeRuntimeEnablementOverrides(config.runtimeEnablement);
      if (runtimeEnablement) {
        data.runtimeEnablement = runtimeEnablement;
      }

      const defaultRuntime = normalizeRuntimeEnablementId(config.defaultRuntime);
      if (defaultRuntime !== undefined) {
        data.defaultRuntime = defaultRuntime;
      }

      // Terminal profiles: only persist when non-empty
      const terminalProfiles = normalizeTerminalProfiles(config.terminalProfiles);
      if (terminalProfiles && Object.keys(terminalProfiles).length > 0) {
        data.terminalProfiles = terminalProfiles;
      }

      // Scheduled jobs: persist when non-empty
      if (config.schedules && config.schedules.length > 0) {
        data.schedules = config.schedules;
      }

      // Sync config: persist when present
      if (config.sync) {
        data.sync = config.sync;
      }

      // Telegram bot token for inbox channel adapter
      const telegramBotToken = parseOptionalNonEmptyString(config.telegramBotToken);
      if (telegramBotToken) {
        data.telegramBotToken = telegramBotToken;
      }

      // Default ON: persist `false` only.
      if (config.telemetryEnabled === false) {
        data.telemetryEnabled = false;
      }

      await writeFileAtomic(this.configFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      log.error("Error saving config:", error);
    }
  }

  /**
   * Edit config atomically using a transformation function
   * @param fn Function that takes current config and returns modified config
   */
  async editConfig(fn: (config: ProjectsConfig) => ProjectsConfig): Promise<void> {
    const config = this.loadConfigOrDefault();
    const newConfig = fn(config);
    await this.saveConfig(newConfig);
  }

  getUpdateChannel(): UpdateChannel {
    const config = this.loadConfigOrDefault();
    return config.updateChannel === "nightly" ? "nightly" : "stable";
  }

  async setUpdateChannel(channel: UpdateChannel): Promise<void> {
    await this.editConfig((config) => {
      config.updateChannel = channel;
      return config;
    });
  }

  /**
   * Whether telemetry (PostHog analytics) is enabled in config.
   * Returns true when undefined (default ON).
   * Note: env var LATTICE_DISABLE_TELEMETRY=1 takes precedence over this.
   */
  getTelemetryEnabled(): boolean {
    const config = this.loadConfigOrDefault();
    return config.telemetryEnabled !== false;
  }

  /**
   * Persist telemetry enabled/disabled preference to config.json.
   */
  async setTelemetryEnabled(enabled: boolean): Promise<void> {
    await this.editConfig((config) => {
      // Store `false` only to keep config.json minimal (undefined = enabled).
      config.telemetryEnabled = enabled ? undefined : false;
      return config;
    });
  }

  /**
   * Cross-client feature flag overrides (shared via ~/.lattice/config.json).
   */
  getFeatureFlagOverride(flagKey: string): FeatureFlagOverride {
    const config = this.loadConfigOrDefault();
    const override = config.featureFlagOverrides?.[flagKey];
    if (override === "on" || override === "off" || override === "default") {
      return override;
    }
    return "default";
  }

  async setFeatureFlagOverride(flagKey: string, override: FeatureFlagOverride): Promise<void> {
    await this.editConfig((config) => {
      const next = { ...(config.featureFlagOverrides ?? {}) };
      if (override === "default") {
        delete next[flagKey];
      } else {
        next[flagKey] = override;
      }

      config.featureFlagOverrides = Object.keys(next).length > 0 ? next : undefined;
      return config;
    });
  }

  /**
   * mDNS advertisement enablement.
   *
   * - true: attempt to advertise (will warn if the API server is loopback-only)
   * - false: never advertise
   * - undefined: "auto" (advertise only when the API server is LAN-reachable)
   */
  getMdnsAdvertisementEnabled(): boolean | undefined {
    const envOverride = parseOptionalEnvBoolean(process.env.LATTICE_MDNS_ADVERTISE);
    if (envOverride !== undefined) {
      return envOverride;
    }

    const config = this.loadConfigOrDefault();
    return config.mdnsAdvertisementEnabled;
  }

  /** Optional DNS-SD service instance name override. */
  getMdnsServiceName(): string | undefined {
    const envName = parseOptionalNonEmptyString(process.env.LATTICE_MDNS_SERVICE_NAME);
    if (envName) {
      return envName;
    }

    const config = this.loadConfigOrDefault();
    return config.mdnsServiceName;
  }

  /**
   * Get the configured SSH hostname for this server (used for editor deep links in browser mode).
   */
  getServerSshHost(): string | undefined {
    const config = this.loadConfigOrDefault();
    return config.serverSshHost;
  }

  /**
   * Get the configured GitHub username allowed to authenticate server/browser mode.
   */
  getServerAuthGithubOwner(): string | undefined {
    const envOwner = parseOptionalNonEmptyString(process.env.LATTICE_SERVER_AUTH_GITHUB_OWNER);
    if (envOwner) {
      return envOwner;
    }

    const config = this.loadConfigOrDefault();
    return config.serverAuthGithubOwner;
  }
  /**
   * Get the Lattice gateway WebSocket URL for inbox channel routing.
   * Env var LATTICE_LATTICE_GATEWAY_URL takes precedence over config.json.
   */
  getLatticeGatewayUrl(): string | null {
    const envUrl = parseOptionalNonEmptyString(process.env.LATTICE_LATTICE_GATEWAY_URL);
    if (envUrl) return envUrl;

    const config = this.loadConfigOrDefault();
    return config.latticeGatewayUrl ?? null;
  }

  /** Update the Lattice gateway URL in persistent config. */
  async setLatticeGatewayUrl(url: string | null): Promise<void> {
    await this.editConfig((config) => ({
      ...config,
      latticeGatewayUrl: url ?? undefined,
    }));
  }

  /**
   * Get the Telegram bot token for direct adapter mode.
   * Env var LATTICE_TELEGRAM_BOT_TOKEN takes precedence over config.json.
   */
  getTelegramBotToken(): string | null {
    const envToken = parseOptionalNonEmptyString(process.env.LATTICE_TELEGRAM_BOT_TOKEN);
    if (envToken) return envToken;

    const config = this.loadConfigOrDefault();
    return config.telegramBotToken ?? null;
  }

  /** Update the Telegram bot token in persistent config. */
  async setTelegramBotToken(token: string | null): Promise<void> {
    await this.editConfig((config) => ({
      ...config,
      telegramBotToken: token ?? undefined,
    }));
  }

  private getProjectName(projectPath: string): string {
    return PlatformPaths.getProjectName(projectPath);
  }

  /**
   * Generate a stable unique minion ID.
   * Uses 10 random hex characters for readability while maintaining uniqueness.
   *
   * Example: "a1b2c3d4e5"
   */
  generateStableId(): string {
    // Generate 5 random bytes and convert to 10 hex chars
    return crypto.randomBytes(5).toString("hex");
  }

  /**
   * DEPRECATED: Generate legacy minion ID from project and minion paths.
   * This method is used only for legacy minion migration to look up old minions.
   * New minions use generateStableId() which returns a random stable ID.
   *
   * DO NOT use this method or its format to construct minion IDs anywhere in the codebase.
   * Minion IDs are backend implementation details and must only come from backend operations.
   */
  generateLegacyId(projectPath: string, minionPath: string): string {
    const projectBasename = this.getProjectName(projectPath);
    const minionBasename = PlatformPaths.basename(minionPath);
    return `${projectBasename}-${minionBasename}`;
  }

  /**
   * Get the minion directory path for a given directory name.
   * The directory name is the minion name (branch name).
   */

  /**
   * Add paths to MinionMetadata to create FrontendMinionMetadata.
   * Helper to avoid duplicating path computation logic.
   */
  private addPathsToMetadata(
    metadata: MinionMetadata,
    minionPath: string,
    _projectPath: string
  ): FrontendMinionMetadata {
    const result: FrontendMinionMetadata = {
      ...metadata,
      namedMinionPath: minionPath,
    };

    // Check for incompatible runtime configs (from newer lattice versions)
    if (isIncompatibleRuntimeConfig(metadata.runtimeConfig)) {
      result.incompatibleRuntime =
        "This minion was created with a newer version of lattice. " +
        "Please upgrade lattice to use this minion.";
    }

    return result;
  }

  /**
   * Find a minion path and project path by minion ID
   * @returns Object with minion and project paths, or null if not found
   */
  findMinion(minionId: string): { minionPath: string; projectPath: string } | null {
    const config = this.loadConfigOrDefault();

    for (const [projectPath, project] of config.projects) {
      for (const minion of project.minions) {
        // NEW FORMAT: Check config first (primary source of truth after migration)
        if (minion.id === minionId) {
          return { minionPath: minion.path, projectPath };
        }

        // LEGACY FORMAT: Fall back to metadata.json and legacy ID for unmigrated minions
        if (!minion.id) {
          // Extract minion basename (could be stable ID or legacy name)
          const minionBasename =
            minion.path.split("/").pop() ?? minion.path.split("\\").pop() ?? "unknown";

          // Try loading metadata with basename as ID (works for old minions)
          const metadataPath = path.join(this.getSessionDir(minionBasename), "metadata.json");
          if (fs.existsSync(metadataPath)) {
            try {
              const data = fs.readFileSync(metadataPath, "utf-8");
              const metadata = JSON.parse(data) as MinionMetadata;
              if (metadata.id === minionId) {
                return { minionPath: minion.path, projectPath };
              }
            } catch {
              // Ignore parse errors, try legacy ID
            }
          }

          // Try legacy ID format as last resort
          const legacyId = this.generateLegacyId(projectPath, minion.path);
          if (legacyId === minionId) {
            return { minionPath: minion.path, projectPath };
          }
        }
      }
    }

    return null;
  }

  /**
   * Minion Path Architecture:
   *
   * Minion paths are computed on-demand from projectPath + minion name using
   * config.getMinionPath(projectPath, directoryName). This ensures a single source of truth.
   *
   * - Worktree directory name: uses minion.name (the branch name)
   * - Minion ID: stable random identifier for identity and sessions (not used for directories)
   *
   * Backend: Uses getMinionPath(metadata.projectPath, metadata.name) for minion directory paths
   * Frontend: Gets enriched metadata with paths via IPC (FrontendMinionMetadata)
   *
   * MinionMetadata.minionPath is deprecated and will be removed. Use computed
   * paths from getMinionPath() or getMinionPaths() instead.
   */

  /**
   * Get the session directory for a specific minion
   */
  getSessionDir(minionId: string): string {
    return path.join(this.sessionsDir, minionId);
  }

  /**
   * Get all minion metadata by loading config and metadata files.
   *
   * Returns FrontendMinionMetadata with paths already computed.
   * This eliminates the need for separate "enrichment" - paths are computed
   * once during the loop when we already have all the necessary data.
   *
   * NEW BEHAVIOR: Config is the primary source of truth
   * - If minion has id/name/createdAt in config, use those directly
   * - If minion only has path, fall back to reading metadata.json
   * - Migrate old minions by copying metadata from files to config
   *
   * This centralizes minion metadata in config.json and eliminates the need
   * for scattered metadata.json files (kept for backward compat with older versions).
   *
   * GUARANTEE: Every minion returned will have a createdAt timestamp.
   * If missing from config or legacy metadata, a new timestamp is assigned and
   * saved to config for subsequent loads.
   */
  async getAllMinionMetadata(): Promise<FrontendMinionMetadata[]> {
    const config = this.loadConfigOrDefault();
    const minionMetadata: FrontendMinionMetadata[] = [];
    let configModified = false;

    for (const [projectPath, projectConfig] of config.projects) {
      // Validate project path is not empty (defensive check for corrupted config)
      if (!projectPath) {
        log.warn("Skipping project with empty path in config", {
          minionCount: projectConfig.minions?.length ?? 0,
        });
        continue;
      }

      const projectName = this.getProjectName(projectPath);

      for (const minion of projectConfig.minions) {
        // Extract minion basename from path (could be stable ID or legacy name)
        const minionBasename =
          minion.path.split("/").pop() ?? minion.path.split("\\").pop() ?? "unknown";

        try {
          // NEW FORMAT: If minion has metadata in config, use it directly
          if (minion.id && minion.name) {
            const metadata: MinionMetadata = {
              id: minion.id,
              name: minion.name,
              title: minion.title,
              projectName,
              projectPath,
              // GUARANTEE: All minions must have createdAt (assign now if missing)
              createdAt: minion.createdAt ?? new Date().toISOString(),
              // GUARANTEE: All minions must have runtimeConfig (apply default if missing)
              runtimeConfig: minion.runtimeConfig ?? DEFAULT_RUNTIME_CONFIG,
              aiSettings: minion.aiSettings,
              aiSettingsByAgent:
                minion.aiSettingsByAgent ??
                (minion.aiSettings
                  ? {
                      plan: minion.aiSettings,
                      exec: minion.aiSettings,
                    }
                  : undefined),
              parentMinionId: minion.parentMinionId,
              agentType: minion.agentType,
              agentSwitchingEnabled: minion.agentSwitchingEnabled,
              taskStatus: minion.taskStatus,
              reportedAt: minion.reportedAt,
              taskModelString: minion.taskModelString,
              taskThinkingLevel: minion.taskThinkingLevel,
              taskPrompt: minion.taskPrompt,
              taskTrunkBranch: minion.taskTrunkBranch,
              archivedAt: minion.archivedAt,
              unarchivedAt: minion.unarchivedAt,
              crewId: minion.crewId,
            };

            // Migrate missing createdAt to config for next load
            if (!minion.createdAt) {
              minion.createdAt = metadata.createdAt;
              configModified = true;
            }

            // Migrate missing runtimeConfig to config for next load
            if (!minion.aiSettingsByAgent) {
              const derived = minion.aiSettings
                ? {
                    plan: minion.aiSettings,
                    exec: minion.aiSettings,
                  }
                : undefined;
              if (derived) {
                minion.aiSettingsByAgent = derived;
                configModified = true;
              }
            }

            if (!minion.runtimeConfig) {
              minion.runtimeConfig = metadata.runtimeConfig;
              configModified = true;
            }

            // Populate containerName for Docker minions (computed from project path and minion name)
            if (
              metadata.runtimeConfig?.type === "docker" &&
              !metadata.runtimeConfig.containerName
            ) {
              metadata.runtimeConfig = {
                ...metadata.runtimeConfig,
                containerName: getDockerContainerName(projectPath, metadata.name),
              };
            }

            minionMetadata.push(this.addPathsToMetadata(metadata, minion.path, projectPath));
            continue; // Skip metadata file lookup
          }

          // LEGACY FORMAT: Fall back to reading metadata.json
          // Try legacy ID format first (project-minion) - used by E2E tests and old minions
          const legacyId = this.generateLegacyId(projectPath, minion.path);
          const metadataPath = path.join(this.getSessionDir(legacyId), "metadata.json");
          let metadataFound = false;

          if (fs.existsSync(metadataPath)) {
            const data = fs.readFileSync(metadataPath, "utf-8");
            const metadata = JSON.parse(data) as MinionMetadata;

            // Ensure required fields are present
            if (!metadata.name) metadata.name = minionBasename;
            if (!metadata.projectPath) metadata.projectPath = projectPath;
            if (!metadata.projectName) metadata.projectName = projectName;

            // GUARANTEE: All minions must have createdAt
            metadata.createdAt ??= new Date().toISOString();

            // GUARANTEE: All minions must have runtimeConfig
            metadata.runtimeConfig ??= DEFAULT_RUNTIME_CONFIG;

            // Preserve any config-only fields that may not exist in legacy metadata.json
            metadata.aiSettingsByAgent ??=
              minion.aiSettingsByAgent ??
              (minion.aiSettings
                ? {
                    plan: minion.aiSettings,
                    exec: minion.aiSettings,
                  }
                : undefined);
            metadata.aiSettings ??= minion.aiSettings;

            // Preserve tree/task metadata when present in config (metadata.json won't have it)
            metadata.parentMinionId ??= minion.parentMinionId;
            metadata.agentType ??= minion.agentType;
            metadata.agentSwitchingEnabled ??= minion.agentSwitchingEnabled;
            metadata.taskStatus ??= minion.taskStatus;
            metadata.reportedAt ??= minion.reportedAt;
            metadata.taskModelString ??= minion.taskModelString;
            metadata.taskThinkingLevel ??= minion.taskThinkingLevel;
            metadata.taskPrompt ??= minion.taskPrompt;
            metadata.taskTrunkBranch ??= minion.taskTrunkBranch;
            // Preserve archived timestamps from config
            metadata.archivedAt ??= minion.archivedAt;
            metadata.unarchivedAt ??= minion.unarchivedAt;
            // Preserve crew assignment from config
            metadata.crewId ??= minion.crewId;
            if (!minion.aiSettingsByAgent && metadata.aiSettingsByAgent) {
              minion.aiSettingsByAgent = metadata.aiSettingsByAgent;
              configModified = true;
            }

            // Migrate to config for next load
            minion.id = metadata.id;
            minion.name = metadata.name;
            minion.createdAt = metadata.createdAt;
            minion.runtimeConfig = metadata.runtimeConfig;
            configModified = true;

            minionMetadata.push(this.addPathsToMetadata(metadata, minion.path, projectPath));
            metadataFound = true;
          }

          // No metadata found anywhere - create basic metadata
          if (!metadataFound) {
            const legacyId = this.generateLegacyId(projectPath, minion.path);
            const metadata: MinionMetadata = {
              id: legacyId,
              name: minionBasename,
              projectName,
              projectPath,
              // GUARANTEE: All minions must have createdAt
              createdAt: new Date().toISOString(),
              // GUARANTEE: All minions must have runtimeConfig
              runtimeConfig: DEFAULT_RUNTIME_CONFIG,
              aiSettings: minion.aiSettings,
              aiSettingsByAgent:
                minion.aiSettingsByAgent ??
                (minion.aiSettings
                  ? {
                      plan: minion.aiSettings,
                      exec: minion.aiSettings,
                    }
                  : undefined),
              parentMinionId: minion.parentMinionId,
              agentType: minion.agentType,
              agentSwitchingEnabled: minion.agentSwitchingEnabled,
              taskStatus: minion.taskStatus,
              reportedAt: minion.reportedAt,
              taskModelString: minion.taskModelString,
              taskThinkingLevel: minion.taskThinkingLevel,
              taskPrompt: minion.taskPrompt,
              taskTrunkBranch: minion.taskTrunkBranch,
              archivedAt: minion.archivedAt,
              unarchivedAt: minion.unarchivedAt,
              crewId: minion.crewId,
            };

            // Save to config for next load
            minion.id = metadata.id;
            minion.name = metadata.name;
            minion.createdAt = metadata.createdAt;
            minion.runtimeConfig = metadata.runtimeConfig;
            configModified = true;

            minionMetadata.push(this.addPathsToMetadata(metadata, minion.path, projectPath));
          }
        } catch (error) {
          log.error(`Failed to load/migrate minion metadata:`, error);
          // Fallback to basic metadata if migration fails
          const legacyId = this.generateLegacyId(projectPath, minion.path);
          const metadata: MinionMetadata = {
            id: legacyId,
            name: minionBasename,
            projectName,
            projectPath,
            // GUARANTEE: All minions must have createdAt (even in error cases)
            createdAt: new Date().toISOString(),
            // GUARANTEE: All minions must have runtimeConfig (even in error cases)
            runtimeConfig: DEFAULT_RUNTIME_CONFIG,
            aiSettings: minion.aiSettings,
            aiSettingsByAgent:
              minion.aiSettingsByAgent ??
              (minion.aiSettings
                ? {
                    plan: minion.aiSettings,
                    exec: minion.aiSettings,
                  }
                : undefined),
            parentMinionId: minion.parentMinionId,
            agentType: minion.agentType,
            agentSwitchingEnabled: minion.agentSwitchingEnabled,
            taskStatus: minion.taskStatus,
            reportedAt: minion.reportedAt,
            taskModelString: minion.taskModelString,
            taskThinkingLevel: minion.taskThinkingLevel,
            taskPrompt: minion.taskPrompt,
            taskTrunkBranch: minion.taskTrunkBranch,
            crewId: minion.crewId,
          };
          minionMetadata.push(this.addPathsToMetadata(metadata, minion.path, projectPath));
        }
      }
    }

    // Save config if we migrated any minions
    if (configModified) {
      await this.saveConfig(config);
    }

    return minionMetadata;
  }

  /**
   * Add a minion to config.json (single source of truth for minion metadata).
   * Creates project entry if it doesn't exist.
   *
   * @param projectPath Absolute path to the project
   * @param metadata Minion metadata to save
   */
  async addMinion(
    projectPath: string,
    metadata: MinionMetadata & { namedMinionPath?: string }
  ): Promise<void> {
    await this.editConfig((config) => {
      let project = config.projects.get(projectPath);

      if (!project) {
        project = { minions: [] };
        config.projects.set(projectPath, project);
      }

      // Check if minion already exists (by ID)
      const existingIndex = project.minions.findIndex((w) => w.id === metadata.id);

      // Use provided namedMinionPath if available (runtime-aware),
      // otherwise fall back to worktree-style path for legacy compatibility
      const projectName = this.getProjectName(projectPath);
      const minionPath =
        metadata.namedMinionPath ?? path.join(this.srcDir, projectName, metadata.name);
      const minionEntry: Minion = {
        path: minionPath,
        id: metadata.id,
        name: metadata.name,
        title: metadata.title,
        createdAt: metadata.createdAt,
        aiSettingsByAgent: metadata.aiSettingsByAgent,
        runtimeConfig: metadata.runtimeConfig,
        aiSettings: metadata.aiSettings,
        parentMinionId: metadata.parentMinionId,
        agentType: metadata.agentType,
        agentId: metadata.agentId,
        agentSwitchingEnabled: metadata.agentSwitchingEnabled,
        taskStatus: metadata.taskStatus,
        reportedAt: metadata.reportedAt,
        taskModelString: metadata.taskModelString,
        taskThinkingLevel: metadata.taskThinkingLevel,
        taskPrompt: metadata.taskPrompt,
        taskTrunkBranch: metadata.taskTrunkBranch,
        archivedAt: metadata.archivedAt,
        unarchivedAt: metadata.unarchivedAt,
        crewId: metadata.crewId,
      };

      if (existingIndex >= 0) {
        // Update existing minion
        project.minions[existingIndex] = minionEntry;
      } else {
        // Add new minion
        project.minions.push(minionEntry);
      }

      return config;
    });
  }

  /**
   * Remove a minion from config.json
   *
   * @param minionId ID of the minion to remove
   */
  async removeMinion(minionId: string): Promise<void> {
    await this.editConfig((config) => {
      let minionFound = false;

      for (const [_projectPath, project] of config.projects) {
        const index = project.minions.findIndex((w) => w.id === minionId);
        if (index !== -1) {
          project.minions.splice(index, 1);
          minionFound = true;
          // We don't break here in case duplicates exist (though they shouldn't)
        }
      }

      if (!minionFound) {
        log.warn(`Minion ${minionId} not found in config during removal`);
      }

      return config;
    });
  }

  /**
   * Update minion metadata fields (e.g., regenerate missing title/branch)
   * Used to fix incomplete metadata after errors or restarts
   */
  async updateMinionMetadata(
    minionId: string,
    updates: Partial<Pick<MinionMetadata, "name" | "runtimeConfig" | "agentSwitchingEnabled">>
  ): Promise<void> {
    await this.editConfig((config) => {
      for (const [_projectPath, projectConfig] of config.projects) {
        const minion = projectConfig.minions.find((w) => w.id === minionId);
        if (minion) {
          if (updates.name !== undefined) minion.name = updates.name;
          if (updates.runtimeConfig !== undefined) minion.runtimeConfig = updates.runtimeConfig;
          if (updates.agentSwitchingEnabled !== undefined) {
            minion.agentSwitchingEnabled = updates.agentSwitchingEnabled;
          }
          return config;
        }
      }
      throw new Error(`Minion ${minionId} not found in config`);
    });
  }

  /**
   * Load providers configuration from JSONC file
   * Supports comments in JSONC format
   */
  loadProvidersConfig(): ProvidersConfig | null {
    try {
      if (fs.existsSync(this.providersFile)) {
        const data = fs.readFileSync(this.providersFile, "utf-8");
        return jsonc.parse(data) as ProvidersConfig;
      }
    } catch (error) {
      log.error("Error loading providers config:", error);
    }

    return null;
  }

  /**
   * Save providers configuration to JSONC file
   * @param config The providers configuration to save
   */
  saveProvidersConfig(config: ProvidersConfig): void {
    try {
      if (!fs.existsSync(this.rootDir)) {
        fs.mkdirSync(this.rootDir, { recursive: true });
      }

      // Format with 2-space indentation for readability
      const jsonString = JSON.stringify(config, null, 2);

      // Add a comment header to the file
      const contentWithComments = `// Providers configuration for lattice
// Configure your AI providers here
// Example:
// {
//   "anthropic": {
//     "apiKey": "sk-ant-..."
//   },
//   "openai": {
//     "apiKey": "sk-..."
//   },
//   "xai": {
//     "apiKey": "sk-xai-..."
//   },
//   "ollama": {
//     "baseUrl": "http://localhost:11434/api"  // Optional - only needed for remote/custom URL
//   }
// }
${jsonString}`;

      writeFileAtomic.sync(this.providersFile, contentWithComments, {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch (error) {
      log.error("Error saving providers config:", error);
      throw error; // Re-throw to let caller handle
    }
  }

  private static readonly GLOBAL_SECRETS_KEY = "__global__";

  private static normalizeSecretsProjectPath(projectPath: string): string {
    return stripTrailingSlashes(projectPath);
  }

  private static isSecretReferenceValue(value: unknown): value is { secret: string } {
    return (
      typeof value === "object" &&
      value !== null &&
      "secret" in value &&
      typeof (value as { secret?: unknown }).secret === "string"
    );
  }

  private static isSecretValue(value: unknown): value is Secret["value"] {
    if (typeof value === "string") {
      return true;
    }

    return Config.isSecretReferenceValue(value);
  }

  private static isSecret(value: unknown): value is Secret {
    return (
      typeof value === "object" &&
      value !== null &&
      "key" in value &&
      "value" in value &&
      typeof (value as { key?: unknown }).key === "string" &&
      Config.isSecretValue((value as { value?: unknown }).value)
    );
  }

  private static parseSecretsArray(value: unknown): Secret[] {
    if (!Array.isArray(value)) {
      return [];
    }

    // Filter invalid entries to avoid crashes when iterating secrets.
    return value.filter((entry): entry is Secret => Config.isSecret(entry));
  }

  private static mergeSecretsByKey(primary: Secret[], secondary: Secret[]): Secret[] {
    // Merge-by-key (last writer wins).
    const mergedByKey = new Map<string, Secret>();
    for (const secret of primary) {
      mergedByKey.set(secret.key, secret);
    }
    for (const secret of secondary) {
      mergedByKey.set(secret.key, secret);
    }
    return Array.from(mergedByKey.values());
  }

  private static normalizeSecretsConfig(raw: unknown): SecretsConfig {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }

    const record = raw as Record<string, unknown>;
    const normalized: SecretsConfig = {};

    for (const [rawKey, rawValue] of Object.entries(record)) {
      let key = rawKey;
      if (rawKey !== Config.GLOBAL_SECRETS_KEY) {
        const normalizedKey = Config.normalizeSecretsProjectPath(rawKey);
        key = normalizedKey || rawKey;
      }

      const secrets = Config.parseSecretsArray(rawValue);

      if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = secrets;
        continue;
      }

      normalized[key] = Config.mergeSecretsByKey(normalized[key], secrets);
    }

    return normalized;
  }

  /**
   * Load secrets configuration from JSON file
   * Returns empty config if file doesn't exist
   */
  loadSecretsConfig(): SecretsConfig {
    try {
      if (fs.existsSync(this.secretsFile)) {
        const data = fs.readFileSync(this.secretsFile, "utf-8");
        const parsed = JSON.parse(data) as unknown;
        return Config.normalizeSecretsConfig(parsed);
      }
    } catch (error) {
      log.error("Error loading secrets config:", error);
    }

    return {};
  }

  /**
   * Save secrets configuration to JSON file
   * @param config The secrets configuration to save
   */
  async saveSecretsConfig(config: SecretsConfig): Promise<void> {
    try {
      if (!fs.existsSync(this.rootDir)) {
        fs.mkdirSync(this.rootDir, { recursive: true });
      }

      await writeFileAtomic(this.secretsFile, JSON.stringify(config, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch (error) {
      log.error("Error saving secrets config:", error);
      throw error;
    }
  }

  /**
   * Get global secrets (not project-scoped).
   *
   * Stored in <latticeHome>/secrets.json under a sentinel key for backwards compatibility.
   */
  getGlobalSecrets(): Secret[] {
    const config = this.loadSecretsConfig();
    return config[Config.GLOBAL_SECRETS_KEY] ?? [];
  }

  /** Update global secrets (not project-scoped). */
  async updateGlobalSecrets(secrets: Secret[]): Promise<void> {
    const config = this.loadSecretsConfig();
    config[Config.GLOBAL_SECRETS_KEY] = secrets;
    await this.saveSecretsConfig(config);
  }

  /**
   * Get effective secrets for a project.
   *
   * Project secrets define which env vars are injected into this project/minion.
   * Global secrets are only used as a shared value store and are injected only when
   * a project secret references them via `{ secret: "GLOBAL_KEY" }`.
   */
  getEffectiveSecrets(projectPath: string): Secret[] {
    const normalizedProjectPath = Config.normalizeSecretsProjectPath(projectPath) || projectPath;
    const config = this.loadSecretsConfig();
    const projectSecrets = config[normalizedProjectPath] ?? [];
    const globalSecretsByKey = secretsToRecord(config[Config.GLOBAL_SECRETS_KEY] ?? []);

    return projectSecrets.map((secret) => {
      if (!Config.isSecretReferenceValue(secret.value)) {
        return secret;
      }

      const targetKey = secret.value.secret.trim();
      if (!targetKey) {
        return secret;
      }

      // Allow empty-string global secrets by checking for undefined explicitly.
      const resolvedGlobalValue = globalSecretsByKey[targetKey];
      if (resolvedGlobalValue !== undefined) {
        return {
          ...secret,
          value: resolvedGlobalValue,
        };
      }

      return secret;
    });
  }

  /**
   * Get secrets for a specific project.
   *
   * Note: this is project-only (does not include global secrets).
   */
  getProjectSecrets(projectPath: string): Secret[] {
    const normalizedProjectPath = Config.normalizeSecretsProjectPath(projectPath) || projectPath;
    const config = this.loadSecretsConfig();
    return config[normalizedProjectPath] ?? [];
  }

  /**
   * Update secrets for a specific project
   * @param projectPath The path to the project
   * @param secrets The secrets to save for the project
   */
  async updateProjectSecrets(projectPath: string, secrets: Secret[]): Promise<void> {
    const normalizedProjectPath = Config.normalizeSecretsProjectPath(projectPath) || projectPath;
    const config = this.loadSecretsConfig();
    config[normalizedProjectPath] = secrets;
    await this.saveSecretsConfig(config);
  }
}

// Default instance for application use
export const defaultConfig = new Config();
