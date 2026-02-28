import * as path from "path";
import * as fsPromises from "fs/promises";
import { tool } from "ai";

import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { getErrorMessage } from "@/common/utils/errors";

function getLatticeHomeFromMinionSessionDir(config: ToolConfiguration): string {
  if (!config.minionSessionDir) {
    throw new Error("lattice_global_agents_read requires minionSessionDir");
  }

  // minionSessionDir = <latticeHome>/sessions/<minionId>
  const sessionsDir = path.dirname(config.minionSessionDir);
  return path.dirname(sessionsDir);
}

export interface LatticeGlobalAgentsReadToolResult {
  success: true;
  content: string;
}

export interface LatticeGlobalAgentsReadToolError {
  success: false;
  error: string;
}

export type LatticeGlobalAgentsReadToolOutput =
  | LatticeGlobalAgentsReadToolResult
  | LatticeGlobalAgentsReadToolError;

export const createLatticeGlobalAgentsReadTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.lattice_global_agents_read.description,
    inputSchema: TOOL_DEFINITIONS.lattice_global_agents_read.schema,
    execute: async (
      _args,
      { abortSignal: _abortSignal }
    ): Promise<LatticeGlobalAgentsReadToolOutput> => {
      try {
        if (config.minionId !== LATTICE_HELP_CHAT_MINION_ID) {
          return {
            success: false,
            error: "lattice_global_agents_read is only available in the Chat with Lattice system minion",
          };
        }

        const latticeHome = getLatticeHomeFromMinionSessionDir(config);
        const agentsPath = path.join(latticeHome, "AGENTS.md");

        try {
          const stat = await fsPromises.lstat(agentsPath);
          if (stat.isSymbolicLink()) {
            return {
              success: false,
              error: "Refusing to read a symlinked AGENTS.md target",
            };
          }

          const content = await fsPromises.readFile(agentsPath, "utf-8");
          return { success: true, content };
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return { success: true, content: "" };
          }

          throw error;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          success: false,
          error: `Failed to read global AGENTS.md: ${message}`,
        };
      }
    },
  });
};
