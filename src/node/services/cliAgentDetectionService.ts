/**
 * CLI Agent Detection Service
 *
 * Scans the system for installed CLI coding agents by checking binaries
 * in PATH and known installation paths. Results are cached both in-memory
 * (30s TTL) and on disk (for instant startup) following the emdash pattern.
 *
 * Reuses detection patterns from:
 * - commandDiscovery.ts (isCommandAvailable, macOS app path scanning)
 * - claudeCodeProvider.ts (findClaudeBinary for Claude Code)
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { isCommandAvailable } from "@/node/utils/commandDiscovery";
import { findClaudeBinary, isClaudeCliAuthenticated } from "@/node/services/claudeCodeProvider";
import { spawnAgentProcess } from "@/node/services/cliAgentProvider";
import {
  CLI_AGENT_DEFINITIONS,
  CLI_AGENT_SLUGS,
  type CliAgentSlug,
  type CliAgentDefinition,
} from "@/common/constants/cliAgents";
import { createAsyncMessageQueue } from "@/common/utils/asyncMessageQueue";
import { log } from "@/node/services/log";
import * as fsPromises from "fs/promises";

/**
 * Async alternative to spawnSync — runs a command without blocking the event loop.
 * Returns { status, stdout } similar to spawnSync but yields the event loop
 * so heartbeat intervals and other timers continue to fire.
 */
function spawnAsync(
  command: string,
  args: string[],
  options: { timeoutMs?: number; captureStdout?: boolean; captureStderr?: boolean } = {}
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const { timeoutMs = 5000, captureStdout = true, captureStderr = false } = options;
  return new Promise((resolve) => {
    const stdio: ("pipe" | "ignore")[] = [
      "ignore",
      captureStdout ? "pipe" : "ignore",
      captureStderr ? "pipe" : "ignore",
    ];
    const child = spawn(command, args, { encoding: "utf-8", stdio } as any);

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: null, stdout, stderr });
    }, timeoutMs);

    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ status: null, stdout, stderr });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ status: code, stdout, stderr });
    });
  });
}

export interface AgentHealthStatus {
  status: "healthy" | "unhealthy" | "unknown" | "checking";
  message?: string;
  checkedAt?: number;
}

export interface CliAgentDetectionResult {
  slug: string;
  displayName: string;
  description: string;
  detected: boolean;
  binaryPath?: string;
  version?: string;
  installUrl: string;
  installCommand?: string;
  category: "cli" | "vscode-extension" | "app";
  supportedModels?: string[];
  health?: AgentHealthStatus;
}

/** Streaming install event types */
export type InstallStreamEvent =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "result"; success: boolean; message: string };

export interface CliAgentInstallResult {
  success: boolean;
  message: string;
  output?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Disk cache — persisted to <latticeHome>/agent-status-cache.json
// Provides instant results on app startup (like emdash's pattern).
// ────────────────────────────────────────────────────────────────────────────

interface DiskCacheEntry {
  slug: string;
  detected: boolean;
  binaryPath?: string;
  version?: string;
  health?: AgentHealthStatus;
}

interface DiskCache {
  /** ISO timestamp when the cache was written */
  updatedAt: string;
  /** Per-agent detection results (only the mutable parts) */
  agents: DiskCacheEntry[];
}

// Disk cache is valid for 10 minutes — stale data is still served
// while a background refresh runs.
const DISK_CACHE_TTL_MS = 10 * 60 * 1000;

// In-memory cache duration: 30 seconds
const MEMORY_CACHE_TTL_MS = 30_000;

// Health check results cached for 5 minutes
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

export class CliAgentDetectionService {
  private cache: CliAgentDetectionResult[] | null = null;
  private cacheTimestamp = 0;
  private diskCachePath: string | null = null;
  private backgroundRefreshInFlight = false;
  private healthCache = new Map<string, AgentHealthStatus>();
  /** Shared promise for the current cold-path scan — deduplicates concurrent callers. */
  private scanInFlight: Promise<CliAgentDetectionResult[]> | null = null;

