/**
 * Kanban board tools: list cards, move cards between columns,
 * and view archived screen buffer.
 *
 * The kanban system provides visual task/workflow management within
 * Lattice, organizing minion work into columns/stages.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, withErrorHandling } from "../utils";

const kanbanColumnEnum = z.enum(["queued", "active", "completed", "archived"]);

export function registerKanbanTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List kanban cards ───────────────────────────────────────────────────
  server.tool(
    "kanban_list",
    "List all kanban cards for a minion. Shows task workflow stages " +
      "and which sessions are in each column (queued, active, completed, archived).",
    {
      minionId: z.string().describe("The minion ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const board = await client.kanban.list({ minionId: params.minionId });
        return { content: [jsonContent(board)] };
      })
  );

  // ── Move kanban card ────────────────────────────────────────────────────
  server.tool(
    "kanban_move_card",
    "Move a kanban card to a different column.",
    {
      minionId: z.string().describe("The minion ID"),
      sessionId: z.string().describe("The session ID of the card to move"),
      targetColumn: kanbanColumnEnum.describe("Target column: queued, active, completed, or archived"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.kanban.moveCard({
          minionId: params.minionId,
          sessionId: params.sessionId,
          targetColumn: params.targetColumn,
        });
        return { content: [jsonContent({ message: `Card moved to '${params.targetColumn}'` })] };
      })
  );

  // ── Get archived screen buffer ──────────────────────────────────────────
  server.tool(
    "kanban_get_archived_buffer",
    "Get the archived screen buffer for a kanban card (preserved terminal output).",
    {
      minionId: z.string().describe("The minion ID"),
      sessionId: z.string().describe("The session ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const buffer = await client.kanban.getArchivedBuffer({
          minionId: params.minionId,
          sessionId: params.sessionId,
        });
        return { content: [jsonContent(buffer)] };
      })
  );
}
