import { describe, expect, it, spyOn } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Config } from "@/node/config";
import { PolicyService } from "@/node/services/policyService";
import { VoiceService } from "./voiceService";

async function withTempConfig(
  run: (
    config: Config,
    service: VoiceService,
    policyService: PolicyService
  ) => Promise<void>
): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-voice-service-"));
  try {
    const config = new Config(tmpDir);
    const policyService = new PolicyService(config);
    const service = new VoiceService(config, policyService);
    await run(config, service, policyService);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("VoiceService.transcribe", () => {
  it("returns provider-disabled error without calling fetch", async () => {
    await withTempConfig(async (config, service) => {
      config.saveProvidersConfig({
        openai: {
          apiKey: "sk-test",
          enabled: false,
        },
      });

      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("transcribed text"));

      try {
        const result = await service.transcribe("Zm9v");

        expect(result).toEqual({
          success: false,
          error:
            "OpenAI provider is disabled. Enable it in Settings → Providers to use voice input.",
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  it("calls fetch when OpenAI provider is enabled with an API key", async () => {
    await withTempConfig(async (config, service) => {
      config.saveProvidersConfig({
        openai: {
          apiKey: "sk-test",
        },
      });

      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("transcribed text"));

      try {
        const result = await service.transcribe("Zm9v");

        expect(result).toEqual({ success: true, data: "transcribed text" });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  it("returns error when no OpenAI key is configured", async () => {
    await withTempConfig(async (_config, service) => {
      const fetchSpy = spyOn(globalThis, "fetch");
      fetchSpy.mockResolvedValue(new Response("transcribed text"));

      try {
        const result = await service.transcribe("Zm9v");

        expect(result).toEqual({
          success: false,
          error:
            "Voice input requires an OpenAI API key. Configure in Settings → Providers.",
        });
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
