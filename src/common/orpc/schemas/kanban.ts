import { z } from "zod";

export const KanbanColumnIdSchema = z.enum(["queued", "active", "completed", "archived"]);

/**
 * Card schema for list responses — excludes screenBuffer to keep payloads small.
 * Use kanban.getArchivedBuffer to fetch the full buffer for a specific session.
 */
export const KanbanCardSchema = z.object({
  sessionId: z.string(),
  minionId: z.string(),
  column: KanbanColumnIdSchema,
  profileName: z.string(),
  profileId: z.string().nullish(),
  createdAt: z.number(),
  closedAt: z.number().nullish(),
  archivedAt: z.number().nullish(),
  readOnly: z.boolean(),
  cols: z.number().nullish(),
  rows: z.number().nullish(),
});

export const KanbanListInputSchema = z.object({
  minionId: z.string(),
});

export const KanbanMoveCardInputSchema = z.object({
  minionId: z.string(),
  sessionId: z.string(),
  targetColumn: KanbanColumnIdSchema,
});

export const KanbanSubscribeInputSchema = z.object({
  minionId: z.string(),
});

export const KanbanGetArchivedBufferInputSchema = z.object({
  minionId: z.string(),
  sessionId: z.string(),
});

export const KanbanArchivedBufferOutputSchema = z.object({
  screenBuffer: z.string().nullish(),
});
