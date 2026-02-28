import { describe, expect, test, mock, afterEach, spyOn } from "bun:test";
import { EventEmitter } from "events";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

import { AgentSession } from "./agentSession";
import type { Config } from "@/node/config";
import type { AIService } from "./aiService";
import type { InitStateManager } from "./initStateManager";
import type { BackgroundProcessManager } from "./backgroundProcessManager";

import type { LatticeMessage } from "@/common/types/message";
import type { SendMessageOptions } from "@/common/orpc/types";
import { createTestHistoryService } from "./testHistoryService";

function createPersistedPostCompactionState(options: {
  filePath: string;
  diffs: Array<{ path: string; diff: string; truncated: boolean }>;
}): Promise<void> {
  const payload = {
    version: 1 as const,
    createdAt: Date.now(),
    diffs: options.diffs,
  };

  return fsPromises.writeFile(options.filePath, JSON.stringify(payload));
}

describe("AgentSession post-compaction context retry", () => {
  let historyCleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await historyCleanup?.();
  });

  test("retries once without post-compaction injection on context_exceeded", async () => {
    const minionId = "ws";
    const sessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-agentSession-"));
    const postCompactionPath = path.join(sessionDir, "post-compaction.json");

    await createPersistedPostCompactionState({
      filePath: postCompactionPath,
      diffs: [
        {
          path: "/tmp/foo.ts",
          diff: "@@ -1 +1 @@\n-foo\n+bar\n",
          truncated: false,
        },
      ],
    });

    const history: LatticeMessage[] = [
      {
        id: "compaction-summary",
        role: "assistant",
        parts: [{ type: "text", text: "Summary" }],
        metadata: { timestamp: 1000, compacted: "user" },
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Continue" }],
        metadata: { timestamp: 1100 },
      },
    ];

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;
    for (const msg of history) {
      await historyService.appendToHistory(minionId, msg);
    }
    spyOn(historyService, "deleteMessage");

    const aiEmitter = new EventEmitter();

    let resolveSecondCall: (() => void) | undefined;
    const secondCall = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });

    let callCount = 0;
    const streamMessage = mock((..._args: unknown[]) => {
      callCount += 1;

      if (callCount === 1) {
        // Simulate a provider context limit error before any deltas.
        aiEmitter.emit("error", {
          minionId,
          messageId: "assistant-ctx-exceeded",
          error: "Context length exceeded",
          errorType: "context_exceeded",
        });

        return Promise.resolve({ success: true as const, data: undefined });
      }

      resolveSecondCall?.();
      return Promise.resolve({ success: true as const, data: undefined });
    });

    const aiService: AIService = {
      on(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.on(String(eventName), listener);
        return this;
      },
      off(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.off(String(eventName), listener);
        return this;
      },
      streamMessage,
      getMinionMetadata: mock(() => Promise.resolve({ success: false as const, error: "nope" })),
      stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
    } as unknown as AIService;

    const initStateManager: InitStateManager = {
      on() {
        return this;
      },
      off() {
        return this;
      },
    } as unknown as InitStateManager;

    const backgroundProcessManager: BackgroundProcessManager = {
      setMessageQueued: mock(() => undefined),
      cleanup: mock(() => Promise.resolve()),
    } as unknown as BackgroundProcessManager;

    const config: Config = {
      srcDir: "/tmp",
      getSessionDir: mock(() => sessionDir),
    } as unknown as Config;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const options: SendMessageOptions = {
      model: "openai:gpt-4o",
      agentId: "exec",
    } as unknown as SendMessageOptions;

    // Call streamWithHistory directly (private) to avoid needing a full user send pipeline.
    await (
      session as unknown as {
        streamWithHistory: (m: string, o: SendMessageOptions) => Promise<unknown>;
      }
    ).streamWithHistory(options.model, options);

    // Wait for the retry call to happen.
    await Promise.race([
      secondCall,
      new Promise((_, reject) => setTimeout(() => reject(new Error("retry timeout")), 1000)),
    ]);

    expect(streamMessage).toHaveBeenCalledTimes(2);

    // With the options bag, arg[0] is the StreamMessageOptions object.
    const firstOpts = (streamMessage as ReturnType<typeof mock>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(Array.isArray(firstOpts.postCompactionAttachments)).toBe(true);

    const secondOpts = (streamMessage as ReturnType<typeof mock>).mock.calls[1][0] as Record<
      string,
      unknown
    >;
    expect(secondOpts.postCompactionAttachments).toBeNull();

    expect((historyService.deleteMessage as ReturnType<typeof mock>).mock.calls[0][1]).toBe(
      "assistant-ctx-exceeded"
    );

    // Pending post-compaction state should be discarded.
    let exists = true;
    try {
      await fsPromises.stat(postCompactionPath);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);

    session.dispose();
  });
});

