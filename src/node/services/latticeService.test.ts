import { EventEmitter } from "events";
import { Readable } from "stream";
import { describe, it, expect, vi, beforeEach, afterEach, spyOn } from "bun:test";
import { LatticeService, compareVersions } from "./latticeService";
import * as childProcess from "child_process";
import * as disposableExec from "@/node/utils/disposableExec";

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

/**
 * Mock execAsync for non-streaming tests.
 * Uses spyOn instead of vi.mock to avoid polluting other test files.
 */
let execAsyncSpy: ReturnType<typeof spyOn<typeof disposableExec, "execAsync">> | null = null;

// Minimal mock that satisfies the interface used by LatticeService
// Uses cast via `unknown` because we only implement the subset actually used by tests
function createMockExecResult(
  result: Promise<{ stdout: string; stderr: string }>
): ReturnType<typeof disposableExec.execAsync> {
  const mock = {
    result,
    get promise() {
      return result;
    },
    child: {}, // not used by LatticeService
    [Symbol.dispose]: noop,
  };
  return mock as unknown as ReturnType<typeof disposableExec.execAsync>;
}

function mockExecOk(stdout: string, stderr = ""): void {
  execAsyncSpy?.mockReturnValue(createMockExecResult(Promise.resolve({ stdout, stderr })));
}

function mockExecError(error: Error): void {
  execAsyncSpy?.mockReturnValue(createMockExecResult(Promise.reject(error)));
}

/**
 * Mock spawn for streaming createWorkspace() tests.
 * Uses spyOn instead of vi.mock to avoid polluting other test files.
 */
let spawnSpy: ReturnType<typeof spyOn<typeof childProcess, "spawn">> | null = null;

function mockLatticeCommandResult(options: {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}): void {
  const stdout = Readable.from(options.stdout ? [Buffer.from(options.stdout)] : []);
  const stderr = Readable.from(options.stderr ? [Buffer.from(options.stderr)] : []);
  const events = new EventEmitter();

  spawnSpy?.mockReturnValue({
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    kill: vi.fn(),
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
  } as never);

  // Emit close after handlers are attached.
  setTimeout(() => events.emit("close", options.exitCode), 0);
}

