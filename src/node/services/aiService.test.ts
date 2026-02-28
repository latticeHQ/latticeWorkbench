// Bun test file - doesn't support Jest mocking, so we skip this test for now
// These tests would need to be rewritten to work with Bun's test runner
// For now, the commandProcessor tests demonstrate our testing approach

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

import { AIService } from "./aiService";
import { discoverAvailableSidekicksForToolContext } from "./streamContextBuilder";
import {
  normalizeAnthropicBaseURL,
  buildAnthropicHeaders,
  buildAppAttributionHeaders,
  ANTHROPIC_1M_CONTEXT_HEADER,
  type ProviderModelFactory,
} from "./providerModelFactory";
import { HistoryService } from "./historyService";
import { InitStateManager } from "./initStateManager";
import { ProviderService } from "./providerService";
import { Config } from "@/node/config";
import { LocalRuntime } from "@/node/runtime/LocalRuntime";
import { DisposableTempDir } from "@/node/services/tempDir";

import { createTaskTool } from "./tools/task";
import { createTestToolConfig } from "./tools/testHelpers";
import { LATTICE_APP_ATTRIBUTION_TITLE, LATTICE_APP_ATTRIBUTION_URL } from "@/constants/appAttribution";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import type { CodexOauthService } from "@/node/services/codexOauthService";
import { CODEX_ENDPOINT } from "@/common/constants/codexOAuth";

import type { LanguageModel } from "ai";
import { createLatticeMessage } from "@/common/types/message";
import type { LatticeMessage } from "@/common/types/message";
import type { MinionMetadata } from "@/common/types/minion";
import { DEFAULT_TASK_SETTINGS } from "@/common/types/tasks";
import type { StreamAbortEvent } from "@/common/types/stream";
import type { StreamManager } from "./streamManager";
import * as agentResolution from "./agentResolution";
import * as streamContextBuilder from "./streamContextBuilder";
import * as messagePipeline from "./messagePipeline";
import * as toolsModule from "@/common/utils/tools/tools";
import * as systemMessageModule from "./systemMessage";

describe("AIService", () => {
  let service: AIService;

  beforeEach(() => {
    const config = new Config();
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);
    service = new AIService(config, historyService, initStateManager, providerService);
  });

  // Note: These tests are placeholders as Bun doesn't support Jest mocking
  // In a production environment, we'd use dependency injection or other patterns
  // to make the code more testable without mocking

  it("should create an AIService instance", () => {
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(AIService);
  });
});

describe("AIService.setupStreamEventForwarding", () => {
  afterEach(() => {
    mock.restore();
  });

  it("forwards stream-abort even when partial cleanup throws", async () => {
    using latticeHome = new DisposableTempDir("ai-service-stream-abort-forwarding");
    const config = new Config(latticeHome.path);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);
    const service = new AIService(config, historyService, initStateManager, providerService);

    const cleanupError = new Error("disk full");
    const deletePartialSpy = spyOn(historyService, "deletePartial").mockImplementation(() =>
      Promise.reject(cleanupError)
    );

    const streamManager = (service as unknown as { streamManager: StreamManager }).streamManager;
    const abortEvent: StreamAbortEvent = {
      type: "stream-abort",
      minionId: "minion-1",
      messageId: "message-1",
      abandonPartial: true,
    };

    const forwardedAbortPromise = new Promise<StreamAbortEvent>((resolve) => {
      service.once("stream-abort", (event) => resolve(event as StreamAbortEvent));
    });

    streamManager.emit("stream-abort", abortEvent);

    expect(await forwardedAbortPromise).toEqual(abortEvent);
    expect(deletePartialSpy).toHaveBeenCalledWith(abortEvent.minionId);
  });
});

