/**
 * SyncService — mirrors ~/.lattice/ config and session files to a private GitHub repo.
 *
 * Uses a dedicated git repo at ~/.lattice/.sync/ as a staging area.
 * Files are copied from ~/.lattice/ → .sync/, committed, and pushed.
 * Restore pulls from the remote and copies back.
 *
 * Auto-sync watches ~/.lattice/ for changes and debounces pushes.
 */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { log } from "@/node/services/log";
import type { Config } from "@/node/config";
import { getLatticeHome, getLatticeSyncDir, getLatticeSessionsDir } from "@/common/constants/paths";
import type { SyncConfig, SyncStatus } from "@/common/types/sync";
import { AUTO_SYNC_DEBOUNCE_MS } from "@/common/types/sync";
import { execAsync } from "@/node/utils/disposableExec";

type SyncEventListener = (status: SyncStatus) => void;

export class SyncService {
  private readonly config: Config;

  /** In-memory runtime status. */
  private status: SyncStatus = { state: "idle" };

  /** fs.watch handle for auto-sync. */
  private watcher: fs.FSWatcher | null = null;

  /** Debounce timer for auto-sync. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Mutex: true while a push/pull is in progress. */
  private busy = false;

  /** When true, a push is queued to run after the current operation completes. */
  private pendingPush = false;

  /** Listeners for real-time status updates. */
  private readonly listeners = new Set<SyncEventListener>();

  constructor(config: Config) {
    this.config = config;
  }

  /** On startup: if sync is configured, verify repo and start auto-sync. */
  initialize(): void {
    try {
      const syncConfig = this.getSyncConfig();
      if (!syncConfig) return;

      // Verify the sync repo exists (non-blocking — don't await)
      void this.ensureSyncRepo(syncConfig.repoUrl).catch((err: unknown) => {
        log.warn("[Sync] Failed to verify sync repo on startup", { error: String(err) });
      });

      if (syncConfig.autoSync) {
        this.startWatcher(syncConfig);
      }

      log.debug(`[Sync] Initialized with repo: ${syncConfig.repoUrl}`);
    } catch (err) {
      // Startup-time initialization must never crash the app
      log.warn("[Sync] Failed to initialize", { error: err });
    }
  }

  /** Configure sync: save config, setup repo, optionally start auto-sync. */
  async configure(syncConfig: SyncConfig): Promise<void> {
    // Stop existing watcher before reconfiguring
    this.stopWatcher();

    // Persist to config.json
    await this.config.editConfig((cfg) => {
      cfg.sync = syncConfig;
      return cfg;
    });

    // Setup the sync repo
    await this.ensureSyncRepo(syncConfig.repoUrl);

    // Start auto-sync if enabled
    if (syncConfig.autoSync) {
      this.startWatcher(syncConfig);
    }
  }

  /** Get current sync status. */
  getStatus(): SyncStatus {
    return { ...this.status };
  }