  /**
   * Optionally set a persistent cache path (usually <latticeHome>/agent-status-cache.json).
   * Called from serviceContainer after construction.
   */
  setDiskCachePath(cachePath: string): void {
    this.diskCachePath = cachePath;
  }

  /**
   * Detect all registered CLI agents. Returns cached results if fresh.
   *
   * Priority:
   *  1. In-memory cache (30s TTL) — instant
   *  2. Disk cache (10min TTL) — fast, triggers background re-probe
   *  3. Full detection scan — slow but accurate
   */
  async detectAll(): Promise<CliAgentDetectionResult[]> {
    const now = Date.now();

    // 1) In-memory cache is fresh → return immediately
    if (this.cache && now - this.cacheTimestamp < MEMORY_CACHE_TTL_MS) {
      return this.cache;
    }

    // 2) Try disk cache for instant startup
    if (!this.cache && this.diskCachePath) {
      const diskResults = this.readDiskCache();
      if (diskResults) {
        this.cache = diskResults;
        this.cacheTimestamp = now;
        log.info(`[CliAgentDetection] Loaded ${diskResults.filter((r) => r.detected).length} agents from disk cache`);
        // Kick off background refresh so we get fresh data soon
        this.backgroundRefresh();
        return diskResults;
      }
    }

    // 3) Full detection scan — deduplicated: concurrent callers share one scan
    if (!this.scanInFlight) {
      this.scanInFlight = this.runFullDetection().finally(() => {
        this.scanInFlight = null;
      });
    }
    return this.scanInFlight;
  }

  /**
   * Stream detection results one-by-one as each agent probe resolves.
   *
   * - Memory cache fresh  → yields all results instantly from cache
   * - Disk cache present  → yields from disk cache immediately, then background-refreshes
   * - Cold path           → fires all probes in parallel; yields each as it resolves,
   *                         then stores the full set in both caches for next call
   */
  async *detectEach(): AsyncGenerator<CliAgentDetectionResult> {
    const now = Date.now();

    // 1) In-memory cache is fresh → stream instantly
    if (this.cache && now - this.cacheTimestamp < MEMORY_CACHE_TTL_MS) {
      for (const result of this.cache) yield result;
      return;
    }

    // 2) Disk cache → yield instantly and kick off a background refresh
    if (!this.cache && this.diskCachePath) {
      const diskResults = this.readDiskCache();
      if (diskResults) {
        this.cache = diskResults;
        this.cacheTimestamp = now;
        log.info(
          `[CliAgentDetection] detectEach: ${diskResults.filter((r) => r.detected).length} agents from disk cache`
        );
        for (const result of diskResults) yield result;
        this.backgroundRefresh();
        return;
      }
    }

    // 3) Cold path: join the shared detectAll() scan so concurrent callers
    //    (e.g. the server's startup pre-warm + the first browser subscriber)
    //    share one set of probes instead of running duplicate scans.
    const results = await this.detectAll();
    for (const result of results) yield result;
  }

  /**
   * Detect a single CLI agent by slug.
   */
  async detectOne(slug: string): Promise<CliAgentDetectionResult> {
    const rawDef = CLI_AGENT_DEFINITIONS[slug as CliAgentSlug];
    // Cast to CliAgentDefinition to access optional fields uniformly
    const def = rawDef as CliAgentDefinition | undefined;
    if (!def) {
      return {
        slug,
        displayName: slug,
        description: "Unknown agent",
        detected: false,
        installUrl: "",
        category: "cli",
      };
    }

    const result: CliAgentDetectionResult = {
      slug,
      displayName: def.displayName,
      description: def.description,
      detected: false,
      installUrl: def.installUrl,
      installCommand: def.installCommand,
      category: def.category,
      supportedModels: def.supportedModels ? [...def.supportedModels] : undefined,
    };

    try {
      // Special case: Claude Code — reuse existing detection
      if (slug === "claude-code") {
        const binaryPath = await findClaudeBinary();
        if (binaryPath) {
          result.detected = true;
          result.binaryPath = binaryPath;
          result.version = await this.getVersion(binaryPath);
        }
        return result;
      }

      // GitHub CLI extension detection
      if (def.ghExtension) {
        const ghDetected = await this.detectGhExtension(def);
        if (ghDetected) {
          result.detected = true;
          result.binaryPath = "gh " + def.ghExtension;
          return result;
        }
        // Fall through to standard binary detection (e.g. `copilot` npm binary)
      }

      // Standard binary detection
      const binaryPath = await this.findBinary(def);
      if (binaryPath) {
        result.detected = true;
        result.binaryPath = binaryPath;
        result.version = await this.getVersion(binaryPath);
      }
    } catch (error) {
      log.debug(`[CliAgentDetection] Error detecting ${slug}:`, error);
    }

    return result;
  }

