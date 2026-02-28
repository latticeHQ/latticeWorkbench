import type { APIClient } from "@/browser/contexts/API";
import { ProjectProvider } from "@/browser/contexts/ProjectContext";
import type { DraftMinionSettings } from "@/browser/hooks/useDraftMinionSettings";
import {
  GLOBAL_SCOPE_ID,
  getAgentIdKey,
  getInputKey,
  getInputAttachmentsKey,
  getModelKey,
  getPendingScopeId,
  getPendingMinionSendErrorKey,
  getProjectScopeId,
  getThinkingLevelKey,
} from "@/common/constants/storage";
import type { MinionChatMessage } from "@/common/orpc/types";
import {
  LATTICE_RUNTIME_PLACEHOLDER,
  type LatticeMinionConfig,
  type ParsedRuntime,
} from "@/common/types/runtime";
import type { RuntimeChoice } from "@/browser/utils/runtimeUi";
import type {
  FrontendMinionMetadata,
  MinionActivitySnapshot,
} from "@/common/types/minion";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { GlobalWindow } from "happy-dom";
import { useCreationMinion, type CreationSendResult } from "./useCreationMinion";

const readPersistedStateCalls: Array<[string, unknown]> = [];
let persistedPreferences: Record<string, unknown> = {};
const readPersistedStateMock = mock((key: string, defaultValue: unknown) => {
  readPersistedStateCalls.push([key, defaultValue]);
  if (Object.prototype.hasOwnProperty.call(persistedPreferences, key)) {
    return persistedPreferences[key];
  }
  if (typeof window === "undefined" || !window.localStorage) {
    return defaultValue;
  }
  try {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue === null || storedValue === "undefined") {
      return defaultValue;
    }
    return JSON.parse(storedValue) as unknown;
  } catch {
    return defaultValue;
  }
});

const updatePersistedStateCalls: Array<[string, unknown]> = [];
const updatePersistedStateMock = mock((key: string, value: unknown) => {
  updatePersistedStateCalls.push([key, value]);
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  if (value === undefined || value === null) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
});

const readPersistedStringMock = mock((key: string) => {
  if (Object.prototype.hasOwnProperty.call(persistedPreferences, key)) {
    const value = persistedPreferences[key];
    return typeof value === "string" ? value : undefined;
  }
  if (typeof window === "undefined" || !window.localStorage) {
    return undefined;
  }
  const storedValue = window.localStorage.getItem(key);
  if (storedValue === null || storedValue === "undefined") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Fall through to raw string.
  }
  return storedValue;
});

void mock.module("@/browser/hooks/usePersistedState", () => ({
  readPersistedState: readPersistedStateMock,
  readPersistedString: readPersistedStringMock,
  updatePersistedState: updatePersistedStateMock,
}));

interface DraftSettingsInvocation {
  projectPath: string;
  branches: string[];
  recommendedTrunk: string | null;
}
let draftSettingsInvocations: DraftSettingsInvocation[] = [];
let draftSettingsState: DraftSettingsHarness;
const useDraftMinionSettingsMock = mock(
  (projectPath: string, branches: string[], recommendedTrunk: string | null) => {
    draftSettingsInvocations.push({ projectPath, branches, recommendedTrunk });
    if (!draftSettingsState) {
      throw new Error("Draft settings state not initialized");
    }
    return draftSettingsState.snapshot();
  }
);

void mock.module("@/browser/hooks/useDraftMinionSettings", () => ({
  useDraftMinionSettings: useDraftMinionSettingsMock,
}));

let currentORPCClient: MockOrpcClient | null = null;
const noop = () => undefined;
const routerState = {
  currentMinionId: null as string | null,
  currentProjectId: null as string | null,
  pendingDraftId: null as string | null,
};

void mock.module("@/browser/contexts/RouterContext", () => ({
  useRouter: () => ({
    navigateToMinion: noop,
    navigateToProject: noop,
    navigateToHome: noop,
    currentMinionId: routerState.currentMinionId,
    currentProjectId: routerState.currentProjectId,
    currentProjectPathFromState: null,
    pendingSectionId: null,
    pendingDraftId: routerState.pendingDraftId,
  }),
}));

