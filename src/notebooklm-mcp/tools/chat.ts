/**
 * MCP tool registrations for chat/query operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerChatTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_query_notebook",
    "Ask a question about the content in a notebook. Uses NotebookLM's AI to generate an answer grounded in the notebook's sources. Returns the answer with source citations.",
    {
      notebookId: z.string().describe("The notebook ID"),
      query: z.string().describe("The question to ask about the notebook content"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit the query to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.chat.query(
          params.notebookId,
          params.query,
          { sourceIds: params.sourceIds },
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_configure_chat",
    "Configure the chat behavior for a notebook. Set a custom goal or response length.",
    {
      notebookId: z.string().describe("The notebook ID"),
      goal: z
        .enum(["default", "custom", "learning_guide"])
        .optional()
        .describe("Chat goal preset"),
      customGoal: z
        .string()
        .optional()
        .describe("Custom goal description (used when goal='custom')"),
      responseLength: z
        .enum(["default", "longer", "shorter"])
        .optional()
        .describe("Preferred response length"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.notebooks.configureChat(params.notebookId, {
          goal: params.goal,
          customGoal: params.customGoal,
          responseLength: params.responseLength,
        });
        return {
          content: [
            jsonContent({
              success: true,
              message: "Chat configuration updated",
            }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_clear_chat",
    "Clear the conversation history for a notebook.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        client.chat.clearConversation(params.notebookId);
        return {
          content: [
            jsonContent({
              success: true,
              message: "Conversation history cleared",
            }),
          ],
        };
      }),
  );
}