  /**
   * Invalidate the cache (e.g., after user installs an agent).
   */
  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * Check health of a single agent (can it authenticate / reach its provider?)
   *
   * Uses cached results within HEALTH_CACHE_TTL_MS.
   * Special-cases claude-code via isClaudeCliAuthenticated().
   * Generic agents: spawn with healthCheckArgs and check exit code.
   */
  async checkHealth(slug: string): Promise<AgentHealthStatus> {
    // Check cache first
    const cached = this.healthCache.get(slug);
    if (cached?.checkedAt && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
      return cached;
    }

    const rawDef = CLI_AGENT_DEFINITIONS[slug as CliAgentSlug];
    const def = rawDef as CliAgentDefinition | undefined;

    if (!def?.healthCheckArgs) {
      const result: AgentHealthStatus = { status: "unknown", message: "No health check configured", checkedAt: Date.now() };
      this.healthCache.set(slug, result);
      return result;
    }

    // Must be detected first
    const detection = await this.detectOne(slug);
    if (!detection.detected || !detection.binaryPath) {
      const result: AgentHealthStatus = { status: "unhealthy", message: "Not installed", checkedAt: Date.now() };
      this.healthCache.set(slug, result);
      return result;
    }

    try {
      let healthResult: AgentHealthStatus;

      if (slug === "claude-code") {
        // Delegate to the specialized Claude auth check
        const auth = await isClaudeCliAuthenticated();
        healthResult = {
          status: auth.ok ? "healthy" : "unhealthy",
          message: auth.message,
          checkedAt: Date.now(),
        };
      } else {
        // Generic: spawn with healthCheckArgs, check exit code
        healthResult = await this.runGenericHealthCheck(
          detection.binaryPath,
          def.healthCheckArgs,
          def.healthCheckTimeoutMs ?? 15000
        );
      }

      this.healthCache.set(slug, healthResult);

      // Update detection cache entry with health status
      if (this.cache) {
        const entry = this.cache.find((r) => r.slug === slug);
        if (entry) entry.health = healthResult;
        this.writeDiskCache(this.cache);
      }

      return healthResult;
    } catch (error) {
      const result: AgentHealthStatus = {
        status: "unhealthy",
        message: error instanceof Error ? error.message : "Health check failed",
        checkedAt: Date.now(),
      };
      this.healthCache.set(slug, result);
      return result;
    }
  }

  /**
   * Check health of all detected agents in parallel.
   */
  async checkAllHealth(): Promise<Record<string, AgentHealthStatus>> {
    const results = await this.detectAll();
    const detectedSlugs = results.filter((r) => r.detected).map((r) => r.slug);

    const healthEntries = await Promise.all(
      detectedSlugs.map(async (slug) => {
        const health = await this.checkHealth(slug);
        return [slug, health] as const;
      })
    );

    return Object.fromEntries(healthEntries);
  }

