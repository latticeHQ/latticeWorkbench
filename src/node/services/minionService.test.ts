import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { MinionService, generateForkBranchName, generateForkTitle } from "./minionService";
import type { AgentSession } from "./agentSession";
import { MinionLifecycleHooks } from "./minionLifecycleHooks";
import { EventEmitter } from "events";
import * as fsPromises from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Err, Ok, type Result } from "@/common/types/result";
import type { ProjectsConfig } from "@/common/types/project";
import type { Config } from "@/node/config";
import type { HistoryService } from "./historyService";
import { createTestHistoryService } from "./testHistoryService";
import type { SessionTimingService } from "./sessionTimingService";
import type { AIService } from "./aiService";
import type { InitStateManager, InitStatus } from "./initStateManager";
import type { ExtensionMetadataService } from "./ExtensionMetadataService";
import type { FrontendMinionMetadata, MinionMetadata } from "@/common/types/minion";
import type { TaskService } from "./taskService";
import type { BackgroundProcessManager } from "./backgroundProcessManager";
import type { TerminalService } from "@/node/services/terminalService";
import type { BashToolResult } from "@/common/types/tools";
import { createLatticeMessage } from "@/common/types/message";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import * as runtimeFactory from "@/node/runtime/runtimeFactory";
import * as forkOrchestratorModule from "@/node/services/utils/forkOrchestrator";
import * as minionTitleGenerator from "./minionTitleGenerator";

// Helper to access private renamingMinions set
function addToRenamingMinions(service: MinionService, minionId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  (service as any).renamingMinions.add(minionId);
}

// Helper to access private archivingMinions set
function addToArchivingMinions(service: MinionService, minionId: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  (service as any).archivingMinions.add(minionId);
}

async function withTempLatticeRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const originalLatticeRoot = process.env.LATTICE_ROOT;
  const tempRoot = await fsPromises.mkdtemp(path.join(tmpdir(), "lattice-plan-"));
  process.env.LATTICE_ROOT = tempRoot;

  try {
    return await fn(tempRoot);
  } finally {
    if (originalLatticeRoot === undefined) {
      delete process.env.LATTICE_ROOT;
    } else {
      process.env.LATTICE_ROOT = originalLatticeRoot;
    }
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writePlanFile(
  root: string,
  projectName: string,
  minionName: string
): Promise<string> {
  const planDir = path.join(root, "plans", projectName);
  await fsPromises.mkdir(planDir, { recursive: true });
  const planFile = path.join(planDir, `${minionName}.md`);
  await fsPromises.writeFile(planFile, "# Plan\n");
  return planFile;
}

// NOTE: This test file uses bun:test mocks (not Jest).

const mockInitStateManager: Partial<InitStateManager> = {
  on: mock(() => undefined as unknown as InitStateManager),
  getInitState: mock(() => undefined),
  waitForInit: mock(() => Promise.resolve()),
  clearInMemoryState: mock(() => undefined),
};
const mockExtensionMetadataService: Partial<ExtensionMetadataService> = {};
const mockBackgroundProcessManager: Partial<BackgroundProcessManager> = {
  cleanup: mock(() => Promise.resolve()),
};

describe("MinionService rename lock", () => {
  let minionService: MinionService;
  let mockAIService: AIService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    // Create minimal mocks for the services
    mockAIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve({ success: false, error: "not found" })),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
    };
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
    };
    const mockExtensionMetadataService: Partial<ExtensionMetadataService> = {};
    const mockBackgroundProcessManager: Partial<BackgroundProcessManager> = {
      cleanup: mock(() => Promise.resolve()),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("sendMessage returns error when minion is being renamed", async () => {
    const minionId = "test-minion";

    addToRenamingMinions(minionService, minionId);

    const result = await minionService.sendMessage(minionId, "test message", {
      model: "test-model",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const error = result.error;
      // Error is SendMessageError which has a discriminated union
      expect(typeof error === "object" && error.type === "unknown").toBe(true);
      if (typeof error === "object" && error.type === "unknown") {
        expect(error.raw).toContain("being renamed");
      }
    }
  });

  test("resumeStream returns error when minion is being renamed", async () => {
    const minionId = "test-minion";

    addToRenamingMinions(minionService, minionId);

    const result = await minionService.resumeStream(minionId, {
      model: "test-model",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const error = result.error;
      // Error is SendMessageError which has a discriminated union
      expect(typeof error === "object" && error.type === "unknown").toBe(true);
      if (typeof error === "object" && error.type === "unknown") {
        expect(error.raw).toContain("being renamed");
      }
    }
  });

  test("rename returns error when minion is streaming", async () => {
    const minionId = "test-minion";

    // Mock isStreaming to return true
    (mockAIService.isStreaming as ReturnType<typeof mock>).mockReturnValue(true);

    const result = await minionService.rename(minionId, "new-name");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("stream is active");
    }
  });
});

describe("MinionService sendMessage status clearing", () => {
  let minionService: MinionService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;
  let fakeSession: {
    isBusy: ReturnType<typeof mock>;
    queueMessage: ReturnType<typeof mock>;
    sendMessage: ReturnType<typeof mock>;
    resumeStream: ReturnType<typeof mock>;
  };

  beforeEach(async () => {
    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() =>
        Promise.resolve({ success: false as const, error: "not found" })
      ),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => ({
        minionPath: "/tmp/test/minion",
        projectPath: "/tmp/test/project",
      })),
      loadConfigOrDefault: mock(() => ({ projects: new Map() })),
    };

    const mockExtensionMetadata: Partial<ExtensionMetadataService> = {
      updateRecency: mock(() =>
        Promise.resolve({
          recency: Date.now(),
          streaming: false,
          lastModel: null,
          lastThinkingLevel: null,
          agentStatus: null,
        })
      ),
      setStreaming: mock(() =>
        Promise.resolve({
          recency: Date.now(),
          streaming: false,
          lastModel: null,
          lastThinkingLevel: null,
          agentStatus: null,
        })
      ),
      setAgentStatus: mock(() =>
        Promise.resolve({
          recency: Date.now(),
          streaming: false,
          lastModel: null,
          lastThinkingLevel: null,
          agentStatus: null,
        })
      ),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadata as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    fakeSession = {
      isBusy: mock(() => true),
      queueMessage: mock(() => undefined),
      sendMessage: mock(() => Promise.resolve(Ok(undefined))),
      resumeStream: mock(() => Promise.resolve(Ok({ started: true }))),
    };

    (
      minionService as unknown as {
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).getOrCreateSession = mock(() => fakeSession as unknown as AgentSession);

    (
      minionService as unknown as {
        maybePersistAISettingsFromOptions: (
          minionId: string,
          options: unknown,
          source: "send" | "resume"
        ) => Promise<void>;
      }
    ).maybePersistAISettingsFromOptions = mock(() => Promise.resolve());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("does not clear persisted agent status directly for non-synthetic sends", async () => {
    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(true);
    expect(updateAgentStatus).not.toHaveBeenCalled();
  });

  test("does not clear persisted agent status directly for synthetic sends", async () => {
    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const result = await minionService.sendMessage(
      "test-minion",
      "hello",
      {
        model: "openai:gpt-4o-mini",
        agentId: "exec",
      },
      {
        synthetic: true,
      }
    );

    expect(result.success).toBe(true);
    expect(updateAgentStatus).not.toHaveBeenCalled();
  });

  test("sendMessage restores interrupted task status before successful send", async () => {
    fakeSession.isBusy.mockReturnValue(false);

    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(true);
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).not.toHaveBeenCalled();
  });

  test("resumeStream restores interrupted task status before successful resume", async () => {
    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.resumeStream("test-minion", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(true);
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).not.toHaveBeenCalled();
  });

  test("resumeStream keeps interrupted task status when no stream starts", async () => {
    fakeSession.resumeStream.mockResolvedValue(Ok({ started: false }));

    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.resumeStream("test-minion", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.started).toBe(false);
    }
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).toHaveBeenCalledWith("test-minion");
  });

  test("resumeStream does not start interrupted tasks while still busy", async () => {
    const getAgentTaskStatus = mock(() => "interrupted" as const);
    const markInterruptedTaskRunning = mock(() => Promise.resolve(false));
    minionService.setTaskService({
      getAgentTaskStatus,
      markInterruptedTaskRunning,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.resumeStream("test-minion", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    if (!result.success && result.error.type === "unknown") {
      expect(result.error.raw).toContain("Interrupted task is still winding down");
    }
    expect(getAgentTaskStatus).toHaveBeenCalledWith("test-minion");
    expect(markInterruptedTaskRunning).not.toHaveBeenCalled();
    expect(fakeSession.resumeStream).not.toHaveBeenCalled();
  });

  test("sendMessage does not queue interrupted tasks while still busy", async () => {
    const getAgentTaskStatus = mock(() => "interrupted" as const);
    const markInterruptedTaskRunning = mock(() => Promise.resolve(false));
    minionService.setTaskService({
      getAgentTaskStatus,
      markInterruptedTaskRunning,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    if (!result.success && result.error.type === "unknown") {
      expect(result.error.raw).toContain("Interrupted task is still winding down");
    }
    expect(getAgentTaskStatus).toHaveBeenCalledWith("test-minion");
    expect(markInterruptedTaskRunning).not.toHaveBeenCalled();
    expect(fakeSession.queueMessage).not.toHaveBeenCalled();
  });

  test("sendMessage restores interrupted status when resumed send fails", async () => {
    fakeSession.isBusy.mockReturnValue(false);
    fakeSession.sendMessage.mockResolvedValue(
      Err({
        type: "unknown" as const,
        raw: "runtime startup failed after user turn persisted",
      })
    );

    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).toHaveBeenCalledWith("test-minion");
  });

  test("sendMessage restores interrupted status when resumed send throws", async () => {
    fakeSession.isBusy.mockReturnValue(false);
    fakeSession.sendMessage.mockRejectedValue(new Error("send explode"));

    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).toHaveBeenCalledWith("test-minion");
  });

  test("resumeStream restores interrupted status when resumed stream throws", async () => {
    fakeSession.resumeStream.mockRejectedValue(new Error("resume explode"));

    const markInterruptedTaskRunning = mock(() => Promise.resolve(true));
    const restoreInterruptedTaskAfterResumeFailure = mock(() => Promise.resolve());
    minionService.setTaskService({
      markInterruptedTaskRunning,
      restoreInterruptedTaskAfterResumeFailure,
      resetAutoResumeCount: mock(() => undefined),
    } as unknown as TaskService);

    const result = await minionService.resumeStream("test-minion", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    expect(markInterruptedTaskRunning).toHaveBeenCalledWith("test-minion");
    expect(restoreInterruptedTaskAfterResumeFailure).toHaveBeenCalledWith("test-minion");
  });

  test("does not clear persisted agent status directly when direct send fails after turn acceptance", async () => {
    fakeSession.isBusy.mockReturnValue(false);
    fakeSession.sendMessage.mockResolvedValue(
      Err({
        type: "unknown" as const,
        raw: "runtime startup failed after user turn persisted",
      })
    );

    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    expect(updateAgentStatus).not.toHaveBeenCalled();
  });

  test("does not clear persisted agent status directly when direct send is rejected pre-acceptance", async () => {
    fakeSession.isBusy.mockReturnValue(false);
    fakeSession.sendMessage.mockResolvedValue(
      Err({
        type: "invalid_model_string" as const,
        message: "invalid model",
      })
    );

    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const result = await minionService.sendMessage("test-minion", "hello", {
      model: "openai:gpt-4o-mini",
      agentId: "exec",
    });

    expect(result.success).toBe(false);
    expect(updateAgentStatus).not.toHaveBeenCalled();
  });

  test("registerSession clears persisted agent status for accepted user chat events", () => {
    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const minionId = "listener-minion";
    const sessionEmitter = new EventEmitter();
    const listenerSession = {
      onChatEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("chat-event", listener);
        return () => sessionEmitter.off("chat-event", listener);
      },
      onMetadataEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("metadata-event", listener);
        return () => sessionEmitter.off("metadata-event", listener);
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispose: () => {},
    } as unknown as AgentSession;

    minionService.registerSession(minionId, listenerSession);

    sessionEmitter.emit("chat-event", {
      minionId,
      message: {
        type: "message",
        ...createLatticeMessage("user-accepted", "user", "hello"),
      },
    });

    expect(updateAgentStatus).toHaveBeenCalledWith(minionId, null);
  });

  test("registerSession does not clear persisted agent status for synthetic user chat events", () => {
    const updateAgentStatus = spyOn(
      minionService as unknown as {
        updateAgentStatus: (minionId: string, status: null) => Promise<void>;
      },
      "updateAgentStatus"
    ).mockResolvedValue(undefined);

    const minionId = "synthetic-listener-minion";
    const sessionEmitter = new EventEmitter();
    const listenerSession = {
      onChatEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("chat-event", listener);
        return () => sessionEmitter.off("chat-event", listener);
      },
      onMetadataEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("metadata-event", listener);
        return () => sessionEmitter.off("metadata-event", listener);
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispose: () => {},
    } as unknown as AgentSession;

    minionService.registerSession(minionId, listenerSession);

    sessionEmitter.emit("chat-event", {
      minionId,
      message: {
        type: "message",
        ...createLatticeMessage("user-synthetic", "user", "hello", { synthetic: true }),
      },
    });

    expect(updateAgentStatus).not.toHaveBeenCalled();
  });
});

