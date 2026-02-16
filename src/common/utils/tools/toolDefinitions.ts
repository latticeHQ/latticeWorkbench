/**
 * Tool definitions module - Frontend-safe
 *
 * Single source of truth for all tool definitions.
 * Zod schemas are defined here and JSON schemas are auto-generated.
 */

import { z } from "zod";
import { AgentIdSchema, AgentSkillPackageSchema, SkillNameSchema } from "@/common/orpc/schemas";
import {
  BASH_HARD_MAX_LINES,
  BASH_MAX_LINE_BYTES,
  BASH_MAX_TOTAL_BYTES,
  STATUS_MESSAGE_MAX_LENGTH,
  WEB_FETCH_MAX_OUTPUT_BYTES,
} from "@/common/constants/toolLimits";
import { TOOL_EDIT_WARNING } from "@/common/types/tools";
import { SYSTEM1_BASH_OUTPUT_COMPACTION_LIMITS } from "@/common/types/tasks";
import { CLI_AGENT_DEFINITIONS, CLI_AGENT_SLUGS } from "@/common/constants/cliAgents";

import { zodToJsonSchema } from "zod-to-json-schema";

// -----------------------------------------------------------------------------
// ask_user_question (plan-mode interactive questions)
// -----------------------------------------------------------------------------

export const AskUserQuestionOptionSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const AskUserQuestionQuestionSchema = z
  .object({
    question: z.string().min(1),
    header: z.string().min(1).max(32).describe("Short label shown in the UI (keep it concise)"),
    options: z.array(AskUserQuestionOptionSchema).min(2).max(4),
    multiSelect: z.boolean(),
  })
  .strict()
  .superRefine((question, ctx) => {
    const labels = question.options.map((o) => o.label);
    const labelSet = new Set(labels);
    if (labelSet.size !== labels.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Option labels must be unique within a question",
        path: ["options"],
      });
    }

    // Claude Code provides "Other" automatically; do not include it explicitly.
    if (labels.some((label) => label.trim().toLowerCase() === "other")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not include an 'Other' option; it is provided automatically",
        path: ["options"],
      });
    }
  });

const AskUserQuestionUiOnlySchema = z.object({
  questions: z.array(AskUserQuestionQuestionSchema),
  answers: z.record(z.string(), z.string()),
});

const ToolOutputUiOnlySchema = z.object({
  ask_user_question: AskUserQuestionUiOnlySchema.optional(),
  file_edit: z
    .object({
      diff: z.string(),
    })
    .optional(),
  notify: z
    .object({
      notifiedVia: z.enum(["electron", "browser"]),
      workspaceId: z.string().optional(),
    })
    .optional(),
});

const ToolOutputUiOnlyFieldSchema = {
  ui_only: ToolOutputUiOnlySchema.optional(),
};

export const AskUserQuestionToolArgsSchema = z
  .object({
    questions: z.array(AskUserQuestionQuestionSchema).min(1).max(4),
    // Optional prefilled answers (Claude Code supports this, though Lattice typically won't use it)
    answers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((args, ctx) => {
    const questionTexts = args.questions.map((q) => q.question);
    const questionTextSet = new Set(questionTexts);
    if (questionTextSet.size !== questionTexts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Question text must be unique across questions",
        path: ["questions"],
      });
    }
  });

const AskUserQuestionToolSummarySchema = z
  .object({
    summary: z.string(),
  })
  .extend(ToolOutputUiOnlyFieldSchema);

const AskUserQuestionToolLegacySchema = z
  .object({
    questions: z.array(AskUserQuestionQuestionSchema),
    answers: z.record(z.string(), z.string()),
  })
  .strict();

export const AskUserQuestionToolResultSchema = z.union([
  AskUserQuestionToolSummarySchema,
  AskUserQuestionToolLegacySchema,
]);

// -----------------------------------------------------------------------------
// task (sub-workspaces as subagents)
// -----------------------------------------------------------------------------

const SubagentTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  AgentIdSchema
);

const TaskAgentIdSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  AgentIdSchema
);

const TaskToolAgentArgsSchema = z
  .object({
    // Prefer agentId. subagent_type is a deprecated alias for backwards compatibility.
    agentId: TaskAgentIdSchema.optional(),
    subagent_type: SubagentTypeSchema.optional(),
    prompt: z.string().min(1),
    title: z.string().min(1),
    run_in_background: z.boolean().default(false),
  })
  .strict();

/**
 * Normalize task tool args after parsing.
 * Handles backwards compatibility and defaults.
 * Call this after parsing with TaskToolArgsSchema.
 */
export function normalizeTaskToolArgs(
  args: z.infer<typeof TaskToolAgentArgsSchema>
): z.infer<typeof TaskToolAgentArgsSchema> {
  const hasAgentId = typeof args.agentId === "string" && args.agentId.length > 0;
  const hasSubagentType = typeof args.subagent_type === "string" && args.subagent_type.length > 0;

  // Default to "task" agent when neither is provided (LLMs sometimes omit the field).
  if (!hasAgentId && !hasSubagentType) {
    return { ...args, agentId: "task" };
  }

  // If both are provided, prefer agentId and drop subagent_type.
  if (hasAgentId && hasSubagentType) {
    return { ...args, subagent_type: undefined };
  }

  return args;
}

export const TaskToolArgsSchema = TaskToolAgentArgsSchema;

export const TaskToolQueuedResultSchema = z
  .object({
    status: z.enum(["queued", "running"]),
    taskId: z.string(),
  })
  .strict();

export const TaskToolCompletedResultSchema = z
  .object({
    status: z.literal("completed"),
    taskId: z.string().optional(),
    reportMarkdown: z.string(),
    title: z.string().optional(),
    agentId: z.string().optional(),
    agentType: z.string().optional(),
  })
  .strict();

export const TaskToolResultSchema = z.discriminatedUnion("status", [
  TaskToolQueuedResultSchema,
  TaskToolCompletedResultSchema,
]);

// -----------------------------------------------------------------------------
// task_await (await one or more sub-agent tasks)
// -----------------------------------------------------------------------------

export const TaskAwaitToolArgsSchema = z
  .object({
    task_ids: z
      .array(z.string().min(1))
      .optional()
      .describe(
        "List of task IDs to await. When omitted, waits for all active descendant tasks of the current workspace."
      ),
    filter: z
      .string()
      .optional()
      .describe(
        "Optional regex to filter bash task output lines. By default, only matching lines are returned. " +
          "When filter_exclude is true, matching lines are excluded instead. " +
          "Non-matching lines are discarded and cannot be retrieved later."
      ),
    filter_exclude: z
      .boolean()
      .optional()
      .describe(
        "When true, lines matching 'filter' are excluded instead of kept. " +
          "Requires 'filter' to be set."
      ),
    timeout_secs: z
      .number()
      .min(0)
      .optional()
      .default(600)
      .describe(
        "Maximum time to wait in seconds for each task. " +
          "For bash tasks, this waits for NEW output (or process exit). " +
          "If exceeded, the result returns status=queued|running|awaiting_report (task is still active). " +
          "Defaults to 600 seconds (10 minutes) if not specified. " +
          "Set to 0 for a non-blocking status check."
      ),
  })
  .strict()
  .superRefine((args, ctx) => {
    if (args.filter_exclude && !args.filter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "filter_exclude requires filter to be set",
        path: ["filter_exclude"],
      });
    }
  });

