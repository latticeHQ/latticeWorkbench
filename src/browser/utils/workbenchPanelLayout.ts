import { isTabType, isTerminalTab, type TabType } from "@/browser/types/workbenchPanel";

export type WorkbenchPanelLayoutNode =
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      sizes: [number, number];
      children: [WorkbenchPanelLayoutNode, WorkbenchPanelLayoutNode];
    }
  | {
      type: "tabset";
      id: string;
      tabs: TabType[];
      activeTab: TabType;
    };

function isLayoutNode(value: unknown): value is WorkbenchPanelLayoutNode {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (v.type === "tabset") {
    return (
      typeof v.id === "string" &&
      Array.isArray(v.tabs) &&
      v.tabs.every((t) => isTabType(t)) &&
      isTabType(v.activeTab)
    );
  }

  if (v.type === "split") {
    if (typeof v.id !== "string") return false;
    if (v.direction !== "horizontal" && v.direction !== "vertical") return false;
    if (!Array.isArray(v.sizes) || v.sizes.length !== 2) return false;
    if (typeof v.sizes[0] !== "number" || typeof v.sizes[1] !== "number") return false;
    if (!Array.isArray(v.children) || v.children.length !== 2) return false;
    return isLayoutNode(v.children[0]) && isLayoutNode(v.children[1]);
  }

  return false;
}

export function isWorkbenchPanelLayoutState(value: unknown): value is WorkbenchPanelLayoutState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1) return false;
  if (typeof v.nextId !== "number") return false;
  if (typeof v.focusedTabsetId !== "string") return false;
  if (!isLayoutNode(v.root)) return false;
  return findTabset(v.root, v.focusedTabsetId) !== null;
}
export interface WorkbenchPanelLayoutState {
  version: 1;
  nextId: number;
  focusedTabsetId: string;
  root: WorkbenchPanelLayoutNode;
}

export function getDefaultWorkbenchPanelLayoutState(activeTab: TabType): WorkbenchPanelLayoutState {
  // Default: two-crew split — terminal on top, info tabs on bottom.
  // The bare "terminal" placeholder is promoted to a real "terminal:<sessionId>"
  // by WorkbenchPanel's promoteBareTerminalPlaceholders effect on mount.
  const bottomTabs: TabType[] = ["stats", "costs", "explorer", "review", "kanban", "issues", "inference", "schedules", "sync"];

  return {
    version: 1,
    nextId: 4,
    focusedTabsetId: "tabset-2",
    root: {
      type: "split",
      id: "split-1",
      direction: "horizontal",
      sizes: [50, 50],
      children: [
        {
          type: "tabset",
          id: "tabset-1",
          tabs: ["terminal"],
          activeTab: "terminal",
        },
        {
          type: "tabset",
          id: "tabset-2",
          tabs: bottomTabs.includes(activeTab) ? bottomTabs : [...bottomTabs, activeTab],
          activeTab: bottomTabs.includes(activeTab) ? activeTab : "costs",
        },
      ],
    },
  };
}

/**
 * Recursively inject a tab into the first tabset that doesn't have it.
 * Returns true if injection happened.
 */
function injectTabIntoLayout(node: WorkbenchPanelLayoutNode, tab: TabType): boolean {
  if (node.type === "tabset") {
    if (!node.tabs.includes(tab)) {
      node.tabs.push(tab);
      return true;
    }
    return false;
  }
  // Split node - try first child, then second
  return injectTabIntoLayout(node.children[0], tab) || injectTabIntoLayout(node.children[1], tab);
}

/**
 * Check if a tab exists anywhere in the layout tree.
 */
function layoutContainsTab(node: WorkbenchPanelLayoutNode, tab: TabType): boolean {
  if (node.type === "tabset") {
    return node.tabs.includes(tab);
  }
  return layoutContainsTab(node.children[0], tab) || layoutContainsTab(node.children[1], tab);
}

