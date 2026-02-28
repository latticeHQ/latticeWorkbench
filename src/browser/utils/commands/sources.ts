import { THEME_OPTIONS, type ThemeMode } from "@/browser/contexts/ThemeContext";
import type { CommandAction } from "@/browser/contexts/CommandRegistryContext";
import type { APIClient } from "@/browser/contexts/API";
import type { ConfirmDialogOptions } from "@/browser/contexts/ConfirmDialogContext";
import { formatKeybind, KEYBINDS } from "@/browser/utils/ui/keybinds";
import { THINKING_LEVELS, type ThinkingLevel } from "@/common/types/thinking";
import { getThinkingPolicyForModel } from "@/common/utils/thinking/policy";
import assert from "@/common/utils/assert";
import { CUSTOM_EVENTS, createCustomEvent } from "@/common/constants/events";
import {
  getWorkbenchPanelLayoutKey,
  WORKBENCH_PANEL_COLLAPSED_KEY,
  WORKBENCH_PANEL_TAB_KEY,
} from "@/common/constants/storage";
import { readPersistedState, updatePersistedState } from "@/browser/hooks/usePersistedState";
import { LATTICE_HELP_CHAT_MINION_ID } from "@/common/constants/latticeChat";
import { CommandIds } from "@/browser/utils/commandIds";
import { isTabType, type TabType } from "@/browser/types/workbenchPanel";
import {
  getEffectiveSlotKeybind,
  getLayoutsConfigOrDefault,
  getPresetForSlot,
} from "@/browser/utils/uiLayouts";
import type { LayoutPresetsConfig, LayoutSlotNumber } from "@/common/types/uiLayouts";
import {
  addToolToFocusedTabset,
  getDefaultWorkbenchPanelLayoutState,
  hasTab,
  parseWorkbenchPanelLayoutState,
  selectTabInTabset,
  setFocusedTabset,
  splitFocusedTabset,
  toggleTab,
} from "@/browser/utils/workbenchPanelLayout";

import type { ProjectConfig } from "@/node/config";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { BranchListResult } from "@/common/orpc/types";
import type { MinionState } from "@/browser/stores/MinionStore";
import type { RuntimeConfig } from "@/common/types/runtime";
import { getErrorMessage } from "@/common/utils/errors";

export interface BuildSourcesParams {
  api: APIClient | null;
  projects: Map<string, ProjectConfig>;
  /** Map of minion ID to minion metadata (keyed by metadata.id, not path) */
  minionMetadata: Map<string, FrontendMinionMetadata>;
  /** In-app confirmation dialog (replaces window.confirm) */
  confirmDialog: (opts: ConfirmDialogOptions) => Promise<boolean>;
  theme: ThemeMode;
  selectedMinionState?: MinionState | null;
  selectedMinion: {
    projectPath: string;
    projectName: string;
    namedMinionPath: string;
    minionId: string;
  } | null;
  streamingModels?: Map<string, string>;
  // UI actions
  getThinkingLevel: (minionId: string) => ThinkingLevel;
  onSetThinkingLevel: (minionId: string, level: ThinkingLevel) => void;