export const TaskAwaitToolCompletedResultSchema = z
  .object({
    status: z.literal("completed"),
    taskId: z.string(),
    reportMarkdown: z.string(),
    title: z.string().optional(),
    output: z.string().optional(),
    elapsed_ms: z.number().optional(),
    exitCode: z.number().optional(),
    note: z.string().optional(),
  })
  .strict();

export const TaskAwaitToolActiveResultSchema = z
  .object({
    status: z.enum(["queued", "running", "awaiting_report"]),
    taskId: z.string(),
    output: z.string().optional(),
    elapsed_ms: z.number().optional(),
    note: z.string().optional(),
  })
  .strict();

export const TaskAwaitToolNotFoundResultSchema = z
  .object({
    status: z.literal("not_found"),
    taskId: z.string(),
  })
  .strict();

export const TaskAwaitToolInvalidScopeResultSchema = z
  .object({
    status: z.literal("invalid_scope"),
    taskId: z.string(),
  })
  .strict();

export const TaskAwaitToolErrorResultSchema = z
  .object({
    status: z.literal("error"),
    taskId: z.string(),
    error: z.string(),
  })
  .strict();

export const TaskAwaitToolResultSchema = z
  .object({
    results: z.array(
      z.discriminatedUnion("status", [
        TaskAwaitToolCompletedResultSchema,
        TaskAwaitToolActiveResultSchema,
        TaskAwaitToolNotFoundResultSchema,
        TaskAwaitToolInvalidScopeResultSchema,
        TaskAwaitToolErrorResultSchema,
      ])
    ),
  })
  .strict();

// -----------------------------------------------------------------------------
// task_terminate (terminate one or more sub-agent tasks)
// -----------------------------------------------------------------------------

export const TaskTerminateToolArgsSchema = z
  .object({
    task_ids: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "List of task IDs to terminate. Each must be a descendant sub-agent task of the current workspace."
      ),
  })
  .strict();

export const TaskTerminateToolTerminatedResultSchema = z
  .object({
    status: z.literal("terminated"),
    taskId: z.string(),
    terminatedTaskIds: z
      .array(z.string())
      .describe("All terminated task IDs (includes descendants)"),
  })
  .strict();

export const TaskTerminateToolNotFoundResultSchema = z
  .object({
    status: z.literal("not_found"),
    taskId: z.string(),
  })
  .strict();

export const TaskTerminateToolInvalidScopeResultSchema = z
  .object({
    status: z.literal("invalid_scope"),
    taskId: z.string(),
  })
  .strict();

export const TaskTerminateToolErrorResultSchema = z
  .object({
    status: z.literal("error"),
    taskId: z.string(),
    error: z.string(),
  })
  .strict();

export const TaskTerminateToolResultSchema = z
  .object({
    results: z.array(
      z.discriminatedUnion("status", [
        TaskTerminateToolTerminatedResultSchema,
        TaskTerminateToolNotFoundResultSchema,
        TaskTerminateToolInvalidScopeResultSchema,
        TaskTerminateToolErrorResultSchema,
      ])
    ),
  })
  .strict();

// -----------------------------------------------------------------------------
// task_list (list descendant sub-agent tasks)
// -----------------------------------------------------------------------------

const TaskListStatusSchema = z.enum(["queued", "running", "awaiting_report", "reported"]);
const TaskListThinkingLevelSchema = z.enum(["off", "low", "medium", "high", "xhigh"]);

export const TaskListToolArgsSchema = z
  .object({
    statuses: z
      .array(TaskListStatusSchema)
      .optional()
      .describe(
        "Task statuses to include. Defaults to active tasks: queued, running, awaiting_report."
      ),
  })
  .strict();

export const TaskListToolTaskSchema = z
  .object({
    taskId: z.string(),
    status: TaskListStatusSchema,
    parentWorkspaceId: z.string(),
    agentType: z.string().optional(),
    workspaceName: z.string().optional(),
    title: z.string().optional(),
    createdAt: z.string().optional(),
    modelString: z.string().optional(),
    thinkingLevel: TaskListThinkingLevelSchema.optional(),
    depth: z.number().int().min(0),
  })
  .strict();

export const TaskListToolResultSchema = z
  .object({
    tasks: z.array(TaskListToolTaskSchema),
  })
  .strict();

// -----------------------------------------------------------------------------
// agent_report (explicit subagent -> parent report)
// -----------------------------------------------------------------------------

export const AgentReportToolArgsSchema = z
  .object({
    reportMarkdown: z.string().min(1),
    title: z.string().optional(),
  })
  .strict();

export const AgentReportToolResultSchema = z.object({ success: z.literal(true) }).strict();
const FILE_EDIT_FILE_PATH = z
  .string()
  .describe("Path to the file to edit (absolute or relative to the current workspace)");

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Tool definitions: single source of truth
 * Key = tool name, Value = { description, schema }
 */