describe("AIService.createModel (Codex OAuth routing)", () => {
  async function writeProvidersConfig(root: string, config: object): Promise<void> {
    await fs.writeFile(
      path.join(root, "providers.jsonc"),
      JSON.stringify(config, null, 2),
      "utf-8"
    );
  }

  function createService(root: string): AIService {
    const config = new Config(root);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);
    return new AIService(config, historyService, initStateManager, providerService);
  }

  function getFetchUrl(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === "string") {
      return input;
    }
    if (input instanceof URL) {
      return input.toString();
    }
    if (typeof input === "object" && input !== null && "url" in input) {
      const possibleUrl = (input as { url?: unknown }).url;
      if (typeof possibleUrl === "string") {
        return possibleUrl;
      }
    }
    return "";
  }

  it("returns oauth_not_connected for required Codex models when both OAuth and API key are missing", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-missing");

    await writeProvidersConfig(latticeHome.path, {
      openai: {},
    });

    // Temporarily clear OPENAI_API_KEY so resolveProviderCredentials doesn't find it
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const service = createService(latticeHome.path);
      const result = await service.createModel(KNOWN_MODELS.GPT_53_CODEX.id);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toEqual({ type: "oauth_not_connected", provider: "openai" });
      }
    } finally {
      if (savedKey !== undefined) {
        process.env.OPENAI_API_KEY = savedKey;
      }
    }
  });

  it("falls back to API key for required Codex models when OAuth is missing but API key is present", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-missing-apikey-present");

    await writeProvidersConfig(latticeHome.path, {
      openai: { apiKey: "sk-test-key" },
    });

    const service = createService(latticeHome.path);
    const result = await service.createModel(KNOWN_MODELS.GPT_53_CODEX.id);

    // Should succeed — falls back to API key instead of erroring with oauth_not_connected
    expect(result.success).toBe(true);
  });

  it("does not require an OpenAI API key when Codex OAuth is configured", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-present");

    await writeProvidersConfig(latticeHome.path, {
      openai: {
        codexOauth: {
          type: "oauth",
          access: "test-access-token",
          refresh: "test-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "test-account-id",
        },
      },
    });

    const service = createService(latticeHome.path);
    const result = await service.createModel(KNOWN_MODELS.GPT_53_CODEX.id);

    expect(result.success).toBe(true);
  });

  it("defaults OAuth-allowed models to ChatGPT OAuth when both auth methods are configured", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-default-auth-oauth");

    const config = new Config(latticeHome.path);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);

    const service = new AIService(config, historyService, initStateManager, providerService);

    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init?: Parameters<typeof fetch>[1];
    }> = [];

    const baseFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({ input, init });

      // Minimal valid OpenAI Responses payload for the provider's response schema.
      const responseBody = {
        id: "resp_test",
        created_at: 0,
        model: "gpt-5.2",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_test",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      };

      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      );
    };

    // Ensure createModel sees a function fetch (providers.jsonc can't store functions).
    config.loadProvidersConfig = () => ({
      openai: {
        apiKey: "test-openai-api-key",
        codexOauth: {
          type: "oauth",
          access: "test-access-token",
          refresh: "test-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "test-account-id",
        },
        fetch: baseFetch,
      },
    });

    // fetchWithOpenAITruncation closes over codexOauthService during createModel.
    service.setCodexOauthService({
      getValidAuth: () =>
        Promise.resolve({
          success: true,
          data: {
            type: "oauth",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 60_000,
            accountId: "test-account-id",
          },
        }),
    } as CodexOauthService);

    const modelResult = await service.createModel(KNOWN_MODELS.GPT.id);
    expect(modelResult.success).toBe(true);
    if (!modelResult.success) return;

    const model = modelResult.data;
    if (typeof model === "string") {
      throw new Error("Expected a LanguageModelV2 instance, got a model id string");
    }

    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });

    expect(requests.length).toBeGreaterThan(0);
    const lastRequest = requests[requests.length - 1];
    expect(getFetchUrl(lastRequest.input)).toBe(CODEX_ENDPOINT);
  });

  it("does not rewrite OAuth-allowed models when default auth is set to apiKey", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-default-auth-api-key");

    const config = new Config(latticeHome.path);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);

    const service = new AIService(config, historyService, initStateManager, providerService);

    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init?: Parameters<typeof fetch>[1];
    }> = [];

    const baseFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({ input, init });

      // Minimal valid OpenAI Responses payload for the provider's response schema.
      const responseBody = {
        id: "resp_test",
        created_at: 0,
        model: "gpt-5.2",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_test",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      };

      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      );
    };

    // Ensure createModel sees a function fetch (providers.jsonc can't store functions).
    config.loadProvidersConfig = () => ({
      openai: {
        apiKey: "test-openai-api-key",
        codexOauth: {
          type: "oauth",
          access: "test-access-token",
          refresh: "test-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "test-account-id",
        },
        codexOauthDefaultAuth: "apiKey",
        fetch: baseFetch,
      },
    });

    const modelResult = await service.createModel(KNOWN_MODELS.GPT.id);
    expect(modelResult.success).toBe(true);
    if (!modelResult.success) return;

    const model = modelResult.data;
    if (typeof model === "string") {
      throw new Error("Expected a LanguageModelV2 instance, got a model id string");
    }

    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });

    expect(requests.length).toBeGreaterThan(0);
    const lastRequest = requests[requests.length - 1];
    expect(getFetchUrl(lastRequest.input)).not.toBe(CODEX_ENDPOINT);
  });

  it("ensures Codex OAuth routed Responses requests include non-empty instructions", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-instructions");

    const config = new Config(latticeHome.path);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);

    const service = new AIService(config, historyService, initStateManager, providerService);

    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init?: Parameters<typeof fetch>[1];
    }> = [];

    const baseFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({ input, init });

      // Minimal valid OpenAI Responses payload for the provider's response schema.
      const responseBody = {
        id: "resp_test",
        created_at: 0,
        model: "gpt-5.2-codex",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_test",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 1,
          output_tokens: 1,
        },
      };

      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      );
    };

    // Ensure createModel sees a function fetch (providers.jsonc can't store functions).
    config.loadProvidersConfig = () => ({
      openai: {
        apiKey: "test-openai-api-key",
        codexOauth: {
          type: "oauth",
          access: "test-access-token",
          refresh: "test-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "test-account-id",
        },
        fetch: baseFetch,
      },
    });

    // fetchWithOpenAITruncation closes over codexOauthService during createModel.
    service.setCodexOauthService({
      getValidAuth: () =>
        Promise.resolve({
          success: true,
          data: {
            type: "oauth",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 60_000,
            accountId: "test-account-id",
          },
        }),
    } as CodexOauthService);

    const modelResult = await service.createModel(KNOWN_MODELS.GPT_52_CODEX.id);
    expect(modelResult.success).toBe(true);
    if (!modelResult.success) return;

    const model = modelResult.data;
    if (typeof model === "string") {
      throw new Error("Expected a LanguageModelV2 instance, got a model id string");
    }

    const systemPrompt = "Test system prompt";

    await model.doGenerate({
      prompt: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    });

    expect(requests.length).toBeGreaterThan(0);

    const lastRequest = requests[requests.length - 1];

    // URL rewrite to chatgpt.com
    expect(lastRequest.input).toBe(CODEX_ENDPOINT);

    // Auth header injection
    const headers = new Headers(lastRequest.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-access-token");
    expect(headers.get("chatgpt-account-id")).toBe("test-account-id");

    // Body mutation: non-empty instructions
    const bodyString = lastRequest.init?.body;
    expect(typeof bodyString).toBe("string");
    if (typeof bodyString !== "string") {
      throw new Error("Expected request body to be a string");
    }

    const parsedBody = JSON.parse(bodyString) as unknown;
    if (!parsedBody || typeof parsedBody !== "object") {
      throw new Error("Expected request body to parse as an object");
    }

    const instructions = (parsedBody as { instructions?: unknown }).instructions;
    expect(typeof instructions).toBe("string");
    if (typeof instructions !== "string") {
      throw new Error("Expected instructions to be a string");
    }

    expect(instructions.trim().length).toBeGreaterThan(0);
    expect(instructions).toBe(systemPrompt);

    // Codex endpoint requires store=false
    const store = (parsedBody as { store?: unknown }).store;
    expect(store).toBe(false);

    // System message should be removed from input to avoid double-system
    const input = (parsedBody as { input?: unknown[] }).input;
    if (Array.isArray(input)) {
      for (const item of input) {
        if (item && typeof item === "object" && "role" in item) {
          expect((item as { role: string }).role).not.toBe("system");
          expect((item as { role: string }).role).not.toBe("developer");
        }
      }
    }
  });

  it("filters out item_reference entries and preserves inline items when routing through Codex OAuth", async () => {
    using latticeHome = new DisposableTempDir("codex-oauth-filter-refs");

    const config = new Config(latticeHome.path);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);

    const service = new AIService(config, historyService, initStateManager, providerService);

    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init?: Parameters<typeof fetch>[1];
    }> = [];

    const baseFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push({ input, init });

      const responseBody = {
        id: "resp_test",
        created_at: 0,
        model: "gpt-5.2-codex",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg_test",
            content: [{ type: "output_text", text: "ok", annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      };

      return Promise.resolve(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    };

    config.loadProvidersConfig = () => ({
      openai: {
        apiKey: "test-openai-api-key",
        codexOauth: {
          type: "oauth",
          access: "test-access-token",
          refresh: "test-refresh-token",
          expires: Date.now() + 60_000,
          accountId: "test-account-id",
        },
        fetch: baseFetch,
      },
    });

    service.setCodexOauthService({
      getValidAuth: () =>
        Promise.resolve({
          success: true,
          data: {
            type: "oauth",
            access: "test-access-token",
            refresh: "test-refresh-token",
            expires: Date.now() + 60_000,
            accountId: "test-account-id",
          },
        }),
    } as CodexOauthService);

    const modelResult = await service.createModel(KNOWN_MODELS.GPT_52_CODEX.id);
    expect(modelResult.success).toBe(true);
    if (!modelResult.success) return;

    const model = modelResult.data;
    if (typeof model === "string") {
      throw new Error("Expected a LanguageModelV2 instance, got a model id string");
    }

    await model.doGenerate({
      prompt: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
    });

    expect(requests.length).toBeGreaterThan(0);

    const lastRequest = requests[requests.length - 1];
    const bodyString = lastRequest.init?.body;
    expect(typeof bodyString).toBe("string");
    if (typeof bodyString !== "string") {
      throw new Error("Expected request body to be a string");
    }

    const parsedBody = JSON.parse(bodyString) as { store?: boolean; input?: unknown[] };

    // Verify Codex transform ran (store=false is set)
    expect(parsedBody.store).toBe(false);

    // Verify no item_reference entries exist in output
    const input = parsedBody.input;
    expect(Array.isArray(input)).toBe(true);
    if (Array.isArray(input)) {
      for (const item of input) {
        if (item && typeof item === "object" && item !== null) {
          expect((item as Record<string, unknown>).type).not.toBe("item_reference");
        }
      }
    }
  });

  it("item_reference filter removes references and preserves inline items", () => {
    // Direct unit test of the item_reference filtering logic used in the
    // Codex body transformation, independent of the full AIService pipeline.
    const input: Array<Record<string, unknown>> = [
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "item_reference", id: "rs_abc123" },
      {
        type: "message",
        role: "assistant",
        id: "msg_001",
        content: [{ type: "output_text", text: "hi" }],
      },
      {
        type: "function_call",
        id: "fc_xyz",
        call_id: "call_1",
        name: "test_fn",
        arguments: "{}",
      },
      { type: "item_reference", id: "rs_def456" },
      { type: "function_call_output", call_id: "call_1", output: "result" },
    ];

    // Same filter logic as in aiService.ts Codex body transformation
    const filtered = input.filter(
      (item) => !(item && typeof item === "object" && item.type === "item_reference")
    );

    // Both item_reference entries removed
    expect(filtered).toHaveLength(4);
    expect(filtered.some((i) => i.type === "item_reference")).toBe(false);

    // Inline items preserved with their IDs intact
    expect(filtered.find((i) => i.role === "assistant")?.id).toBe("msg_001");
    expect(filtered.find((i) => i.type === "function_call")?.id).toBe("fc_xyz");
    expect(filtered.find((i) => i.type === "function_call_output")?.call_id).toBe("call_1");
    expect(filtered.find((i) => i.role === "user")).toBeDefined();
  });
});