export function parseWorkbenchPanelLayoutState(
  raw: unknown,
  activeTabFallback: TabType
): WorkbenchPanelLayoutState {
  if (isWorkbenchPanelLayoutState(raw)) {
    // Migrate: inject missing tabs into persisted layout
    if (!layoutContainsTab(raw.root, "explorer")) {
      injectTabIntoLayout(raw.root, "explorer");
    }
    if (!layoutContainsTab(raw.root, "kanban")) {
      injectTabIntoLayout(raw.root, "kanban");
    }
    if (!layoutContainsTab(raw.root, "issues")) {
      injectTabIntoLayout(raw.root, "issues");
    }
    if (!layoutContainsTab(raw.root, "inference")) {
      injectTabIntoLayout(raw.root, "inference");
    }
    if (!layoutContainsTab(raw.root, "schedules")) {
      injectTabIntoLayout(raw.root, "schedules");
    }
    if (!layoutContainsTab(raw.root, "sync")) {
      injectTabIntoLayout(raw.root, "sync");
    }

    // Self-heal: if the split collapsed to a single tabset (e.g. all terminal
    // tabs were removed on a previous reload), restore the two-pane split
    // while preserving existing tabs. Terminal tabs go to the top pane,
    // info tabs go to the bottom, and a bare "terminal" placeholder is
    // injected if the top pane would otherwise be empty.
    if (raw.root.type === "tabset") {
      const allTabs = raw.root.tabs;
      const terminalTabs = allTabs.filter((t) => isTerminalTab(t));
      const infoTabs = allTabs.filter((t) => !isTerminalTab(t));

      // Ensure both panes have content
      const topTabs: TabType[] =
        terminalTabs.length > 0 ? terminalTabs : ["terminal"];
      const defaultBottomTabs: TabType[] = ["stats", "costs", "explorer", "review", "kanban", "issues", "inference", "schedules"];
      const bottomTabs: TabType[] =
        infoTabs.length > 0 ? infoTabs : defaultBottomTabs;

      return {
        ...raw,
        nextId: Math.max(raw.nextId, 4),
        focusedTabsetId: "tabset-2",
        root: {
          type: "split",
          id: "split-1",
          direction: "horizontal" as const,
          sizes: [50, 50] as [number, number],
          children: [
            {
              type: "tabset" as const,
              id: "tabset-1",
              tabs: topTabs,
              activeTab: topTabs[0],
            },
            {
              type: "tabset" as const,
              id: "tabset-2",
              tabs: bottomTabs,
              activeTab: bottomTabs.includes(activeTabFallback) ? activeTabFallback : bottomTabs[0],
            },
          ],
        },
      };
    }

    return raw;
  }

  return getDefaultWorkbenchPanelLayoutState(activeTabFallback);
}

export function findTabset(
  root: WorkbenchPanelLayoutNode,
  tabsetId: string
): WorkbenchPanelLayoutNode | null {
  if (root.type === "tabset") {
    return root.id === tabsetId ? root : null;
  }
  return findTabset(root.children[0], tabsetId) ?? findTabset(root.children[1], tabsetId);
}

export function findFirstTabsetId(root: WorkbenchPanelLayoutNode): string | null {
  if (root.type === "tabset") return root.id;
  return findFirstTabsetId(root.children[0]) ?? findFirstTabsetId(root.children[1]);
}

function allocId(state: WorkbenchPanelLayoutState, prefix: "tabset" | "split") {
  const id = `${prefix}-${state.nextId}`;
  return { id, nextId: state.nextId + 1 };
}

function removeTabFromNode(
  node: WorkbenchPanelLayoutNode,
  tab: TabType
): WorkbenchPanelLayoutNode | null {
  if (node.type === "tabset") {
    const oldIndex = node.tabs.indexOf(tab);
    const tabs = node.tabs.filter((t) => t !== tab);
    if (tabs.length === 0) return null;

    // When removing the active tab, focus next tab (or previous if no next)
    let activeTab = node.activeTab;
    if (node.activeTab === tab) {
      // Prefer next tab, fall back to previous
      activeTab = tabs[Math.min(oldIndex, tabs.length - 1)];
    }
    return {
      ...node,
      tabs,
      activeTab: tabs.includes(activeTab) ? activeTab : tabs[0],
    };
  }

  const left = removeTabFromNode(node.children[0], tab);
  const right = removeTabFromNode(node.children[1], tab);

  if (!left && !right) {
    return null;
  }

  // If one side goes empty, promote the other side to avoid empty panes.
  if (!left) return right;
  if (!right) return left;

  return {
    ...node,
    children: [left, right],
  };
}

