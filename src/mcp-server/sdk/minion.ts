/**
 * Lattice SDK — Minion operations (44 functions)
 *
 * Core agent control: create minions, send messages, execute bash,
 * manage streams, read chat history, handle compaction, and more.
 *
 * Usage:
 *   import { getClient } from './client';
 *   const c = await getClient();
 *
 *   // Create and use a minion
 *   const ws = await createMinion(c, { projectPath: '/my/project', branchName: 'feat/x' });
 *   await sendMessage(c, { minionId: ws.minionId, message: 'Fix the bug' });
 */

import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@/node/orpc/router";

// ── Minion CRUD ───────────────────────────────────────────────────────

/** List all minions. Pass archived=true for archived minions. */
export async function listMinions(c: RouterClient<AppRouter>, opts?: { archived?: boolean }) {
  return c.minion.list(opts);
}

/** Create a new minion in a project. */
export async function createMinion(c: RouterClient<AppRouter>, input: {
  projectPath: string; branchName: string; title?: string; trunkBranch?: string;
}) {
  const result = await c.minion.create(input);
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return { minionId: result.metadata.id, name: result.metadata.name, title: result.metadata.title };
}

/** Remove a minion. */
export async function removeMinion(c: RouterClient<AppRouter>, minionId: string, force?: boolean) {
  const result = await c.minion.remove({ minionId, options: force ? { force } : undefined });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Get minion metadata. */
export async function getMinionInfo(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.getInfo({ minionId });
}

/** Rename a minion (changes git branch name). */
export async function renameMinion(c: RouterClient<AppRouter>, minionId: string, newName: string) {
  const result = await c.minion.rename({ minionId, newName });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

/** Update minion title. */
export async function updateTitle(c: RouterClient<AppRouter>, minionId: string, title: string) {
  const result = await c.minion.updateTitle({ minionId, title });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Regenerate minion title using AI. */
export async function regenerateTitle(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.regenerateTitle({ minionId });
}

/** Fork a minion with the same history. */
export async function forkMinion(c: RouterClient<AppRouter>, sourceMinionId: string, newName?: string) {
  const result = await c.minion.fork({ sourceMinionId, newName });
  if (!result.success) throw new Error(result.error);
  return { minionId: result.metadata.id, name: result.metadata.name };
}

/** Archive a minion. */
export async function archiveMinion(c: RouterClient<AppRouter>, minionId: string) {
  const result = await c.minion.archive({ minionId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Unarchive a minion. */
export async function unarchiveMinion(c: RouterClient<AppRouter>, minionId: string) {
  const result = await c.minion.unarchive({ minionId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Archive all minions in a project whose branches have been merged. */
export async function archiveMergedInProject(c: RouterClient<AppRouter>, projectPath: string) {
  const result = await c.minion.archiveMergedInProject({ projectPath });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

// ── Messaging ────────────────────────────────────────────────────────────

/** Send a message to an agent. Fire-and-forget — poll getActivity() to check status. */
export async function sendMessage(c: RouterClient<AppRouter>, input: {
  minionId: string; message: string; model?: string; agentId?: string;
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh" | "max";
}) {
  const result = await c.minion.sendMessage({
    minionId: input.minionId,
    message: input.message,
    options: {
      model: input.model ?? "claude-sonnet-4-20250514",
      agentId: input.agentId ?? "auto",
      thinkingLevel: input.thinkingLevel ?? "medium",
    },
  });
  if (!result.success) throw new Error(JSON.stringify(result.error));
}

/** Resume an interrupted agent stream. */
export async function resumeStream(c: RouterClient<AppRouter>, minionId: string, opts?: { model?: string; agentId?: string }) {
  const result = await c.minion.resumeStream({
    minionId,
    options: { model: opts?.model ?? "claude-sonnet-4-20250514", agentId: opts?.agentId ?? "auto" },
  });
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return result.data;
}

/** Interrupt a running agent stream. */
export async function interruptStream(c: RouterClient<AppRouter>, minionId: string, soft?: boolean) {
  const result = await c.minion.interruptStream({ minionId, options: soft ? { soft } : undefined });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Answer a pending ask_user_question tool call. */
export async function answerAskUserQuestion(c: RouterClient<AppRouter>, minionId: string, toolCallId: string, answers: Record<string, string>) {
  const result = await c.minion.answerAskUserQuestion({ minionId, toolCallId, answers });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Answer a delegated tool call. */
export async function answerDelegatedToolCall(c: RouterClient<AppRouter>, minionId: string, toolCallId: string, result: unknown) {
  const res = await c.minion.answerDelegatedToolCall({ minionId, toolCallId, result });
  if (!res.success) throw new Error(typeof res.error === "string" ? res.error : JSON.stringify(res.error));
}

/** Clear the pending message queue. */
export async function clearQueue(c: RouterClient<AppRouter>, minionId: string) {
  const result = await c.minion.clearQueue({ minionId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

// ── Chat History ─────────────────────────────────────────────────────────

/** Get full chat replay events. */
export async function getFullReplay(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.getFullReplay({ minionId });
}

/** Load more history (cursor-based pagination). */
export async function loadMoreHistory(c: RouterClient<AppRouter>, minionId: string, cursor?: string) {
  return c.minion.history.loadMore({ minionId, cursor } as Parameters<typeof c.minion.history.loadMore>[0]);
}

/** Truncate chat history by percentage. */
export async function truncateHistory(c: RouterClient<AppRouter>, minionId: string, percentage?: number) {
  const result = await c.minion.truncateHistory({ minionId, percentage });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Replace chat history with a summary (context compaction). */
export async function replaceChatHistory(c: RouterClient<AppRouter>, minionId: string, summaryMessage: string, opts?: { mode?: string; deletePlanFile?: boolean }) {
  const result = await c.minion.replaceChatHistory({
    minionId, summaryMessage, mode: opts?.mode, deletePlanFile: opts?.deletePlanFile,
  } as unknown as Parameters<typeof c.minion.replaceChatHistory>[0]);
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

// ── Bash Execution ───────────────────────────────────────────────────────

/** Execute a bash command in the minion. Returns stdout/stderr. */
export async function executeBash(c: RouterClient<AppRouter>, minionId: string, script: string, timeoutSecs?: number) {
  const result = await c.minion.executeBash({
    minionId, script, options: timeoutSecs ? { timeout_secs: timeoutSecs } : undefined,
  });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

/** Get output from a background bash process. */
export async function getBackgroundBashOutput(c: RouterClient<AppRouter>, minionId: string, processId: string, tailBytes?: number) {
  const result = await c.minion.backgroundBashes.getOutput({ minionId, processId, tailBytes });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

/** Terminate a background bash process. */
export async function terminateBackgroundBash(c: RouterClient<AppRouter>, minionId: string, processId: string) {
  const result = await c.minion.backgroundBashes.terminate({ minionId, processId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Send a running foreground bash to the background. */
export async function sendBashToBackground(c: RouterClient<AppRouter>, minionId: string, toolCallId: string) {
  const result = await c.minion.backgroundBashes.sendToBackground({ minionId, toolCallId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

// ── Status & Usage ───────────────────────────────────────────────────────

/** Get activity/streaming status for all minions. */
export async function getActivity(c: RouterClient<AppRouter>) {
  return c.minion.activity.list();
}

/** Get plan file content. */
export async function getPlanContent(c: RouterClient<AppRouter>, minionId: string) {
  const result = await c.minion.getPlanContent({ minionId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

/** Get session usage data. */
export async function getSessionUsage(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.getSessionUsage({ minionId });
}

/** Batch-fetch session usage for multiple minions. */
export async function getSessionUsageBatch(c: RouterClient<AppRouter>, minionIds: string[]) {
  return c.minion.getSessionUsageBatch({ minionIds });
}

/** Get last LLM API request (debug). */
export async function getLastLlmRequest(c: RouterClient<AppRouter>, minionId: string) {
  const result = await c.minion.getLastLlmRequest({ minionId });
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
  return result.data;
}

/** Get sidekick task transcript. */
export async function getSidekickTranscript(c: RouterClient<AppRouter>, minionId: string, taskId: string) {
  return c.minion.getSidekickTranscript({ minionId, taskId });
}

/** Get file path completions in a minion. */
export async function getFileCompletions(c: RouterClient<AppRouter>, minionId: string, query: string, limit?: number) {
  return c.minion.getFileCompletions({ minionId, query, limit });
}

// ── Settings ─────────────────────────────────────────────────────────────

/** Update AI settings for a specific agent in a minion. */
export async function updateAgentAISettings(c: RouterClient<AppRouter>, minionId: string, agentId: string, aiSettings: { model?: string; thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh" | "max" }) {
  const result = await c.minion.updateAgentAISettings({ minionId, agentId, aiSettings } as Parameters<typeof c.minion.updateAgentAISettings>[0]);
  if (!result.success) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error));
}

/** Set auto-retry enabled/disabled. */
export async function setAutoRetryEnabled(c: RouterClient<AppRouter>, minionId: string, enabled: boolean) {
  return c.minion.setAutoRetryEnabled({ minionId, enabled } as Parameters<typeof c.minion.setAutoRetryEnabled>[0]);
}

/** Set auto-compaction threshold (0.1-1.0). */
export async function setAutoCompactionThreshold(c: RouterClient<AppRouter>, minionId: string, threshold: number) {
  return c.minion.setAutoCompactionThreshold({ minionId, threshold });
}

/** Get post-compaction state. */
export async function getPostCompactionState(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.getPostCompactionState({ minionId });
}

/** Toggle post-compaction item exclusion. */
export async function setPostCompactionExclusion(c: RouterClient<AppRouter>, minionId: string, itemId: string, excluded: boolean) {
  return c.minion.setPostCompactionExclusion({ minionId, itemId, excluded });
}

/** Clear minion stats. */
export async function clearStats(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.stats.clear({ minionId });
}

/** Get devcontainer info. */
export async function getDevcontainerInfo(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.getDevcontainerInfo({ minionId });
}

/** Get minion MCP overrides. */
export async function getMcpOverrides(c: RouterClient<AppRouter>, minionId: string) {
  return c.minion.mcp.get({ minionId });
}

/** Set minion MCP overrides. */
export async function setMcpOverrides(c: RouterClient<AppRouter>, minionId: string, overrides: Record<string, { enabled?: boolean }>) {
  return c.minion.mcp.set({ minionId, overrides } as Parameters<typeof c.minion.mcp.set>[0]);
}