  onStartMinionCreation: (projectPath: string) => void;
  onArchiveMergedMinionsInProject: (projectPath: string) => Promise<void>;
  getBranchesForProject: (projectPath: string) => Promise<BranchListResult>;
  onSelectMinion: (sel: {
    projectPath: string;
    projectName: string;
    namedMinionPath: string;
    minionId: string;
  }) => void;
  onRemoveMinion: (minionId: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateTitle: (
    minionId: string,
    newName: string
  ) => Promise<{ success: boolean; error?: string }>;
  onAddProject: () => void;
  onRemoveProject: (path: string) => void;
  onToggleSidebar: () => void;
  onNavigateMinion: (dir: "next" | "prev") => void;
  onOpenMinionInTerminal: (minionId: string, runtimeConfig?: RuntimeConfig) => void;
  onToggleTheme: () => void;
  onSetTheme: (theme: ThemeMode) => void;
  onOpenSettings?: (section?: string) => void;

  // Layout slots
  layoutPresets?: LayoutPresetsConfig | null;
  onApplyLayoutSlot?: (minionId: string, slot: LayoutSlotNumber) => void;
  onCaptureLayoutSlot?: (
    minionId: string,
    slot: LayoutSlotNumber,
    name: string
  ) => Promise<void>;
  onClearTimingStats?: (minionId: string) => void;
}

/**
 * Command palette crew names
 * Exported for use in filtering and command organization
 */
export const COMMAND_SECTIONS = {
  MINIONS: "Minions",
  LAYOUTS: "Layouts",
  NAVIGATION: "Navigation",
  CHAT: "Chat",
  MODE: "Modes & Model",
  HELP: "Help",
  PROJECTS: "Projects",
  APPEARANCE: "Appearance",
  SETTINGS: "Settings",
} as const;

const section = {
  layouts: COMMAND_SECTIONS.LAYOUTS,
  minions: COMMAND_SECTIONS.MINIONS,
  navigation: COMMAND_SECTIONS.NAVIGATION,
  chat: COMMAND_SECTIONS.CHAT,
  appearance: COMMAND_SECTIONS.APPEARANCE,
  mode: COMMAND_SECTIONS.MODE,
  help: COMMAND_SECTIONS.HELP,
  projects: COMMAND_SECTIONS.PROJECTS,
  settings: COMMAND_SECTIONS.SETTINGS,
};

const getWorkbenchPanelTabFallback = (): TabType => {
  const raw = readPersistedState<string>(WORKBENCH_PANEL_TAB_KEY, "costs");
  return isTabType(raw) ? raw : "costs";
};

const readWorkbenchPanelLayout = (minionId: string) => {
  const fallback = getWorkbenchPanelTabFallback();
  const raw = readPersistedState(
    getWorkbenchPanelLayoutKey(minionId),
    getDefaultWorkbenchPanelLayoutState(fallback)
  );
  return parseWorkbenchPanelLayoutState(raw, fallback);
};

const updateWorkbenchPanelLayout = (
  minionId: string,
  updater: (
    state: ReturnType<typeof parseWorkbenchPanelLayoutState>
  ) => ReturnType<typeof parseWorkbenchPanelLayoutState>
) => {
  const fallback = getWorkbenchPanelTabFallback();
  const defaultLayout = getDefaultWorkbenchPanelLayoutState(fallback);

  updatePersistedState<ReturnType<typeof parseWorkbenchPanelLayoutState>>(
    getWorkbenchPanelLayoutKey(minionId),
    (prev) => updater(parseWorkbenchPanelLayoutState(prev, fallback)),
    defaultLayout
  );
};

function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");

  // Windows drive letter paths: C:/...
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  // POSIX absolute paths: /...
  if (normalized.startsWith("/")) {
    return `file://${encodeURI(normalized)}`;
  }

  // Fall back to treating the string as a path-ish URL segment.
  return `file://${encodeURI(normalized)}`;
}

interface AnalyticsRebuildNamespace {
  rebuildDatabase?: (
    input: Record<string, never>
  ) => Promise<{ success: boolean; minionsIngested: number }>;
}

const getAnalyticsRebuildDatabase = (
  api: APIClient | null
): AnalyticsRebuildNamespace["rebuildDatabase"] | null => {
  const candidate = (api as { analytics?: unknown } | null)?.analytics;
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) {
    return null;
  }

  const rebuildDatabase = (candidate as AnalyticsRebuildNamespace).rebuildDatabase;
  return typeof rebuildDatabase === "function" ? rebuildDatabase : null;
};

const showCommandFeedbackToast = (feedback: {
  type: "success" | "error";
  message: string;
  title?: string;
}) => {
  if (typeof window === "undefined") {
    return;
  }

  // Analytics view does not mount ChatInput, so keep a basic alert fallback
  // for command palette actions that need user feedback.
  const hasChatInputToastHost =
    typeof document !== "undefined" &&
    document.querySelector('[data-component="ChatInputSection"]') !== null;

  if (hasChatInputToastHost) {
    window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.ANALYTICS_REBUILD_TOAST, feedback));
    return;
  }

  const alertMessage = feedback.title
    ? `${feedback.title}\n\n${feedback.message}`
    : feedback.message;
  if (typeof window.alert === "function") {
    window.alert(alertMessage);
  }
};

