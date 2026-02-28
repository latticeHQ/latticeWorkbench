/**
 * MCP tool registrations for studio artifact operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotebookLmClient } from "../client/notebookLmClient";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

export function registerStudioTools(
  server: McpServer,
  client: NotebookLmClient,
): void {
  server.tool(
    "nlm_create_audio",
    "Generate an AI audio overview (podcast-style) from notebook sources. Supports deep dive, brief, critique, and debate formats.",
    {
      notebookId: z.string().describe("The notebook ID"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus the audio on a specific topic or angle"),
      format: z
        .enum(["deep_dive", "brief", "critique", "debate"])
        .optional()
        .describe("Audio format (default: deep_dive)"),
      length: z
        .enum(["short", "default", "long"])
        .optional()
        .describe("Audio length (default: default)"),
      language: z
        .string()
        .optional()
        .describe("Language for the audio (e.g., 'Spanish')"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs (default: all sources)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createAudio(params.notebookId, {
          focusPrompt: params.focusPrompt,
          format: params.format,
          length: params.length,
          language: params.language,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_video",
    "Generate an AI video from notebook sources. Supports explainer and brief formats with multiple visual styles.",
    {
      notebookId: z.string().describe("The notebook ID"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus the video on a specific topic"),
      format: z
        .enum(["explainer", "brief"])
        .optional()
        .describe("Video format (default: explainer)"),
      style: z
        .enum([
          "auto_select",
          "custom",
          "classic",
          "whiteboard",
          "kawaii",
          "anime",
          "watercolor",
          "retro_print",
          "heritage",
          "paper_craft",
        ])
        .optional()
        .describe("Visual style (default: auto_select)"),
      customStylePrompt: z
        .string()
        .optional()
        .describe("Custom style description (used when style='custom')"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createVideo(params.notebookId, {
          focusPrompt: params.focusPrompt,
          format: params.format,
          style: params.style,
          customStylePrompt: params.customStylePrompt,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_report",
    "Generate an AI report from notebook sources. Supports Briefing Doc, Study Guide, Blog Post, and custom formats.",
    {
      notebookId: z.string().describe("The notebook ID"),
      format: z
        .string()
        .optional()
        .describe(
          "Report format: 'Briefing Doc', 'Study Guide', 'Blog Post', or custom name",
        ),
      customPrompt: z
        .string()
        .optional()
        .describe("Custom instructions for report generation"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createReport(params.notebookId, {
          format: params.format,
          customPrompt: params.customPrompt,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_flashcards",
    "Generate AI flashcards from notebook sources for study and review.",
    {
      notebookId: z.string().describe("The notebook ID"),
      difficulty: z
        .enum(["easy", "medium", "hard"])
        .optional()
        .describe("Difficulty level (default: medium)"),
      count: z
        .number()
        .optional()
        .describe("Number of flashcards to generate"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus on a specific topic"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createFlashcards(
          params.notebookId,
          {
            difficulty: params.difficulty,
            count: params.count,
            focusPrompt: params.focusPrompt,
            sourceIds: params.sourceIds,
          },
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_quiz",
    "Generate an AI quiz from notebook sources for knowledge testing.",
    {
      notebookId: z.string().describe("The notebook ID"),
      difficulty: z
        .enum(["easy", "medium", "hard"])
        .optional()
        .describe("Difficulty level (default: medium)"),
      count: z.number().optional().describe("Number of quiz questions"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus on a specific topic"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createQuiz(params.notebookId, {
          difficulty: params.difficulty,
          count: params.count,
          focusPrompt: params.focusPrompt,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_infographic",
    "Generate an AI infographic from notebook sources.",
    {
      notebookId: z.string().describe("The notebook ID"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus on a specific topic"),
      orientation: z
        .enum(["landscape", "portrait", "square"])
        .optional()
        .describe("Infographic orientation (default: landscape)"),
      detail: z
        .enum(["concise", "standard", "detailed"])
        .optional()
        .describe("Detail level (default: standard)"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createInfographic(
          params.notebookId,
          {
            focusPrompt: params.focusPrompt,
            orientation: params.orientation,
            detail: params.detail,
            sourceIds: params.sourceIds,
          },
        );
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_slide_deck",
    "Generate an AI slide deck (presentation) from notebook sources.",
    {
      notebookId: z.string().describe("The notebook ID"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus on a specific topic"),
      format: z
        .enum(["detailed_deck", "presenter_slides"])
        .optional()
        .describe("Slide format (default: detailed_deck)"),
      length: z
        .enum(["short", "default"])
        .optional()
        .describe("Deck length (default: default)"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createSlideDeck(params.notebookId, {
          focusPrompt: params.focusPrompt,
          format: params.format,
          length: params.length,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_data_table",
    "Generate an AI data table from notebook sources.",
    {
      notebookId: z.string().describe("The notebook ID"),
      focusPrompt: z
        .string()
        .optional()
        .describe("Focus on a specific topic"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createDataTable(params.notebookId, {
          focusPrompt: params.focusPrompt,
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_create_mind_map",
    "Generate an AI mind map from notebook sources.",
    {
      notebookId: z.string().describe("The notebook ID"),
      sourceIds: z
        .array(z.string())
        .optional()
        .describe("Limit to specific source IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.createMindMap(params.notebookId, {
          sourceIds: params.sourceIds,
        });
        return { content: [jsonContent(result)] };
      }),
  );

  server.tool(
    "nlm_studio_status",
    "Check the generation status of studio artifacts in a notebook. Use this to poll whether audio/video/report generation is complete.",
    {
      notebookId: z.string().describe("The notebook ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const status = await client.studio.getStatus(params.notebookId);
        return { content: [jsonContent(status)] };
      }),
  );

  server.tool(
    "nlm_delete_studio_artifact",
    "Delete a studio artifact (audio, video, report, etc.).",
    {
      artifactId: z.string().describe("The artifact ID to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    (params) =>
      withErrorHandling(async () => {
        if (!params.confirm) {
          return {
            content: [
              jsonContent({
                error: "Deletion not confirmed. Set confirm=true to proceed.",
              }),
            ],
          };
        }
        await client.studio.delete(params.artifactId);
        return {
          content: [
            jsonContent({ success: true, message: "Artifact deleted" }),
          ],
        };
      }),
  );

  server.tool(
    "nlm_revise_slide",
    "Revise specific slides in a generated slide deck with natural language instructions.",
    {
      notebookId: z.string().describe("The notebook ID"),
      artifactId: z.string().describe("The slide deck artifact ID"),
      instructions: z
        .array(
          z.object({
            slideIndex: z.number().describe("0-based slide index to revise"),
            instruction: z
              .string()
              .describe("Revision instruction for this slide"),
          }),
        )
        .describe("List of slide revisions"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.studio.reviseSlide(
          params.notebookId,
          params.artifactId,
          params.instructions,
        );
        return { content: [jsonContent(result)] };
      }),
  );
}
