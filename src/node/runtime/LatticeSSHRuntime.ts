/**
 * LatticeSSHRuntime - SSH runtime wrapper for Lattice minions.
 *
 * Extends SSHRuntime to add Lattice-specific provisioning via postCreateSetup():
 * - Creates Lattice minion (if not connecting to existing)
 * - Runs `lattice config-ssh --yes` to set up SSH proxy
 *
 * This ensures lattice minion metadata is persisted before the long-running
 * Lattice build starts, allowing build logs to stream to init logs (like Docker).
 */

import type {
  RuntimeCreateFlags,
  MinionCreationParams,
  MinionCreationResult,
  MinionForkParams,
  MinionForkResult,
  MinionInitParams,
  EnsureReadyOptions,
  EnsureReadyResult,
  RuntimeStatusEvent,
} from "./Runtime";
import { SSHRuntime, type SSHRuntimeConfig } from "./SSHRuntime";
import type { SSHTransport } from "./transports";
import type { LatticeMinionConfig, RuntimeConfig } from "@/common/types/runtime";
import { isSSHRuntime } from "@/common/types/runtime";
import type { LatticeService } from "@/node/services/latticeService";
import type { Result } from "@/common/types/result";
import { Ok, Err } from "@/common/types/result";
import { log } from "@/node/services/log";
import { execBuffered } from "@/node/utils/runtime/helpers";
import { expandTildeForSSH } from "./tildeExpansion";
import * as path from "path";
import { getErrorMessage } from "@/common/utils/errors";

export interface LatticeSSHRuntimeConfig extends SSHRuntimeConfig {
  /** Lattice-specific configuration */
  lattice: LatticeMinionConfig;
}

/**
 * Lattice minion name regex: ^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$
 * - Must start with alphanumeric
 * - Can contain hyphens, but only between alphanumeric segments
 * - No underscores (unlike lattice minion names)
 */
const LATTICE_NAME_REGEX = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

/**
 * Transform a lattice minion name to be Lattice-compatible.
 * - Replace underscores with hyphens
 * - Remove leading/trailing hyphens
 * - Collapse multiple consecutive hyphens
 */
function toLatticeCompatibleName(name: string): string {
  return name
    .replace(/_/g, "-") // Replace underscores with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .replace(/-{2,}/g, "-"); // Collapse multiple hyphens
}

const LATTICE_INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;
const LATTICE_ENSURE_READY_TIMEOUT_MS = 120_000;
const LATTICE_STATUS_POLL_INTERVAL_MS = 2_000;

/**
 * SSH runtime that handles Lattice minion provisioning.
 *
 * IMPORTANT: This extends SSHRuntime (rather than delegating) so other backend
 * code that checks `runtime instanceof SSHRuntime` (PTY, tools, path handling)
 * continues to behave correctly for Lattice minions.
 */
export class LatticeSSHRuntime extends SSHRuntime {
  private latticeConfig: LatticeMinionConfig;
  private readonly latticeService: LatticeService;

  /**
   * Timestamp of last time we (a) successfully used the runtime or (b) decided not
   * to block the user (unknown Lattice CLI error).
   * Used to avoid running expensive status checks on every message while still
   * catching auto-stopped minions after long inactivity.
   */
  private lastActivityAtMs = 0;

  /**
   * Flags for MinionService to customize create flow:
   * - deferredRuntimeAccess: skip srcBaseDir resolution (Lattice host doesn't exist yet)
   * - configLevelCollisionDetection: use config-based collision check (can't reach host)
   */
  readonly createFlags: RuntimeCreateFlags = {
    deferredRuntimeAccess: true,
    configLevelCollisionDetection: true,
  };

