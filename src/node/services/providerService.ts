/**
 * Provider Service — Agent-only architecture.
 *
 * Manages custom model lists for CLI agents and config change events.
 * SDK API key management, test connections to API providers, etc. have been removed.
 * CLI agents handle their own authentication.
 */

import { EventEmitter } from "events";
import type { Config } from "@/node/config";
import { SUPPORTED_PROVIDERS } from "@/common/constants/providers";
import type { Result } from "@/common/types/result";
import type {
  AWSCredentialStatus,
  ProviderConfigInfo,
  ProvidersConfigMap,
} from "@/common/orpc/types";
import { log } from "@/node/services/log";

// Re-export types for backward compatibility
export type { AWSCredentialStatus, ProviderConfigInfo, ProvidersConfigMap };

export class ProviderService {
  private readonly emitter = new EventEmitter();

  constructor(private readonly config: Config) {
    // The provider config subscription may have many concurrent listeners (e.g. multiple windows).
    // Avoid noisy MaxListenersExceededWarning for normal usage.
    this.emitter.setMaxListeners(500);
  }

  /**
   * Subscribe to config change events. Used by oRPC subscription handler.
   * Returns a cleanup function.
   */
  onConfigChanged(callback: () => void): () => void {
    this.emitter.on("configChanged", callback);
    return () => this.emitter.off("configChanged", callback);
  }

  private emitConfigChanged(): void {
    this.emitter.emit("configChanged");
  }

  public list(): string[] {
    try {
      return [...SUPPORTED_PROVIDERS];
    } catch (error) {
      log.error("Failed to list providers:", error);
      return [];
    }
  }

  /**
   * Get the providers config map.
   * In agent-only architecture, this mainly returns custom model lists.
   * CLI agents handle their own auth; isConfigured is always true for listed agents.
   */
  public getConfig(): ProvidersConfigMap {
    const providersConfig = this.config.loadProvidersConfig() ?? {};
    const result: ProvidersConfigMap = {};

    for (const provider of SUPPORTED_PROVIDERS) {
      const config = (providersConfig[provider] ?? {}) as {
        models?: string[];
      };

      const providerInfo: ProviderConfigInfo = {
        apiKeySet: false,
        isConfigured: true, // CLI agents handle their own auth
        models: config.models,
      };

      result[provider] = providerInfo;
    }

    return result;
  }

  /**
   * Set custom models for a provider/agent
   */
  public setModels(provider: string, models: string[]): Result<void, string> {
    try {
      const providersConfig = this.config.loadProvidersConfig() ?? {};

      if (!providersConfig[provider]) {
        providersConfig[provider] = {};
      }

      providersConfig[provider].models = models;
      this.config.saveProvidersConfig(providersConfig);
      this.emitConfigChanged();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to set models: ${message}` };
    }
  }

  /**
   * Test connection to a CLI agent.
   * For now, just checks if the agent slug is recognized.
   * Individual agent auth is handled by the CLI agent itself.
   */
  public async testConnection(
    provider: string,
    _model?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      return { success: false, message: `Unknown agent: ${provider}` };
    }
    return { success: true, message: `Agent ${provider} is available.` };
  }

  /**
   * Set a config value for a provider/agent.
   * In agent-only architecture, this is mainly used for custom model lists.
   */
  public setConfig(provider: string, keyPath: string[], value: string): Result<void, string> {
    try {
      const providersConfig = this.config.loadProvidersConfig() ?? {};

      if (!providersConfig[provider]) {
        providersConfig[provider] = {};
      }

      let current = providersConfig[provider] as Record<string, unknown>;
      for (let i = 0; i < keyPath.length - 1; i++) {
        const key = keyPath[i];
        if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }

      if (keyPath.length > 0) {
        const lastKey = keyPath[keyPath.length - 1];
        if (value === "") {
          delete current[lastKey];
        } else {
          current[lastKey] = value;
        }
      }

      this.config.saveProvidersConfig(providersConfig);
      this.emitConfigChanged();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to set provider config: ${message}` };
    }
  }
}
