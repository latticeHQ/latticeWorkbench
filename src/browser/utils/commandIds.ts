/**
 * Centralized command ID construction and matching
 * Single source of truth for all command ID patterns
 */

/**
 * Command ID prefixes for pattern matching
 * Single source of truth for all dynamic ID patterns
 */
const COMMAND_ID_PREFIXES = {
  WS_SWITCH: "ws:switch:",
  CHAT_TRUNCATE: "chat:truncate:",
  PROJECT_REMOVE: "project:remove:",
} as const;

/**
 * Command ID builders - construct IDs with consistent patterns
 */
export const CommandIds = {
  // Minion commands
  minionSwitch: (minionId: string) =>
    `${COMMAND_ID_PREFIXES.WS_SWITCH}${minionId}` as const,
  minionNew: () => "ws:new" as const,
  minionNewInProject: () => "ws:new-in-project" as const,
  minionRemove: () => "ws:remove" as const,
  minionRemoveAny: () => "ws:remove-any" as const,
  minionEditTitle: () => "ws:edit-title" as const,
  minionEditTitleAny: () => "ws:edit-title-any" as const,
  minionGenerateTitle: () => "ws:generate-title" as const,
  minionOpenTerminal: () => "ws:open-terminal" as const,
  minionOpenTerminalCurrent: () => "ws:open-terminal-current" as const,
  minionArchiveMergedInProject: () => "ws:archive-merged-in-project" as const,

  // Navigation commands
  navNext: () => "nav:next" as const,
  navPrev: () => "nav:prev" as const,
  navToggleSidebar: () => "nav:toggleSidebar" as const,
  navWorkbenchPanelFocusTerminal: () => "nav:workbenchPanel:focusTerminal" as const,
  navWorkbenchPanelSplitHorizontal: () => "nav:workbenchPanel:splitHorizontal" as const,
  navWorkbenchPanelSplitVertical: () => "nav:workbenchPanel:splitVertical" as const,
  navWorkbenchPanelAddTool: () => "nav:workbenchPanel:addTool" as const,
  navToggleOutput: () => "nav:toggle-output" as const,
  navOpenLogFile: () => "nav:open-log-file" as const,

  // Chat commands
  chatClear: () => "chat:clear" as const,
  chatTruncate: (pct: number) => `${COMMAND_ID_PREFIXES.CHAT_TRUNCATE}${pct}` as const,
  chatInterrupt: () => "chat:interrupt" as const,
  chatJumpBottom: () => "chat:jumpBottom" as const,
  chatVoiceInput: () => "chat:voiceInput" as const,
  chatClearTimingStats: () => "chat:clearTimingStats" as const,

  // Mode commands
  modeToggle: () => "mode:toggle" as const,
  modelChange: () => "model:change" as const,
  thinkingSetLevel: () => "thinking:set-level" as const,

  // Project commands
  projectAdd: () => "project:add" as const,
  projectRemove: (projectPath: string) =>
    `${COMMAND_ID_PREFIXES.PROJECT_REMOVE}${projectPath}` as const,

  // Appearance commands
  themeToggle: () => "appearance:theme:toggle" as const,
  themeSet: (theme: string) => `appearance:theme:set:${theme}` as const,

  // Analytics commands
  analyticsRebuildDatabase: () => "analytics:rebuild-database" as const,

  // Layout commands
  layoutApplySlot: (slot: number) => `layout:apply-slot:${slot}` as const,
  layoutCaptureSlot: (slot: number) => `layout:capture-slot:${slot}` as const,
  // Settings commands
  settingsOpen: () => "settings:open" as const,
  settingsOpenSection: (section: string) => `settings:open:${section}` as const,

  // Help commands
  helpKeybinds: () => "help:keybinds" as const,
} as const;

/**
 * Command ID matchers - test if an ID matches a pattern
 */
export const CommandIdMatchers = {
  /**
   * Check if ID is a minion switching command (ws:switch:*)
   */
  isMinionSwitch: (id: string): boolean => id.startsWith(COMMAND_ID_PREFIXES.WS_SWITCH),

  /**
   * Check if ID is a chat truncate command (chat:truncate:*)
   */
  isChatTruncate: (id: string): boolean => id.startsWith(COMMAND_ID_PREFIXES.CHAT_TRUNCATE),

  /**
   * Check if ID is a project remove command (project:remove:*)
   */
  isProjectRemove: (id: string): boolean => id.startsWith(COMMAND_ID_PREFIXES.PROJECT_REMOVE),
} as const;
