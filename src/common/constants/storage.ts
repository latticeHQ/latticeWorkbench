/**
 * LocalStorage Key Constants and Helpers
 * These keys are used for persisting state in localStorage
 */

/**
 * Scope ID Helpers
 * These create consistent scope identifiers for storage keys
 */

/**
 * Get project-scoped ID for storage keys (e.g., model preference before minion creation)
 * Format: "__project__/{projectPath}"
 * Uses "/" delimiter to safely handle projectPath values containing special characters
 */
export function getProjectScopeId(projectPath: string): string {
  return `__project__/${projectPath}`;
}

/**
 * Get pending minion scope ID for storage keys (e.g., input text during minion creation)
 * Format: "__pending__{projectPath}"
 */
export function getPendingScopeId(projectPath: string): string {
  return `__pending__${projectPath}`;
}

/**
 * Get draft minion scope ID for storage keys.
 *
 * This is used for UI-only minion creation drafts so multiple pending drafts can
 * exist per project without colliding.
 *
 * Format: "__draft__/{projectPath}/{draftId}"
 */
export function getDraftScopeId(projectPath: string, draftId: string): string {
  return `__draft__/${projectPath}/${draftId}`;
}

/**
 * Global scope ID for minion-independent preferences
 */
export const GLOBAL_SCOPE_ID = "__global__";

/**
 * Get the localStorage key for the UI theme preference (global)
 * Format: "uiTheme"
 */
export const UI_THEME_KEY = "uiTheme";

/**
 * LocalStorage key for the hidden Power Mode UI easter egg (global).
 */
export const POWER_MODE_ENABLED_KEY = "powerModeEnabled";

/**
 * Get the localStorage key for the last selected provider when adding custom models (global)
 * Format: "lastCustomModelProvider"
 */
export const LAST_CUSTOM_MODEL_PROVIDER_KEY = "lastCustomModelProvider";

/**
 * Get the localStorage key for the currently selected minion (global)
 * Format: "selectedMinion"
 */
export const SELECTED_MINION_KEY = "selectedMinion";

/**
 * Get the localStorage key for expanded projects in sidebar (global)
 * Format: "expandedProjects"
 */
export const EXPANDED_PROJECTS_KEY = "expandedProjects";

/**
 * LocalStorage key for UI-only minion creation drafts.
 *
 * Value: Record<string, Array<{ draftId: string; crewId: string | null; createdAt: number }>>
 * Keyed by projectPath.
 */
export const MINION_DRAFTS_BY_PROJECT_KEY = "minionDraftsByProject";

/**
 * Storage key for runtime enablement settings (shared via ~/.lattice/config.json).
 */
export const RUNTIME_ENABLEMENT_KEY = "runtimeEnablement";

/**
 * Storage key for global default runtime selection (shared via ~/.lattice/config.json).
 */
export const DEFAULT_RUNTIME_KEY = "defaultRuntime";

/**
 * Get the localStorage key for cached MCP server test results (per project)
 * Format: "mcpTestResults:{projectPath}"
 * Stores: Record<serverName, CachedMCPTestResult>
 */
export function getMCPTestResultsKey(projectPath: string): string {
  return `mcpTestResults:${projectPath}`;
}

/**
 * Get the localStorage key for cached archived minions per project
 * Format: "archivedMinions:{projectPath}"
 * Stores: Array of minion metadata objects (optimistic cache)
 */
export function getBenchedMinionsKey(projectPath: string): string {
  return `archivedMinions:${projectPath}`;
}

/**
 * Get the localStorage key for cached MCP servers per project
 * Format: "mcpServers:{projectPath}"
 * Stores: Record<serverName, MCPServerInfo> (optimistic cache)
 */
export function getMCPServersKey(projectPath: string): string {
  return `mcpServers:${projectPath}`;
}

/**
 * Get the localStorage key for thinking level preference per scope (minion/project).
 * Format: "thinkingLevel:{scopeId}"
 */