  /**
   * Install a CLI agent by running its installCommand.
   * Returns immediately after the install process completes (with timeout).
   */
  async installAgent(slug: string): Promise<CliAgentInstallResult> {
    const rawDef = CLI_AGENT_DEFINITIONS[slug as CliAgentSlug];
    const def = rawDef as CliAgentDefinition | undefined;

    if (!def) {
      return { success: false, message: `Unknown agent: ${slug}` };
    }

    if (!def.installCommand) {
      return {
        success: false,
        message: `No install command available for ${def.displayName}. Visit ${def.installUrl} to install manually.`,
      };
    }

    // Check if already installed
    const current = await this.detectOne(slug);
    if (current.detected) {
      return {
        success: true,
        message: `${def.displayName} is already installed${current.version ? ` (${current.version})` : ""}.`,
      };
    }

    log.info(`[CliAgentDetection] Installing ${def.displayName}: ${def.installCommand}`);

    try {
      const output = await this.runInstallCommand(def.installCommand);
      // Invalidate cache so next detect picks up the new agent
      this.invalidateCache();

      // Brief delay for shim registration (Volta, nvm may need a moment)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify installation succeeded
      const verify = await this.detectOne(slug);
      if (verify.detected) {
        return {
          success: true,
          message: `${def.displayName} installed successfully${verify.version ? ` (${verify.version})` : ""}.`,
          output,
        };
      }

      return {
        success: false,
        message: `Install command ran but ${def.displayName} was not detected afterwards. Check the output for errors.`,
        output,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `Failed to install ${def.displayName}: ${msg}`,
      };
    }
  }

  /**
   * Streaming install — yields stdout/stderr chunks as they arrive,
   * then a final result event. Supports parallel installs.
   */
  async *installAgentStreaming(slug: string): AsyncGenerator<InstallStreamEvent> {
    const rawDef = CLI_AGENT_DEFINITIONS[slug as CliAgentSlug];
    const def = rawDef as CliAgentDefinition | undefined;

    if (!def) {
      yield { type: "result", success: false, message: `Unknown agent: ${slug}` };
      return;
    }

    if (!def.installCommand) {
      yield {
        type: "result",
        success: false,
        message: `No install command available for ${def.displayName}. Visit ${def.installUrl} to install manually.`,
      };
      return;
    }

    // Check if already installed
    const current = await this.detectOne(slug);
    if (current.detected) {
      yield {
        type: "result",
        success: true,
        message: `${def.displayName} is already installed${current.version ? ` (${current.version})` : ""}.`,
      };
      return;
    }

    log.info(`[CliAgentDetection] Streaming install ${def.displayName}: ${def.installCommand}`);
    yield { type: "stdout", data: `$ ${def.installCommand}\n` };

    const { push, iterate, end } = createAsyncMessageQueue<InstallStreamEvent>();

    // Spawn the install process
    const shell = process.env.SHELL || "/bin/zsh";
    const hasNodeManager =
      !!process.env.VOLTA_HOME ||
      !!process.env.NVM_DIR ||
      !!process.env.FNM_DIR ||
      !!process.env.npm_config_prefix;
    const env: Record<string, string | undefined> = { ...process.env };
    if (!hasNodeManager) {
      env.npm_config_prefix = `${process.env.HOME}/.npm-global`;
    }

    const child = spawn(shell, ["-l", "-c", def.installCommand], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      env,
    });

    child.stdout?.on("data", (data: Buffer) => {
      push({ type: "stdout", data: data.toString() });
    });
    child.stderr?.on("data", (data: Buffer) => {
      push({ type: "stderr", data: data.toString() });
    });

    child.on("close", async (code) => {
      this.invalidateCache();
      // Brief delay for shim registration (Volta, nvm may need a moment)
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (code === 0) {
        // Verify installation succeeded
        const verify = await this.detectOne(slug);
        if (verify.detected) {
          push({
            type: "result",
            success: true,
            message: `${def.displayName} installed successfully${verify.version ? ` (${verify.version})` : ""}.`,
          });
        } else {
          push({
            type: "result",
            success: false,
            message: `Install command ran but ${def.displayName} was not detected afterwards. Check the output for errors.`,
          });
        }
      } else {
        push({
          type: "result",
          success: false,
          message: `Install failed with exit code ${code}.`,
        });
      }
      end();
    });

    child.on("error", (err) => {
      push({
        type: "result",
        success: false,
        message: `Failed to install ${def.displayName}: ${err.message}`,
      });
      end();
    });

    yield* iterate();
  }

