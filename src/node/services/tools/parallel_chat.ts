import { tool } from "ai";
import type { ParallelChatToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  PARALLEL_CHAT_TIMEOUT_MS,
  PARALLEL_CHAT_DEFAULT_TIMEOUT_MS,
  PARALLEL_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { getErrorMessage } from "@/common/utils/errors";

export const createParallelChatTool: ToolFactory = (config: ToolConfiguration) =>
  tool({
    description: TOOL_DEFINITIONS.parallel_chat.description,
    inputSchema: TOOL_DEFINITIONS.parallel_chat.schema,
    execute: async ({
      message,
      model,
      response_format,
    }): Promise<ParallelChatToolResult> => {
      const apiKey = config.secrets?.PARALLEL_API_KEY;
      if (!apiKey) {
        return {
          success: false,
          error:
            "PARALLEL_API_KEY secret is not configured. " +
            "Go to Settings → Integrations to add your Parallel AI API key.",
        };
      }

      try {
        const chatModel = model ?? "base";
        const timeoutMs =
          PARALLEL_CHAT_TIMEOUT_MS[chatModel] ?? PARALLEL_CHAT_DEFAULT_TIMEOUT_MS;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          // Build OpenAI-compatible request body
          const body: Record<string, unknown> = {
            model: chatModel,
            messages: [{ role: "user", content: message }],
          };

          if (response_format != null) {
            body.response_format = {
              type: "json_schema",
              json_schema: { description: response_format },
            };
          }

          const response = await fetch("https://api.parallel.ai/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });

          if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            return {
              success: false,
              error: `Parallel AI Chat API returned ${response.status}: ${errorText}`,
            };
          }

          const data = (await response.json()) as {
            choices?: Array<{
              message?: { content?: string };
            }>;
            basis?: Array<{
              citations?: Array<{ url?: string }>;
            }>;
          };

          let answer = data.choices?.[0]?.message?.content ?? "";

          // Extract citations from Parallel-specific basis field
          const citations: string[] = [];
          if (Array.isArray(data.basis)) {
            for (const b of data.basis) {
              if (Array.isArray(b.citations)) {
                for (const c of b.citations) {
                  if (c.url && !citations.includes(c.url)) {
                    citations.push(c.url);
                  }
                }
              }
            }
          }

          // Truncate if too large
          if (answer.length > PARALLEL_MAX_OUTPUT_BYTES) {
            answer =
              answer.slice(0, PARALLEL_MAX_OUTPUT_BYTES) + "\n\n[Answer truncated]";
          }

          return {
            success: true,
            answer,
            citations: citations.length > 0 ? citations : undefined,
            model: chatModel,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        return {
          success: false,
          error: `Parallel AI Chat failed: ${getErrorMessage(err)}`,
        };
      }
    },
  });