  constructor(
    config: LatticeSSHRuntimeConfig,
    transport: SSHTransport,
    latticeService: LatticeService,
    options?: {
      projectPath?: string;
      minionName?: string;
    }
  ) {
    if (!config || !latticeService || !transport) {
      throw new Error("LatticeSSHRuntime requires config, transport, and latticeService");
    }

    const baseConfig: SSHRuntimeConfig = {
      host: config.host,
      srcBaseDir: config.srcBaseDir,
      bgOutputDir: config.bgOutputDir,
      identityFile: config.identityFile,
      port: config.port,
    };

    super(baseConfig, transport, options);
    this.latticeConfig = config.lattice;
    this.latticeService = latticeService;
  }

  /** In-flight ensureReady promise to avoid duplicate start/wait sequences */
  private ensureReadyPromise: Promise<EnsureReadyResult> | null = null;

  /**
   * Check if runtime is ready for use.
   *
   * Behavior:
   * - If creation failed during postCreateSetup(), fail fast.
   * - If minion is running: return ready.
   * - If minion is stopped: auto-start and wait (blocking, ~120s timeout).
   * - If minion is stopping: poll until stopped, then start.
   * - Emits runtime-status events via statusSink for UX feedback.
   *
   * Concurrency: shares an in-flight promise to avoid duplicate start sequences.
   */
  override async ensureReady(options?: EnsureReadyOptions): Promise<EnsureReadyResult> {
    const minionName = this.latticeConfig.minionName;
    if (!minionName) {
      return {
        ready: false,
        error: "Lattice minion name not set",
        errorType: "runtime_not_ready",
      };
    }

    const now = Date.now();

    // Fast path: recently active, skip expensive status check
    if (
      this.lastActivityAtMs !== 0 &&
      now - this.lastActivityAtMs < LATTICE_INACTIVITY_THRESHOLD_MS
    ) {
      return { ready: true };
    }

    // Avoid duplicate concurrent start/wait sequences
    if (this.ensureReadyPromise) {
      return this.ensureReadyPromise;
    }

    this.ensureReadyPromise = this.doEnsureReady(minionName, options);
    try {
      return await this.ensureReadyPromise;
    } finally {
      this.ensureReadyPromise = null;
    }
  }

