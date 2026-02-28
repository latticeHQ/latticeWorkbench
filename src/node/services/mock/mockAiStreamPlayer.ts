import assert from "@/common/utils/assert";
import type { LatticeMessage } from "@/common/types/message";
import { createLatticeMessage } from "@/common/types/message";
import type { HistoryService } from "@/node/services/historyService";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import type { SendMessageError } from "@/common/types/errors";
import type { AIService } from "@/node/services/aiService";
import { createErrorEvent } from "@/node/services/utils/sendMessageError";
import { log } from "@/node/services/log";
import type {
  MockAssistantEvent,
  MockStreamErrorEvent,
  MockStreamStartEvent,
} from "./mockAiEventTypes";
import { MockAiRouter } from "./mockAiRouter";
import { buildMockStreamEventsFromReply } from "./mockAiStreamAdapter";
import type {
  StreamStartEvent,
  StreamDeltaEvent,
  StreamEndEvent,
  UsageDeltaEvent,
} from "@/common/types/stream";
import type { ToolCallStartEvent, ToolCallEndEvent } from "@/common/types/stream";
import type { ReasoningDeltaEvent } from "@/common/types/stream";
import { getTokenizerForModel } from "@/node/utils/main/tokenizer";
import { KNOWN_MODELS } from "@/common/constants/knownModels";
import { getErrorMessage } from "@/common/utils/errors";

const MOCK_TOKENIZER_MODEL = KNOWN_MODELS.GPT.id;
const TOKENIZE_TIMEOUT_MS = 150;
let tokenizerFallbackLogged = false;
let tokenizerUnavailableLogged = false;

function approximateTokenCount(text: string): number {
  const normalizedLength = text.trim().length;
  if (normalizedLength === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalizedLength / 4));
}

async function tokenizeWithMockModel(text: string, context: string): Promise<number> {
  assert(typeof text === "string", `Mock stream ${context} expects string input`);

  // Prefer fast approximate token counting in mock mode.
  // We only use the real tokenizer if it's available and responds quickly.
  const approximateTokens = approximateTokenCount(text);

  let fallbackUsed = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let tokenizerErrorMessage: string | undefined;

  const fallbackPromise = new Promise<number>((resolve) => {
    timeoutId = setTimeout(() => {
      fallbackUsed = true;
      resolve(approximateTokens);
    }, TOKENIZE_TIMEOUT_MS);
  });

  const actualPromise = (async () => {
    try {
      const tokenizer = await getTokenizerForModel(MOCK_TOKENIZER_MODEL);
      assert(
        typeof tokenizer.encoding === "string" && tokenizer.encoding.length > 0,
        `Tokenizer for ${MOCK_TOKENIZER_MODEL} must expose a non-empty encoding`
      );
      const tokens = await tokenizer.countTokens(text);
      assert(
        Number.isFinite(tokens) && tokens >= 0,
        `Tokenizer for ${MOCK_TOKENIZER_MODEL} returned invalid token count`
      );
      return tokens;
    } catch (error) {
      tokenizerErrorMessage = getErrorMessage(error);
      return approximateTokens;
    }
  })();

  const tokens = await Promise.race([actualPromise, fallbackPromise]);

  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  if (fallbackUsed && !tokenizerFallbackLogged) {
    tokenizerFallbackLogged = true;
    void actualPromise.then((resolvedTokens) => {
      log.debug(
        `[MockAiStreamPlayer] Tokenizer fallback used for ${context}; emitted ${approximateTokens}, background tokenizer returned ${resolvedTokens}`
      );
    });
  }

  if (tokenizerErrorMessage && !tokenizerUnavailableLogged) {
    tokenizerUnavailableLogged = true;
    log.debug(
      `[MockAiStreamPlayer] Tokenizer unavailable for ${context}; using approximate (${tokenizerErrorMessage})`
    );
  }

  assert(
    Number.isFinite(tokens) && tokens >= 0,
    `Token counting produced invalid count for ${context}`
  );

  return tokens;
}

interface MockPlayerDeps {
  aiService: AIService;
  historyService: HistoryService;
}

interface StreamStartGate {
  promise: Promise<void>;
  resolve: () => void;
}

interface ActiveStream {
  timers: Array<ReturnType<typeof setTimeout>>;
  messageId: string;
  eventQueue: Array<() => Promise<void>>;
  isProcessing: boolean;
  cancelled: boolean;
}