void mock.module("@/browser/contexts/API", () => ({
  useAPI: () => {
    if (!currentORPCClient) {
      return { api: null, status: "connecting" as const, error: null };
    }
    return {
      api: currentORPCClient as APIClient,
      status: "connected" as const,
      error: null,
    };
  },
}));

const TEST_PROJECT_PATH = "/projects/demo";
const FALLBACK_BRANCH = "main";
const TEST_MINION_ID = "ws-created";
type BranchListResult = Awaited<ReturnType<APIClient["projects"]["listBranches"]>>;
type ListBranchesArgs = Parameters<APIClient["projects"]["listBranches"]>[0];
type MinionSendMessageArgs = Parameters<APIClient["minion"]["sendMessage"]>[0];
type MinionSendMessageResult = Awaited<ReturnType<APIClient["minion"]["sendMessage"]>>;
type MinionCreateArgs = Parameters<APIClient["minion"]["create"]>[0];
type MinionUpdateAgentAISettingsArgs = Parameters<
  APIClient["minion"]["updateAgentAISettings"]
>[0];
type MinionUpdateAgentAISettingsResult = Awaited<
  ReturnType<APIClient["minion"]["updateAgentAISettings"]>
>;
type MinionCreateResult = Awaited<ReturnType<APIClient["minion"]["create"]>>;
type NameGenerationArgs = Parameters<APIClient["nameGeneration"]["generate"]>[0];
type NameGenerationResult = Awaited<ReturnType<APIClient["nameGeneration"]["generate"]>>;
type MockOrpcProjectsClient = Pick<
  APIClient["projects"],
  "list" | "listBranches" | "runtimeAvailability"
>;
type MockOrpcMinionClient = Pick<
  APIClient["minion"],
  "sendMessage" | "create" | "updateAgentAISettings"
>;
type MockOrpcNameGenerationClient = Pick<APIClient["nameGeneration"], "generate">;
type WindowWithApi = Window & typeof globalThis;
type WindowApi = WindowWithApi["api"];

function rejectNotImplemented(method: string) {
  return (..._args: unknown[]): Promise<never> =>
    Promise.reject(new Error(`${method} is not implemented in useCreationMinion tests`));
}

function throwNotImplemented(method: string) {
  return (..._args: unknown[]): never => {
    throw new Error(`${method} is not implemented in useCreationMinion tests`);
  };
}

const noopUnsubscribe = () => () => undefined;
interface MockOrpcClient {
  projects: MockOrpcProjectsClient;
  minion: MockOrpcMinionClient;
  nameGeneration: MockOrpcNameGenerationClient;
}
interface SetupWindowOptions {
  listBranches?: ReturnType<typeof mock<(args: ListBranchesArgs) => Promise<BranchListResult>>>;
  sendMessage?: ReturnType<
    typeof mock<(args: MinionSendMessageArgs) => Promise<MinionSendMessageResult>>
  >;
  updateAgentAISettings?: ReturnType<
    typeof mock<
      (args: MinionUpdateAgentAISettingsArgs) => Promise<MinionUpdateAgentAISettingsResult>
    >
  >;
  create?: ReturnType<typeof mock<(args: MinionCreateArgs) => Promise<MinionCreateResult>>>;
  nameGeneration?: ReturnType<
    typeof mock<(args: NameGenerationArgs) => Promise<NameGenerationResult>>
  >;
}