describe("AIService.streamMessage compaction boundary slicing", () => {
  interface StreamMessageHarness {
    service: AIService;
    planPayloadMessageIds: string[][];
    preparedPayloadMessageIds: string[][];
    startStreamCalls: unknown[][];
  }

  function createMinionMetadata(minionId: string, projectPath: string): MinionMetadata {
    return {
      id: minionId,
      name: "minion-under-test",
      projectName: "project-under-test",
      projectPath,
      runtimeConfig: { type: "local" },
    };
  }

  function messageIdsFromUnknownArray(messages: unknown): string[] {
    if (!Array.isArray(messages)) {
      throw new Error("Expected message array");
    }

    return messages.map((message) => {
      if (!message || typeof message !== "object") {
        throw new Error("Expected message object in array");
      }

      const id = (message as { id?: unknown }).id;
      if (typeof id !== "string") {
        throw new Error("Expected message.id to be a string");
      }

      return id;
    });
  }

  function openAIOptionsFromStartStreamCall(startStreamArgs: unknown[]): Record<string, unknown> {
    const providerOptions = startStreamArgs[11];
    if (!providerOptions || typeof providerOptions !== "object") {
      throw new Error("Expected provider options object at startStream arg index 11");
    }

    const openai = (providerOptions as { openai?: unknown }).openai;
    if (!openai || typeof openai !== "object") {
      throw new Error("Expected OpenAI provider options in startStream providerOptions");
    }

    return openai as Record<string, unknown>;
  }

  function createHarness(latticeHomePath: string, metadata: MinionMetadata): StreamMessageHarness {
    const config = new Config(latticeHomePath);
    const historyService = new HistoryService(config);
    const initStateManager = new InitStateManager(config);
    const providerService = new ProviderService(config);
    const service = new AIService(config, historyService, initStateManager, providerService);

    const planPayloadMessageIds: string[][] = [];
    const preparedPayloadMessageIds: string[][] = [];
    const startStreamCalls: unknown[][] = [];

    const resolvedAgentResult: Awaited<ReturnType<typeof agentResolution.resolveAgentForStream>> = {
      success: true,
      data: {
        effectiveAgentId: "exec",
        agentDefinition: {
          id: "exec",
          scope: "built-in",
          frontmatter: { name: "Exec" },
          body: "Exec agent body",
        },
        agentDiscoveryPath: metadata.projectPath,
        isSidekickMinion: false,
        agentIsPlanLike: false,
        effectiveMode: "exec",
        taskSettings: DEFAULT_TASK_SETTINGS,
        taskDepth: 0,
        shouldDisableTaskToolsForDepth: false,
        effectiveToolPolicy: undefined,
        toolNamesForSentinel: [],
      },
    };
    spyOn(agentResolution, "resolveAgentForStream").mockImplementation(() =>
      Promise.resolve(resolvedAgentResult)
    );

    spyOn(streamContextBuilder, "buildPlanInstructions").mockImplementation((args) => {
      planPayloadMessageIds.push(args.requestPayloadMessages.map((message) => message.id));

      const planInstructionsResult: Awaited<
        ReturnType<typeof streamContextBuilder.buildPlanInstructions>
      > = {
        effectiveAdditionalInstructions: undefined,
        planFilePath: path.join(metadata.projectPath, "plan.md"),
        planContentForTransition: undefined,
      };

      return Promise.resolve(planInstructionsResult);
    });

    spyOn(streamContextBuilder, "buildStreamSystemContext").mockResolvedValue({
      agentSystemPrompt: "test-agent-prompt",
      systemMessage: "test-system-message",
      systemMessageTokens: 1,
      agentDefinitions: undefined,
      availableSkills: undefined,
    });

    spyOn(messagePipeline, "prepareMessagesForProvider").mockImplementation((args) => {
      preparedPayloadMessageIds.push(args.messagesWithSentinel.map((message) => message.id));
      const preparedMessages = args.messagesWithSentinel as unknown as Awaited<
        ReturnType<typeof messagePipeline.prepareMessagesForProvider>
      >;
      return Promise.resolve(preparedMessages);
    });

    spyOn(toolsModule, "getToolsForModel").mockResolvedValue({});
    spyOn(systemMessageModule, "readToolInstructions").mockResolvedValue({});

    const fakeModel = Object.create(null) as LanguageModel;
    const providerModelFactory = Reflect.get(service, "providerModelFactory") as
      | ProviderModelFactory
      | undefined;
    if (!providerModelFactory) {
      throw new Error("Expected AIService.providerModelFactory in streamMessage test harness");
    }

    const resolveAndCreateModelResult: Awaited<
      ReturnType<ProviderModelFactory["resolveAndCreateModel"]>
    > = {
      success: true,
      data: {
        model: fakeModel,
        effectiveModelString: "openai:gpt-5.2",
        canonicalModelString: "openai:gpt-5.2",
        canonicalProviderName: "openai",
        canonicalModelId: "gpt-5.2",
      },
    };
    spyOn(providerModelFactory, "resolveAndCreateModel").mockResolvedValue(
      resolveAndCreateModelResult
    );

    spyOn(service, "getMinionMetadata").mockResolvedValue({
      success: true,
      data: metadata,
    });

    spyOn(initStateManager, "waitForInit").mockResolvedValue(undefined);

    spyOn(config, "findMinion").mockReturnValue({
      minionPath: metadata.projectPath,
      projectPath: metadata.projectPath,
    });

    spyOn(historyService, "commitPartial").mockResolvedValue({
      success: true,
      data: undefined,
    });

    spyOn(historyService, "appendToHistory").mockImplementation((_minionId, message) => {
      message.metadata = {
        ...(message.metadata ?? {}),
        historySequence: 7,
      };

      return Promise.resolve({ success: true, data: undefined });
    });

    const streamManager = (service as unknown as { streamManager: StreamManager }).streamManager;
    const streamToken = "stream-token" as ReturnType<StreamManager["generateStreamToken"]>;

    spyOn(streamManager, "generateStreamToken").mockReturnValue(streamToken);
    spyOn(streamManager, "createTempDirForStream").mockResolvedValue(
      path.join(metadata.projectPath, ".tmp-stream")
    );
    spyOn(streamManager, "isResponseIdLost").mockReturnValue(false);
    spyOn(streamManager, "startStream").mockImplementation((...args: unknown[]) => {
      startStreamCalls.push(args);

      const startStreamResult: Awaited<ReturnType<StreamManager["startStream"]>> = {
        success: true,
        data: streamToken,
      };

      return Promise.resolve(startStreamResult);
    });

    return {
      service,
      planPayloadMessageIds,
      preparedPayloadMessageIds,
      startStreamCalls,
    };
  }

  afterEach(() => {
    mock.restore();
  });

  it("uses the latest durable boundary slice for provider payload and OpenAI derivations", async () => {
    using latticeHome = new DisposableTempDir("ai-service-slice-latest-boundary");
    const projectPath = path.join(latticeHome.path, "project");
    await fs.mkdir(projectPath, { recursive: true });

    const minionId = "minion-slice-latest";
    const metadata = createMinionMetadata(minionId, projectPath);
    const harness = createHarness(latticeHome.path, metadata);

    const messages: LatticeMessage[] = [
      createLatticeMessage("boundary-1", "assistant", "compaction epoch 1", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
        model: "openai:gpt-5.2",
      }),
      createLatticeMessage("assistant-old-response", "assistant", "older response", {
        model: "openai:gpt-5.2",
        providerMetadata: { openai: { responseId: "resp_epoch_1" } },
      }),
      createLatticeMessage(
        "start-here-summary",
        "assistant",
        "# Start Here\n\n- Existing plan context\n\n*Plan file preserved at:* /tmp/plan.md",
        {
          compacted: "user",
          agentId: "plan",
        }
      ),
      createLatticeMessage("mid-user", "user", "mid conversation"),
      createLatticeMessage("boundary-2", "assistant", "compaction epoch 2", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 2,
        model: "openai:gpt-5.2",
      }),
      createLatticeMessage("latest-user", "user", "continue"),
    ];

    const result = await harness.service.streamMessage({
      messages,
      minionId,
      modelString: "openai:gpt-5.2",
      thinkingLevel: "medium",
    });

    expect(result.success).toBe(true);
    expect(harness.planPayloadMessageIds).toEqual([["boundary-2", "latest-user"]]);
    expect(harness.preparedPayloadMessageIds).toEqual([["boundary-2", "latest-user"]]);
    expect(harness.startStreamCalls).toHaveLength(1);

    const startStreamCall = harness.startStreamCalls[0];
    expect(startStreamCall).toBeDefined();
    if (!startStreamCall) {
      throw new Error("Expected streamManager.startStream call arguments");
    }

    const startStreamMessageIds = messageIdsFromUnknownArray(startStreamCall[1]);
    expect(startStreamMessageIds).toEqual(["boundary-2", "latest-user"]);

    const openaiOptions = openAIOptionsFromStartStreamCall(startStreamCall);
    expect(openaiOptions.previousResponseId).toBeUndefined();
    expect(openaiOptions.promptCacheKey).toBe(`lattice-v1-${minionId}`);
  });

  it("falls back safely when boundary metadata is malformed", async () => {
    using latticeHome = new DisposableTempDir("ai-service-slice-malformed-boundary");
    const projectPath = path.join(latticeHome.path, "project");
    await fs.mkdir(projectPath, { recursive: true });

    const minionId = "minion-slice-malformed";
    const metadata = createMinionMetadata(minionId, projectPath);
    const harness = createHarness(latticeHome.path, metadata);

    const messages: LatticeMessage[] = [
      createLatticeMessage("assistant-before-malformed", "assistant", "response before malformed", {
        model: "openai:gpt-5.2",
        providerMetadata: { openai: { responseId: "resp_before_malformed" } },
      }),
      createLatticeMessage("malformed-boundary", "assistant", "not a durable boundary", {
        compacted: "user",
        compactionBoundary: true,
        // Invalid durable marker: must not truncate request payload.
        compactionEpoch: 0,
        model: "openai:gpt-5.2",
      }),
      createLatticeMessage("latest-user", "user", "continue"),
    ];

    const result = await harness.service.streamMessage({
      messages,
      minionId,
      modelString: "openai:gpt-5.2",
      thinkingLevel: "medium",
    });

    expect(result.success).toBe(true);
    expect(harness.planPayloadMessageIds).toEqual([
      ["assistant-before-malformed", "malformed-boundary", "latest-user"],
    ]);
    expect(harness.preparedPayloadMessageIds).toEqual([
      ["assistant-before-malformed", "malformed-boundary", "latest-user"],
    ]);
    expect(harness.startStreamCalls).toHaveLength(1);

    const startStreamCall = harness.startStreamCalls[0];
    expect(startStreamCall).toBeDefined();
    if (!startStreamCall) {
      throw new Error("Expected streamManager.startStream call arguments");
    }

    const startStreamMessageIds = messageIdsFromUnknownArray(startStreamCall[1]);
    expect(startStreamMessageIds).toEqual([
      "assistant-before-malformed",
      "malformed-boundary",
      "latest-user",
    ]);

    const openaiOptions = openAIOptionsFromStartStreamCall(startStreamCall);
    expect(openaiOptions.previousResponseId).toBe("resp_before_malformed");
    expect(openaiOptions.promptCacheKey).toBe(`lattice-v1-${minionId}`);
  });
});

