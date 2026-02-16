export const RIGHT_SIDEBAR_TABS = [
  "chat",       // PM Chat tab (main area only)
  "costs",
  "review",
  "explorer",
  "cluster",
  "models",
  "stats",
  "browser",
] as const;

/** Base tab types that are always valid */
export type BaseTabType = (typeof RIGHT_SIDEBAR_TABS)[number];

/**
 * Extended tab type that supports multiple terminal and file instances.
 * - Terminal tabs: "terminal:<sessionId>" for real sessions (used in MainArea)
 * - File tabs: "file:<relativePath>" for file viewer panes
 */
export type TabType = BaseTabType | `terminal:${string}` | `file:${string}`;

/** Check if a value is a valid tab type (base tab, terminal instance, or file tab) */
export function isTabType(value: unknown): value is TabType {
  if (typeof value !== "string") return false;
  if ((RIGHT_SIDEBAR_TABS as readonly string[]).includes(value)) return true;
  // Support terminal instances like "terminal:ws-123-1704567890"
  if (value.startsWith("terminal:")) return true;
  // Support file tabs like "file:src/App.tsx"
  return value.startsWith("file:");
}

/** Check if a tab type represents the PM Chat tab */
export function isChatTab(tab: TabType): boolean {
  return tab === "chat";
}

/** Check if a tab type represents a file viewer tab */
export function isFileTab(tab: TabType): boolean {
  return tab.startsWith("file:");
}

/** Get the relative file path from a file tab type */
export function getFilePath(tab: TabType): string | undefined {
  if (tab.startsWith("file:")) return tab.slice("file:".length);
  return undefined;
}

/** Create a file tab type for a given relative path */
export function makeFileTabType(relativePath: string): TabType {
  return `file:${relativePath}`;
}

/** Check if a tab type represents a terminal session tab ("terminal:<sessionId>") */
export function isTerminalTab(tab: TabType): boolean {
  return tab.startsWith("terminal:");
}

/**
 * Get the backend session ID from a terminal tab type.
 */
export function getTerminalSessionId(tab: TabType): string | undefined {
  if (tab.startsWith("terminal:")) return tab.slice("terminal:".length);
  return undefined;
}

/** Create a terminal tab type for a given session ID */
export function makeTerminalTabType(sessionId: string): TabType {
  return `terminal:${sessionId}`;
}