const setupWindow = ({
  listBranches,
  sendMessage,
  create,
  updateAgentAISettings,
  nameGeneration,
}: SetupWindowOptions = {}) => {
  const listBranchesMock =
    listBranches ??
    mock<(args: ListBranchesArgs) => Promise<BranchListResult>>(({ projectPath }) => {
      if (!projectPath) {
        throw new Error("listBranches mock requires projectPath");
      }
      return Promise.resolve({
        branches: [FALLBACK_BRANCH],
        recommendedTrunk: FALLBACK_BRANCH,
      });
    });

  const sendMessageMock =
    sendMessage ??
    mock<(args: MinionSendMessageArgs) => Promise<MinionSendMessageResult>>(() => {
      const result: MinionSendMessageResult = {
        success: true,
        data: {},
      };
      return Promise.resolve(result);
    });

  const createMock =
    create ??
    mock<(args: MinionCreateArgs) => Promise<MinionCreateResult>>(() => {
      return Promise.resolve({
        success: true,
        metadata: TEST_METADATA,
      } as MinionCreateResult);
    });

  const updateAgentAISettingsMock =
    updateAgentAISettings ??
    mock<
      (args: MinionUpdateAgentAISettingsArgs) => Promise<MinionUpdateAgentAISettingsResult>
    >(() => {
      return Promise.resolve({
        success: true,
        data: undefined,
      } as MinionUpdateAgentAISettingsResult);
    });

  const nameGenerationMock =
    nameGeneration ??
    mock<(args: NameGenerationArgs) => Promise<NameGenerationResult>>(() => {
      return Promise.resolve({
        success: true,
        data: {
          name: "test-minion",
          modelUsed: "anthropic:claude-haiku-4-5",
        },
      } as NameGenerationResult);
    });

  currentORPCClient = {
    projects: {
      list: () => Promise.resolve([]),
      listBranches: (input: ListBranchesArgs) => listBranchesMock(input),
      runtimeAvailability: () =>
        Promise.resolve({
          local: { available: true },
          worktree: { available: true },
          ssh: { available: true },
          docker: { available: true },
          devcontainer: { available: false, reason: "No devcontainer.json found" },
        }),
    },
    minion: {
      sendMessage: (input: MinionSendMessageArgs) => sendMessageMock(input),
      create: (input: MinionCreateArgs) => createMock(input),
      updateAgentAISettings: (input: MinionUpdateAgentAISettingsArgs) =>
        updateAgentAISettingsMock(input),
    },
    nameGeneration: {
      generate: (input: NameGenerationArgs) => nameGenerationMock(input),
    },
  };

  const windowInstance = new GlobalWindow();
  globalThis.window = windowInstance as unknown as WindowWithApi;
  const windowWithApi = globalThis.window as WindowWithApi;

  const apiMock: WindowApi = {
    tokenizer: {
      countTokens: rejectNotImplemented("tokenizer.countTokens"),
      countTokensBatch: rejectNotImplemented("tokenizer.countTokensBatch"),
      calculateStats: rejectNotImplemented("tokenizer.calculateStats"),
    },
    providers: {
      setProviderConfig: rejectNotImplemented("providers.setProviderConfig"),
    },
    projects: {
      create: rejectNotImplemented("projects.create"),
      pickDirectory: rejectNotImplemented("projects.pickDirectory"),
      remove: rejectNotImplemented("projects.remove"),
      list: rejectNotImplemented("projects.list"),
      listBranches: (projectPath: string) => listBranchesMock({ projectPath }),
      secrets: {
        get: rejectNotImplemented("projects.secrets.get"),
        update: rejectNotImplemented("projects.secrets.update"),
      },
    },
    nameGeneration: {
      generate: (args: NameGenerationArgs) => nameGenerationMock(args),
    },
    minion: {
      list: rejectNotImplemented("minion.list"),
      create: (args: MinionCreateArgs) => createMock(args),
      updateAgentAISettings: (args: MinionUpdateAgentAISettingsArgs) =>
        updateAgentAISettingsMock(args),
      remove: rejectNotImplemented("minion.remove"),
      rename: rejectNotImplemented("minion.rename"),
      fork: rejectNotImplemented("minion.fork"),
      sendMessage: (
        minionId: MinionSendMessageArgs["minionId"],
        message: MinionSendMessageArgs["message"],
        options: MinionSendMessageArgs["options"]
      ) => sendMessageMock({ minionId, message, options }),
      resumeStream: rejectNotImplemented("minion.resumeStream"),
      interruptStream: rejectNotImplemented("minion.interruptStream"),
      clearQueue: rejectNotImplemented("minion.clearQueue"),
      truncateHistory: rejectNotImplemented("minion.truncateHistory"),
      replaceChatHistory: rejectNotImplemented("minion.replaceChatHistory"),
      getInfo: rejectNotImplemented("minion.getInfo"),
      executeBash: rejectNotImplemented("minion.executeBash"),
      openTerminal: rejectNotImplemented("minion.openTerminal"),
      onChat: (_minionId: string, _callback: (data: MinionChatMessage) => void) =>
        noopUnsubscribe(),
      onMetadata: (
        _callback: (data: { minionId: string; metadata: FrontendMinionMetadata }) => void
      ) => noopUnsubscribe(),
      activity: {
        list: rejectNotImplemented("minion.activity.list"),
        subscribe: (
          _callback: (payload: {
            minionId: string;
            activity: MinionActivitySnapshot | null;
          }) => void
        ) => noopUnsubscribe(),
      },
    },
    window: {
      setTitle: rejectNotImplemented("window.setTitle"),
    },
    terminal: {
      create: rejectNotImplemented("terminal.create"),
      close: rejectNotImplemented("terminal.close"),
      resize: rejectNotImplemented("terminal.resize"),
      sendInput: throwNotImplemented("terminal.sendInput"),
      onOutput: () => noopUnsubscribe(),
      onExit: () => noopUnsubscribe(),
      openWindow: rejectNotImplemented("terminal.openWindow"),
      closeWindow: rejectNotImplemented("terminal.closeWindow"),
    },
    update: {
      check: rejectNotImplemented("update.check"),
      download: rejectNotImplemented("update.download"),
      install: throwNotImplemented("update.install"),
      onStatus: () => noopUnsubscribe(),
    },
    platform: "linux",
    versions: {
      node: "0",
      chrome: "0",
      electron: "0",
    },
  };

  windowWithApi.api = apiMock;

  globalThis.document = windowInstance.document as unknown as Document;
  globalThis.localStorage = windowInstance.localStorage as unknown as Storage;

  return {
    projectsApi: { listBranches: listBranchesMock },
    minionApi: {
      sendMessage: sendMessageMock,
      create: createMock,
    },
    nameGenerationApi: { generate: nameGenerationMock },
  };
};
const TEST_METADATA: FrontendMinionMetadata = {
  id: TEST_MINION_ID,
  name: "demo-branch",
  projectName: "Demo",
  projectPath: TEST_PROJECT_PATH,
  namedMinionPath: "/worktrees/demo/demo-branch",
  runtimeConfig: { type: "local", srcBaseDir: "/home/user/.lattice/src" },
  createdAt: "2025-01-01T00:00:00.000Z",
};

