import { tool } from "ai";
import type { NotebookEditToolResult } from "@/common/types/tools";
import type { ToolConfiguration, ToolFactory } from "@/common/utils/tools/tools";
import { TOOL_DEFINITIONS } from "@/common/utils/tools/toolDefinitions";
import { validatePathInCwd, validateAndCorrectPath } from "./fileCommon";
import { readFileString, writeFileString } from "@/node/utils/runtime/helpers";

interface NotebookCell {
  cell_type: string;
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
}

interface NotebookDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

/**
 * Create a new notebook cell with the given type and source.
 */
function createCell(cellType: string, source: string): NotebookCell {
  const cell: NotebookCell = {
    cell_type: cellType,
    source: source.split("\n").map((line, i, arr) => (i < arr.length - 1 ? line + "\n" : line)),
    metadata: {},
  };
  if (cellType === "code") {
    cell.outputs = [];
    cell.execution_count = null;
  }
  return cell;
}

/**
 * NotebookEdit tool factory — reads, parses, mutates, and writes .ipynb JSON.
 * Same approach as Claude Code's NotebookEdit tool.
 */
export const createNotebookEditTool: ToolFactory = (config: ToolConfiguration) => {
  return tool({
    description: TOOL_DEFINITIONS.notebook_edit.description,
    inputSchema: TOOL_DEFINITIONS.notebook_edit.schema,
    execute: async ({
      file_path,
      operation,
      cell_index,
      cell_type,
      source,
    }): Promise<NotebookEditToolResult> => {
      try {
        let filePath = file_path;

        // Validate path
        const { correctedPath, warning: pathWarning } = validateAndCorrectPath(
          filePath,
          config.cwd,
          config.runtime
        );
        filePath = correctedPath;

        // Validate .ipynb extension
        if (!filePath.endsWith(".ipynb")) {
          return {
            success: false as const,
            error: `File must be a Jupyter notebook (.ipynb): ${filePath}`,
          };
        }

        const resolvedPath = config.runtime.normalizePath(filePath, config.cwd);

        // Validate within workspace
        const pathValidation = validatePathInCwd(filePath, config.cwd, config.runtime);
        if (pathValidation) {
          return { success: false as const, error: pathValidation.error };
        }

        // Validate operation-specific requirements
        if ((operation === "insert" || operation === "replace") && source === undefined) {
          return {
            success: false as const,
            error: `'source' is required for ${operation} operation`,
          };
        }
        if (operation === "insert" && !cell_type) {
          return {
            success: false as const,
            error: "'cell_type' is required for insert operation",
          };
        }

        // Read and parse notebook
        let notebook: NotebookDocument;
        try {
          const content = await readFileString(config.runtime, resolvedPath);
          notebook = JSON.parse(content) as NotebookDocument;
        } catch (e) {
          return {
            success: false as const,
            error: `Failed to read/parse notebook: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        // Validate notebook structure
        if (!Array.isArray(notebook.cells)) {
          return {
            success: false as const,
            error: "Invalid notebook: missing 'cells' array",
          };
        }

        // Execute operation
        switch (operation) {
          case "insert": {
            if (cell_index > notebook.cells.length) {
              return {
                success: false as const,
                error: `Cell index ${cell_index} out of range (notebook has ${notebook.cells.length} cells)`,
              };
            }
            const newCell = createCell(cell_type!, source!);
            notebook.cells.splice(cell_index, 0, newCell);
            break;
          }
          case "replace": {
            if (cell_index >= notebook.cells.length) {
              return {
                success: false as const,
                error: `Cell index ${cell_index} out of range (notebook has ${notebook.cells.length} cells)`,
              };
            }
            const existingType = cell_type ?? notebook.cells[cell_index].cell_type;
            notebook.cells[cell_index] = createCell(existingType, source!);
            break;
          }
          case "delete": {
            if (cell_index >= notebook.cells.length) {
              return {
                success: false as const,
                error: `Cell index ${cell_index} out of range (notebook has ${notebook.cells.length} cells)`,
              };
            }
            notebook.cells.splice(cell_index, 1);
            break;
          }
        }

        // Write back
        const output = JSON.stringify(notebook, null, 1) + "\n";
        await writeFileString(config.runtime, resolvedPath, output);

        const warnings = pathWarning ? ` (${pathWarning})` : "";

        return {
          success: true as const,
          message: `${operation}d cell at index ${cell_index}${warnings}`,
          total_cells: notebook.cells.length,
        };
      } catch (e) {
        return {
          success: false as const,
          error: `NotebookEdit failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  });
};
