/* eslint-disable @typescript-eslint/unbound-method */
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import type { HistoryService } from "./historyService";
import type { Config } from "@/node/config";
import { createLatticeMessage, type LatticeMessage } from "@/common/types/message";
import { Ok } from "@/common/types/result";
import { createTestHistoryService } from "./testHistoryService";
import * as fs from "fs/promises";
import * as path from "path";

describe("HistoryService partial persistence - Error Recovery", () => {
  let partialService: HistoryService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ historyService: partialService, cleanup } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("commitPartial should strip error metadata and commit parts from errored partial", async () => {
    const minionId = "test-minion";
    const erroredPartial: LatticeMessage = {
      id: "msg-1",
      role: "assistant",
      metadata: {
        historySequence: 1,
        timestamp: Date.now(),
        model: "test-model",
        partial: true,
        error: "Stream error occurred",
        errorType: "network",
      },
      parts: [
        { type: "text", text: "Hello, I was processing when" },
        { type: "text", text: " the error occurred" },
      ],
    };

    // Mock readPartial to return errored partial
    partialService.readPartial = mock(() => Promise.resolve(erroredPartial));

    // Mock deletePartial
    partialService.deletePartial = mock(() => Promise.resolve(Ok(undefined)));

    // Spy on partialService methods to verify calls
    const appendSpy = spyOn(partialService, "appendToHistory");

    // Call commitPartial
    const result = await partialService.commitPartial(minionId);

    // Should succeed
    expect(result.success).toBe(true);

    // Should have called appendToHistory with cleaned metadata (no error/errorType)
    expect(appendSpy).toHaveBeenCalledTimes(1);
    const appendedMessage = appendSpy.mock.calls[0][1];

    expect(appendedMessage.id).toBe("msg-1");
    expect(appendedMessage.parts).toEqual(erroredPartial.parts);
    expect(appendedMessage.metadata?.error).toBeUndefined();
    expect(appendedMessage.metadata?.errorType).toBeUndefined();
    expect(appendedMessage.metadata?.historySequence).toBe(1);

    // Should have deleted the partial after committing
    const deletePartial = partialService.deletePartial as ReturnType<typeof mock>;
    expect(deletePartial).toHaveBeenCalledWith(minionId);
  });

  test("commitPartial should update existing placeholder when errored partial has more parts", async () => {
    const minionId = "test-minion";
    const erroredPartial: LatticeMessage = {
      id: "msg-1",
      role: "assistant",
      metadata: {
        historySequence: 1,
        timestamp: Date.now(),
        model: "test-model",
        partial: true,
        error: "Stream error occurred",
        errorType: "network",
      },
      parts: [
        { type: "text", text: "Accumulated content before error" },
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "bash",
          state: "input-available",
          input: { script: "echo test", timeout_secs: 10, display_name: "Test" },
        },
      ],
    };

    const existingPlaceholder: LatticeMessage = {
      id: "msg-1",
      role: "assistant",
      metadata: {
        historySequence: 1,
        timestamp: Date.now(),
        model: "test-model",
        partial: true,
      },
      parts: [], // Empty placeholder
    };

    // Mock readPartial to return errored partial
    partialService.readPartial = mock(() => Promise.resolve(erroredPartial));

    // Mock deletePartial
    partialService.deletePartial = mock(() => Promise.resolve(Ok(undefined)));

    // Seed existing placeholder into history so getHistoryFromLatestBoundary finds it
    await partialService.appendToHistory(minionId, existingPlaceholder);

    // Spy on partialService methods AFTER seeding to verify only commitPartial calls
    const appendSpy = spyOn(partialService, "appendToHistory");
    const updateSpy = spyOn(partialService, "updateHistory");

    // Call commitPartial
    const result = await partialService.commitPartial(minionId);

    // Should succeed
    expect(result.success).toBe(true);

    // Should have called updateHistory (not append) with cleaned metadata
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).not.toHaveBeenCalled();

    const updatedMessage = updateSpy.mock.calls[0][1];

    expect(updatedMessage.parts).toEqual(erroredPartial.parts);
    expect(updatedMessage.metadata?.error).toBeUndefined();
    expect(updatedMessage.metadata?.errorType).toBeUndefined();

    // Should have deleted the partial after updating
    const deletePartial = partialService.deletePartial as ReturnType<typeof mock>;
    expect(deletePartial).toHaveBeenCalledWith(minionId);
  });

  test("commitPartial should skip tool-only incomplete partials", async () => {
    const minionId = "test-minion";
    const toolOnlyPartial: LatticeMessage = {
      id: "msg-1",
      role: "assistant",
      metadata: {
        historySequence: 1,
        timestamp: Date.now(),
        model: "test-model",
        partial: true,
        error: "Stream interrupted",
        errorType: "network",
      },
      parts: [
        {
          type: "dynamic-tool",
          toolCallId: "call-1",
          toolName: "bash",
          state: "input-available",
          input: { script: "echo test", timeout_secs: 10, display_name: "Test" },
        },
      ],
    };

    partialService.readPartial = mock(() => Promise.resolve(toolOnlyPartial));
    partialService.deletePartial = mock(() => Promise.resolve(Ok(undefined)));

    // Spy on partialService methods to verify calls
    const appendSpy = spyOn(partialService, "appendToHistory");
    const updateSpy = spyOn(partialService, "updateHistory");

    const result = await partialService.commitPartial(minionId);
    expect(result.success).toBe(true);

    expect(appendSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();

    const deletePartial = partialService.deletePartial as ReturnType<typeof mock>;
    expect(deletePartial).toHaveBeenCalledWith(minionId);
  });
  test("commitPartial should skip empty errored partial", async () => {
    const minionId = "test-minion";
    const emptyErrorPartial: LatticeMessage = {
      id: "msg-1",
      role: "assistant",
      metadata: {
        historySequence: 1,
        timestamp: Date.now(),
        model: "test-model",
        partial: true,
        error: "Network error",
        errorType: "network",
      },
      parts: [], // Empty - no content accumulated before error
    };

    // Mock readPartial to return empty errored partial
    partialService.readPartial = mock(() => Promise.resolve(emptyErrorPartial));

    // Mock deletePartial
    partialService.deletePartial = mock(() => Promise.resolve(Ok(undefined)));

    // Spy on partialService methods to verify calls
    const appendSpy = spyOn(partialService, "appendToHistory");

    // Call commitPartial
    const result = await partialService.commitPartial(minionId);

    // Should succeed
    expect(result.success).toBe(true);

    // Should NOT call appendToHistory for empty message (no value to preserve)
    expect(appendSpy).not.toHaveBeenCalled();

    // Should still delete the partial (cleanup)
    const deletePartial = partialService.deletePartial as ReturnType<typeof mock>;
    expect(deletePartial).toHaveBeenCalledWith(minionId);
  });
});

describe("HistoryService partial persistence - Legacy compatibility", () => {
  let config: Config;
  let partialService: HistoryService;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ config, historyService: partialService, cleanup } = await createTestHistoryService());
  });

  afterEach(async () => {
    await cleanup();
  });

  test("readPartial upgrades legacy clatticeMetadata", async () => {
    const minionId = "legacy-ws";
    const minionDir = config.getSessionDir(minionId);
    await fs.mkdir(minionDir, { recursive: true });

    const partialMessage = createLatticeMessage("partial-1", "assistant", "legacy", {
      historySequence: 0,
    });
    (partialMessage.metadata as Record<string, unknown>).clatticeMetadata = { type: "normal" };

    const partialPath = path.join(minionDir, "partial.json");
    await fs.writeFile(partialPath, JSON.stringify(partialMessage));

    const result = await partialService.readPartial(minionId);
    expect(result?.metadata?.latticeMetadata?.type).toBe("normal");
  });
});
