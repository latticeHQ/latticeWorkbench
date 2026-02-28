import * as path from "path";
import * as fsPromises from "fs/promises";
import { tool } from "ai";

import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { FILE_EDIT_DIFF_OMITTED_MESSAGE } from "@/common/types/tools";
import { generateDiff } from "./fileCommon";
import { getErrorMessage } from "@/common/utils/errors";

function getLatticeHomeFromMinionSessionDir(config: ToolConfiguration): string {
  if (!config.minionSessionDir) {
    throw new Error("lattice_global_agents_write requires minionSessionDir");
  }

  // minionSessionDir = <latticeHome>/sessions/<minionId>
  const sessionsDir = path.dirname(config.minionSessionDir);
  return path.dirname(sessionsDir);
}

export interface LatticeGlobalAgentsWriteToolArgs {
  newContent: string;
  confirm: boolean;
}

export interface LatticeGlobalAgentsWriteToolResult {
  success: true;
  diff: string;
  ui_only?: {
    file_edit?: {
      diff: string;
    };
  };
}

export interface LatticeGlobalAgentsWriteToolError {
  success: false;
  error: string;
}

export type LatticeGlobalAgentsWriteToolOutput =
  | LatticeGlobalAgentsWriteToolResult
  | LatticeGlobalAgentsWriteToolError;

export const createLatticeGlobalAgentsWriteTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.lattice_global_agents_write.description,
    inputSchema: TOOL_DEFINITIONS.lattice_global_agents_write.schema,
    execute: async (
      args: LatticeGlobalAgentsWriteToolArgs,
      { abortSignal: _abortSignal }
    ): Promise<LatticeGlobalAgentsWriteToolOutput> => {
      try {
        if (config.minionId !== LATTICE_HELP_CHAT_MINION_ID) {
          return {
            success: false,
            error:
              "lattice_global_agents_write is only available in the Chat with Lattice system minion",
          };
        }

        if (!args.confirm) {
          return {
            success: false,
            error: "Refusing to write global AGENTS.md without confirm: true",
          };
        }

        const latticeHome = getLatticeHomeFromMinionSessionDir(config);
        await fsPromises.mkdir(latticeHome, { recursive: true });

        // Canonicalize latticeHome before constructing the file path.
        const latticeHomeReal = await fsPromises.realpath(latticeHome);
        const agentsPath = path.join(latticeHomeReal, "AGENTS.md");

        let originalContent = "";
        try {
          const stat = await fsPromises.lstat(agentsPath);
          if (stat.isSymbolicLink()) {
            return {
              success: false,
              error: "Refusing to write a symlinked AGENTS.md target",
            };
          }
          originalContent = await fsPromises.readFile(agentsPath, "utf-8");

          // If the file exists, ensure its resolved path matches the resolved latticeHome target.
          const agentsPathReal = await fsPromises.realpath(agentsPath);
          if (agentsPathReal !== agentsPath) {
            return {
              success: false,
              error: "Refusing to write global AGENTS.md (path resolution mismatch)",
            };
          }
        } catch (error) {
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
          // File missing is OK (will create).
        }

        await fsPromises.writeFile(agentsPath, args.newContent, "utf-8");

        const diff = generateDiff(agentsPath, originalContent, args.newContent);

        return {
          success: true,
          diff: FILE_EDIT_DIFF_OMITTED_MESSAGE,
          ui_only: {
            file_edit: {
              diff,
            },
          },
        };
      } catch (error) {
        const message = getErrorMessage(error);
        return {
          success: false,
          error: `Failed to write global AGENTS.md: ${message}`,
        };
      }
    },
  });
};
