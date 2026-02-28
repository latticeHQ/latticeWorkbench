import assert from "node:assert/strict";

export interface PendingDelegatedToolCall {
  toolCallId: string;
  toolName: string;
  createdAt: number;
}

interface PendingDelegatedToolCallInternal extends PendingDelegatedToolCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class DelegatedToolCallManager {
  private pendingByMinion = new Map<string, Map<string, PendingDelegatedToolCallInternal>>();

  registerPending(minionId: string, toolCallId: string, toolName: string): Promise<unknown> {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");
    assert(toolName.length > 0, "toolName must be non-empty");

    const minionMap = this.getOrCreateMinionMap(minionId);
    assert(
      !minionMap.has(toolCallId),
      `delegated tool call already pending for toolCallId=${toolCallId}`
    );

    return new Promise<unknown>((resolve, reject) => {
      minionMap.set(toolCallId, {
        toolCallId,
        toolName,
        createdAt: Date.now(),
        resolve,
        reject,
      });
    }).finally(() => {
      this.deletePending(minionId, toolCallId);
    });
  }

  answer(minionId: string, toolCallId: string, result: unknown): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");

    const pending = this.getPending(minionId, toolCallId);
    pending.resolve(result);
  }

  cancel(minionId: string, toolCallId: string, reason: string): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");
    assert(reason.length > 0, "reason must be non-empty");

    const pending = this.getPending(minionId, toolCallId);
    pending.reject(new Error(reason));
  }

  cancelAll(minionId: string, reason: string): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(reason.length > 0, "reason must be non-empty");

    const minionMap = this.pendingByMinion.get(minionId);
    if (minionMap == null) {
      return;
    }

    for (const toolCallId of minionMap.keys()) {
      this.cancel(minionId, toolCallId, reason);
    }
  }

  getLatestPending(minionId: string): PendingDelegatedToolCall | null {
    assert(minionId.length > 0, "minionId must be non-empty");

    const minionMap = this.pendingByMinion.get(minionId);
    if (minionMap == null || minionMap.size === 0) {
      return null;
    }

    let latest: PendingDelegatedToolCallInternal | null = null;
    for (const pending of minionMap.values()) {
      if (latest == null || pending.createdAt > latest.createdAt) {
        latest = pending;
      }
    }

    assert(latest != null, "Expected delegated pending entry to be non-null");
    return {
      toolCallId: latest.toolCallId,
      toolName: latest.toolName,
      createdAt: latest.createdAt,
    };
  }

  private getOrCreateMinionMap(
    minionId: string
  ): Map<string, PendingDelegatedToolCallInternal> {
    let minionMap = this.pendingByMinion.get(minionId);
    if (minionMap == null) {
      minionMap = new Map();
      this.pendingByMinion.set(minionId, minionMap);
    }

    return minionMap;
  }

  private getPending(minionId: string, toolCallId: string): PendingDelegatedToolCallInternal {
    const minionMap = this.pendingByMinion.get(minionId);
    assert(minionMap != null, `No delegated tool calls pending for minionId=${minionId}`);

    const pending = minionMap.get(toolCallId);
    assert(pending != null, `No delegated tool call pending for toolCallId=${toolCallId}`);

    return pending;
  }

  private deletePending(minionId: string, toolCallId: string): void {
    const minionMap = this.pendingByMinion.get(minionId);
    if (minionMap == null) {
      return;
    }

    minionMap.delete(toolCallId);
    if (minionMap.size === 0) {
      this.pendingByMinion.delete(minionId);
    }
  }
}

export const delegatedToolCallManager = new DelegatedToolCallManager();