describe("LatticeService", () => {
  let service: LatticeService;

  beforeEach(() => {
    service = new LatticeService();
    vi.clearAllMocks();
    // Set up spies for mocking - uses spyOn instead of vi.mock to avoid polluting other test files
    execAsyncSpy = spyOn(disposableExec, "execAsync");
    spawnSpy = spyOn(childProcess, "spawn");
  });

  afterEach(() => {
    service.clearCache();
    execAsyncSpy?.mockRestore();
    execAsyncSpy = null;
    spawnSpy?.mockRestore();
    spawnSpy = null;
  });

  describe("getLatticeInfo", () => {
    it("returns available state with valid version", async () => {
      mockExecOk(JSON.stringify({ version: "2.28.2" }));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({ state: "available", version: "2.28.2" });
    });

    it("returns available state for exact minimum version", async () => {
      mockExecOk(JSON.stringify({ version: "2.25.0" }));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({ state: "available", version: "2.25.0" });
    });

    it("returns outdated state for version below minimum", async () => {
      mockExecOk(JSON.stringify({ version: "0.6.9" }));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({ state: "outdated", version: "0.6.9", minVersion: "0.7.0" });
    });

    it("handles version with dev suffix", async () => {
      mockExecOk(JSON.stringify({ version: "2.28.2-devel+903c045b9" }));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({ state: "available", version: "2.28.2-devel+903c045b9" });
    });

    it("returns unavailable state with reason missing when CLI not installed", async () => {
      mockExecError(new Error("command not found: lattice"));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({ state: "unavailable", reason: "missing" });
    });

    it("returns unavailable state with error reason for other errors", async () => {
      mockExecError(new Error("Connection refused"));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({
        state: "unavailable",
        reason: { kind: "error", message: "Connection refused" },
      });
    });

    it("returns unavailable state with error when version is missing from output", async () => {
      mockExecOk(JSON.stringify({}));

      const info = await service.getLatticeInfo();

      expect(info).toEqual({
        state: "unavailable",
        reason: { kind: "error", message: "Version output missing from CLI" },
      });
    });

    it("caches the result", async () => {
      mockExecOk(JSON.stringify({ version: "2.28.2" }));

      await service.getLatticeInfo();
      await service.getLatticeInfo();

      expect(execAsyncSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("listTemplates", () => {
    it("returns templates with display names", async () => {
      execAsyncSpy?.mockReturnValue(
        createMockExecResult(
          Promise.resolve({
            stdout: JSON.stringify([
              {
                Template: {
                  name: "template-1",
                  display_name: "Template One",
                  organization_name: "org1",
                },
              },
              { Template: { name: "template-2", display_name: "Template Two" } },
            ]),
            stderr: "",
          })
        )
      );

      const templates = await service.listTemplates();

      expect(templates).toEqual([
        { name: "template-1", displayName: "Template One", organizationName: "org1" },
        { name: "template-2", displayName: "Template Two", organizationName: "default" },
      ]);
    });

    it("uses name as displayName when display_name not present", async () => {
      execAsyncSpy?.mockReturnValue(
        createMockExecResult(
          Promise.resolve({
            stdout: JSON.stringify([{ Template: { name: "my-template" } }]),
            stderr: "",
          })
        )
      );

      const templates = await service.listTemplates();

      expect(templates).toEqual([
        { name: "my-template", displayName: "my-template", organizationName: "default" },
      ]);
    });

    it("returns empty array on error", async () => {
      mockExecError(new Error("not logged in"));

      const templates = await service.listTemplates();

      expect(templates).toEqual([]);
    });

    it("returns empty array for empty output", async () => {
      mockExecOk("");

      const templates = await service.listTemplates();

      expect(templates).toEqual([]);
    });
  });

  describe("listPresets", () => {
    // listPresets now uses API calls: whoami → templates list → tokens create → fetch.
    // We mock each sequential execAsync call and global fetch.

    function mockListPresetsFlow(presets: unknown[]) {
      let callIndex = 0;
      execAsyncSpy?.mockImplementation(() => {
        const idx = callIndex++;
        if (idx === 0) {
          // getDeploymentUrl() → whoami
          return createMockExecResult(
            Promise.resolve({
              stdout:
                "Lattice is running at http://127.0.0.1:7080, You're authenticated as admin !",
              stderr: "",
            })
          );
        } else if (idx === 1) {
          // getActiveTemplateVersionId() → templates list
          return createMockExecResult(
            Promise.resolve({
              stdout: JSON.stringify([
                {
                  Template: {
                    name: "my-template",
                    organization_name: "default",
                    active_version_id: "ver-123",
                  },
                },
              ]),
              stderr: "",
            })
          );
        } else if (idx === 2) {
          // tokens create
          return createMockExecResult(Promise.resolve({ stdout: "test-token-abc", stderr: "" }));
        } else {
          // tokens remove (cleanup)
          return createMockExecResult(Promise.resolve({ stdout: "", stderr: "" }));
        }
      });
      // Mock fetch for the API call
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(presets),
      }) as unknown as typeof fetch;
      return () => {
        globalThis.fetch = originalFetch;
      };
    }

    it("returns presets for a template", async () => {
      const restoreFetch = mockListPresetsFlow([
        { id: "preset-1", name: "Small", description: "Small instance", default: true },
        { id: "preset-2", name: "Large", description: "Large instance" },
      ]);
      try {
        const presets = await service.listPresets("my-template");

        expect(presets).toEqual([
          { id: "preset-1", name: "Small", description: "Small instance", isDefault: true },
          { id: "preset-2", name: "Large", description: "Large instance", isDefault: false },
        ]);
      } finally {
        restoreFetch();
      }
    });

    it("returns empty array on error", async () => {
      mockExecError(new Error("template not found"));

      const presets = await service.listPresets("nonexistent");

      expect(presets).toEqual([]);
    });
  });

  describe("listWorkspaces", () => {
    it("returns all workspaces regardless of status", async () => {
      mockExecOk(
        JSON.stringify([
          {
            name: "ws-1",
            template_name: "t1",
            template_display_name: "t1",
            latest_build: { status: "running" },
          },
          {
            name: "ws-2",
            template_name: "t2",
            template_display_name: "t2",
            latest_build: { status: "stopped" },
          },
          {
            name: "ws-3",
            template_name: "t3",
            template_display_name: "t3",
            latest_build: { status: "starting" },
          },
        ])
      );

      const workspaces = await service.listWorkspaces();

      expect(workspaces).toEqual([
        { name: "ws-1", templateName: "t1", templateDisplayName: "t1", status: "running" },
        { name: "ws-2", templateName: "t2", templateDisplayName: "t2", status: "stopped" },
        { name: "ws-3", templateName: "t3", templateDisplayName: "t3", status: "starting" },
      ]);
    });

    it("returns empty array on error", async () => {
      mockExecError(new Error("not logged in"));

      const workspaces = await service.listWorkspaces();

      expect(workspaces).toEqual([]);
    });
  });

  describe("workspaceExists", () => {
    it("returns true when exact match is found in search results", async () => {
      mockExecOk(JSON.stringify([{ name: "ws-1" }, { name: "ws-10" }]));

      const exists = await service.workspaceExists("ws-1");

      expect(exists).toBe(true);
    });

    it("returns false when only prefix matches", async () => {
      mockExecOk(JSON.stringify([{ name: "ws-10" }]));

      const exists = await service.workspaceExists("ws-1");

      expect(exists).toBe(false);
    });

    it("returns false on CLI error", async () => {
      mockExecError(new Error("not logged in"));

      const exists = await service.workspaceExists("ws-1");

      expect(exists).toBe(false);
    });
  });

  describe("getWorkspaceStatus", () => {
    it("returns status for exact match (search is prefix-based)", async () => {
      mockLatticeCommandResult({
        exitCode: 0,
        stdout: JSON.stringify([
          { name: "ws-1", latest_build: { status: "running" } },
          { name: "ws-10", latest_build: { status: "stopped" } },
        ]),
      });

      const result = await service.getWorkspaceStatus("ws-1");

      expect(result.kind).toBe("ok");
      if (result.kind === "ok") {
        expect(result.status).toBe("running");
      }
    });

    it("returns not_found when only prefix matches", async () => {
      mockLatticeCommandResult({
        exitCode: 0,
        stdout: JSON.stringify([{ name: "ws-10", latest_build: { status: "running" } }]),
      });

      const result = await service.getWorkspaceStatus("ws-1");

      expect(result.kind).toBe("not_found");
    });

    it("returns error for unknown workspace status", async () => {
      mockLatticeCommandResult({
        exitCode: 0,
        stdout: JSON.stringify([{ name: "ws-1", latest_build: { status: "weird" } }]),
      });

      const result = await service.getWorkspaceStatus("ws-1");

      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.error).toContain("Unknown status");
      }
    });
  });

  describe("waitForStartupScripts", () => {
    // waitForStartupScripts now polls getWorkspaceStatus via runLatticeCommand (spawn)
    // getWorkspaceStatus calls: spawn("lattice", ["list", "--search", "name:...", "-o", "json"], ...)

    function mockSpawnForStatus(statusJson: string, exitCode = 0) {
      const stdout = Readable.from([Buffer.from(statusJson)]);
      const stderr = Readable.from([]);
      const events = new EventEmitter();

      spawnSpy!.mockReturnValue({
        stdout,
        stderr,
        kill: vi.fn(),
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
      } as never);

      // Emit close after handlers are attached
      setTimeout(() => events.emit("close", exitCode), 0);
    }

    it("yields ready message when agent is running", async () => {
      mockSpawnForStatus(JSON.stringify([{ name: "my-ws", latest_build: { status: "running" } }]));

      const lines: string[] = [];
      for await (const line of service.waitForStartupScripts("my-ws")) {
        lines.push(line);
      }

      expect(lines[0]).toContain("Waiting for agent");
      expect(lines).toContain('Agent "my-ws" is running and ready.');
    });

    it("throws when workspace is not found", async () => {
      // Return empty array → workspace not found
      mockSpawnForStatus(JSON.stringify([]));

      let thrown: unknown;
      try {
        for await (const _line of service.waitForStartupScripts("my-ws")) {
          // drain
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeTruthy();
      expect(thrown instanceof Error ? thrown.message : "").toContain("not found");
    });
  });

  describe("createWorkspace", () => {
    // Capture original fetch once per describe block to avoid nested mock issues
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // Helper to mock the pre-fetch calls that happen before spawn
    function mockPrefetchCalls(options?: { presetParamNames?: string[] }) {
      // Mock getDeploymentUrl (lattice whoami)
      // Mock getActiveTemplateVersionId (lattice templates list -o json)
      // Mock getTemplateRichParameters (lattice tokens create + fetch)
      execAsyncSpy?.mockImplementation((cmd: string) => {
        if (cmd === "lattice whoami") {
          return createMockExecResult(
            Promise.resolve({
              stdout:
                "Lattice is running at https://lattice.example.com, You're authenticated as admin !",
              stderr: "",
            })
          );
        }
        if (cmd === "lattice templates list -o json") {
          return createMockExecResult(
            Promise.resolve({
              stdout: JSON.stringify([
                {
                  Template: {
                    name: "my-template",
                    organization_name: "default",
                    active_version_id: "version-123",
                  },
                },
                {
                  Template: {
                    name: "tmpl",
                    organization_name: "default",
                    active_version_id: "version-456",
                  },
                },
              ]),
              stderr: "",
            })
          );
        }
        if (cmd.startsWith("lattice tokens create --lifetime 5m --name")) {
          return createMockExecResult(Promise.resolve({ stdout: "fake-token-123", stderr: "" }));
        }
        if (cmd.startsWith("lattice tokens remove")) {
          return createMockExecResult(Promise.resolve({ stdout: "", stderr: "" }));
        }
        // Fallback for any other command
        return createMockExecResult(Promise.reject(new Error(`Unexpected command: ${cmd}`)));
      });
    }

    // Helper to mock fetch for rich parameters API
    function mockFetchRichParams(
      params: Array<{
        name: string;
        default_value: string;
        ephemeral?: boolean;
        required?: boolean;
      }>
    ) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(params),
      }) as unknown as typeof fetch;
    }

    it("streams stdout/stderr lines and passes expected args", async () => {
      mockPrefetchCalls();
      mockFetchRichParams([]);

      const stdout = Readable.from([Buffer.from("out-1\nout-2\n")]);
      const stderr = Readable.from([Buffer.from("err-1\n")]);
      const events = new EventEmitter();

      spawnSpy!.mockReturnValue({
        stdout,
        stderr,
        kill: vi.fn(),
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
      } as never);

      // Emit close after handlers are attached.
      setTimeout(() => events.emit("close", 0), 0);

      const lines: string[] = [];
      for await (const line of service.createWorkspace("my-workspace", "my-template")) {
        lines.push(line);
      }

      expect(spawnSpy).toHaveBeenCalledWith(
        "lattice",
        ["create", "my-workspace", "-t", "my-template", "-y"],
        { stdio: ["ignore", "pipe", "pipe"] }
      );

      // Lines include parameter fetch message, the command, and stdout/stderr
      expect(lines).toContain("$ lattice create my-workspace -t my-template -y");
      expect(lines).toContain("out-1");
      expect(lines).toContain("out-2");
      expect(lines).toContain("err-1");
    });

    it("preset is logged but does not appear in CLI args (API-only feature)", async () => {
      mockPrefetchCalls();
      mockFetchRichParams([{ name: "some-param", default_value: "val" }]);

      const stdout = Readable.from([]);
      const stderr = Readable.from([]);
      const events = new EventEmitter();

      spawnSpy!.mockReturnValue({
        stdout,
        stderr,
        kill: vi.fn(),
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
      } as never);

      setTimeout(() => events.emit("close", 0), 0);

      for await (const _line of service.createWorkspace("ws", "tmpl", "preset")) {
        // drain
      }

      // Verify -y is used (not --yes) and --preset is NOT passed
      const callArgs = spawnSpy!.mock.calls[0]?.[1] as string[];
      expect(callArgs).toContain("-y");
      expect(callArgs).not.toContain("--preset");
      expect(callArgs).not.toContain("preset");
    });

    it("includes --parameter flags for non-ephemeral params with defaults", async () => {
      mockPrefetchCalls();
      mockFetchRichParams([
        { name: "param-with-default", default_value: "val1" },
        { name: "ephemeral-param", default_value: "val2", ephemeral: true },
        { name: "no-default-param", default_value: "" },
      ]);

      const stdout = Readable.from([]);
      const stderr = Readable.from([]);
      const events = new EventEmitter();

      spawnSpy!.mockReturnValue({
        stdout,
        stderr,
        kill: vi.fn(),
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
      } as never);

      setTimeout(() => events.emit("close", 0), 0);

      for await (const _line of service.createWorkspace("ws", "tmpl")) {
        // drain
      }

      const callArgs = spawnSpy!.mock.calls[0]?.[1] as string[];
      // Non-ephemeral param with default should appear
      expect(callArgs).toContain("--parameter");
      const paramIndex = callArgs.indexOf("--parameter");
      expect(callArgs[paramIndex + 1]).toContain("param-with-default=val1");
      // Ephemeral param should NOT appear
      expect(callArgs.join(" ")).not.toContain("ephemeral-param");
    });

    it("throws when exit code is non-zero", async () => {
      mockPrefetchCalls();
      mockFetchRichParams([]);

      const stdout = Readable.from([]);
      const stderr = Readable.from([]);
      const events = new EventEmitter();

      spawnSpy!.mockReturnValue({
        stdout,
        stderr,
        kill: vi.fn(),
        on: events.on.bind(events),
        removeListener: events.removeListener.bind(events),
      } as never);

      setTimeout(() => events.emit("close", 42), 0);

      let thrown: unknown;
      try {
        for await (const _line of service.createWorkspace("ws", "tmpl")) {
          // drain
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeTruthy();
      expect(thrown instanceof Error ? thrown.message : String(thrown)).toContain(
        "lattice create failed (exit 42)"
      );
    });

    it("aborts before spawn when already aborted", async () => {
      const abortController = new AbortController();
      abortController.abort();

      let thrown: unknown;
      try {
        for await (const _line of service.createWorkspace(
          "ws",
          "tmpl",
          undefined,
          abortController.signal
        )) {
          // drain
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeTruthy();
      expect(thrown instanceof Error ? thrown.message : String(thrown)).toContain("aborted");
    });
  });
});

describe("computeExtraParams", () => {
  let service: LatticeService;

  beforeEach(() => {
    service = new LatticeService();
  });

  it("returns empty array when all params are covered by preset", () => {
    const params = [
      { name: "param1", defaultValue: "val1", type: "string", ephemeral: false, required: false },
      { name: "param2", defaultValue: "val2", type: "string", ephemeral: false, required: false },
    ];
    const covered = new Set(["param1", "param2"]);

    expect(service.computeExtraParams(params, covered)).toEqual([]);
  });

  it("returns uncovered non-ephemeral params with defaults", () => {
    const params = [
      { name: "covered", defaultValue: "val1", type: "string", ephemeral: false, required: false },
      {
        name: "uncovered",
        defaultValue: "val2",
        type: "string",
        ephemeral: false,
        required: false,
      },
    ];
    const covered = new Set(["covered"]);

    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "uncovered", encoded: "uncovered=val2" },
    ]);
  });

  it("excludes ephemeral params", () => {
    const params = [
      { name: "normal", defaultValue: "val1", type: "string", ephemeral: false, required: false },
      { name: "ephemeral", defaultValue: "val2", type: "string", ephemeral: true, required: false },
    ];
    const covered = new Set<string>();

    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "normal", encoded: "normal=val1" },
    ]);
  });

  it("includes params with empty default values", () => {
    const params = [
      {
        name: "empty-default",
        defaultValue: "",
        type: "string",
        ephemeral: false,
        required: false,
      },
    ];
    const covered = new Set<string>();

    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "empty-default", encoded: "empty-default=" },
    ]);
  });

  it("CSV-encodes list(string) values containing quotes", () => {
    const params = [
      {
        name: "Select IDEs",
        defaultValue: '["vscode","code-server","cursor"]',
        type: "list(string)",
        ephemeral: false,
        required: false,
      },
    ];
    const covered = new Set<string>();

    // CLI uses CSV parsing, so quotes need escaping: " -> ""
    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "Select IDEs", encoded: '"Select IDEs=[""vscode"",""code-server"",""cursor""]"' },
    ]);
  });

  it("passes empty list(string) array without CSV encoding", () => {
    const params = [
      {
        name: "empty-list",
        defaultValue: "[]",
        type: "list(string)",
        ephemeral: false,
        required: false,
      },
    ];
    const covered = new Set<string>();

    // No quotes or commas, so no encoding needed
    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "empty-list", encoded: "empty-list=[]" },
    ]);
  });
});

