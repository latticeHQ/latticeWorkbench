import { z } from "zod";

export const ReflectionTriggerSchema = z.enum(["soft_limit", "revert", "manual"]);

export const ReflectionSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  trigger: ReflectionTriggerSchema,
  phase: z.string().optional(),
  turnCount: z.number(),
  content: z.string(),
  resolved: z.boolean(),
});

export type ReflectionData = z.infer<typeof ReflectionSchema>;
