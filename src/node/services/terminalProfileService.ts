/**
 * Terminal Profile Service — detects installed CLI tools and manages profile state.
 *
 * Probes the system for known CLI tools (Claude Code, Aider, etc.) using
 * commandDiscovery.ts, merges detection results with user config, and
 * provides install recipes per runtime type.
 */

import { statSync } from "fs";
import { homedir } from "os";
import { log } from "@/node/services/log";
import { findCommandWithAliases } from "@/node/utils/commandDiscovery";
import {
  TERMINAL_PROFILE_DEFINITIONS,
  KNOWN_PROFILE_IDS,
  type InstallRecipe,
  type TerminalProfileDefinition,
} from "@/common/constants/terminalProfiles";
import {
  defaultProfileConfig,
  type ProfileDetectionStatus,
  type TerminalProfileConfig,
  type TerminalProfileWithStatus,
} from "@/common/types/terminalProfile";
import type { Config } from "@/node/config";

type RuntimeType = "local" | "worktree" | "ssh" | "docker" | "devcontainer";

export class TerminalProfileService {
  constructor(private readonly config: Config) {}

  /**
   * Detect a single profile's installation status.
   * Uses commandDiscovery's findCommandWithAliases for local runtimes.
   */
  async detect(profile: TerminalProfileDefinition): Promise<ProfileDetectionStatus> {
    try {
      const result = await findCommandWithAliases(
        profile.command,
        profile.commandAliases,
        profile.knownPaths
      );

      return {
        installed: result.found,
        commandPath: result.resolvedCommand,
      };
    } catch (error) {
      log.error(`Failed to detect profile ${profile.id}:`, error);
      return { installed: false };
    }
  }

  /**
   * Detect all known profiles and merge with user config.
   * Returns the full list for the Settings UI.
   */
  async listWithStatus(runtimeType: RuntimeType = "local"): Promise<TerminalProfileWithStatus[]> {
    const userConfigs = this.getUserConfigs();
    const results: TerminalProfileWithStatus[] = [];

    // Run detection in parallel for all known profiles
    const detectionPromises = KNOWN_PROFILE_IDS.map(async (id) => {
      const definition = TERMINAL_PROFILE_DEFINITIONS[id];
      if (!definition) return null;

      const detection = await this.detect(definition);
      const config = userConfigs[id] ?? defaultProfileConfig(detection.installed);
      const installRecipes = this.getInstallRecipes(definition, runtimeType);

      return {
        id: definition.id,
        displayName: definition.displayName,
        command: config.commandOverride ?? definition.command,
        defaultArgs: config.argsOverride ?? definition.defaultArgs,
        description: definition.description,
        category: definition.category,
        group: definition.group,
        detection,
        config,
        installRecipes: installRecipes.length > 0 ? installRecipes : undefined,
      } satisfies TerminalProfileWithStatus;
    });

    const detected = await Promise.all(detectionPromises);
    for (const profile of detected) {
      if (profile) results.push(profile);
    }

    // Append custom profiles from user config
    for (const [id, cfg] of Object.entries(userConfigs)) {
      if (id in TERMINAL_PROFILE_DEFINITIONS) continue; // Already handled above
      if (!("displayName" in cfg) || !("command" in cfg)) continue; // Invalid custom

      const customCfg = cfg as TerminalProfileConfig & {
        displayName: string;
        command: string;
        args?: string[];
        isCustom: true;
      };

      // Detect custom profile command
      const detection = await this.detectCommand(customCfg.commandOverride ?? customCfg.command);

      results.push({
        id,
        displayName: customCfg.displayName,
        command: customCfg.commandOverride ?? customCfg.command,
        defaultArgs: customCfg.argsOverride ?? customCfg.args,
        description: "Custom terminal profile",
        category: "tool",
        group: "community",
        detection,
        config: customCfg,
        isCustom: true,
      });
    }

    return results;
  }

  /**
   * Get the resolved command + args for a profile, applying user overrides.
   * Used by TerminalService when spawning a profile-based terminal.
   */
  resolveProfileCommand(
    profileId: string
  ): { command: string; args: string[]; env?: Record<string, string> } | null {
    const definition = TERMINAL_PROFILE_DEFINITIONS[profileId];
    const userConfigs = this.getUserConfigs();
    const userConfig = userConfigs[profileId];

    if (definition) {
      let command = userConfig?.commandOverride ?? definition.command;

      // If the command is a bare name (not an absolute path), try knownPaths
      // as a fallback. Many tools (e.g. exo) install to non-PATH locations
      // like ~/.exo/bin/ and rely on the user manually updating their shell rc.
      if (!command.includes("/") && definition.knownPaths) {
        for (const kp of definition.knownPaths) {
          const expanded = kp.startsWith("~") ? kp.replace("~", homedir()) : kp;
          try {
            const st = statSync(expanded);
            if (st.isFile() && (st.mode & 0o111) !== 0) {
              command = expanded;
              break;
            }
          } catch {
            // Not found at this path — try next
          }
        }
      }

      return {
        command,
        args: userConfig?.argsOverride ?? definition.defaultArgs ?? [],
        env: userConfig?.env,
      };
    }

    // Custom profile — check if it has command info
    if (userConfig && "command" in userConfig) {
      const custom = userConfig as TerminalProfileConfig & { command: string; args?: string[] };
      return {
        command: custom.commandOverride ?? custom.command,
        args: custom.argsOverride ?? custom.args ?? [],
        env: custom.env,
      };
    }

    return null;
  }

  /** Get install recipes for a profile appropriate for the given runtime type */
  private getInstallRecipes(
    definition: TerminalProfileDefinition,
    runtimeType: RuntimeType
  ): InstallRecipe[] {
    const recipes = definition.install;

    switch (runtimeType) {
      case "local":
      case "worktree":
        return recipes.local ?? [];
      case "ssh":
        return recipes.ssh ?? recipes.local ?? [];
      case "docker":
      case "devcontainer":
        return recipes.docker ?? recipes.local ?? [];
      default:
        return recipes.local ?? [];
    }
  }

  /** Read user's terminal profile configs from ~/.lattice/config.json */
  private getUserConfigs(): Record<string, TerminalProfileConfig> {
    try {
      const config = this.config.loadConfigOrDefault();
      return config.terminalProfiles ?? {};
    } catch {
      return {};
    }
  }

  /** Simple command detection (for custom profiles) */
  private async detectCommand(command: string): Promise<ProfileDetectionStatus> {
    try {
      const result = await findCommandWithAliases(command);
      return { installed: result.found, commandPath: result.resolvedCommand };
    } catch {
      return { installed: false };
    }
  }
}
