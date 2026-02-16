import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "@/node/config";
import { ProviderService } from "./providerService";

describe("ProviderService (agent-only)", () => {
  it("returns config with custom models for agents", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-provider-service-"));
    try {
      const config = new Config(tmpDir);
      config.saveProvidersConfig({
        "claude-code": {
          models: ["claude-sonnet-4-5", "claude-opus-4-5"],
        },
      });

      const service = new ProviderService(config);
      const cfg = service.getConfig();

      // CLI agents are always considered configured
      for (const key of Object.keys(cfg)) {
        expect(cfg[key].isConfigured).toBe(true);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets and retrieves custom models", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-provider-service-"));
    try {
      const config = new Config(tmpDir);
      const service = new ProviderService(config);

      const result = service.setModels("claude-code", ["claude-sonnet-4-5"]);
      expect(result.success).toBe(true);

      const cfg = service.getConfig();
      expect(cfg["claude-code"]?.models).toContain("claude-sonnet-4-5");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
