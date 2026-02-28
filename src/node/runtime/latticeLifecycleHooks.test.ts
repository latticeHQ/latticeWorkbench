import { describe, expect, it, mock } from "bun:test";
import {
  createStartLatticeOnUnarchiveHook,
  createStopLatticeOnArchiveHook,
} from "./latticeLifecycleHooks";
import { Ok } from "@/common/types/result";
import type { LatticeService, MinionStatusResult } from "@/node/services/latticeService";
import type { MinionMetadata } from "@/common/types/minion";

function createSshLatticeMetadata(overrides?: Partial<MinionMetadata>): MinionMetadata {
  return {
    id: "ws",
    name: "ws",
    projectName: "proj",
    projectPath: "/tmp/proj",
    runtimeConfig: {
      type: "ssh",
      host: "lattice://",
      srcBaseDir: "~/lattice",
      lattice: {
        minionName: "lattice-ws",
      },
    },
    ...overrides,
  };
}

describe("createStopLatticeOnArchiveHook", () => {
  it("does nothing when stop-on-archive is disabled", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "ok", status: "running" })
    );

    const stopMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      stopMinion,
    } as unknown as LatticeService;

    const hook = createStopLatticeOnArchiveHook({
      latticeService,
      shouldStopOnArchive: () => false,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata(),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(0);
    expect(stopMinion).toHaveBeenCalledTimes(0);
  });

  it("does nothing when connected to an existing Lattice minion", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "ok", status: "running" })
    );

    const stopMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      stopMinion,
    } as unknown as LatticeService;

    const hook = createStopLatticeOnArchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata({
        runtimeConfig: {
          type: "ssh",
          host: "lattice://",
          srcBaseDir: "~/lattice",
          lattice: { minionName: "lattice-ws", existingMinion: true },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(0);
    expect(stopMinion).toHaveBeenCalledTimes(0);
  });

  it("stops a running dedicated Lattice minion", async () => {
    const getMinionStatus = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<MinionStatusResult>
    >(() => Promise.resolve({ kind: "ok", status: "running" }));

    const stopMinion = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<ReturnType<typeof Ok>>
    >(() => Promise.resolve(Ok(undefined)));

    const latticeService = {
      getMinionStatus,
      stopMinion,
    } as unknown as LatticeService;

    const hook = createStopLatticeOnArchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
      timeoutMs: 1234,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata({
        runtimeConfig: {
          type: "ssh",
          host: "lattice://",
          srcBaseDir: "~/lattice",
          lattice: { minionName: "lattice-ws" },
        },
      }),
    });

    expect(result.success).toBe(true);

    expect(getMinionStatus).toHaveBeenCalledTimes(1);
    expect(getMinionStatus).toHaveBeenCalledWith("lattice-ws", expect.any(Object));

    const statusOptions = (getMinionStatus as ReturnType<typeof mock>).mock.calls[0]?.[1] as {
      timeoutMs?: number;
    };
    expect(typeof statusOptions.timeoutMs).toBe("number");
    expect(statusOptions.timeoutMs).toBeGreaterThan(0);

    expect(stopMinion).toHaveBeenCalledTimes(1);
    expect(stopMinion).toHaveBeenCalledWith("lattice-ws", { timeoutMs: 1234 });
  });
});

describe("createStartLatticeOnUnarchiveHook", () => {
  it("does nothing when stop-on-archive is disabled", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "ok", status: "stopped" })
    );

    const startMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => false,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata(),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(0);
    expect(startMinion).toHaveBeenCalledTimes(0);
  });

  it("does nothing when connected to an existing Lattice minion", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "ok", status: "stopped" })
    );

    const startMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata({
        runtimeConfig: {
          type: "ssh",
          host: "lattice://",
          srcBaseDir: "~/lattice",
          lattice: { minionName: "lattice-ws", existingMinion: true },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(0);
    expect(startMinion).toHaveBeenCalledTimes(0);
  });

  it("starts a stopped dedicated Lattice minion", async () => {
    const getMinionStatus = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<MinionStatusResult>
    >(() => Promise.resolve({ kind: "ok", status: "stopped" }));

    const startMinion = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<ReturnType<typeof Ok>>
    >(() => Promise.resolve(Ok(undefined)));

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
      timeoutMs: 1234,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata({
        runtimeConfig: {
          type: "ssh",
          host: "lattice://",
          srcBaseDir: "~/lattice",
          lattice: { minionName: "lattice-ws" },
        },
      }),
    });

    expect(result.success).toBe(true);

    expect(getMinionStatus).toHaveBeenCalledTimes(1);
    expect(getMinionStatus).toHaveBeenCalledWith("lattice-ws", expect.any(Object));

    const statusOptions = (getMinionStatus as ReturnType<typeof mock>).mock.calls[0]?.[1] as {
      timeoutMs?: number;
    };
    expect(typeof statusOptions.timeoutMs).toBe("number");
    expect(statusOptions.timeoutMs).toBeGreaterThan(0);

    expect(startMinion).toHaveBeenCalledTimes(1);
    expect(startMinion).toHaveBeenCalledWith("lattice-ws", { timeoutMs: 1234 });
  });

  it("waits for stopping minion to become stopped before starting", async () => {
    let pollCount = 0;
    const getMinionStatus = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<MinionStatusResult>
    >(() => {
      pollCount++;
      if (pollCount === 1) {
        return Promise.resolve({ kind: "ok", status: "stopping" });
      }
      return Promise.resolve({ kind: "ok", status: "stopped" });
    });

    const startMinion = mock<
      (minionName: string, options?: { timeoutMs?: number }) => Promise<ReturnType<typeof Ok>>
    >(() => Promise.resolve(Ok(undefined)));

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
      timeoutMs: 1234,
      stoppingPollIntervalMs: 0,
      stoppingWaitTimeoutMs: 1000,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata(),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(2);
    expect(startMinion).toHaveBeenCalledTimes(1);
    expect(startMinion).toHaveBeenCalledWith("lattice-ws", { timeoutMs: 1234 });
  });
  it("does nothing when minion is already running or starting", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "ok", status: "running" })
    );

    const startMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata(),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(1);
    expect(startMinion).toHaveBeenCalledTimes(0);
  });

  it("treats not_found status as success", async () => {
    const getMinionStatus = mock<(minionName: string) => Promise<MinionStatusResult>>(() =>
      Promise.resolve({ kind: "not_found" })
    );

    const startMinion = mock<(minionName: string) => Promise<ReturnType<typeof Ok>>>(() =>
      Promise.resolve(Ok(undefined))
    );

    const latticeService = {
      getMinionStatus,
      startMinion,
    } as unknown as LatticeService;

    const hook = createStartLatticeOnUnarchiveHook({
      latticeService,
      shouldStopOnArchive: () => true,
    });

    const result = await hook({
      minionId: "ws",
      minionMetadata: createSshLatticeMetadata(),
    });

    expect(result.success).toBe(true);
    expect(getMinionStatus).toHaveBeenCalledTimes(1);
    expect(startMinion).toHaveBeenCalledTimes(0);
  });
});
