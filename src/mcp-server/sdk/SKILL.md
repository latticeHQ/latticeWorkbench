# Lattice SDK

Typed TypeScript SDK for controlling the Lattice Lattice Workbench programmatically.

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
| `project` | 25 | Project CRUD, branches, crews, secrets, MCP servers, idle compaction, file completions |
| `terminal` | 8 | Terminal sessions: create (with profile support), input, close, list, resize, native, pop-out |
| `terminal-profiles` | 3 | CLI tool profiles: detect installed tools (claude-code, gemini-cli, aider, etc.), manage configs, install recipes |
| `config` | 13 | Global config, model preferences, provider management, runtime enablement |
| `agents` | 5 | Agent discovery: list/get definitions and skills, skill diagnostics |
| `tasks` | 1 | Create sub-tasks for parallel agent orchestration |
| `analytics` | 8 | Spend tracking: summaries, time series, breakdowns by project/model/agent, cache ratios |
| `tokenizer` | 3 | Token counting: single, batch, chat statistics with cost |
| `server-mgmt` | 29 | Server status, SSH, auth sessions, updates, signing, Lattice integration, experiments, telemetry |
| `mcp-management` | 6 | Global MCP server CRUD: list, add, remove, test, enable/disable, tool allowlists |
| `secrets` | 2 | Get/update global or project-scoped secrets |
| `general` | 6 | Ping, directory ops, editor integration, log management |
| `oauth` | 17 | Device-code and server-side OAuth flows for Copilot, Codex, MCP servers |

**Total: 170 typed functions** covering the full Lattice oRPC API surface.

## Module Details

### minion (44 functions)
`summonMinion`, `listMinions`, `getMinionInfo`, `deleteMinion`, `benchMinion`, `archiveMergedInProject`, `sendMessage`, `executeBash`, `getChatHistory`, `getFullReplay`, `getSessionUsage`, `getLastLlmRequest`, `interruptStream`, `getMinionActivity`, `listAllActivity`, `updateModel`, `updateSystemPrompt`, `getConfiguredModel`, `getPlanContent`, `getMinionStats`, `clearMinionStats`, `getSessionUsageBatch`, `regenerateTitle`, `updateModeAISettings`, `answerDelegatedToolCall`, `setAutoRetryEnabled`, `getStartupAutoRetryModel`, `setAutoCompactionThreshold`, `replaceChatHistory`, `getDevcontainerInfo`, `loadMoreHistory`, `sendBashToBackground`, `setPostCompactionExclusion`, `getMinionMcpOverrides`, `setMinionMcpOverrides`, `cancelLlmRequest`, `waitUntilIdle`, `setMinionAutoCompaction`, `setMinionBenchPolicy`, `getGitDiff`, `sendRetry`, `undoLastMessage`, `getToolPreferences`, `setToolPreferences`

### project (25 functions)
`listProjects`, `createProject`, `deleteProject`, `getProjectDetails`, `updateProject`, `listBranches`, `switchBranch`, `createCrew`, `updateCrew`, `deleteCrew`, `listCrews`, `getProjectSecrets`, `updateProjectSecrets`, `addProjectMcpServer`, `removeProjectMcpServer`, `listProjectMcpServers`, `testProjectMcpServer`, `setProjectMcpServerEnabled`, `setProjectMcpServerToolAllowlist`, `getIdleCompactionConfig`, `setIdleCompactionConfig`, `getProjectFileCompletions`, `archiveMergedInProject`, `getProjectSettings`, `updateProjectSettings`

### server-mgmt (28 functions)
`getApiServerStatus`, `setApiServerSettings`, `getSshHost`, `setSshHost`, `getLaunchProject`, `listAuthSessions`, `revokeAuthSession`, `revokeOtherAuthSessions`, `getStatsTabState`, `setStatsTabOverride`, `getPolicy`, `refreshPolicy`, `checkForUpdates`, `downloadUpdate`, `installUpdate`, `getUpdateChannel`, `setUpdateChannel`, `getSigningCapabilities`, `signMessage`, `clearIdentityCache`, `getLatticeInfo`, `listLatticeTemplates`, `listLatticePresets`, `listLatticeMinions`, `generateName`, `getTelemetryStatus`, `getExperiments`, `reloadExperiments`

### oauth (17 functions)
`copilotStartDeviceFlow`, `copilotWaitForDeviceFlow`, `copilotCancelDeviceFlow`, `codexStartDeviceFlow`, `codexWaitForDeviceFlow`, `codexCancelDeviceFlow`, `codexDisconnect`, `mcpStartServerFlow`, `mcpWaitForServerFlow`, `mcpCancelServerFlow`, `mcpGetAuthStatus`, `mcpLogout`, `projectMcpStartServerFlow`, `projectMcpWaitForServerFlow`, `projectMcpCancelServerFlow`, `projectMcpGetAuthStatus`, `projectMcpLogout`

### config (11 functions)
`getConfig`, `saveConfig`, `getModelPreferences`, `setModelPreferences`, `listProviders`, `getProviderConfig`, `setProviderEnabled`, `getRuntimeEnabled`, `setRuntimeEnabled`, `getProviderStatus`, `refreshProviderStatus`

### terminal (8 functions)
`createTerminal`, `sendTerminalInput`, `closeTerminal`, `listTerminals`, `resizeTerminal`, `openNativeTerminal`, `popOutTerminal`, `getTerminalBuffer`

### terminal-profiles (3 functions)
`listProfiles`, `setProfileConfig`, `getInstallRecipe`

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
