import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs/promises";
import * as path from "path";
import { EventStore } from "./eventStore";
import type { Config } from "@/node/config";

// Test types
interface TestState {
  id: string;
  value: number;
  items: string[];
}

interface TestEvent {
  type: "start" | "item" | "end";
  id: string;
  data?: string | number;
}

describe("EventStore", () => {
  const testSessionDir = path.join(__dirname, "../../test-sessions");
  const testMinionId = "test-minion-123";
  const testFilename = "test-state.json";

  let mockConfig: Config;
  let store: EventStore<TestState, TestEvent>;
  let emittedEvents: TestEvent[] = [];

  // Test serializer: converts state into events
  const serializeState = (state: TestState & { minionId?: string }): TestEvent[] => {
    const events: TestEvent[] = [];
    events.push({ type: "start", id: state.minionId ?? state.id, data: state.value });
    for (const item of state.items) {
      events.push({ type: "item", id: state.minionId ?? state.id, data: item });
    }
    events.push({ type: "end", id: state.minionId ?? state.id, data: state.items.length });
    return events;
  };

  // Test emitter: captures events
  const emitEvent = (event: TestEvent): void => {
    emittedEvents.push(event);
  };

  beforeEach(async () => {
    // Create test session directory
    try {
      await fs.access(testSessionDir);
    } catch {
      await fs.mkdir(testSessionDir, { recursive: true });
    }

    mockConfig = {
      latticeDir: path.join(__dirname, "../.."),
      sessionsDir: testSessionDir,
      getSessionDir: (minionId: string) => path.join(testSessionDir, minionId),
    } as unknown as Config;

    emittedEvents = [];

    store = new EventStore(mockConfig, testFilename, serializeState, emitEvent, "TestStore");
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.access(testSessionDir);
      await fs.rm(testSessionDir, { recursive: true, force: true });
    } catch {
      // Directory doesn't exist, nothing to clean up
    }
  });

  describe("State Management", () => {
    it("should store and retrieve in-memory state", () => {
      const state: TestState = { id: "test", value: 42, items: ["a", "b"] };

      store.setState(testMinionId, state);
      const retrieved = store.getState(testMinionId);

      expect(retrieved).toEqual(state);
    });

    it("should return undefined for non-existent state", () => {
      const retrieved = store.getState("non-existent");
      expect(retrieved).toBeUndefined();
    });

    it("should delete in-memory state", () => {
      const state: TestState = { id: "test", value: 42, items: [] };

      store.setState(testMinionId, state);
      expect(store.hasState(testMinionId)).toBe(true);

      store.deleteState(testMinionId);
      expect(store.hasState(testMinionId)).toBe(false);
      expect(store.getState(testMinionId)).toBeUndefined();
    });

    it("should check if state exists", () => {
      expect(store.hasState(testMinionId)).toBe(false);

      store.setState(testMinionId, { id: "test", value: 1, items: [] });
      expect(store.hasState(testMinionId)).toBe(true);
    });

    it("should get all active minion IDs", () => {
      store.setState("minion-1", { id: "1", value: 1, items: [] });
      store.setState("minion-2", { id: "2", value: 2, items: [] });

      const ids = store.getActiveMinionIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain("minion-1");
      expect(ids).toContain("minion-2");
    });
  });

  describe("Persistence", () => {
    it("should persist state to disk", async () => {
      const state: TestState = { id: "test", value: 99, items: ["x", "y", "z"] };

      await store.persist(testMinionId, state);

      // Verify file exists
      const minionDir = path.join(testSessionDir, testMinionId);
      const filePath = path.join(minionDir, testFilename);
      try {
        await fs.access(filePath);
      } catch {
        throw new Error(`File ${filePath} does not exist`);
      }

      // Verify content
      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as TestState;
      expect(parsed).toEqual(state);
    });

    it("should read persisted state from disk", async () => {
      const state: TestState = { id: "test", value: 123, items: ["foo", "bar"] };

      await store.persist(testMinionId, state);
      const retrieved = await store.readPersisted(testMinionId);

      expect(retrieved).toEqual(state);
    });

    it("should return null for non-existent persisted state", async () => {
      const retrieved = await store.readPersisted("non-existent");
      expect(retrieved).toBeNull();
    });

    it("should delete persisted state from disk", async () => {
      const state: TestState = { id: "test", value: 456, items: [] };

      await store.persist(testMinionId, state);
      await store.deletePersisted(testMinionId);

      const retrieved = await store.readPersisted(testMinionId);
      expect(retrieved).toBeNull();
    });

    it("should not throw when deleting non-existent persisted state", async () => {
      // Should complete without throwing (logs error but doesn't throw)
      await store.deletePersisted("non-existent");
      // If we get here, it didn't throw
      expect(true).toBe(true);
    });
  });

  describe("Replay", () => {
    it("should replay events from in-memory state", async () => {
      const state: TestState = { id: "mem", value: 10, items: ["a", "b", "c"] };
      store.setState(testMinionId, state);

      await store.replay(testMinionId, { minionId: testMinionId });

      expect(emittedEvents).toHaveLength(5); // start + 3 items + end
      expect(emittedEvents[0]).toEqual({ type: "start", id: testMinionId, data: 10 });
      expect(emittedEvents[1]).toEqual({ type: "item", id: testMinionId, data: "a" });
      expect(emittedEvents[2]).toEqual({ type: "item", id: testMinionId, data: "b" });
      expect(emittedEvents[3]).toEqual({ type: "item", id: testMinionId, data: "c" });
      expect(emittedEvents[4]).toEqual({ type: "end", id: testMinionId, data: 3 });
    });

    it("should replay events from disk state when not in memory", async () => {
      const state: TestState = { id: "disk", value: 20, items: ["x"] };

      await store.persist(testMinionId, state);
      // Don't set in-memory state

      await store.replay(testMinionId, { minionId: testMinionId });

      expect(emittedEvents).toHaveLength(3); // start + 1 item + end
      expect(emittedEvents[0]).toEqual({ type: "start", id: testMinionId, data: 20 });
      expect(emittedEvents[1]).toEqual({ type: "item", id: testMinionId, data: "x" });
      expect(emittedEvents[2]).toEqual({ type: "end", id: testMinionId, data: 1 });
    });

    it("should prefer in-memory state over disk state", async () => {
      const diskState: TestState = { id: "disk", value: 1, items: [] };
      const memState: TestState = { id: "mem", value: 2, items: [] };

      await store.persist(testMinionId, diskState);
      store.setState(testMinionId, memState);

      await store.replay(testMinionId, { minionId: testMinionId });

      expect(emittedEvents[0]).toEqual({ type: "start", id: testMinionId, data: 2 }); // Memory value
    });

    it("should do nothing when replaying non-existent state", async () => {
      await store.replay("non-existent", { minionId: "non-existent" });
      expect(emittedEvents).toHaveLength(0);
    });

    it("should pass context to serializer", async () => {
      const state: TestState = { id: "original", value: 100, items: [] };
      store.setState(testMinionId, state);

      await store.replay(testMinionId, { minionId: "override-id" });

      // Serializer should use minionId from context
      expect(emittedEvents[0]).toEqual({ type: "start", id: "override-id", data: 100 });
    });
  });

  describe("Integration", () => {
    it("should handle full lifecycle: set → persist → delete memory → replay from disk", async () => {
      const state: TestState = { id: "lifecycle", value: 777, items: ["test"] };

      // Set in memory
      store.setState(testMinionId, state);
      expect(store.hasState(testMinionId)).toBe(true);

      // Persist to disk
      await store.persist(testMinionId, state);

      // Clear memory
      store.deleteState(testMinionId);
      expect(store.hasState(testMinionId)).toBe(false);

      // Replay from disk
      await store.replay(testMinionId, { minionId: testMinionId });

      // Verify events were emitted
      expect(emittedEvents).toHaveLength(3);
      expect(emittedEvents[0].data).toBe(777);
    });
  });
});
