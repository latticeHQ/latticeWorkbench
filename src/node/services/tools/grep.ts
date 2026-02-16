import { tool } from "ai";
import type { GrepToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { validatePathInCwd } from "./fileCommon";
import { execFile } from "child_process";
import { promisify } from "util";
import { rgPath } from "@vscode/ripgrep";

const execFileAsync = promisify(execFile);

/** Default max results */
const DEFAULT_MAX_RESULTS = 200;
/** Max output size in bytes before truncation */
const MAX_OUTPUT_BYTES = 256 * 1024; // 256KB

/**
 * Grep tool factory — uses @vscode/ripgrep binary for content search.
 * Same implementation as Claude Code's Grep tool (ripgrep subprocess).
 */
export const createGrepTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.grep.description,
    inputSchema: TOOL_DEFINITIONS.grep.schema,
    execute: async ({
      pattern,
      path: searchPath,
      glob: globFilter,
      output_mode,
      context,
      case_insensitive,
      max_results,
    }): Promise<GrepToolResult> => {
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

        const maxCount = max_results ?? DEFAULT_MAX_RESULTS;
        const mode = output_mode ?? "files_with_matches";

        // Build ripgrep args
        const args: string[] = [];

        // Output mode
        switch (mode) {
          case "files_with_matches":
            args.push("--files-with-matches");
            break;
          case "count":
            args.push("--count");
            break;
          case "content":
            args.push("--line-number");
            if (context !== undefined && context > 0) {
              args.push(`--context=${context}`);
            }
            break;
        }

        // Case sensitivity
        if (case_insensitive) {
          args.push("--ignore-case");
        }

        // Glob filter
        if (globFilter) {
          args.push("--glob", globFilter);
        }

        // Max count for files_with_matches and count modes
        if (mode !== "content") {
          args.push(`--max-count=1`);
        }

        // Suppress errors for unreadable files
        args.push("--no-messages");

        // Pattern and path
        args.push("--", pattern, baseDir);

        // Execute ripgrep
        let stdout: string;
        let truncated = false;
        try {
          const result = await execFileAsync(rgPath, args, {
            maxBuffer: MAX_OUTPUT_BYTES,
            timeout: 30_000, // 30s timeout
          });
          stdout = result.stdout;
        } catch (e: unknown) {
          // ripgrep exits with code 1 when no matches found (not an error)
          const execErr = e as { code?: number; stdout?: string; stderr?: string };
          if (execErr.code === 1) {
            return {
              success: true as const,
              output: "",
              match_count: 0,
            };
          }
          // Exit code 2+ is an actual error
          if (execErr.code && execErr.code > 1) {
            return {
              success: false as const,
              error: `ripgrep error: ${execErr.stderr || "unknown error"}`,
            };
          }
          // Buffer overflow — use what we got
          if (execErr.stdout) {
            stdout = execErr.stdout;
            truncated = true;
          } else {
            return {
              success: false as const,
              error: `Grep failed: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        }

        // Strip the base dir prefix from output for cleaner results
        const cwdPrefix = baseDir.endsWith("/") ? baseDir : baseDir + "/";
        const lines = stdout.split("\n").filter(Boolean);

        // Apply max_results limit
        if (lines.length > maxCount) {
          truncated = true;
        }
        const limitedLines = lines.slice(0, maxCount);

        // Clean up paths — make relative to search dir
        const output = limitedLines
          .map((line) => (line.startsWith(cwdPrefix) ? line.slice(cwdPrefix.length) : line))
          .join("\n");

        // Count matches
        const matchCount =
          mode === "count"
            ? limitedLines.reduce((sum, line) => {
                const count = parseInt(line.split(":").pop() || "0", 10);
                return sum + (isNaN(count) ? 0 : count);
              }, 0)
            : limitedLines.length;

        return {
          success: true as const,
          output,
          match_count: matchCount,
          ...(truncated ? { truncated: true } : {}),
        };
      } catch (e) {
        return {
          success: false as const,
          error: `Grep failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  });
};
