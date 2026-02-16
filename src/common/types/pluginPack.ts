import type { z } from "zod";
import type {
  PluginPackNameSchema,
  PluginPackDescriptorSchema,
  PluginPackMcpServerSchema,
} from "@/common/orpc/schemas/pluginPack";

export type PluginPackName = z.infer<typeof PluginPackNameSchema>;
export type PluginPackDescriptor = z.infer<typeof PluginPackDescriptorSchema>;
export type PluginPackMcpServer = z.infer<typeof PluginPackMcpServerSchema>;