export function getThinkingLevelKey(scopeId: string): string {
  return `thinkingLevel:${scopeId}`;
}

/**
 * Get the localStorage key for per-agent minion AI overrides cache.
 * Format: "minionAiSettingsByAgent:{minionId}"
 */
export function getMinionAISettingsByAgentKey(minionId: string): string {
  return `minionAiSettingsByAgent:${minionId}`;
}

/**
 * LEGACY: Get the localStorage key for thinking level preference per model (global).
 * Format: "thinkingLevel:model:{modelName}"
 *
 * Kept for one-time migration to per-minion thinking.
 */
export function getThinkingLevelByModelKey(modelName: string): string {
  return `thinkingLevel:model:${modelName}`;
}

/**
 * Get the localStorage key for the user's preferred model for a minion
 */
export function getModelKey(minionId: string): string {
  return `model:${minionId}`;
}

/**
 * Get the localStorage key for the input text for a minion
 */
export function getInputKey(minionId: string): string {
  return `input:${minionId}`;
}

/**
 * Get the localStorage key for persisted minion name-generation state.
 *
 * This is used by the minion creation flow so drafts can preserve their
 * auto-generated (or manually edited) minion name independently.
 *
 * Format: "minionNameState:{scopeId}"
 */
export function getMinionNameStateKey(scopeId: string): string {
  return `minionNameState:${scopeId}`;
}

/**
 * Get the localStorage key for the input attachments for a scope.
 * Format: "inputAttachments:{scopeId}"
 *
 * Note: The input key functions accept any string scope ID. For normal minions
 * this is the minionId; for creation mode it's a pending scope ID.
 */
export function getInputAttachmentsKey(scopeId: string): string {
  return `inputAttachments:${scopeId}`;
}

/**
 * Get the localStorage key for pending initial send errors after minion creation.
 * Stored so the minion view can surface a toast after navigation.
 * Format: "pendingSendError:{minionId}"
 */
export function getPendingMinionSendErrorKey(minionId: string): string {
  return `pendingSendError:${minionId}`;
}

/**
 * LEGACY: Get the localStorage key for pre-backend auto-retry preference.
 *
 * Kept only for one-way migration during onChat subscription.
 */
export function getAutoRetryKey(minionId: string): string {
  return `${minionId}-autoRetry`;
}

/**
 * Get storage key for cancelled compaction tracking.
 * Stores compaction-request user message ID to verify freshness across reloads.
 */
export function getCancelledCompactionKey(minionId: string): string {
  return `minion:${minionId}:cancelled-compaction`;
}

/**
 * Get the localStorage key for the selected agent definition id for a scope.
 * Format: "agentId:{scopeId}"
 */
export function getAgentIdKey(scopeId: string): string {
  return `agentId:${scopeId}`;
}

/**
 * Get the localStorage key for the pinned third agent id for a scope.
 * Format: "pinnedAgentId:{scopeId}"
 */
export function getPinnedAgentIdKey(scopeId: string): string {
  return `pinnedAgentId:${scopeId}`;
}
/**
 * Get the localStorage key for "disable minion agents" toggle per scope.
 * When true, minion-specific agents are disabled - only built-in and global agents are loaded.
 * Useful for "unbricking" when iterating on agent files in a minion worktree.
 * Format: "disableMinionAgents:{scopeId}"
 */
export function getDisableMinionAgentsKey(scopeId: string): string {
  return `disableMinionAgents:${scopeId}`;
}
/**
 * Get the localStorage key for the default runtime for a project
 * Defaults to worktree if not set; can only be changed via the "Default for project" checkbox.
 * Format: "runtime:{projectPath}"
 */
export function getRuntimeKey(projectPath: string): string {
  return `runtime:${projectPath}`;
}

/**
 * Get the localStorage key for trunk branch preference for a project
 * Stores the last used trunk branch when creating a minion
 * Format: "trunkBranch:{projectPath}"
 */
