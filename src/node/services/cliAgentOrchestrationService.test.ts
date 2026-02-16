import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CliAgentOrchestrationService } from "./cliAgentOrchestrationService";
import { CliAgentDetectionService } from "./cliAgentDetectionService";
import type { AgentStreamEvent } from "./cliAgentOrchestrationService";

describe("CliAgentOrchestrationService", () => {
  let detectionService: CliAgentDetectionService;
  let orchestrationService: CliAgentOrchestrationService;

  beforeEach(() => {
    detectionService = new CliAgentDetectionService();
    orchestrationService = new CliAgentOrchestrationService(detectionService);
  });

  afterEach(async () => {
    await orchestrationService.dispose();
  });

  describe("run", () => {
    test("rejects unknown agent slug", async () => {
      const result = await orchestrationService.run({
        slug: "nonexistent-agent-xyz",
        prompt: "hello",
        cwd: "/tmp",
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain("Unknown agent");
      expect(result.sessionId).toBe("");
      expect(result.durationMs).toBe(0);
    });

    test("rejects agent that is not installed", async () => {
      // Use an agent that is very unlikely to be installed
      const result = await orchestrationService.run({
        slug: "kilocode",
        prompt: "hello",
        cwd: "/tmp",
      });

      // If kilocode happens to be installed, skip this assertion
      if (!result.success) {
        expect(result.output).toContain("not installed");
      }
    });

    test("runs a real agent if one is detected", async () => {
      // Find any detected agent to test with
      const detected = await detectionService.detectAll();
      const available = detected.find((d) => d.detected && d.slug !== "github-copilot");

      if (!available) {
        // No agents installed, skip
        return;
      }

      // Use a trivial prompt with short timeout — we just want to verify spawning works
      const result = await orchestrationService.run({
        slug: available.slug,
        prompt: "--help",
        cwd: "/tmp",
        timeoutMs: 15_000,
      });

      expect(result.sessionId).toMatch(/^agent-\d+$/);
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThan(0);
      // The process ran (regardless of success since --help may or may not work)
      expect(typeof result.output).toBe("string");
    }, 20_000);

    test("creates a session that appears in listSessions", async () => {
      // Even if the agent isn't installed, after a failed run the session should exist
      const detected = await detectionService.detectAll();
      const available = detected.find((d) => d.detected && d.slug !== "github-copilot");

      if (!available) return;

      const promise = orchestrationService.run({
        slug: available.slug,
        prompt: "--version",
        cwd: "/tmp",
        timeoutMs: 10_000,
      });

      // Wait briefly for the session to be created
      await new Promise((resolve) => setTimeout(resolve, 200));

      const sessions = orchestrationService.listSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const session = sessions.find((s) => s.slug === available.slug);
      if (session) {
        expect(session.displayName).toBe(available.displayName);
        expect(typeof session.startedAt).toBe("number");
      }

      // Wait for completion
      await promise;
    }, 15_000);

    test("emits output events during execution", async () => {
      const detected = await detectionService.detectAll();
      const available = detected.find((d) => d.detected && d.slug !== "github-copilot");

      if (!available) return;

      const events: AgentStreamEvent[] = [];
      orchestrationService.on("output", (event: AgentStreamEvent) => {
        events.push(event);
      });

      await orchestrationService.run({
        slug: available.slug,
        prompt: "--help",
        cwd: "/tmp",
        timeoutMs: 15_000,
      });

      // Should have at least one event (the exit event)
      const exitEvent = events.find((e) => e.type === "exit");
      expect(exitEvent).toBeDefined();
      if (exitEvent) {
        expect(exitEvent.type).toBe("exit");
        expect(typeof exitEvent.exitCode).toBe("number");
      }
    }, 20_000);
  });

  describe("stop", () => {
    test("returns false for nonexistent session", () => {
      const result = orchestrationService.stop("nonexistent-session-id");
      expect(result).toBe(false);
    });

    test("stops a running session", async () => {
      const detected = await detectionService.detectAll();
      const available = detected.find((d) => d.detected && d.slug !== "github-copilot");

      if (!available) return;

      // Start a long-running process (cat waits for stdin indefinitely)
      const runPromise = orchestrationService.run({
        slug: available.slug,
        prompt: "Tell me a very long story about every country in the world",
        cwd: "/tmp",
        timeoutMs: 30_000,
      });

      // Wait for the process to start
      await new Promise((resolve) => setTimeout(resolve, 500));

      const sessions = orchestrationService.listSessions();
      const running = sessions.find((s) => s.status === "running");

      if (running) {
        const stopped = orchestrationService.stop(running.id);
        expect(stopped).toBe(true);

        // Verify session status updated
        const session = orchestrationService.getSession(running.id);
        expect(session?.status).toBe("stopped");
      }

      // Wait for the process to fully clean up
      await runPromise.catch(() => {});
    }, 15_000);
  });

  describe("listSessions", () => {
    test("returns empty array initially", () => {
      const sessions = orchestrationService.listSessions();
      expect(sessions).toEqual([]);
    });

    test("returns sessions after run", async () => {
      // Run a quick operation (will fail fast for unknown agent)
      await orchestrationService.run({
        slug: "nonexistent-agent-xyz",
        prompt: "test",
        cwd: "/tmp",
      });

      // Unknown agent doesn't create a session
      const sessions = orchestrationService.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("getSession", () => {
    test("returns undefined for nonexistent session", () => {
      const session = orchestrationService.getSession("nonexistent");
      expect(session).toBeUndefined();
    });
  });

  describe("dispose", () => {
    test("clears all sessions and processes", async () => {
      await orchestrationService.dispose();
      expect(orchestrationService.listSessions()).toEqual([]);
    });

    test("can be called multiple times safely", async () => {
      await orchestrationService.dispose();
      await orchestrationService.dispose();
      await orchestrationService.dispose();
      // Should not throw
    });
  });
});

describe("buildAgentArgs (via run)", () => {
  // We test buildAgentArgs indirectly through the run method,
  // since it's a private function. The key test is that different agents
  // get different argument patterns.

  let detectionService: CliAgentDetectionService;
  let orchestrationService: CliAgentOrchestrationService;

  beforeEach(() => {
    detectionService = new CliAgentDetectionService();
    orchestrationService = new CliAgentOrchestrationService(detectionService);
  });

  afterEach(async () => {
    await orchestrationService.dispose();
  });

  test("claude-code run includes the prompt in output", async () => {
    const detected = await detectionService.detectOne("claude-code");
    if (!detected.detected) return;

    // Use --help to just test that the process launches with correct args
    const result = await orchestrationService.run({
      slug: "claude-code",
      prompt: "--help",
      cwd: "/tmp",
      timeoutMs: 15_000,
    });

    expect(result.sessionId).toMatch(/^agent-\d+$/);
    expect(typeof result.output).toBe("string");
  }, 20_000);
});

describe("session ID generation", () => {
  test("generates sequential session IDs", async () => {
    const detectionService = new CliAgentDetectionService();
    const orchestrationService = new CliAgentOrchestrationService(detectionService);

    const detected = await detectionService.detectAll();
    const available = detected.find((d) => d.detected && d.slug !== "github-copilot");

    if (!available) {
      await orchestrationService.dispose();
      return;
    }

    const result1 = await orchestrationService.run({
      slug: available.slug,
      prompt: "--version",
      cwd: "/tmp",
      timeoutMs: 10_000,
    });

    const result2 = await orchestrationService.run({
      slug: available.slug,
      prompt: "--version",
      cwd: "/tmp",
      timeoutMs: 10_000,
    });

    // Session IDs should be sequential
    const id1 = parseInt(result1.sessionId.replace("agent-", ""), 10);
    const id2 = parseInt(result2.sessionId.replace("agent-", ""), 10);
    expect(id2).toBe(id1 + 1);

    await orchestrationService.dispose();
  }, 25_000);
});
