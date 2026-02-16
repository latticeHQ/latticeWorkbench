import { tool } from "ai";
import type { GlobToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { validatePathInCwd } from "./fileCommon";
import fg from "fast-glob";
import * as path from "path";
import * as fs from "fs";

/** Maximum number of files to return from a glob operation */
const MAX_GLOB_RESULTS = 500;

/**
 * Glob tool factory — uses fast-glob for native in-process file matching.
 * Same implementation approach as Claude Code's Glob tool.
 */
export const createGlobTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.glob.description,
    inputSchema: TOOL_DEFINITIONS.glob.schema,
    execute: async ({ pattern, path: searchPath }): Promise<GlobToolResult> => {
      try {
        // Resolve search directory
        const baseDir = searchPath
          ? config.runtime.normalizePath(searchPath, config.cwd)
          : config.cwd;

        // Validate that the search path is within workspace
        if (searchPath) {
          const pathValidation = validatePathInCwd(baseDir, config.cwd, config.runtime);
          if (pathValidation) {
            return { success: false as const, error: pathValidation.error };
          }
        }

        // Run fast-glob in-process (same as Claude Code)
        const entries = await fg(pattern, {
          cwd: baseDir,
          absolute: false,
          dot: false,
          onlyFiles: true,
          followSymbolicLinks: false,
          suppressErrors: true,
          // Ignore common non-useful directories
          ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/__pycache__/**"],
        });

        // Sort by modification time (most recent first)
        const withStats = await Promise.all(
          entries.slice(0, MAX_GLOB_RESULTS + 100).map(async (entry) => {
            const fullPath = path.join(baseDir, entry);
            try {
              const stat = await fs.promises.stat(fullPath);
              return { path: entry, mtime: stat.mtimeMs };
            } catch {
              return { path: entry, mtime: 0 };
            }
          })
        );

        withStats.sort((a, b) => b.mtime - a.mtime);

        const truncated = withStats.length > MAX_GLOB_RESULTS;
        const files = withStats.slice(0, MAX_GLOB_RESULTS).map((e) => e.path);

        return {
          success: true as const,
          files,
          count: files.length,
          ...(truncated ? { truncated: true } : {}),
        };
      } catch (e) {
        return {
          success: false as const,
          error: `Glob failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  });
};