describe("useCreationMinion", () => {
  beforeEach(() => {
    persistedPreferences = {};
    readPersistedStateCalls.length = 0;
    updatePersistedStateCalls.length = 0;
    draftSettingsInvocations = [];
    draftSettingsState = createDraftSettingsHarness();
  });

  afterEach(() => {
    cleanup();
    // Reset global window/document/localStorage between tests
    // @ts-expect-error - test cleanup
    globalThis.window = undefined;
    // @ts-expect-error - test cleanup
    globalThis.document = undefined;
    // @ts-expect-error - test cleanup
    globalThis.localStorage = undefined;
  });

  test("loads branches when projectPath is provided", async () => {
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main", "dev"],
          recommendedTrunk: "dev",
        })
    );
    const { projectsApi } = setupWindow({ listBranches: listBranchesMock });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
    });

    await waitFor(() => expect(projectsApi.listBranches.mock.calls.length).toBe(1));
    // ORPC uses object argument
    expect(projectsApi.listBranches.mock.calls[0][0]).toEqual({ projectPath: TEST_PROJECT_PATH });

    await waitFor(() => expect(getHook().branches).toEqual(["main", "dev"]));
    expect(draftSettingsInvocations[0]).toEqual({
      projectPath: TEST_PROJECT_PATH,
      branches: [],
      recommendedTrunk: null,
    });
    expect(draftSettingsInvocations.at(-1)).toEqual({
      projectPath: TEST_PROJECT_PATH,
      branches: ["main", "dev"],
      recommendedTrunk: "dev",
    });
    expect(getHook().trunkBranch).toBe(draftSettingsState.state.trunkBranch);
  });

  test("does not load branches when projectPath is empty", async () => {
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main"],
          recommendedTrunk: "main",
        })
    );
    setupWindow({ listBranches: listBranchesMock });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: "",
      onMinionCreated,
    });

    await waitFor(() => expect(draftSettingsInvocations.length).toBeGreaterThan(0));
    expect(listBranchesMock.mock.calls.length).toBe(0);
    expect(getHook().branches).toEqual([]);
  });

  test("handleSend creates minion and sends message on success", async () => {
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main"],
          recommendedTrunk: "main",
        })
    );
    const sendMessageMock = mock(
      (_args: MinionSendMessageArgs): Promise<MinionSendMessageResult> =>
        Promise.resolve({
          success: true as const,
          data: {},
        })
    );
    const createMock = mock(
      (_args: MinionCreateArgs): Promise<MinionCreateResult> =>
        Promise.resolve({
          success: true,
          metadata: TEST_METADATA,
        } as MinionCreateResult)
    );
    const nameGenerationMock = mock(
      (_args: NameGenerationArgs): Promise<NameGenerationResult> =>
        Promise.resolve({
          success: true,
          data: { name: "generated-name", modelUsed: "anthropic:claude-haiku-4-5" },
        } as NameGenerationResult)
    );
    const { minionApi, nameGenerationApi } = setupWindow({
      listBranches: listBranchesMock,
      sendMessage: sendMessageMock,
      create: createMock,
      nameGeneration: nameGenerationMock,
    });

    persistedPreferences[getAgentIdKey(getProjectScopeId(TEST_PROJECT_PATH))] = "plan";
    // Set model preference for the project scope (read by getSendOptionsFromStorage)
    persistedPreferences[getModelKey(getProjectScopeId(TEST_PROJECT_PATH))] = "gpt-4";

    draftSettingsState = createDraftSettingsHarness({
      selectedRuntime: { mode: "ssh", host: "example.com" },
      runtimeString: "ssh example.com",
      trunkBranch: "dev",
    });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
      message: "launch minion",
    });

    await waitFor(() => expect(getHook().branches).toEqual(["main"]));

    // Wait for name generation to trigger (happens on debounce)
    await waitFor(() => expect(nameGenerationApi.generate.mock.calls.length).toBe(1));

    let handleSendResult: CreationSendResult | undefined;
    await act(async () => {
      handleSendResult = await getHook().handleSend("launch minion");
    });

    expect(handleSendResult).toEqual({ success: true });

    // minion.create should be called with the generated name
    expect(minionApi.create.mock.calls.length).toBe(1);
    const createCall = minionApi.create.mock.calls[0];
    if (!createCall) {
      throw new Error("Expected minion.create to be called at least once");
    }
    const [createRequest] = createCall;
    expect(createRequest?.branchName).toBe("generated-name");
    expect(createRequest?.trunkBranch).toBe("dev");
    expect(createRequest?.runtimeConfig).toEqual({
      type: "ssh",
      host: "example.com",
      srcBaseDir: "~/lattice",
    });

    // minion.sendMessage should be called with the created minion ID
    expect(minionApi.sendMessage.mock.calls.length).toBe(1);
    const sendCall = minionApi.sendMessage.mock.calls[0];
    if (!sendCall) {
      throw new Error("Expected minion.sendMessage to be called at least once");
    }
    const [sendRequest] = sendCall;
    expect(sendRequest?.minionId).toBe(TEST_MINION_ID);
    expect(sendRequest?.message).toBe("launch minion");

    await waitFor(() => expect(onMinionCreated.mock.calls.length).toBe(1));
    expect(onMinionCreated.mock.calls[0][0]).toEqual(TEST_METADATA);

    const pendingScopeId = getPendingScopeId(TEST_PROJECT_PATH);
    const pendingInputKey = getInputKey(pendingScopeId);
    const pendingImagesKey = getInputAttachmentsKey(pendingScopeId);
    // Thinking is minion-scoped, but this test doesn't set a project-scoped thinking preference.
    expect(updatePersistedStateCalls).toContainEqual([pendingInputKey, ""]);
    expect(updatePersistedStateCalls).toContainEqual([pendingImagesKey, undefined]);
  });

  test("syncs global default agent to minion when project agent is unset", async () => {
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main"],
          recommendedTrunk: "main",
        })
    );
    const sendMessageMock = mock(
      (_args: MinionSendMessageArgs): Promise<MinionSendMessageResult> =>
        Promise.resolve({
          success: true as const,
          data: {},
        })
    );
    const createMock = mock(
      (_args: MinionCreateArgs): Promise<MinionCreateResult> =>
        Promise.resolve({
          success: true,
          metadata: TEST_METADATA,
        } as MinionCreateResult)
    );
    const nameGenerationMock = mock(
      (_args: NameGenerationArgs): Promise<NameGenerationResult> =>
        Promise.resolve({
          success: true,
          data: { name: "generated-name", modelUsed: "anthropic:claude-haiku-4-5" },
        } as NameGenerationResult)
    );
    setupWindow({
      listBranches: listBranchesMock,
      sendMessage: sendMessageMock,
      create: createMock,
      nameGeneration: nameGenerationMock,
    });

    persistedPreferences[getAgentIdKey(GLOBAL_SCOPE_ID)] = "ask";
    persistedPreferences[getModelKey(getProjectScopeId(TEST_PROJECT_PATH))] = "gpt-4";

    draftSettingsState = createDraftSettingsHarness({
      selectedRuntime: { mode: "ssh", host: "example.com" },
      runtimeString: "ssh example.com",
      trunkBranch: "dev",
      agentId: "ask",
    });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
      message: "launch minion",
    });

    await waitFor(() => expect(getHook().branches).toEqual(["main"]));
    await waitFor(() => expect(nameGenerationMock.mock.calls.length).toBe(1));

    let handleSendResult: CreationSendResult | undefined;
    await act(async () => {
      handleSendResult = await getHook().handleSend("launch minion");
    });

    expect(handleSendResult).toEqual({ success: true });
    expect(updatePersistedStateCalls).toContainEqual([getAgentIdKey(TEST_MINION_ID), "ask"]);

    const sendCall = sendMessageMock.mock.calls[0];
    if (!sendCall) {
      throw new Error("Expected minion.sendMessage to be called at least once");
    }
    const [sendRequest] = sendCall;
    expect(sendRequest?.options?.agentId).toBe("ask");
  });

  test("handleSend returns failure when sendMessage fails and clears draft", async () => {
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main"],
          recommendedTrunk: "main",
        })
    );
    const sendError = { type: "api_key_not_found", provider: "openai" } as const;
    const sendMessageMock = mock(
      (_args: MinionSendMessageArgs): Promise<MinionSendMessageResult> =>
        Promise.resolve({
          success: false,
          error: sendError,
        } as MinionSendMessageResult)
    );
    const createMock = mock(
      (_args: MinionCreateArgs): Promise<MinionCreateResult> =>
        Promise.resolve({
          success: true,
          metadata: TEST_METADATA,
        } as MinionCreateResult)
    );
    const nameGenerationMock = mock(
      (_args: NameGenerationArgs): Promise<NameGenerationResult> =>
        Promise.resolve({
          success: true,
          data: { name: "generated-name", modelUsed: "anthropic:claude-haiku-4-5" },
        } as NameGenerationResult)
    );
    setupWindow({
      listBranches: listBranchesMock,
      sendMessage: sendMessageMock,
      create: createMock,
      nameGeneration: nameGenerationMock,
    });

    draftSettingsState = createDraftSettingsHarness({ trunkBranch: "main" });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
      message: "test message",
    });

    await waitFor(() => expect(getHook().branches).toEqual(["main"]));

    let handleSendResult: CreationSendResult | undefined;
    await act(async () => {
      handleSendResult = await getHook().handleSend("test message");
    });

    expect(handleSendResult).toEqual({ success: false, error: sendError });
    expect(onMinionCreated.mock.calls.length).toBe(1);

    const pendingScopeId = getPendingScopeId(TEST_PROJECT_PATH);
    const pendingInputKey = getInputKey(pendingScopeId);
    const pendingImagesKey = getInputAttachmentsKey(pendingScopeId);
    const pendingErrorKey = getPendingMinionSendErrorKey(TEST_MINION_ID);
    expect(updatePersistedStateCalls).toContainEqual([pendingInputKey, ""]);
    expect(updatePersistedStateCalls).toContainEqual([pendingImagesKey, undefined]);
    expect(updatePersistedStateCalls).toContainEqual([pendingErrorKey, sendError]);
  });
  test("onMinionCreated is called before sendMessage resolves (no blocking)", async () => {
    // This test ensures we don't regress #1146 - the fix that makes minion creation
    // navigate immediately without waiting for sendMessage to complete.
    // Regression occurred in #1896 when sendMessage became awaited again.
    const listBranchesMock = mock(
      (): Promise<BranchListResult> =>
        Promise.resolve({
          branches: ["main"],
          recommendedTrunk: "main",
        })
    );
    let resolveSend!: (result: MinionSendMessageResult) => void;
    const sendMessageMock = mock(
      (_args: MinionSendMessageArgs): Promise<MinionSendMessageResult> =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    const createMock = mock(
      (_args: MinionCreateArgs): Promise<MinionCreateResult> =>
        Promise.resolve({
          success: true,
          metadata: TEST_METADATA,
        } as MinionCreateResult)
    );
    const nameGenerationMock = mock(
      (_args: NameGenerationArgs): Promise<NameGenerationResult> =>
        Promise.resolve({
          success: true,
          data: { name: "generated-name", modelUsed: "anthropic:claude-haiku-4-5" },
        } as NameGenerationResult)
    );
    setupWindow({
      listBranches: listBranchesMock,
      sendMessage: sendMessageMock,
      create: createMock,
      nameGeneration: nameGenerationMock,
    });

    draftSettingsState = createDraftSettingsHarness({ trunkBranch: "main" });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
      message: "test message",
    });

    await waitFor(() => expect(getHook().branches).toEqual(["main"]));

    let handleSendPromise!: Promise<CreationSendResult>;
    act(() => {
      handleSendPromise = getHook().handleSend("test message");
    });

    await waitFor(() => expect(onMinionCreated.mock.calls.length).toBe(1));
    expect(onMinionCreated.mock.calls[0][0]).toEqual(TEST_METADATA);

    resolveSend({ success: true, data: {} });
    const handleSendResult = await handleSendPromise;
    expect(handleSendResult).toEqual({ success: true });
  });

  test("handleSend surfaces backend errors and resets state", async () => {
    const createMock = mock(
      (_args: MinionCreateArgs): Promise<MinionCreateResult> =>
        Promise.resolve({
          success: false,
          error: "backend exploded",
        } as MinionCreateResult)
    );
    const nameGenerationMock = mock(
      (_args: NameGenerationArgs): Promise<NameGenerationResult> =>
        Promise.resolve({
          success: true,
          data: { name: "test-name", modelUsed: "anthropic:claude-haiku-4-5" },
        } as NameGenerationResult)
    );
    const { minionApi, nameGenerationApi } = setupWindow({
      create: createMock,
      nameGeneration: nameGenerationMock,
    });
    draftSettingsState = createDraftSettingsHarness({ trunkBranch: "dev" });
    const onMinionCreated = mock((metadata: FrontendMinionMetadata) => metadata);

    const getHook = renderUseCreationMinion({
      projectPath: TEST_PROJECT_PATH,
      onMinionCreated,
      message: "make minion",
    });

    // Wait for name generation to trigger
    await waitFor(() => expect(nameGenerationApi.generate.mock.calls.length).toBe(1));

    await act(async () => {
      await getHook().handleSend("make minion");
    });

    expect(minionApi.create.mock.calls.length).toBe(1);
    expect(onMinionCreated.mock.calls.length).toBe(0);
    await waitFor(() => expect(getHook().toast?.message).toBe("backend exploded"));
    await waitFor(() => expect(getHook().isSending).toBe(false));

    // Side effect: send-options reader may migrate thinking level into the project scope.
    const thinkingKey = getThinkingLevelKey(getProjectScopeId(TEST_PROJECT_PATH));
    if (updatePersistedStateCalls.length > 0) {
      expect(updatePersistedStateCalls).toEqual([[thinkingKey, "off"]]);
    }
  });
});