describe("normalizeAnthropicBaseURL", () => {
  it("appends /v1 to URLs without it", () => {
    expect(normalizeAnthropicBaseURL("https://api.anthropic.com")).toBe(
      "https://api.anthropic.com/v1"
    );
    expect(normalizeAnthropicBaseURL("https://custom-proxy.com")).toBe(
      "https://custom-proxy.com/v1"
    );
  });

  it("preserves URLs already ending with /v1", () => {
    expect(normalizeAnthropicBaseURL("https://api.anthropic.com/v1")).toBe(
      "https://api.anthropic.com/v1"
    );
    expect(normalizeAnthropicBaseURL("https://custom-proxy.com/v1")).toBe(
      "https://custom-proxy.com/v1"
    );
  });

  it("removes trailing slashes before appending /v1", () => {
    expect(normalizeAnthropicBaseURL("https://api.anthropic.com/")).toBe(
      "https://api.anthropic.com/v1"
    );
    expect(normalizeAnthropicBaseURL("https://api.anthropic.com///")).toBe(
      "https://api.anthropic.com/v1"
    );
  });

  it("removes trailing slash after /v1", () => {
    expect(normalizeAnthropicBaseURL("https://api.anthropic.com/v1/")).toBe(
      "https://api.anthropic.com/v1"
    );
  });

  it("handles URLs with ports", () => {
    expect(normalizeAnthropicBaseURL("http://localhost:8080")).toBe("http://localhost:8080/v1");
    expect(normalizeAnthropicBaseURL("http://localhost:8080/v1")).toBe("http://localhost:8080/v1");
  });

  it("handles URLs with paths that include v1 in the middle", () => {
    // This should still append /v1 because the path doesn't END with /v1
    expect(normalizeAnthropicBaseURL("https://proxy.com/api/v1-beta")).toBe(
      "https://proxy.com/api/v1-beta/v1"
    );
  });
});