describe("validateRequiredParams", () => {
  let service: LatticeService;

  beforeEach(() => {
    service = new LatticeService();
  });

  it("does not throw when all required params have defaults", () => {
    const params = [
      {
        name: "required-with-default",
        defaultValue: "val",
        type: "string",
        ephemeral: false,
        required: true,
      },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).not.toThrow();
  });

  it("does not throw when required params are covered by preset", () => {
    const params = [
      {
        name: "required-no-default",
        defaultValue: "",
        type: "string",
        ephemeral: false,
        required: true,
      },
    ];
    const covered = new Set(["required-no-default"]);

    expect(() => service.validateRequiredParams(params, covered)).not.toThrow();
  });

  it("throws when required param has no default and is not covered", () => {
    const params = [
      { name: "missing-param", defaultValue: "", type: "string", ephemeral: false, required: true },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).toThrow("missing-param");
  });

  it("ignores ephemeral required params", () => {
    const params = [
      {
        name: "ephemeral-required",
        defaultValue: "",
        type: "string",
        ephemeral: true,
        required: true,
      },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).not.toThrow();
  });

  it("lists all missing required params in error", () => {
    const params = [
      { name: "missing1", defaultValue: "", type: "string", ephemeral: false, required: true },
      { name: "missing2", defaultValue: "", type: "string", ephemeral: false, required: true },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).toThrow(
      /missing1.*missing2|missing2.*missing1/
    );
  });
});