describe("AgentSession execSidekickHardRestart", () => {
  let historyCleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await historyCleanup?.();
  });

  test("hard-restarts exec-like sidekick history on context_exceeded and retries once", async () => {
    const minionId = "ws-hard";
    const sessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-agentSession-"));

    const history: LatticeMessage[] = [
      {
        id: "snapshot-1",
        role: "user",
        parts: [{ type: "text", text: "<snapshot>" }],
        metadata: {
          timestamp: 1000,
          synthetic: true,
          fileAtMentionSnapshot: ["@foo"],
        },
      },
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Do the thing" }],
        metadata: {
          timestamp: 1100,
        },
      },
    ];

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;
    for (const msg of history) {
      await historyService.appendToHistory(minionId, msg);
    }
    spyOn(historyService, "clearHistory");
    spyOn(historyService, "appendToHistory");

    const aiEmitter = new EventEmitter();

    let resolveSecondCall: (() => void) | undefined;
    const secondCall = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });

    let callCount = 0;
    const streamMessage = mock((..._args: unknown[]) => {
      callCount += 1;

      if (callCount === 1) {
        aiEmitter.emit("error", {
          minionId,
          messageId: "assistant-ctx-exceeded-1",
          error: "Context length exceeded",
          errorType: "context_exceeded",
        });
        return Promise.resolve({ success: true as const, data: undefined });
      }

      if (callCount === 2) {
        // Second context_exceeded should NOT trigger an additional hard restart.
        aiEmitter.emit("error", {
          minionId,
          messageId: "assistant-ctx-exceeded-2",
          error: "Context length exceeded",
          errorType: "context_exceeded",
        });
        resolveSecondCall?.();
        return Promise.resolve({ success: true as const, data: undefined });
      }

      throw new Error("unexpected third streamMessage call");
    });

    const parentMinionId = "parent";

    const childMinionMetadata = {
      id: minionId,
      name: "child",
      projectName: "proj",
      projectPath: "/tmp/proj",
      namedMinionPath: "/tmp/proj/child",
      runtimeConfig: { type: "local" },
      parentMinionId,
      agentId: "exec",
    };

    const parentMinionMetadata = {
      ...childMinionMetadata,
      id: parentMinionId,
      name: "parent",
      parentMinionId: undefined,
    };

    const getMinionMetadata = mock((id: string) => {
      if (id === minionId) {
        return Promise.resolve({
          success: true as const,
          data: childMinionMetadata as never,
        });
      }

      if (id === parentMinionId) {
        return Promise.resolve({
          success: true as const,
          data: parentMinionMetadata as never,
        });
      }

      return Promise.resolve({ success: false as const, error: "unknown" });
    });

    const aiService: AIService = {
      on(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.on(String(eventName), listener);
        return this;
      },
      off(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.off(String(eventName), listener);
        return this;
      },
      streamMessage,
      getMinionMetadata,
      stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
    } as unknown as AIService;

    const initStateManager: InitStateManager = {
      on() {
        return this;
      },
      off() {
        return this;
      },
    } as unknown as InitStateManager;

    const backgroundProcessManager: BackgroundProcessManager = {
      setMessageQueued: mock(() => undefined),
      cleanup: mock(() => Promise.resolve()),
    } as unknown as BackgroundProcessManager;

    const config: Config = {
      srcDir: "/tmp",
      getSessionDir: mock(() => sessionDir),
    } as unknown as Config;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const options: SendMessageOptions = {
      model: "openai:gpt-4o",
      agentId: "exec",
      experiments: {
        execSidekickHardRestart: true,
      },
    } as unknown as SendMessageOptions;

    await (
      session as unknown as {
        streamWithHistory: (m: string, o: SendMessageOptions) => Promise<unknown>;
      }
    ).streamWithHistory(options.model, options);

    await Promise.race([
      secondCall,
      new Promise((_, reject) => setTimeout(() => reject(new Error("retry timeout")), 1000)),
    ]);

    expect(streamMessage).toHaveBeenCalledTimes(2);
    expect((historyService.clearHistory as ReturnType<typeof mock>).mock.calls).toHaveLength(1);

    // Continuation notice + seed prompt (and snapshots) should be appended after clear.
    expect((historyService.appendToHistory as ReturnType<typeof mock>).mock.calls).toHaveLength(3);

    const appendedNotice = (historyService.appendToHistory as ReturnType<typeof mock>).mock
      .calls[0][1] as LatticeMessage | undefined;
    expect(appendedNotice?.metadata?.synthetic).toBe(true);
    expect(appendedNotice?.metadata?.uiVisible).toBe(true);
    const noticeText = appendedNotice?.parts.find((p) => p.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    expect(noticeText?.text).toContain("restarted");

    expect(
      ((historyService.appendToHistory as ReturnType<typeof mock>).mock.calls[1][1] as LatticeMessage)
        .id
    ).toBe("snapshot-1");
    expect(
      ((historyService.appendToHistory as ReturnType<typeof mock>).mock.calls[2][1] as LatticeMessage)
        .id
    ).toBe("user-1");

    // Retry should include the continuation notice in additionalSystemInstructions.
    const retryOpts = (streamMessage as ReturnType<typeof mock>).mock.calls[1][0] as Record<
      string,
      unknown
    >;
    expect(String(retryOpts.additionalSystemInstructions)).toContain("restarted");

    session.dispose();
  });

  test("resolves exec-like predicate from parent minion when child agents are missing", async () => {
    const minionId = "ws-hard-custom-agent";
    const sessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-agentSession-"));

    const history: LatticeMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Do the thing" }],
        metadata: {
          timestamp: 1100,
        },
      },
    ];

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;
    for (const msg of history) {
      await historyService.appendToHistory(minionId, msg);
    }
    spyOn(historyService, "clearHistory");
    spyOn(historyService, "appendToHistory");

    const aiEmitter = new EventEmitter();

    let resolveSecondCall: (() => void) | undefined;
    const secondCall = new Promise<void>((resolve) => {
      resolveSecondCall = resolve;
    });

    let callCount = 0;
    const streamMessage = mock((..._args: unknown[]) => {
      callCount += 1;

      if (callCount === 1) {
        // Simulate a provider context limit error before any deltas.
        aiEmitter.emit("error", {
          minionId,
          messageId: "assistant-ctx-exceeded-1",
          error: "Context length exceeded",
          errorType: "context_exceeded",
        });

        return Promise.resolve({ success: true as const, data: undefined });
      }

      resolveSecondCall?.();
      return Promise.resolve({ success: true as const, data: undefined });
    });

    const customAgentId = "custom_hard_restart_agent";

    const srcBaseDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), "lattice-agentSession-worktrees-")
    );
    const projectPath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-agentSession-proj-"));

    // Create a custom agent definition ONLY in the parent minion path.
    // This simulates untracked .lattice/agents that are present in the parent worktree but absent
    // from the child task worktree.
    const parentMinionName = "parent";
    const parentAgentsDir = path.join(
      srcBaseDir,
      path.basename(projectPath),
      parentMinionName,
      ".lattice",
      "agents"
    );
    await fsPromises.mkdir(parentAgentsDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(parentAgentsDir, `${customAgentId}.md`),
      [
        "---",
        "name: Custom Hard Restart Agent",
        "description: Test agent inheriting exec",
        "base: exec",
        "---",
        "",
        "Body",
        "",
      ].join("\n")
    );

    const parentMinionId = "parent-custom";

    const childMinionMetadata = {
      id: minionId,
      name: "child",
      projectName: "proj",
      projectPath,
      runtimeConfig: { type: "worktree", srcBaseDir },
      parentMinionId,
      agentId: customAgentId,
    };

    const parentMinionMetadata = {
      ...childMinionMetadata,
      id: parentMinionId,
      name: parentMinionName,
      parentMinionId: undefined,
      agentId: "exec",
    };

    const getMinionMetadata = mock((id: string) => {
      if (id === minionId) {
        return Promise.resolve({
          success: true as const,
          data: childMinionMetadata as never,
        });
      }

      if (id === parentMinionId) {
        return Promise.resolve({
          success: true as const,
          data: parentMinionMetadata as never,
        });
      }

      return Promise.resolve({ success: false as const, error: "unknown" });
    });

    const aiService: AIService = {
      on(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.on(String(eventName), listener);
        return this;
      },
      off(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.off(String(eventName), listener);
        return this;
      },
      streamMessage,
      getMinionMetadata,
      stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
    } as unknown as AIService;

    const initStateManager: InitStateManager = {
      on() {
        return this;
      },
      off() {
        return this;
      },
    } as unknown as InitStateManager;

    const backgroundProcessManager: BackgroundProcessManager = {
      setMessageQueued: mock(() => undefined),
      cleanup: mock(() => Promise.resolve()),
    } as unknown as BackgroundProcessManager;

    const config: Config = {
      srcDir: "/tmp",
      getSessionDir: mock(() => sessionDir),
    } as unknown as Config;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const options: SendMessageOptions = {
      model: "openai:gpt-4o",
      agentId: customAgentId,
      experiments: {
        execSidekickHardRestart: true,
      },
    } as unknown as SendMessageOptions;

    await (
      session as unknown as {
        streamWithHistory: (m: string, o: SendMessageOptions) => Promise<unknown>;
      }
    ).streamWithHistory(options.model, options);

    await Promise.race([
      secondCall,
      new Promise((_, reject) => setTimeout(() => reject(new Error("retry timeout")), 1000)),
    ]);

    expect(streamMessage).toHaveBeenCalledTimes(2);
    expect((historyService.clearHistory as ReturnType<typeof mock>).mock.calls).toHaveLength(1);

    session.dispose();
  });

  test("does not hard-restart when minion is not a sidekick", async () => {
    const minionId = "ws-hard-no-parent";
    const sessionDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "lattice-agentSession-"));

    const history: LatticeMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Do the thing" }],
        metadata: { timestamp: 1100 },
      },
    ];

    const { historyService, cleanup } = await createTestHistoryService();
    historyCleanup = cleanup;
    for (const msg of history) {
      await historyService.appendToHistory(minionId, msg);
    }
    spyOn(historyService, "clearHistory");

    const aiEmitter = new EventEmitter();

    const streamMessage = mock((..._args: unknown[]) => {
      aiEmitter.emit("error", {
        minionId,
        messageId: "assistant-ctx-exceeded",
        error: "Context length exceeded",
        errorType: "context_exceeded",
      });
      return Promise.resolve({ success: true as const, data: undefined });
    });

    const minionMetadata = {
      id: minionId,
      name: "child",
      projectName: "proj",
      projectPath: "/tmp/proj",
      namedMinionPath: "/tmp/proj/child",
      runtimeConfig: { type: "local" },
      agentId: "exec",
    };

    const aiService: AIService = {
      on(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.on(String(eventName), listener);
        return this;
      },
      off(eventName: string | symbol, listener: (...args: unknown[]) => void) {
        aiEmitter.off(String(eventName), listener);
        return this;
      },
      streamMessage,
      getMinionMetadata: mock(() =>
        Promise.resolve({ success: true as const, data: minionMetadata as never })
      ),
      stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
    } as unknown as AIService;

    const initStateManager: InitStateManager = {
      on() {
        return this;
      },
      off() {
        return this;
      },
    } as unknown as InitStateManager;

    const backgroundProcessManager: BackgroundProcessManager = {
      setMessageQueued: mock(() => undefined),
      cleanup: mock(() => Promise.resolve()),
    } as unknown as BackgroundProcessManager;

    const config: Config = {
      srcDir: "/tmp",
      getSessionDir: mock(() => sessionDir),
    } as unknown as Config;

    const session = new AgentSession({
      minionId,
      config,
      historyService,
      aiService,
      initStateManager,
      backgroundProcessManager,
    });

    const options: SendMessageOptions = {
      model: "openai:gpt-4o",
      agentId: "exec",
      experiments: {
        execSidekickHardRestart: true,
      },
    } as unknown as SendMessageOptions;

    await (
      session as unknown as {
        streamWithHistory: (m: string, o: SendMessageOptions) => Promise<unknown>;
      }
    ).streamWithHistory(options.model, options);

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(streamMessage).toHaveBeenCalledTimes(1);
    expect((historyService.clearHistory as ReturnType<typeof mock>).mock.calls).toHaveLength(0);

    session.dispose();
  });
});
