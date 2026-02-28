/**
 * Tokenizer tools: count tokens, batch count, and calculate chat stats.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerTokenizerTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── Count tokens ───────────────────────────────────────────────────────
  server.tool(
    "count_tokens",
    "Count the number of tokens in a text string for a given model.",
    {
      model: z.string().describe("Model name for tokenization (e.g. 'claude-sonnet-4-20250514')"),
      text: z.string().describe("Text to tokenize"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.tokenizer.countTokens({
          model: params.model,
          text: params.text,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Count tokens batch ─────────────────────────────────────────────────
  server.tool(
    "count_tokens_batch",
    "Count tokens for multiple texts in one call. More efficient than individual calls.",
    {
      model: z.string().describe("Model name for tokenization"),
      texts: z.array(z.string()).describe("Array of texts to tokenize"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.tokenizer.countTokensBatch({
          model: params.model,
          texts: params.texts,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Calculate stats ────────────────────────────────────────────────────
  server.tool(
    "calculate_chat_stats",
    "Compute token usage and cost statistics for a minion's chat messages.",
    {
      minionId: z.string().describe("The minion ID"),
      model: z.string().describe("Model to calculate costs for"),
      messages: z.array(z.object({
        role: z.string().describe("Message role (user/assistant/system)"),
        content: z.string().describe("Message text content"),
      })).describe("Chat messages to analyze"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.tokenizer.calculateStats({
          minionId: params.minionId,
          model: params.model,
          messages: params.messages,
        } as unknown as Parameters<typeof client.tokenizer.calculateStats>[0]);
        return { content: [jsonContent(result)] };
      })
  );
}
