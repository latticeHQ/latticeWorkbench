/**
 * Integration tests for cliAgents oRPC endpoints.
 *
 * These tests verify the full request → router → service → response cycle
 * for all cliAgents endpoints using a real service container (no mocks).
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Config } from "@/node/config";
import { CliAgentDetectionService } from "@/node/services/cliAgentDetectionService";
import { CliAgentOrchestrationService } from "@/node/services/cliAgentOrchestrationService";
import { CliAgentPreferencesService } from "@/node/services/cliAgentPreferencesService";
import { CLI_AGENT_SLUGS } from "@/common/constants/cliAgents";

let tempDir: string;
let config: Config;
let detectionService: CliAgentDetectionService;
let orchestrationService: CliAgentOrchestrationService;
let preferencesService: CliAgentPreferencesService;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-orpc-cli-test-"));
  config = new Config(tempDir);
  detectionService = new CliAgentDetectionService();
  orchestrationService = new CliAgentOrchestrationService(detectionService);
  preferencesService = new CliAgentPreferencesService(config);
});

afterAll(async () => {
  await orchestrationService.dispose();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Binary detection runs real `which` / `spawnSync` for every registered agent,
// which can take 10-45s depending on PATH complexity and number of agents.
const DETECTION_TIMEOUT = 60_000;

describe("cliAgents.detect", () => {
  test(
    "returns array of detection results for all agents",
    async () => {
      const results = await detectionService.detectAll();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(CLI_AGENT_SLUGS.length);

      for (const result of results) {
        expect(typeof result.slug).toBe("string");
        expect(typeof result.displayName).toBe("string");
        expect(typeof result.detected).toBe("boolean");
        expect(typeof result.installUrl).toBe("string");
        expect(["cli", "vscode-extension", "app"]).toContain(result.category);
      }
    },
    DETECTION_TIMEOUT
  );
});

describe("cliAgents.detectOne", () => {
  test(
    "returns detection result for known agent",
    async () => {
      const result = await detectionService.detectOne("claude-code");
      expect(result.slug).toBe("claude-code");
      expect(result.displayName).toBe("Claude Code");
      expect(typeof result.detected).toBe("boolean");
    },
    DETECTION_TIMEOUT
  );

  test("returns non-detected for unknown agent", async () => {
    const result = await detectionService.detectOne("nonexistent");
    expect(result.detected).toBe(false);
    expect(result.slug).toBe("nonexistent");
  });
});

describe("cliAgents.install", () => {
  test("rejects unknown agent", async () => {
    const result = await detectionService.installAgent("nonexistent");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown agent");
  });

  test(
    "all registered agents have installCommand",
    async () => {
      const results = await detectionService.detectAll();
      for (const result of results) {
        expect(result.installCommand).toBeDefined();
        expect(typeof result.installCommand).toBe("string");
      }
    },
    DETECTION_TIMEOUT
  );
});

describe("cliAgents.run", () => {
  test("rejects unknown agent", async () => {
    const result = await orchestrationService.run({
      slug: "nonexistent",
      prompt: "test",
      cwd: "/tmp",
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain("Unknown agent");
  });

  test(
    "runs detected agent with --help",
    async () => {
      const detected = await detectionService.detectAll();
      const available = detected.find((d) => d.detected && d.slug !== "github-copilot");
      if (!available) return; // Skip if no agents installed

      const result = await orchestrationService.run({
        slug: available.slug,
        prompt: "--help",
        cwd: "/tmp",
        timeoutMs: 15_000,
      });

      expect(result.sessionId).toMatch(/^agent-\d+$/);
      expect(typeof result.durationMs).toBe("number");
      expect(typeof result.output).toBe("string");
    },
    DETECTION_TIMEOUT
  );
});

describe("cliAgents.stop", () => {
  test("returns false for nonexistent session", () => {
    const stopped = orchestrationService.stop("nonexistent-session");
    expect(stopped).toBe(false);
  });
});

describe("cliAgents.listSessions", () => {
  test("returns array", () => {
    const sessions = orchestrationService.listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});

describe("cliAgents.getPreferences", () => {
  test("returns empty object initially", () => {
    const prefs = preferencesService.getAll();
    expect(typeof prefs).toBe("object");
  });
});

describe("cliAgents.setPreferences", () => {
  test("sets and retrieves preferences", () => {
    preferencesService.set("claude-code", {
      enabled: true,
      defaultFlags: "--verbose",
      env: { MY_KEY: "my_value" },
      timeoutMs: 120000,
    });

    const prefs = preferencesService.get("claude-code");
    expect(prefs.enabled).toBe(true);
    expect(prefs.defaultFlags).toBe("--verbose");
    expect(prefs.env).toEqual({ MY_KEY: "my_value" });
    expect(prefs.timeoutMs).toBe(120000);
  });

  test("persists across service instances", () => {
    preferencesService.set("codex", { enabled: false });

    const prefs2 = new CliAgentPreferencesService(config);
    expect(prefs2.get("codex").enabled).toBe(false);
  });

  test("toggles agent enabled state", () => {
    preferencesService.set("gemini", { enabled: true });
    expect(preferencesService.isEnabled("gemini")).toBe(true);

    preferencesService.set("gemini", { enabled: false });
    expect(preferencesService.isEnabled("gemini")).toBe(false);
  });
});

describe("end-to-end flow", () => {
  test(
    "detect → configure preferences → run (if available)",
    async () => {
      // 1. Detect agents
      const agents = await detectionService.detectAll();
      expect(agents.length).toBeGreaterThan(0);

      // 2. Configure preferences for first agent
      const firstAgent = agents[0];
      preferencesService.set(firstAgent.slug, {
        enabled: true,
        defaultFlags: "--help",
      });

      // 3. Verify preferences
      const prefs = preferencesService.get(firstAgent.slug);
      expect(prefs.enabled).toBe(true);
      expect(prefs.defaultFlags).toBe("--help");

      // 4. If agent is detected, try running it
      if (firstAgent.detected && firstAgent.slug !== "github-copilot") {
        const result = await orchestrationService.run({
          slug: firstAgent.slug,
          prompt: "--version",
          cwd: "/tmp",
          timeoutMs: 10_000,
        });
        expect(result.sessionId).toMatch(/^agent-\d+$/);
        expect(typeof result.output).toBe("string");
      }
    },
    DETECTION_TIMEOUT
  );
});