  // ────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Full detection scan — probes all agents, updates both caches.
   */
  private async runFullDetection(): Promise<CliAgentDetectionResult[]> {
    const results = await Promise.all(CLI_AGENT_SLUGS.map((slug) => this.detectOne(slug)));

    // Sort: detected first, then alphabetical
    results.sort((a, b) => {
      if (a.detected !== b.detected) return a.detected ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

    this.cache = results;
    this.cacheTimestamp = Date.now();

    // Persist to disk (fire-and-forget)
    this.writeDiskCache(results);

    return results;
  }

  /**
   * Run a background refresh — updates caches without blocking the caller.
   */
  private backgroundRefresh(): void {
    if (this.backgroundRefreshInFlight) return;
    this.backgroundRefreshInFlight = true;

    this.runFullDetection()
      .then(() => {
        log.debug("[CliAgentDetection] Background refresh complete");
      })
      .catch((err) => {
        log.debug("[CliAgentDetection] Background refresh failed:", err);
      })
      .finally(() => {
        this.backgroundRefreshInFlight = false;
      });
  }

  /**
   * Read disk cache. Returns null if missing, corrupt, or expired.
   */
  private readDiskCache(): CliAgentDetectionResult[] | null {
    if (!this.diskCachePath) return null;

    try {
      if (!fs.existsSync(this.diskCachePath)) return null;

      const raw = fs.readFileSync(this.diskCachePath, "utf-8");
      const parsed: DiskCache = JSON.parse(raw);

      // Validate shape
      if (!parsed.updatedAt || !Array.isArray(parsed.agents)) return null;

      // Check TTL
      const age = Date.now() - new Date(parsed.updatedAt).getTime();
      if (age > DISK_CACHE_TTL_MS) {
        log.debug(`[CliAgentDetection] Disk cache expired (${Math.round(age / 1000)}s old)`);
        // Still return it — caller will trigger background refresh
      }

      // Hydrate: merge disk cache entries with static definitions
      const diskMap = new Map<string, DiskCacheEntry>();
      for (const entry of parsed.agents) {
        diskMap.set(entry.slug, entry);
      }

      const results: CliAgentDetectionResult[] = [];
      for (const slug of CLI_AGENT_SLUGS) {
        const rawDef = CLI_AGENT_DEFINITIONS[slug];
        const def = rawDef as CliAgentDefinition;
        const cached = diskMap.get(slug);

        results.push({
          slug,
          displayName: def.displayName,
          description: def.description,
          detected: cached?.detected ?? false,
          binaryPath: cached?.binaryPath,
          version: cached?.version,
          installUrl: def.installUrl,
          installCommand: def.installCommand,
          category: def.category,
          supportedModels: def.supportedModels ? [...def.supportedModels] : undefined,
          health: cached?.health,
        });
      }

      // Sort: detected first, then alphabetical (same as live detection)
      results.sort((a, b) => {
        if (a.detected !== b.detected) return a.detected ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });

      return results;
    } catch (err) {
      log.debug("[CliAgentDetection] Failed to read disk cache:", err);
      return null;
    }
  }

  /**
   * Write detection results to disk cache (fire-and-forget).
   */
  private writeDiskCache(results: CliAgentDetectionResult[]): void {
    if (!this.diskCachePath) return;

    try {
      const cache: DiskCache = {
        updatedAt: new Date().toISOString(),
        agents: results.map((r) => ({
          slug: r.slug,
          detected: r.detected,
          binaryPath: r.binaryPath,
          version: r.version,
          health: r.health,
        })),
      };

      // Ensure parent directory exists
      const dir = path.dirname(this.diskCachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.diskCachePath, JSON.stringify(cache, null, 2), "utf-8");
      log.debug(`[CliAgentDetection] Disk cache written (${results.filter((r) => r.detected).length} detected)`);
    } catch (err) {
      log.debug("[CliAgentDetection] Failed to write disk cache:", err);
    }
  }

  /**
   * Run an install command in a shell, capturing output.
   */
  private runInstallCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: string[] = [];
      // Use login shell (-l) to inherit the user's full environment
      // (Volta shims, nvm, rbenv, etc.). Only fall back to npm_config_prefix
      // if the user hasn't configured a node version manager.
      const shell = process.env.SHELL || "/bin/zsh";
      const hasNodeManager =
        !!process.env.VOLTA_HOME ||
        !!process.env.NVM_DIR ||
        !!process.env.FNM_DIR ||
        !!process.env.npm_config_prefix;
      const env: Record<string, string | undefined> = { ...process.env };
      if (!hasNodeManager) {
        env.npm_config_prefix = `${process.env.HOME}/.npm-global`;
      }
      const child = spawn(shell, ["-l", "-c", command], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000, // 2 minute timeout for installs
        env,
      });

      child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString()));
      child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString()));

      child.on("close", (code) => {
        const output = chunks.join("");
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command exited with code ${code}:\n${output}`));
        }
      });

      child.on("error", (err) => {
        reject(err);
      });
    });
  }

  /**
   * Find a binary by checking macOS paths first, then PATH via `which`.
   */
  private async findBinary(def: CliAgentDefinition): Promise<string | null> {
    // Check macOS-specific known paths first
    if (process.platform === "darwin" && def.macPaths) {
      const home = process.env.HOME ?? "";
      for (const rawPath of def.macPaths) {
        const resolvedPath = rawPath.replace("${HOME}", home);
        try {
          const stats = await fsPromises.stat(resolvedPath);
          if (stats.isFile() && (stats.mode & 0o111) !== 0) {
            return resolvedPath;
          }
        } catch {
          continue;
        }
      }
    }

    // Check each binary name via `which` (async to avoid blocking event loop)
    for (const binaryName of def.binaryNames) {
      if (await isCommandAvailable(binaryName)) {
        // Resolve full path
        try {
          const result = await spawnAsync("which", [binaryName], { timeoutMs: 5000 });
          if (result.status === 0 && result.stdout.trim()) {
            return result.stdout.trim();
          }
        } catch {
          // Fall back to just returning the name
          return binaryName;
        }
      }
    }

    return null;
  }

  /**
   * Detect a GitHub CLI extension (e.g., `gh copilot`).
   */
  private async detectGhExtension(def: CliAgentDefinition): Promise<boolean> {
    if (!def.ghExtension) return false;

    // First check if `gh` is available
    const ghAvailable = await isCommandAvailable("gh");
    if (!ghAvailable) return false;

    // Check if the extension is installed (async to avoid blocking event loop)
    try {
      const result = await spawnAsync("gh", ["extension", "list"], { timeoutMs: 5000 });
      if (result.status === 0 && result.stdout) {
        return result.stdout.toLowerCase().includes(def.ghExtension.toLowerCase());
      }
    } catch {
      // gh extension list failed
    }

    return false;
  }

  /**
   * Try to get version of a binary (best-effort, short timeout).
   */
  /**
   * Generic health check: spawn binary with healthCheckArgs, check exit code.
   */
  private runGenericHealthCheck(
    binaryPath: string,
    args: string[],
    timeoutMs: number
  ): Promise<AgentHealthStatus> {
    return new Promise((resolve) => {
      let stderr = "";

      const proc = spawnAgentProcess(binaryPath, args, timeoutMs);

      proc.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on("close", (code) => {
        resolve({
          status: code === 0 ? "healthy" : "unhealthy",
          message:
            code === 0
              ? "CLI responding"
              : stderr.trim().slice(0, 200) || `Health check failed (exit code ${code})`,
          checkedAt: Date.now(),
        });
      });

      proc.on("error", (err) => {
        resolve({
          status: "unhealthy",
          message: `Failed to spawn: ${err.message}`,
          checkedAt: Date.now(),
        });
      });

      proc.stdin?.end();
    });
  }

  /**
   * Try to get version of a binary (best-effort, short timeout).
   */
  private async getVersion(binaryPath: string): Promise<string | undefined> {
    try {
      const result = await spawnAsync(binaryPath, ["--version"], { timeoutMs: 3000 });
      if (result.status === 0 && result.stdout) {
        // Extract first line, trim to reasonable length
        const firstLine = result.stdout.trim().split("\n")[0];
        return firstLine.slice(0, 100);
      }
    } catch {
      // Version detection is best-effort
    }
    return undefined;
  }
}