describe("MinionService idle compaction dispatch", () => {
  let minionService: MinionService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() =>
        Promise.resolve({ success: false as const, error: "not found" })
      ),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("marks idle compaction send as synthetic when stream stays active", async () => {
    const minionId = "idle-ws";
    const sendMessage = mock(() => Promise.resolve(Ok(undefined)));
    const buildIdleCompactionSendOptions = mock(() =>
      Promise.resolve({ model: "openai:gpt-4o", agentId: "compact" })
    );

    let busyChecks = 0;
    const session = {
      isBusy: mock(() => {
        busyChecks += 1;
        return busyChecks >= 2;
      }),
    } as unknown as AgentSession;

    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).sendMessage = sendMessage;
    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).buildIdleCompactionSendOptions = buildIdleCompactionSendOptions;
    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).getOrCreateSession = (_minionId: string) => session;

    await minionService.executeIdleCompaction(minionId);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      minionId,
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        skipAutoResumeReset: true,
        synthetic: true,
        requireIdle: true,
      })
    );

    const idleCompactingMinions = (
      minionService as unknown as { idleCompactingMinions: Set<string> }
    ).idleCompactingMinions;
    expect(idleCompactingMinions.has(minionId)).toBe(true);
  });

  test("does not mark idle compaction when send succeeds without active stream", async () => {
    const minionId = "idle-no-stream-ws";
    const sendMessage = mock(() => Promise.resolve(Ok(undefined)));
    const buildIdleCompactionSendOptions = mock(() =>
      Promise.resolve({ model: "openai:gpt-4o", agentId: "compact" })
    );

    const session = {
      isBusy: mock(() => false),
    } as unknown as AgentSession;

    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).sendMessage = sendMessage;
    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).buildIdleCompactionSendOptions = buildIdleCompactionSendOptions;
    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
        getOrCreateSession: (minionId: string) => AgentSession;
      }
    ).getOrCreateSession = (_minionId: string) => session;

    await minionService.executeIdleCompaction(minionId);

    const idleCompactingMinions = (
      minionService as unknown as { idleCompactingMinions: Set<string> }
    ).idleCompactingMinions;
    expect(idleCompactingMinions.has(minionId)).toBe(false);
  });

  test("propagates busy-skip errors", async () => {
    const minionId = "idle-busy-ws";
    const sendMessage = mock(() =>
      Promise.resolve(
        Err({
          type: "unknown" as const,
          raw: "Minion is busy; idle-only send was skipped.",
        })
      )
    );
    const buildIdleCompactionSendOptions = mock(() =>
      Promise.resolve({ model: "openai:gpt-4o", agentId: "compact" })
    );

    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
      }
    ).sendMessage = sendMessage;
    (
      minionService as unknown as {
        sendMessage: typeof sendMessage;
        buildIdleCompactionSendOptions: typeof buildIdleCompactionSendOptions;
      }
    ).buildIdleCompactionSendOptions = buildIdleCompactionSendOptions;

    let executionError: unknown;
    try {
      await minionService.executeIdleCompaction(minionId);
    } catch (error) {
      executionError = error;
    }

    expect(executionError).toBeInstanceOf(Error);
    if (!(executionError instanceof Error)) {
      throw new Error("Expected idle compaction to throw when minion is busy");
    }
    expect(executionError.message).toContain("idle-only send was skipped");
  });
  test("does not tag streaming=true snapshots as idle compaction", async () => {
    const minionId = "idle-streaming-true-no-tag";
    const snapshot = {
      recency: Date.now(),
      streaming: true,
      lastModel: "claude-sonnet-4",
      lastThinkingLevel: null,
    };

    const setStreaming = mock(() => Promise.resolve(snapshot));
    const emitMinionActivity = mock(
      (_minionId: string, _snapshot: typeof snapshot) => undefined
    );

    (
      minionService as unknown as {
        extensionMetadata: ExtensionMetadataService;
        emitMinionActivity: typeof emitMinionActivity;
      }
    ).extensionMetadata = {
      setStreaming,
    } as unknown as ExtensionMetadataService;
    (
      minionService as unknown as {
        extensionMetadata: ExtensionMetadataService;
        emitMinionActivity: typeof emitMinionActivity;
      }
    ).emitMinionActivity = emitMinionActivity;

    const internals = minionService as unknown as {
      idleCompactingMinions: Set<string>;
      updateStreamingStatus: (
        minionId: string,
        streaming: boolean,
        model?: string,
        agentId?: string
      ) => Promise<void>;
    };

    internals.idleCompactingMinions.add(minionId);

    await internals.updateStreamingStatus(minionId, true);

    expect(setStreaming).toHaveBeenCalledWith(minionId, true, undefined, undefined);
    expect(emitMinionActivity).toHaveBeenCalledTimes(1);
    expect(emitMinionActivity).toHaveBeenCalledWith(minionId, snapshot);
    expect(internals.idleCompactingMinions.has(minionId)).toBe(true);
  });

  test("clears idle marker when streaming=false metadata update fails", async () => {
    const minionId = "idle-streaming-false-failure";

    const setStreaming = mock(() => Promise.reject(new Error("setStreaming failed")));
    const extensionMetadata = {
      setStreaming,
    } as unknown as ExtensionMetadataService;

    (
      minionService as unknown as {
        extensionMetadata: ExtensionMetadataService;
      }
    ).extensionMetadata = extensionMetadata;

    const internals = minionService as unknown as {
      idleCompactingMinions: Set<string>;
      updateStreamingStatus: (
        minionId: string,
        streaming: boolean,
        model?: string,
        agentId?: string
      ) => Promise<void>;
    };

    internals.idleCompactingMinions.add(minionId);

    await internals.updateStreamingStatus(minionId, false);

    expect(internals.idleCompactingMinions.has(minionId)).toBe(false);
    expect(setStreaming).toHaveBeenCalledWith(minionId, false, undefined, undefined);
  });
});