export function getTrunkBranchKey(projectPath: string): string {
  return `trunkBranch:${projectPath}`;
}

/**
 * Get the localStorage key for whether to show the "Initialize with AGENTS.md" nudge for a project.
 * Set to true when a project is first added; cleared when user dismisses or runs /init.
 * Format: "agentsInitNudge:{projectPath}"
 */
export function getAgentsInitNudgeKey(projectPath: string): string {
  return `agentsInitNudge:${projectPath}`;
}

/**
 * Get the localStorage key for the last runtime config used per provider for a project.
 *
 * Value shape is a provider-keyed object (e.g. { ssh: { host }, docker: { image } }) so we can
 * add new options without adding more storage keys.
 *
 * Format: "lastRuntimeConfig:{projectPath}"
 */
export function getLastRuntimeConfigKey(projectPath: string): string {
  return `lastRuntimeConfig:${projectPath}`;
}


/** Get the localStorage key for inbox channel filter per project. */
export function getInboxChannelFilterKey(projectPath: string): string {
  return `inboxChannelFilter:${projectPath}`;
}

/** Get the localStorage key for selected inbox conversation per project. */
export function getInboxSelectedConversationKey(projectPath: string): string {
  return `inboxSelectedConversation:${projectPath}`;
}

/**
 * Get the localStorage key for assembly line crew expand/collapse state.
 * Format: "assemblySection:{projectPath}:{crewId}"
 */
export function getAssemblySectionExpandedKey(projectPath: string, crewId: string): string {
  return `assemblySection:${projectPath}:${crewId}`;
}

/**
 * Get the localStorage key for the default model (global).
 *
 * Note: This is used as a fallback when creating new minions.
 * Format: "model-default"
 */
export const DEFAULT_MODEL_KEY = "model-default";

/**
 * Get the localStorage key for the hidden models list (global).
 * Format: "hidden-models"
 */
export const HIDDEN_MODELS_KEY = "hidden-models";

/**
 * Get the localStorage key for the preferred compaction model (global)
 * Format: "preferredCompactionModel"
 */
export const PREFERRED_COMPACTION_MODEL_KEY = "preferredCompactionModel";

/**
 * Get the localStorage key for the preferred System 1 model (global)
 * Format: "preferredSystem1Model"
 */
export const PREFERRED_SYSTEM_1_MODEL_KEY = "preferredSystem1Model";

/**
 * Get the localStorage key for the preferred System 1 thinking level (global)
 * Format: "preferredSystem1ThinkingLevel"
 */
export const PREFERRED_SYSTEM_1_THINKING_LEVEL_KEY = "preferredSystem1ThinkingLevel";

/**
 * Get the localStorage key for cached per-agent AI defaults (global).
 * Format: "agentAiDefaults"
 */
export const AGENT_AI_DEFAULTS_KEY = "agentAiDefaults";

/**
 * Get the localStorage key for vim mode preference (global)
 * Format: "vimEnabled"
 */
export const VIM_ENABLED_KEY = "vimEnabled";

/**
 * Preferred expiration for lattice.md shares (global)
 * Stores: "1h" | "24h" | "7d" | "30d" | "never"
 * Default: "7d"
 */
export const SHARE_EXPIRATION_KEY = "shareExpiration";

/**
 * Whether to sign shared messages by default.
 * Stores: boolean
 * Default: true
 */
export const SHARE_SIGNING_KEY = "shareSigning";

/**
 * Git status indicator display mode (global)
 * Stores: "line-delta" | "divergence"
 */

export const GIT_STATUS_INDICATOR_MODE_KEY = "gitStatusIndicatorMode";

/**
 * Editor configuration for "Open in Editor" feature (global)
 * Format: "editorConfig"
 */
export const EDITOR_CONFIG_KEY = "editorConfig";

export type EditorType = "vscode" | "cursor" | "zed" | "custom";

