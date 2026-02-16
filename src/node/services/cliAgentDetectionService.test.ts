import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { CliAgentDetectionService } from "./cliAgentDetectionService";
import { CLI_AGENT_DEFINITIONS, CLI_AGENT_SLUGS } from "@/common/constants/cliAgents";

// Binary detection runs real `which` / `spawnSync` for every registered agent,
// which can take 10-45s depending on PATH complexity and number of agents.
const DETECTION_TIMEOUT = 60_000;

describe("CliAgentDetectionService", () => {
  let service: CliAgentDetectionService;

  beforeEach(() => {
    service = new CliAgentDetectionService();
  });

  describe("detectAll", () => {
    test(
      "returns results for all registered agents",
      async () => {
        const results = await service.detectAll();
        expect(results.length).toBe(CLI_AGENT_SLUGS.length);
      },
      DETECTION_TIMEOUT
    );

    test(
      "each result has required fields",
      async () => {
        const results = await service.detectAll();
        for (const result of results) {
          expect(typeof result.slug).toBe("string");
          expect(typeof result.displayName).toBe("string");
          expect(typeof result.description).toBe("string");
          expect(typeof result.detected).toBe("boolean");
          expect(typeof result.installUrl).toBe("string");
          expect(["cli", "vscode-extension", "app"]).toContain(result.category);
        }
      },
      DETECTION_TIMEOUT
    );

    test(
      "sorts detected agents before non-detected",
      async () => {
        const results = await service.detectAll();
        let foundNonDetected = false;
        for (const result of results) {
          if (!result.detected) {
            foundNonDetected = true;
          }
          if (foundNonDetected && result.detected) {
            throw new Error("Detected agent found after non-detected agent — sort is wrong");
          }
        }
      },
      DETECTION_TIMEOUT
    );

    test(
      "caches results within TTL",
      async () => {
        const results1 = await service.detectAll();
        const results2 = await service.detectAll();
        // Same array reference means cache was used
        expect(results1).toBe(results2);
      },
      DETECTION_TIMEOUT
    );

    test(
      "invalidateCache forces fresh detection",
      async () => {
        const results1 = await service.detectAll();
        service.invalidateCache();
        const results2 = await service.detectAll();
        // Different reference means cache was bypassed
        expect(results1).not.toBe(results2);
        // But same content
        expect(results1.length).toBe(results2.length);
      },
      DETECTION_TIMEOUT
    );
  });

  describe("detectOne", () => {
    test("returns unknown agent for invalid slug", async () => {
      const result = await service.detectOne("nonexistent-agent-xyz");
      expect(result.slug).toBe("nonexistent-agent-xyz");
      expect(result.displayName).toBe("nonexistent-agent-xyz");
      expect(result.detected).toBe(false);
      expect(result.installUrl).toBe("");
      expect(result.category).toBe("cli");
    });

    test(
      "returns correct metadata for known agent",
      async () => {
        const result = await service.detectOne("claude-code");
        expect(result.slug).toBe("claude-code");
        expect(result.displayName).toBe("Claude Code");
        expect(result.description).toBe("Anthropic's agentic coding tool");
        expect(result.installUrl).toContain("anthropic.com");
        expect(result.category).toBe("cli");
      },
      DETECTION_TIMEOUT
    );

    test(
      "returns supportedModels for agents that have them",
      async () => {
        const result = await service.detectOne("claude-code");
        expect(result.supportedModels).toBeDefined();
        expect(Array.isArray(result.supportedModels)).toBe(true);
        expect(result.supportedModels!.length).toBeGreaterThan(0);
        expect(result.supportedModels).toContain("claude-sonnet-4-5");
      },
      DETECTION_TIMEOUT
    );

    test(
      "returns undefined supportedModels for agents without them",
      async () => {
        const result = await service.detectOne("cline");
        expect(result.supportedModels).toBeUndefined();
      },
      DETECTION_TIMEOUT
    );

    test(
      "returns correct metadata for codex",
      async () => {
        const result = await service.detectOne("codex");
        expect(result.slug).toBe("codex");
        expect(result.displayName).toBe("Codex");
        expect(result.category).toBe("cli");
        expect(result.installCommand).toBe("npm install -g @openai/codex");
      },
      DETECTION_TIMEOUT
    );

    test(
      "returns correct metadata for cursor (app category)",
      async () => {
        const result = await service.detectOne("cursor");
        expect(result.slug).toBe("cursor");
        expect(result.displayName).toBe("Cursor");
        expect(result.category).toBe("app");
      },
      DETECTION_TIMEOUT
    );

    test(
      "returns correct metadata for github-copilot (gh extension)",
      async () => {
        const result = await service.detectOne("github-copilot");
        expect(result.slug).toBe("github-copilot");
        expect(result.displayName).toBe("GitHub Copilot");
        expect(result.installCommand).toBe("npm install -g @github/copilot");
      },
      DETECTION_TIMEOUT
    );

    test(
      "detected agent has binaryPath set",
      async () => {
        // Test with all agents — any that are detected must have binaryPath
        const results = await service.detectAll();
        for (const result of results) {
          if (result.detected) {
            expect(result.binaryPath).toBeDefined();
            expect(typeof result.binaryPath).toBe("string");
            expect(result.binaryPath!.length).toBeGreaterThan(0);
          }
        }
      },
      DETECTION_TIMEOUT
    );

    test("non-detected agent has no binaryPath", async () => {
      const result = await service.detectOne("nonexistent-agent-xyz");
      expect(result.binaryPath).toBeUndefined();
    });
  });

  describe("installAgent", () => {
    test("rejects unknown agent slug", async () => {
      const result = await service.installAgent("nonexistent-agent-xyz");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown agent");
    });

    test(
      "all registered agents have installCommand",
      async () => {
        // Every provider in the registry should have an install command
        const results = await service.detectAll();
        for (const result of results) {
          expect(result.installCommand).toBeDefined();
          expect(typeof result.installCommand).toBe("string");
          expect(result.installCommand!.length).toBeGreaterThan(0);
        }
      },
      DETECTION_TIMEOUT
    );

    test(
      "reports already-installed agent without re-installing",
      async () => {
        // Detect agents first — if any are already installed, verify the behavior
        const allResults = await service.detectAll();
        const installed = allResults.find((r) => r.detected && r.installCommand);

        if (!installed) {
          // Skip: no agents with installCommand are currently installed
          return;
        }

        const result = await service.installAgent(installed.slug);
        expect(result.success).toBe(true);
        expect(result.message).toContain("already installed");
      },
      DETECTION_TIMEOUT
    );

    test("rejects unknown agent for install", async () => {
      const result = await service.installAgent("nonexistent-agent-xyz");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown agent");
    });
  });

  describe("invalidateCache", () => {
    test(
      "resets cache so next detectAll is fresh",
      async () => {
        const results1 = await service.detectAll();
        service.invalidateCache();
        const results2 = await service.detectAll();
        expect(results1).not.toBe(results2);
      },
      DETECTION_TIMEOUT
    );

    test("can be called multiple times safely", () => {
      service.invalidateCache();
      service.invalidateCache();
      service.invalidateCache();
      // Should not throw
    });
  });
});