  /**
   * Core ensureReady logic - called once (protected by ensureReadyPromise).
   *
   * Flow:
   * 1. Check status via `lattice list` - short-circuit for "running" or "not_found"
   * 2. If "stopping"/"canceling": poll until it clears (lattice ssh can't autostart during these)
   * 3. Run `lattice ssh --wait=yes -- true` which handles everything else:
   *    - stopped: auto-starts, streams build logs, waits for startup scripts
   *    - starting/pending: waits for build completion + startup scripts
   */
  private async doEnsureReady(
    minionName: string,
    options?: EnsureReadyOptions
  ): Promise<EnsureReadyResult> {
    const statusSink = options?.statusSink;
    const signal = options?.signal;
    const startTime = Date.now();

    const emitStatus = (phase: RuntimeStatusEvent["phase"], detail?: string) => {
      statusSink?.({ phase, runtimeType: "ssh", detail });
    };

    // Helper: check if we've exceeded overall timeout
    const isTimedOut = () => Date.now() - startTime > LATTICE_ENSURE_READY_TIMEOUT_MS;
    const remainingMs = () => Math.max(0, LATTICE_ENSURE_READY_TIMEOUT_MS - (Date.now() - startTime));

    // Step 1: Check current status for short-circuits
    emitStatus("checking");

    if (signal?.aborted) {
      emitStatus("error");
      return { ready: false, error: "Aborted", errorType: "runtime_start_failed" };
    }

    let statusResult = await this.latticeService.getMinionStatus(minionName, {
      timeoutMs: Math.min(remainingMs(), 10_000),
      signal,
    });

    // Short-circuit: already running
    if (statusResult.kind === "ok" && statusResult.status === "running") {
      const repoCheck = await this.checkMinionRepo(options);
      if (repoCheck && !repoCheck.ready) {
        emitStatus("error", repoCheck.error);
        return repoCheck;
      }

      this.lastActivityAtMs = Date.now();
      emitStatus("ready");
      return { ready: true };
    }

    // Short-circuit: minion doesn't exist
    if (statusResult.kind === "not_found") {
      emitStatus("error");
      return {
        ready: false,
        error: `Lattice minion "${minionName}" not found`,
        errorType: "runtime_not_ready",
      };
    }

    // For status check errors (timeout, auth issues), proceed optimistically
    // and let SSH fail naturally to avoid blocking the happy path
    if (statusResult.kind === "error") {
      if (signal?.aborted) {
        emitStatus("error");
        return { ready: false, error: "Aborted", errorType: "runtime_start_failed" };
      }
      log.debug("Lattice minion status unknown, proceeding optimistically", {
        minionName,
        error: statusResult.error,
      });
    }

    // Step 2: Wait for "stopping"/"canceling" to clear (lattice ssh can't autostart during these)
    if (
      statusResult.kind === "ok" &&
      (statusResult.status === "stopping" || statusResult.status === "canceling")
    ) {
      emitStatus("waiting", "Waiting for Lattice minion to stop...");

      while (
        statusResult.kind === "ok" &&
        (statusResult.status === "stopping" || statusResult.status === "canceling") &&
        !isTimedOut()
      ) {
        if (signal?.aborted) {
          emitStatus("error");
          return { ready: false, error: "Aborted", errorType: "runtime_start_failed" };
        }

        await this.sleep(LATTICE_STATUS_POLL_INTERVAL_MS, signal);
        statusResult = await this.latticeService.getMinionStatus(minionName, {
          timeoutMs: Math.min(remainingMs(), 10_000),
          signal,
        });

        // Check for state changes during polling
        if (statusResult.kind === "ok" && statusResult.status === "running") {
          // Ensure setup failures (missing repo) surface before marking ready.
          const repoCheck = await this.checkMinionRepo(options);
          if (repoCheck && !repoCheck.ready) {
            emitStatus("error", repoCheck.error);
            return repoCheck;
          }

          this.lastActivityAtMs = Date.now();
          emitStatus("ready");
          return { ready: true };
        }
        if (statusResult.kind === "not_found") {
          emitStatus("error");
          return {
            ready: false,
            error: `Lattice minion "${minionName}" not found`,
            errorType: "runtime_not_ready",
          };
        }
      }

      if (isTimedOut()) {
        emitStatus("error");
        return {
          ready: false,
          error: "Lattice minion is still stopping... Please retry shortly.",
          errorType: "runtime_start_failed",
        };
      }
    }

    // Step 3: Use lattice ssh --wait=yes to handle all other states
    // This auto-starts stopped minions and waits for startup scripts
    emitStatus("starting", "Connecting to Lattice minion...");
    log.debug("Connecting to Lattice minion via SSH", { minionName });

    // Create abort signal that fires on timeout or user abort
    const controller = new AbortController();

    const checkInterval = setInterval(() => {
      if (isTimedOut() || signal?.aborted) {
        controller.abort();
        clearInterval(checkInterval);
      }
    }, 1000);
    controller.signal.addEventListener("abort", () => clearInterval(checkInterval), {
      once: true,
    });
    if (isTimedOut() || signal?.aborted) controller.abort();

    try {
      for await (const _line of this.latticeService.waitForStartupScripts(
        minionName,
        controller.signal
      )) {
        // Consume output for timeout/abort handling
      }

      const repoCheck = await this.checkMinionRepo(options);
      if (repoCheck && !repoCheck.ready) {
        emitStatus("error", repoCheck.error);
        return repoCheck;
      }

      this.lastActivityAtMs = Date.now();
      emitStatus("ready");
      return { ready: true };
    } catch (error) {
      const errorMsg = getErrorMessage(error);

      emitStatus("error");

      if (isTimedOut()) {
        return {
          ready: false,
          error: "Lattice minion start timed out",
          errorType: "runtime_start_failed",
        };
      }

      if (signal?.aborted) {
        return { ready: false, error: "Aborted", errorType: "runtime_start_failed" };
      }

      // Map "not found" errors to runtime_not_ready
      if (/not found|no access/i.test(errorMsg)) {
        return {
          ready: false,
          error: `Lattice minion "${minionName}" not found`,
          errorType: "runtime_not_ready",
        };
      }

      return {
        ready: false,
        error: `Failed to connect to Lattice minion: ${errorMsg}`,
        errorType: "runtime_start_failed",
      };
    } finally {
      clearInterval(checkInterval);
    }
  }

