/**
 * Static catalog of all Lattice SDK functions.
 *
 * Used by the built-in `lattice_search_tools` and `lattice_list_categories` agent tools
 * for progressive disclosure — models discover SDK functions on demand instead
 * of loading 170+ tool definitions into context upfront.
 *
 * See: https://www.anthropic.com/engineering/code-execution-with-mcp
 */

export interface LatticeSdkFunction {
  /** Function name (e.g. "createMinion") */
  name: string;
  /** Module/category (e.g. "minion") */
  category: string;
  /** Brief description */
  description: string;
}

export interface LatticeSdkCategory {
  /** Category ID (e.g. "minion") */
  id: string;
  /** Human-readable description */
  description: string;
  /** Number of functions in this category */
  functionCount: number;
  /** Relative path to the SDK file */
  sdkFile: string;
}

/**
 * SDK module categories with descriptions and function counts.
 */
export const LATTICE_SDK_CATEGORIES: LatticeSdkCategory[] = [
  { id: "minion", description: "Core agent control: create minions, send messages, execute bash, manage streams, compaction, chat history, mode settings, devcontainer", functionCount: 44, sdkFile: "sdk/minion.ts" },
  { id: "project", description: "Project CRUD, branches, crews, secrets, MCP servers, idle compaction, file completions", functionCount: 25, sdkFile: "sdk/project.ts" },
  { id: "server-mgmt", description: "Server status, SSH, auth sessions, updates, signing, Lattice integration, experiments, telemetry", functionCount: 29, sdkFile: "sdk/server-mgmt.ts" },
  { id: "oauth", description: "Device-code and server-side OAuth flows for Copilot, Codex, MCP servers", functionCount: 17, sdkFile: "sdk/oauth.ts" },
  { id: "config", description: "Global config, model preferences, provider management, runtime enablement", functionCount: 13, sdkFile: "sdk/config.ts" },
  { id: "terminal", description: "Terminal sessions: create (with profile support), input, close, list, resize, native, pop-out", functionCount: 8, sdkFile: "sdk/terminal.ts" },
  { id: "terminal-profiles", description: "CLI tool profiles: detect installed tools (claude-code, gemini-cli, aider, etc.), manage configs, install recipes", functionCount: 3, sdkFile: "sdk/terminal-profiles.ts" },
  { id: "analytics", description: "Spend tracking: summaries, time series, breakdowns by project/model/agent, cache ratios", functionCount: 8, sdkFile: "sdk/analytics.ts" },
  { id: "agents", description: "Agent discovery: list/get definitions and skills, skill diagnostics", functionCount: 5, sdkFile: "sdk/agents.ts" },
  { id: "mcp-management", description: "Global MCP server CRUD: list, add, remove, test, enable/disable, tool allowlists", functionCount: 6, sdkFile: "sdk/mcp-management.ts" },
  { id: "general", description: "Ping, directory ops, editor integration, log management", functionCount: 6, sdkFile: "sdk/general.ts" },
  { id: "tokenizer", description: "Token counting: single, batch, chat statistics with cost", functionCount: 3, sdkFile: "sdk/tokenizer.ts" },
  { id: "secrets", description: "Get/update global or project-scoped secrets", functionCount: 2, sdkFile: "sdk/secrets.ts" },
  { id: "tasks", description: "Create sub-tasks for parallel agent orchestration", functionCount: 1, sdkFile: "sdk/tasks.ts" },
];

/**
 * Full catalog of all SDK functions with descriptions.
 * Organized by category for efficient filtering.
 */