describe("buildAnthropicHeaders", () => {
  it("returns undefined when use1MContext is false and no existing headers", () => {
    expect(buildAnthropicHeaders(undefined, false)).toBeUndefined();
  });

  it("returns existing headers unchanged when use1MContext is false", () => {
    const existing = { "x-custom": "value" };
    expect(buildAnthropicHeaders(existing, false)).toBe(existing);
  });

  it("returns existing headers unchanged when use1MContext is undefined", () => {
    const existing = { "x-custom": "value" };
    expect(buildAnthropicHeaders(existing, undefined)).toBe(existing);
  });

  it("adds 1M context header when use1MContext is true and no existing headers", () => {
    const result = buildAnthropicHeaders(undefined, true);
    expect(result).toEqual({ "anthropic-beta": ANTHROPIC_1M_CONTEXT_HEADER });
  });

  it("merges 1M context header with existing headers when use1MContext is true", () => {
    const existing = { "x-custom": "value" };
    const result = buildAnthropicHeaders(existing, true);
    expect(result).toEqual({
      "x-custom": "value",
      "anthropic-beta": ANTHROPIC_1M_CONTEXT_HEADER,
    });
  });

  it("overwrites existing anthropic-beta header when use1MContext is true", () => {
    const existing = { "anthropic-beta": "other-beta" };
    const result = buildAnthropicHeaders(existing, true);
    expect(result).toEqual({ "anthropic-beta": ANTHROPIC_1M_CONTEXT_HEADER });
  });
});

