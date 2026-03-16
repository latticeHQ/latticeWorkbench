# Lattice SDK

Typed TypeScript SDK for controlling the Lattice Workbench programmatically.

All functions take a `RouterClient<AppRouter>` as the first argument. Use `getClient()` from `./client` to obtain one.

## Quick Start

```typescript
import { getClient } from "./sdk/client";
import { summonMinion, sendMessage, getSessionUsage } from "./sdk/minion";
import { listProjects } from "./sdk/project";

const c = await getClient();

// List projects
const projects = await listProjects(c);

// Summon a minion and send a task
const ws = await summonMinion(c, "feat/fix-login", "/path/to/project");
await sendMessage(c, ws.minionId, "Fix the login bug on the settings page");

// Check usage
const usage = await getSessionUsage(c, ws.minionId);
```

## Available Modules

| Module | Functions | Description |
|--------|-----------|-------------|
| `minion` | 44 | Core agent control: summon minions, send messages, execute bash, manage streams, compaction, chat history, mode settings, devcontainer |
| `project` | 25 | Project CRUD, branches, stages, secrets, MCP servers, idle compaction, file completions |
| `terminal` | 8 | Terminal sessions: create (with profile support), input, close, list, resize, native, pop-out |
| `terminal-profiles` | 3 | CLI tool profiles: detect installed tools (claude-code, gemini-cli, aider, etc.), manage configs, install recipes |
| `browser` | 46 | Headless browser: navigate, snapshot, screenshot, click, fill, type, press, hover, scroll, tabs, cookies, network, state, recording, cloud providers |
| `config` | 13 | Global config, model preferences, provider management, runtime enablement |
| `agents` | 5 | Agent discovery: list/get definitions and skills, skill diagnostics |
| `tasks` | 1 | Create sub-tasks for parallel agent orchestration |
| `analytics` | 8 | Spend tracking: summaries, time series, breakdowns by project/model/agent, cache ratios |
| `tokenizer` | 3 | Token counting: single, batch, chat statistics with cost |
| `server-mgmt` | 34 | Server status, SSH, auth sessions, updates, signing, Lattice identity, experiments, telemetry, UI layouts, inference |
| `mcp-management` | 6 | Global MCP server CRUD: list, add, remove, test, enable/disable, tool allowlists |
| `secrets` | 2 | Get/update global or project-scoped secrets |
| `general` | 6 | Ping, directory ops, editor integration, log management |
| `oauth` | 17 | Device-code and server-side OAuth flows for Copilot, Codex, MCP servers |
| `inbox` | 9 | Inbox messaging: list conversations, send replies, manage adapter connections, channel tokens |
| `kanban` | 3 | Kanban board: list cards, move between columns, get archived buffer |
| `scheduler` | 6 | Task scheduler: create/manage cron or interval automated tasks |
| `sync` | 9 | Git sync: push/pull state, manage repos, check GitHub auth, configure categories |
| `researchTerminal` | 20 | Research Terminal: equity quotes/history/fundamentals, crypto, FX, indices, technicals, FRED, treasury rates, options, futures, news |

**Total: 268 typed functions** covering the full Lattice oRPC API surface.

## Code Execution Pattern

Instead of calling 200+ individual MCP tools, use `execute_code` to write TypeScript that imports SDK modules directly:

```typescript
// The SDK client `c` and all modules are pre-imported
const projects = await project.listProjects(c);
const allMinions = await minion.listMinions(c);
const results = projects.map(([path, cfg]) => ({
  project: cfg.name ?? path,
  minions: allMinions.filter(m => m.projectPath === path).length,
}));
return results;
```

### When to use execute_code vs direct tools
- **execute_code**: Multi-step workflows, data aggregation, conditional logic, loops, filtering
- **Direct tools**: Single API calls, simple queries, when you need to discover available functions

## Module Details

