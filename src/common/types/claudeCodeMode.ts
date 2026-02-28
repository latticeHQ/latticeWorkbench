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
 * - "streaming": Currently identical to "agentic" — the CLI handles tools internally.
 *   Bidirectional stream-json mode (Lattice intercepts tool calls) is blocked
 *   until the Claude Code CLI supports a "propose tools, don't execute" mode.
 *   Kept as a separate value for forward-compatibility.
 */
export type ClaudeCodeExecutionMode = "proxy" | "agentic" | "streaming";

/** Default mode when claude-code provider is selected. */
export const DEFAULT_CLAUDE_CODE_MODE: ClaudeCodeExecutionMode = "agentic";