export function removeTabEverywhere(
  state: WorkbenchPanelLayoutState,
  tab: TabType
): WorkbenchPanelLayoutState {
  const nextRoot = removeTabFromNode(state.root, tab);
  if (!nextRoot) {
    return getDefaultWorkbenchPanelLayoutState("costs");
  }

  const focusedExists = findTabset(nextRoot, state.focusedTabsetId) !== null;
  const focusedTabsetId = focusedExists
    ? state.focusedTabsetId
    : (findFirstTabsetId(nextRoot) ?? "tabset-1");

  return {
    ...state,
    root: nextRoot,
    focusedTabsetId,
  };
}
function updateNode(
  node: WorkbenchPanelLayoutNode,
  tabsetId: string,
  updater: (tabset: Extract<WorkbenchPanelLayoutNode, { type: "tabset" }>) => WorkbenchPanelLayoutNode
): WorkbenchPanelLayoutNode {
  if (node.type === "tabset") {
    if (node.id !== tabsetId) return node;
    return updater(node);
  }

  return {
    ...node,
    children: [
      updateNode(node.children[0], tabsetId, updater),
      updateNode(node.children[1], tabsetId, updater),
    ],
  };
}

export function setFocusedTabset(
  state: WorkbenchPanelLayoutState,
  tabsetId: string
): WorkbenchPanelLayoutState {
  if (state.focusedTabsetId === tabsetId) return state;
  return { ...state, focusedTabsetId: tabsetId };
}

export function selectTabInTabset(
  state: WorkbenchPanelLayoutState,
  tabsetId: string,
  tab: TabType
): WorkbenchPanelLayoutState {
  const target = findTabset(state.root, tabsetId);
  if (target?.type !== "tabset") {
    return state;
  }

  if (target.activeTab === tab && target.tabs.includes(tab)) {
    return state;
  }

  return {
    ...state,
    root: updateNode(state.root, tabsetId, (ts) => {
      const tabs = ts.tabs.includes(tab) ? ts.tabs : [...ts.tabs, tab];
      return { ...ts, tabs, activeTab: tab };
    }),
  };
}

export function reorderTabInTabset(
  state: WorkbenchPanelLayoutState,
  tabsetId: string,
  fromIndex: number,
  toIndex: number
): WorkbenchPanelLayoutState {
  const tabset = findTabset(state.root, tabsetId);
  if (tabset?.type !== "tabset") {
    return state;
  }

  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= tabset.tabs.length ||
    toIndex >= tabset.tabs.length
  ) {
    return state;
  }

  return {
    ...state,
    root: updateNode(state.root, tabsetId, (node) => {
      const nextTabs = [...node.tabs];
      const [moved] = nextTabs.splice(fromIndex, 1);
      if (!moved) {
        return node;
      }

      nextTabs.splice(toIndex, 0, moved);
      return {
        ...node,
        tabs: nextTabs,
      };
    }),
  };
}

export function selectTabInFocusedTabset(
  state: WorkbenchPanelLayoutState,
  tab: TabType
): WorkbenchPanelLayoutState {
  const focused = findTabset(state.root, state.focusedTabsetId);
  if (focused?.type !== "tabset") {
    return state;
  }

  if (focused.activeTab === tab && focused.tabs.includes(tab)) {
    return state;
  }

  return {
    ...state,
    root: updateNode(state.root, focused.id, (ts) => {
      const tabs = ts.tabs.includes(tab) ? ts.tabs : [...ts.tabs, tab];
      return { ...ts, tabs, activeTab: tab };
    }),
  };
}