export interface EditorConfig {
  editor: EditorType;
  customCommand?: string; // Only when editor='custom'
}

export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  editor: "vscode",
};

/**
 * Integrated terminal font configuration (global)
 * Stores: { fontFamily: string; fontSize: number }
 */
export const TERMINAL_FONT_CONFIG_KEY = "terminalFontConfig";

export interface TerminalFontConfig {
  fontFamily: string;
  fontSize: number;
}

export const DEFAULT_TERMINAL_FONT_CONFIG: TerminalFontConfig = {
  fontFamily: "Geist Mono, ui-monospace, monospace",
  fontSize: 13,
};

/**
 * Tutorial state storage key (global)
 * Stores: { disabled: boolean, completed: { creation?: true, minion?: true, review?: true } }
 */
export const TUTORIAL_STATE_KEY = "tutorialState";

export type TutorialSequence = "creation" | "minion" | "review";

export interface TutorialState {
  disabled: boolean;
  completed: Partial<Record<TutorialSequence, true>>;
}

export const DEFAULT_TUTORIAL_STATE: TutorialState = {
  disabled: false,
  completed: {},
};

/**
 * Get the localStorage key for review (hunk read) state per minion
 * Stores which hunks have been marked as read during code review
 * Format: "review-state:{minionId}"
 */
export function getReviewStateKey(minionId: string): string {
  return `review-state:${minionId}`;
}

/**
 * Get the localStorage key for hunk first-seen timestamps per minion
 * Tracks when each hunk content address was first observed (for LIFO sorting)
 * Format: "hunkFirstSeen:{minionId}"
 */
export function getHunkFirstSeenKey(minionId: string): string {
  return `hunkFirstSeen:${minionId}`;
}

/**
 * Get the localStorage key for review sort order preference (global)
 * Format: "review-sort-order"
 */
export const REVIEW_SORT_ORDER_KEY = "review-sort-order";

/**
 * Get the localStorage key for hunk expand/collapse state in Review tab
 * Stores user's manual expand/collapse preferences per hunk
 * Format: "reviewExpandState:{minionId}"
 */
export function getReviewExpandStateKey(minionId: string): string {
  return `reviewExpandState:${minionId}`;
}

/**
 * Get the localStorage key for read-more expansion state per hunk.
 * Tracks how many lines are expanded up/down for each hunk.
 * Format: "reviewReadMore:{minionId}"
 */
export function getReviewReadMoreKey(minionId: string): string {
  return `reviewReadMore:${minionId}`;
}

/**
 * Get the localStorage key for FileTree expand/collapse state in Review tab
 * Stores directory expand/collapse preferences per minion
 * Format: "fileTreeExpandState:{minionId}"
 */
export function getFileTreeExpandStateKey(minionId: string): string {
  return `fileTreeExpandState:${minionId}`;
}

/**
 * LocalStorage key for file tree view mode in the Review tab (global).
 * Format: "reviewFileTreeViewMode"
 */
export const REVIEW_FILE_TREE_VIEW_MODE_KEY = "reviewFileTreeViewMode";

/**
 * Get the localStorage key for persisted agent status for a minion
 * Stores the most recent successful status_set payload (emoji, message, url)
 * Format: "statusState:{minionId}"
 */

/**
 * Get the localStorage key for "notify on response" toggle per minion.
 * When true, a browser notification is shown when assistant responses complete.
 * Format: "notifyOnResponse:{minionId}"
 */
export function getNotifyOnResponseKey(minionId: string): string {
  return `notifyOnResponse:${minionId}`;
}

/**
 * Get the localStorage key for "auto-enable notifications" toggle per project.
 * When true, new minions in this project automatically have notifications enabled.
 * Format: "notifyOnResponseAutoEnable:{projectPath}"
 */
export function getNotifyOnResponseAutoEnableKey(projectPath: string): string {
  return `notifyOnResponseAutoEnable:${projectPath}`;
}

