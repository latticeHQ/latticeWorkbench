import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CliAgentPreferencesService } from "./cliAgentPreferencesService";
import { Config } from "@/node/config";

describe("CliAgentPreferencesService", () => {
  let tempDir: string;
  let config: Config;
  let service: CliAgentPreferencesService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lattice-prefs-test-"));
    config = new Config(tempDir);
    service = new CliAgentPreferencesService(config);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getAll", () => {
    test("returns empty object when no preferences file exists", () => {
      const all = service.getAll();
      expect(all).toEqual({});
    });

    test("returns saved preferences after set", () => {
      service.set("claude-code", { enabled: true, defaultFlags: "--verbose" });
      const all = service.getAll();
      expect(all["claude-code"]).toEqual({ enabled: true, defaultFlags: "--verbose" });
    });

    test("returns preferences from multiple agents", () => {
      service.set("claude-code", { enabled: true });
      service.set("codex", { enabled: false, timeoutMs: 60000 });
      const all = service.getAll();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["claude-code"]?.enabled).toBe(true);
      expect(all["codex"]?.enabled).toBe(false);
      expect(all["codex"]?.timeoutMs).toBe(60000);
    });
  });

  describe("get", () => {
    test("returns default preferences for unknown agent", () => {
      const prefs = service.get("nonexistent");
      expect(prefs.enabled).toBe(true);
    });

    test("returns saved preferences for known agent", () => {
      service.set("claude-code", {
        enabled: false,
        defaultFlags: "-p",
        env: { MY_VAR: "hello" },
        timeoutMs: 120000,
      });
      const prefs = service.get("claude-code");
      expect(prefs.enabled).toBe(false);
      expect(prefs.defaultFlags).toBe("-p");
      expect(prefs.env).toEqual({ MY_VAR: "hello" });
      expect(prefs.timeoutMs).toBe(120000);
    });
  });

  describe("set", () => {
    test("persists preferences to disk", () => {
      service.set("claude-code", { enabled: true, defaultFlags: "--verbose" });

      // Create a new service instance to verify disk persistence
      const service2 = new CliAgentPreferencesService(config);
      const prefs = service2.get("claude-code");
      expect(prefs.enabled).toBe(true);
      expect(prefs.defaultFlags).toBe("--verbose");
    });

    test("overwrites existing preferences", () => {
      service.set("codex", { enabled: true, defaultFlags: "--old" });
      service.set("codex", { enabled: false, defaultFlags: "--new" });
      const prefs = service.get("codex");
      expect(prefs.enabled).toBe(false);
      expect(prefs.defaultFlags).toBe("--new");
    });

    test("creates file in correct location", () => {
      service.set("claude-code", { enabled: true });
      const filePath = path.join(tempDir, "agent-preferences.json");
      expect(fs.existsSync(filePath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      expect(content["claude-code"]).toBeDefined();
    });

    test("stores env as Record<string, string>", () => {
      service.set("codex", {
        enabled: true,
        env: { API_KEY: "test", REGION: "us-east-1" },
      });
      const prefs = service.get("codex");
      expect(prefs.env).toEqual({ API_KEY: "test", REGION: "us-east-1" });
    });
  });

  describe("isEnabled", () => {
    test("returns true for unknown agents (default)", () => {
      expect(service.isEnabled("anything")).toBe(true);
    });

    test("returns false for disabled agents", () => {
      service.set("codex", { enabled: false });
      expect(service.isEnabled("codex")).toBe(false);
    });

    test("returns true for enabled agents", () => {
      service.set("claude-code", { enabled: true });
      expect(service.isEnabled("claude-code")).toBe(true);
    });
  });

  describe("caching", () => {
    test("uses cache for repeated getAll calls", () => {
      service.set("claude-code", { enabled: true });
      const result1 = service.getAll();
      const result2 = service.getAll();
      // Same object reference = cached
      expect(result1).toBe(result2);
    });

    test("cache is updated after set", () => {
      service.set("claude-code", { enabled: true });
      const beforeCount = Object.keys(service.getAll()).length;
      service.set("codex", { enabled: false });
      const afterCount = Object.keys(service.getAll()).length;
      expect(beforeCount).toBe(1);
      expect(afterCount).toBe(2);
    });
  });

  describe("error handling", () => {
    test("returns empty on corrupt file", () => {
      const filePath = path.join(tempDir, "agent-preferences.json");
      fs.writeFileSync(filePath, "NOT VALID JSON", "utf-8");
      const service2 = new CliAgentPreferencesService(config);
      expect(service2.getAll()).toEqual({});
    });
  });
});