const findFirstTerminalSessionTab = (
  node: ReturnType<typeof parseWorkbenchPanelLayoutState>["root"]
): { tabsetId: string; tab: TabType } | null => {
  if (node.type === "tabset") {
    const tab = node.tabs.find((t) => t.startsWith("terminal:") && t !== "terminal");
    return tab ? { tabsetId: node.id, tab } : null;
  }

  return (
    findFirstTerminalSessionTab(node.children[0]) ?? findFirstTerminalSessionTab(node.children[1])
  );
};
export function buildCoreSources(p: BuildSourcesParams): Array<() => CommandAction[]> {
  const actions: Array<() => CommandAction[]> = [];

  // NOTE: We intentionally route to the chat-based creation flow instead of
  // building a separate prompt. This keeps `/new`, keybinds, and the command
  // palette perfectly aligned on one experience.
  const createMinionForSelectedProjectAction = (
    selected: NonNullable<BuildSourcesParams["selectedMinion"]>
  ): CommandAction => {
    return {
      id: CommandIds.minionNew(),
      title: "Summon New Minion…",
      subtitle: `for ${selected.projectName}`,
      section: section.minions,
      shortcutHint: formatKeybind(KEYBINDS.NEW_MINION),
      run: () => p.onStartMinionCreation(selected.projectPath),
    };
  };

  // Minions
  actions.push(() => {
    const list: CommandAction[] = [];

    const selected = p.selectedMinion;
    if (selected) {
      list.push(createMinionForSelectedProjectAction(selected));
    }

    // Switch to minion
    // Iterate through all minion metadata (now keyed by minion ID)
    for (const meta of p.minionMetadata.values()) {
      const isCurrent = selected?.minionId === meta.id;
      const isStreaming = p.streamingModels?.has(meta.id) ?? false;
      // Title is primary (if set), name is secondary identifier
      const primaryLabel = meta.title ?? meta.name;
      const secondaryParts = [meta.name, meta.projectName];
      if (isStreaming) secondaryParts.push("streaming");
      list.push({
        id: CommandIds.minionSwitch(meta.id),
        title: `${isCurrent ? "• " : ""}${primaryLabel}`,
        subtitle: secondaryParts.join(" · "),
        section: section.minions,
        keywords: [meta.name, meta.projectName, meta.namedMinionPath, meta.title].filter(
          (k): k is string => !!k
        ),
        run: () =>
          p.onSelectMinion({
            projectPath: meta.projectPath,
            projectName: meta.projectName,
            namedMinionPath: meta.namedMinionPath,
            minionId: meta.id,
          }),
      });
    }

    // Remove current minion (rename action intentionally omitted until we add a proper modal)
    if (selected?.namedMinionPath) {
      const minionDisplayName = `${selected.projectName}/${selected.namedMinionPath.split("/").pop() ?? selected.namedMinionPath}`;
      const selectedMeta = p.minionMetadata.get(selected.minionId);
      list.push({
        id: CommandIds.minionOpenTerminalCurrent(),
        title: "New Terminal Window",
        subtitle: minionDisplayName,
        section: section.minions,
        // Note: Cmd/Ctrl+T opens integrated terminal in sidebar (not shown here since this opens a popout)
        run: () => {
          p.onOpenMinionInTerminal(selected.minionId, selectedMeta?.runtimeConfig);
        },
      });
      list.push({
        id: CommandIds.minionRemove(),
        title: "Remove Current Minion…",
        subtitle: minionDisplayName,
        section: section.minions,
        run: async () => {
          const branchName =
            selectedMeta?.name ??
            selected.namedMinionPath.split("/").pop() ??
            selected.namedMinionPath;
          const ok = await p.confirmDialog({
            title: "Remove current minion?",
            description: `This will delete the worktree and local branch "${branchName}".`,
            warning: "This cannot be undone.",
            confirmLabel: "Remove",
            confirmVariant: "destructive",
          });
          if (ok) await p.onRemoveMinion(selected.minionId);
        },
      });
      list.push({
        id: CommandIds.minionEditTitle(),
        title: "Edit Current Minion Title…",
        subtitle: minionDisplayName,
        shortcutHint: formatKeybind(KEYBINDS.EDIT_MINION_TITLE),
        section: section.minions,
        run: () => undefined,
        prompt: {
          title: "Edit Minion Title",
          fields: [
            {
              type: "text",
              name: "newTitle",
              label: "New title",
              placeholder: "Enter new minion title",
              initialValue:
                p.minionMetadata.get(selected.minionId)?.title ??
                p.minionMetadata.get(selected.minionId)?.name ??
                "",
              getInitialValue: () => {
                const current = p.minionMetadata.get(selected.minionId);
                return current?.title ?? current?.name ?? "";
              },
              validate: (v) => (!v.trim() ? "Title is required" : null),
            },
          ],
          onSubmit: async (vals) => {
            await p.onUpdateTitle(selected.minionId, vals.newTitle.trim());
          },
        },
      });
      if (selected.minionId !== LATTICE_HELP_CHAT_MINION_ID) {
        list.push({
          id: CommandIds.minionGenerateTitle(),
          title: "Generate New Title for Current Minion",
          subtitle: minionDisplayName,
          shortcutHint: formatKeybind(KEYBINDS.GENERATE_MINION_TITLE),
          section: section.minions,
          run: () => {
            window.dispatchEvent(
              createCustomEvent(CUSTOM_EVENTS.MINION_GENERATE_TITLE_REQUESTED, {
                minionId: selected.minionId,
              })
            );
          },
        });
      }
    }

    if (p.minionMetadata.size > 0) {
      list.push({
        id: CommandIds.minionOpenTerminal(),
        title: "Open Terminal Window for Minion…",
        section: section.minions,
        run: () => undefined,
        prompt: {
          title: "Open Terminal Window",
          fields: [
            {
              type: "select",
              name: "minionId",
              label: "Minion",
              placeholder: "Search minions…",
              getOptions: () =>
                Array.from(p.minionMetadata.values()).map((meta) => {
                  // Use minion name instead of extracting from path
                  const label = `${meta.projectName} / ${meta.name}`;
                  return {
                    id: meta.id,
                    label,
                    keywords: [
                      meta.name,
                      meta.projectName,
                      meta.namedMinionPath,
                      meta.id,
                      meta.title,
                    ].filter((k): k is string => !!k),
                  };
                }),
            },
          ],
          onSubmit: (vals) => {
            const meta = p.minionMetadata.get(vals.minionId);
            p.onOpenMinionInTerminal(vals.minionId, meta?.runtimeConfig);
          },
        },
      });
      list.push({
        id: CommandIds.minionEditTitleAny(),
        title: "Edit Minion Title…",
        section: section.minions,
        run: () => undefined,
        prompt: {
          title: "Edit Minion Title",
          fields: [
            {
              type: "select",
              name: "minionId",
              label: "Select minion",
              placeholder: "Search minions…",
              getOptions: () =>
                Array.from(p.minionMetadata.values()).map((meta) => {
                  const label = `${meta.projectName} / ${meta.name}`;
                  return {
                    id: meta.id,
                    label,
                    keywords: [
                      meta.name,
                      meta.projectName,
                      meta.namedMinionPath,
                      meta.id,
                      meta.title,
                    ].filter((k): k is string => !!k),
                  };
                }),
            },
            {
              type: "text",
              name: "newTitle",
              label: "New title",
              placeholder: "Enter new minion title",
              getInitialValue: (values) => {
                const meta = Array.from(p.minionMetadata.values()).find(
                  (m) => m.id === values.minionId
                );
                return meta?.title ?? meta?.name ?? "";
              },
              validate: (v) => (!v.trim() ? "Title is required" : null),
            },
          ],
          onSubmit: async (vals) => {
            await p.onUpdateTitle(vals.minionId, vals.newTitle.trim());
          },
        },
      });
      list.push({
        id: CommandIds.minionRemoveAny(),
        title: "Remove Minion…",
        section: section.minions,
        run: () => undefined,
        prompt: {
          title: "Remove Minion",
          fields: [
            {
              type: "select",
              name: "minionId",
              label: "Select minion",
              placeholder: "Search minions…",
              getOptions: () =>
                Array.from(p.minionMetadata.values()).map((meta) => {
                  const label = `${meta.projectName}/${meta.name}`;
                  return {
                    id: meta.id,
                    label,
                    keywords: [
                      meta.name,
                      meta.projectName,
                      meta.namedMinionPath,
                      meta.id,
                      meta.title,
                    ].filter((k): k is string => !!k),
                  };
                }),
            },
          ],
          onSubmit: async (vals) => {
            const meta = Array.from(p.minionMetadata.values()).find(
              (m) => m.id === vals.minionId
            );
            const minionName = meta ? `${meta.projectName}/${meta.name}` : vals.minionId;
            const branchName = meta?.name ?? minionName.split("/").pop() ?? minionName;
            const ok = await p.confirmDialog({
              title: `Remove minion ${minionName}?`,
              description: `This will delete the worktree and local branch "${branchName}".`,
              warning: "This cannot be undone.",
              confirmLabel: "Remove",
              confirmVariant: "destructive",
            });
            if (ok) {
              await p.onRemoveMinion(vals.minionId);
            }
          },
        },
      });
    }

    return list;
  });

  // Navigation / Interface
  actions.push(() => {
    const list: CommandAction[] = [
      {
        id: CommandIds.navNext(),
        title: "Next Minion",
        section: section.navigation,
        shortcutHint: formatKeybind(KEYBINDS.NEXT_MINION),
        run: () => p.onNavigateMinion("next"),
      },
      {
        id: CommandIds.navPrev(),
        title: "Previous Minion",
        section: section.navigation,
        shortcutHint: formatKeybind(KEYBINDS.PREV_MINION),
        run: () => p.onNavigateMinion("prev"),
      },
      {
        id: CommandIds.navToggleSidebar(),
        title: "Toggle Sidebar",
        section: section.navigation,
        shortcutHint: formatKeybind(KEYBINDS.TOGGLE_SIDEBAR),
        run: () => p.onToggleSidebar(),
      },
    ];

    // workbench panel layout commands require a selected minion (layout is per-minion)
    const wsId = p.selectedMinion?.minionId;
    if (wsId) {
      list.push(
        {
          id: CommandIds.navToggleOutput(),
          title: hasTab(readWorkbenchPanelLayout(wsId), "output") ? "Hide Output" : "Show Output",
          section: section.navigation,
          keywords: ["log", "logs", "output"],
          run: () => {
            const isOutputVisible = hasTab(readWorkbenchPanelLayout(wsId), "output");
            updateWorkbenchPanelLayout(wsId, (s) => toggleTab(s, "output"));
            if (!isOutputVisible) {
              updatePersistedState<boolean>(WORKBENCH_PANEL_COLLAPSED_KEY, false);
            }
          },
        },
        {
          id: CommandIds.navOpenLogFile(),
          title: "Open Log File",
          section: section.navigation,
          keywords: ["log", "logs"],
          run: async () => {
            const result = await p.api?.general.getLogPath();
            const logPath = result?.path;
            if (!logPath) return;

            window.open(toFileUrl(logPath), "_blank", "noopener");
          },
        },
        {
          id: CommandIds.navWorkbenchPanelFocusTerminal(),
          title: "Workbench: Focus Terminal",
          section: section.navigation,
          run: () =>
            updateWorkbenchPanelLayout(wsId, (s) => {
              const found = findFirstTerminalSessionTab(s.root);
              if (!found) return s;
              return selectTabInTabset(
                setFocusedTabset(s, found.tabsetId),
                found.tabsetId,
                found.tab
              );
            }),
        },
        {
          id: CommandIds.navWorkbenchPanelSplitHorizontal(),
          title: "Workbench: Split Horizontally",
          section: section.navigation,
          run: () => updateWorkbenchPanelLayout(wsId, (s) => splitFocusedTabset(s, "horizontal")),
        },
        {
          id: CommandIds.navWorkbenchPanelSplitVertical(),
          title: "Workbench: Split Vertically",
          section: section.navigation,
          run: () => updateWorkbenchPanelLayout(wsId, (s) => splitFocusedTabset(s, "vertical")),
        },
        {
          id: CommandIds.navWorkbenchPanelAddTool(),
          title: "Workbench: Add Tool…",
          section: section.navigation,
          run: () => undefined,
          prompt: {
            title: "Add Workbench Tool",
            fields: [
              {
                type: "select",
                name: "tool",
                label: "Tool",
                placeholder: "Select a tool…",
                getOptions: () =>
                  (["costs", "review", "output", "terminal"] as TabType[]).map((tab) => ({
                    id: tab,
                    label:
                      tab === "costs"
                        ? "Costs"
                        : tab === "review"
                          ? "Review"
                          : tab === "output"
                            ? "Output"
                            : "Terminal",
                    keywords: [tab],
                  })),
              },
            ],
            onSubmit: (vals) => {
              const tool = vals.tool;
              if (!isTabType(tool)) return;

              // "terminal" is now an alias for "focus an existing terminal session tab".
              // Creating new terminal sessions is handled in the main UI ("+" button).
              if (tool === "terminal") {
                updateWorkbenchPanelLayout(wsId, (s) => {
                  const found = findFirstTerminalSessionTab(s.root);
                  if (!found) return s;
                  return selectTabInTabset(
                    setFocusedTabset(s, found.tabsetId),
                    found.tabsetId,
                    found.tab
                  );
                });
                return;
              }

              updateWorkbenchPanelLayout(wsId, (s) => addToolToFocusedTabset(s, tool));
            },
          },
        }
      );
    }

    return list;
  });

  // Layout slots
  actions.push(() => {
    const list: CommandAction[] = [];
    const selected = p.selectedMinion;
    if (!selected) {
      return list;
    }

    const config = getLayoutsConfigOrDefault(p.layoutPresets);

    for (const slot of [1, 2, 3, 4, 5, 6, 7, 8, 9] as const) {
      const preset = getPresetForSlot(config, slot);
      const keybind = getEffectiveSlotKeybind(config, slot);
      assert(keybind, `Slot ${slot} must have a default keybind`);
      const shortcutHint = formatKeybind(keybind);

      list.push({
        id: CommandIds.layoutApplySlot(slot),
        title: `Layout: Apply Slot ${slot}`,
        subtitle: preset ? preset.name : "Empty",
        section: section.layouts,
        shortcutHint,
        enabled: () => Boolean(preset) && Boolean(p.onApplyLayoutSlot),
        run: () => {
          if (!preset) return;
          void p.onApplyLayoutSlot?.(selected.minionId, slot);
        },
      });

      if (p.onCaptureLayoutSlot) {
        list.push({
          id: CommandIds.layoutCaptureSlot(slot),
          title: `Layout: Capture current to Slot ${slot}…`,
          subtitle: preset ? preset.name : "Empty",
          section: section.layouts,
          run: () => undefined,
          prompt: {
            title: `Capture Layout Slot ${slot}`,
            fields: [
              {
                type: "text",
                name: "name",
                label: "Name",
                placeholder: `Slot ${slot}`,
                initialValue: preset ? preset.name : `Slot ${slot}`,
                getInitialValue: () => getPresetForSlot(config, slot)?.name ?? `Slot ${slot}`,
                validate: (v) => (!v.trim() ? "Name is required" : null),
              },
            ],
            onSubmit: async (vals) => {
              await p.onCaptureLayoutSlot?.(selected.minionId, slot, vals.name.trim());
            },
          },
        });
      }
    }

    return list;
  });

  // Appearance
  actions.push(() => {
    const list: CommandAction[] = [
      {
        id: CommandIds.themeToggle(),
        title: "Cycle Theme",
        section: section.appearance,
        run: () => p.onToggleTheme(),
      },
    ];

    // Add command for each theme the user isn't currently using
    for (const opt of THEME_OPTIONS) {
      if (p.theme !== opt.value) {
        list.push({
          id: CommandIds.themeSet(opt.value),
          title: `Use ${opt.label} Theme`,
          section: section.appearance,
          run: () => p.onSetTheme(opt.value),
        });
      }
    }

    return list;
  });

  // Chat utilities
  actions.push(() => {
    const list: CommandAction[] = [];
    if (p.selectedMinion) {
      const id = p.selectedMinion.minionId;
      list.push({
        id: CommandIds.chatClear(),
        title: "Clear History",
        section: section.chat,
        run: async () => {
          await p.api?.minion.truncateHistory({ minionId: id, percentage: 1.0 });
        },
      });
      for (const pct of [0.75, 0.5, 0.25]) {
        list.push({
          id: CommandIds.chatTruncate(pct),
          title: `Truncate History to ${Math.round((1 - pct) * 100)}%`,
          section: section.chat,
          run: async () => {
            await p.api?.minion.truncateHistory({ minionId: id, percentage: pct });
          },
        });
      }
      list.push({
        id: CommandIds.chatInterrupt(),
        title: "Interrupt Streaming",
        section: section.chat,
        // Shows the normal-mode shortcut (Esc). Vim mode uses Ctrl+C instead,
        // but vim state isn't available here; Esc is the common-case default.
        shortcutHint: formatKeybind(KEYBINDS.INTERRUPT_STREAM_NORMAL),
        run: async () => {
          if (p.selectedMinionState?.awaitingUserQuestion) {
            return;
          }
          await p.api?.minion.setAutoRetryEnabled?.({ minionId: id, enabled: false });
          await p.api?.minion.interruptStream({ minionId: id });
        },
      });
      list.push({
        id: CommandIds.chatJumpBottom(),
        title: "Jump to Bottom",
        section: section.chat,
        shortcutHint: formatKeybind(KEYBINDS.JUMP_TO_BOTTOM),
        run: () => {
          // Dispatch the keybind; AIView listens for it
          const ev = new KeyboardEvent("keydown", { key: "G", shiftKey: true });
          window.dispatchEvent(ev);
        },
      });
      list.push({
        id: CommandIds.chatVoiceInput(),
        title: "Toggle Voice Input",
        subtitle: "Dictate instead of typing",
        section: section.chat,
        shortcutHint: formatKeybind(KEYBINDS.TOGGLE_VOICE_INPUT),
        run: () => {
          // Dispatch custom event; ChatInput listens for it
          window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.TOGGLE_VOICE_INPUT));
        },
      });
      list.push({
        id: CommandIds.chatClearTimingStats(),
        title: "Clear Timing Stats",
        subtitle: "Reset session timing data for this minion",
        section: section.chat,
        run: () => {
          p.onClearTimingStats?.(id);
        },
      });
    }
    return list;
  });

  // Modes & Model
  actions.push(() => {
    const list: CommandAction[] = [
      {
        id: CommandIds.modeToggle(),
        title: "Open Agent Picker",
        section: section.mode,
        shortcutHint: formatKeybind(KEYBINDS.TOGGLE_AGENT),
        run: () => {
          window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.OPEN_AGENT_PICKER));
        },
      },
      {
        id: "cycle-agent",
        title: "Cycle Agent",
        section: section.mode,
        shortcutHint: formatKeybind(KEYBINDS.CYCLE_AGENT),
        run: () => {
          const ev = new KeyboardEvent("keydown", { key: ".", ctrlKey: true });
          window.dispatchEvent(ev);
        },
      },
      {
        id: CommandIds.modelChange(),
        title: "Change Model…",
        section: section.mode,
        // No shortcutHint: CYCLE_MODEL (⌘/) cycles to next model directly,
        // but this action opens the model selector picker — different behavior.
        run: () => {
          window.dispatchEvent(createCustomEvent(CUSTOM_EVENTS.OPEN_MODEL_SELECTOR));
        },
      },
    ];

    const selectedMinion = p.selectedMinion;
    if (selectedMinion) {
      const { minionId } = selectedMinion;
      const levelDescriptions: Record<ThinkingLevel, string> = {
        off: "Off — fastest responses",
        low: "Low — add a bit of reasoning",
        medium: "Medium — balanced reasoning",
        high: "High — maximum reasoning depth",
        xhigh: "Max — deepest possible reasoning",
        max: "Max — deepest possible reasoning",
      };
      const currentLevel = p.getThinkingLevel(minionId);

      list.push({
        id: CommandIds.thinkingSetLevel(),
        title: "Set Thinking Effort…",
        subtitle: `Current: ${levelDescriptions[currentLevel] ?? currentLevel}`,
        section: section.mode,
        // No shortcutHint: TOGGLE_THINKING (⌘⇧T) cycles to next level directly,
        // but this action opens a level selection prompt — different behavior.
        run: () => undefined,
        prompt: {
          title: "Select Thinking Effort",
          fields: [
            {
              type: "select",
              name: "thinkingLevel",
              label: "Thinking effort",
              placeholder: "Choose effort level…",
              getOptions: () => {
                // Filter thinking levels by the active model's policy
                // so users only see levels valid for the current model
                const modelString = p.selectedMinionState?.currentModel;
                const allowedLevels = modelString
                  ? getThinkingPolicyForModel(modelString)
                  : THINKING_LEVELS;
                return allowedLevels.map((level) => ({
                  id: level,
                  label: levelDescriptions[level],
                  keywords: [
                    level,
                    levelDescriptions[level].toLowerCase(),
                    "thinking",
                    "reasoning",
                  ],
                }));
              },
            },
          ],
          onSubmit: (vals) => {
            const rawLevel = vals.thinkingLevel;
            const level = THINKING_LEVELS.includes(rawLevel as ThinkingLevel)
              ? (rawLevel as ThinkingLevel)
              : "off";
            p.onSetThinkingLevel(minionId, level);
          },
        },
      });
    }

    return list;
  });

  // Help / Docs
  actions.push(() => [
    {
      id: CommandIds.helpKeybinds(),
      title: "Show Keyboard Shortcuts",
      section: section.help,
      run: () => {
        try {
          window.open("https://latticeruntime.com/config/keybinds", "_blank");
        } catch {
          /* ignore */
        }
      },
    },
  ]);

  // Projects
  actions.push(() => {
    const list: CommandAction[] = [
      {
        id: CommandIds.projectAdd(),
        title: "Add Project…",
        section: section.projects,
        run: () => p.onAddProject(),
      },
      {
        id: CommandIds.minionNewInProject(),
        title: "Summon New Minion in Project…",
        section: section.projects,
        run: () => undefined,
        prompt: {
          title: "New Minion in Project",
          fields: [
            {
              type: "select",
              name: "projectPath",
              label: "Select project",
              placeholder: "Search projects…",
              getOptions: (_values) =>
                Array.from(p.projects.keys()).map((projectPath) => ({
                  id: projectPath,
                  label: projectPath.split("/").pop() ?? projectPath,
                  keywords: [projectPath],
                })),
            },
          ],
          onSubmit: (vals) => {
            const projectPath = vals.projectPath;
            // Reuse the chat-based creation flow for the selected project
            p.onStartMinionCreation(projectPath);
          },
        },
      },
      {
        id: CommandIds.minionArchiveMergedInProject(),
        title: "Bench Merged Minions in Project…",
        section: section.projects,
        keywords: ["archive", "merged", "pr", "github", "gh", "cleanup"],
        run: () => undefined,
        prompt: {
          title: "Bench Merged Minions in Project",
          fields: [
            {
              type: "select",
              name: "projectPath",
              label: "Select project",
              placeholder: "Search projects…",
              getOptions: (_values) =>
                Array.from(p.projects.keys()).map((projectPath) => ({
                  id: projectPath,
                  label: projectPath.split("/").pop() ?? projectPath,
                  keywords: [projectPath],
                })),
            },
          ],
          onSubmit: async (vals) => {
            const projectPath = vals.projectPath;
            const projectName = projectPath.split("/").pop() ?? projectPath;

            const ok = await p.confirmDialog({
              title: `Bench merged minions in ${projectName}?`,
              description:
                "This will bench (not delete) minions in this project whose GitHub PR is merged. This is reversible.\n\nThis may start/wake minion runtimes and can take a while.\n\nThis uses GitHub via the gh CLI. Make sure gh is installed and authenticated.",
              confirmLabel: "Archive",
            });
            if (!ok) return;

            await p.onArchiveMergedMinionsInProject(projectPath);
          },
        },
      },
    ];

    for (const [projectPath] of p.projects.entries()) {
      const projectName = projectPath.split("/").pop() ?? projectPath;
      list.push({
        id: CommandIds.projectRemove(projectPath),
        title: `Remove Project ${projectName}…`,
        section: section.projects,
        run: () => p.onRemoveProject(projectPath),
      });
    }
    return list;
  });

  // Analytics maintenance
  actions.push(() => [
    {
      id: CommandIds.analyticsRebuildDatabase(),
      title: "Rebuild Analytics Database",
      subtitle: "Recompute analytics from minion history",
      section: section.settings,
      keywords: ["analytics", "rebuild", "recompute", "database", "stats"],
      run: async () => {
        const rebuildDatabase = getAnalyticsRebuildDatabase(p.api);
        if (!rebuildDatabase) {
          showCommandFeedbackToast({
            type: "error",
            title: "Analytics Unavailable",
            message: "Analytics backend is not available in this build.",
          });
          return;
        }

        try {
          const result = await rebuildDatabase({});
          if (!result.success) {
            showCommandFeedbackToast({
              type: "error",
              title: "Analytics Rebuild Failed",
              message: "Analytics database rebuild did not complete successfully.",
            });
            return;
          }

          const minionLabel = `${result.minionsIngested} minion${
            result.minionsIngested === 1 ? "" : "s"
          }`;
          showCommandFeedbackToast({
            type: "success",
            message: `Analytics database rebuilt successfully (${minionLabel} ingested).`,
          });
        } catch (error) {
          showCommandFeedbackToast({
            type: "error",
            title: "Analytics Rebuild Failed",
            message: getErrorMessage(error),
          });
        }
      },
    },
  ]);

  // Settings
  if (p.onOpenSettings) {
    const openSettings = p.onOpenSettings;
    actions.push(() => [
      {
        id: CommandIds.settingsOpen(),
        title: "Open Settings",
        section: section.settings,
        keywords: ["preferences", "config", "configuration"],
        shortcutHint: formatKeybind(KEYBINDS.OPEN_SETTINGS),
        run: () => openSettings(),
      },
      {
        id: CommandIds.settingsOpenSection("providers"),
        title: "Settings: Providers",
        subtitle: "Configure API keys and endpoints",
        section: section.settings,
        keywords: ["api", "key", "anthropic", "openai", "google"],
        run: () => openSettings("providers"),
      },
      {
        id: CommandIds.settingsOpenSection("models"),
        title: "Settings: Models",
        subtitle: "Manage custom models",
        section: section.settings,
        keywords: ["model", "custom", "add"],
        run: () => openSettings("models"),
      },
    ]);
  }

  return actions;
}
