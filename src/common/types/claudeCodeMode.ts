/**
 * Claude Code subprocess execution modes.
 *
 * - "proxy": Claude Code acts as a text-only LLM proxy. No MCP tools are passed.
 *   Single-turn request/response. The CLI just routes through the user's Pro/Max subscription.
 *
 * - "agentic": Claude Code handles tool calling internally via --mcp-config.
 *   The CLI runs its own multi-turn agentic loop with access to Lattice MCP tools.
 *   Still uses -p mode (non-interactive), but the process manages its own tool loop.
 *
 * - "streaming": Lattice-managed tool execution via the AI SDK's streamText() loop.
 *   The CLI acts as a pure LLM proxy (--input-format stream-json / --output-format stream-json).
 *   Lattice loads MCP tools; the AI SDK executes them and feeds results back to
 *   the CLI on each step. A fresh CLI process is spawned per doStream() call.
 */
export type ClaudeCodeExecutionMode = "proxy" | "agentic" | "streaming";

/** Default mode when claude-code provider is selected. */
export const DEFAULT_CLAUDE_CODE_MODE: ClaudeCodeExecutionMode = "agentic";