describe("MinionService executeBash archive guards", () => {
  let minionService: MinionService;
  let waitForInitMock: ReturnType<typeof mock>;
  let getMinionMetadataMock: ReturnType<typeof mock>;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    waitForInitMock = mock(() => Promise.resolve());

    getMinionMetadataMock = mock(() =>
      Promise.resolve({ success: false as const, error: "not found" })
    );

    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: getMinionMetadataMock,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
      getProjectSecrets: mock(() => []),
    };
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
      waitForInit: waitForInitMock,
    };

    const mockExtensionMetadataService: Partial<ExtensionMetadataService> = {};
    const mockBackgroundProcessManager: Partial<BackgroundProcessManager> = {
      cleanup: mock(() => Promise.resolve()),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("archived minion => executeBash returns error mentioning archived", async () => {
    const minionId = "ws-archived";

    const archivedMetadata: MinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: "/tmp/proj",
      runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
      archivedAt: "2026-01-01T00:00:00.000Z",
    };

    getMinionMetadataMock.mockReturnValue(Promise.resolve(Ok(archivedMetadata)));

    const result = await minionService.executeBash(minionId, "echo hello");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("archived");
    }

    // This must happen before init/runtime operations.
    expect(waitForInitMock).toHaveBeenCalledTimes(0);
  });

  test("archiving minion => executeBash returns error mentioning being archived", async () => {
    const minionId = "ws-archiving";

    addToArchivingMinions(minionService, minionId);

    const result = await minionService.executeBash(minionId, "echo hello");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("being archived");
    }

    expect(waitForInitMock).toHaveBeenCalledTimes(0);
    expect(getMinionMetadataMock).toHaveBeenCalledTimes(0);
  });
});

describe("MinionService post-compaction metadata refresh", () => {
  let minionService: MinionService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() =>
        Promise.resolve({ success: false as const, error: "not found" })
      ),
      on(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
      off(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
    };
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
    };
    const mockExtensionMetadataService: Partial<ExtensionMetadataService> = {};
    const mockBackgroundProcessManager: Partial<BackgroundProcessManager> = {
      cleanup: mock(() => Promise.resolve()),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("returns expanded plan path for local runtimes", async () => {
    await withTempLatticeRoot(async (latticeRoot) => {
      const minionId = "ws-plan-path";
      const minionName = "plan-minion";
      const projectName = "clattice";
      const planFile = await writePlanFile(latticeRoot, projectName, minionName);

      interface MinionServiceTestAccess {
        getInfo: (minionId: string) => Promise<FrontendMinionMetadata | null>;
      }

      const fakeMetadata: FrontendMinionMetadata = {
        id: minionId,
        name: minionName,
        projectName,
        projectPath: "/tmp/proj",
        namedMinionPath: "/tmp/proj/plan-minion",
        runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
      };

      const svc = minionService as unknown as MinionServiceTestAccess;
      svc.getInfo = mock(() => Promise.resolve(fakeMetadata));

      const result = await minionService.getPostCompactionState(minionId);

      expect(result.planPath).toBe(planFile);
      expect(result.planPath?.startsWith("~")).toBe(false);
    });
  });

  test("debounces multiple refresh requests into a single metadata emit", async () => {
    const minionId = "ws-post-compaction";

    const emitMetadata = mock(() => undefined);

    interface MinionServiceTestAccess {
      sessions: Map<string, { emitMetadata: (metadata: unknown) => void }>;
      getInfo: (minionId: string) => Promise<FrontendMinionMetadata | null>;
      getPostCompactionState: (minionId: string) => Promise<{
        planPath: string | null;
        trackedFilePaths: string[];
        excludedItems: string[];
      }>;
      schedulePostCompactionMetadataRefresh: (minionId: string) => void;
    }

    const svc = minionService as unknown as MinionServiceTestAccess;
    svc.sessions.set(minionId, { emitMetadata });

    const fakeMetadata: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: "/tmp/proj",
      namedMinionPath: "/tmp/proj/ws",
      runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
    };

    const getInfoMock: MinionServiceTestAccess["getInfo"] = mock(() =>
      Promise.resolve(fakeMetadata)
    );

    const postCompactionState = {
      planPath: "~/.lattice/plans/clattice/plan.md",
      trackedFilePaths: ["/tmp/proj/file.ts"],
      excludedItems: [],
    };

    const getPostCompactionStateMock: MinionServiceTestAccess["getPostCompactionState"] = mock(
      () => Promise.resolve(postCompactionState)
    );

    svc.getInfo = getInfoMock;
    svc.getPostCompactionState = getPostCompactionStateMock;

    svc.schedulePostCompactionMetadataRefresh(minionId);
    svc.schedulePostCompactionMetadataRefresh(minionId);
    svc.schedulePostCompactionMetadataRefresh(minionId);

    // Debounce is short, but use a safe buffer.
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(getInfoMock).toHaveBeenCalledTimes(1);
    expect(getPostCompactionStateMock).toHaveBeenCalledTimes(1);
    expect(emitMetadata).toHaveBeenCalledTimes(1);

    const enriched = (emitMetadata as ReturnType<typeof mock>).mock.calls[0][0] as {
      postCompaction?: { planPath: string | null };
    };
    expect(enriched.postCompaction?.planPath).toBe(postCompactionState.planPath);
  });
});

