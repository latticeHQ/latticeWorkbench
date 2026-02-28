import * as fs from "fs/promises";
import * as path from "path";

import type { TodoItem } from "@/common/types/tools";

const TODO_FILE_NAME = "todos.json";

/**
 * Get path to todos.json file in the minion's session directory.
 */
export function getTodoFilePath(minionSessionDir: string): string {
  return path.join(minionSessionDir, TODO_FILE_NAME);
}

export function coerceTodoItems(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: TodoItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;

    const content = (item as { content?: unknown }).content;
    const status = (item as { status?: unknown }).status;

    if (typeof content !== "string") continue;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;

    result.push({ content, status });
  }

  return result;
}

/**
 * Read todos from the minion session directory.
 */
export async function readTodosForSessionDir(minionSessionDir: string): Promise<TodoItem[]> {
  const todoFile = getTodoFilePath(minionSessionDir);

  try {
    const content = await fs.readFile(todoFile, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return coerceTodoItems(parsed);
  } catch (error) {
    // File doesn't exist yet or is invalid
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    return [];
  }
}