  /** Manual push: copy files → commit → push. */
  async push(): Promise<SyncStatus> {
    if (this.busy) {
      this.pendingPush = true;
      return this.getStatus();
    }

    this.busy = true;
    this.updateStatus({ state: "syncing", operation: "push", lastError: null });

    try {
      const syncConfig = this.getSyncConfig();
      if (!syncConfig) {
        throw new Error("Sync not configured");
      }

      const syncDir = getLatticeSyncDir();
      await this.ensureSyncRepo(syncConfig.repoUrl);

      // Collect and copy files
      const fileCount = await this.copyFilesToSyncRepo(syncConfig);

      // Git add, commit, push
      const commitHash = await this.gitCommitAndPush(syncDir);

      this.updateStatus({
        state: "success",
        operation: null,
        lastSyncAt: Date.now(),
        lastSyncCommit: commitHash,
        fileCount,
      });

      log.debug(`[Sync] Push complete: ${fileCount} files, commit ${commitHash ?? "none"}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: "error", operation: null, lastError: errorMsg });
      log.warn("[Sync] Push failed", { error: err });
    } finally {
      this.busy = false;

      // Process queued push
      if (this.pendingPush) {
        this.pendingPush = false;
        void this.push();
      }
    }

    return this.getStatus();
  }

  /** Manual pull: fetch from remote → copy files back to ~/.lattice/. */
  async pull(): Promise<SyncStatus> {
    if (this.busy) {
      return this.getStatus();
    }

    this.busy = true;
    this.updateStatus({ state: "syncing", operation: "pull", lastError: null });

    try {
      const syncConfig = this.getSyncConfig();
      if (!syncConfig) {
        throw new Error("Sync not configured");
      }

      const syncDir = getLatticeSyncDir();
      const latticeHome = getLatticeHome();

      // Pull latest from remote
      await this.gitPull(syncDir);

      // Back up current files before overwriting
      const backupDir = path.join(latticeHome, `.sync-backup-${Date.now()}`);
      await fsPromises.mkdir(backupDir, { recursive: true });
      await this.backupCurrentFiles(syncConfig, backupDir);

      // Copy files from sync repo back to ~/.lattice/
      const fileCount = await this.restoreFilesFromSyncRepo(syncConfig);

      this.updateStatus({
        state: "success",
        operation: null,
        lastSyncAt: Date.now(),
        fileCount,
      });

      log.debug(`[Sync] Pull complete: ${fileCount} files restored (backup at ${backupDir})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.updateStatus({ state: "error", operation: null, lastError: errorMsg });
      log.warn("[Sync] Pull failed", { error: err });
    } finally {
      this.busy = false;
    }

    return this.getStatus();
  }

  /** Remove sync config, stop watchers. Does not delete the sync repo. */
  async disconnect(): Promise<void> {
    this.stopWatcher();
    await this.config.editConfig((cfg) => {
      cfg.sync = undefined;
      return cfg;
    });
    this.updateStatus({ state: "idle", lastError: null, operation: null });
  }

  /** Subscribe to status changes. Returns unsubscribe function. */
  subscribe(listener: SyncEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Cleanup on app shutdown. */
  dispose(): void {
    this.stopWatcher();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // GitHub CLI operations — repo creation & listing
  // ---------------------------------------------------------------------------

  /** Check if `gh` CLI is installed and authenticated. */
  async checkGhAuth(): Promise<{ authenticated: boolean; username: string | null }> {
    try {
      using proc = execAsync("gh auth status --hostname github.com");
      const { stderr } = await proc.result;
      // gh auth status prints to stderr; look for "Logged in to github.com account <user>"
      const match = /account\s+(\S+)/.exec(stderr);
      return { authenticated: true, username: match?.[1] ?? null };
    } catch {
      return { authenticated: false, username: null };
    }
  }

  /** List the user's GitHub repos (requires `gh` auth). Returns up to 50 repos. */
  async listGithubRepos(): Promise<Array<{ name: string; fullName: string; url: string; isPrivate: boolean }>> {
    try {
      using proc = execAsync(
        "gh repo list --json name,nameWithOwner,sshUrl,isPrivate --limit 50"
      );
      const { stdout } = await proc.result;
      const parsed = JSON.parse(stdout) as Array<{
        name: string;
        nameWithOwner: string;
        sshUrl: string;
        isPrivate: boolean;
      }>;
      return parsed.map((r) => ({
        name: r.name,
        fullName: r.nameWithOwner,
        url: r.sshUrl,
        isPrivate: r.isPrivate,
      }));
    } catch (err) {
      log.warn("[Sync] Failed to list GitHub repos", { error: String(err) });
      return [];
    }
  }

  /** Create a new private GitHub repo and return its SSH URL. */
  async createGithubRepo(name: string): Promise<{ url: string; fullName: string }> {
    using proc = execAsync(
      `gh repo create "${name}" --private --clone=false --description "lattice config backup"`
    );
    const { stderr } = await proc.result;

    // gh repo create prints the URL to stderr like: https://github.com/user/name
    // We need the SSH URL — fetch it via gh repo view
    const match = /github\.com\/([^/\s]+\/[^/\s]+)/.exec(stderr);
    const fullName = match?.[1] ?? name;

    using urlProc = execAsync(`gh repo view "${fullName}" --json sshUrl --jq .sshUrl`);
    const { stdout } = await urlProc.result;
    const sshUrl = stdout.trim();

    return { url: sshUrl, fullName };
  }

  // ---------------------------------------------------------------------------
  // Private — git operations
  // ---------------------------------------------------------------------------

  private async ensureSyncRepo(repoUrl: string): Promise<void> {
    const syncDir = getLatticeSyncDir();

    // Check if .sync/ already has a git repo
    const gitDir = path.join(syncDir, ".git");
    const gitDirExists = await fsPromises.access(gitDir).then(() => true, () => false);
    if (gitDirExists) {
      // Verify remote matches; update if changed
      try {
        using proc = execAsync(`git -C "${syncDir}" remote get-url origin`);
        const { stdout } = await proc.result;
        if (stdout.trim() !== repoUrl) {
          using setProc = execAsync(`git -C "${syncDir}" remote set-url origin "${repoUrl}"`);
          await setProc.result;
        }
      } catch {
        // Remote doesn't exist — add it
        using addProc = execAsync(`git -C "${syncDir}" remote add origin "${repoUrl}"`);
        await addProc.result;
      }
      return;
    }

    // Try cloning first
    await fsPromises.mkdir(syncDir, { recursive: true });
    try {
      using proc = execAsync(`git clone "${repoUrl}" "${syncDir}" --depth=1`);
      await proc.result;
      return;
    } catch {
      // Clone failed (empty repo or doesn't exist yet) — init locally
      log.debug("[Sync] Clone failed, initializing fresh repo");
    }

    // Init fresh repo
    using initProc = execAsync(`git -C "${syncDir}" init`);
    await initProc.result;
    using remoteProc = execAsync(`git -C "${syncDir}" remote add origin "${repoUrl}"`);
    await remoteProc.result;
  }

  private async gitCommitAndPush(syncDir: string): Promise<string | null> {
    // Stage all changes
    using addProc = execAsync(`git -C "${syncDir}" add -A`);
    await addProc.result;

    // Check if there are changes to commit
    try {
      using diffProc = execAsync(`git -C "${syncDir}" diff --cached --quiet`);
      await diffProc.result;
      // Exit 0 means no changes — skip commit
      return null;
    } catch {
      // Exit non-zero means there are changes — proceed to commit
    }

    const timestamp = new Date().toISOString();
    using commitProc = execAsync(
      `git -C "${syncDir}" commit -m "lattice sync: ${timestamp}"`
    );
    await commitProc.result;

    // Get commit hash
    let commitHash: string | null = null;
    try {
      using hashProc = execAsync(`git -C "${syncDir}" rev-parse --short HEAD`);
      const { stdout } = await hashProc.result;
      commitHash = stdout.trim();
    } catch {
      // Non-critical — hash is just for display
    }

    // Push to remote
    using pushProc = execAsync(`git -C "${syncDir}" push origin HEAD`);
    await pushProc.result;

    return commitHash;
  }

  private async gitPull(syncDir: string): Promise<void> {
    // Fetch and pull — use rebase to avoid merge commits
    try {
      using proc = execAsync(`git -C "${syncDir}" pull --rebase origin main`);
      await proc.result;
    } catch {
      // Try with 'master' branch if 'main' fails
      try {
        using proc = execAsync(`git -C "${syncDir}" pull --rebase origin master`);
        await proc.result;
      } catch (err) {
        // Final fallback: just fetch (repo might be empty or have different branch)
        log.warn("[Sync] Pull failed, attempting fetch only", { error: err });
        using fetchProc = execAsync(`git -C "${syncDir}" fetch origin`);
        await fetchProc.result;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private — file operations
  // ---------------------------------------------------------------------------

  private async copyFilesToSyncRepo(syncConfig: SyncConfig): Promise<number> {
    const latticeHome = getLatticeHome();
    const syncDir = getLatticeSyncDir();
    let fileCount = 0;

    // Config
    if (syncConfig.categories.config) {
      fileCount += await this.copyFile(
        path.join(latticeHome, "config.json"),
        path.join(syncDir, "config.json"),
      );
    }

    // MCP config
    if (syncConfig.categories.mcpConfig) {
      fileCount += await this.copyFile(
        path.join(latticeHome, "mcp.jsonc"),
        path.join(syncDir, "mcp.jsonc"),
      );
    }

    // Providers (sensitive)
    if (syncConfig.categories.providers) {
      fileCount += await this.copyFile(
        path.join(latticeHome, "providers.jsonc"),
        path.join(syncDir, "providers.jsonc"),
      );
    }

    // Secrets (sensitive)
    if (syncConfig.categories.secrets) {
      fileCount += await this.copyFile(
        path.join(latticeHome, "secrets.json"),
        path.join(syncDir, "secrets.json"),
      );
    }

    // Chat history (sessions/)
    if (syncConfig.categories.chatHistory) {
      const sessionsDir = getLatticeSessionsDir();
      const syncSessionsDir = path.join(syncDir, "sessions");
      await fsPromises.mkdir(syncSessionsDir, { recursive: true });

      try {
        const entries = await fsPromises.readdir(sessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const wsDir = path.join(sessionsDir, entry.name);
          const syncWsDir = path.join(syncSessionsDir, entry.name);
          await fsPromises.mkdir(syncWsDir, { recursive: true });

          // chat.jsonl
          fileCount += await this.copyFile(
            path.join(wsDir, "chat.jsonl"),
            path.join(syncWsDir, "chat.jsonl"),
          );
          // session-timing.json
          fileCount += await this.copyFile(
            path.join(wsDir, "session-timing.json"),
            path.join(syncWsDir, "session-timing.json"),
          );
        }
      } catch {
        // Sessions dir may not exist yet — that's fine
      }
    }

    return fileCount;
  }

  private async restoreFilesFromSyncRepo(syncConfig: SyncConfig): Promise<number> {
    const latticeHome = getLatticeHome();
    const syncDir = getLatticeSyncDir();
    let fileCount = 0;

    // Config
    if (syncConfig.categories.config) {
      fileCount += await this.copyFile(
        path.join(syncDir, "config.json"),
        path.join(latticeHome, "config.json"),
      );
    }

    // MCP config
    if (syncConfig.categories.mcpConfig) {
      fileCount += await this.copyFile(
        path.join(syncDir, "mcp.jsonc"),
        path.join(latticeHome, "mcp.jsonc"),
      );
    }

    // Providers (sensitive — restore with restricted permissions)
    if (syncConfig.categories.providers) {
      const dest = path.join(latticeHome, "providers.jsonc");
      fileCount += await this.copyFile(path.join(syncDir, "providers.jsonc"), dest);
      await fsPromises.chmod(dest, 0o600).catch(() => { /* best-effort chmod */ });
    }

    // Secrets (sensitive — restore with restricted permissions)
    if (syncConfig.categories.secrets) {
      const dest = path.join(latticeHome, "secrets.json");
      fileCount += await this.copyFile(path.join(syncDir, "secrets.json"), dest);
      await fsPromises.chmod(dest, 0o600).catch(() => { /* best-effort chmod */ });
    }

    // Chat history
    if (syncConfig.categories.chatHistory) {
      const syncSessionsDir = path.join(syncDir, "sessions");
      const sessionsDir = getLatticeSessionsDir();

      try {
        const entries = await fsPromises.readdir(syncSessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const syncWsDir = path.join(syncSessionsDir, entry.name);
          const wsDir = path.join(sessionsDir, entry.name);
          await fsPromises.mkdir(wsDir, { recursive: true });

          fileCount += await this.copyFile(
            path.join(syncWsDir, "chat.jsonl"),
            path.join(wsDir, "chat.jsonl"),
          );
          fileCount += await this.copyFile(
            path.join(syncWsDir, "session-timing.json"),
            path.join(wsDir, "session-timing.json"),
          );
        }
      } catch {
        // Sync repo may not have sessions yet
      }
    }

    return fileCount;
  }

  private async backupCurrentFiles(syncConfig: SyncConfig, backupDir: string): Promise<void> {
    const latticeHome = getLatticeHome();

    if (syncConfig.categories.config) {
      await this.copyFile(path.join(latticeHome, "config.json"), path.join(backupDir, "config.json"));
    }
    if (syncConfig.categories.mcpConfig) {
      await this.copyFile(path.join(latticeHome, "mcp.jsonc"), path.join(backupDir, "mcp.jsonc"));
    }
    if (syncConfig.categories.providers) {
      await this.copyFile(path.join(latticeHome, "providers.jsonc"), path.join(backupDir, "providers.jsonc"));
    }
    if (syncConfig.categories.secrets) {
      await this.copyFile(path.join(latticeHome, "secrets.json"), path.join(backupDir, "secrets.json"));
    }
  }

  /** Copy a single file. Returns 1 if copied, 0 if source doesn't exist. */
  private async copyFile(src: string, dest: string): Promise<number> {
    try {
      await fsPromises.copyFile(src, dest);
      return 1;
    } catch {
      // Source doesn't exist — skip
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — auto-sync watcher
  // ---------------------------------------------------------------------------

  private startWatcher(syncConfig: SyncConfig): void {
    this.stopWatcher();

    const latticeHome = getLatticeHome();
    const debounceMs = syncConfig.autoSyncDebounceMs ?? AUTO_SYNC_DEBOUNCE_MS;

    try {
      // Watch the lattice home directory for changes to top-level config files.
      // fs.watch on a directory fires for any file create/modify/delete in it.
      this.watcher = fs.watch(latticeHome, { persistent: false }, (_event, filename) => {
        if (!filename) return;

        // Only trigger for files we're syncing
        const isRelevant = this.isRelevantFile(filename, syncConfig);
        if (!isRelevant) return;

        // Debounce: reset timer on each change
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = null;
          void this.push();
        }, debounceMs);
      });

      this.watcher.on("error", (err) => {
        log.warn("[Sync] Watcher error", { error: err });
      });
    } catch (err) {
      log.warn("[Sync] Failed to start watcher", { error: err });
    }
  }

  private stopWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /** Check if a changed filename is relevant to the current sync categories. */
  private isRelevantFile(filename: string, syncConfig: SyncConfig): boolean {
    if (syncConfig.categories.config && filename === "config.json") return true;
    if (syncConfig.categories.mcpConfig && filename === "mcp.jsonc") return true;
    if (syncConfig.categories.providers && filename === "providers.jsonc") return true;
    if (syncConfig.categories.secrets && filename === "secrets.json") return true;
    // Sessions dir changes are watched separately (top-level only sees "sessions")
    if (syncConfig.categories.chatHistory && filename === "sessions") return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private — helpers
  // ---------------------------------------------------------------------------

  private getSyncConfig(): SyncConfig | undefined {
    const cfg = this.config.loadConfigOrDefault();
    return cfg.sync ?? undefined;
  }

  private updateStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (err) {
        log.warn("[Sync] Listener error", { error: err });
      }
    }
  }
}