### minion (44 functions)
`summonMinion`, `listMinions`, `getMinionInfo`, `deleteMinion`, `benchMinion`, `archiveMergedInProject`, `sendMessage`, `executeBash`, `getChatHistory`, `getFullReplay`, `getSessionUsage`, `getLastLlmRequest`, `interruptStream`, `getMinionActivity`, `listAllActivity`, `updateModel`, `updateSystemPrompt`, `getConfiguredModel`, `getPlanContent`, `getMinionStats`, `clearMinionStats`, `getSessionUsageBatch`, `regenerateTitle`, `updateModeAISettings`, `answerDelegatedToolCall`, `setAutoRetryEnabled`, `getStartupAutoRetryModel`, `setAutoCompactionThreshold`, `replaceChatHistory`, `getDevcontainerInfo`, `loadMoreHistory`, `sendBashToBackground`, `setPostCompactionExclusion`, `getMinionMcpOverrides`, `setMinionMcpOverrides`, `cancelLlmRequest`, `waitUntilIdle`, `setMinionAutoCompaction`, `setMinionBenchPolicy`, `getGitDiff`, `sendRetry`, `undoLastMessage`, `getToolPreferences`, `setToolPreferences`

### project (25 functions)
`listProjects`, `createProject`, `deleteProject`, `getProjectDetails`, `updateProject`, `listBranches`, `switchBranch`, `createStage`, `updateStage`, `deleteStage`, `listStages`, `getProjectSecrets`, `updateProjectSecrets`, `addProjectMcpServer`, `removeProjectMcpServer`, `listProjectMcpServers`, `testProjectMcpServer`, `setProjectMcpServerEnabled`, `setProjectMcpServerToolAllowlist`, `getIdleCompactionConfig`, `setIdleCompactionConfig`, `getProjectFileCompletions`, `archiveMergedInProject`, `getProjectSettings`, `updateProjectSettings`

### server-mgmt (34 functions)
`getApiServerStatus`, `setApiServerSettings`, `getSshHost`, `setSshHost`, `getLaunchProject`, `listAuthSessions`, `revokeAuthSession`, `revokeOtherAuthSessions`, `getStatsTabState`, `setStatsTabOverride`, `getPolicy`, `refreshPolicy`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `getUpdateChannel`, `setUpdateChannel`, `getSigningCapabilities`, `signMessage`, `clearIdentityCache`, `getLatticeInfo`, `listLatticeTemplates`, `listLatticePresets`, `listLatticeMinions`, `generateName`, `getTelemetryStatus`, `getExperiments`, `reloadExperiments`, `getUiLayouts`, `saveUiLayouts`, `latticeWhoami`, `latticeLogin`, `setTelemetryEnabled`, `getInferenceStatus`

### oauth (17 functions)
`copilotStartDeviceFlow`, `copilotWaitForDeviceFlow`, `copilotCancelDeviceFlow`, `codexStartDeviceFlow`, `codexWaitForDeviceFlow`, `codexCancelDeviceFlow`, `codexDisconnect`, `mcpStartServerFlow`, `mcpWaitForServerFlow`, `mcpCancelServerFlow`, `mcpGetAuthStatus`, `mcpLogout`, `projectMcpStartServerFlow`, `projectMcpWaitForServerFlow`, `projectMcpCancelServerFlow`, `projectMcpGetAuthStatus`, `projectMcpLogout`

### config (11 functions)
`getConfig`, `saveConfig`, `getModelPreferences`, `setModelPreferences`, `listProviders`, `getProviderConfig`, `setProviderEnabled`, `getRuntimeEnabled`, `setRuntimeEnabled`, `getProviderStatus`, `refreshProviderStatus`

### terminal (8 functions)
`createTerminal`, `sendTerminalInput`, `closeTerminal`, `listTerminals`, `resizeTerminal`, `openNativeTerminal`, `popOutTerminal`, `getTerminalBuffer`