export const LATTICE_SDK_FUNCTIONS: LatticeSdkFunction[] = [
  // ── minion (44) ──────────────────────────────────────────────────────
  { name: "createMinion", category: "minion", description: "Create a new agent minion in a project" },
  { name: "listMinions", category: "minion", description: "List all active minions" },
  { name: "getMinionInfo", category: "minion", description: "Get detailed info for a minion" },
  { name: "deleteMinion", category: "minion", description: "Delete a minion permanently" },
  { name: "archiveMinion", category: "minion", description: "Archive a minion (soft-delete)" },
  { name: "archiveMergedInProject", category: "minion", description: "Bench all minions with merged branches in a project" },
  { name: "sendMessage", category: "minion", description: "Send a message/task to a minion agent" },
  { name: "executeBash", category: "minion", description: "Execute a bash command in a minion" },
  { name: "getChatHistory", category: "minion", description: "Get chat history for a minion" },
  { name: "getFullReplay", category: "minion", description: "Get full message replay including tool calls" },
  { name: "getSessionUsage", category: "minion", description: "Get token usage and cost for a session" },
  { name: "getLastLlmRequest", category: "minion", description: "Get the last LLM request details" },
  { name: "interruptStream", category: "minion", description: "Interrupt the current streaming response" },
  { name: "getMinionActivity", category: "minion", description: "Get current minion activity state (streaming/idle)" },
  { name: "listAllActivity", category: "minion", description: "List activity state for all minions" },
  { name: "updateModel", category: "minion", description: "Change the AI model for a minion" },
  { name: "updateSystemPrompt", category: "minion", description: "Update minion system prompt" },
  { name: "getConfiguredModel", category: "minion", description: "Get the currently configured model" },
  { name: "getPlanContent", category: "minion", description: "Get the plan file content" },
  { name: "getMinionStats", category: "minion", description: "Get minion performance stats" },
  { name: "clearMinionStats", category: "minion", description: "Reset minion stats" },
  { name: "getSessionUsageBatch", category: "minion", description: "Get usage for multiple minions at once" },
  { name: "regenerateTitle", category: "minion", description: "Regenerate minion title from chat" },
  { name: "updateModeAISettings", category: "minion", description: "Update AI mode settings (auto-accept, etc.)" },
  { name: "answerDelegatedToolCall", category: "minion", description: "Answer a delegated tool call (human-in-the-loop)" },
  { name: "setAutoRetryEnabled", category: "minion", description: "Enable/disable auto-retry on failure" },
  { name: "getStartupAutoRetryModel", category: "minion", description: "Get startup auto-retry model config" },
  { name: "setAutoCompactionThreshold", category: "minion", description: "Set context window compaction threshold" },
  { name: "replaceChatHistory", category: "minion", description: "Replace entire chat history (compaction)" },
  { name: "getDevcontainerInfo", category: "minion", description: "Get devcontainer configuration" },
  { name: "loadMoreHistory", category: "minion", description: "Load additional chat history pages" },
  { name: "sendBashToBackground", category: "minion", description: "Move a running bash command to background" },
  { name: "setPostCompactionExclusion", category: "minion", description: "Set messages excluded from compaction" },
  { name: "getMinionMcpOverrides", category: "minion", description: "Get MCP server overrides for a minion" },
  { name: "setMinionMcpOverrides", category: "minion", description: "Set MCP server overrides for a minion" },
  { name: "cancelLlmRequest", category: "minion", description: "Cancel the current LLM request" },
  { name: "waitUntilIdle", category: "minion", description: "Block until minion finishes streaming" },
  { name: "setMinionAutoCompaction", category: "minion", description: "Enable/disable auto-compaction" },
  { name: "setMinionArchivePolicy", category: "minion", description: "Set minion archive policy" },
  { name: "getGitDiff", category: "minion", description: "Get git diff for minion changes" },
  { name: "sendRetry", category: "minion", description: "Retry the last failed message" },
  { name: "undoLastMessage", category: "minion", description: "Undo the last message" },
  { name: "getToolPreferences", category: "minion", description: "Get tool preference overrides" },
  { name: "setToolPreferences", category: "minion", description: "Set tool preference overrides" },

  // ── project (25) ────────────────────────────────────────────────────────
  { name: "listProjects", category: "project", description: "List all registered projects" },
  { name: "createProject", category: "project", description: "Register a new project from a directory path" },
  { name: "deleteProject", category: "project", description: "Remove a project registration" },
  { name: "getProjectDetails", category: "project", description: "Get detailed project info" },
  { name: "updateProject", category: "project", description: "Update project configuration" },
  { name: "listBranches", category: "project", description: "List git branches for a project" },
  { name: "switchBranch", category: "project", description: "Switch git branch for a project" },
  { name: "createCrew", category: "project", description: "Create a project section (organization)" },
  { name: "updateCrew", category: "project", description: "Update a section name or order" },
  { name: "deleteSection", category: "project", description: "Delete a project section" },
  { name: "listCrews", category: "project", description: "List all project crews" },
  { name: "getProjectSecrets", category: "project", description: "Get project-scoped secrets" },
  { name: "updateProjectSecrets", category: "project", description: "Update project-scoped secrets" },
  { name: "addProjectMcpServer", category: "project", description: "Add an MCP server to a project" },
  { name: "removeProjectMcpServer", category: "project", description: "Remove an MCP server from a project" },
  { name: "listProjectMcpServers", category: "project", description: "List MCP servers for a project" },
  { name: "testProjectMcpServer", category: "project", description: "Test an MCP server connection" },
  { name: "setProjectMcpServerEnabled", category: "project", description: "Enable/disable a project MCP server" },
  { name: "setProjectMcpServerToolAllowlist", category: "project", description: "Set tool allowlist for a project MCP server" },
  { name: "getIdleCompactionConfig", category: "project", description: "Get idle compaction config for a project" },
  { name: "setIdleCompactionConfig", category: "project", description: "Set idle compaction config for a project" },
  { name: "getProjectFileCompletions", category: "project", description: "Get file path completions for a project" },
  { name: "archiveMergedInProject", category: "project", description: "Archive minions with merged branches" },
  { name: "getProjectSettings", category: "project", description: "Get project-level settings" },
  { name: "updateProjectSettings", category: "project", description: "Update project-level settings" },

  // ── server-mgmt (29) ───────────────────────────────────────────────────
  { name: "getApiServerStatus", category: "server-mgmt", description: "Get API server status and info" },
  { name: "setApiServerSettings", category: "server-mgmt", description: "Update API server settings" },
  { name: "getSshHost", category: "server-mgmt", description: "Get configured SSH host" },
  { name: "setSshHost", category: "server-mgmt", description: "Set SSH host for remote minions" },
  { name: "getLaunchProject", category: "server-mgmt", description: "Get the project opened on launch" },
  { name: "listAuthSessions", category: "server-mgmt", description: "List active auth sessions" },
  { name: "revokeAuthSession", category: "server-mgmt", description: "Revoke a specific auth session" },
  { name: "revokeOtherAuthSessions", category: "server-mgmt", description: "Revoke all other auth sessions" },
  { name: "getStatsTabState", category: "server-mgmt", description: "Get stats tab display state" },
  { name: "setStatsTabOverride", category: "server-mgmt", description: "Override stats tab visibility" },
  { name: "getPolicy", category: "server-mgmt", description: "Get current security/governance policy" },
  { name: "refreshPolicy", category: "server-mgmt", description: "Refresh policy from server" },
  { name: "checkForUpdates", category: "server-mgmt", description: "Check for app updates" },
  { name: "downloadUpdate", category: "server-mgmt", description: "Download an available update" },
  { name: "installUpdate", category: "server-mgmt", description: "Install a downloaded update" },
  { name: "getUpdateChannel", category: "server-mgmt", description: "Get current update channel (stable/beta)" },
  { name: "setUpdateChannel", category: "server-mgmt", description: "Set update channel" },
  { name: "getSigningCapabilities", category: "server-mgmt", description: "Get code signing capabilities" },
  { name: "signMessage", category: "server-mgmt", description: "Sign a message with app identity" },
  { name: "clearIdentityCache", category: "server-mgmt", description: "Clear cached identity data" },
  { name: "getLatticeInfo", category: "server-mgmt", description: "Get Lattice integration info" },
  { name: "listLatticeTemplates", category: "server-mgmt", description: "List available Lattice templates" },
  { name: "listLatticePresets", category: "server-mgmt", description: "List Lattice presets" },
  { name: "listLatticeMinions", category: "server-mgmt", description: "List Lattice minions" },
  { name: "generateName", category: "server-mgmt", description: "Generate a random minion name" },
  { name: "getTelemetryStatus", category: "server-mgmt", description: "Get telemetry enabled status" },
  { name: "getExperiments", category: "server-mgmt", description: "Get active experiments/feature flags" },
  { name: "reloadExperiments", category: "server-mgmt", description: "Reload experiments from server" },

  // ── oauth (17) ─────────────────────────────────────────────────────────
  { name: "copilotStartDeviceFlow", category: "oauth", description: "Start GitHub Copilot device code OAuth flow" },
  { name: "copilotWaitForDeviceFlow", category: "oauth", description: "Wait for Copilot device flow completion" },
  { name: "copilotCancelDeviceFlow", category: "oauth", description: "Cancel Copilot device flow" },
  { name: "codexStartDeviceFlow", category: "oauth", description: "Start OpenAI Codex device code OAuth flow" },
  { name: "codexWaitForDeviceFlow", category: "oauth", description: "Wait for Codex device flow completion" },
  { name: "codexCancelDeviceFlow", category: "oauth", description: "Cancel Codex device flow" },
  { name: "codexDisconnect", category: "oauth", description: "Disconnect Codex OAuth" },
  { name: "mcpStartServerFlow", category: "oauth", description: "Start OAuth flow for an MCP server" },
  { name: "mcpWaitForServerFlow", category: "oauth", description: "Wait for MCP server OAuth completion" },
  { name: "mcpCancelServerFlow", category: "oauth", description: "Cancel MCP server OAuth flow" },
  { name: "mcpGetAuthStatus", category: "oauth", description: "Get MCP server auth status" },
  { name: "mcpLogout", category: "oauth", description: "Logout from an MCP server" },
  { name: "projectMcpStartServerFlow", category: "oauth", description: "Start project-scoped MCP OAuth flow" },
  { name: "projectMcpWaitForServerFlow", category: "oauth", description: "Wait for project MCP OAuth completion" },
  { name: "projectMcpCancelServerFlow", category: "oauth", description: "Cancel project MCP OAuth flow" },
  { name: "projectMcpGetAuthStatus", category: "oauth", description: "Get project MCP server auth status" },
  { name: "projectMcpLogout", category: "oauth", description: "Logout from a project MCP server" },

  // ── config (13) ────────────────────────────────────────────────────────
  { name: "getConfig", category: "config", description: "Get global Lattice configuration" },
  { name: "saveConfig", category: "config", description: "Save global Lattice configuration" },
  { name: "getModelPreferences", category: "config", description: "Get model preference settings" },
  { name: "setModelPreferences", category: "config", description: "Set model preference settings" },
  { name: "listProviders", category: "config", description: "List all AI provider configurations" },
  { name: "getProviderConfig", category: "config", description: "Get config for a specific provider" },
  { name: "setProviderEnabled", category: "config", description: "Enable/disable an AI provider" },
  { name: "getRuntimeEnabled", category: "config", description: "Get runtime enabled status (local/SSH/Docker)" },
  { name: "setRuntimeEnabled", category: "config", description: "Enable/disable a runtime type" },
  { name: "getProviderStatus", category: "config", description: "Get provider connection status" },
  { name: "refreshProviderStatus", category: "config", description: "Refresh provider connection status" },

  // ── terminal (8) ───────────────────────────────────────────────────────
  { name: "createTerminal", category: "terminal", description: "Create a terminal session (optionally with a profile)" },
  { name: "sendTerminalInput", category: "terminal", description: "Send input to a terminal session" },
  { name: "closeTerminal", category: "terminal", description: "Close a terminal session" },
  { name: "listTerminals", category: "terminal", description: "List terminal sessions for a minion" },
  { name: "resizeTerminal", category: "terminal", description: "Resize a terminal session" },
  { name: "openNativeTerminal", category: "terminal", description: "Open native OS terminal for minion" },
  { name: "popOutTerminal", category: "terminal", description: "Pop out terminal into separate window" },
  { name: "getTerminalBuffer", category: "terminal", description: "Get terminal screen buffer content" },

  // ── terminal-profiles (3) ──────────────────────────────────────────────
  { name: "listProfiles", category: "terminal-profiles", description: "List all terminal profiles with detection status" },
  { name: "setProfileConfig", category: "terminal-profiles", description: "Update terminal profile config (enable/disable, overrides)" },
  { name: "getInstallRecipe", category: "terminal-profiles", description: "Get install instructions for a profile" },

  // ── analytics (8) ──────────────────────────────────────────────────────
  { name: "getSummary", category: "analytics", description: "Get aggregate spend/usage summary" },
  { name: "getTimeSeries", category: "analytics", description: "Get spend time series data" },
  { name: "getSpendByProject", category: "analytics", description: "Get spend breakdown by project" },
  { name: "getSpendByModel", category: "analytics", description: "Get spend breakdown by model" },
  { name: "getAgentCostBreakdown", category: "analytics", description: "Get cost breakdown by agent" },
  { name: "getCacheHitRatio", category: "analytics", description: "Get prompt cache hit ratio" },
  { name: "getAnalyticsEvents", category: "analytics", description: "Get raw analytics events" },
  { name: "rebuildAnalyticsDb", category: "analytics", description: "Rebuild analytics database" },

  // ── agents (5) ─────────────────────────────────────────────────────────
  { name: "listAgents", category: "agents", description: "List available agent definitions" },
  { name: "getAgent", category: "agents", description: "Get a specific agent definition" },
  { name: "listSkills", category: "agents", description: "List available agent skills" },
  { name: "getSkill", category: "agents", description: "Get a specific agent skill" },
  { name: "getSkillDiagnostics", category: "agents", description: "Get diagnostics for skill loading" },

  // ── mcp-management (6) ─────────────────────────────────────────────────
  { name: "listMcpServers", category: "mcp-management", description: "List configured MCP servers" },
  { name: "addMcpServer", category: "mcp-management", description: "Add a new MCP server" },
  { name: "removeMcpServer", category: "mcp-management", description: "Remove an MCP server" },
  { name: "testMcpServer", category: "mcp-management", description: "Test MCP server connectivity" },
  { name: "setMcpServerEnabled", category: "mcp-management", description: "Enable/disable an MCP server" },
  { name: "setMcpToolAllowlist", category: "mcp-management", description: "Set tool allowlist for an MCP server" },

  // ── general (6) ────────────────────────────────────────────────────────
  { name: "ping", category: "general", description: "Health check ping" },
  { name: "listDirectory", category: "general", description: "List files in a directory" },
  { name: "createDirectory", category: "general", description: "Create a directory" },
  { name: "openInEditor", category: "general", description: "Open a file in the default editor" },
  { name: "getLogPath", category: "general", description: "Get path to Lattice log file" },
  { name: "clearLogs", category: "general", description: "Clear Lattice log files" },

  // ── tokenizer (3) ──────────────────────────────────────────────────────
  { name: "countTokens", category: "tokenizer", description: "Count tokens in a text string" },
  { name: "countTokensBatch", category: "tokenizer", description: "Count tokens for multiple texts" },
  { name: "calculateStats", category: "tokenizer", description: "Calculate chat token stats with cost" },

  // ── secrets (2) ────────────────────────────────────────────────────────
  { name: "getSecrets", category: "secrets", description: "Get global or project-scoped secrets" },
  { name: "updateSecrets", category: "secrets", description: "Update global or project-scoped secrets" },

  // ── tasks (1) ──────────────────────────────────────────────────────────
  { name: "createTask", category: "tasks", description: "Create a sub-task for parallel agent orchestration" },
];

/**
 * Search the SDK catalog by keyword (matches against function names, categories, and descriptions).
 */
export function searchSdkCatalog(
  query: string,
  options?: { category?: string }
): LatticeSdkFunction[] {
  const q = query.toLowerCase();

  let results = LATTICE_SDK_FUNCTIONS;

  // Filter by category if specified
  if (options?.category) {
    const cat = options.category.toLowerCase();
    results = results.filter((f) => f.category.toLowerCase() === cat);
  }

  // Filter by keyword
  if (q) {
    results = results.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
    );
  }

  return results;
}