export function getStatusStateKey(minionId: string): string {
  return `statusState:${minionId}`;
}

/**
 * Get the localStorage key for session timing stats for a minion
 * Stores aggregate timing data: totalDurationMs, totalToolExecutionMs, totalTtftMs, ttftCount, responseCount
 * Format: "sessionTiming:{minionId}"
 */
export function getSessionTimingKey(minionId: string): string {
  return `sessionTiming:${minionId}`;
}

/**
 * Get the localStorage key for last-read timestamps per minion.
 * Format: "minionLastRead:{minionId}"
 */
export function getMinionLastReadKey(minionId: string): string {
  return `minionLastRead:${minionId}`;
}

/**
 * Left sidebar collapsed state (global, manual toggle)
 * Format: "sidebarCollapsed"
 */
export const LEFT_SIDEBAR_COLLAPSED_KEY = "sidebarCollapsed";

/**
 * Left sidebar width
 * Format: "left-sidebar:width"
 */
export const LEFT_SIDEBAR_WIDTH_KEY = "left-sidebar:width";

/**
 * Mobile left sidebar scroll position.
 *
 * The mobile sidebar content unmounts when collapsed, so we persist scrollTop
 * to restore the previous browse position when the menu is reopened.
 * Format: "mobile-left-sidebar:scroll-top"
 */
export const MOBILE_LEFT_SIDEBAR_SCROLL_TOP_KEY = "mobile-left-sidebar:scroll-top";

/**
 * workbench panel tab selection (global)
 * Format: "right-sidebar-tab"
 */
export const WORKBENCH_PANEL_TAB_KEY = "right-sidebar-tab";

/**
 * workbench panel collapsed state (global, manual toggle)
 * Format: "right-sidebar:collapsed"
 */
export const WORKBENCH_PANEL_COLLAPSED_KEY = "right-sidebar:collapsed";

/**
 * Chat pane collapsed state (global, manual toggle).
 * When collapsed, the chat pane hides to the right and the sidebar fills all space.
 * Format: "chat-pane:collapsed"
 */
export const CHAT_PANE_COLLAPSED_KEY = "chat-pane:collapsed";

/**
 * workbench panel width (unified across all tabs)
 * Format: "right-sidebar:width"
 */
export const WORKBENCH_PANEL_WIDTH_KEY = "right-sidebar:width";

/**
 * Get the localStorage key for workbench panel dock-lite layout per minion.
 * Each minion can have its own split/tab configuration (e.g., different
 * numbers of terminals). Width and collapsed state remain global.
 * Format: "right-sidebar:layout:{minionId}"
 */
export function getWorkbenchPanelLayoutKey(minionId: string): string {
  return `right-sidebar:layout:${minionId}`;
}

/**
 * Get the localStorage key for terminal titles per minion.
 * Maps sessionId -> title for persisting OSC-set terminal titles.
 * Format: "right-sidebar:terminal-titles:{minionId}"
 */
export function getTerminalTitlesKey(minionId: string): string {
  return `right-sidebar:terminal-titles:${minionId}`;
}

/**
 * Get the localStorage key for unified Review search state per minion
 * Stores: { input: string, useRegex: boolean, matchCase: boolean }
 * Format: "reviewSearchState:{minionId}"
 */
export function getReviewSearchStateKey(minionId: string): string {
  return `reviewSearchState:${minionId}`;
}

/**
 * Get the localStorage key for reviews per minion
 * Stores: ReviewsState (reviews created from diff viewer - pending, attached, or checked)
 * Format: "reviews:{minionId}"
 */
export function getReviewsKey(minionId: string): string {
  return `reviews:${minionId}`;
}

/**
 * Get the localStorage key for immersive review mode state per minion
 * Tracks whether immersive mode is active
 * Format: "review-immersive:{minionId}"
 */
export function getReviewImmersiveKey(minionId: string): string {
  return `review-immersive:${minionId}`;
}