describe("CLI_AGENT_DEFINITIONS consistency", () => {
  test("all slugs are lowercase kebab-case", () => {
    for (const slug of CLI_AGENT_SLUGS) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  test("all agents have non-empty required fields", () => {
    for (const slug of CLI_AGENT_SLUGS) {
      const def = CLI_AGENT_DEFINITIONS[slug];
      expect(def.displayName.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.binaryNames.length).toBeGreaterThan(0);
      expect(def.installUrl.length).toBeGreaterThan(0);
      expect(["cli", "vscode-extension", "app"]).toContain(def.category);
    }
  });

  test("all binaryNames are non-empty strings", () => {
    for (const slug of CLI_AGENT_SLUGS) {
      const def = CLI_AGENT_DEFINITIONS[slug];
      for (const name of def.binaryNames) {
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
        // No whitespace in binary names
        expect(name).not.toMatch(/\s/);
      }
    }
  });

  test("installUrls are valid URLs", () => {
    for (const slug of CLI_AGENT_SLUGS) {
      const def = CLI_AGENT_DEFINITIONS[slug];
      expect(def.installUrl).toMatch(/^https?:\/\//);
    }
  });

  test("ghExtension agents have gh in binaryNames", () => {
    for (const slug of CLI_AGENT_SLUGS) {
      const def = CLI_AGENT_DEFINITIONS[slug] as { ghExtension?: string; binaryNames: string[] };
      if (def.ghExtension) {
        expect(def.binaryNames).toContain("gh");
      }
    }
  });

  test("expected agents are registered", () => {
    const expectedSlugs = [
      "claude-code",
      "codex",
      "gemini",
      "cursor",
      "github-copilot",
      "cline",
      "opencode",
    ] as const;
    for (const slug of expectedSlugs) {
      expect(CLI_AGENT_SLUGS).toContain(slug);
    }
  });
});
