import { EventEmitter } from "events";
import type { Config } from "@/node/config";
import { SUPPORTED_PROVIDERS, PROVIDER_DEFINITIONS } from "@/common/constants/providers";
import type { ProviderName } from "@/common/constants/providers";
import type { Result } from "@/common/types/result";
import type {
  AWSCredentialStatus,
  ProviderConfigInfo,
  ProvidersConfigMap,
} from "@/common/orpc/types";
import { log } from "@/node/services/log";
import { checkProviderConfigured } from "@/node/utils/providerRequirements";
import { hasClaudeCodeCredentials, getClaudeCodeAccessToken, isOAuthToken } from "./claudeCodeCredentials";
import { findClaudeBinary, isClaudeCliAuthenticated } from "./claudeCodeProvider";

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
   * Get the full providers config with safe info (no actual API keys)
   */
  public getConfig(): ProvidersConfigMap {
    const providersConfig = this.config.loadProvidersConfig() ?? {};
    const result: ProvidersConfigMap = {};

    for (const provider of SUPPORTED_PROVIDERS) {
      const config = (providersConfig[provider] ?? {}) as {
        apiKey?: string;
        baseUrl?: string;
        models?: string[];
        serviceTier?: unknown;
        region?: string;
        bearerToken?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
      };

      const providerInfo: ProviderConfigInfo = {
        apiKeySet: !!config.apiKey,
        isConfigured: false, // computed below
        baseUrl: config.baseUrl,
        models: config.models,
      };

      // OpenAI-specific fields
      const serviceTier = config.serviceTier;
      if (
        provider === "openai" &&
        (serviceTier === "auto" ||
          serviceTier === "default" ||
          serviceTier === "flex" ||
          serviceTier === "priority")
      ) {
        providerInfo.serviceTier = serviceTier;
      }

      // AWS/Bedrock-specific fields
      if (provider === "bedrock") {
        providerInfo.aws = {
          region: config.region,
          bearerTokenSet: !!config.bearerToken,
          accessKeyIdSet: !!config.accessKeyId,
          secretAccessKeySet: !!config.secretAccessKey,
        };
      }

      // Compute isConfigured using shared utility (checks config + env vars)
      // For claude-code: check if CLI binary is available (it handles auth internally)
      if (provider === "claude-code") {
        providerInfo.isConfigured = !!findClaudeBinary();
      } else {
        providerInfo.isConfigured = checkProviderConfigured(provider, config).isConfigured;
      }

      result[provider] = providerInfo;
    }

    return result;
  }

  /**
   * Set custom models for a provider
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
   * Test connection to a provider by making a minimal API call.
   * Returns success/failure with a message and latency.
   */
  public async testConnection(
    provider: string,
    model?: string
  ): Promise<{ success: boolean; message: string; latencyMs?: number }> {
    const providerName = provider as ProviderName;
    const providerDef = PROVIDER_DEFINITIONS[providerName];
    if (!providerDef) {
      return { success: false, message: `Unknown provider: ${provider}` };
    }

    try {
      const start = Date.now();

      // Claude Code: spawn CLI to verify authentication
      if (providerName === "claude-code") {
        if (!findClaudeBinary()) {
          return {
            success: false,
            message: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
          };
        }

        const result = await isClaudeCliAuthenticated();
        const latencyMs = Date.now() - start;
        return {
          success: result.ok,
          message: result.message,
          latencyMs,
        };
      }

      // Standard providers: try making a lightweight API call
      const providersConfig = this.config.loadProvidersConfig() ?? {};
      const config = (providersConfig[provider] ?? {}) as Record<string, unknown>;
      const apiKey = (config.apiKey as string) || "";

      if (!apiKey && providerDef.requiresApiKey) {
        return { success: false, message: `No API key configured for ${provider}.` };
      }

      // For anthropic, openai, google etc. — make a health check request
      const baseUrls: Record<string, string> = {
        anthropic: "https://api.anthropic.com/v1/messages",
        openai: "https://api.openai.com/v1/models",
        google: "https://generativelanguage.googleapis.com/v1beta/models",
        xai: "https://api.x.ai/v1/models",
        deepseek: "https://api.deepseek.com/v1/models",
        openrouter: "https://openrouter.ai/api/v1/models",
      };

      const testUrl = (config.baseUrl as string) || (config.baseURL as string) || baseUrls[provider];
      if (!testUrl) {
        // For providers without a known test URL (bedrock, ollama, etc.), just check config
        const configCheck = checkProviderConfigured(providerName, config);
        return configCheck.isConfigured
          ? { success: true, message: `Provider ${provider} is configured.` }
          : { success: false, message: `Provider ${provider} is not configured.` };
      }

      // Use a models endpoint (GET) for most providers
      const isAnthropic = provider === "anthropic";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (isAnthropic) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      // For anthropic, we need a POST to /messages; for others, GET to /models works
      let response: Response;
      if (isAnthropic) {
        response = await fetch(testUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: model ?? "claude-sonnet-4-20250514",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
          signal: AbortSignal.timeout(15000),
        });
      } else {
        // GET /models endpoint for OpenAI-compatible providers
        const modelsUrl = testUrl.replace(/\/chat\/completions\/?$/, "/models").replace(/\/$/, "");
        response = await fetch(modelsUrl, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(15000),
        });
      }

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { success: true, message: `Connection successful.`, latencyMs };
      }

      const errorBody = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        return { success: false, message: `Authentication failed (${response.status}). Check your API key.`, latencyMs };
      }
      return { success: false, message: `API returned ${response.status}: ${errorBody.slice(0, 200)}`, latencyMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("timeout") || message.includes("TimeoutError")) {
        return { success: false, message: "Connection timed out after 15 seconds." };
      }
      return { success: false, message: `Connection failed: ${message}` };
    }
  }

  public setConfig(provider: string, keyPath: string[], value: string): Result<void, string> {
    try {
      // Load current providers config or create empty
      const providersConfig = this.config.loadProvidersConfig() ?? {};

      // Ensure provider exists
      if (!providersConfig[provider]) {
        providersConfig[provider] = {};
      }

      // Set nested property value
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
        // Delete key if value is empty string (used for clearing API keys), otherwise set it
        if (value === "") {
          delete current[lastKey];
        } else {
          current[lastKey] = value;
        }
      }

      // Save updated config
      this.config.saveProvidersConfig(providersConfig);
      this.emitConfigChanged();

      return { success: true, data: undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Failed to set provider config: ${message}` };
    }
  }
}