export function splitFocusedTabset(
  state: WorkbenchPanelLayoutState,
  direction: "horizontal" | "vertical"
): WorkbenchPanelLayoutState {
  const focused = findTabset(state.root, state.focusedTabsetId);
  if (focused?.type !== "tabset") {
    return state;
  }

  const splitAlloc = allocId(state, "split");
  const tabsetAlloc = allocId({ ...state, nextId: splitAlloc.nextId }, "tabset");

  const fallbackTab: TabType =
    focused.activeTab === "terminal"
      ? "costs"
      : focused.activeTab === "costs"
        ? "terminal"
        : "terminal";

  let left: Extract<WorkbenchPanelLayoutNode, { type: "tabset" }> = focused;
  let right: Extract<WorkbenchPanelLayoutNode, { type: "tabset" }>;
  const newFocusedId = tabsetAlloc.id;

  if (focused.tabs.length > 1) {
    const moved = focused.activeTab;
    const remaining = focused.tabs.filter((t) => t !== moved);
    const oldActive = remaining[0] ?? "costs";

    left = {
      ...focused,
      tabs: remaining,
      activeTab: oldActive,
    };

    right = {
      type: "tabset",
      id: tabsetAlloc.id,
      tabs: [moved],
      activeTab: moved,
    };
  } else {
    // Avoid empty tabsets: keep the current tabset intact and spawn a useful default neighbor.
    right = {
      type: "tabset",
      id: tabsetAlloc.id,
      tabs: [fallbackTab],
      activeTab: fallbackTab,
    };
  }

  const splitNode: WorkbenchPanelLayoutNode = {
    type: "split",
    id: splitAlloc.id,
    direction,
    sizes: [50, 50],
    children: [left, right],
  };

  // Replace the focused tabset node in-place.
  const replaceFocused = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode => {
    if (node.type === "tabset") {
      return node.id === focused.id ? splitNode : node;
    }

    return {
      ...node,
      children: [replaceFocused(node.children[0]), replaceFocused(node.children[1])],
    };
  };

  return {
    ...state,
    nextId: tabsetAlloc.nextId,
    focusedTabsetId: newFocusedId,
    root: replaceFocused(state.root),
  };
}

export function updateSplitSizes(
  state: WorkbenchPanelLayoutState,
  splitId: string,
  sizes: [number, number]
): WorkbenchPanelLayoutState {
  const update = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode => {
    if (node.type === "split") {
      if (node.id === splitId) {
        return { ...node, sizes };
      }
      return {
        ...node,
        children: [update(node.children[0]), update(node.children[1])],
      };
    }
    return node;
  };

  return {
    ...state,
    root: update(state.root),
  };
}

/**
 * Replace every occurrence of `oldTab` with `newTab` throughout the layout tree.
 * Used to promote bare "terminal" placeholders to real "terminal:<sessionId>" tabs.
 */
export function replaceTabInLayout(
  state: WorkbenchPanelLayoutState,
  oldTab: TabType,
  newTab: TabType
): WorkbenchPanelLayoutState {
  const replaceInNode = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode => {
    if (node.type === "tabset") {
      const hasOld = node.tabs.includes(oldTab);
      if (!hasOld) return node;

      return {
        ...node,
        tabs: node.tabs.map((t) => (t === oldTab ? newTab : t)),
        activeTab: node.activeTab === oldTab ? newTab : node.activeTab,
      };
    }

    return {
      ...node,
      children: [replaceInNode(node.children[0]), replaceInNode(node.children[1])],
    };
  };

  return {
    ...state,
    root: replaceInNode(state.root),
  };
}

export function collectAllTabs(node: WorkbenchPanelLayoutNode): TabType[] {
  if (node.type === "tabset") return [...node.tabs];
  return [...collectAllTabs(node.children[0]), ...collectAllTabs(node.children[1])];
}
export function collectActiveTabs(node: WorkbenchPanelLayoutNode): TabType[] {
  if (node.type === "tabset") return [node.activeTab];
  return [...collectActiveTabs(node.children[0]), ...collectActiveTabs(node.children[1])];
}

export function hasTab(state: WorkbenchPanelLayoutState, tab: TabType): boolean {
  return collectAllTabs(state.root).includes(tab);
}

export function toggleTab(state: WorkbenchPanelLayoutState, tab: TabType): WorkbenchPanelLayoutState {
  return hasTab(state, tab) ? removeTabEverywhere(state, tab) : selectOrAddTab(state, tab);
}

