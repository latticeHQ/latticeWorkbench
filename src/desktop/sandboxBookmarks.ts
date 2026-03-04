/**
 * SandboxBookmarkService — Persistent filesystem access for MAS sandbox builds.
 *
 * Apple's App Sandbox restricts filesystem access. When the user picks a directory
 * via `dialog.showOpenDialog({ securityScopedBookmarks: true })`, Electron returns
 * a security-scoped bookmark (opaque Base64 string). On subsequent launches, calling
 * `app.startAccessingSecurityScopedResource(bookmark)` restores access without
 * re-prompting the user.
 *
 * Bookmarks are persisted to `~/.lattice/bookmarks.json` (inside the sandbox
 * container, which is always writable).
 *
 * This service is a no-op when `process.mas` is false (GitHub/Homebrew builds).
 */

import { app, dialog, type BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import { getRealHome } from "../common/utils/masHome";

interface BookmarkEntry {
  /** Absolute path that was bookmarked */
  path: string;
  /** Base64-encoded security-scoped bookmark data */
  bookmark: string;
  /** Whether this is the home directory bookmark */
  isHome: boolean;
  /** ISO timestamp when the bookmark was created */
  createdAt: string;
}

interface BookmarksFile {
  version: 1;
  entries: BookmarkEntry[];
}

export class SandboxBookmarkService {
  private bookmarksPath: string;
  private entries: BookmarkEntry[] = [];
  /** Cleanup functions returned by app.startAccessingSecurityScopedResource() */
  private stopFns: Array<() => void> = [];
  private readonly isMAS: boolean;

  constructor() {
    // process.mas is true only for Mac App Store builds
    this.isMAS = !!(process as NodeJS.Process & { mas?: boolean }).mas;

    // Bookmarks file lives inside the sandbox container (always writable).
    // Use app.getPath("userData") which maps to ~/Library/Application Support/<appName>/
    // inside the container for MAS builds.
    const latticeHome = path.join(
      process.env.HOME ?? require("os").homedir(),
      ".lattice"
    );
    this.bookmarksPath = path.join(latticeHome, "bookmarks.json");
  }

  /**
   * Restore all previously saved bookmarks on startup.
   * Call this early in loadServices(), BEFORE services.initialize().
   *
   * Returns true if the home directory bookmark was successfully restored.
   */
  restoreAll(): boolean {
    if (!this.isMAS) return true; // Non-MAS: full access, pretend home is accessible

    this.entries = this.loadFromDisk();
    let homeRestored = false;

    for (const entry of this.entries) {
      try {
        const stopFn = app.startAccessingSecurityScopedResource(entry.bookmark) as unknown as () => void;
        this.stopFns.push(stopFn);
        console.log(`[sandbox-bookmarks] Restored access to: ${entry.path}`);
        if (entry.isHome) {
          homeRestored = true;
        }
      } catch (err) {
        console.error(`[sandbox-bookmarks] Failed to restore bookmark for ${entry.path}:`, err);
        // Bookmark may be stale — don't crash, just skip it
      }
    }

    // Also check if any bookmark covers home (e.g. "/" covers /Users/username)
    if (!homeRestored && this.entries.length > 0) {
      homeRestored = this.isAccessible(getRealHome());
    }

    return homeRestored;
  }

  /**
   * Open a directory picker with security-scoped bookmark support.
   * Saves the bookmark for future launches.
   *
   * @param win - Parent BrowserWindow for the dialog
   * @param options - Additional dialog options
   * @returns The selected directory path, or null if cancelled
   */
  async requestBookmark(
    win: BrowserWindow | null,
    options?: {
      title?: string;
      buttonLabel?: string;
      defaultPath?: string;
    }
  ): Promise<string | null> {
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: this.isMAS,
      title: options?.title ?? "Select Directory",
      buttonLabel: options?.buttonLabel ?? "Select",
      defaultPath: options?.defaultPath,
    };

    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const selectedPath = result.filePaths[0];

    // Save security-scoped bookmark if available (MAS only)
    if (this.isMAS && result.bookmarks && result.bookmarks.length > 0) {
      const bookmarkData = result.bookmarks[0];
      const realHome = getRealHome();
      // Treat the selection as "home" if it IS the home dir or an ancestor of it
      // (e.g. selecting "/" covers /Users/onchainengineer)
      const normalizedSelected = selectedPath.endsWith("/") ? selectedPath : `${selectedPath}/`;
      const isHome =
        selectedPath === realHome ||
        selectedPath === `${realHome}/` ||
        realHome.startsWith(normalizedSelected);

      const entry: BookmarkEntry = {
        path: selectedPath,
        bookmark: bookmarkData,
        isHome,
        createdAt: new Date().toISOString(),
      };

      // Start accessing immediately
      try {
        const stopFn = app.startAccessingSecurityScopedResource(bookmarkData) as unknown as () => void;
        this.stopFns.push(stopFn);
      } catch (err) {
        console.error(`[sandbox-bookmarks] Failed to activate bookmark for ${selectedPath}:`, err);
      }

      this.saveBookmark(entry);
      console.log(
        `[sandbox-bookmarks] Saved bookmark for: ${selectedPath}${isHome ? " (home)" : ""}`
      );
    }

    return selectedPath;
  }

  /**
   * Check if a path falls under any active bookmark.
   */
  isAccessible(targetPath: string): boolean {
    if (!this.isMAS) return true;

    const normalized = targetPath.endsWith("/") ? targetPath : `${targetPath}/`;
    return this.entries.some((entry) => {
      const entryNorm = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
      return normalized.startsWith(entryNorm) || normalized === entryNorm;
    });
  }

  /**
   * Check if we have a bookmark for the user's home directory.
   */
  hasHomeAccess(): boolean {
    if (!this.isMAS) return true;
    // Check explicit isHome flag OR if any bookmark path covers the real home
    if (this.entries.some((e) => e.isHome)) return true;
    return this.isAccessible(getRealHome());
  }

  /**
   * Get the home directory bookmark entry, if any.
   */
  getHomeBookmark(): BookmarkEntry | undefined {
    return this.entries.find((e) => e.isHome);
  }

  /**
   * Get all bookmark entries (for Settings UI).
   */
  getEntries(): readonly BookmarkEntry[] {
    return this.entries;
  }

  /**
   * Whether this is a MAS sandbox build.
   */
  get isSandboxed(): boolean {
    return this.isMAS;
  }

  /**
   * Release all security-scoped resources. Call on app quit.
   */
  stopAccessingAll(): void {
    for (const stopFn of this.stopFns) {
      try {
        stopFn();
      } catch {
        // Best-effort cleanup
      }
    }
    this.stopFns = [];
    console.log("[sandbox-bookmarks] Released all security-scoped resources");
  }

  // -- Private helpers --

  private saveBookmark(entry: BookmarkEntry): void {
    // Replace existing entry for the same path, or add new
    const existing = this.entries.findIndex((e) => e.path === entry.path);
    if (existing >= 0) {
      this.entries[existing] = entry;
    } else {
      this.entries.push(entry);
    }

    this.saveToDisk();
  }

  private loadFromDisk(): BookmarkEntry[] {
    try {
      if (!fs.existsSync(this.bookmarksPath)) {
        return [];
      }
      const raw = fs.readFileSync(this.bookmarksPath, "utf-8");
      const data = JSON.parse(raw) as BookmarksFile;
      if (data.version !== 1 || !Array.isArray(data.entries)) {
        console.warn("[sandbox-bookmarks] Invalid bookmarks file format, ignoring");
        return [];
      }
      // Migrate: fix isHome for entries that are ancestors of home (e.g. "/")
      const realHome = getRealHome();
      let migrated = false;
      for (const entry of data.entries) {
        if (!entry.isHome) {
          const norm = entry.path.endsWith("/") ? entry.path : `${entry.path}/`;
          if (entry.path === realHome || entry.path === `${realHome}/` || realHome.startsWith(norm)) {
            entry.isHome = true;
            migrated = true;
          }
        }
      }
      if (migrated) {
        // Persist the fixed entries
        try {
          const dir = path.dirname(this.bookmarksPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(this.bookmarksPath, JSON.stringify({ version: 1, entries: data.entries }, null, 2), "utf-8");
          console.log("[sandbox-bookmarks] Migrated bookmark isHome flags");
        } catch {
          // Best-effort migration
        }
      }

      return data.entries;
    } catch (err) {
      console.error("[sandbox-bookmarks] Failed to load bookmarks:", err);
      return [];
    }
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.bookmarksPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data: BookmarksFile = {
        version: 1,
        entries: this.entries,
      };
      fs.writeFileSync(this.bookmarksPath, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[sandbox-bookmarks] Failed to save bookmarks:", err);
    }
  }
}