describe("MinionService maybePersistAISettingsFromOptions", () => {
  let minionService: MinionService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve({ success: false as const, error: "nope" })),
      on(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
      off(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const minionPath = "/tmp/proj/ws";
    const projectPath = "/tmp/proj";
    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock((minionId: string) =>
        minionId === "ws" ? { projectPath, minionPath } : null
      ),
      loadConfigOrDefault: mock(() => ({
        projects: new Map([
          [
            projectPath,
            {
              minions: [
                {
                  id: "ws",
                  path: minionPath,
                  name: "ws",
                },
              ],
            },
          ],
        ]),
      })),
    };
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
    };
    const mockExtensionMetadataService: Partial<ExtensionMetadataService> = {};
    const mockBackgroundProcessManager: Partial<BackgroundProcessManager> = {
      cleanup: mock(() => Promise.resolve()),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("persists agent AI settings for custom agent", async () => {
    const persistSpy = mock(() => Promise.resolve({ success: true as const, data: true }));

    interface MinionServiceTestAccess {
      maybePersistAISettingsFromOptions: (
        minionId: string,
        options: unknown,
        context: "send" | "resume"
      ) => Promise<void>;
      persistMinionAISettingsForAgent: (...args: unknown[]) => unknown;
    }

    const svc = minionService as unknown as MinionServiceTestAccess;
    svc.persistMinionAISettingsForAgent = persistSpy;

    await svc.maybePersistAISettingsFromOptions(
      "ws",
      {
        agentId: "reviewer",
        model: "openai:gpt-4o-mini",
        thinkingLevel: "off",
      },
      "send"
    );

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  test("persists agent AI settings when agentId matches", async () => {
    const persistSpy = mock(() => Promise.resolve({ success: true as const, data: true }));

    interface MinionServiceTestAccess {
      maybePersistAISettingsFromOptions: (
        minionId: string,
        options: unknown,
        context: "send" | "resume"
      ) => Promise<void>;
      persistMinionAISettingsForAgent: (...args: unknown[]) => unknown;
    }

    const svc = minionService as unknown as MinionServiceTestAccess;
    svc.persistMinionAISettingsForAgent = persistSpy;

    await svc.maybePersistAISettingsFromOptions(
      "ws",
      {
        agentId: "exec",
        model: "openai:gpt-4o-mini",
        thinkingLevel: "off",
      },
      "send"
    );

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  test("persists AI settings for sub-agent minions so auto-resume can use latest model", async () => {
    const persistSpy = mock(() => Promise.resolve({ success: true as const, data: true }));

    interface MinionServiceTestAccess {
      maybePersistAISettingsFromOptions: (
        minionId: string,
        options: unknown,
        context: "send" | "resume"
      ) => Promise<void>;
      persistMinionAISettingsForAgent: (...args: unknown[]) => unknown;
      config: {
        findMinion: (
          minionId: string
        ) => { projectPath: string; minionPath: string } | null;
        loadConfigOrDefault: () => {
          projects: Map<string, { minions: Array<Record<string, unknown>> }>;
        };
      };
    }

    const svc = minionService as unknown as MinionServiceTestAccess;
    svc.persistMinionAISettingsForAgent = persistSpy;

    const projectPath = "/tmp/proj";
    const minionPath = "/tmp/proj/ws";
    svc.config.findMinion = mock((minionId: string) =>
      minionId === "ws" ? { projectPath, minionPath } : null
    );
    svc.config.loadConfigOrDefault = mock(() => ({
      projects: new Map([
        [
          projectPath,
          {
            minions: [
              {
                id: "ws",
                path: minionPath,
                name: "ws",
                parentMinionId: "parent-ws",
              },
            ],
          },
        ],
      ]),
    }));

    await svc.maybePersistAISettingsFromOptions(
      "ws",
      {
        agentId: "exec",
        model: "openai:gpt-4o-mini",
        thinkingLevel: "off",
      },
      "send"
    );

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(
      "ws",
      "exec",
      { model: "openai:gpt-4o-mini", thinkingLevel: "off" },
      { emitMetadata: false }
    );
  });
});
describe("MinionService remove timing rollup", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("waits for stream-abort before rolling up session timing", async () => {
    const minionId = "child-ws";
    const parentMinionId = "parent-ws";

    const tempRoot = await fsPromises.mkdtemp(path.join(tmpdir(), "lattice-remove-"));
    try {
      const sessionRoot = path.join(tempRoot, "sessions");
      await fsPromises.mkdir(path.join(sessionRoot, minionId), { recursive: true });

      let abortEmitted = false;
      let rollUpSawAbort = false;

      class FakeAIService extends EventEmitter {
        isStreaming = mock(() => true);

        stopStream = mock(() => {
          setTimeout(() => {
            abortEmitted = true;
            this.emit("stream-abort", {
              type: "stream-abort",
              minionId,
              messageId: "msg",
              abortReason: "system",
              metadata: { duration: 123 },
              abandonPartial: true,
            });
          }, 0);

          return Promise.resolve({ success: true as const, data: undefined });
        });

        getMinionMetadata = mock(() =>
          Promise.resolve({
            success: true as const,
            data: {
              id: minionId,
              name: "child",
              projectPath: "/tmp/proj",
              runtimeConfig: { type: "local" },
              parentMinionId,
            },
          })
        );
      }

      const aiService = new FakeAIService() as unknown as AIService;
      const mockConfig: Partial<Config> = {
        srcDir: "/tmp/src",
        getSessionDir: mock((id: string) => path.join(sessionRoot, id)),
        removeMinion: mock(() => Promise.resolve()),
        findMinion: mock(() => null),
      };

      const timingService: Partial<SessionTimingService> = {
        waitForIdle: mock(() => Promise.resolve()),
        rollUpTimingIntoParent: mock(() => {
          rollUpSawAbort = abortEmitted;
          return Promise.resolve({ didRollUp: true });
        }),
      };

      const minionService = new MinionService(
        mockConfig as Config,
        historyService,
        aiService,
        mockInitStateManager as InitStateManager,
        mockExtensionMetadataService as ExtensionMetadataService,
        mockBackgroundProcessManager as BackgroundProcessManager,
        undefined, // sessionUsageService
        undefined, // policyService
        undefined, // telemetryService
        undefined, // experimentsService
        timingService as SessionTimingService
      );

      const removeResult = await minionService.remove(minionId, true);
      expect(removeResult.success).toBe(true);
      expect(mockInitStateManager.clearInMemoryState).toHaveBeenCalledWith(minionId);
      expect(rollUpSawAbort).toBe(true);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("MinionService metadata listeners", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("error events clear streaming metadata", async () => {
    const minionId = "ws-error";
    const setStreaming = mock(() =>
      Promise.resolve({
        recency: Date.now(),
        streaming: false,
        lastModel: null,
        lastThinkingLevel: null,
        agentStatus: null,
      })
    );

    class FakeAIService extends EventEmitter {
      isStreaming = mock(() => false);
      getMinionMetadata = mock(() =>
        Promise.resolve({ success: false as const, error: "not found" })
      );
    }

    const aiService = new FakeAIService() as unknown as AIService;
    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/src",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      findMinion: mock(() => null),
      loadConfigOrDefault: mock(() => ({ projects: new Map() })),
    };
    const mockExtensionMetadata: Partial<ExtensionMetadataService> = { setStreaming };

    new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadata as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    aiService.emit("error", {
      minionId,
      messageId: "msg-1",
      error: "rate limited",
      errorType: "rate_limit",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setStreaming).toHaveBeenCalledTimes(1);
    expect(setStreaming).toHaveBeenCalledWith(minionId, false, undefined, undefined);
  });
});

describe("MinionService archive lifecycle hooks", () => {
  const minionId = "ws-archive";
  const projectPath = "/tmp/project";
  const minionPath = "/tmp/project/ws-archive";

  let minionService: MinionService;
  let mockAIService: AIService;
  let configState: ProjectsConfig;
  let editConfigSpy: ReturnType<typeof mock>;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  const minionMetadata: MinionMetadata = {
    id: minionId,
    name: "ws-archive",
    projectName: "proj",
    projectPath,
    runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
  };

  beforeEach(async () => {
    configState = {
      projects: new Map([
        [
          projectPath,
          {
            minions: [
              {
                path: minionPath,
                id: minionId,
              },
            ],
          },
        ],
      ]),
    };

    editConfigSpy = mock((fn: (config: ProjectsConfig) => ProjectsConfig) => {
      configState = fn(configState);
      return Promise.resolve();
    });

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/src",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock((id: string) => {
        if (id !== minionId) {
          return null;
        }

        return { projectPath, minionPath };
      }),
      editConfig: editConfigSpy,
      getAllMinionMetadata: mock(() => Promise.resolve([])),
    };
    mockAIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve(Ok(minionMetadata))),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("returns Err and does not persist archivedAt when beforeArchive hook fails", async () => {
    const hooks = new MinionLifecycleHooks();
    hooks.registerBeforeArchive(() => Promise.resolve(Err("hook failed")));
    minionService.setMinionLifecycleHooks(hooks);

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("hook failed");
    }

    expect(editConfigSpy).toHaveBeenCalledTimes(0);

    const entry = configState.projects.get(projectPath)?.minions[0];
    expect(entry?.archivedAt).toBeUndefined();
  });

  test("does not interrupt an active stream when beforeArchive hook fails", async () => {
    const hooks = new MinionLifecycleHooks();
    hooks.registerBeforeArchive(() => Promise.resolve(Err("hook failed")));
    minionService.setMinionLifecycleHooks(hooks);

    (mockAIService.isStreaming as ReturnType<typeof mock>).mockReturnValue(true);

    const interruptStreamSpy = mock(() => Promise.resolve(Ok(undefined)));
    minionService.interruptStream =
      interruptStreamSpy as unknown as typeof minionService.interruptStream;

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(false);
    expect(interruptStreamSpy).toHaveBeenCalledTimes(0);
  });

  test("archive() closes minion terminal sessions on success", async () => {
    const closeMinionSessions = mock(() => undefined);
    const terminalService = {
      closeMinionSessions,
    } as unknown as TerminalService;
    minionService.setTerminalService(terminalService);

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(true);
    expect(closeMinionSessions).toHaveBeenCalledTimes(1);
    expect(closeMinionSessions).toHaveBeenCalledWith(minionId);
  });

  test("archive() does not close terminal sessions when beforeArchive hook fails", async () => {
    const hooks = new MinionLifecycleHooks();
    hooks.registerBeforeArchive(() => Promise.resolve(Err("hook failed")));
    minionService.setMinionLifecycleHooks(hooks);

    const closeMinionSessions = mock(() => undefined);
    const terminalService = {
      closeMinionSessions,
    } as unknown as TerminalService;
    minionService.setTerminalService(terminalService);

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(false);
    expect(closeMinionSessions).not.toHaveBeenCalled();
  });

  test("persists archivedAt when beforeArchive hooks succeed", async () => {
    const hooks = new MinionLifecycleHooks();
    hooks.registerBeforeArchive(() => Promise.resolve(Ok(undefined)));
    minionService.setMinionLifecycleHooks(hooks);

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(true);
    expect(editConfigSpy).toHaveBeenCalledTimes(1);

    const entry = configState.projects.get(projectPath)?.minions[0];
    expect(entry?.archivedAt).toBeTruthy();
    expect(entry?.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("MinionService archive init cancellation", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("emits metadata when it cancels init but beforeArchive hook fails", async () => {
    const minionId = "ws-archive-init-cancel";
    const projectPath = "/tmp/project";
    const minionPath = "/tmp/project/ws-archive-init-cancel";

    const initStates = new Map<string, InitStatus>([
      [
        minionId,
        {
          status: "running",
          hookPath: projectPath,
          startTime: 0,
          lines: [],
          exitCode: null,
          endTime: null,
        },
      ],
    ]);

    const clearInMemoryStateMock = mock((id: string) => {
      initStates.delete(id);
    });

    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock((id: string) => initStates.get(id)),
      clearInMemoryState: clearInMemoryStateMock,
    };

    let configState: ProjectsConfig = {
      projects: new Map([
        [
          projectPath,
          {
            minions: [
              {
                path: minionPath,
                id: minionId,
              },
            ],
          },
        ],
      ]),
    };

    const editConfigSpy = mock((fn: (config: ProjectsConfig) => ProjectsConfig) => {
      configState = fn(configState);
      return Promise.resolve();
    });

    const frontendMetadata: FrontendMinionMetadata = {
      id: minionId,
      name: "ws-archive-init-cancel",
      projectName: "proj",
      projectPath,
      runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
      namedMinionPath: minionPath,
    };

    const minionMetadata: MinionMetadata = {
      id: minionId,
      name: "ws-archive-init-cancel",
      projectName: "proj",
      projectPath,
      runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
    };

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/src",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock((id: string) => {
        if (id !== minionId) {
          return null;
        }

        return { projectPath, minionPath };
      }),
      editConfig: editConfigSpy,
      getAllMinionMetadata: mock(() => Promise.resolve([frontendMetadata])),
    };

    const mockAIService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve(Ok(minionMetadata))),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      {} as ExtensionMetadataService,
      { cleanup: mock(() => Promise.resolve()) } as unknown as BackgroundProcessManager
    );

    // Seed abort controller so archive() can cancel init.
    const abortController = new AbortController();
    const initAbortControllers = (
      minionService as unknown as { initAbortControllers: Map<string, AbortController> }
    ).initAbortControllers;
    initAbortControllers.set(minionId, abortController);

    const metadataEvents: Array<FrontendMinionMetadata | null> = [];
    minionService.on("metadata", (event: unknown) => {
      if (!event || typeof event !== "object") {
        return;
      }
      const parsed = event as { minionId: string; metadata: FrontendMinionMetadata | null };
      if (parsed.minionId === minionId) {
        metadataEvents.push(parsed.metadata);
      }
    });

    const hooks = new MinionLifecycleHooks();
    hooks.registerBeforeArchive(() => Promise.resolve(Err("hook failed")));
    minionService.setMinionLifecycleHooks(hooks);

    const result = await minionService.archive(minionId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("hook failed");
    }

    // Ensure we didn't persist archivedAt on hook failure.
    expect(editConfigSpy).toHaveBeenCalledTimes(0);
    const entry = configState.projects.get(projectPath)?.minions[0];
    expect(entry?.archivedAt).toBeUndefined();

    expect(abortController.signal.aborted).toBe(true);
    expect(clearInMemoryStateMock).toHaveBeenCalledWith(minionId);

    expect(metadataEvents.length).toBeGreaterThanOrEqual(1);
    expect(metadataEvents.at(-1)?.isInitializing).toBe(undefined);
  });
});

describe("MinionService unarchive lifecycle hooks", () => {
  const minionId = "ws-unarchive";
  const projectPath = "/tmp/project";
  const minionPath = "/tmp/project/ws-unarchive";

  let minionService: MinionService;
  let configState: ProjectsConfig;
  let editConfigSpy: ReturnType<typeof mock>;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  const minionMetadata: FrontendMinionMetadata = {
    id: minionId,
    name: "ws-unarchive",
    projectName: "proj",
    projectPath,
    runtimeConfig: { type: "local", srcBaseDir: "/tmp" },
    archivedAt: "2020-01-01T00:00:00.000Z",
    namedMinionPath: minionPath,
  };

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    configState = {
      projects: new Map([
        [
          projectPath,
          {
            minions: [
              {
                path: minionPath,
                id: minionId,
                archivedAt: "2020-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      ]),
    };

    editConfigSpy = mock((fn: (config: ProjectsConfig) => ProjectsConfig) => {
      configState = fn(configState);
      return Promise.resolve();
    });

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/src",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock((id: string) => {
        if (id !== minionId) {
          return null;
        }

        return { projectPath, minionPath };
      }),
      editConfig: editConfigSpy,
      getAllMinionMetadata: mock(() => Promise.resolve([minionMetadata])),
    };
    const aiService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve(Ok(minionMetadata))),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("persists unarchivedAt and runs afterUnarchive hooks (best-effort)", async () => {
    const hooks = new MinionLifecycleHooks();

    const afterHook = mock(() => {
      const entry = configState.projects.get(projectPath)?.minions[0];
      expect(entry?.unarchivedAt).toBeTruthy();
      return Promise.resolve(Err("hook failed"));
    });
    hooks.registerAfterUnarchive(afterHook);

    minionService.setMinionLifecycleHooks(hooks);

    const result = await minionService.unarchive(minionId);

    expect(result.success).toBe(true);
    expect(afterHook).toHaveBeenCalledTimes(1);

    const entry = configState.projects.get(projectPath)?.minions[0];
    expect(entry?.unarchivedAt).toBeTruthy();
    expect(entry?.unarchivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("does not run afterUnarchive hooks when minion is not archived", async () => {
    const entry = configState.projects.get(projectPath)?.minions[0];
    if (!entry) {
      throw new Error("Missing minion entry");
    }
    entry.archivedAt = undefined;

    const hooks = new MinionLifecycleHooks();
    const afterHook = mock(() => Promise.resolve(Ok(undefined)));
    hooks.registerAfterUnarchive(afterHook);
    minionService.setMinionLifecycleHooks(hooks);

    const result = await minionService.unarchive(minionId);

    expect(result.success).toBe(true);
    expect(afterHook).toHaveBeenCalledTimes(0);
  });
});

describe("MinionService archiveMergedInProject", () => {
  const TARGET_PROJECT_PATH = "/tmp/project";

  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  function createMetadata(
    id: string,
    options?: { projectPath?: string; archivedAt?: string; unarchivedAt?: string }
  ): FrontendMinionMetadata {
    const projectPath = options?.projectPath ?? TARGET_PROJECT_PATH;

    return {
      id,
      name: id,
      projectName: "test-project",
      projectPath,
      runtimeConfig: { type: "local" },
      namedMinionPath: path.join(projectPath, id),
      archivedAt: options?.archivedAt,
      unarchivedAt: options?.unarchivedAt,
    };
  }

  function bashOk(output: string): Result<BashToolResult> {
    return {
      success: true,
      data: {
        success: true,
        output,
        exitCode: 0,
        wall_duration_ms: 0,
      },
    };
  }

  function bashToolFailure(error: string): Result<BashToolResult> {
    return {
      success: true,
      data: {
        success: false,
        error,
        exitCode: 1,
        wall_duration_ms: 0,
      },
    };
  }

  function executeBashFailure(error: string): Result<BashToolResult> {
    return { success: false, error };
  }

  type ExecuteBashFn = (
    minionId: string,
    script: string,
    options?: { timeout_secs?: number }
  ) => Promise<Result<BashToolResult>>;

  type ArchiveFn = (minionId: string) => Promise<Result<void>>;

  function createServiceHarness(
    allMetadata: FrontendMinionMetadata[],
    executeBashImpl: ExecuteBashFn,
    archiveImpl: ArchiveFn
  ): {
    minionService: MinionService;
    executeBashMock: ReturnType<typeof mock>;
    archiveMock: ReturnType<typeof mock>;
  } {
    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
      getAllMinionMetadata: mock(() => Promise.resolve(allMetadata)),
    };

    const aiService: AIService = {
      on(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
      off(_eventName: string | symbol, _listener: (...args: unknown[]) => void) {
        return this;
      },
    } as unknown as AIService;
    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      aiService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    const executeBashMock = mock(executeBashImpl);
    const archiveMock = mock(archiveImpl);

    interface MinionServiceTestAccess {
      executeBash: typeof executeBashMock;
      archive: typeof archiveMock;
    }

    const svc = minionService as unknown as MinionServiceTestAccess;
    svc.executeBash = executeBashMock;
    svc.archive = archiveMock;

    return { minionService, executeBashMock, archiveMock };
  }

  test("excludes LATTICE_HELP_CHAT_MINION_ID minions", async () => {
    const allMetadata: FrontendMinionMetadata[] = [
      createMetadata(LATTICE_HELP_CHAT_MINION_ID),
      createMetadata("ws-merged"),
    ];

    const ghResultsByMinionId: Record<string, Result<BashToolResult>> = {
      "ws-merged": bashOk('{"state":"MERGED"}'),
    };

    const { minionService, executeBashMock, archiveMock } = createServiceHarness(
      allMetadata,
      (minionId) => {
        const result = ghResultsByMinionId[minionId];
        if (!result) {
          throw new Error(`Unexpected executeBash call for minionId: ${minionId}`);
        }
        return Promise.resolve(result);
      },
      () => Promise.resolve({ success: true, data: undefined })
    );

    const result = await minionService.archiveMergedInProject(TARGET_PROJECT_PATH);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.archivedMinionIds).toEqual(["ws-merged"]);
    expect(result.data.skippedMinionIds).toEqual([]);
    expect(result.data.errors).toEqual([]);

    expect(archiveMock).toHaveBeenCalledTimes(1);
    expect(archiveMock).toHaveBeenCalledWith("ws-merged");

    // Should only query GitHub for the eligible non-lattice-chat minion.
    expect(executeBashMock).toHaveBeenCalledTimes(1);
  });

  test("treats minions with later unarchivedAt as eligible", async () => {
    const allMetadata: FrontendMinionMetadata[] = [
      createMetadata("ws-merged-unarchived", {
        archivedAt: "2025-01-01T00:00:00.000Z",
        unarchivedAt: "2025-02-01T00:00:00.000Z",
      }),
      createMetadata("ws-still-archived", {
        archivedAt: "2025-03-01T00:00:00.000Z",
        unarchivedAt: "2025-02-01T00:00:00.000Z",
      }),
    ];

    const ghResultsByMinionId: Record<string, Result<BashToolResult>> = {
      "ws-merged-unarchived": bashOk('{"state":"MERGED"}'),
    };

    const { minionService, executeBashMock, archiveMock } = createServiceHarness(
      allMetadata,
      (minionId) => {
        const result = ghResultsByMinionId[minionId];
        if (!result) {
          throw new Error(`Unexpected executeBash call for minionId: ${minionId}`);
        }
        return Promise.resolve(result);
      },
      () => Promise.resolve({ success: true, data: undefined })
    );

    const result = await minionService.archiveMergedInProject(TARGET_PROJECT_PATH);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.archivedMinionIds).toEqual(["ws-merged-unarchived"]);
    expect(result.data.skippedMinionIds).toEqual([]);
    expect(result.data.errors).toEqual([]);

    expect(archiveMock).toHaveBeenCalledTimes(1);
    expect(archiveMock).toHaveBeenCalledWith("ws-merged-unarchived");

    // Should only query GitHub for the minion that is considered unarchived.
    expect(executeBashMock).toHaveBeenCalledTimes(1);
  });
  test("archives only MERGED minions", async () => {
    const allMetadata: FrontendMinionMetadata[] = [
      createMetadata("ws-open"),
      createMetadata("ws-merged"),
      createMetadata("ws-no-pr"),
      createMetadata("ws-other-project", { projectPath: "/tmp/other" }),
      createMetadata("ws-already-archived", { archivedAt: "2025-01-01T00:00:00.000Z" }),
    ];

    const ghResultsByMinionId: Record<string, Result<BashToolResult>> = {
      "ws-open": bashOk('{"state":"OPEN"}'),
      "ws-merged": bashOk('{"state":"MERGED"}'),
      "ws-no-pr": bashOk('{"no_pr":true}'),
    };

    const { minionService, executeBashMock, archiveMock } = createServiceHarness(
      allMetadata,
      (minionId, script, options) => {
        expect(script).toContain("gh pr view --json state");
        expect(options?.timeout_secs).toBe(15);

        const result = ghResultsByMinionId[minionId];
        if (!result) {
          throw new Error(`Unexpected executeBash call for minionId: ${minionId}`);
        }
        return Promise.resolve(result);
      },
      () => Promise.resolve({ success: true, data: undefined })
    );

    const result = await minionService.archiveMergedInProject(TARGET_PROJECT_PATH);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.archivedMinionIds).toEqual(["ws-merged"]);
    expect(result.data.skippedMinionIds).toEqual(["ws-no-pr", "ws-open"]);
    expect(result.data.errors).toEqual([]);

    expect(archiveMock).toHaveBeenCalledTimes(1);
    expect(archiveMock).toHaveBeenCalledWith("ws-merged");

    expect(executeBashMock).toHaveBeenCalledTimes(3);
  });

  test("skips no_pr and non-merged states", async () => {
    const allMetadata: FrontendMinionMetadata[] = [
      createMetadata("ws-open"),
      createMetadata("ws-closed"),
      createMetadata("ws-no-pr"),
    ];

    const ghResultsByMinionId: Record<string, Result<BashToolResult>> = {
      "ws-open": bashOk('{"state":"OPEN"}'),
      "ws-closed": bashOk('{"state":"CLOSED"}'),
      "ws-no-pr": bashOk('{"no_pr":true}'),
    };

    const { minionService, archiveMock } = createServiceHarness(
      allMetadata,
      (minionId) => {
        const result = ghResultsByMinionId[minionId];
        if (!result) {
          throw new Error(`Unexpected executeBash call for minionId: ${minionId}`);
        }
        return Promise.resolve(result);
      },
      () => Promise.resolve({ success: true, data: undefined })
    );

    const result = await minionService.archiveMergedInProject(TARGET_PROJECT_PATH);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.archivedMinionIds).toEqual([]);
    expect(result.data.skippedMinionIds).toEqual(["ws-closed", "ws-no-pr", "ws-open"]);
    expect(result.data.errors).toEqual([]);

    expect(archiveMock).toHaveBeenCalledTimes(0);
  });

  test("records errors for malformed JSON and executeBash failures", async () => {
    const allMetadata: FrontendMinionMetadata[] = [
      createMetadata("ws-bad-json"),
      createMetadata("ws-exec-failed"),
      createMetadata("ws-bash-failed"),
    ];

    const ghResultsByMinionId: Record<string, Result<BashToolResult>> = {
      "ws-bad-json": bashOk("not-json"),
      "ws-exec-failed": executeBashFailure("executeBash failed"),
      "ws-bash-failed": bashToolFailure("gh failed"),
    };

    const { minionService, archiveMock } = createServiceHarness(
      allMetadata,
      (minionId) => {
        const result = ghResultsByMinionId[minionId];
        if (!result) {
          throw new Error(`Unexpected executeBash call for minionId: ${minionId}`);
        }
        return Promise.resolve(result);
      },
      () => Promise.resolve({ success: true, data: undefined })
    );

    const result = await minionService.archiveMergedInProject(TARGET_PROJECT_PATH);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.archivedMinionIds).toEqual([]);
    expect(result.data.skippedMinionIds).toEqual([]);
    expect(result.data.errors).toHaveLength(3);

    const badJsonError = result.data.errors.find((e) => e.minionId === "ws-bad-json");
    expect(badJsonError).toBeDefined();
    expect(badJsonError?.error).toContain("Failed to parse gh output");

    const execFailedError = result.data.errors.find((e) => e.minionId === "ws-exec-failed");
    expect(execFailedError).toBeDefined();
    expect(execFailedError?.error).toBe("executeBash failed");

    const bashFailedError = result.data.errors.find((e) => e.minionId === "ws-bash-failed");
    expect(bashFailedError).toBeDefined();
    expect(bashFailedError?.error).toBe("gh failed");

    expect(archiveMock).toHaveBeenCalledTimes(0);
  });
});

describe("MinionService init cancellation", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("archive() aborts init and still archives when init is running", async () => {
    const minionId = "ws-init-running";

    const removeMock = mock(() => Promise.resolve({ success: true as const, data: undefined }));
    const editConfigMock = mock(() => Promise.resolve());
    const clearInMemoryStateMock = mock((_minionId: string) => undefined);

    const mockAIService = {
      isStreaming: mock(() => false),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      findMinion: mock(() => ({ projectPath: "/tmp/proj", minionPath: "/tmp/proj/ws" })),
      editConfig: editConfigMock,
      getAllMinionMetadata: mock(() => Promise.resolve([])),
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
    };

    const mockInitStateManager: Partial<InitStateManager> = {
      // MinionService subscribes to init-end events on construction.
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(
        (): InitStatus => ({
          status: "running",
          hookPath: "/tmp/proj",
          startTime: 0,
          lines: [],
          exitCode: null,
          endTime: null,
        })
      ),
      clearInMemoryState: clearInMemoryStateMock,
    };
    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    // Make it obvious if archive() incorrectly chooses deletion.
    minionService.remove = removeMock as unknown as typeof minionService.remove;

    const result = await minionService.archive(minionId);
    expect(result.success).toBe(true);
    expect(editConfigMock).toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
    expect(clearInMemoryStateMock).toHaveBeenCalledWith(minionId);
  });

  test("archive() uses normal archive flow when init is complete", async () => {
    const minionId = "ws-init-complete";

    const removeMock = mock(() => Promise.resolve({ success: true as const, data: undefined }));
    const editConfigMock = mock(() => Promise.resolve());

    const mockAIService = {
      isStreaming: mock(() => false),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      findMinion: mock(() => ({ projectPath: "/tmp/proj", minionPath: "/tmp/proj/ws" })),
      editConfig: editConfigMock,
      getAllMinionMetadata: mock(() => Promise.resolve([])),
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
    };

    const mockInitStateManager: Partial<InitStateManager> = {
      // MinionService subscribes to init-end events on construction.
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(
        (): InitStatus => ({
          status: "success",
          hookPath: "/tmp/proj",
          startTime: 0,
          lines: [],
          exitCode: 0,
          endTime: 1,
        })
      ),
      clearInMemoryState: mock((_minionId: string) => undefined),
    };
    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    // Make it obvious if archive() incorrectly chooses deletion.
    minionService.remove = removeMock as unknown as typeof minionService.remove;

    const result = await minionService.archive(minionId);
    expect(result.success).toBe(true);
    expect(editConfigMock).toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  test("list() includes isInitializing when init state is running", async () => {
    const minionId = "ws-list-initializing";

    const mockAIService = {
      isStreaming: mock(() => false),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const mockMetadata: FrontendMinionMetadata = {
      id: minionId,
      name: "ws",
      projectName: "proj",
      projectPath: "/tmp/proj",
      createdAt: "2026-01-01T00:00:00.000Z",
      namedMinionPath: "/tmp/proj/ws",
      runtimeConfig: { type: "local" },
    };

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getAllMinionMetadata: mock(() => Promise.resolve([mockMetadata])),
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
    };

    const mockInitStateManager: Partial<InitStateManager> = {
      // MinionService subscribes to init-end events on construction.
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock((id: string): InitStatus | undefined =>
        id === minionId
          ? {
              status: "running",
              hookPath: "/tmp/proj",
              startTime: 0,
              lines: [],
              exitCode: null,
              endTime: null,
            }
          : undefined
      ),
    };
    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    const list = await minionService.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.isInitializing).toBe(true);
  });

  test("create() clears init state + emits updated metadata when skipping background init", async () => {
    const minionId = "ws-skip-init";
    const projectPath = "/tmp/proj";
    const branchName = "ws_branch";
    const minionPath = "/tmp/proj/ws_branch";

    const initStates = new Map<string, InitStatus>();
    const clearInMemoryStateMock = mock((id: string) => {
      initStates.delete(id);
    });

    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      startInit: mock((id: string) => {
        initStates.set(id, {
          status: "running",
          hookPath: projectPath,
          startTime: 0,
          lines: [],
          exitCode: null,
          endTime: null,
        });
      }),
      getInitState: mock((id: string) => initStates.get(id)),
      clearInMemoryState: clearInMemoryStateMock,
    };

    const configState: ProjectsConfig = { projects: new Map() };

    const mockMetadata: FrontendMinionMetadata = {
      id: minionId,
      name: branchName,
      title: "title",
      projectName: "proj",
      projectPath,
      createdAt: "2026-01-01T00:00:00.000Z",
      namedMinionPath: minionPath,
      runtimeConfig: { type: "local" },
    };

    const mockConfig: Partial<Config> = {
      rootDir: "/tmp/lattice-root",
      srcDir: "/tmp/src",
      generateStableId: mock(() => minionId),
      editConfig: mock((editFn: (config: ProjectsConfig) => ProjectsConfig) => {
        editFn(configState);
        return Promise.resolve();
      }),
      getAllMinionMetadata: mock(() => Promise.resolve([mockMetadata])),
      getEffectiveSecrets: mock(() => []),
      getSessionDir: mock(() => "/tmp/test/sessions"),
      findMinion: mock(() => null),
    };

    const mockAIService = {
      isStreaming: mock(() => false),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;
    const createMinionMock = mock(() =>
      Promise.resolve({ success: true as const, minionPath })
    );

    const createRuntimeSpy = spyOn(runtimeFactory, "createRuntime").mockReturnValue({
      createMinion: createMinionMock,
    } as unknown as ReturnType<typeof runtimeFactory.createRuntime>);

    const sessionEmitter = new EventEmitter();
    const fakeSession = {
      onChatEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("chat-event", listener);
        return () => sessionEmitter.off("chat-event", listener);
      },
      onMetadataEvent: (listener: (event: unknown) => void) => {
        sessionEmitter.on("metadata-event", listener);
        return () => sessionEmitter.off("metadata-event", listener);
      },
      emitMetadata: (metadata: FrontendMinionMetadata | null) => {
        sessionEmitter.emit("metadata-event", { minionId, metadata });
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispose: () => {},
    } as unknown as AgentSession;

    try {
      const minionService = new MinionService(
        mockConfig as Config,
        historyService,
        mockAIService,
        mockInitStateManager as InitStateManager,
        mockExtensionMetadataService as ExtensionMetadataService,
        mockBackgroundProcessManager as BackgroundProcessManager
      );

      const metadataEvents: Array<FrontendMinionMetadata | null> = [];
      minionService.on("metadata", (event: unknown) => {
        if (!event || typeof event !== "object") {
          return;
        }
        const parsed = event as { minionId: string; metadata: FrontendMinionMetadata | null };
        if (parsed.minionId === minionId) {
          metadataEvents.push(parsed.metadata);
        }
      });

      minionService.registerSession(minionId, fakeSession);

      const removingMinions = (
        minionService as unknown as { removingMinions: Set<string> }
      ).removingMinions;
      removingMinions.add(minionId);

      const result = await minionService.create(projectPath, branchName, undefined, "title", {
        type: "local",
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        return;
      }

      expect(result.data.metadata.isInitializing).toBe(undefined);
      expect(clearInMemoryStateMock).toHaveBeenCalledWith(minionId);

      expect(metadataEvents).toHaveLength(2);
      expect(metadataEvents[0]?.isInitializing).toBe(true);
      expect(metadataEvents[1]?.isInitializing).toBe(undefined);
    } finally {
      createRuntimeSpy.mockRestore();
    }
  });
  test("remove() aborts init and clears state before teardown", async () => {
    const minionId = "ws-remove-aborts";

    const tempRoot = await fsPromises.mkdtemp(path.join(tmpdir(), "lattice-ws-remove-"));
    try {
      const abortController = new AbortController();
      const clearInMemoryStateMock = mock((_minionId: string) => undefined);
      const mockInitStateManager = {
        on: mock(() => undefined as unknown as InitStateManager),
        getInitState: mock(() => undefined),
        clearInMemoryState: clearInMemoryStateMock,
      } as unknown as InitStateManager;

      const mockAIService = {
        isStreaming: mock(() => false),
        stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
        getMinionMetadata: mock(() => Promise.resolve({ success: false as const, error: "na" })),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        on: mock(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        off: mock(() => {}),
      } as unknown as AIService;

      const mockConfig: Partial<Config> = {
        srcDir: "/tmp/src",
        getSessionDir: mock((id: string) => path.join(tempRoot, id)),
        removeMinion: mock(() => Promise.resolve()),
        findMinion: mock(() => null),
      };
      const minionService = new MinionService(
        mockConfig as Config,
        historyService,
        mockAIService,
        mockInitStateManager,
        mockExtensionMetadataService as ExtensionMetadataService,
        mockBackgroundProcessManager as BackgroundProcessManager
      );

      // Inject an in-progress init AbortController.
      const initAbortControllers = (
        minionService as unknown as { initAbortControllers: Map<string, AbortController> }
      ).initAbortControllers;
      initAbortControllers.set(minionId, abortController);

      const result = await minionService.remove(minionId, true);
      expect(result.success).toBe(true);
      expect(abortController.signal.aborted).toBe(true);
      expect(clearInMemoryStateMock).toHaveBeenCalledWith(minionId);

      expect(initAbortControllers.has(minionId)).toBe(false);
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("remove() does not clear init state when runtime deletion fails with force=false", async () => {
    const minionId = "ws-remove-runtime-delete-fails";
    const projectPath = "/tmp/proj";

    const abortController = new AbortController();
    const clearInMemoryStateMock = mock((_minionId: string) => undefined);
    const mockInitStateManager = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
      clearInMemoryState: clearInMemoryStateMock,
    } as unknown as InitStateManager;
    const removeMinionMock = mock(() => Promise.resolve());

    const deleteMinionMock = mock(() =>
      Promise.resolve({ success: false as const, error: "dirty" })
    );

    const createRuntimeSpy = spyOn(runtimeFactory, "createRuntime").mockReturnValue({
      deleteMinion: deleteMinionMock,
    } as unknown as ReturnType<typeof runtimeFactory.createRuntime>);

    const tempRoot = await fsPromises.mkdtemp(path.join(tmpdir(), "lattice-ws-remove-fail-"));
    try {
      const mockAIService = {
        isStreaming: mock(() => false),
        stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
        getMinionMetadata: mock(() =>
          Promise.resolve(
            Ok({
              id: minionId,
              name: "ws",
              projectPath,
              projectName: "proj",
              runtimeConfig: { type: "local" },
            })
          )
        ),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        on: mock(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        off: mock(() => {}),
      } as unknown as AIService;

      const mockConfig: Partial<Config> = {
        srcDir: "/tmp/src",
        getSessionDir: mock((id: string) => path.join(tempRoot, id)),
        removeMinion: removeMinionMock,
        findMinion: mock(() => null),
      };
      const minionService = new MinionService(
        mockConfig as Config,
        historyService,
        mockAIService,
        mockInitStateManager,
        mockExtensionMetadataService as ExtensionMetadataService,
        mockBackgroundProcessManager as BackgroundProcessManager
      );

      // Inject an in-progress init AbortController.
      const initAbortControllers = (
        minionService as unknown as { initAbortControllers: Map<string, AbortController> }
      ).initAbortControllers;
      initAbortControllers.set(minionId, abortController);

      const result = await minionService.remove(minionId, false);
      expect(result.success).toBe(false);
      expect(abortController.signal.aborted).toBe(true);

      // If runtime deletion fails with force=false, removal returns early and the minion remains.
      // Keep init state intact so init-end can refresh metadata and clear isInitializing.
      expect(clearInMemoryStateMock).not.toHaveBeenCalled();
      expect(removeMinionMock).not.toHaveBeenCalled();
    } finally {
      createRuntimeSpy.mockRestore();
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
  test("remove() calls runtime.deleteMinion when force=true", async () => {
    const minionId = "ws-remove-runtime-delete";
    const projectPath = "/tmp/proj";

    const deleteMinionMock = mock(() =>
      Promise.resolve({ success: true as const, deletedPath: "/tmp/deleted" })
    );

    const createRuntimeSpy = spyOn(runtimeFactory, "createRuntime").mockReturnValue({
      deleteMinion: deleteMinionMock,
    } as unknown as ReturnType<typeof runtimeFactory.createRuntime>);

    const tempRoot = await fsPromises.mkdtemp(path.join(tmpdir(), "lattice-ws-remove-runtime-"));
    try {
      const mockAIService = {
        isStreaming: mock(() => false),
        stopStream: mock(() => Promise.resolve({ success: true as const, data: undefined })),
        getMinionMetadata: mock(() =>
          Promise.resolve(
            Ok({
              id: minionId,
              name: "ws",
              projectPath,
              projectName: "proj",
              runtimeConfig: { type: "local" },
            })
          )
        ),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        on: mock(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        off: mock(() => {}),
      } as unknown as AIService;

      const mockConfig: Partial<Config> = {
        srcDir: "/tmp/src",
        getSessionDir: mock((id: string) => path.join(tempRoot, id)),
        removeMinion: mock(() => Promise.resolve()),
        findMinion: mock(() => ({ projectPath, minionPath: "/tmp/proj/ws" })),
      };
      const minionService = new MinionService(
        mockConfig as Config,
        historyService,
        mockAIService,
        mockInitStateManager as InitStateManager,
        mockExtensionMetadataService as ExtensionMetadataService,
        mockBackgroundProcessManager as BackgroundProcessManager
      );

      const result = await minionService.remove(minionId, true);
      expect(result.success).toBe(true);
      expect(deleteMinionMock).toHaveBeenCalledWith(projectPath, "ws", true);
    } finally {
      createRuntimeSpy.mockRestore();
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("MinionService regenerateTitle", () => {
  let minionService: MinionService;
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    const mockAIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() =>
        Promise.resolve({ success: false as const, error: "minion metadata unavailable" })
      ),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => ({ projectPath: "/tmp/proj", minionPath: "/tmp/proj/ws" })),
    };
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => undefined),
    };

    minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("returns updateTitle error when persisting generated title fails", async () => {
    const minionId = "ws-regenerate-title";

    await historyService.appendToHistory(minionId, createLatticeMessage("user-1", "user", "Fix CI"));

    const generateIdentitySpy = spyOn(
      minionTitleGenerator,
      "generateMinionIdentity"
    ).mockResolvedValue(
      Ok({
        name: "ci-fix-a1b2",
        title: "Fix CI",
        modelUsed: "anthropic:claude-3-5-haiku-latest",
      })
    );
    const updateTitleSpy = spyOn(minionService, "updateTitle").mockResolvedValueOnce(
      Err("Failed to update minion title: disk full")
    );

    try {
      const result = await minionService.regenerateTitle(minionId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Failed to update minion title: disk full");
      }
      expect(generateIdentitySpy).toHaveBeenCalledTimes(1);
      const call = generateIdentitySpy.mock.calls[0];
      expect(call?.[3]).toBeUndefined();
      expect(call?.[4]).toBe("Fix CI");
      expect(updateTitleSpy).toHaveBeenCalledWith(minionId, "Fix CI");
    } finally {
      updateTitleSpy.mockRestore();
      generateIdentitySpy.mockRestore();
    }
  });
  test("falls back to full history when latest compaction epoch has no user message", async () => {
    const minionId = "ws-regenerate-title-compacted";

    await historyService.appendToHistory(
      minionId,
      createLatticeMessage("user-before-boundary", "user", "Refactor sidebar loading")
    );
    await historyService.appendToHistory(
      minionId,
      createLatticeMessage("summary-boundary", "assistant", "Compacted summary", {
        compacted: true,
        compactionBoundary: true,
        compactionEpoch: 1,
      })
    );
    await historyService.appendToHistory(
      minionId,
      createLatticeMessage("assistant-after-boundary", "assistant", "No new user messages yet")
    );

    const iterateSpy = spyOn(historyService, "iterateFullHistory");
    const generateIdentitySpy = spyOn(
      minionTitleGenerator,
      "generateMinionIdentity"
    ).mockResolvedValue(
      Ok({
        name: "sidebar-refactor-a1b2",
        title: "Refactor sidebar loading",
        modelUsed: "anthropic:claude-3-5-haiku-latest",
      })
    );
    const updateTitleSpy = spyOn(minionService, "updateTitle").mockResolvedValueOnce(
      Ok(undefined)
    );

    try {
      const result = await minionService.regenerateTitle(minionId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe("Refactor sidebar loading");
      }
      expect(iterateSpy).toHaveBeenCalledTimes(1);
      expect(generateIdentitySpy).toHaveBeenCalledTimes(1);
      const call = generateIdentitySpy.mock.calls[0];
      expect(call?.[0]).toBe("Refactor sidebar loading");
      const context = call?.[3];
      expect(typeof context).toBe("string");
      if (typeof context === "string") {
        expect(context).toContain("Refactor sidebar loading");
        expect(context).toContain("Compacted summary");
        expect(context).toContain("No new user messages yet");
        expect(context).not.toContain("omitted for brevity");
      }
      expect(call?.[4]).toBe("Refactor sidebar loading");
      expect(updateTitleSpy).toHaveBeenCalledWith(minionId, "Refactor sidebar loading");
    } finally {
      updateTitleSpy.mockRestore();
      generateIdentitySpy.mockRestore();
      iterateSpy.mockRestore();
    }
  });
  test("uses first user turn + latest 3 turns and flags omitted context", async () => {
    const minionId = "ws-regenerate-title-first-plus-last-three";

    for (let turn = 1; turn <= 12; turn++) {
      const role: "user" | "assistant" = turn % 2 === 1 ? "user" : "assistant";
      const text = `${role === "user" ? "User" : "Assistant"} turn ${turn}`;
      await historyService.appendToHistory(
        minionId,
        createLatticeMessage(`${role}-${turn}`, role, text)
      );
    }

    const generateIdentitySpy = spyOn(
      minionTitleGenerator,
      "generateMinionIdentity"
    ).mockResolvedValue(
      Ok({
        name: "title-refresh-a1b2",
        title: "User turn 1",
        modelUsed: "anthropic:claude-3-5-haiku-latest",
      })
    );
    const updateTitleSpy = spyOn(minionService, "updateTitle").mockResolvedValueOnce(
      Ok(undefined)
    );

    try {
      const result = await minionService.regenerateTitle(minionId);

      expect(result.success).toBe(true);
      expect(generateIdentitySpy).toHaveBeenCalledTimes(1);
      const call = generateIdentitySpy.mock.calls[0];
      expect(call?.[0]).toBe("User turn 1");
      const context = call?.[3];
      expect(typeof context).toBe("string");
      expect(call?.[4]).toBe("User turn 11");
      expect(updateTitleSpy).toHaveBeenCalledWith(minionId, "User turn 1");
    } finally {
      updateTitleSpy.mockRestore();
      generateIdentitySpy.mockRestore();
    }
  });
});

describe("MinionService fork", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("cleans up init state when orchestrateFork rejects", async () => {
    const sourceMinionId = "source-minion";
    const newMinionId = "forked-minion";
    const sourceProjectPath = "/tmp/project";

    const mockAIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() =>
        Promise.resolve(
          Ok({
            id: sourceMinionId,
            name: "source-branch",
            projectPath: sourceProjectPath,
            projectName: "project",
            runtimeConfig: { type: "local" },
          })
        )
      ),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const startInitMock = mock(() => undefined);
    const endInitMock = mock(() => Promise.resolve());
    const mockInitStateManager: Partial<InitStateManager> = {
      on: mock(() => undefined as unknown as InitStateManager),
      getInitState: mock(() => ({ status: "running" }) as unknown as InitStatus),
      startInit: startInitMock,
      endInit: endInitMock,
      appendOutput: mock(() => undefined),
      enterHookPhase: mock(() => undefined),
    };

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/src",
      generateStableId: mock(() => newMinionId),
      findMinion: mock(() => null),
      getSessionDir: mock(() => "/tmp/test/sessions"),
    };

    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    const getOrCreateSessionSpy = spyOn(minionService, "getOrCreateSession").mockReturnValue({
      emitMetadata: mock(() => undefined),
    } as unknown as AgentSession);
    const createRuntimeSpy = spyOn(runtimeFactory, "createRuntime").mockReturnValue(
      {} as ReturnType<typeof runtimeFactory.createRuntime>
    );
    const orchestrateForkSpy = spyOn(forkOrchestratorModule, "orchestrateFork").mockRejectedValue(
      new Error("runtime explosion")
    );

    try {
      const result = await minionService.fork(sourceMinionId, "fork-child");

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe("Failed to clone minion: runtime explosion");
      }

      expect(startInitMock).toHaveBeenCalledWith(newMinionId, sourceProjectPath);
      expect(endInitMock).toHaveBeenCalledWith(newMinionId, -1);

      const initAbortControllers = (
        minionService as unknown as { initAbortControllers: Map<string, AbortController> }
      ).initAbortControllers;
      expect(initAbortControllers.has(newMinionId)).toBe(false);
    } finally {
      orchestrateForkSpy.mockRestore();
      createRuntimeSpy.mockRestore();
      getOrCreateSessionSpy.mockRestore();
    }
  });
});

describe("MinionService interruptStream", () => {
  let historyService: HistoryService;
  let cleanupHistory: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService, cleanup: cleanupHistory } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanupHistory();
  });

  test("sendQueuedImmediately clears hard-interrupt suppression before queued resend", async () => {
    const minionId = "ws-interrupt-queue-111";

    const mockConfig: Partial<Config> = {
      srcDir: "/tmp/test",
      getSessionDir: mock(() => "/tmp/test/sessions"),
      generateStableId: mock(() => "test-id"),
      findMinion: mock(() => null),
    };

    const mockAIService: AIService = {
      isStreaming: mock(() => false),
      getMinionMetadata: mock(() => Promise.resolve({ success: false, error: "not found" })),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      on: mock(() => {}),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      off: mock(() => {}),
    } as unknown as AIService;

    const minionService = new MinionService(
      mockConfig as Config,
      historyService,
      mockAIService,
      mockInitStateManager as InitStateManager,
      mockExtensionMetadataService as ExtensionMetadataService,
      mockBackgroundProcessManager as BackgroundProcessManager
    );

    const resetAutoResumeCount = mock(() => undefined);
    const markParentMinionInterrupted = mock(() => undefined);
    const terminateAllDescendantAgentTasks = mock(() => Promise.resolve([] as string[]));
    minionService.setTaskService({
      resetAutoResumeCount,
      markParentMinionInterrupted,
      terminateAllDescendantAgentTasks,
    } as unknown as TaskService);

    const sendQueuedMessages = mock(() => undefined);
    const restoreQueueToInput = mock(() => undefined);
    const interruptStream = mock(() => Promise.resolve(Ok(undefined)));
    const fakeSession = {
      interruptStream,
      sendQueuedMessages,
      restoreQueueToInput,
    };
    const getOrCreateSessionSpy = spyOn(minionService, "getOrCreateSession").mockReturnValue(
      fakeSession as unknown as AgentSession
    );

    try {
      const result = await minionService.interruptStream(minionId, {
        sendQueuedImmediately: true,
      });

      expect(result.success).toBe(true);
      expect(markParentMinionInterrupted).toHaveBeenCalledWith(minionId);
      expect(terminateAllDescendantAgentTasks).toHaveBeenCalledWith(minionId);
      expect(resetAutoResumeCount).toHaveBeenCalledTimes(2);
      expect(sendQueuedMessages).toHaveBeenCalledTimes(1);
      expect(restoreQueueToInput).not.toHaveBeenCalled();
    } finally {
      getOrCreateSessionSpy.mockRestore();
    }
  });
});

// --- Pure helper tests (no mocks needed) ---

describe("generateForkBranchName", () => {
  test("returns -fork-1 when no existing forks", () => {
    expect(generateForkBranchName("sidebar-a1b2", [])).toBe("sidebar-a1b2-fork-1");
  });

  test("increments past the highest existing fork number", () => {
    expect(
      generateForkBranchName("sidebar-a1b2", [
        "sidebar-a1b2-fork-1",
        "sidebar-a1b2-fork-3",
        "other-minion",
      ])
    ).toBe("sidebar-a1b2-fork-4");
  });

  test("ignores non-matching minion names", () => {
    expect(
      generateForkBranchName("feature", ["feature-branch", "feature-impl", "other-fork-1"])
    ).toBe("feature-fork-1");
  });

  test("handles gaps in numbering", () => {
    expect(generateForkBranchName("ws", ["ws-fork-1", "ws-fork-5"])).toBe("ws-fork-6");
  });

  test("treats stale branch names as collisions when choosing next fork name", () => {
    expect(generateForkBranchName("ws", ["ws-fork-1", "ws-fork-2"])).toBe("ws-fork-3");
  });

  test("ignores non-numeric suffixes", () => {
    expect(generateForkBranchName("ws", ["ws-fork-abc", "ws-fork-"])).toBe("ws-fork-1");
  });

  test("ignores partially numeric suffixes", () => {
    expect(generateForkBranchName("ws", ["ws-fork-1abc", "ws-fork-02x", "ws-fork-3"])).toBe(
      "ws-fork-4"
    );
  });
});

describe("generateForkTitle", () => {
  test("returns (1) when no existing forks", () => {
    expect(generateForkTitle("Fix sidebar layout", [])).toBe("Fix sidebar layout (1)");
  });

  test("increments past the highest existing suffix", () => {
    expect(
      generateForkTitle("Fix sidebar layout", [
        "Fix sidebar layout",
        "Fix sidebar layout (1)",
        "Fix sidebar layout (3)",
      ])
    ).toBe("Fix sidebar layout (4)");
  });

  test("strips existing suffix from parent before computing base", () => {
    // Forking "Fix sidebar (2)" should produce "Fix sidebar (3)", not "Fix sidebar (2) (1)"
    expect(generateForkTitle("Fix sidebar (2)", ["Fix sidebar (1)", "Fix sidebar (2)"])).toBe(
      "Fix sidebar (3)"
    );
  });

  test("ignores non-matching titles", () => {
    expect(generateForkTitle("Refactor auth", ["Fix sidebar layout (1)", "Other task (2)"])).toBe(
      "Refactor auth (1)"
    );
  });

  test("handles gaps in numbering", () => {
    expect(generateForkTitle("Task", ["Task (1)", "Task (5)"])).toBe("Task (6)");
  });

  test("ignores non-numeric suffixes when selecting the next title number", () => {
    expect(generateForkTitle("Task", ["Task (2025 roadmap)", "Task (12abc)", "Task (2)"])).toBe(
      "Task (3)"
    );
  });
});