/**
 * Collect all tabs from all tabsets with their tabset IDs.
 * Returns tabs in layout order (depth-first, left-to-right/top-to-bottom).
 */
export function collectAllTabsWithTabset(
  node: WorkbenchPanelLayoutNode
): Array<{ tab: TabType; tabsetId: string }> {
  if (node.type === "tabset") {
    return node.tabs.map((tab) => ({ tab, tabsetId: node.id }));
  }
  return [
    ...collectAllTabsWithTabset(node.children[0]),
    ...collectAllTabsWithTabset(node.children[1]),
  ];
}

/**
 * Select a tab by its position in the layout (0-indexed).
 * Returns the updated state, or the original state if index is out of bounds.
 */
export function selectTabByIndex(
  state: WorkbenchPanelLayoutState,
  index: number
): WorkbenchPanelLayoutState {
  const allTabs = collectAllTabsWithTabset(state.root);
  if (index < 0 || index >= allTabs.length) {
    return state;
  }
  const { tab, tabsetId } = allTabs[index];
  return selectTabInTabset(setFocusedTabset(state, tabsetId), tabsetId, tab);
}

export function getFocusedActiveTab(state: WorkbenchPanelLayoutState, fallback: TabType): TabType {
  const focused = findTabset(state.root, state.focusedTabsetId);
  if (focused?.type === "tabset") return focused.activeTab;
  return fallback;
}
export function addToolToFocusedTabset(
  state: WorkbenchPanelLayoutState,
  tab: TabType
): WorkbenchPanelLayoutState {
  return selectTabInFocusedTabset(state, tab);
}

/**
 * Add a tab to the focused tabset without changing the active tab.
 * Used for feature-flagged tabs that should be available but not auto-selected.
 */
export function addTabToFocusedTabset(
  state: WorkbenchPanelLayoutState,
  tab: TabType,
  /** Whether to make the new tab active (default: true) */
  activate = true
): WorkbenchPanelLayoutState {
  const focused = findTabset(state.root, state.focusedTabsetId);
  if (focused?.type !== "tabset") {
    return state;
  }

  // Already has the tab - just activate if requested
  if (focused.tabs.includes(tab)) {
    if (activate && focused.activeTab !== tab) {
      return {
        ...state,
        root: updateNode(state.root, focused.id, (ts) => ({
          ...ts,
          activeTab: tab,
        })),
      };
    }
    return state;
  }

  return {
    ...state,
    root: updateNode(state.root, focused.id, (ts) => ({
      ...ts,
      tabs: [...ts.tabs, tab],
      activeTab: activate ? tab : ts.activeTab,
    })),
  };
}

/**
 * Find the first tabset that already contains a terminal tab.
 * Used to place new terminals alongside existing ones rather than in the focused tabset.
 */
function findTerminalTabset(node: WorkbenchPanelLayoutNode): string | null {
  if (node.type === "tabset") {
    return node.tabs.some(isTerminalTab) ? node.id : null;
  }
  return findTerminalTabset(node.children[0]) ?? findTerminalTabset(node.children[1]);
}

/**
 * Add a terminal tab to the tabset that already contains terminals.
 * Falls back to the focused tabset if no terminal tabset exists.
 *
 * This ensures MCP-created terminals and session-sync terminals
 * always land in the terminal panel (tabset-1 by default), not the
 * bottom info panel (stats/costs/explorer/review).
 */
export function addTabToTerminalTabset(
  state: WorkbenchPanelLayoutState,
  tab: TabType,
  /** Whether to make the new tab active (default: true) */
  activate = true
): WorkbenchPanelLayoutState {
  const terminalTabsetId = findTerminalTabset(state.root);
  if (terminalTabsetId) {
    return selectTabInTabset(
      activate ? setFocusedTabset(state, terminalTabsetId) : state,
      terminalTabsetId,
      tab
    );
  }
  // No existing terminal tabset — fall back to focused tabset
  return addTabToFocusedTabset(state, tab, activate);
}

/**
 * Select an existing tab anywhere in the layout, or add it to the focused tabset if missing.
 */
