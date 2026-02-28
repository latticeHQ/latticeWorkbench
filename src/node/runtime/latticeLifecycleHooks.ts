import { isSSHRuntime } from "@/common/types/runtime";
import { Err, Ok, type Result } from "@/common/types/result";
import type { LatticeService, MinionStatusResult } from "@/node/services/latticeService";
import { log } from "@/node/services/log";
import type {
  AfterUnarchiveHook,
  BeforeArchiveHook,
} from "@/node/services/minionLifecycleHooks";

const DEFAULT_STOP_TIMEOUT_MS = 60_000;
const DEFAULT_START_TIMEOUT_MS = 60_000;
const DEFAULT_STATUS_TIMEOUT_MS = 10_000;

const DEFAULT_STOPPING_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_STOPPING_POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlreadyStoppedOrGone(status: MinionStatusResult): boolean {
  if (status.kind === "not_found") {
    return true;
  }

  if (status.kind !== "ok") {
    return false;
  }

  // "stopping" is treated as "good enough" for archive — we don't want to block the user on a
  // long tail stop operation when the minion is already on its way down.
  return (
    status.status === "stopped" ||
    status.status === "stopping" ||
    status.status === "deleted" ||
    status.status === "deleting"
  );
}

function isAlreadyRunningOrStarting(status: MinionStatusResult): boolean {
  if (status.kind !== "ok") {
    return false;
  }

  return status.status === "running" || status.status === "starting";
}

export function createStopLatticeOnArchiveHook(options: {
  latticeService: LatticeService;
  shouldStopOnArchive: () => boolean;
  timeoutMs?: number;
}): BeforeArchiveHook {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;

  return async ({ minionId, minionMetadata }): Promise<Result<void>> => {
    // Config default is ON (undefined behaves true).
    if (!options.shouldStopOnArchive()) {
      return Ok(undefined);
    }

    const runtimeConfig = minionMetadata.runtimeConfig;
    if (!isSSHRuntime(runtimeConfig) || !runtimeConfig.lattice) {
      return Ok(undefined);
    }

    const lattice = runtimeConfig.lattice;

    // Important safety invariant:
    // Only stop Lattice minions that lattice created (dedicated minions). If the user connected
    // lattice to an existing Lattice minion, archiving in lattice should *not* stop their environment.
    if (lattice.existingMinion === true) {
      return Ok(undefined);
    }

    const minionName = lattice.minionName?.trim();
    if (!minionName) {
      return Ok(undefined);
    }

    // Best-effort: skip the stop call if the control-plane already thinks the minion is down.
    const status = await options.latticeService.getMinionStatus(minionName, {
      timeoutMs: DEFAULT_STATUS_TIMEOUT_MS,
    });

    if (isAlreadyStoppedOrGone(status)) {
      return Ok(undefined);
    }

    log.debug("Stopping Lattice minion before lattice archive", {
      minionId,
      latticeMinionName: minionName,
      statusKind: status.kind,
      status: status.kind === "ok" ? status.status : undefined,
    });

    const stopResult = await options.latticeService.stopMinion(minionName, { timeoutMs });
    if (!stopResult.success) {
      return Err(`Failed to stop Lattice minion "${minionName}": ${stopResult.error}`);
    }

    return Ok(undefined);
  };
}

export function createStartLatticeOnUnarchiveHook(options: {
  latticeService: LatticeService;
  shouldStopOnArchive: () => boolean;
  timeoutMs?: number;
  stoppingWaitTimeoutMs?: number;
  stoppingPollIntervalMs?: number;
}): AfterUnarchiveHook {
  const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;

  return async ({ minionId, minionMetadata }): Promise<Result<void>> => {
    // Config default is ON (undefined behaves true).
    if (!options.shouldStopOnArchive()) {
      return Ok(undefined);
    }

    const runtimeConfig = minionMetadata.runtimeConfig;
    if (!isSSHRuntime(runtimeConfig) || !runtimeConfig.lattice) {
      return Ok(undefined);
    }

    const lattice = runtimeConfig.lattice;

    // Important safety invariant:
    // Only start Lattice minions that lattice created (dedicated minions). If the user connected
    // lattice to an existing Lattice minion, unarchiving in lattice should *not* start their environment.
    if (lattice.existingMinion === true) {
      return Ok(undefined);
    }

    const minionName = lattice.minionName?.trim();
    if (!minionName) {
      return Ok(undefined);
    }

    let status = await options.latticeService.getMinionStatus(minionName, {
      timeoutMs: DEFAULT_STATUS_TIMEOUT_MS,
    });

    // Unarchive can happen immediately after archive, while the Lattice minion is still
    // transitioning through "stopping". Starting during that transition can fail, so we
    // best-effort poll briefly until it reaches a terminal state.
    if (status.kind === "ok" && status.status === "stopping") {
      const waitTimeoutMs = options.stoppingWaitTimeoutMs ?? DEFAULT_STOPPING_WAIT_TIMEOUT_MS;
      const pollIntervalMs = options.stoppingPollIntervalMs ?? DEFAULT_STOPPING_POLL_INTERVAL_MS;
      const deadlineMs = Date.now() + waitTimeoutMs;

      log.debug(
        "Lattice minion is still stopping after lattice unarchive; waiting briefly before starting",
        {
          minionId,
          latticeMinionName: minionName,
          waitTimeoutMs,
          pollIntervalMs,
        }
      );

      while (status.kind === "ok" && status.status === "stopping") {
        const remainingMs = deadlineMs - Date.now();
        if (remainingMs <= 0) {
          break;
        }

        await sleep(Math.min(pollIntervalMs, remainingMs));

        const statusRemainingMs = deadlineMs - Date.now();
        if (statusRemainingMs <= 0) {
          break;
        }

        status = await options.latticeService.getMinionStatus(minionName, {
          timeoutMs: Math.min(DEFAULT_STATUS_TIMEOUT_MS, statusRemainingMs),
        });
      }

      if (status.kind === "ok" && status.status === "stopping") {
        log.debug("Timed out waiting for Lattice minion to stop after lattice unarchive", {
          minionId,
          latticeMinionName: minionName,
          waitTimeoutMs,
        });
        return Ok(undefined);
      }
    }

    // If the minion is gone, that's "good enough" — there's nothing to start.
    if (status.kind === "not_found") {
      return Ok(undefined);
    }

    if (status.kind === "error") {
      log.debug("Skipping Lattice minion start after lattice unarchive due to status check error", {
        minionId,
        latticeMinionName: minionName,
        error: status.error,
      });
      return Ok(undefined);
    }

    // Best-effort: don't start if the control-plane already thinks the minion is coming up.
    if (isAlreadyRunningOrStarting(status)) {
      return Ok(undefined);
    }

    // Only start when the minion is definitively stopped.
    if (status.status !== "stopped") {
      return Ok(undefined);
    }

    log.debug("Starting Lattice minion after lattice unarchive", {
      minionId,
      latticeMinionName: minionName,
      status: status.status,
    });

    const startResult = await options.latticeService.startMinion(minionName, { timeoutMs });
    if (!startResult.success) {
      return Err(`Failed to start Lattice minion "${minionName}": ${startResult.error}`);
    }

    return Ok(undefined);
  };
}