export const TOOL_DEFINITIONS = {
  bash: {
    description:
      "Execute a bash command with a configurable timeout. " +
      `Output is strictly limited to ${BASH_HARD_MAX_LINES} lines, ${BASH_MAX_LINE_BYTES} bytes per line, and ${BASH_MAX_TOTAL_BYTES} bytes total. ` +
      "Commands that exceed these limits will FAIL with an error (no partial output returned). " +
      "Be conservative: use 'head', 'tail', 'grep', or other filters to limit output before running commands. " +
      "Large outputs may be automatically filtered; when this happens, the result includes a note explaining what was kept and (if available) where the full output was saved.",
    schema: z.preprocess(
      (value) => {
        // Compatibility: some models emit { command: "..." } instead of { script: "..." }.
        // Normalize to `script` so downstream code (tool runner + UI) stays consistent.
        if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

        const obj = value as Record<string, unknown>;
        if (typeof obj.script === "string") return value;

        if (typeof obj.command === "string") {
          // Drop the legacy field to keep tool args canonical (and avoid confusing downstream consumers).
          const { command, ...rest } = obj as Record<string, unknown> & { command: string };
          return { ...rest, script: command };
        }

        return value;
      },
      z.object({
        script: z.string().describe("The bash script/command to execute"),
        timeout_secs: z
          .number()
          .positive()
          .describe(
            "Timeout in seconds. For foreground: max execution time before kill. " +
              "For background: max lifetime before auto-termination. " +
              "Start small and increase on retry; avoid large initial values to keep UX responsive"
          ),
        run_in_background: z
          .boolean()
          .default(false)
          .describe(
            "Run this command in the background without blocking. " +
              "Use for processes running >5s (dev servers, builds, file watchers). " +
              "Do NOT use for quick commands (<5s), interactive processes (no stdin support), " +
              "or processes requiring real-time output (use foreground with larger timeout instead). " +
              "Returns immediately with a taskId (bash:<processId>) and backgroundProcessId. " +
              "Read output with task_await (returns only new output since last check). " +
              "Terminate with task_terminate using the taskId. " +
              "List active tasks with task_list. " +
              "Process persists until timeout_secs expires, terminated, or workspace is removed." +
              "\\n\\nFor long-running tasks like builds or compilations, prefer background mode to continue productive work in parallel. " +
              "Check back periodically with task_await rather than blocking on completion."
          ),
        display_name: z
          .string()
          .describe(
            "Human-readable name for the process (e.g., 'Dev Server', 'TypeCheck Watch'). " +
              "Required for all bash invocations since any process can be sent to background."
          ),
      })
    ),
  },
  file_read: {
    description:
      "Read the contents of a file from the file system. Read as little as possible to complete the task.",
    schema: z.object({
      file_path: z.string().describe("The path to the file to read (absolute or relative)"),
      offset: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("1-based starting line number (optional, defaults to 1)"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of lines to return from offset (optional, returns all if not specified)"),
    }),
  },
  lattice_global_agents_read: {
    description:
      "Read the global AGENTS.md file (lattice-wide agent instructions) from the lattice home directory.",
    schema: z.object({}).strict(),
  },
  lattice_global_agents_write: {
    description:
      "Write the global AGENTS.md file (lattice-wide agent instructions) in the lattice home directory. " +
      "Requires explicit confirmation via confirm: true.",
    schema: z
      .object({
        newContent: z.string().describe("The full new contents of the global AGENTS.md file"),
        confirm: z
          .boolean()
          .describe(
            "Must be true to apply the write. The agent should ask the user for confirmation first."
          ),
      })
      .strict(),
  },
  agent_skill_read: {
    description:
      "Load an Agent Skill's SKILL.md (YAML frontmatter + markdown body) by name. " +
      "Skills are discovered from <projectRoot>/.lattice/skills/<name>/SKILL.md and ~/.lattice/skills/<name>/SKILL.md.",
    schema: z
      .object({
        name: SkillNameSchema.describe("Skill name (directory name under the skills root)"),
      })
      .strict(),
  },
  agent_skill_read_file: {
    description:
      "Read a file within an Agent Skill directory. " +
      "filePath must be relative to the skill directory (no absolute paths, no ~, no .. traversal). " +
      "Supports offset/limit like file_read.",
    schema: z
      .object({
        name: SkillNameSchema.describe("Skill name (directory name under the skills root)"),
        filePath: z
          .string()
          .min(1)
          .describe("Path to the file within the skill directory (relative)"),
        offset: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based starting line number (optional, defaults to 1)"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Number of lines to return from offset (optional, returns all if not specified)"
          ),
      })
      .strict(),
  },

  file_write: {
    description:
      "Write content to a file, creating it if it doesn't exist or overwriting if it does. " +
      "Use this for creating new files or completely replacing file contents. " +
      "For partial edits, prefer file_edit_replace_string or file_edit_insert instead.",
    schema: z.object({
      file_path: z
        .string()
        .describe("Path to the file to write (absolute or relative to the current workspace)"),
      content: z.string().describe("The full content to write to the file"),
    }),
  },
  file_edit_replace_string: {
    description:
      "⚠️ CRITICAL: Always check tool results - edits WILL fail if old_string is not found or unique. Do not proceed with dependent operations (commits, pushes, builds) until confirming success.\n\n" +
      "Apply one or more edits to a file by replacing exact text matches. All edits are applied sequentially. Each old_string must be unique in the file unless replace_count > 1 or replace_count is -1.",
    schema: z.object({
      file_path: FILE_EDIT_FILE_PATH,
      old_string: z
        .string()
        .describe(
          "The exact text to replace (must be unique in file if replace_count is 1). Include enough context (indentation, surrounding lines) to make it unique."
        ),
      new_string: z.string().describe("The replacement text"),
      replace_count: z
        .number()
        .int()
        .optional()
        .describe(
          "Number of occurrences to replace (default: 1). Use -1 to replace all occurrences. If 1, old_string must be unique in the file."
        ),
    }),
  },
  file_edit_replace_lines: {
    description:
      "⚠️ CRITICAL: Always check tool results - edits WILL fail if line numbers are invalid or file content has changed. Do not proceed with dependent operations (commits, pushes, builds) until confirming success.\n\n" +
      "Replace a range of lines in a file. Use this for line-based edits when you know the exact line numbers to modify.",
    schema: z.object({
      file_path: FILE_EDIT_FILE_PATH,
      start_line: z.number().int().min(1).describe("1-indexed start line (inclusive) to replace"),
      end_line: z.number().int().min(1).describe("1-indexed end line (inclusive) to replace"),
      new_lines: z
        .array(z.string())
        .describe("Replacement lines. Provide an empty array to delete the specified range."),
      expected_lines: z
        .array(z.string())
        .optional()
        .describe(
          "Optional safety check. When provided, the current lines in the specified range must match exactly."
        ),
    }),
  },
  file_edit_insert: {
    description:
      "Insert content into a file using substring guards. " +
      "Provide exactly one of before or after to anchor the operation when editing an existing file. " +
      "When the file does not exist, it is created automatically without guards. " +
      "Optional before/after substrings must uniquely match surrounding content. " +
      "Avoid short guards like `}` or `}\\n` that match multiple locations — " +
      `use longer patterns like full function signatures or unique comments. ${TOOL_EDIT_WARNING}`,
    schema: z
      .object({
        file_path: FILE_EDIT_FILE_PATH,
        content: z.string().describe("The content to insert"),
        before: z
          .string()
          .min(1)
          .optional()
          .describe("Optional substring that must appear immediately before the insertion point"),
        after: z
          .string()
          .min(1)
          .optional()
          .describe("Optional substring that must appear immediately after the insertion point"),
      })
      .refine((data) => !(data.before !== undefined && data.after !== undefined), {
        message: "Provide only one of before or after (not both).",
        path: ["before"],
      }),
  },
  ask_user_question: {
    description:
      "Ask 1–4 multiple-choice questions (with optional multi-select) and wait for the user's answers. " +
      "This tool is intended for plan mode and MUST be used when you need user clarification to complete the plan. " +
      "Do not output a list of open questions; ask them via this tool instead. " +
      "Each question must include 2–4 options; an 'Other' choice is provided automatically.",
    schema: AskUserQuestionToolArgsSchema,
  },
  propose_plan: {
    description:
      "Signal that your plan is complete and ready for user approval. " +
      "This tool reads the plan from the plan file you wrote. " +
      "You must write your plan to the plan file before calling this tool. " +
      "After calling this tool, do not paste the plan contents or mention the plan file path; the UI already shows the full plan.",
    schema: z.object({}),
  },
  task: {
    description:
      "Spawn a sub-agent task (child workspace). " +
      "\n\nREQUIRED: You MUST provide agentId (e.g. 'task', 'exec', 'explore', or any custom agent id). " +
      "Also provide prompt, title, and optionally run_in_background. " +
      "\n\nIf run_in_background is false, waits for the sub-agent to finish and returns a completed reportMarkdown. " +
      "If run_in_background is true, returns a queued/running taskId; use task_await to wait for completion, task_list to rediscover active tasks, and task_terminate to stop it. " +
      "Use the bash tool to run shell commands.",
    schema: TaskToolArgsSchema,
  },
  task_await: {
    description:
      "Wait for one or more tasks to produce output. " +
      "Agent tasks return reports when completed. " +
      "Bash tasks return incremental output while running and a final reportMarkdown when they exit. " +
      "For bash tasks, you may optionally pass filter/filter_exclude to include/exclude output lines by regex. " +
      "WARNING: when using filter, non-matching lines are permanently discarded. " +
      "Use this tool to WAIT; do not poll task_list in a loop to wait for task completion (that is misuse and wastes tool calls). " +
      "This is similar to Promise.allSettled(): you always get per-task results. " +
      "Possible statuses: completed, queued, running, awaiting_report, not_found, invalid_scope, error. " +
      "Bash task outputs may be automatically filtered; when this happens, check each result's note for details and (if available) where the full output was saved.",
    schema: TaskAwaitToolArgsSchema,
  },
  task_terminate: {
    description:
      "Terminate one or more tasks immediately (sub-agent tasks or background bash tasks). " +
      "For sub-agent tasks, this stops their AI streams and deletes their workspaces (best-effort). " +
      "No report will be delivered; any in-progress work is discarded. " +
      "If the task has descendant sub-agent tasks, they are terminated too.",
    schema: TaskTerminateToolArgsSchema,
  },
  task_list: {
    description:
      "List descendant tasks for the current workspace, including status + metadata. " +
      "This includes sub-agent tasks and background bash tasks. " +
      "Use this after compaction or interruptions to rediscover which tasks are still active. " +
      "This is a discovery tool, NOT a waiting mechanism: if you need to wait for tasks to finish, call task_await (optionally omit task_ids to await all active descendant tasks).",
    schema: TaskListToolArgsSchema,
  },
  agent_report: {
    description:
      "Report the final result of a sub-agent task back to the parent workspace. " +
      "Call this exactly once when you have a final answer (after any spawned sub-tasks complete).",
    schema: AgentReportToolArgsSchema,
  },
  system1_keep_ranges: {
    description:
      "Internal tool used by lattice to record which line ranges to keep when filtering large bash output.",
    schema: z
      .object({
        keep_ranges: z
          .array(
            z
              .object({
                start: z.coerce
                  .number()
                  .finite()
                  .min(1)
                  .describe("1-based start line (inclusive) in the numbered output"),
                end: z.coerce
                  .number()
                  .finite()
                  .min(1)
                  .describe("1-based end line (inclusive) in the numbered output"),
                reason: z
                  .preprocess(
                    (value) => (value === null ? undefined : value),
                    z.string().optional()
                  )
                  .describe("Optional short reason for keeping this range"),
              })
              // Providers/models sometimes include extra keys in tool arguments; be permissive and
              // ignore them rather than failing the whole compaction call.
              .passthrough()
          )
          .min(1)
          // Allow at least as many ranges as the user can request via maxKeptLines.
          // (In the worst case, the model may emit one 1-line range per kept line.)
          .max(SYSTEM1_BASH_OUTPUT_COMPACTION_LIMITS.bashOutputCompactionMaxKeptLines.max)
          .describe("Line ranges to keep"),
      })
      .passthrough(),
  },

  todo_write: {
    description:
      "Create or update the todo list for tracking multi-step tasks (limit: 7 items). " +
      "The TODO list is displayed to the user at all times. " +
      "Replace the entire list on each call - the AI tracks which tasks are completed.\n" +
      "\n" +
      "Mark ONE task as in_progress at a time. " +
      "Order tasks as: completed first, then in_progress (max 1), then pending last. " +
      "Use appropriate tense in content: past tense for completed (e.g., 'Added tests'), " +
      "present progressive for in_progress (e.g., 'Adding tests'), " +
      "and imperative/infinitive for pending (e.g., 'Add tests').\n" +
      "\n" +
      "If you hit the 7-item limit, summarize older completed items into one line " +
      "(e.g., 'Completed initial setup (3 tasks)').\n" +
      "\n" +
      "Update the list as work progresses. If work fails or the approach changes, update " +
      "the list to reflect reality - only mark tasks complete when they actually succeed.",
    schema: z.object({
      todos: z.array(
        z.object({
          content: z
            .string()
            .describe(
              "Task description with tense matching status: past for completed, present progressive for in_progress, imperative for pending"
            ),
          status: z.enum(["pending", "in_progress", "completed"]).describe("Task status"),
        })
      ),
    }),
  },
  todo_read: {
    description: "Read the current todo list",
    schema: z.object({}),
  },
  status_set: {
    description:
      "Set a status indicator to show what Assistant is currently doing. The status is set IMMEDIATELY \n" +
      "when this tool is called, even before other tool calls complete.\n" +
      "\n" +
      "WHEN TO SET STATUS:\n" +
      "- Set status when beginning concrete work (file edits, running tests, executing commands)\n" +
      "- Update status as work progresses through distinct phases\n" +
      "- Set a final status after completion, only claim success when certain (e.g., after confirming checks passed)\n" +
      "- DO NOT set status during initial exploration, file reading, or planning phases\n" +
      "\n" +
      "The status is cleared when a new user message comes in. Validate your approach is feasible \n" +
      "before setting status - failed tool calls after setting status indicate premature commitment.\n" +
      "\n" +
      "URL PARAMETER:\n" +
      "- Optional 'url' parameter links to external resources (e.g., PR URL: 'https://github.com/owner/repo/pull/123')\n" +
      "- Prefer stable URLs that don't change often - saving the same URL twice is a no-op\n" +
      "- URL persists until replaced by a new status with a different URL",
    schema: z
      .object({
        emoji: z.string().describe("A single emoji character representing the current activity"),
        message: z
          .string()
          .describe(
            `A brief description of the current activity (auto-truncated to ${STATUS_MESSAGE_MAX_LENGTH} chars with ellipsis if needed)`
          ),
        url: z
          .string()
          .url()
          .optional()
          .describe(
            "Optional URL to external resource with more details (e.g., Pull Request URL). The URL persists and is displayed to the user for easy access."
          ),
      })
      .strict(),
  },
  bash_output: {
    description:
      'DEPRECATED: use task_await instead (pass bash-prefixed taskId like "bash:<processId>"). ' +
      "Retrieve output from a running or completed background bash process. " +
      "Returns only NEW output since the last check (incremental). " +
      "Returns stdout and stderr output along with process status. " +
      "Supports optional regex filtering to show only lines matching a pattern. " +
      "WARNING: When using filter, non-matching lines are permanently discarded. " +
      "Use timeout to wait for output instead of polling repeatedly. " +
      "Large outputs may be automatically filtered; when this happens, the result includes a note explaining what was kept and (if available) where the full output was saved.",
    schema: z.object({
      process_id: z.string().describe("The ID of the background process to retrieve output from"),
      filter: z
        .string()
        .optional()
        .describe(
          "Optional regex to filter output lines. By default, only matching lines are returned. " +
            "When filter_exclude is true, matching lines are excluded instead. " +
            "Non-matching lines are permanently discarded and cannot be retrieved later."
        ),
      filter_exclude: z
        .boolean()
        .optional()
        .describe(
          "When true, lines matching 'filter' are excluded instead of kept. " +
            "Key behavior: excluded lines do NOT cause early return from timeout - " +
            "waiting continues until non-excluded output arrives or process exits. " +
            "Use to avoid busy polling on progress spam (e.g., filter='⏳|waiting|\\.\\.\\.' with filter_exclude=true " +
            "lets you set a long timeout and only wake on meaningful output). " +
            "Requires 'filter' to be set."
        ),
      timeout_secs: z
        .number()
        .min(0)
        .describe(
          "Seconds to wait for new output. " +
            "If no output is immediately available and process is still running, " +
            "blocks up to this duration. Returns early when output arrives or process exits. " +
            "Only use long timeouts (>15s) when no other useful work can be done in parallel."
        ),
    }),
  },
  bash_background_list: {
    description:
      "DEPRECATED: use task_list instead. " +
      "List all background processes started with bash(run_in_background=true). " +
      "Returns process_id, status, script for each process. " +
      "Use to find process_id for termination or check output with bash_output.",
    schema: z.object({}),
  },
  bash_background_terminate: {
    description:
      "DEPRECATED: use task_terminate instead. " +
      "Terminate a background process started with bash(run_in_background=true). " +
      "Use process_id from the original bash response or from bash_background_list. " +
      "Sends SIGTERM, waits briefly, then SIGKILL if needed. " +
      "Output remains available via bash_output after termination.",
    schema: z.object({
      process_id: z.string().describe("Background process ID to terminate"),
    }),
  },
  web_fetch: {
    description:
      `Fetch a web page and extract its main content as clean markdown. ` +
      `Uses the workspace's network context (requests originate from the workspace, not Lattice host). ` +
      `Requires curl to be installed in the workspace. ` +
      `Output is truncated to ${Math.floor(WEB_FETCH_MAX_OUTPUT_BYTES / 1024)}KB.`,
    schema: z.object({
      url: z.string().url().describe("The URL to fetch (http or https)"),
    }),
  },
  code_execution: {
    description:
      "Execute JavaScript code in a sandboxed environment with access to Lattice tools. " +
      "Available for multi-tool workflows when PTC experiment is enabled.",
    schema: z.object({
      code: z.string().min(1).describe("JavaScript code to execute in the PTC sandbox"),
    }),
  },
  // #region GLOB_DOCS
  glob: {
    description:
      "Fast file pattern matching tool that works with any codebase size. " +
      "Supports glob patterns like '**/*.js' or 'src/**/*.ts'. " +
      "Returns matching file paths sorted by modification time (most recent first). " +
      "Use this when you need to find files by name patterns.",
    schema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe("The glob pattern to match files against (e.g., '**/*.ts', 'src/**/*.tsx')"),
      path: z
        .string()
        .optional()
        .describe(
          "Directory to search in. Defaults to workspace root. Must be within the workspace."
        ),
    }),
  },
  // #endregion GLOB_DOCS
  // #region GREP_DOCS
  grep: {
    description:
      "Search file contents using regular expressions (powered by ripgrep). " +
      "Supports full regex syntax. " +
      "Filter files with the glob parameter. " +
      "Output modes: 'content' shows matching lines with context, " +
      "'files_with_matches' shows only file paths (default), " +
      "'count' shows match counts per file.",
    schema: z.object({
      pattern: z
        .string()
        .min(1)
        .describe("Regular expression pattern to search for in file contents"),
      path: z
        .string()
        .optional()
        .describe("File or directory to search in. Defaults to workspace root."),
      glob: z
        .string()
        .optional()
        .describe("Glob pattern to filter files (e.g., '*.js', '**/*.tsx')"),
      output_mode: z
        .enum(["content", "files_with_matches", "count"])
        .default("files_with_matches")
        .describe(
          "Output format: content (matching lines), files_with_matches (file paths), count (match counts)"
        ),
      context: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("Number of context lines around each match (for content mode)"),
      case_insensitive: z.boolean().optional().describe("Case insensitive search"),
      max_results: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of results to return (default: 200)"),
    }),
  },
  // #endregion GREP_DOCS
  // #region NOTEBOOK_EDIT_DOCS
  notebook_edit: {
    description:
      "Edit Jupyter notebook (.ipynb) cells. " +
      "Supports inserting new cells, replacing existing cell content, and deleting cells. " +
      "Cell indices are 0-based.",
    schema: z.object({
      file_path: z.string().describe("Path to the .ipynb notebook file"),
      operation: z
        .enum(["insert", "replace", "delete"])
        .describe("Edit operation: insert a new cell, replace cell content, or delete a cell"),
      cell_index: z.number().int().min(0).describe("0-based cell index for the operation"),
      cell_type: z
        .enum(["code", "markdown", "raw"])
        .optional()
        .describe("Cell type (required for insert, optional for replace)"),
      source: z
        .string()
        .optional()
        .describe("Cell source content (required for insert and replace)"),
    }),
  },
  // #endregion NOTEBOOK_EDIT_DOCS
  // #region NOTIFY_DOCS
  notify: {
    description:
      "Send a system notification to the user. Use this to alert the user about important events that require their attention, such as long-running task completion, errors requiring intervention, or questions. " +
      "Notifications appear as OS-native notifications (macOS Notification Center, Windows Toast, Linux). " +
      "Infer whether to send notifications from user instructions. If no instructions provided, reserve notifications for major wins or blocking issues. Do not use for routine status updates (use status_set instead).",
    schema: z
      .object({
        title: z
          .string()
          .min(1)
          .max(64)
          .describe("Short notification title (max 64 chars). Should be concise and actionable."),
        message: z
          .string()
          .max(200)
          .optional()
          .describe(
            "Optional notification body with more details (max 200 chars). " +
              "Keep it brief - users may only see a preview."
          ),
      })
      .strict(),
  },
  // #endregion NOTIFY_DOCS
  // #region HIRE_EMPLOYEE_DOCS
  hire_employee: {
    description: (() => {
      const agentList = [
        ...CLI_AGENT_SLUGS.map(
          (slug) => `"${slug}" (${CLI_AGENT_DEFINITIONS[slug].displayName})`
        ),
        '"terminal" (plain shell)',
      ].join(", ");
      return (
        "Opens a new AI agent terminal tab immediately — call this tool directly, no investigation needed. " +
        `Available slugs: ${agentList}. ` +
        'Example: hire_employee({ slug: "gemini" }) opens Gemini instantly.'
      );
    })(),
    schema: z.object({
      slug: z
        .string()
        .describe(
          'Agent slug identifying which employee to hire, e.g. "claude-code", "codex", "gemini", or "terminal"'
        ),
    }),
  },
  // #endregion HIRE_EMPLOYEE_DOCS
  // #region SESSIONS_DOCS
  sessions_list: {
    description:
      "List all active terminal sessions in the current workspace. " +
      "Returns session IDs, agent slugs, display labels, and creation timestamps. " +
      "Use this to discover which AI agents and terminals are currently running before " +
      "directing them with sessions_send or reading their output with sessions_history.",
    schema: z.object({}).strict(),
  },
  sessions_history: {
    description:
      "Read the current screen output of a terminal or AI agent session. " +
      "Returns the last N lines of visible output (ANSI-stripped, human-readable). " +
      "Use this to check agent progress, read command output, or verify agent state. " +
      "Call sessions_list first to get valid session IDs.",
    schema: z.object({
      sessionId: z
        .string()
        .describe("The session ID to read output from (obtain via sessions_list)"),
      maxLines: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum number of lines to return from the end of output (default: 80)"),
    }),
  },
  sessions_send: {
    description:
      "Send text or a command to an active terminal or AI agent session. " +
      "Use this to direct hired agents: send prompts, answer their questions, or pass commands. " +
      "A newline is appended by default (set newline: false for raw input like keystrokes). " +
      "Call sessions_list first to get valid session IDs.",
    schema: z.object({
      sessionId: z
        .string()
        .describe("The session ID to send input to (obtain via sessions_list)"),
      text: z
        .string()
        .describe(
          "The text or command to send. For agents: use natural-language instructions. " +
            'For terminals: use shell commands (e.g., "ls -la", "npm run build").'
        ),
      newline: z
        .boolean()
        .optional()
        .describe(
          "Whether to append a newline character (default: true). " +
            "Set to false only for raw input like escape sequences or partial input."
        ),
    }),
  },
  sessions_spawn: {
    description: (() => {
      const agentList = [
        ...CLI_AGENT_SLUGS.map(
          (slug) => `"${slug}" (${CLI_AGENT_DEFINITIONS[slug].displayName})`
        ),
        '"terminal" (plain shell)',
      ].join(", ");
      return (
        "Spawn a background AI agent session without opening a visible tab in the UI. " +
        "Use this for autonomous background tasks: the agent runs independently, " +
        "and you can monitor it via sessions_history and direct it via sessions_send. " +
        "Unlike hire_employee (which opens a visible tab), sessions_spawn is for background workers. " +
        `Available slugs: ${agentList}.`
      );
    })(),
    schema: z.object({
      slug: z
        .string()
        .describe(
          'Agent slug identifying which agent to spawn, e.g. "claude-code", "codex", "gemini"'
        ),
      initialPrompt: z
        .string()
        .optional()
        .describe(
          "Optional initial prompt to send to the agent after it starts up " +
            "(sent after a short startup delay). Use this to immediately task the agent."
        ),
    }),
  },
  // #endregion SESSIONS_DOCS
  // #region SUBAGENTS_DOCS
  subagents: {
    description:
      "Unified fleet management for all active agents — task subagents and PTY terminal sessions. " +
      "Three actions:\n" +
      '- action:"list" → Show every running task + session with IDs, labels, status, model\n' +
      '- action:"kill" → Terminate by ID (or target:"all" to stop everything). ' +
      "Session IDs are prefixed sess:, task IDs are plain. Cascade-kills descendant tasks.\n" +
      '- action:"steer" → Redirect a running PTY session: sends Ctrl+C (interrupt=true by default) ' +
      "then injects a new directive. Only works on sess: prefixed IDs — task subagents run autonomously.\n\n" +
      "Use this instead of juggling sessions_list + task_list + sessions_send + task_terminate separately. " +
      "This is your Agent HQ dashboard and control panel.",
    schema: z
      .object({
        action: z
          .enum(["list", "kill", "steer"])
          .describe(
            "list: enumerate all agents | kill: terminate by ID or target:'all' | steer: redirect a PTY session"
          ),
        target: z
          .string()
          .optional()
          .describe(
            "For kill/steer: the agent ID from subagents list. " +
              "PTY session IDs are prefixed 'sess:' (e.g. 'sess:abc123'). " +
              "Task IDs are plain UUIDs. Use 'all' with kill to terminate everything."
          ),
        message: z
          .string()
          .optional()
          .describe(
            "For steer: the new directive to send to the agent session (newline appended automatically)."
          ),
        interrupt: z
          .boolean()
          .optional()
          .describe(
            "For steer: send Ctrl+C before the message to interrupt current operation (default: true). " +
              "Set false if the agent is waiting for input rather than actively running."
          ),
      })
      .strict(),
  },
  // #endregion SUBAGENTS_DOCS
  // #region LIT_DOCS
  lit: {
    description:
      "Lattice Intelligence Tracker — git for intelligence. " +
      "Records decisions, outcomes, and learnings as immutable, searchable objects. " +
      "Every decision an agent makes becomes a versioned, traceable entry in the intelligence graph.\n\n" +
      "Actions:\n" +
      '- action:"commit" → Record a decision with task, outcome, learning, confidence, context, domain, tags. ' +
      "Call this after completing any task to persist what was learned.\n" +
      '- action:"search" → Find relevant past decisions by query + optional domain/tags/agent filters. ' +
      "Uses BM25 scoring + temporal decay (90-day half-life). Call BEFORE starting a task to leverage prior knowledge.\n" +
      '- action:"log" → View recent decision history with optional filters (domain, agent, outcome, since, limit).\n\n' +
      "The intelligence graph persists across sessions, agents, and restarts. " +
      "It is the collective memory of all agents that have ever worked in this Lattice installation. " +
      "After every 5 task completions, reflect on the log and commit meta-learnings about patterns, routing strategies, and agent strengths.",
    schema: z
      .object({
        action: z
          .enum(["commit", "search", "log"])
          .describe("commit: record a decision | search: find relevant past knowledge | log: view history"),

        // --- commit fields ---
        task: z
          .string()
          .optional()
          .describe("For commit: what task/situation triggered this decision"),
        learning: z
          .string()
          .optional()
          .describe("For commit: the core insight to persist — what was learned"),
        outcome: z
          .enum(["success", "partial", "failed", "blocked", "observation"])
          .optional()
          .describe("For commit: result of the action taken"),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("For commit: confidence in this learning (0.0-1.0)"),
        domain: z
          .string()
          .optional()
          .describe(
            "For commit/search/log: business domain (plumber, bakery, saas, etc.) for domain-specific knowledge"
          ),
        context: z
          .string()
          .optional()
          .describe("For commit: situation context — what was known when deciding"),
        action_taken: z
          .string()
          .optional()
          .describe("For commit: what action was taken"),
        reasoning: z
          .string()
          .optional()
          .describe("For commit: why this action was chosen over alternatives"),
        tags: z
          .array(z.string())
          .optional()
          .describe("For commit/search/log: searchable tags for categorization"),
        artifacts: z
          .array(z.string())
          .optional()
          .describe("For commit: files created or modified"),
        duration_ms: z
          .number()
          .optional()
          .describe("For commit: how long the task took in milliseconds"),
        agent: z
          .string()
          .optional()
          .describe("For commit/search/log: which agent (auto-filled if not provided)"),

        // --- search fields ---
        query: z
          .string()
          .optional()
          .describe("For search: natural language query to find relevant past decisions"),

        // --- log/search fields ---
        since: z
          .string()
          .optional()
          .describe("For log: ISO 8601 timestamp or relative ('7d', '30d') — only show decisions after this time"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("For search/log: maximum number of results to return (default: 10)"),
      })
      .strict(),
  },
  // #endregion LIT_DOCS
  // #region BROWSER_DOCS
  browser: {
    description:
      "Control a browser to interact with web pages. Each workspace gets its own isolated browser session " +
      "(separate cookies, storage, login state). Use this for web automation: navigating sites, " +
      "filling forms, clicking buttons, reading page content, and taking screenshots.\n\n" +
      "## Workflow pattern (Anthropic computer-use style):\n" +
      "1. `navigate` to a URL\n" +
      "2. `screenshot` to see the current state\n" +
      "3. Decide next action based on what you see\n" +
      "4. `click`, `type`, `scroll`, etc.\n" +
      "5. `screenshot` again to verify the result\n" +
      "6. Repeat until task is complete\n\n" +
      "## Available actions:\n" +
      "- **navigate**: Go to a URL\n" +
      "- **click**: Click an element by CSS selector or [x,y] coordinate\n" +
      "- **type**: Type text into a field (by selector or focused element)\n" +
      "- **scroll**: Scroll up/down/left/right\n" +
      "- **screenshot**: Capture the visible page as base64 PNG\n" +
      "- **read_text**: Extract text content from page or element\n" +
      "- **read_html**: Get raw HTML of page or element\n" +
      "- **wait**: Wait for an element to appear or a fixed delay\n" +
      "- **select**: Select a dropdown option\n" +
      "- **hover**: Hover over an element\n" +
      "- **go_back** / **go_forward**: Browser history navigation\n" +
      "- **new_tab**: Open a new browser tab (optionally with URL)\n" +
      "- **close_tab**: Close a tab\n" +
      "- **list_tabs**: List all open tabs\n" +
      "- **switch_tab**: Switch to a different tab\n" +
      "- **evaluate**: Run JavaScript in the page context\n\n" +
      "## Tips:\n" +
      "- Always screenshot after navigation or clicks to verify state\n" +
      "- Use CSS selectors when possible; fall back to coordinates for complex UIs\n" +
      "- For login flows, type username → click next → type password → click submit\n" +
      "- Sub-agents each get their own browser — use for parallel web tasks",
    schema: z.object({
      action: z
        .enum([
          "navigate",
          "click",
          "type",
          "scroll",
          "screenshot",
          "read_text",
          "read_html",
          "wait",
          "select",
          "hover",
          "go_back",
          "go_forward",
          "new_tab",
          "close_tab",
          "list_tabs",
          "switch_tab",
          "evaluate",
        ])
        .describe("The browser action to perform"),
      url: z.string().optional().describe("URL to navigate to (for navigate/new_tab actions)"),
      selector: z
        .string()
        .optional()
        .describe("CSS selector for element interaction (click, type, read_text, etc.)"),
      text: z.string().optional().describe("Text to type (for type action)"),
      value: z.string().optional().describe("Value to select (for select action)"),
      coordinate: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe("Click/hover coordinate [x, y] — use when CSS selector is not reliable"),
      direction: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe("Scroll direction (default: down)"),
      amount: z.number().positive().optional().describe("Scroll amount in pixels (default: 500)"),
      full_page: z
        .boolean()
        .optional()
        .describe("Capture full-page screenshot (default: false, captures viewport only)"),
      timeout_ms: z
        .number()
        .positive()
        .optional()
        .describe("Action timeout in milliseconds (default: 30000)"),
      page_id: z
        .string()
        .optional()
        .describe("Tab/page ID for tab operations (close_tab, switch_tab)"),
      code: z
        .string()
        .optional()
        .describe("JavaScript code to evaluate in page context (for evaluate action)"),
    }),
  },
  // #endregion BROWSER_DOCS
} as const;