export function selectOrAddTab(
  state: WorkbenchPanelLayoutState,
  tab: TabType
): WorkbenchPanelLayoutState {
  const found = collectAllTabsWithTabset(state.root).find((t) => t.tab === tab);
  if (found) {
    return selectTabInTabset(setFocusedTabset(state, found.tabsetId), found.tabsetId, found.tab);
  }

  return addTabToFocusedTabset(state, tab);
}

/**
 * Move a tab from one tabset to another.
 * Handles edge cases:
 * - If source tabset becomes empty, it gets removed (along with its parent split if needed)
 * - If target tabset already has the tab, just activates it
 *
 * @returns Updated layout state, or original state if move is invalid
 */
export function moveTabToTabset(
  state: WorkbenchPanelLayoutState,
  tab: TabType,
  sourceTabsetId: string,
  targetTabsetId: string
): WorkbenchPanelLayoutState {
  // No-op if moving to same tabset
  if (sourceTabsetId === targetTabsetId) {
    return selectTabInTabset(state, targetTabsetId, tab);
  }

  const source = findTabset(state.root, sourceTabsetId);
  const target = findTabset(state.root, targetTabsetId);

  if (source?.type !== "tabset" || target?.type !== "tabset") {
    return state;
  }

  // Check if tab exists in source
  if (!source.tabs.includes(tab)) {
    return state;
  }

  // Update the tree: remove from source, add to target
  const updateNode = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode | null => {
    if (node.type === "tabset") {
      if (node.id === sourceTabsetId) {
        // Remove tab from source
        const newTabs = node.tabs.filter((t) => t !== tab);
        if (newTabs.length === 0) {
          // Tabset is now empty, signal for removal
          return null;
        }
        const newActiveTab = node.activeTab === tab ? newTabs[0] : node.activeTab;
        return { ...node, tabs: newTabs, activeTab: newActiveTab };
      }
      if (node.id === targetTabsetId) {
        // Add tab to target (avoid duplicates)
        const newTabs = target.tabs.includes(tab) ? target.tabs : [...target.tabs, tab];
        return { ...node, tabs: newTabs, activeTab: tab };
      }
      return node;
    }

    // Split node: recursively update children
    const left = updateNode(node.children[0]);
    const right = updateNode(node.children[1]);

    // Handle case where one child was removed (became null)
    if (left === null && right === null) {
      // Both children empty (shouldn't happen with valid moves)
      return null;
    }
    if (left === null) {
      // Left child removed, promote right
      return right;
    }
    if (right === null) {
      // Right child removed, promote left
      return left;
    }

    return {
      ...node,
      children: [left, right],
    };
  };

  const newRoot = updateNode(state.root);
  if (newRoot === null) {
    // Entire tree collapsed (shouldn't happen)
    return state;
  }

  // Ensure focusedTabsetId is still valid
  let newFocusedId: string = targetTabsetId;
  if (findTabset(newRoot, newFocusedId) === null) {
    newFocusedId = findFirstTabsetId(newRoot) ?? targetTabsetId;
  }

  return {
    ...state,
    focusedTabsetId: newFocusedId,
    root: newRoot,
  };
}

export type TabDockEdge = "left" | "right" | "top" | "bottom";

function getFallbackTabForEmptyTabset(movedTab: TabType): TabType {
  return movedTab === "terminal" ? "costs" : movedTab === "costs" ? "terminal" : "terminal";
}

/**
 * Create a new split adjacent to a target tabset and dock a dragged tab into it.
 *
 * This is the "edge drop" behavior for drag+dock:
 * - drop Left/Right => vertical split
 * - drop Top/Bottom => horizontal split
 *
 * Also handles:
 * - dragging a tab out of its own tabset (source === target)
 * - removing empty source tabsets (collapsing parent splits)
 * - avoiding empty tabsets when a user drags out the last remaining tab
 */