type DraftSettingsHarness = ReturnType<typeof createDraftSettingsHarness>;

function createDraftSettingsHarness(
  initial?: Partial<{
    selectedRuntime: ParsedRuntime;
    trunkBranch: string;
    runtimeString?: string | undefined;
    defaultRuntimeMode?: RuntimeChoice;
    agentId?: string;
    latticeConfigFallback?: LatticeMinionConfig;
    sshHostFallback?: string;
  }>
) {
  const state = {
    selectedRuntime: initial?.selectedRuntime ?? { mode: "local" as const },
    defaultRuntimeMode: initial?.defaultRuntimeMode ?? "worktree",
    agentId: initial?.agentId ?? "exec",
    trunkBranch: initial?.trunkBranch ?? "main",
    runtimeString: initial?.runtimeString,
    latticeConfigFallback: initial?.latticeConfigFallback ?? { existingMinion: false },
    sshHostFallback: initial?.sshHostFallback ?? "",
  } satisfies {
    selectedRuntime: ParsedRuntime;
    defaultRuntimeMode: RuntimeChoice;
    agentId: string;
    trunkBranch: string;
    runtimeString: string | undefined;
    latticeConfigFallback: LatticeMinionConfig;
    sshHostFallback: string;
  };

  const setTrunkBranch = mock((branch: string) => {
    state.trunkBranch = branch;
  });

  const getRuntimeString = mock(() => state.runtimeString);

  const setSelectedRuntime = mock((runtime: ParsedRuntime) => {
    state.selectedRuntime = runtime;
    if (runtime.mode === "ssh") {
      state.runtimeString = runtime.host ? `ssh ${runtime.host}` : "ssh";
    } else if (runtime.mode === "docker") {
      state.runtimeString = runtime.image ? `docker ${runtime.image}` : "docker";
    } else {
      state.runtimeString = undefined;
    }
  });

  const setDefaultRuntimeChoice = mock((choice: RuntimeChoice) => {
    state.defaultRuntimeMode = choice;
    // Update selected runtime to match new default
    if (choice === "lattice") {
      state.selectedRuntime = {
        mode: "ssh",
        host: LATTICE_RUNTIME_PLACEHOLDER,
        lattice: { existingMinion: false },
      };
      state.runtimeString = `ssh ${LATTICE_RUNTIME_PLACEHOLDER}`;
      return;
    }
    if (choice === "ssh") {
      const host = state.selectedRuntime.mode === "ssh" ? state.selectedRuntime.host : "";
      state.selectedRuntime = { mode: "ssh", host };
      state.runtimeString = host ? `ssh ${host}` : "ssh";
    } else if (choice === "docker") {
      const image = state.selectedRuntime.mode === "docker" ? state.selectedRuntime.image : "";
      state.selectedRuntime = { mode: "docker", image };
      state.runtimeString = image ? `docker ${image}` : "docker";
    } else if (choice === "local") {
      state.selectedRuntime = { mode: "local" };
      state.runtimeString = undefined;
    } else {
      state.selectedRuntime = { mode: "worktree" };
      state.runtimeString = undefined;
    }
  });

  return {
    state,
    setSelectedRuntime,
    setDefaultRuntimeChoice,
    setTrunkBranch,
    getRuntimeString,
    snapshot(): {
      settings: DraftMinionSettings;
      latticeConfigFallback: LatticeMinionConfig;
      sshHostFallback: string;
      setSelectedRuntime: typeof setSelectedRuntime;
      setDefaultRuntimeChoice: typeof setDefaultRuntimeChoice;
      setTrunkBranch: typeof setTrunkBranch;
      getRuntimeString: typeof getRuntimeString;
    } {
      const settings: DraftMinionSettings = {
        model: "gpt-4",
        thinkingLevel: "medium",
        agentId: state.agentId,
        selectedRuntime: state.selectedRuntime,
        defaultRuntimeMode: state.defaultRuntimeMode,
        trunkBranch: state.trunkBranch,
      };
      return {
        settings,
        latticeConfigFallback: state.latticeConfigFallback,
        sshHostFallback: state.sshHostFallback,
        setSelectedRuntime,
        setDefaultRuntimeChoice,
        setTrunkBranch,
        getRuntimeString,
      };
    },
  };
}

interface HookOptions {
  projectPath: string;
  onMinionCreated: (metadata: FrontendMinionMetadata) => void;
  message?: string;
}

function renderUseCreationMinion(options: HookOptions) {
  const resultRef: {
    current: ReturnType<typeof useCreationMinion> | null;
  } = { current: null };

  function Harness(props: HookOptions) {
    resultRef.current = useCreationMinion({
      ...props,
      message: props.message ?? "",
    });
    return null;
  }

  render(
    <ProjectProvider>
      <Harness {...options} />
    </ProjectProvider>
  );

  return () => {
    if (!resultRef.current) {
      throw new Error("Hook result not initialized");
    }
    return resultRef.current;
  };
}