  /** Promise-based sleep helper */
  private sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
    if (abortSignal?.aborted) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      };

      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Finalize runtime config after collision handling.
   * Derives Lattice minion name from branch name and computes SSH host.
   */
  async finalizeConfig(
    finalBranchName: string,
    config: RuntimeConfig
  ): Promise<Result<RuntimeConfig, string>> {
    if (!isSSHRuntime(config) || !config.lattice) {
      return Ok(config);
    }

    const lattice = config.lattice;
    let minionName = lattice.minionName?.trim() ?? "";

    if (!lattice.existingMinion) {
      // New minion: derive name from lattice minion name if not provided
      if (!minionName) {
        minionName = `lattice-${finalBranchName}`;
      }
      // Transform to Lattice-compatible name (handles underscores, etc.)
      minionName = toLatticeCompatibleName(minionName);

      // Validate against Lattice's regex
      if (!LATTICE_NAME_REGEX.test(minionName)) {
        return Err(
          `Minion name "${finalBranchName}" cannot be converted to a valid Lattice name. ` +
            `Use only letters, numbers, and hyphens.`
        );
      }
    } else {
      // Existing minion: name must be provided (selected from dropdown)
      if (!minionName) {
        return Err("Lattice minion name is required for existing minions");
      }
    }

    // Final validation
    if (!minionName) {
      return Err("Lattice minion name is required");
    }

    let hostnameSuffix: string;
    try {
      // Keep a provisioning session around for new minions so we can reuse the same token
      // when fetching template parameters during postCreateSetup.
      const session = lattice.existingMinion
        ? undefined
        : await this.latticeService.ensureProvisioningSession(minionName);
      const sshConfig = await this.latticeService.fetchDeploymentSshConfig(session);
      hostnameSuffix = sshConfig.hostnameSuffix;
    } catch (error) {
      if (!lattice.existingMinion) {
        await this.latticeService.disposeProvisioningSession(minionName);
      }
      const message = getErrorMessage(error);
      return Err(
        `Failed to read Lattice deployment SSH config. ` +
          `Make sure you're logged in with the Lattice CLI. ` +
          `(${message})`
      );
    }

    return Ok({
      ...config,
      host: `${minionName}.${hostnameSuffix}`,
      lattice: { ...lattice, minionName },
    });
  }

  /**
   * Validate before persisting minion metadata.
   * Checks if a Lattice minion with this name already exists.
   */
  async validateBeforePersist(
    _finalBranchName: string,
    config: RuntimeConfig
  ): Promise<Result<void, string>> {
    if (!isSSHRuntime(config) || !config.lattice) {
      return Ok(undefined);
    }

    // Skip for "existing" mode - user explicitly selected an existing minion
    if (config.lattice.existingMinion) {
      return Ok(undefined);
    }

    const minionName = config.lattice.minionName;
    if (!minionName) {
      return Ok(undefined);
    }

    const exists = await this.latticeService.minionExists(minionName);

    if (exists) {
      await this.latticeService.disposeProvisioningSession(minionName);
      return Err(
        `A Lattice minion named "${minionName}" already exists. ` +
          `Either switch to "Existing" mode to use it, delete/rename it in Lattice, ` +
          `or choose a different lattice minion name.`
      );
    }

    return Ok(undefined);
  }

  /**
   * Create minion (fast path only - no SSH needed).
   * The Lattice minion may not exist yet, so we can't reach the SSH host.
   * Just compute the minion path locally.
   */
  override createMinion(params: MinionCreationParams): Promise<MinionCreationResult> {
    const minionPath = this.getMinionPath(params.projectPath, params.directoryName);

    params.initLogger.logStep("Minion path computed (Lattice provisioning will follow)");

    return Promise.resolve({
      success: true,
      minionPath,
    });
  }

  /**
   * Delete minion: removes SSH files AND deletes Lattice minion (if Lattice-managed).
   *
   * IMPORTANT: Only delete the Lattice minion once we're confident lattice will commit
   * the deletion. In the non-force path, MinionService.remove() aborts and keeps
   * minion metadata when runtime.deleteMinion() fails.
   */
  override async deleteMinion(
    projectPath: string,
    minionName: string,
    force: boolean,
    abortSignal?: AbortSignal
  ): Promise<{ success: true; deletedPath: string } | { success: false; error: string }> {
    // Deleting a Lattice minion is dangerous; LatticeService refuses to delete minions
    // without the lattice- prefix to avoid accidentally deleting user-owned Lattice minions.

    // If this minion is an existing Lattice minion that lattice didn't create, just do SSH cleanup.
    if (this.latticeConfig.existingMinion) {
      return super.deleteMinion(projectPath, minionName, force, abortSignal);
    }

    const latticeMinionName = this.latticeConfig.minionName;

    if (!latticeMinionName) {
      log.warn("Lattice minion name not set, falling back to SSH-only deletion");
      return super.deleteMinion(projectPath, minionName, force, abortSignal);
    }

    // For force deletes ("cancel creation"), skip SSH cleanup and focus on deleting the
    // underlying Lattice minion. During provisioning, the SSH host may not be reachable yet.
    if (force) {
      const deleteResult = await this.latticeService.deleteMinionEventually(latticeMinionName, {
        timeoutMs: 60_000,
        signal: abortSignal,
        // Avoid races where lattice create finishes server-side after we abort the local CLI.
        waitForExistence: true,
        // If the minion never appears on the server within 10s, assume it was never created
        // and return early instead of waiting the full 60s timeout.
        waitForExistenceTimeoutMs: 10_000,
      });

      if (!deleteResult.success) {
        return { success: false, error: `Failed to delete Lattice minion: ${deleteResult.error}` };
      }

      return { success: true, deletedPath: this.getMinionPath(projectPath, minionName) };
    }

    // Check if Lattice minion still exists before attempting SSH operations.
    // If it's already gone, skip SSH cleanup (would hang trying to connect to non-existent host).
    const statusResult = await this.latticeService.getMinionStatus(latticeMinionName);
    if (statusResult.kind === "not_found") {
      log.debug("Lattice minion already deleted, skipping SSH cleanup", { latticeMinionName });
      return { success: true, deletedPath: this.getMinionPath(projectPath, minionName) };
    }
    if (statusResult.kind === "error") {
      // API errors (auth, network): fall through to SSH cleanup, let it fail naturally
      log.warn("Could not check Lattice minion status, proceeding with SSH cleanup", {
        latticeMinionName,
        error: statusResult.error,
      });
    }
    if (statusResult.kind === "ok") {
      // If the minion is stopped, avoid SSH entirely.
      //
      // IMPORTANT tradeoff: This intentionally skips the dirty/unpushed checks performed by
      // SSHRuntime.deleteMinion(). Any SSH connection can auto-start a stopped Lattice
      // minion, which is surprising during deletion.
      if (statusResult.status === "stopped") {
        if (abortSignal?.aborted && !force) {
          return { success: false, error: "Delete operation aborted" };
        }

        try {
          log.debug("Lattice minion is stopped; deleting without SSH cleanup", {
            latticeMinionName,
          });
          const deleteResult = await this.latticeService.deleteMinionEventually(
            latticeMinionName,
            {
              timeoutMs: 60_000,
              signal: abortSignal,
              waitForExistence: false,
            }
          );

          if (!deleteResult.success) {
            return {
              success: false,
              error: `Failed to delete Lattice minion: ${deleteResult.error}`,
            };
          }

          return {
            success: true,
            deletedPath: this.getMinionPath(projectPath, minionName),
          };
        } catch (error) {
          const message = getErrorMessage(error);
          log.error("Failed to delete stopped Lattice minion", {
            latticeMinionName,
            error: message,
          });
          return { success: false, error: `Failed to delete Lattice minion: ${message}` };
        }
      }

      // Minion is being deleted or already deleted - skip SSH (would hang connecting to dying host)
      if (statusResult.status === "deleted" || statusResult.status === "deleting") {
        log.debug("Lattice minion is deleted/deleting, skipping SSH cleanup", {
          latticeMinionName,
          status: statusResult.status,
        });
        return { success: true, deletedPath: this.getMinionPath(projectPath, minionName) };
      }
    }

    const sshResult = await super.deleteMinion(projectPath, minionName, force, abortSignal);

    // In the normal (force=false) delete path, only delete the Lattice minion if the SSH delete
    // succeeded. If SSH delete failed (e.g., dirty minion), MinionService.remove() keeps the
    // minion metadata and the user can retry.
    if (!sshResult.success && !force) {
      return sshResult;
    }

    try {
      log.debug(`Deleting Lattice minion "${latticeMinionName}"`);
      const deleteResult = await this.latticeService.deleteMinionEventually(latticeMinionName, {
        timeoutMs: 60_000,
        signal: abortSignal,
        waitForExistence: false,
      });

      if (!deleteResult.success) {
        throw new Error(deleteResult.error);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      log.error("Failed to delete Lattice minion", {
        latticeMinionName,
        error: message,
      });

      if (sshResult.success) {
        return {
          success: false,
          error: `SSH delete succeeded, but failed to delete Lattice minion: ${message}`,
        };
      }

      return {
        success: false,
        error: `SSH delete failed: ${sshResult.error}; Lattice delete also failed: ${message}`,
      };
    }

    return sshResult;
  }

  /**
   * Fork minion: delegates to SSHRuntime, but marks both source and fork
   * as existingMinion=true so neither can delete the shared Lattice minion.
   *
   * IMPORTANT: Also updates this instance's latticeConfig so that if postCreateSetup
   * runs on this same runtime instance (for the forked minion), it won't attempt
   * to create a new Lattice minion.
   */
  override async forkMinion(params: MinionForkParams): Promise<MinionForkResult> {
    const result = await super.forkMinion(params);
    // Lattice tasks must share the parent's VM - don't fall back to creating a new one
    if (!result.success) return { ...result, failureIsFatal: true };

    // Both minions now share the Lattice minion - mark as existing so
    // deleting either lattice minion won't destroy the underlying Lattice minion
    const sharedLatticeConfig = { ...this.latticeConfig, existingMinion: true };

    // Update this instance's config so postCreateSetup() skips lattice create
    this.latticeConfig = sharedLatticeConfig;

    const sshConfig = this.getConfig();
    const sharedRuntimeConfig = { type: "ssh" as const, ...sshConfig, lattice: sharedLatticeConfig };

    return {
      ...result,
      forkedRuntimeConfig: sharedRuntimeConfig,
      sourceRuntimeConfig: sharedRuntimeConfig,
    };
  }

  /**
   * Post-create setup: provision Lattice minion and configure SSH.
   * This runs after lattice persists minion metadata, so build logs stream to UI.
   */
  async postCreateSetup(params: MinionInitParams): Promise<void> {
    const { initLogger, abortSignal } = params;

    // Create Lattice minion if not connecting to an existing one
    if (!this.latticeConfig.existingMinion) {
      // Validate required fields (minionName is set by finalizeConfig during minion creation)
      const latticeMinionName = this.latticeConfig.minionName;
      if (!latticeMinionName) {
        throw new Error("Lattice minion name is required (should be set by finalizeConfig)");
      }
      if (!this.latticeConfig.template) {
        await this.latticeService.disposeProvisioningSession(latticeMinionName);
        throw new Error("Lattice template is required for new minions");
      }

      initLogger.logStep(`Creating Lattice minion "${latticeMinionName}"...`);

      const provisioningSession = this.latticeService.takeProvisioningSession(latticeMinionName);

      try {
        for await (const line of this.latticeService.createMinion(
          latticeMinionName,
          this.latticeConfig.template,
          this.latticeConfig.preset,
          abortSignal,
          this.latticeConfig.templateOrg,
          provisioningSession
        )) {
          initLogger.logStdout(line);
        }
        initLogger.logStep("Lattice minion created successfully");

        // Wait for startup scripts to complete
        initLogger.logStep("Waiting for startup scripts...");
        for await (const line of this.latticeService.waitForStartupScripts(
          latticeMinionName,
          abortSignal
        )) {
          initLogger.logStdout(line);
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        log.error("Failed to create Lattice minion", { error, config: this.latticeConfig });
        initLogger.logStderr(`Failed to create Lattice minion: ${errorMsg}`);
        throw new Error(`Failed to create Lattice minion: ${errorMsg}`);
      } finally {
        if (provisioningSession) {
          await provisioningSession.dispose();
        }
      }
    } else if (this.latticeConfig.minionName) {
      // For existing minions, wait for "stopping"/"canceling" to clear before SSH
      // (lattice ssh --wait=yes can't autostart while a stop/cancel build is in progress)
      const minionName = this.latticeConfig.minionName;
      let status = await this.latticeService.getMinionStatus(minionName, {
        signal: abortSignal,
      });

      if (status.kind === "ok" && (status.status === "stopping" || status.status === "canceling")) {
        initLogger.logStep(`Waiting for Lattice minion "${minionName}" to stop...`);
        while (
          status.kind === "ok" &&
          (status.status === "stopping" || status.status === "canceling")
        ) {
          if (abortSignal?.aborted) {
            throw new Error("Aborted while waiting for Lattice minion to stop");
          }
          await this.sleep(LATTICE_STATUS_POLL_INTERVAL_MS, abortSignal);
          status = await this.latticeService.getMinionStatus(minionName, {
            signal: abortSignal,
          });
        }
      }

      // waitForStartupScripts (lattice ssh --wait=yes) handles all other states:
      // - stopped: auto-starts, streams build logs, waits for scripts
      // - starting/pending: waits for build + scripts
      // - running: waits for scripts (fast if already done)
      initLogger.logStep(`Connecting to Lattice minion "${minionName}"...`);
      try {
        for await (const line of this.latticeService.waitForStartupScripts(
          minionName,
          abortSignal
        )) {
          initLogger.logStdout(line);
        }
      } catch (error) {
        const errorMsg = getErrorMessage(error);
        log.error("Failed waiting for Lattice minion", { error, config: this.latticeConfig });
        initLogger.logStderr(`Failed connecting to Lattice minion: ${errorMsg}`);
        throw new Error(`Failed connecting to Lattice minion: ${errorMsg}`);
      }
    }

    // Ensure SSH config is set up for Lattice minions
    initLogger.logStep("Configuring SSH for Lattice...");
    try {
      await this.latticeService.ensureSSHConfig();
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      log.error("Failed to configure SSH for Lattice", { error });
      initLogger.logStderr(`Failed to configure SSH: ${errorMsg}`);
      throw new Error(`Failed to configure SSH for Lattice: ${errorMsg}`);
    }

    // Create parent directory for minion (git clone won't create it)
    // This must happen after ensureSSHConfig() so SSH is configured
    initLogger.logStep("Preparing minion directory...");
    const parentDir = path.posix.dirname(params.minionPath);
    const mkdirResult = await execBuffered(this, `mkdir -p ${expandTildeForSSH(parentDir)}`, {
      cwd: "/tmp",
      timeout: 10,
      abortSignal,
    });
    if (mkdirResult.exitCode !== 0) {
      const errorMsg = mkdirResult.stderr || mkdirResult.stdout || "Unknown error";
      log.error("Failed to summon minion parent directory", { parentDir, error: errorMsg });
      initLogger.logStderr(`Failed to prepare minion directory: ${errorMsg}`);
      throw new Error(`Failed to prepare minion directory: ${errorMsg}`);
    }

    this.lastActivityAtMs = Date.now();
  }
}
