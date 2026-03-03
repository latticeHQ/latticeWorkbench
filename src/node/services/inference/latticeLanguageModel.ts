/**
 * Lattice Language Model — Custom Vercel AI SDK LanguageModelV3 implementation.
 *
 * Bridges the Go binary's OpenAI-compatible HTTP API to the Vercel AI SDK's
 * LanguageModelV3 interface. This allows lattice-inference to work seamlessly
 * with `streamText()`, `generateText()`, and all other AI SDK primitives.
 *
 * Uses V3 spec directly (not V2) to avoid the AI SDK's V2→V3 Proxy adapter
 * which can drop stream lifecycle events causing "text part X not found" errors.
 *
 * Architecture: AI SDK -> LatticeLanguageModel -> InferredHttpClient -> Go binary -> Python worker
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { InferredHttpClient } from "./inferredHttpClient";
import type { ChatMessage, ChatCompletionRequest, ChatCompletionChunk } from "./types";

/**
 * Convert a LanguageModelV3Prompt (array of typed messages) into the
 * simple {role, content}[] format expected by the OpenAI-compatible API.
 */
function convertPrompt(messages: LanguageModelV3Message[]): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      const text = msg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) result.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      const text = msg.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");
      if (text) result.push({ role: "assistant", content: text });
    } else if (msg.role === "tool") {
      const text = msg.content
        .map((p) => {
          if (p.type !== "tool-result") return "";
          const output = p.output;
          if (output.type === "text" || output.type === "error-text") {
            return output.value;
          }
          if (output.type === "json" || output.type === "error-json") {
            return JSON.stringify(output.value);
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

/**
 * Build V3 usage from raw token counts.
 */
function buildUsage(
  inputTokens?: number,
  outputTokens?: number,
): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: undefined,
      reasoning: undefined,
    },
  };
}

/**
 * Build V3 finish reason from raw string.
 */
function mapFinishReason(reason: string): LanguageModelV3FinishReason {
  let unified: LanguageModelV3FinishReason["unified"];
  switch (reason) {
    case "stop":
    case "eos":
    case "end_of_text":
      unified = "stop";
      break;
    case "length":
    case "max_tokens":
      unified = "length";
      break;
    case "content_filter":
      unified = "content-filter";
      break;
    default:
      unified = "stop";
      break;
  }
  return { unified, raw: reason };
}

/**
 * Collect warnings for unsupported options.
 */
function collectWarnings(options: LanguageModelV3CallOptions): SharedV3Warning[] {
  const warnings: SharedV3Warning[] = [];

  if (options.tools && options.tools.length > 0) {
    warnings.push({
      type: "unsupported",
      feature: "tool-calls",
      details: "Lattice Inference does not support tool calls. Tools will be ignored.",
    });
  }

  if (options.responseFormat?.type === "json") {
    warnings.push({
      type: "unsupported",
      feature: "json-response-format",
      details: "Lattice Inference does not support JSON response format. Using plain text.",
    });
  }

  return warnings;
}

/**
 * Custom LanguageModelV3 that communicates with the Go inference binary
 * via its OpenAI-compatible HTTP API.
 *
 * Uses V3 spec directly to avoid the AI SDK's V2→V3 Proxy adapter
 * which can drop stream lifecycle events.
 */
export class LatticeLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
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
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
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

    const content: LanguageModelV3Content[] = [
      { type: "text", text: choice?.message?.content ?? "" },
    ];

    return {
      content,
      finishReason: mapFinishReason(choice?.finish_reason ?? "stop"),
      usage: buildUsage(
        resp.usage?.prompt_tokens || undefined,
        resp.usage?.completion_tokens || undefined,
      ),
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
   * Uses the same TransformStream pattern as official AI SDK providers
   * (@ai-sdk/openai, @ai-sdk/anthropic) to ensure stream lifecycle events
   * are properly ordered through the pipe chain:
   *   start: stream-start
   *   transform: response-metadata → text-start → text-delta* → text-end
   *   flush: finish (+ text-end if needed)
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
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

    const modelId = this.modelId;
    const warnings = collectWarnings(options);
    const contentId = "text-0";

    // Convert the async generator into a ReadableStream (source)
    const client = this.client;
    const sourceStream = new ReadableStream<ChatCompletionChunk>({
      async start(controller) {
        try {
          for await (const chunk of client.chatCompletionsStream(req)) {
            controller.enqueue(chunk);
          }
        } catch (error) {
          controller.error(error);
          return;
        }
        controller.close();
      },
    });

    // Transform SSE chunks into V3 stream events (matches @ai-sdk/openai pattern)
    let started = false;
    let finished = false;
    let outputTokens = 0;
    let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
    let responseMetadataSent = false;

    const stream = sourceStream.pipeThrough(
      new TransformStream<ChatCompletionChunk, LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings });
        },

        transform(chunk, controller) {
          const choice = chunk.choices?.[0];
          if (!choice) return;

          // Emit response-metadata on first chunk
          if (!responseMetadataSent && chunk.id) {
            responseMetadataSent = true;
            controller.enqueue({
              type: "response-metadata",
              id: chunk.id,
              modelId: chunk.model ?? modelId,
              timestamp: new Date(chunk.created * 1000),
            });
          }

          const delta = choice.delta?.content ?? "";

          if (!started && delta) {
            controller.enqueue({ type: "text-start", id: contentId });
            started = true;
          }

          if (delta) {
            outputTokens++;
            controller.enqueue({ type: "text-delta", id: contentId, delta });
          }

          if (chunk.usage) {
            lastUsage = chunk.usage;
          }

          if (choice.finish_reason) {
            if (started) {
              controller.enqueue({ type: "text-end", id: contentId });
            }
            controller.enqueue({
              type: "finish",
              finishReason: mapFinishReason(choice.finish_reason),
              usage: buildUsage(
                lastUsage?.prompt_tokens || undefined,
                lastUsage?.completion_tokens || outputTokens,
              ),
            });
            finished = true;
          }
        },

        flush(controller) {
          // Close gracefully if stream ended without a finish_reason chunk
          if (!finished) {
            if (started) {
              controller.enqueue({ type: "text-end", id: contentId });
            }
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: buildUsage(undefined, outputTokens || undefined),
            });
          }
        },
      }),
    );

    return { stream };
  }
}