export function dockTabToEdge(
  state: WorkbenchPanelLayoutState,
  tab: TabType,
  sourceTabsetId: string,
  targetTabsetId: string,
  edge: TabDockEdge
): WorkbenchPanelLayoutState {
  const source = findTabset(state.root, sourceTabsetId);
  const target = findTabset(state.root, targetTabsetId);

  if (source?.type !== "tabset" || target?.type !== "tabset") {
    return state;
  }

  if (!source.tabs.includes(tab)) {
    return state;
  }

  const splitDirection: "horizontal" | "vertical" =
    edge === "top" || edge === "bottom" ? "horizontal" : "vertical";
  const insertBefore = edge === "top" || edge === "left";

  const splitAlloc = allocId(state, "split");
  const tabsetAlloc = allocId({ ...state, nextId: splitAlloc.nextId }, "tabset");

  const newTabset: Extract<WorkbenchPanelLayoutNode, { type: "tabset" }> = {
    type: "tabset",
    id: tabsetAlloc.id,
    tabs: [tab],
    activeTab: tab,
  };

  const updateNode = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode | null => {
    if (node.type === "tabset") {
      if (node.id === targetTabsetId) {
        let updatedTarget = node;

        // When dragging out of this tabset, remove the tab before splitting.
        if (sourceTabsetId === targetTabsetId) {
          const remaining = node.tabs.filter((t) => t !== tab);
          const fallbackTab = getFallbackTabForEmptyTabset(tab);
          const nextTabs = remaining.length > 0 ? remaining : [fallbackTab];
          const nextActiveTab =
            node.activeTab === tab || !nextTabs.includes(node.activeTab)
              ? nextTabs[0]
              : node.activeTab;
          updatedTarget = { ...node, tabs: nextTabs, activeTab: nextActiveTab };
        }

        const children: [WorkbenchPanelLayoutNode, WorkbenchPanelLayoutNode] = insertBefore
          ? [newTabset, updatedTarget]
          : [updatedTarget, newTabset];

        return {
          type: "split",
          id: splitAlloc.id,
          direction: splitDirection,
          sizes: [50, 50],
          children,
        };
      }

      if (node.id === sourceTabsetId) {
        // Remove from source (unless source === target, handled above).
        if (sourceTabsetId === targetTabsetId) {
          return node;
        }

        const remaining = node.tabs.filter((t) => t !== tab);
        if (remaining.length === 0) {
          return null;
        }

        const nextActiveTab = node.activeTab === tab ? remaining[0] : node.activeTab;
        return { ...node, tabs: remaining, activeTab: nextActiveTab };
      }

      return node;
    }

    const left = updateNode(node.children[0]);
    const right = updateNode(node.children[1]);

    if (left === null && right === null) {
      return null;
    }
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }

    return {
      ...node,
      children: [left, right],
    };
  };

  const newRoot = updateNode(state.root);
  if (newRoot === null) {
    return state;
  }

  const newFocusedId = tabsetAlloc.id;

  return {
    ...state,
    nextId: tabsetAlloc.nextId,
    focusedTabsetId: findTabset(newRoot, newFocusedId) ? newFocusedId : state.focusedTabsetId,
    root: newRoot,
  };
}

/**
 * Close (remove) a split, keeping one of its children.
 * Called when user wants to close a pane.
 *
 * @param keepChildIndex Which child to keep (0 = first/left/top, 1 = second/right/bottom)
 */
export function closeSplit(
  state: WorkbenchPanelLayoutState,
  splitId: string,
  keepChildIndex: 0 | 1
): WorkbenchPanelLayoutState {
  const replaceNode = (node: WorkbenchPanelLayoutNode): WorkbenchPanelLayoutNode => {
    if (node.type === "tabset") {
      return node;
    }

    if (node.id === splitId) {
      // Replace this split with the kept child
      return node.children[keepChildIndex];
    }

    return {
      ...node,
      children: [replaceNode(node.children[0]), replaceNode(node.children[1])],
    };
  };

  const newRoot = replaceNode(state.root);

  // Ensure focusedTabsetId is still valid
  let newFocusedId: string = state.focusedTabsetId;
  if (findTabset(newRoot, newFocusedId) === null) {
    newFocusedId = findFirstTabsetId(newRoot) ?? state.focusedTabsetId;
  }

  return {
    ...state,
    focusedTabsetId: newFocusedId,
    root: newRoot,
  };
}
