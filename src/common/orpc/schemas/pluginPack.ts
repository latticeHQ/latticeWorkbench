import { z } from "zod";

export const PluginPackNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const PluginPackDescriptorSchema = z.object({
  name: PluginPackNameSchema,
  version: z.string(),
  description: z.string(),
  author: z.string(),
  skillCount: z.number(),
  commandCount: z.number(),
  mcpServerCount: z.number(),
  enabled: z.boolean(),
});

export const PluginPackMcpServerSchema = z.object({
  transport: z.string(),
  url: z.string(),
});