describe("non-string parameter defaults", () => {
  let service: LatticeService;

  beforeEach(() => {
    service = new LatticeService();
  });

  it("validateRequiredParams passes when required param has numeric default 0", () => {
    // After parseRichParameters, numeric 0 becomes "0" (not "")
    const params = [
      { name: "count", defaultValue: "0", type: "number", ephemeral: false, required: true },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).not.toThrow();
  });

  it("validateRequiredParams passes when required param has boolean default false", () => {
    // After parseRichParameters, boolean false becomes "false" (not "")
    const params = [
      { name: "enabled", defaultValue: "false", type: "bool", ephemeral: false, required: true },
    ];
    const covered = new Set<string>();

    expect(() => service.validateRequiredParams(params, covered)).not.toThrow();
  });

  it("computeExtraParams emits numeric default correctly", () => {
    const params = [
      { name: "count", defaultValue: "42", type: "number", ephemeral: false, required: false },
    ];
    const covered = new Set<string>();

    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "count", encoded: "count=42" },
    ]);
  });

  it("computeExtraParams emits boolean default correctly", () => {
    const params = [
      { name: "enabled", defaultValue: "true", type: "bool", ephemeral: false, required: false },
    ];
    const covered = new Set<string>();

    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "enabled", encoded: "enabled=true" },
    ]);
  });

  it("computeExtraParams emits array default as JSON with CSV encoding", () => {
    // After parseRichParameters, array becomes JSON string
    const params = [
      {
        name: "tags",
        defaultValue: '["a","b"]',
        type: "list(string)",
        ephemeral: false,
        required: false,
      },
    ];
    const covered = new Set<string>();

    // JSON array with quotes gets CSV-encoded (quotes escaped as "")
    expect(service.computeExtraParams(params, covered)).toEqual([
      { name: "tags", encoded: '"tags=[""a"",""b""]"' },
    ]);
  });
});

