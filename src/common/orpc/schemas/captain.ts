/**
 * Captain oRPC Schemas
 *
 * Zod schemas for the Captain API endpoints.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

const CaptainIdentitySchema = z.object({
  name: z.string(),
  personality: z.object({
    traits: z.array(z.string()),
    communication_style: z.string(),
    values: z.array(z.string()),
    opinions: z.record(z.string(), z.string()),
  }),
  preferences: z.object({
    default_model: z.string(),
    thinking_depth: z.enum(["shallow", "medium", "deep"]),
    proactivity_level: z.enum(["low", "medium", "high"]),
    delegation_threshold: z.string(),
  }),
  formed_at: z.string(),
  last_updated: z.string(),
});

const CaptainGoalSchema: z.ZodType<unknown> = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  description: z.string(),
  status: z.enum(["pending", "active", "decomposed", "completed", "failed", "cancelled"]),
  priority: z.number(),
  source: z.enum(["user", "self", "event"]),
  subGoals: z.array(z.lazy(() => CaptainGoalSchema)),
  workers: z.array(z.object({
    id: z.string(),
    goalId: z.string(),
    type: z.enum(["local", "remote"]),
    agentName: z.string(),
    taskDescription: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "timeout"]),
    result: z.string().optional(),
    createdAt: z.number(),
    completedAt: z.number().optional(),
  })),
  context: z.record(z.string(), z.unknown()),
  result: z.unknown().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  completedAt: z.number().optional(),
});

const CaptainMemorySchema = z.object({
  id: z.string(),
  type: z.enum(["episodic", "semantic", "relational", "procedural"]),
  content: z.string(),
  importance: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
});

const CaptainMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
  timestamp: z.number(),
});

const CaptainWorkerSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  type: z.enum(["local", "remote"]),
  minionId: z.string().optional(),
  agentId: z.string().optional(),
  agentName: z.string(),
  taskDescription: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "timeout"]),
  result: z.string().optional(),
  createdAt: z.number(),
  completedAt: z.number().optional(),
});

const CaptainCanvasNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
});

const CaptainCanvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
  animated: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Endpoint Schemas
// ---------------------------------------------------------------------------

export const captain = {
  // Lifecycle
  get: {
    input: z.void(),
    output: z.object({
      identity: CaptainIdentitySchema,
      isRunning: z.boolean(),
      tickCount: z.number(),
    }),
  },
  updateIdentity: {
    input: CaptainIdentitySchema.partial(),
    output: CaptainIdentitySchema,
  },
  enable: {
    input: z.void(),
    output: z.object({ success: z.boolean() }),
  },
  disable: {
    input: z.void(),
    output: z.object({ success: z.boolean() }),
  },

  // Goals
  submitGoal: {
    input: z.object({
      description: z.string(),
      priority: z.number().optional(),
    }),
    output: z.object({ goalId: z.string() }),
  },
  listGoals: {
    input: z.void(),
    output: z.array(CaptainGoalSchema),
  },
  cancelGoal: {
    input: z.object({ goalId: z.string() }),
    output: z.object({ success: z.boolean() }),
  },

  // Messages
  sendMessage: {
    input: z.object({ content: z.string() }),
    output: z.object({ success: z.boolean() }),
  },
  getMessages: {
    input: z.void(),
    output: z.array(CaptainMessageSchema),
  },

  // Memory
  getMemories: {
    input: z.object({
      type: z.enum(["episodic", "semantic", "relational", "procedural"]).optional(),
    }).optional(),
    output: z.array(CaptainMemorySchema),
  },

  // Workers
  getWorkers: {
    input: z.void(),
    output: z.array(CaptainWorkerSchema),
  },

  // Canvas
  getCanvasState: {
    input: z.void(),
    output: z.object({
      nodes: z.array(CaptainCanvasNodeSchema),
      edges: z.array(CaptainCanvasEdgeSchema),
    }),
  },
};
