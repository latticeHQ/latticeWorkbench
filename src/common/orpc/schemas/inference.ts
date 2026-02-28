import { z } from "zod";

export const ExoNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  gpuName: z.string(),
  gpuMemoryTotal: z.number(),
  gpuMemoryFree: z.number(),
});

export const ExoModelSchema = z.object({
  modelId: z.string(),
  status: z.string(),
});

export const ExoClusterStateSchema = z.object({
  nodes: z.array(ExoNodeSchema),
  models: z.array(ExoModelSchema),
  apiEndpoint: z.string(),
});

export const ExoStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_installed") }),
  z.object({ status: z.literal("installed_not_running"), commandPath: z.string() }),
  z.object({ status: z.literal("running"), clusterState: ExoClusterStateSchema }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