describe("deleteWorkspace", () => {
  const service = new LatticeService();
  let mockExec: ReturnType<typeof spyOn<typeof disposableExec, "execAsync">> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = spyOn(disposableExec, "execAsync");
  });

  afterEach(() => {
    mockExec?.mockRestore();
    mockExec = null;
  });

  it("refuses to delete workspace without lattice- prefix", async () => {
    await service.deleteWorkspace("my-workspace");

    // Should not call execAsync at all
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("deletes workspace with lattice- prefix", async () => {
    mockExec?.mockReturnValue(createMockExecResult(Promise.resolve({ stdout: "", stderr: "" })));

    await service.deleteWorkspace("lattice-my-workspace");

    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("lattice delete"));
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("lattice-my-workspace"));
  });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("2.28.6", "2.28.6")).toBe(0);
  });

  it("returns 0 for equal versions with different formats", () => {
    expect(compareVersions("v2.28.6", "2.28.6")).toBe(0);
    expect(compareVersions("v2.28.6+hash", "2.28.6")).toBe(0);
  });

  it("returns negative when first version is older", () => {
    expect(compareVersions("2.25.0", "2.28.6")).toBeLessThan(0);
    expect(compareVersions("2.28.5", "2.28.6")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("returns positive when first version is newer", () => {
    expect(compareVersions("2.28.6", "2.25.0")).toBeGreaterThan(0);
    expect(compareVersions("2.28.6", "2.28.5")).toBeGreaterThan(0);
    expect(compareVersions("3.0.0", "2.28.6")).toBeGreaterThan(0);
  });

  it("handles versions with v prefix", () => {
    expect(compareVersions("v2.28.6", "2.25.0")).toBeGreaterThan(0);
    expect(compareVersions("v2.25.0", "v2.28.6")).toBeLessThan(0);
  });

  it("handles dev versions correctly", () => {
    // v2.28.2-devel+903c045b9 should be compared as 2.28.2
    expect(compareVersions("v2.28.2-devel+903c045b9", "2.25.0")).toBeGreaterThan(0);
    expect(compareVersions("v2.28.2-devel+903c045b9", "2.28.2")).toBe(0);
  });

  it("handles missing patch version", () => {
    expect(compareVersions("2.28", "2.28.0")).toBe(0);
    expect(compareVersions("2.28", "2.28.1")).toBeLessThan(0);
  });
});
