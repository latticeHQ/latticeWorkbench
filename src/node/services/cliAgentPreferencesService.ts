/**
 * CLI Agent Preferences Service
 *
 * Persists per-agent settings (enabled, default flags, env vars, timeout)
 * to ~/.lattice/agent-preferences.json. Each agent slug maps to a
 * CliAgentPreferences object.
 */

import * as fs from "fs";
import * as path from "path";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";

export interface CliAgentPreferences {
  enabled: boolean;
  defaultFlags?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type AllAgentPreferences = Record<string, CliAgentPreferences>;

const DEFAULT_PREFERENCES: CliAgentPreferences = {
  enabled: true,
};

export class CliAgentPreferencesService {
  private readonly filePath: string;
  private cache: AllAgentPreferences | null = null;

  constructor(config: Config) {
    this.filePath = path.join(config.rootDir, "agent-preferences.json");
  }

  /**
   * Get preferences for all agents.
   */
  getAll(): AllAgentPreferences {
    if (this.cache) return this.cache;
    return this.load();
  }

  /**
   * Get preferences for a single agent. Returns defaults if not configured.
   */
  get(slug: string): CliAgentPreferences {
    const all = this.getAll();
    return all[slug] ?? { ...DEFAULT_PREFERENCES };
  }

  /**
   * Set preferences for a single agent.
   */
  set(slug: string, preferences: CliAgentPreferences): void {
    const all = this.getAll();
    all[slug] = preferences;
    this.save(all);
  }

  /**
   * Check if an agent is enabled (defaults to true for unknown agents).
   */
  isEnabled(slug: string): boolean {
    return this.get(slug).enabled;
  }

  /**
   * Load preferences from disk.
   */
  private load(): AllAgentPreferences {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(data) as AllAgentPreferences;
        this.cache = parsed;
        return parsed;
      }
    } catch (error) {
      log.debug("[CliAgentPreferences] Error loading preferences:", error);
    }
    this.cache = {};
    return {};
  }

  /**
   * Save preferences to disk.
   */
  private save(preferences: AllAgentPreferences): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(preferences, null, 2), "utf-8");
      this.cache = preferences;
    } catch (error) {
      log.error("[CliAgentPreferences] Error saving preferences:", error);
    }
  }
}