export class MockAiStreamPlayer {
  private readonly streamStartGates = new Map<string, StreamStartGate>();
  private readonly releasedStreamStartGates = new Set<string>();
  private readonly router = new MockAiRouter();
  private readonly lastPromptByMinion = new Map<string, LatticeMessage[]>();
  private readonly lastModelByMinion = new Map<string, string>();
  private readonly activeStreams = new Map<string, ActiveStream>();
  private nextMockMessageId = 0;

  constructor(private readonly deps: MockPlayerDeps) {}

  debugGetLastPrompt(minionId: string): LatticeMessage[] | null {
    return this.lastPromptByMinion.get(minionId) ?? null;
  }

  debugGetLastModel(minionId: string): string | null {
    return this.lastModelByMinion.get(minionId) ?? null;
  }

  private recordLastPrompt(minionId: string, messages: LatticeMessage[]): void {
    try {
      const cloned =
        typeof structuredClone === "function"
          ? structuredClone(messages)
          : (JSON.parse(JSON.stringify(messages)) as LatticeMessage[]);
      this.lastPromptByMinion.set(minionId, cloned);
    } catch {
      this.lastPromptByMinion.set(minionId, messages);
    }
  }

  isStreaming(minionId: string): boolean {
    return this.activeStreams.has(minionId);
  }

  releaseStreamStartGate(minionId: string): void {
    const gate = this.streamStartGates.get(minionId);
    if (!gate) {
      this.releasedStreamStartGates.add(minionId);
      return;
    }
    gate.resolve();
  }