// -----------------------------------------------------------------------------
// Result Schemas for Bridgeable Tools (PTC Type Generation)
// -----------------------------------------------------------------------------
// These Zod schemas define the result types for tools exposed in the PTC sandbox.
// They serve as single source of truth for both:
// 1. TypeScript types in tools.ts (via z.infer<>)
// 2. Runtime type generation for PTC (via Zod → JSON Schema → TypeScript string)

/**
 * Truncation info returned when output exceeds limits.
 */
const TruncatedInfoSchema = z.object({
  reason: z.string(),
  totalLines: z.number(),
});

/**
 * Bash tool result - success, background spawn, or failure.
 */
const BashToolSuccessSchema = z
  .object({
    success: z.literal(true),
    output: z.string(),
    exitCode: z.literal(0),
    wall_duration_ms: z.number(),
    note: z.string().optional(),
    truncated: TruncatedInfoSchema.optional(),
  })
  .extend(ToolOutputUiOnlyFieldSchema);

const BashToolBackgroundSchema = z
  .object({
    success: z.literal(true),
    output: z.string(),
    exitCode: z.literal(0),
    wall_duration_ms: z.number(),
    taskId: z.string(),
    backgroundProcessId: z.string(),
  })
  .extend(ToolOutputUiOnlyFieldSchema);

