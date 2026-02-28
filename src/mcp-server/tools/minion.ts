/**
 * Minion tools — core agent control.
 *
 * These tools let an external LLM create minions, send messages to agents,
 * read chat history, run bash commands, manage streams, and control all
 * minion-level operations.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";
import { z } from "zod";
import { jsonContent, errorResponse, withErrorHandling } from "../utils";

export function registerMinionTools(
  server: McpServer,
  client: RouterClient<AppRouter>
): void {
  // ── List minions ──────────────────────────────────────────────────────
  server.tool(
    "list_minions",
    "List all minions with metadata (id, name, title, project, runtime, status). " +
      "Use archived=true to list benched minions instead.",
    {
      archived: z.boolean().optional().describe("If true, return benched minions. Default: active only."),
    },
    (params) =>
      withErrorHandling(async () => {
        const minions = await client.minion.list(
          params.archived != null ? { archived: params.archived } : undefined
        );
        const summary = minions.map((w) => ({
          id: w.id, name: w.name, title: w.title,
          projectPath: w.projectPath, projectName: w.projectName,
          createdAt: w.createdAt, taskStatus: w.taskStatus,
        }));
        return { content: [jsonContent(summary)] };
      })
  );

  // ── Create minion ─────────────────────────────────────────────────────
  server.tool(
    "create_minion",
    "Create a new minion in a project. A minion is an isolated agent environment " +
      "with its own git branch and chat history.",
    {
      projectPath: z.string().describe("Absolute path to the project directory"),
      branchName: z.string().describe("Git branch name for this minion (e.g. 'feat/my-feature')"),
      title: z.string().optional().describe("Human-readable title (e.g. 'Fix login bug')"),
      trunkBranch: z.string().optional().describe("Trunk branch to fork from (e.g. 'main'). Required for worktree/SSH runtimes."),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.create({
          projectPath: params.projectPath,
          branchName: params.branchName,
          title: params.title,
          trunkBranch: params.trunkBranch,
        });
        if (!result.success) return errorResponse(result.error);
        return {
          content: [jsonContent({
            message: "Minion summoned successfully",
            minionId: result.metadata.id,
            name: result.metadata.name,
            title: result.metadata.title,
          })],
        };
      })
  );

  // ── Remove minion ─────────────────────────────────────────────────────
  server.tool(
    "remove_minion",
    "Delete a minion. Removes chat history and configuration. Use force=true to skip safety checks.",
    {
      minionId: z.string().describe("The minion ID to delete"),
      force: z.boolean().optional().describe("Skip safety checks (e.g. running streams)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.remove({
          minionId: params.minionId,
          options: params.force != null ? { force: params.force } : undefined,
        });
        if (!result.success) return errorResponse(result.error ?? "Failed to remove minion");
        return { content: [jsonContent({ message: "Minion removed successfully" })] };
      })
  );

  // ── Get minion info ───────────────────────────────────────────────────
  server.tool(
    "get_minion_info",
    "Get detailed metadata for a minion, including streaming state, model, agent, project info.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const info = await client.minion.getInfo({ minionId: params.minionId });
        if (info == null) return errorResponse(`Minion '${params.minionId}' not found`);
        return { content: [jsonContent(info)] };
      })
  );

  // ── Send message (core operation) ────────────────────────────────────────
  server.tool(
    "send_message",
    "Send a message to an AI agent in a minion. This is the primary tool for " +
      "autonomous agent orchestration.\n\n" +
      "IMPORTANT: This enqueues the message and returns immediately — it does NOT " +
      "wait for the agent to finish responding. Use 'get_minion_activity' to check " +
      "streaming status, then 'get_chat_history' to read the response.",
    {
      minionId: z.string().describe("The minion ID to send the message to"),
      message: z.string().describe("The message text to send to the agent"),
      model: z.string().optional().describe("Model to use (e.g. 'claude-sonnet-4-20250514'). Defaults to claude-sonnet-4-20250514."),
      agentId: z.string().optional().describe("Agent ID to use (defaults to 'auto')"),
      thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional().describe("Thinking/reasoning level (defaults to 'medium')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.sendMessage({
          minionId: params.minionId,
          message: params.message,
          options: {
            model: params.model ?? "claude-sonnet-4-20250514",
            agentId: params.agentId ?? "auto",
            thinkingLevel: params.thinkingLevel ?? "medium",
          },
        });
        if (!result.success) {
          const errMsg = typeof result.error === "object" && result.error != null && "type" in result.error
            ? `${(result.error as { type: string }).type}: ${JSON.stringify(result.error)}`
            : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return {
          content: [jsonContent({
            message: "Message sent successfully. The agent is now processing.",
            hint: "Use 'get_minion_activity' to check streaming status, then 'get_chat_history' to read the response.",
          })],
        };
      })
  );

  // ── Get chat history ─────────────────────────────────────────────────────
  server.tool(
    "get_chat_history",
    "Read the chat history for a minion. Returns simplified messages (role + content).",
    {
      minionId: z.string().describe("The minion ID"),
      lastN: z.number().optional().describe("Only return the last N messages (default: all)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const events = await client.minion.getFullReplay({ minionId: params.minionId });
        const messages: Array<{ role: string; content: string; type: string }> = [];
        for (const event of events) {
          if (typeof event === "object" && event != null && "type" in event) {
            const evt = event as Record<string, unknown>;
            if (evt.type === "user-message" && typeof evt.text === "string") {
              messages.push({ role: "user", content: evt.text, type: "user-message" });
            }
            if (evt.type === "completed-message-part") {
              const part = evt;
              if (part.partType === "text" && typeof part.text === "string") {
                messages.push({ role: "assistant", content: part.text, type: "text" });
              }
              if (part.partType === "tool-call") {
                messages.push({
                  role: "assistant",
                  content: JSON.stringify({ tool: part.toolName, args: part.args, result: part.result }),
                  type: "tool-call",
                });
              }
            }
            if (evt.type === "stream-end" && evt.reason != null) {
              messages.push({ role: "system", content: `Stream ended: ${evt.reason as string}`, type: "stream-end" });
            }
          }
        }
        const filtered = params.lastN != null && params.lastN > 0 ? messages.slice(-params.lastN) : messages;
        return { content: [jsonContent({ totalEvents: events.length, messageCount: filtered.length, messages: filtered })] };
      })
  );

  // ── Interrupt stream ─────────────────────────────────────────────────────
  server.tool(
    "interrupt_stream",
    "Stop a running agent stream in a minion. Use soft=true for graceful interruption.",
    {
      minionId: z.string().describe("The minion ID"),
      soft: z.boolean().optional().describe("Graceful interrupt (let current step finish). Default: hard."),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.interruptStream({
          minionId: params.minionId,
          options: params.soft != null ? { soft: params.soft } : undefined,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error ?? "Failed");
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Stream interrupted successfully" })] };
      })
  );

  // ── Rename minion ─────────────────────────────────────────────────────
  server.tool(
    "rename_minion",
    "Rename a minion (changes the git branch name). Returns the new minion ID.",
    {
      minionId: z.string().describe("The minion ID"),
      newName: z.string().describe("New name for the minion"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.rename({ minionId: params.minionId, newName: params.newName });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Minion renamed", newMinionId: result.data.newMinionId })] };
      })
  );

  // ── Update title ─────────────────────────────────────────────────────────
  server.tool(
    "update_minion_title",
    "Update the human-readable title of a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      title: z.string().describe("New title for the minion"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.updateTitle({ minionId: params.minionId, title: params.title });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Title updated" })] };
      })
  );

  // ── Fork minion ───────────────────────────────────────────────────────
  server.tool(
    "fork_minion",
    "Clone an existing minion — creates a new minion with the same chat history and state.",
    {
      sourceMinionId: z.string().describe("The minion ID to clone from"),
      newName: z.string().optional().describe("Name for the forked minion"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.fork({
          sourceMinionId: params.sourceMinionId,
          newName: params.newName,
        });
        if (!result.success) return errorResponse(result.error);
        return {
          content: [jsonContent({
            message: "Minion cloned successfully",
            minionId: result.metadata.id,
            name: result.metadata.name,
          })],
        };
      })
  );

  // ── Archive / Unarchive ──────────────────────────────────────────────────
  server.tool(
    "archive_minion",
    "Bench a minion. Benched minions are hidden from the active list.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.archive({ minionId: params.minionId });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Minion benched" })] };
      })
  );

  server.tool(
    "unarchive_minion",
    "Unbench a minion. Restores it to the active list.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.unarchive({ minionId: params.minionId });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Minion unbenched" })] };
      })
  );

  // ── Execute bash ─────────────────────────────────────────────────────────
  server.tool(
    "execute_bash",
    "Execute a bash command in a minion's environment (working directory set to minion path). " +
      "Returns stdout/stderr output. This is the best way to run commands and see their output.",
    {
      minionId: z.string().describe("The minion ID"),
      script: z.string().describe("The bash script/command to execute"),
      timeout_secs: z.number().optional().describe("Timeout in seconds (default: no timeout)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.executeBash({
          minionId: params.minionId,
          script: params.script,
          options: params.timeout_secs != null ? { timeout_secs: params.timeout_secs } : undefined,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  // ── Get minion activity (streaming status) ───────────────────────────
  server.tool(
    "get_minion_activity",
    "Get the current activity/streaming status for all minions. " +
      "Use this to check if an agent is still processing after send_message.",
    {},
    () =>
      withErrorHandling(async () => {
        const activity = await client.minion.activity.list();
        return { content: [jsonContent(activity)] };
      })
  );

  // ── Get plan content ─────────────────────────────────────────────────────
  server.tool(
    "get_plan_content",
    "Read the current plan file content for a minion (if the agent created one).",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.getPlanContent({ minionId: params.minionId });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  // ── Resume stream ────────────────────────────────────────────────────────
  server.tool(
    "resume_stream",
    "Resume an interrupted agent stream. Restarts processing from where it left off.",
    {
      minionId: z.string().describe("The minion ID"),
      model: z.string().optional().describe("Model to use for resumption"),
      agentId: z.string().optional().describe("Agent ID (defaults to 'auto')"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.resumeStream({
          minionId: params.minionId,
          options: {
            model: params.model ?? "claude-sonnet-4-20250514",
            agentId: params.agentId ?? "auto",
          },
        });
        if (!result.success) {
          const errMsg = typeof result.error === "object" && result.error != null && "type" in result.error
            ? JSON.stringify(result.error)
            : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Stream resumed", started: result.data.started })] };
      })
  );

  // ── Clear queue ──────────────────────────────────────────────────────────
  server.tool(
    "clear_message_queue",
    "Clear the pending message queue for a minion.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.clearQueue({ minionId: params.minionId });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Message queue cleared" })] };
      })
  );

  // ── Truncate history ─────────────────────────────────────────────────────
  server.tool(
    "truncate_history",
    "Truncate chat history for a minion to reduce context size.",
    {
      minionId: z.string().describe("The minion ID"),
      percentage: z.number().optional().describe("Percentage of history to keep (0.0-1.0)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.truncateHistory({
          minionId: params.minionId,
          percentage: params.percentage,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "History truncated" })] };
      })
  );

  // ── Get session usage ────────────────────────────────────────────────────
  server.tool(
    "get_session_usage",
    "Get token usage and cost data for a minion session.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const usage = await client.minion.getSessionUsage({ minionId: params.minionId });
        return { content: [jsonContent(usage ?? { message: "No usage data available" })] };
      })
  );

  // ── Background bash operations ───────────────────────────────────────────
  server.tool(
    "get_background_bash_output",
    "Get output from a background bash process in a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      processId: z.string().describe("The background process ID"),
      tailBytes: z.number().optional().describe("Only return the last N bytes of output (max 1MB)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.backgroundBashes.getOutput({
          minionId: params.minionId,
          processId: params.processId,
          tailBytes: params.tailBytes,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  server.tool(
    "terminate_background_bash",
    "Terminate a background bash process in a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      processId: z.string().describe("The background process ID to terminate"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.backgroundBashes.terminate({
          minionId: params.minionId,
          processId: params.processId,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Background process terminated" })] };
      })
  );

  // ── File completions ─────────────────────────────────────────────────────
  server.tool(
    "minion_file_completions",
    "Get file path completions within a minion directory. Useful for autocomplete.",
    {
      minionId: z.string().describe("The minion ID"),
      query: z.string().describe("Partial file path to complete"),
      limit: z.number().optional().describe("Max number of results (default: 50)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.getFileCompletions({
          minionId: params.minionId,
          query: params.query,
          limit: params.limit,
        });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Get sidekick transcript ──────────────────────────────────────────────
  server.tool(
    "get_sidekick_transcript",
    "Get the chat transcript from a sidekick task.",
    {
      minionId: z.string().describe("The parent minion ID"),
      taskId: z.string().describe("The sidekick task ID"),
    },
    (params) =>
      withErrorHandling(async () => {
        const transcript = await client.minion.getSidekickTranscript({
          minionId: params.minionId,
          taskId: params.taskId,
        });
        return { content: [jsonContent(transcript)] };
      })
  );

  // ── Get last LLM request (debug) ────────────────────────────────────────
  server.tool(
    "get_last_llm_request",
    "Debug tool: get the last LLM API request for a minion, including system prompt, messages, and response.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.getLastLlmRequest({ minionId: params.minionId });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  // ── Answer ask_user_question ─────────────────────────────────────────────
  server.tool(
    "answer_ask_user_question",
    "Answer a pending ask_user_question tool call from an agent. Use this when the agent " +
      "is waiting for user input via the ask_user_question tool.",
    {
      minionId: z.string().describe("The minion ID"),
      toolCallId: z.string().describe("The tool call ID from the ask_user_question event"),
      answers: z.record(z.string(), z.string()).describe("Map of question → answer"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.answerAskUserQuestion({
          minionId: params.minionId,
          toolCallId: params.toolCallId,
          answers: params.answers,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Answer submitted" })] };
      })
  );

  // ── Archive merged minions in project ─────────────────────────────────
  server.tool(
    "archive_merged_in_project",
    "Bench all minions in a project whose branches have been merged.",
    { projectPath: z.string().describe("Absolute project path") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.archiveMergedInProject({ projectPath: params.projectPath });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent(result.data)] };
      })
  );

  // ── Post-compaction state ────────────────────────────────────────────────
  server.tool(
    "get_post_compaction_state",
    "Get the post-compaction context state for a minion — plan path, tracked files, exclusions.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const state = await client.minion.getPostCompactionState({ minionId: params.minionId });
        return { content: [jsonContent(state)] };
      })
  );

  // ── Update agent AI settings ─────────────────────────────────────────────
  server.tool(
    "update_minion_agent_settings",
    "Update AI settings (model, thinking level) for a specific agent in a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      agentId: z.string().describe("The agent ID to configure"),
      model: z.string().optional().describe("Model string"),
      thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional().describe("Thinking level"),
    },
    (params) =>
      withErrorHandling(async () => {
        const aiSettings: Record<string, unknown> = {};
        if (params.model != null) aiSettings.model = params.model;
        if (params.thinkingLevel != null) aiSettings.thinkingLevel = params.thinkingLevel;
        const result = await client.minion.updateAgentAISettings({
          minionId: params.minionId,
          agentId: params.agentId,
          aiSettings,
        } as Parameters<typeof client.minion.updateAgentAISettings>[0]);
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Agent AI settings updated" })] };
      })
  );

  // ── Regenerate title ───────────────────────────────────────────────────
  server.tool(
    "regenerate_minion_title",
    "Re-generate the minion title using AI (inferred from chat history).",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.regenerateTitle({ minionId: params.minionId });
        return { content: [jsonContent(result)] };
      })
  );

  // ── Update mode AI settings ────────────────────────────────────────────
  server.tool(
    "update_minion_mode_settings",
    "Set model/thinking overrides for a specific UI mode (chat, plan, etc.) in a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      mode: z.string().describe("UI mode name (e.g. 'chat', 'plan')"),
      model: z.string().optional().describe("Model string"),
      thinkingLevel: z.enum(["off", "low", "medium", "high", "xhigh", "max"]).optional().describe("Thinking level"),
    },
    (params) =>
      withErrorHandling(async () => {
        const aiSettings: Record<string, unknown> = {};
        if (params.model != null) aiSettings.model = params.model;
        if (params.thinkingLevel != null) aiSettings.thinkingLevel = params.thinkingLevel;
        const result = await client.minion.updateModeAISettings({
          minionId: params.minionId,
          mode: params.mode,
          aiSettings,
        } as Parameters<typeof client.minion.updateModeAISettings>[0]);
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Mode AI settings updated" })] };
      })
  );

  // ── Answer delegated tool call ─────────────────────────────────────────
  server.tool(
    "answer_delegated_tool_call",
    "Submit a result for a delegated tool call. Used in custom tool delegation workflows " +
      "where the host provides tool results back to the agent.",
    {
      minionId: z.string().describe("The minion ID"),
      toolCallId: z.string().describe("The tool call ID to respond to"),
      result: z.string().describe("JSON-encoded result to return to the agent"),
    },
    (params) =>
      withErrorHandling(async () => {
        let parsedResult: unknown;
        try { parsedResult = JSON.parse(params.result); } catch { parsedResult = params.result; }
        const res = await client.minion.answerDelegatedToolCall({
          minionId: params.minionId,
          toolCallId: params.toolCallId,
          result: parsedResult,
        });
        if (!res.success) {
          const errMsg = typeof res.error === "string" ? res.error : JSON.stringify(res.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Delegated tool call answered" })] };
      })
  );

  // ── Auto-retry ─────────────────────────────────────────────────────────
  server.tool(
    "set_auto_retry_enabled",
    "Enable or disable auto-retry on rate-limit/transient errors for a minion.",
    {
      minionId: z.string().describe("The minion ID"),
      enabled: z.boolean().describe("Whether auto-retry is enabled"),
      persist: z.boolean().optional().describe("Persist the setting across sessions"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.setAutoRetryEnabled({
          minionId: params.minionId,
          enabled: params.enabled,
          persist: params.persist,
        } as Parameters<typeof client.minion.setAutoRetryEnabled>[0]);
        return { content: [jsonContent({ message: `Auto-retry ${params.enabled ? "enabled" : "disabled"}`, ...result })] };
      })
  );

  server.tool(
    "get_startup_auto_retry_model",
    "Get the model used for startup auto-retry in a minion.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const model = await client.minion.getStartupAutoRetryModel({ minionId: params.minionId });
        return { content: [jsonContent(model)] };
      })
  );

  // ── Auto-compaction threshold ──────────────────────────────────────────
  server.tool(
    "set_auto_compaction_threshold",
    "Configure the context fill ratio (0.1–1.0) at which automatic compaction is triggered.",
    {
      minionId: z.string().describe("The minion ID"),
      threshold: z.number().describe("Fill ratio threshold (0.1–1.0)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.setAutoCompactionThreshold({
          minionId: params.minionId,
          threshold: params.threshold,
        });
        return { content: [jsonContent({ message: "Compaction threshold set", ...result })] };
      })
  );

  // ── Replace chat history (manual compaction) ───────────────────────────
  server.tool(
    "replace_chat_history",
    "Replace the entire chat history with a summary message. This is the core " +
      "context compaction operation — use it to reduce context window usage.",
    {
      minionId: z.string().describe("The minion ID"),
      summaryMessage: z.string().describe("Summary text to replace the full history"),
      mode: z.string().optional().describe("Mode context for the compaction"),
      deletePlanFile: z.boolean().optional().describe("Also delete the plan file"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.replaceChatHistory({
          minionId: params.minionId,
          summaryMessage: params.summaryMessage,
          mode: params.mode,
          deletePlanFile: params.deletePlanFile,
        } as unknown as Parameters<typeof client.minion.replaceChatHistory>[0]);
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Chat history replaced with summary" })] };
      })
  );

  // ── Devcontainer info ──────────────────────────────────────────────────
  server.tool(
    "get_devcontainer_info",
    "Get devcontainer name and paths for a minion (container context, host paths).",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const info = await client.minion.getDevcontainerInfo({ minionId: params.minionId });
        return { content: [jsonContent(info)] };
      })
  );

  // ── Paginated history loading ──────────────────────────────────────────
  server.tool(
    "load_more_history",
    "Load older chat history in pages (cursor-based pagination). More efficient " +
      "than get_chat_history for large conversation histories.",
    {
      minionId: z.string().describe("The minion ID"),
      cursor: z.string().optional().describe("Pagination cursor from a previous call (omit for first page)"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.history.loadMore({
          minionId: params.minionId,
          cursor: params.cursor,
        } as Parameters<typeof client.minion.history.loadMore>[0]);
        return { content: [jsonContent(result)] };
      })
  );

  // ── Send bash to background ────────────────────────────────────────────
  server.tool(
    "send_bash_to_background",
    "Move a running foreground bash tool call to the background. The process continues " +
      "running and output can be read via get_background_bash_output.",
    {
      minionId: z.string().describe("The minion ID"),
      toolCallId: z.string().describe("The tool call ID of the bash process to background"),
    },
    (params) =>
      withErrorHandling(async () => {
        const result = await client.minion.backgroundBashes.sendToBackground({
          minionId: params.minionId,
          toolCallId: params.toolCallId,
        });
        if (!result.success) {
          const errMsg = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
          return errorResponse(errMsg);
        }
        return { content: [jsonContent({ message: "Bash sent to background", ...(result.data as unknown as Record<string, unknown>) })] };
      })
  );

  // ── Post-compaction exclusion toggle ───────────────────────────────────
  server.tool(
    "set_post_compaction_exclusion",
    "Toggle whether a post-compaction item (plan file, tracked file) is excluded from context injection.",
    {
      minionId: z.string().describe("The minion ID"),
      itemId: z.string().describe("Item ID to toggle"),
      excluded: z.boolean().describe("Whether to exclude this item"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.minion.setPostCompactionExclusion({
          minionId: params.minionId,
          itemId: params.itemId,
          excluded: params.excluded,
        });
        return { content: [jsonContent({ message: `Item ${params.excluded ? "excluded" : "included"}` })] };
      })
  );

  // ── Clear minion stats ──────────────────────────────────────────────
  server.tool(
    "clear_minion_stats",
    "Clear accumulated timing/cost statistics for a minion.",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        await client.minion.stats.clear({ minionId: params.minionId });
        return { content: [jsonContent({ message: "Minion stats cleared" })] };
      })
  );

  // ── Batch session usage ────────────────────────────────────────────────
  server.tool(
    "get_session_usage_batch",
    "Batch-fetch session usage data for multiple minions at once.",
    {
      minionIds: z.array(z.string()).describe("Array of minion IDs"),
    },
    (params) =>
      withErrorHandling(async () => {
        const usage = await client.minion.getSessionUsageBatch({ minionIds: params.minionIds });
        return { content: [jsonContent(usage)] };
      })
  );

  // ── Minion MCP overrides ────────────────────────────────────────────
  server.tool(
    "get_minion_mcp_overrides",
    "Read per-minion MCP server overrides (enable/disable specific MCP servers for this minion).",
    { minionId: z.string().describe("The minion ID") },
    (params) =>
      withErrorHandling(async () => {
        const overrides = await client.minion.mcp.get({ minionId: params.minionId });
        return { content: [jsonContent(overrides)] };
      })
  );

  server.tool(
    "set_minion_mcp_overrides",
    "Set per-minion MCP server overrides (enable/disable specific MCP servers for this minion).",
    {
      minionId: z.string().describe("The minion ID"),
      overrides: z.record(z.string(), z.object({
        enabled: z.boolean().optional().describe("Override enabled state"),
      })).describe("Map of serverName → override settings"),
    },
    (params) =>
      withErrorHandling(async () => {
        await client.minion.mcp.set({
          minionId: params.minionId,
          overrides: params.overrides,
        } as Parameters<typeof client.minion.mcp.set>[0]);
        return { content: [jsonContent({ message: "Minion MCP overrides updated" })] };
      })
  );
}
