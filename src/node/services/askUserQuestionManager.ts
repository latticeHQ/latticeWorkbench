import assert from "node:assert/strict";

import type { AskUserQuestionQuestion } from "@/common/types/tools";

export interface PendingAskUserQuestion {
  toolCallId: string;
  questions: AskUserQuestionQuestion[];
}

interface PendingAskUserQuestionInternal extends PendingAskUserQuestion {
  createdAt: number;
  resolve: (answers: Record<string, string>) => void;
  reject: (error: Error) => void;
}

export class AskUserQuestionManager {
  private pendingByMinion = new Map<string, Map<string, PendingAskUserQuestionInternal>>();

  registerPending(
    minionId: string,
    toolCallId: string,
    questions: AskUserQuestionQuestion[]
  ): Promise<Record<string, string>> {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");
    assert(Array.isArray(questions) && questions.length > 0, "questions must be a non-empty array");

    const minionMap = this.getOrCreateMinionMap(minionId);
    assert(
      !minionMap.has(toolCallId),
      `ask_user_question already pending for toolCallId=${toolCallId}`
    );

    return new Promise<Record<string, string>>((resolve, reject) => {
      const entry: PendingAskUserQuestionInternal = {
        toolCallId,
        questions,
        createdAt: Date.now(),
        resolve,
        reject,
      };

      minionMap.set(toolCallId, entry);
    }).finally(() => {
      // Ensure cleanup no matter how the promise resolves.
      this.deletePending(minionId, toolCallId);
    });
  }

  answer(minionId: string, toolCallId: string, answers: Record<string, string>): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");
    assert(answers && typeof answers === "object", "answers must be an object");

    const entry = this.getPending(minionId, toolCallId);
    entry.resolve(answers);
  }

  cancel(minionId: string, toolCallId: string, reason: string): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(toolCallId.length > 0, "toolCallId must be non-empty");
    assert(reason.length > 0, "reason must be non-empty");

    const entry = this.getPending(minionId, toolCallId);
    entry.reject(new Error(reason));
  }

  cancelAll(minionId: string, reason: string): void {
    assert(minionId.length > 0, "minionId must be non-empty");
    assert(reason.length > 0, "reason must be non-empty");

    const minionMap = this.pendingByMinion.get(minionId);
    if (!minionMap) {
      return;
    }

    for (const toolCallId of minionMap.keys()) {
      // cancel() will delete from map via finally cleanup
      this.cancel(minionId, toolCallId, reason);
    }
  }

  getLatestPending(minionId: string): PendingAskUserQuestion | null {
    assert(minionId.length > 0, "minionId must be non-empty");

    const minionMap = this.pendingByMinion.get(minionId);
    if (!minionMap || minionMap.size === 0) {
      return null;
    }

    let latest: PendingAskUserQuestionInternal | null = null;
    for (const entry of minionMap.values()) {
      if (!latest || entry.createdAt > latest.createdAt) {
        latest = entry;
      }
    }

    assert(latest !== null, "Expected latest pending entry to be non-null");

    return {
      toolCallId: latest.toolCallId,
      questions: latest.questions,
    };
  }

  private getOrCreateMinionMap(
    minionId: string
  ): Map<string, PendingAskUserQuestionInternal> {
    let minionMap = this.pendingByMinion.get(minionId);
    if (!minionMap) {
      minionMap = new Map();
      this.pendingByMinion.set(minionId, minionMap);
    }
    return minionMap;
  }

  private getPending(minionId: string, toolCallId: string): PendingAskUserQuestionInternal {
    const minionMap = this.pendingByMinion.get(minionId);
    assert(minionMap, `No pending ask_user_question entries for minionId=${minionId}`);

    const entry = minionMap.get(toolCallId);
    assert(entry, `No pending ask_user_question entry for toolCallId=${toolCallId}`);

    return entry;
  }

  private deletePending(minionId: string, toolCallId: string): void {
    const minionMap = this.pendingByMinion.get(minionId);
    if (!minionMap) {
      return;
    }

    minionMap.delete(toolCallId);
    if (minionMap.size === 0) {
      this.pendingByMinion.delete(minionId);
    }
  }
}

export const askUserQuestionManager = new AskUserQuestionManager();
