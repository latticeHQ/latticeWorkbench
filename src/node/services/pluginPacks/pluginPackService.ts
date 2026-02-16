import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "@/node/config";
import type { PluginPackDescriptor, PluginPackName } from "@/common/types/pluginPack";
import { BUILTIN_PLUGIN_PACKS } from "./builtInPluginRegistry.generated";

/**
 * Plugin Pack configuration stored in ~/.lattice/plugins.json or .lattice/plugins.json.
 */
interface PluginPackConfig {
  enabledPacks?: Record<string, boolean>;
}

/**
 * Manages plugin packs — groups of domain-specific skills that can be
 * enabled/disabled per workspace or globally.
 */
export class PluginPackService {
  private readonly globalConfigPath: string;

  constructor(config: Config) {
    this.globalConfigPath = path.join(config.rootDir, "plugins.json");
  }

  /**
   * List all available plugin packs with their enabled/disabled state.
   */
  listPluginPacks(projectPath?: string): PluginPackDescriptor[] {
    const enabledPacks = this.getEnabledPacksMap(projectPath);

    return Object.values(BUILTIN_PLUGIN_PACKS).map((pack) => ({
      name: pack.name,
      version: pack.version,
      description: pack.description,
      author: pack.author,
      skillCount: pack.skills.length,
      commandCount: pack.commands.length,
      mcpServerCount: Object.keys(pack.mcpServers).length,
      enabled: enabledPacks[pack.name] ?? false,
    }));
  }

  /**
   * Enable or disable a plugin pack.
   */
  setPluginPackEnabled(name: PluginPackName, enabled: boolean, projectPath?: string): void {
    if (!BUILTIN_PLUGIN_PACKS[name]) {
      throw new Error(`Unknown plugin pack: ${name}`);
    }

    const configPath = this.resolveConfigPath(projectPath);
    const config = this.readConfig(configPath);
    config.enabledPacks ??= {};
    config.enabledPacks[name] = enabled;
    this.writeConfig(configPath, config);
  }

  /**
   * Get the set of enabled plugin names (for skill filtering).
   */
  getEnabledPluginNames(projectPath?: string): Set<string> {
    const enabledPacks = this.getEnabledPacksMap(projectPath);
    const enabled = new Set<string>();
    for (const [name, isEnabled] of Object.entries(enabledPacks)) {
      if (isEnabled && BUILTIN_PLUGIN_PACKS[name]) {
        enabled.add(name);
      }
    }
    return enabled;
  }

  /**
   * Get MCP servers suggested by a plugin pack.
   */
  getPluginMcpServers(name: PluginPackName): Record<string, { transport: string; url: string }> {
    const pack = BUILTIN_PLUGIN_PACKS[name];
    if (!pack) {
      throw new Error(`Unknown plugin pack: ${name}`);
    }
    return pack.mcpServers;
  }

  // --- Private helpers ---

  private resolveConfigPath(projectPath?: string): string {
    if (projectPath) {
      return path.join(projectPath, ".lattice", "plugins.json");
    }
    return this.globalConfigPath;
  }

  private getEnabledPacksMap(projectPath?: string): Record<string, boolean> {
    // Merge: global config first, project-level overrides on top
    const globalConfig = this.readConfig(this.globalConfigPath);
    const globalEnabled = globalConfig.enabledPacks ?? {};

    if (!projectPath) return globalEnabled;

    const projectConfigPath = path.join(projectPath, ".lattice", "plugins.json");
    const projectConfig = this.readConfig(projectConfigPath);
    const projectEnabled = projectConfig.enabledPacks ?? {};

    return { ...globalEnabled, ...projectEnabled };
  }

  private readConfig(configPath: string): PluginPackConfig {
    try {
      if (!fs.existsSync(configPath)) return {};
      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as PluginPackConfig;
    } catch {
      return {};
    }
  }

  private writeConfig(configPath: string, config: PluginPackConfig): void {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
}