/**
 * Get the localStorage key for auto-compaction enabled preference per minion
 * Format: "autoCompaction:enabled:{minionId}"
 */
export function getAutoCompactionEnabledKey(minionId: string): string {
  return `autoCompaction:enabled:${minionId}`;
}

/**
 * Get the localStorage key for auto-compaction threshold percentage per model
 * Format: "autoCompaction:threshold:{model}"
 * Stored per-model because different models have different context windows
 */
export function getAutoCompactionThresholdKey(model: string): string {
  return `autoCompaction:threshold:${model}`;
}

/**
 * List of minion-scoped key functions that should be copied on fork and deleted on removal
 */
const PERSISTENT_MINION_KEY_FUNCTIONS: Array<(minionId: string) => string> = [
  getMinionAISettingsByAgentKey,
  getModelKey,
  getInputKey,
  getMinionNameStateKey,
  getInputAttachmentsKey,
  getAgentIdKey,
  getPinnedAgentIdKey,
  getThinkingLevelKey,
  getReviewStateKey,
  getHunkFirstSeenKey,
  getReviewExpandStateKey,
  getReviewReadMoreKey,
  getFileTreeExpandStateKey,
  getReviewSearchStateKey,
  getReviewsKey,
  getReviewImmersiveKey,
  getAutoCompactionEnabledKey,
  getMinionLastReadKey,
  getStatusStateKey,
  // Note: auto-compaction threshold is per-model, not per-minion
];

/**
 * Get the localStorage key for cached plan content for a minion
 * Stores: { content: string; path: string } - used for optimistic rendering
 * Format: "planContent:{minionId}"
 */
export function getPlanContentKey(minionId: string): string {
  return `planContent:${minionId}`;
}

/**
 * Get the localStorage key for cached post-compaction state for a minion
 * Stores: { planPath: string | null; trackedFilePaths: string[]; excludedItems: string[] }
 * Format: "postCompactionState:{minionId}"
 */
export function getPostCompactionStateKey(minionId: string): string {
  return `postCompactionState:${minionId}`;
}

/**
 * Additional ephemeral keys to delete on minion removal (not copied on fork)
 */
const EPHEMERAL_MINION_KEY_FUNCTIONS: Array<(minionId: string) => string> = [
  getCancelledCompactionKey,
  getPendingMinionSendErrorKey,
  getPlanContentKey, // Cache only, no need to preserve on fork
  getPostCompactionStateKey, // Cache only, no need to preserve on fork
];

/**
 * Copy all minion-specific localStorage keys from source to destination minion.
 * Includes keys listed in PERSISTENT_MINION_KEY_FUNCTIONS (model, draft input text/attachments, etc).
 */
export function copyMinionStorage(sourceMinionId: string, destMinionId: string): void {
  for (const getKey of PERSISTENT_MINION_KEY_FUNCTIONS) {
    const sourceKey = getKey(sourceMinionId);
    const destKey = getKey(destMinionId);
    const value = localStorage.getItem(sourceKey);
    if (value !== null) {
      localStorage.setItem(destKey, value);
    }
  }
}

/**
 * Delete all minion-specific localStorage keys for a minion
 * Should be called when a minion is deleted to prevent orphaned data
 */
export function deleteMinionStorage(minionId: string): void {
  const allKeyFunctions = [
    ...PERSISTENT_MINION_KEY_FUNCTIONS,
    ...EPHEMERAL_MINION_KEY_FUNCTIONS,
  ];

  for (const getKey of allKeyFunctions) {
    const key = getKey(minionId);
    localStorage.removeItem(key);
  }
}

/**
 * Migrate all minion-specific localStorage keys from old to new minion ID
 * Should be called when a minion is renamed to preserve settings
 */
export function migrateMinionStorage(oldMinionId: string, newMinionId: string): void {
  copyMinionStorage(oldMinionId, newMinionId);
  deleteMinionStorage(oldMinionId);
}
