/**
 * Lattice Language Model — Custom Vercel AI SDK LanguageModelV2 implementation.
 *
 * Bridges the Go binary's OpenAI-compatible HTTP API to the Vercel AI SDK's
 * LanguageModelV2 interface. This allows lattice-inference to work seamlessly
 * with `streamText()`, `generateText()`, and all other AI SDK primitives.
 *
 * Architecture: AI SDK → LatticeLanguageModel → InferredHttpClient → Go binary → Python worker
 */

import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2CallWarning,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2Message,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider";
import type { InferredHttpClient } from "./inferredHttpClient";
import type { ChatMessage, ChatCompletionRequest } from "./types";

/**
 * Convert a LanguageModelV2Prompt (array of typed messages) into the
 * simple {role, content}[] format expected by the OpenAI-compatible API.
 */
function convertPrompt(messages: LanguageModelV2Message[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      const text = msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) result.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      const text = msg.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) result.push({ role: "assistant", content: text });
    } else if (msg.role === "tool") {
      const text = msg.content
        .map((p) => {
          if (p.output.type === "text" || p.output.type === "error-text") {
            return p.output.value;
          }
          if (p.output.type === "json" || p.output.type === "error-json") {
            return JSON.stringify(p.output.value);
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) result.push({ role: "user", content: `[Tool Result]\n${text}` });
    }
  }

  return result;
}

let streamIdCounter = 0;
function nextStreamId(): string {
  return `lattice-${++streamIdCounter}`;
}

/**
 * Custom LanguageModelV2 that communicates with the Go inference binary
 * via its OpenAI-compatible HTTP API.
 */
export class LatticeLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const;
  readonly provider = "lattice-inference";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private client: InferredHttpClient;

  constructor(modelId: string, client: InferredHttpClient) {
    this.modelId = modelId;
    this.client = client;
  }

  /**
   * Non-streaming generation via POST /v1/chat/completions.
   */
  async doGenerate(options: LanguageModelV2CallOptions): Promise<{
    content: Array<LanguageModelV2Content>;
    finishReason: LanguageModelV2FinishReason;
    usage: LanguageModelV2Usage;
    warnings: Array<LanguageModelV2CallWarning>;
    response?: { id?: string; timestamp?: Date; modelId?: string };
  }> {
    const req: ChatCompletionRequest = {
      model: this.modelId,
      messages: convertPrompt(options.prompt),
      stream: false,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens ?? 2048,
      stop: options.stopSequences,
    };

    if (options.topP !== undefined) {
      req.top_p = options.topP;
    }

    const resp = await this.client.chatCompletions(req);
    const choice = resp.choices[0];

    const content: LanguageModelV2Content[] = [
      { type: "text", text: choice?.message?.content ?? "" },
    ];

    const finishReason = mapFinishReason(choice?.finish_reason ?? "stop");

    const usage: LanguageModelV2Usage = {
      inputTokens: resp.usage?.prompt_tokens || undefined,
      outputTokens: resp.usage?.completion_tokens || undefined,
      totalTokens: resp.usage?.total_tokens || undefined,
    };

    return {
      content,
      finishReason,
      usage,
      warnings: collectWarnings(options),
      response: {
        id: resp.id,
        modelId: resp.model,
        timestamp: new Date(resp.created * 1000),
      },
    };
  }

  /**
   * Streaming generation via POST /v1/chat/completions with stream:true.
   *
   * Parses SSE chunks from the Go binary and maps them to
   * AI SDK LanguageModelV2StreamPart events.
   */
  async doStream(options: LanguageModelV2CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV2StreamPart>;
    response?: { headers?: Record<string, string> };
  }> {
    const req: ChatCompletionRequest = {
      model: this.modelId,
      messages: convertPrompt(options.prompt),
      stream: true,
      temperature: options.temperature,
      max_tokens: options.maxOutputTokens ?? 2048,
      stop: options.stopSequences,
    };

    if (options.topP !== undefined) {
      req.top_p = options.topP;
    }

    const client = this.client;
    const modelId = this.modelId;
    const contentId = nextStreamId();

    const stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        let outputTokens = 0;
        let started = false;
        let lastUsage:
          | { prompt_tokens: number; completion_tokens: number; total_tokens: number }
          | undefined;

        try {
          for await (const chunk of client.chatCompletionsStream(req)) {
            const choice = chunk.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta?.content ?? "";

            if (!started && delta) {
              controller.enqueue({ type: "text-start", id: contentId });
              started = true;
            }

            if (delta) {
              outputTokens++;
              controller.enqueue({ type: "text-delta", id: contentId, delta });
            }

            // Track usage from final chunk
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }

            // Check for finish
            if (choice.finish_reason) {
              if (started) {
                controller.enqueue({ type: "text-end", id: contentId });
              }

              controller.enqueue({
                type: "finish",
                finishReason: mapFinishReason(choice.finish_reason),
                usage: {
                  inputTokens: lastUsage?.prompt_tokens || undefined,
                  outputTokens: lastUsage?.completion_tokens || outputTokens,
                  totalTokens: lastUsage?.total_tokens || undefined,
                },
                response: {
                  modelId,
                  timestamp: new Date(),
                },
              } as unknown as LanguageModelV2StreamPart);
              break;
            }
          }

          // If stream ended without finish_reason, close gracefully
          if (started) {
            controller.enqueue({ type: "text-end", id: contentId });
            controller.enqueue({
              type: "finish",
              finishReason: "stop" as LanguageModelV2FinishReason,
              usage: {
                inputTokens: undefined,
                outputTokens,
                totalTokens: undefined,
              },
            } as unknown as LanguageModelV2StreamPart);
          }
        } catch (error) {
          controller.enqueue({
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          } as unknown as LanguageModelV2StreamPart);
        } finally {
          controller.close();
        }
      },
    });

    return { stream };
  }
}

/**
 * Map OpenAI finish reasons to AI SDK finish reasons.
 */
function mapFinishReason(reason: string): LanguageModelV2FinishReason {
  switch (reason) {
    case "stop":
    case "eos":
    case "end_of_text":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content-filter";
    default:
      return "stop";
  }
}

/**
 * Collect warnings for unsupported options.
 */
function collectWarnings(options: LanguageModelV2CallOptions): LanguageModelV2CallWarning[] {
  const warnings: LanguageModelV2CallWarning[] = [];

  if (options.tools && options.tools.length > 0) {
    warnings.push({
      type: "other",
      message: "Lattice Inference does not support tool calls. Tools will be ignored.",
    });
  }

  if (options.responseFormat?.type === "json") {
    warnings.push({
      type: "other",
      message: "Lattice Inference does not support JSON response format. Using plain text.",
    });
  }

  return warnings;
}