  private getStreamStartGate(minionId: string): StreamStartGate {
    const existing = this.streamStartGates.get(minionId);
    if (existing) {
      return existing;
    }

    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
      resolve = res;
    });
    const gate = { promise, resolve };
    this.streamStartGates.set(minionId, gate);
    return gate;
  }

  private async waitForStreamStartGate(
    minionId: string,
    abortSignal?: AbortSignal
  ): Promise<void> {
    if (this.releasedStreamStartGates.delete(minionId)) {
      return;
    }

    const gate = this.getStreamStartGate(minionId);
    let resolved = false;

    await new Promise<void>((resolve) => {
      const finish = () => {
        if (resolved) return;
        resolved = true;
        this.streamStartGates.delete(minionId);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", finish);
        }
        resolve();
      };

      void gate.promise.then(finish);

      if (abortSignal) {
        if (abortSignal.aborted) {
          finish();
          return;
        }
        abortSignal.addEventListener("abort", finish, { once: true });
      }
    });
  }
  stop(minionId: string): void {
    const active = this.activeStreams.get(minionId);
    if (!active) return;

    active.cancelled = true;

    // Emit stream-abort event to mirror real streaming behavior
    this.deps.aiService.emit("stream-abort", {
      type: "stream-abort",
      minionId,
      messageId: active.messageId,
      abortReason: "user",
    });

    this.cleanup(minionId);
  }

  async play(
    messages: LatticeMessage[],
    minionId: string,
    options?: {
      model?: string;
      abortSignal?: AbortSignal;
    }
  ): Promise<Result<void, SendMessageError>> {
    const abortSignal = options?.abortSignal;
    if (abortSignal?.aborted) {
      return Ok(undefined);
    }

    const latest = messages[messages.length - 1];
    if (!latest || latest.role !== "user") {
      return Err({ type: "unknown", raw: "Mock AI expected a user message" });
    }

    const latestText = this.extractText(latest);

    this.recordLastPrompt(minionId, messages);
    // Always update last model to avoid stale state between requests
    if (options?.model) {
      this.lastModelByMinion.set(minionId, options.model);
    } else {
      this.lastModelByMinion.delete(minionId);
    }
    const reply = this.router.route({
      messages,
      latestUserMessage: latest,
      latestUserText: latestText,
    });

    const messageId = `msg-mock-${this.nextMockMessageId++}`;
    if (reply.waitForStreamStart) {
      await this.waitForStreamStartGate(minionId, abortSignal);
      if (abortSignal?.aborted) {
        return Ok(undefined);
      }
    }

    const events = buildMockStreamEventsFromReply(reply, {
      messageId,
      model: options?.model,
    });

    const streamStart = events.find(
      (event): event is MockStreamStartEvent => event.kind === "stream-start"
    );
    if (!streamStart) {
      return Err({ type: "unknown", raw: "Mock AI turn missing stream-start" });
    }

    const streamStartTimeoutMs = 5000;
    const streamStartPromise = new Promise<void>((resolve) => {
      let resolved = false;
      // eslint-disable-next-line prefer-const -- assigned once but after cleanup() is defined
      let timeoutId: ReturnType<typeof setTimeout>;
      const onStreamStart = (event: StreamStartEvent) => {
        if (event.minionId !== minionId || event.messageId !== messageId) {
          return;
        }
        cleanup();
      };
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        this.deps.aiService.off("stream-start", onStreamStart as never);
        clearTimeout(timeoutId);
        resolve();
      };

      this.deps.aiService.on("stream-start", onStreamStart as never);

      if (abortSignal) {
        if (abortSignal.aborted) {
          cleanup();
          return;
        }
        abortSignal.addEventListener("abort", cleanup, { once: true });
      }

      timeoutId = setTimeout(cleanup, streamStartTimeoutMs);
    });

    let historySequence = this.computeNextHistorySequence(messages);

    const assistantMessage = createLatticeMessage(messageId, "assistant", "", {
      timestamp: Date.now(),
      model: streamStart.model,
    });

    if (abortSignal?.aborted) {
      return Ok(undefined);
    }

    const appendResult = await this.deps.historyService.appendToHistory(
      minionId,
      assistantMessage
    );
    if (!appendResult.success) {
      return Err({ type: "unknown", raw: appendResult.error });
    }

    if (abortSignal?.aborted) {
      const deleteResult = await this.deps.historyService.deleteMessage(minionId, messageId);
      if (!deleteResult.success) {
        log.error(
          `Failed to delete aborted mock assistant placeholder (${messageId}): ${deleteResult.error}`
        );
      }
      return Ok(undefined);
    }

    historySequence = assistantMessage.metadata?.historySequence ?? historySequence;

    // Cancel any existing stream before starting a new one
    if (this.isStreaming(minionId)) {
      this.stop(minionId);
    }

    this.scheduleEvents(minionId, events, messageId, historySequence);

    await streamStartPromise;
    if (abortSignal?.aborted) {
      return Ok(undefined);
    }

    return Ok(undefined);
  }

  async replayStream(_minionId: string): Promise<void> {
    // No-op for mock streams; events are deterministic and do not support mid-stream replay.
  }

  private scheduleEvents(
    minionId: string,
    events: MockAssistantEvent[],
    messageId: string,
    historySequence: number
  ): void {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    this.activeStreams.set(minionId, {
      timers,
      messageId,
      eventQueue: [],
      isProcessing: false,
      cancelled: false,
    });

    for (const event of events) {
      const timer = setTimeout(() => {
        this.enqueueEvent(minionId, messageId, () =>
          this.dispatchEvent(minionId, event, messageId, historySequence)
        );
      }, event.delay);
      timers.push(timer);
    }
  }

  private enqueueEvent(minionId: string, messageId: string, handler: () => Promise<void>): void {
    const active = this.activeStreams.get(minionId);
    if (!active || active.cancelled || active.messageId !== messageId) return;

    active.eventQueue.push(handler);
    void this.processQueue(minionId);
  }

  private async processQueue(minionId: string): Promise<void> {
    const active = this.activeStreams.get(minionId);
    if (!active || active.isProcessing) return;

    active.isProcessing = true;

    while (active.eventQueue.length > 0) {
      const handler = active.eventQueue.shift();
      if (!handler) break;

      try {
        await handler();
      } catch (error) {
        log.error(`Event handler error for ${minionId}:`, error);
      }
    }

    active.isProcessing = false;
  }

  private async dispatchEvent(
    minionId: string,
    event: MockAssistantEvent,
    messageId: string,
    historySequence: number
  ): Promise<void> {
    const active = this.activeStreams.get(minionId);
    if (!active || active.cancelled || active.messageId !== messageId) {
      return;
    }

    switch (event.kind) {
      case "stream-start": {
        const payload: StreamStartEvent = {
          type: "stream-start",
          minionId,
          messageId,
          model: event.model,
          historySequence,
          startTime: Date.now(),
          ...(event.mode && { mode: event.mode }),
        };
        this.deps.aiService.emit("stream-start", payload);
        break;
      }
      case "reasoning-delta": {
        // Mock streams use the same tokenization logic as real streams for consistency
        const tokens = await tokenizeWithMockModel(event.text, "reasoning-delta text");
        if (active.cancelled) return;
        const payload: ReasoningDeltaEvent = {
          type: "reasoning-delta",
          minionId,
          messageId,
          delta: event.text,
          tokens,
          timestamp: Date.now(),
        };
        this.deps.aiService.emit("reasoning-delta", payload);
        break;
      }
      case "tool-start": {
        // Mock streams use the same tokenization logic as real streams for consistency
        const inputText = JSON.stringify(event.args);
        const tokens = await tokenizeWithMockModel(inputText, "tool-call args");
        if (active.cancelled) return;
        const payload: ToolCallStartEvent = {
          type: "tool-call-start",
          minionId,
          messageId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          tokens,
          timestamp: Date.now(),
        };
        this.deps.aiService.emit("tool-call-start", payload);
        break;
      }
      case "usage-delta": {
        const payload: UsageDeltaEvent = {
          type: "usage-delta",
          minionId,
          messageId,
          usage: event.usage,
          providerMetadata: event.providerMetadata,
          cumulativeUsage: event.cumulativeUsage,
          cumulativeProviderMetadata: event.cumulativeProviderMetadata,
        };
        this.deps.aiService.emit("usage-delta", payload);
        break;
      }
      case "tool-end": {
        const payload: ToolCallEndEvent = {
          type: "tool-call-end",
          minionId,
          messageId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          timestamp: Date.now(),
        };
        this.deps.aiService.emit("tool-call-end", payload);
        break;
      }
      case "stream-delta": {
        // Mock streams use the same tokenization logic as real streams for consistency
        let tokens: number;
        try {
          tokens = await tokenizeWithMockModel(event.text, "stream-delta text");
        } catch (error) {
          log.error("tokenize failed for stream-delta", error);
          throw error;
        }
        const payload: StreamDeltaEvent = {
          type: "stream-delta",
          minionId,
          messageId,
          delta: event.text,
          tokens,
          timestamp: Date.now(),
        };
        this.deps.aiService.emit("stream-delta", payload);
        break;
      }
      case "stream-error": {
        const payload: MockStreamErrorEvent = event;
        this.deps.aiService.emit(
          "error",
          createErrorEvent(minionId, {
            messageId,
            error: payload.error,
            errorType: payload.errorType,
          })
        );
        this.cleanup(minionId);
        break;
      }
      case "stream-end": {
        const payload: StreamEndEvent = {
          type: "stream-end",
          minionId,
          messageId,
          metadata: {
            model: event.metadata.model,
            systemMessageTokens: event.metadata.systemMessageTokens,
          },
          parts: event.parts,
        };

        // Update history with completed message (mirrors real StreamManager behavior).
        // The target message is always in the current epoch — use boundary-aware read.
        const historyResult =
          await this.deps.historyService.getHistoryFromLatestBoundary(minionId);
        if (active.cancelled) return;
        if (historyResult.success) {
          const existingMessage = historyResult.data.find((msg) => msg.id === messageId);
          if (existingMessage?.metadata?.historySequence !== undefined) {
            const completedMessage: LatticeMessage = {
              id: messageId,
              role: "assistant",
              parts: event.parts,
              metadata: {
                ...existingMessage.metadata,
                model: event.metadata.model,
                systemMessageTokens: event.metadata.systemMessageTokens,
              },
            };
            const updateResult = await this.deps.historyService.updateHistory(
              minionId,
              completedMessage
            );

            if (!updateResult.success) {
              log.error(`Failed to update history for ${messageId}: ${updateResult.error}`);
            }
          }
        }

        if (active.cancelled) return;

        this.deps.aiService.emit("stream-end", payload);
        this.cleanup(minionId);
        break;
      }
    }
  }

  private cleanup(minionId: string): void {
    const active = this.activeStreams.get(minionId);
    if (!active) return;

    active.cancelled = true;

    // Clear all pending timers
    for (const timer of active.timers) {
      clearTimeout(timer);
    }

    // Clear event queue to prevent any pending events from processing
    active.eventQueue = [];

    this.activeStreams.delete(minionId);
  }

  private extractText(message: LatticeMessage): string {
    return message.parts
      .filter((part) => "text" in part)
      .map((part) => (part as { text: string }).text)
      .join("");
  }

  private computeNextHistorySequence(messages: LatticeMessage[]): number {
    let maxSequence = 0;
    for (const message of messages) {
      const seq = message.metadata?.historySequence;
      if (typeof seq === "number" && seq > maxSequence) {
        maxSequence = seq;
      }
    }
    return maxSequence + 1;
  }
}