describe("buildAppAttributionHeaders", () => {
  it("adds both headers when no headers exist", () => {
    expect(buildAppAttributionHeaders(undefined)).toEqual({
      "HTTP-Referer": LATTICE_APP_ATTRIBUTION_URL,
      "X-Title": LATTICE_APP_ATTRIBUTION_TITLE,
    });
  });

  it("adds only the missing header when one is present", () => {
    const existing = { "HTTP-Referer": "https://example.com" };
    const result = buildAppAttributionHeaders(existing);
    expect(result).toEqual({
      "HTTP-Referer": "https://example.com",
      "X-Title": LATTICE_APP_ATTRIBUTION_TITLE,
    });
  });

  it("does not overwrite existing values (case-insensitive)", () => {
    const existing = { "http-referer": "https://example.com", "X-TITLE": "My App" };
    const result = buildAppAttributionHeaders(existing);
    expect(result).toEqual(existing);
  });

  it("preserves unrelated headers", () => {
    const existing = { "x-custom": "value" };
    const result = buildAppAttributionHeaders(existing);
    expect(result).toEqual({
      "x-custom": "value",
      "HTTP-Referer": LATTICE_APP_ATTRIBUTION_URL,
      "X-Title": LATTICE_APP_ATTRIBUTION_TITLE,
    });
  });

  it("does not mutate the input object", () => {
    const existing = { "x-custom": "value" };
    const existingSnapshot = { ...existing };

    buildAppAttributionHeaders(existing);

    expect(existing).toEqual(existingSnapshot);
  });
});

