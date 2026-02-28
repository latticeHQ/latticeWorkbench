/**
 * Terminal profile user configuration types.
 * Stored in ~/.lattice/config.json under `terminalProfiles`.
 *
 * Known profiles are defined in src/common/constants/terminalProfiles.ts.
 * This file defines user overrides and custom profile shapes.
 */

import type { InstallRecipe } from "../constants/terminalProfiles";

/** User-level config stored per-profile in ~/.lattice/config.json */
export interface TerminalProfileConfig {
  /** Whether this profile appears in the "+" dropdown and command palette */
  enabled: boolean;
  /** Override the default command (e.g. custom path to binary) */
  commandOverride?: string;
  /** Override default args */
  argsOverride?: string[];
  /** Extra environment variables to inject when spawning */
  env?: Record<string, string>;
}

/**
 * Custom terminal profile defined by the user (not in the known registry).
 * Stored alongside TerminalProfileConfig with extra fields.
 */
export interface CustomTerminalProfile extends TerminalProfileConfig {
  /** User-chosen display name */
  displayName: string;
  /** Command to run */
  command: string;
  /** Arguments */
  args?: string[];
  /** Whether this is a user-defined custom profile */
  isCustom: true;
}

/** Detection result for a single profile */
export interface ProfileDetectionStatus {
  /** Whether the CLI is installed and available */
  installed: boolean;
  /** Resolved command path (from `which`), if found */
  commandPath?: string;
  /** Version string if detectable (future enhancement) */
  version?: string;
}

/** Combined profile info returned to the frontend */
export interface TerminalProfileWithStatus {
  /** Profile ID (matches TERMINAL_PROFILE_DEFINITIONS key or custom ID) */
  id: string;
  /** Display name */
  displayName: string;
  /** Primary command */
  command: string;
  /** Default args */
  defaultArgs?: string[];
  /** Description */
  description: string;
  /** Category */
  category: "ai-agent" | "shell" | "tool";
  /** Crew group for UI ("platform" = major vendors, "community" = open-source/indie) */
  group: "platform" | "community";
  /** Detection status */
  detection: ProfileDetectionStatus;
  /** User config (enabled, overrides) */
  config: TerminalProfileConfig;
  /** Available install recipes for the current runtime */
  installRecipes?: InstallRecipe[];
  /** Whether this is a user-defined custom profile */
  isCustom?: boolean;
}

/**
 * Default config for a newly-detected profile.
 * Auto-enabled if installed, disabled if not.
 */
export function defaultProfileConfig(installed: boolean): TerminalProfileConfig {
  return { enabled: installed };
}