const BashToolFailureSchema = z
  .object({
    success: z.literal(false),
    output: z.string().optional(),
    exitCode: z.number(),
    error: z.string(),
    wall_duration_ms: z.number(),
    note: z.string().optional(),
    truncated: TruncatedInfoSchema.optional(),
  })
  .extend(ToolOutputUiOnlyFieldSchema);

export const BashToolResultSchema = z.union([
  // Foreground success
  BashToolSuccessSchema,
  // Background spawn success
  BashToolBackgroundSchema,
  // Failure
  BashToolFailureSchema,
]);

/**
 * Bash output tool result - process status and incremental output.
 */
export const BashOutputToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    status: z.enum(["running", "exited", "killed", "failed", "interrupted"]),
    output: z.string(),
    exitCode: z.number().optional(),
    note: z.string().optional(),
    elapsed_ms: z.number(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * Bash background list tool result - all background processes.
 */
export const BashBackgroundListResultSchema = z.union([
  z.object({
    success: z.literal(true),
    processes: z.array(
      z.object({
        process_id: z.string(),
        status: z.enum(["running", "exited", "killed", "failed"]),
        script: z.string(),
        uptime_ms: z.number(),
        exitCode: z.number().optional(),
        display_name: z.string().optional(),
      })
    ),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * Bash background terminate tool result.
 */
export const BashBackgroundTerminateResultSchema = z.union([
  z.object({
    success: z.literal(true),
    message: z.string(),
    display_name: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * lattice_global_agents_read tool result.
 */
export const LatticeGlobalAgentsReadToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    content: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * lattice_global_agents_write tool result.
 */
export const LatticeGlobalAgentsWriteToolResultSchema = z.union([
  z
    .object({
      success: z.literal(true),
      diff: z.string(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
  z
    .object({
      success: z.literal(false),
      error: z.string(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
]);

/**
 * File read tool result - content or error.
 */
export const FileReadToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    file_size: z.number(),
    modifiedTime: z.string(),
    lines_read: z.number(),
    content: z.string(),
    warning: z.string().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * Agent Skill read tool result - full SKILL.md package or error.
 */
export const AgentSkillReadToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    skill: AgentSkillPackageSchema,
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * Agent Skill read_file tool result.
 * Uses the same shape/limits as file_read.
 */
export const AgentSkillReadFileToolResultSchema = FileReadToolResultSchema;

/**
 * File write tool result - diff or error.
 */
export const FileWriteToolResultSchema = z.union([
  z
    .object({
      success: z.literal(true),
      diff: z.string(),
      created: z.boolean(),
      warning: z.string().optional(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
  z
    .object({
      success: z.literal(false),
      error: z.string(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
]);

/**
 * File edit insert tool result - diff or error.
 */
export const FileEditInsertToolResultSchema = z.union([
  z
    .object({
      success: z.literal(true),
      diff: z.string(),
      warning: z.string().optional(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
  z
    .object({
      success: z.literal(false),
      error: z.string(),
      note: z.string().optional(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
]);

/**
 * File edit replace string tool result - diff with edit count or error.
 */
export const FileEditReplaceStringToolResultSchema = z.union([
  z
    .object({
      success: z.literal(true),
      diff: z.string(),
      edits_applied: z.number(),
      warning: z.string().optional(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
  z
    .object({
      success: z.literal(false),
      error: z.string(),
      note: z.string().optional(),
    })
    .extend(ToolOutputUiOnlyFieldSchema),
]);

/**
 * Web fetch tool result - parsed content or error.
 */
export const WebFetchToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    title: z.string(),
    content: z.string(),
    url: z.string(),
    byline: z.string().optional(),
    length: z.number(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    content: z.string().optional(),
  }),
]);

// -- Glob result --
export const GlobToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    files: z.array(z.string()),
    count: z.number(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// -- Grep result --
export const GrepToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    output: z.string(),
    match_count: z.number(),
    truncated: z.boolean().optional(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// -- NotebookEdit result --
export const NotebookEditToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    message: z.string(),
    total_cells: z.number(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

// -- Browser result --
export const BrowserToolResultSchema = z.union([
  z.object({
    success: z.literal(true),
    content_type: z.enum(["text", "html", "screenshot", "info"]),
    content: z.string(),
    url: z.string(),
    title: z.string(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
  }),
]);

/**
 * Names of tools that are bridgeable to PTC sandbox.
 * If adding a new tool here, you must also add its result schema below.
 */
export type BridgeableToolName =
  | "bash"
  | "bash_output"
  | "bash_background_list"
  | "bash_background_terminate"
  | "file_read"
  | "file_write"
  | "agent_skill_read"
  | "agent_skill_read_file"
  | "file_edit_insert"
  | "file_edit_replace_string"
  | "web_fetch"
  | "glob"
  | "grep"
  | "notebook_edit"
  | "task"
  | "task_await"
  | "task_list"
  | "task_terminate"
  | "browser";

/**
 * Lookup map for result schemas by tool name.
 * Used by PTC type generator to get result types for bridgeable tools.
 *
 * Type-level enforcement ensures all BridgeableToolName entries have schemas.
 */
export const RESULT_SCHEMAS: Record<BridgeableToolName, z.ZodType> = {
  bash: BashToolResultSchema,
  bash_output: BashOutputToolResultSchema,
  bash_background_list: BashBackgroundListResultSchema,
  bash_background_terminate: BashBackgroundTerminateResultSchema,
  file_read: FileReadToolResultSchema,
  file_write: FileWriteToolResultSchema,
  agent_skill_read: AgentSkillReadToolResultSchema,
  agent_skill_read_file: AgentSkillReadFileToolResultSchema,
  file_edit_insert: FileEditInsertToolResultSchema,
  file_edit_replace_string: FileEditReplaceStringToolResultSchema,
  web_fetch: WebFetchToolResultSchema,
  glob: GlobToolResultSchema,
  grep: GrepToolResultSchema,
  notebook_edit: NotebookEditToolResultSchema,
  task: TaskToolResultSchema,
  task_await: TaskAwaitToolResultSchema,
  task_list: TaskListToolResultSchema,
  task_terminate: TaskTerminateToolResultSchema,
  browser: BrowserToolResultSchema,
};

/**
 * Get tool definition schemas for token counting
 * JSON schemas are auto-generated from zod schemas
 *
 * @returns Record of tool name to schema
 */
export function getToolSchemas(): Record<string, ToolSchema> {
  return Object.fromEntries(
    Object.entries(TOOL_DEFINITIONS).map(([name, def]) => [
      name,
      {
        name,
        description: def.description,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        inputSchema: zodToJsonSchema(def.schema as any) as ToolSchema["inputSchema"],
      },
    ])
  );
}

/**
 * Get which tools are available for a given model
 * @param modelString The model string (e.g., "anthropic:claude-opus-4-1")
 * @returns Array of tool names available for the model
 */
export function getAvailableTools(
  modelString: string,
  options?: { enableAgentReport?: boolean; enableLatticeGlobalAgentsTools?: boolean }
): string[] {
  const [provider] = modelString.split(":");
  const enableAgentReport = options?.enableAgentReport ?? true;

  // Base tools available for all models
  // Note: Tool availability is controlled by agent tool policy (allowlist), not mode checks here.
  const baseTools = [
    ...(options?.enableLatticeGlobalAgentsTools
      ? ["lattice_global_agents_read", "lattice_global_agents_write"]
      : []),
    "file_read",
    "file_write",
    "agent_skill_read",
    "agent_skill_read_file",
    "file_edit_replace_string",
    // "file_edit_replace_lines", // DISABLED: causes models to break repo state
    "file_edit_insert",
    "ask_user_question",
    "propose_plan",
    "bash",
    "task",
    "task_await",
    "task_terminate",
    "task_list",
    ...(enableAgentReport ? ["agent_report"] : []),
    "system1_keep_ranges",
    "todo_write",
    "todo_read",
    "status_set",
    "notify",
    "hire_employee",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "sessions_spawn",
    "subagents",
    "lit",
    "web_fetch",
    "glob",
    "grep",
    "notebook_edit",
    "browser",
  ];

  // Add provider-specific tools
  switch (provider) {
    case "anthropic":
      return [...baseTools, "web_search"];
    case "openai":
      // Only some OpenAI models support web search
      if (modelString.includes("gpt-4") || modelString.includes("gpt-5")) {
        return [...baseTools, "web_search"];
      }
      return baseTools;
    case "google":
      return [...baseTools, "google_search"];
    default:
      return baseTools;
  }
}