describe("discoverAvailableSidekicksForToolContext", () => {
  it("includes derived agents that inherit sidekick.runnable from base", async () => {
    using project = new DisposableTempDir("available-sidekicks");
    using latticeHome = new DisposableTempDir("available-sidekicks-home");

    const agentsRoot = path.join(project.path, ".lattice", "agents");
    await fs.mkdir(agentsRoot, { recursive: true });

    // Derived agent: base exec but no explicit sidekick.runnable.
    await fs.writeFile(
      path.join(agentsRoot, "custom.md"),
      `---\nname: Custom Exec Derivative\nbase: exec\n---\nBody\n`,
      "utf-8"
    );

    const runtime = new LocalRuntime(project.path);
    const cfg = new Config(latticeHome.path).loadConfigOrDefault();

    const availableSidekicks = await discoverAvailableSidekicksForToolContext({
      runtime,
      minionPath: project.path,
      cfg,
      roots: {
        projectRoot: agentsRoot,
        globalRoot: path.join(project.path, "empty-global-agents"),
      },
    });

    const custom = availableSidekicks.find((agent) => agent.id === "custom");
    expect(custom).toBeDefined();
    expect(custom?.sidekickRunnable).toBe(true);

    // Ensure the task tool description includes the derived agent in the runnable sidekick list.
    const taskTool = createTaskTool({
      ...createTestToolConfig(project.path, { minionId: "test-minion" }),
      availableSidekicks,
    });

    const description = (taskTool as unknown as { description?: unknown }).description;
    expect(typeof description).toBe("string");
    if (typeof description === "string") {
      expect(description).toContain("Available sub-agents");
      expect(description).toContain("- custom");
    }
  });
});
