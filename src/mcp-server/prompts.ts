/**
 * MCP Prompts: pre-built workflow templates for common Lattice operations.
 *
 * Prompts appear as slash-command suggestions in MCP clients, reducing the
 * friction for common multi-step workflows.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  // ── Orientation ──────────────────────────────────────────────────────────
  server.prompt(
    "orientation",
    "Get oriented with Lattice — understand the entity hierarchy, discover tool categories, and check current state. Run this first in a new session.",
    {},
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Get oriented with Lattice by following these steps:`,
              ``,
              `1. **Read orientation**: Read the \`lattice://orientation\` resource to understand the entity hierarchy (Server → Projects → Minions → Terminals/Tasks), scoping rules, and common mistakes.`,
              ``,
              `2. **Browse capabilities**: Call \`list_tool_categories\` to see all 19+ tool categories with scope tags ([Global], [Project-scoped], [Minion-scoped]) and tool counts.`,
              ``,
              `3. **Check current state**: Read \`lattice://projects\` and \`lattice://minions\` to see what projects and minions exist.`,
              ``,
              `4. **Check provider status**: Read \`lattice://providers\` to see which AI providers are configured and available.`,
              ``,
              `5. **Report**: Summarize what you found — available projects, active minions, configured providers, and key capabilities. Suggest what the user might want to do next.`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Create and run a task ──────────────────────────────────────────────
  server.prompt(
    "create-and-run-task",
    "Create a minion, send a task to an agent, and monitor until completion.",
    {
      projectPath: z.string().describe("Absolute path to the project directory"),
      branchName: z.string().describe("Git branch name for the minion (e.g. 'feat/fix-login')"),
      message: z.string().describe("The task/instructions to send to the agent"),
      model: z.string().optional().describe("Model to use (default: claude-sonnet-4-20250514)"),
    },
    async ({ projectPath, branchName, message, model }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Execute the following multi-step workflow:`,
              ``,
              `1. **Create minion**: Call \`create_minion\` with:`,
              `   - projectPath: "${projectPath}"`,
              `   - branchName: "${branchName}"`,
              ``,
              `2. **Send message**: Call \`send_message\` with the new minionId and:`,
              `   - message: "${message}"`,
              `   - model: "${model || "claude-sonnet-4-20250514"}"`,
              ``,
              `3. **Monitor progress**: Poll \`get_minion_activity\` every 5 seconds until the minion is no longer streaming.`,
              ``,
              `4. **Read results**: Call \`get_chat_history\` with lastN=10 to see the agent's response.`,
              ``,
              `5. **Report back**: Summarize what the agent did, including any tool calls it made and the final outcome.`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Cost report ────────────────────────────────────────────────────────
  server.prompt(
    "cost-report",
    "Generate a spending and usage report across projects and models.",
    {
      projectPath: z.string().optional().describe("Filter to a specific project (optional)"),
      from: z.string().optional().describe("Start date ISO 8601 (optional)"),
      to: z.string().optional().describe("End date ISO 8601 (optional)"),
    },
    async ({ projectPath, from, to }) => {
      const filters = [
        projectPath ? `projectPath: "${projectPath}"` : null,
        from ? `from: "${from}"` : null,
        to ? `to: "${to}"` : null,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Generate a comprehensive cost and usage report by calling these analytics tools${filters ? ` with filters: ${filters}` : ""}:`,
                ``,
                `1. **Summary**: Call \`analytics_get_summary\` for aggregate totals`,
                `2. **By project**: Call \`analytics_spend_by_project\` to see which projects cost the most`,
                `3. **By model**: Call \`analytics_spend_by_model\` to see which models are most used`,
                `4. **Agent breakdown**: Call \`analytics_agent_cost_breakdown\` for per-agent costs`,
                `5. **Cache efficiency**: Call \`analytics_cache_hit_ratio\` for cache hit rates`,
                ``,
                `Format the results as a clean report with:`,
                `- Total spend and token usage`,
                `- Top projects by cost`,
                `- Top models by cost`,
                `- Agent type cost distribution`,
                `- Cache efficiency per provider`,
                `- Recommendations for cost optimization`,
              ].join("\n"),
            },
          },
        ],
      };
    }
  );

  // ── Debug minion ────────────────────────────────────────────────────
  server.prompt(
    "debug-minion",
    "Diagnose issues with a minion — check status, errors, last LLM request, and recent history.",
    {
      minionId: z.string().describe("The minion ID to debug"),
    },
    async ({ minionId }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Debug minion "${minionId}" by gathering diagnostic information:`,
              ``,
              `1. **Minion info**: Call \`get_minion_info\` to check status, model, streaming state`,
              `2. **Activity**: Call \`get_minion_activity\` to see if the agent is running`,
              `3. **Last LLM request**: Call \`get_last_llm_request\` to inspect the last API call (system prompt, messages, response)`,
              `4. **Recent history**: Call \`get_chat_history\` with lastN=15 to see recent messages and tool calls`,
              `5. **Session usage**: Call \`get_session_usage\` to check token consumption`,
              `6. **Plan file**: Call \`get_plan_content\` to see if the agent has a plan`,
              ``,
              `Analyze the results and report:`,
              `- Current minion state (streaming, idle, error)`,
              `- Any errors or issues found`,
              `- Token usage and context window fill level`,
              `- The agent's last actions and whether they succeeded`,
              `- Recommendations for next steps`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Research Terminal ─────────────────────────────────────────────────
  server.prompt(
    "research-terminal",
    "Use the Research Terminal to fetch financial data — stock quotes, price history, FRED economic data, technicals, and more.",
    {
      symbol: z.string().optional().describe("Ticker symbol to research (e.g. AAPL, BTC-USD)"),
    },
    async ({ symbol }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Use the Research Terminal built-in MCP tools to fetch financial data${symbol ? ` for ${symbol}` : ""}.`,
              ``,
              `**Available tool categories** (all prefixed with \`research_terminal_\`):`,
              ``,
              `| Category | Tools | Description |`,
              `|----------|-------|-------------|`,
              `| Lifecycle | \`_status\`, \`_start\`, \`_stop\` | Manage the data server |`,
              `| Equity | \`_equity_quote\`, \`_equity_historical\`, \`_equity_profile\`, \`_equity_search\`, \`_equity_fundamentals\`, \`_equity_filings\` | Stock data, financials, SEC filings |`,
              `| Crypto | \`_crypto_historical\`, \`_crypto_search\` | Cryptocurrency prices |`,
              `| Currency | \`_currency_historical\`, \`_currency_snapshots\` | FX rates |`,
              `| Index | \`_index_historical\`, \`_index_constituents\` | Market indices |`,
              `| Technical | \`_technical_indicators\` | RSI, MACD, Bollinger, SMA, EMA |`,
              `| Economy | \`_economy_calendar\`, \`_economy_cpi\`, \`_economy_gdp\`, \`_fred_series\`, \`_treasury_rates\` | Macro/FRED data |`,
              `| Derivatives | \`_options_chains\`, \`_futures_curve\` | Options & futures |`,
              `| News | \`_news\` | Financial headlines |`,
              `| Composite | \`_market_snapshot\`, \`_stock_analysis\` | Multi-data in one call |`,
              ``,
              `**Steps:**`,
              `1. First call \`research_terminal_status\` — if not running, call \`research_terminal_start\``,
              `2. Then use the data tools above to fetch what you need`,
              `3. For a quick stock overview, use \`research_terminal_stock_analysis\` (combines quote + profile + history)`,
              `4. For a watchlist, use \`research_terminal_market_snapshot\` with comma-separated symbols`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ── Cleanup merged branches ────────────────────────────────────────────
  server.prompt(
    "cleanup-merged",
    "Find and bench minions whose branches have been merged.",
    {
      projectPath: z.string().describe("Absolute project path to clean up"),
    },
    async ({ projectPath }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Clean up merged branches in project "${projectPath}":`,
              ``,
              `1. **List branches**: Call \`list_branches\` to see all branches and which are merged`,
              `2. **List minions**: Call \`list_minions\` to see all active minions for this project`,
              `3. **Archive merged**: Call \`archive_merged_in_project\` to archive minions with merged branches`,
              `4. **Report**: List which minions were archived and which remain active`,
              ``,
              `Be careful: only bench minions whose branches are fully merged. Report what you did.`,
            ].join("\n"),
          },
        },
      ],
    })
  );
}
