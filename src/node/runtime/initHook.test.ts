import { describe, it, expect } from "bun:test";
import { LineBuffer, createLineBufferedLoggers, getLatticeEnv } from "./initHook";
import type { InitLogger } from "./Runtime";

describe("LineBuffer", () => {
  it("should buffer incomplete lines", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((line) => lines.push(line));

    buffer.append("hello ");
    expect(lines).toEqual([]);

    buffer.append("world\n");
    expect(lines).toEqual(["hello world"]);
  });

  it("should handle multiple lines in one chunk", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((line) => lines.push(line));

    buffer.append("line1\nline2\nline3\n");
    expect(lines).toEqual(["line1", "line2", "line3"]);
  });

  it("should handle incomplete line at end", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((line) => lines.push(line));

    buffer.append("line1\nline2\nincomplete");
    expect(lines).toEqual(["line1", "line2"]);

    buffer.flush();
    expect(lines).toEqual(["line1", "line2", "incomplete"]);
  });

  it("should skip empty lines", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((line) => lines.push(line));

    buffer.append("\nline1\n\nline2\n\n");
    expect(lines).toEqual(["line1", "line2"]);
  });

  it("should handle flush with no buffered data", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((line) => lines.push(line));

    buffer.append("line1\n");
    expect(lines).toEqual(["line1"]);

    buffer.flush();
    expect(lines).toEqual(["line1"]); // No change
  });
});

// getLatticeEnv tests are placed here because initHook.ts owns the implementation.
describe("createLineBufferedLoggers", () => {
  it("should create separate buffers for stdout and stderr", () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const mockLogger: InitLogger = {
      logStep: () => {
        /* no-op for test */
      },
      logStdout: (line) => stdoutLines.push(line),
      logStderr: (line) => stderrLines.push(line),
      logComplete: () => {
        /* no-op for test */
      },
    };

    const loggers = createLineBufferedLoggers(mockLogger);

    loggers.stdout.append("out1\nout2\n");
    loggers.stderr.append("err1\nerr2\n");

    expect(stdoutLines).toEqual(["out1", "out2"]);
    expect(stderrLines).toEqual(["err1", "err2"]);
  });

  it("should handle incomplete lines and flush separately", () => {
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const mockLogger: InitLogger = {
      logStep: () => {
        /* no-op for test */
      },
      logStdout: (line) => stdoutLines.push(line),
      logStderr: (line) => stderrLines.push(line),
      logComplete: () => {
        /* no-op for test */
      },
    };

    const loggers = createLineBufferedLoggers(mockLogger);

    loggers.stdout.append("incomplete");
    loggers.stderr.append("also incomplete");

    expect(stdoutLines).toEqual([]);
    expect(stderrLines).toEqual([]);

    loggers.stdout.flush();
    expect(stdoutLines).toEqual(["incomplete"]);
    expect(stderrLines).toEqual([]); // stderr not flushed yet

    loggers.stderr.flush();
    expect(stderrLines).toEqual(["also incomplete"]);
  });
});

describe("getLatticeEnv", () => {
  it("should include base LATTICE_ environment variables", () => {
    const env = getLatticeEnv("/path/to/project", "worktree", "feature-branch");

    expect(env.LATTICE_PROJECT_PATH).toBe("/path/to/project");
    expect(env.LATTICE_RUNTIME).toBe("worktree");
    expect(env.LATTICE_WORKSPACE_NAME).toBe("feature-branch");
    expect(env.LATTICE_MODEL_STRING).toBeUndefined();
    expect(env.LATTICE_THINKING_LEVEL).toBeUndefined();
    expect(env.LATTICE_COSTS_USD).toBeUndefined();
  });

  it("should include model + thinking env vars when provided", () => {
    const env = getLatticeEnv("/path/to/project", "worktree", "feature-branch", {
      modelString: "openai:gpt-5.2-pro",
      thinkingLevel: "medium",
    });

    expect(env.LATTICE_MODEL_STRING).toBe("openai:gpt-5.2-pro");
    expect(env.LATTICE_THINKING_LEVEL).toBe("medium");
  });

  it("should allow explicit thinkingLevel=off", () => {
    const env = getLatticeEnv("/path/to/project", "local", "main", {
      modelString: "anthropic:claude-3-5-sonnet",
      thinkingLevel: "off",
    });

    expect(env.LATTICE_MODEL_STRING).toBe("anthropic:claude-3-5-sonnet");
    expect(env.LATTICE_THINKING_LEVEL).toBe("off");
  });

  it("should include LATTICE_COSTS_USD when costsUsd is provided", () => {
    const env = getLatticeEnv("/path/to/project", "worktree", "feature-branch", {
      modelString: "anthropic:claude-opus-4-5",
      thinkingLevel: "high",
      costsUsd: 1.2345,
    });

    expect(env.LATTICE_COSTS_USD).toBe("1.23");
  });

  it("should include LATTICE_COSTS_USD=0.00 when costsUsd is 0", () => {
    const env = getLatticeEnv("/path/to/project", "worktree", "main", {
      costsUsd: 0,
    });

    expect(env.LATTICE_COSTS_USD).toBe("0.00");
  });

  it("should not include LATTICE_COSTS_USD when costsUsd is undefined", () => {
    const env = getLatticeEnv("/path/to/project", "worktree", "main", {
      modelString: "openai:gpt-4",
    });

    expect(env.LATTICE_COSTS_USD).toBeUndefined();
  });
});
