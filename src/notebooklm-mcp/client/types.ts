/**
 * Zod schemas and TypeScript types for NotebookLM API data structures.
 *
 * Ported from notebooklm-mcp-cli (MIT License, jacob-bd).
 */

import { z } from "zod";

// ─── Core Data Types ────────────────────────────────────────────────────────

export const NotebookSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceCount: z.number(),
  sources: z.array(z.record(z.unknown())),
  isOwned: z.boolean().default(true),
  isShared: z.boolean().default(false),
  createdAt: z.string().nullable().default(null),
  modifiedAt: z.string().nullable().default(null),
});
export type Notebook = z.infer<typeof NotebookSchema>;

export const SourceInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  typeCode: z.number().optional(),
  driveDocId: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  canSync: z.boolean().default(false),
  processingStatus: z.string().default("unknown"),
});
export type SourceInfo = z.infer<typeof SourceInfoSchema>;

export const ConversationTurnSchema = z.object({
  query: z.string(),
  answer: z.string(),
  turnNumber: z.number(),
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const CollaboratorSchema = z.object({
  email: z.string(),
  role: z.string(),
  isPending: z.boolean().default(false),
  displayName: z.string().nullable().default(null),
});
export type Collaborator = z.infer<typeof CollaboratorSchema>;

export const ShareStatusSchema = z.object({
  isPublic: z.boolean(),
  accessLevel: z.string(),
  collaborators: z.array(CollaboratorSchema),
  publicLink: z.string().nullable().default(null),
});
export type ShareStatus = z.infer<typeof ShareStatusSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string().default(""),
  content: z.string().default(""),
  notebookId: z.string(),
  createdAt: z.string().nullable().default(null),
  modifiedAt: z.string().nullable().default(null),
});
export type Note = z.infer<typeof NoteSchema>;

// ─── Studio Artifacts ───────────────────────────────────────────────────────

export const StudioArtifactSchema = z.object({
  id: z.string().nullable().default(null),
  type: z.string(),
  status: z.string(),
  title: z.string().default(""),
  url: z.string().nullable().default(null),
  content: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).default({}),
});
export type StudioArtifact = z.infer<typeof StudioArtifactSchema>;

export const StudioStatusSchema = z.object({
  notebookId: z.string(),
  artifacts: z.array(StudioArtifactSchema),
  isGenerating: z.boolean().default(false),
});
export type StudioStatus = z.infer<typeof StudioStatusSchema>;

// ─── Research ───────────────────────────────────────────────────────────────

export const ResearchResultSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().nullable().default(null),
  type: z.string(),
  typeCode: z.number().optional(),
  snippet: z.string().default(""),
});
export type ResearchResult = z.infer<typeof ResearchResultSchema>;

export const ResearchStatusSchema = z.object({
  taskId: z.string(),
  status: z.string(),
  query: z.string().default(""),
  results: z.array(ResearchResultSchema).default([]),
  report: z.string().nullable().default(null),
});
export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

// ─── Auth Types ─────────────────────────────────────────────────────────────

export const AuthTokensSchema = z.object({
  cookies: z.record(z.string()),
  csrfToken: z.string(),
  sessionId: z.string().default(""),
  buildLabel: z.string().default(""),
  extractedAt: z.string().nullable().default(null),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

// ─── Query / Chat ───────────────────────────────────────────────────────────

export const QueryResultSchema = z.object({
  answer: z.string(),
  citedSourceIds: z.array(z.string()).default([]),
  conversationId: z.string().nullable().default(null),
});
export type QueryResult = z.infer<typeof QueryResultSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse a [seconds, nanoseconds] timestamp array to ISO string.
 */
export function parseTimestamp(ts: unknown): string | null {
  if (!Array.isArray(ts) || ts.length < 1) return null;
  const seconds = ts[0];
  if (typeof seconds !== "number") return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Build a notebook URL from its ID.
 */
export function notebookUrl(id: string): string {
  return `https://notebooklm.google.com/notebook/${id}`;
}
