import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "@/node/config";
import { ProviderModelFactory } from "./providerModelFactory";
import { ProviderService } from "./providerService";

async function withTempConfig(
  run: (config: Config, factory: ProviderModelFactory) => Promise<void> | void
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-provider-model-factory-"));

  try {
    const config = new Config(tmpDir);
    const providerService = new ProviderService(config);
    const factory = new ProviderModelFactory(config, providerService);
    await run(config, factory);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("ProviderModelFactory.createModel", () => {
  it("returns provider_disabled when a provider is disabled", async () => {
    await withTempConfig(async (config, factory) => {
      config.saveProvidersConfig({
        openai: {
          apiKey: "sk-test",
          enabled: false,
        },
      });

      const result = await factory.createModel("openai:gpt-5");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toEqual({
          type: "provider_disabled",
          provider: "openai",
        });
      }
    });
  });

  it("does not return provider_disabled when provider is enabled and credentials exist", async () => {
    await withTempConfig(async (config, factory) => {
      config.saveProvidersConfig({
        openai: {
          apiKey: "sk-test",
        },
      });

      const result = await factory.createModel("openai:gpt-5");

      if (!result.success) {
        expect(result.error.type).not.toBe("provider_disabled");
      }
    });
  });

});