### terminal-profiles (3 functions)
`listProfiles`, `setProfileConfig`, `getInstallRecipe`

### browser (46 functions)
`navigate`, `snapshot`, `screenshot`, `annotatedScreenshot`, `click`, `fill`, `type`, `press`, `hover`, `find`, `selectOption`, `drag`, `scrollDown`, `scrollUp`, `back`, `forward`, `wait`, `evalJS`, `dialog`, `setViewport`, `setDevice`, `tabs`, `cookies`, `networkRequests`, `close`, `sessionInfo`, `saveState`, `restoreState`, `storage`, `snapshotDiff`, `screenshotDiff`, `screenshotElement`, `pdf`, `consoleLogs`, `setGeolocation`, `setPermissions`, `setOffline`, `setHeaders`, `interceptNetwork`, `startRecording`, `stopRecording`, `connectProvider`, `listSessions`, `configureSession`, `deleteCookies`, `scrollToElement`, `scrollByPixels`

### analytics (8 functions)
`getSummary`, `getTimeSeries`, `getSpendByProject`, `getSpendByModel`, `getAgentCostBreakdown`, `getCacheHitRatio`, `getAnalyticsEvents`, `rebuildAnalyticsDb`

### agents (5 functions)
`listAgents`, `getAgent`, `listSkills`, `getSkill`, `getSkillDiagnostics`

### mcp-management (6 functions)
`listMcpServers`, `addMcpServer`, `removeMcpServer`, `testMcpServer`, `setMcpServerEnabled`, `setMcpToolAllowlist`

### general (6 functions)
`ping`, `listDirectory`, `createDirectory`, `openInEditor`, `getLogPath`, `clearLogs`

### tokenizer (3 functions)
`countTokens`, `countTokensBatch`, `calculateStats`

### secrets (2 functions)
`getSecrets`, `updateSecrets`

### tasks (1 function)
`createTask`

### inbox (9 functions)
`listConversations`, `getConversation`, `sendReply`, `updateStatus`, `connectionStatus`, `connectAdapter`, `disconnectAdapter`, `getChannelTokens`, `setChannelToken`

### kanban (3 functions)
`listCards`, `moveCard`, `getArchivedBuffer`

### scheduler (6 functions)
`listSchedules`, `createSchedule`, `updateSchedule`, `removeSchedule`, `runSchedule`, `getHistory`

### sync (9 functions)
`getStatus`, `getConfig`, `saveConfig`, `checkGhAuth`, `listRepos`, `createRepo`, `push`, `pull`, `disconnect`

### researchTerminal (20 functions)
`status`, `start`, `stop`, `equityQuote`, `equityHistorical`, `equityProfile`, `equitySearch`, `equityFundamentals`, `equityFilings`, `cryptoHistorical`, `currencyHistorical`, `indexHistorical`, `technicalIndicator`, `fredSeries`, `treasuryRates`, `economyCalendar`, `optionsChains`, `futuresCurve`, `news`

#### MCP Tool Names (24 tools, category: research-terminal)
`research_terminal_status`, `research_terminal_start`, `research_terminal_stop`, `research_terminal_equity_quote`, `research_terminal_equity_historical`, `research_terminal_equity_profile`, `research_terminal_equity_search`, `research_terminal_equity_fundamentals`, `research_terminal_equity_filings`, `research_terminal_crypto_historical`, `research_terminal_crypto_search`, `research_terminal_currency_historical`, `research_terminal_currency_snapshots`, `research_terminal_index_historical`, `research_terminal_index_constituents`, `research_terminal_technical_indicators`, `research_terminal_economy_calendar`, `research_terminal_economy_cpi`, `research_terminal_economy_gdp`, `research_terminal_fred_series`, `research_terminal_treasury_rates`, `research_terminal_options_chains`, `research_terminal_futures_curve`, `research_terminal_news`, `research_terminal_market_snapshot`, `research_terminal_stock_analysis`
