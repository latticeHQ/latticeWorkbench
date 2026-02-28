import { describe, expect, it } from "bun:test";

import { createLatticeMessage } from "@/common/types/message";

import {
  findLatestCompactionBoundaryIndex,
  sliceMessagesFromLatestCompactionBoundary,
} from "./compactionBoundary";

describe("findLatestCompactionBoundaryIndex", () => {
  it("returns the newest compaction boundary via reverse scan", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-1", "assistant", "first summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "middle"),
      createLatticeMessage("summary-2", "assistant", "second summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 2,
      }),
      createLatticeMessage("u2", "user", "latest"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(3);
  });

  it("returns -1 when only legacy compacted summaries exist", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("legacy-summary", "assistant", "legacy summary", {
        compacted: "user",
      }),
      createLatticeMessage("u1", "user", "after"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(-1);
  });

  it("ignores boundary markers that are missing compactionEpoch", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-valid", "assistant", "valid summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "middle"),
      createLatticeMessage("summary-missing-epoch", "assistant", "malformed summary", {
        compacted: "user",
        compactionBoundary: true,
        // Corrupted/normalized persisted metadata: missing epoch must not be durable.
      }),
      createLatticeMessage("u2", "user", "after"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(1);
  });

  it("skips malformed boundary markers and keeps scanning for the latest durable boundary", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-valid", "assistant", "valid summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "middle"),
      createLatticeMessage("summary-malformed", "assistant", "malformed summary", {
        // Corrupted persisted metadata: looks like a boundary but is not a compacted summary.
        compacted: false,
        compactionBoundary: true,
        compactionEpoch: 2,
      }),
      createLatticeMessage("u2", "user", "after"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(1);
  });
  it("ignores boundary markers with malformed compacted values", () => {
    const malformedCompactedBoundary = createLatticeMessage(
      "summary-malformed-compacted",
      "assistant",
      "malformed summary",
      {
        compactionBoundary: true,
        compactionEpoch: 99,
      }
    );
    if (malformedCompactedBoundary.metadata) {
      (malformedCompactedBoundary.metadata as Record<string, unknown>).compacted = "corrupt";
    }

    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-valid", "assistant", "valid summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      malformedCompactedBoundary,
      createLatticeMessage("u1", "user", "after"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(1);
  });

  it("ignores user-role messages with boundary-like metadata", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-valid", "assistant", "valid summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "not-a-summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 2,
      }),
      createLatticeMessage("u2", "user", "after"),
    ];

    expect(findLatestCompactionBoundaryIndex(messages)).toBe(1);
  });
});

describe("sliceMessagesFromLatestCompactionBoundary", () => {
  it("slices request payload history from the latest compaction boundary", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-1", "assistant", "first summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "middle"),
      createLatticeMessage("summary-2", "assistant", "second summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 2,
      }),
      createLatticeMessage("u2", "user", "latest"),
      createLatticeMessage("a2", "assistant", "reply"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced.map((msg) => msg.id)).toEqual(["summary-2", "u2", "a2"]);
    expect(sliced[0]?.metadata?.compactionBoundary).toBe(true);
  });

  it("falls back to full history when no durable boundary exists", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("legacy-summary", "assistant", "legacy summary", {
        compacted: "user",
      }),
      createLatticeMessage("u1", "user", "after"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced).toBe(messages);
    expect(sliced.map((msg) => msg.id)).toEqual(["u0", "legacy-summary", "u1"]);
  });

  it("treats missing compactionEpoch boundary markers as non-boundaries", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-missing-epoch", "assistant", "malformed summary", {
        compacted: "user",
        compactionBoundary: true,
        // Schema normalization can drop malformed epochs to undefined.
      }),
      createLatticeMessage("u1", "user", "after"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced).toBe(messages);
    expect(sliced.map((msg) => msg.id)).toEqual(["u0", "summary-missing-epoch", "u1"]);
  });

  it("treats malformed compacted boundary markers as non-boundaries", () => {
    const malformedCompactedBoundary = createLatticeMessage(
      "summary-malformed-compacted",
      "assistant",
      "malformed summary",
      {
        compactionBoundary: true,
        compactionEpoch: 2,
      }
    );
    if (malformedCompactedBoundary.metadata) {
      (malformedCompactedBoundary.metadata as Record<string, unknown>).compacted = "corrupt";
    }

    const messages = [
      createLatticeMessage("u0", "user", "before"),
      malformedCompactedBoundary,
      createLatticeMessage("u1", "user", "after"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced).toBe(messages);
    expect(sliced.map((msg) => msg.id)).toEqual(["u0", "summary-malformed-compacted", "u1"]);
  });

  it("does not slice from user-role messages with boundary-like metadata", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-valid", "assistant", "valid summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 1,
      }),
      createLatticeMessage("u1", "user", "not-a-summary", {
        compacted: "user",
        compactionBoundary: true,
        compactionEpoch: 2,
      }),
      createLatticeMessage("a1", "assistant", "after"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced.map((msg) => msg.id)).toEqual(["summary-valid", "u1", "a1"]);
    expect(sliced[0]?.id).toBe("summary-valid");
  });

  it("treats malformed boundary markers as non-boundaries instead of crashing", () => {
    const messages = [
      createLatticeMessage("u0", "user", "before"),
      createLatticeMessage("summary-malformed", "assistant", "malformed summary", {
        compacted: "user",
        compactionBoundary: true,
        // Corrupted persisted metadata: invalid epoch should not brick request assembly.
        compactionEpoch: 0,
      }),
      createLatticeMessage("u1", "user", "after"),
    ];

    const sliced = sliceMessagesFromLatestCompactionBoundary(messages);

    expect(sliced).toBe(messages);
    expect(sliced.map((msg) => msg.id)).toEqual(["u0", "summary-malformed", "u1"]);
  });
});
