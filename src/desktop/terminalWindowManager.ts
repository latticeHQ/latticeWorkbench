/**
 * Terminal Window Manager
 *
 * Manages pop-out terminal windows for minions.
 * Each minion can have multiple terminal windows open simultaneously.
 */

import { app, BrowserWindow } from "electron";
import * as path from "path";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";

export class TerminalWindowManager {
  private windows = new Map<string, Set<BrowserWindow>>(); // minionId -> Set of windows
  private windowCount = 0; // Counter for unique window IDs
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Open a new terminal window for a minion
   * Multiple windows can be open for the same minion
   * @param sessionId Optional session ID to reattach to (for pop-out handoff from embedded terminal)
   */
  async openTerminalWindow(minionId: string, sessionId?: string): Promise<void> {
    this.windowCount++;
    const windowId = this.windowCount;

    // Look up minion metadata to get project and branch names
    const allMinions = await this.config.getAllMinionMetadata();
    const minion = allMinions.find((ws) => ws.id === minionId);

    let title: string;
    if (minion) {
      title = `Terminal ${windowId} — ${minion.projectName} (${minion.name})`;
    } else {
      // Fallback if minion not found
      title = `Terminal ${windowId} — ${minionId}`;
    }

    const terminalWindow = new BrowserWindow({
      width: 1000,
      height: 600,
      title,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // __dirname is dist/services/ but preload.js is in dist/
        preload: path.join(__dirname, "../preload.js"),
      },
      backgroundColor: "#1e1e1e",
    });

    // Track the window
    if (!this.windows.has(minionId)) {
      this.windows.set(minionId, new Set());
    }
    this.windows.get(minionId)!.add(terminalWindow);

    // Clean up when window is closed
    terminalWindow.on("closed", () => {
      const windowSet = this.windows.get(minionId);
      if (windowSet) {
        windowSet.delete(terminalWindow);
        if (windowSet.size === 0) {
          this.windows.delete(minionId);
        }
      }
      log.info(`Terminal window ${windowId} closed for minion: ${minionId}`);
    });

    // Load the terminal page
    // Match main window logic: use dev server unless packaged or LATTICE_E2E_LOAD_DIST=1
    const forceDistLoad = process.env.LATTICE_E2E_LOAD_DIST === "1";
    const useDevServer = !app.isPackaged && !forceDistLoad;

    // Build query params including optional sessionId for session handoff
    const queryParams: Record<string, string> = { minionId };
    if (sessionId) {
      queryParams.sessionId = sessionId;
    }

    if (useDevServer) {
      // Development mode - load from Vite dev server
      const params = new URLSearchParams(queryParams);
      await terminalWindow.loadURL(`http://localhost:5173/terminal.html?${params.toString()}`);
      terminalWindow.webContents.openDevTools();
    } else {
      // Production mode (or E2E dist mode) - load from built files
      await terminalWindow.loadFile(path.join(__dirname, "../terminal.html"), {
        query: queryParams,
      });
    }

    log.info(`Terminal window ${windowId} opened for minion: ${minionId}`);
  }

  /**
   * Close all terminal windows for a minion
   */
  closeTerminalWindow(minionId: string): void {
    const windowSet = this.windows.get(minionId);
    if (windowSet) {
      for (const window of windowSet) {
        if (!window.isDestroyed()) {
          window.close();
        }
      }
      this.windows.delete(minionId);
    }
  }

  /**
   * Close all terminal windows for all minions
   */
  closeAll(): void {
    for (const [minionId, windowSet] of this.windows.entries()) {
      for (const window of windowSet) {
        if (!window.isDestroyed()) {
          window.close();
        }
      }
      this.windows.delete(minionId);
    }
  }

  /**
   * Get all windows for a minion
   */
  getWindows(minionId: string): BrowserWindow[] {
    const windowSet = this.windows.get(minionId);
    if (!windowSet) return [];
    return Array.from(windowSet).filter((w) => !w.isDestroyed());
  }

  /**
   * Get count of open terminal windows for a minion
   */
  getWindowCount(minionId: string): number {
    return this.getWindows(minionId).length;
  }
}
