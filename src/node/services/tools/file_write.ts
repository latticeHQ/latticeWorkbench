import { tool } from "ai";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import {
  generateDiff,
  validateAndCorrectPath,
  validatePlanModeAccess,
  validatePathInCwd,
} from "./fileCommon";
import { FILE_EDIT_DIFF_OMITTED_MESSAGE } from "@/common/types/tools";
import { fileExists } from "@/node/utils/runtime/fileExists";
import { readFileString, writeFileString } from "@/node/utils/runtime/helpers";
import { RuntimeError } from "@/node/runtime/Runtime";

import type { FileWriteToolResult } from "@/common/types/tools";

/**
 * file_write tool factory — creates or overwrites entire files.
 * Same approach as Claude Code's Write tool: writes the full content to disk.
 */
export const createFileWriteTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.file_write.description,
    inputSchema: TOOL_DEFINITIONS.file_write.schema,
    execute: async (
      { file_path, content }: { file_path: string; content: string },
      { abortSignal }
    ): Promise<FileWriteToolResult> => {
      try {
        const { correctedPath, warning: pathWarning } = validateAndCorrectPath(
          file_path,
          config.cwd,
          config.runtime
        );
        file_path = correctedPath;
        const resolvedPath = config.runtime.normalizePath(file_path, config.cwd);

        // Validate plan mode access restrictions
        const planModeError = await validatePlanModeAccess(file_path, config);
        if (planModeError) {
          return planModeError;
        }

        // Validate within workspace
        const pathValidation = validatePathInCwd(file_path, config.cwd, config.runtime);
        if (pathValidation) {
          return { success: false as const, error: pathValidation.error };
        }

        // Read existing content for diff (if file exists)
        let oldContent = "";
        const exists = await fileExists(config.runtime, resolvedPath, abortSignal);
        if (exists) {
          try {
            oldContent = await readFileString(config.runtime, resolvedPath, abortSignal);
          } catch {
            // File exists but can't be read — proceed with empty old content
          }
        }

        // Write the file
        try {
          await writeFileString(config.runtime, resolvedPath, content, abortSignal);
        } catch (err) {
          if (err instanceof RuntimeError) {
            return {
              success: false as const,
              error: err.message,
            };
          }
          throw err;
        }

        // Record file state for post-compaction attachment tracking
        if (config.recordFileState) {
          try {
            const newStat = await config.runtime.stat(resolvedPath, abortSignal);
            config.recordFileState(resolvedPath, {
              content,
              timestamp: newStat.modifiedTime.getTime(),
            });
          } catch {
            // File stat failed, skip recording
          }
        }

        const diff = generateDiff(resolvedPath, oldContent, content);

        return {
          success: true as const,
          diff: FILE_EDIT_DIFF_OMITTED_MESSAGE,
          created: !exists,
          ui_only: {
            file_edit: {
              diff,
            },
          },
          ...(pathWarning && { warning: pathWarning }),
        };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EACCES") {
          return {
            success: false as const,
            error: `Permission denied: ${file_path}`,
          };
        }

        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false as const,
          error: `Failed to write file: ${message}`,
        };
      }
    },
  });
};
