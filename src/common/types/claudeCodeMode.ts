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
 * - "streaming": [WIP] Lattice-managed tool execution via the AI SDK's streamText() loop.
 *   The CLI uses --input-format stream-json / --output-format stream-json with --mcp-config
 *   so Claude sees tool definitions in the API request. The AI SDK intercepts tool_use
 *   events and executes tools itself. A fresh CLI process is spawned per doStream() call.
 *   STATUS: Not yet functional — stdin event format issues with CLI. Falls back gracefully.
 */
export type ClaudeCodeExecutionMode = "proxy" | "agentic" | "streaming";

/** Default mode when claude-code provider is selected. */
export const DEFAULT_CLAUDE_CODE_MODE: ClaudeCodeExecutionMode = "agentic";
