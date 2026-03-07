import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  loadReflections,
  storeReflection,
  markResolved,
  clearReflections,
  parseReflectionFromResponse,
  buildReflectionBlock,
  type Reflection,
} from "./reflexionService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reflexion-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeReflection(overrides: Partial<Reflection> = {}): Reflection {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: overrides.timestamp ?? Date.now(),
    trigger: overrides.trigger ?? "soft_limit",
    phase: overrides.phase ?? undefined,
    turnCount: overrides.turnCount ?? 5,
    content: overrides.content ?? "WHAT_I_TRIED: Foo\nWHAT_FAILED: Bar\nROOT_CAUSE: Baz\nNEXT_STRATEGY: Qux",
    resolved: overrides.resolved ?? false,
  };
}

// ---------------------------------------------------------------------------
// loadReflections
// ---------------------------------------------------------------------------

describe("loadReflections", () => {
  it("returns empty array when file does not exist", async () => {
    const reflections = await loadReflections(tmpDir);
    expect(reflections).toEqual([]);
  });

  it("returns empty array when file is empty", async () => {
    await fs.writeFile(path.join(tmpDir, "reflections.jsonl"), "", "utf-8");
    const reflections = await loadReflections(tmpDir);
    expect(reflections).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// storeReflection + loadReflections roundtrip
// ---------------------------------------------------------------------------

describe("storeReflection", () => {
  it("persists a reflection and loads it back", async () => {
    const r = makeReflection({ id: "r1", turnCount: 3, trigger: "revert" });
    await storeReflection(tmpDir, r);

    const loaded = await loadReflections(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("r1");
    expect(loaded[0].trigger).toBe("revert");
    expect(loaded[0].turnCount).toBe(3);
    expect(loaded[0].resolved).toBe(false);
  });

  it("appends multiple reflections", async () => {
    await storeReflection(tmpDir, makeReflection({ id: "r1" }));
    await storeReflection(tmpDir, makeReflection({ id: "r2" }));
    await storeReflection(tmpDir, makeReflection({ id: "r3" }));

    const loaded = await loadReflections(tmpDir);
    expect(loaded).toHaveLength(3);
    expect(loaded.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("creates parent directories if they don't exist", async () => {
    const nested = path.join(tmpDir, "deep", "session");
    const r = makeReflection({ id: "r-nested" });
    await storeReflection(nested, r);

    const loaded = await loadReflections(nested);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("r-nested");
  });
});

// ---------------------------------------------------------------------------
// markResolved
// ---------------------------------------------------------------------------

describe("markResolved", () => {
  it("toggles the resolved flag for the correct entry", async () => {
    await storeReflection(tmpDir, makeReflection({ id: "r1", resolved: false }));
    await storeReflection(tmpDir, makeReflection({ id: "r2", resolved: false }));

    await markResolved(tmpDir, "r1", true);

    const loaded = await loadReflections(tmpDir);
    expect(loaded[0].resolved).toBe(true);
    expect(loaded[1].resolved).toBe(false);
  });

  it("can un-resolve a reflection", async () => {
    await storeReflection(tmpDir, makeReflection({ id: "r1", resolved: true }));
    await markResolved(tmpDir, "r1", false);

    const loaded = await loadReflections(tmpDir);
    expect(loaded[0].resolved).toBe(false);
  });

  it("does not affect other reflections", async () => {
    await storeReflection(tmpDir, makeReflection({ id: "r1", content: "first" }));
    await storeReflection(tmpDir, makeReflection({ id: "r2", content: "second" }));

    await markResolved(tmpDir, "r2", true);

    const loaded = await loadReflections(tmpDir);
    expect(loaded[0].content).toBe("first");
    expect(loaded[1].content).toBe("second");
    expect(loaded[0].resolved).toBe(false);
    expect(loaded[1].resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// clearReflections
// ---------------------------------------------------------------------------

describe("clearReflections", () => {
  it("removes the file", async () => {
    await storeReflection(tmpDir, makeReflection());
    await clearReflections(tmpDir);

    const loaded = await loadReflections(tmpDir);
    expect(loaded).toEqual([]);
  });

  it("does not throw when file does not exist", async () => {
    // Should not throw
    await clearReflections(tmpDir);
    const loaded = await loadReflections(tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseReflectionFromResponse
// ---------------------------------------------------------------------------

describe("parseReflectionFromResponse", () => {
  it("extracts content from <reflection> tags", () => {
    const text = [
      "Let me think about this...",
      "<reflection>",
      "WHAT_I_TRIED: Edited config.ts",
      "WHAT_FAILED: Build still fails",
      "ROOT_CAUSE: Wrong import path",
      "NEXT_STRATEGY: Check tsconfig paths",
      "</reflection>",
      "Okay, let me try a different approach.",
    ].join("\n");

    const result = parseReflectionFromResponse(text);
    expect(result).toContain("WHAT_I_TRIED");
    expect(result).toContain("WHAT_FAILED");
    expect(result).toContain("ROOT_CAUSE");
    expect(result).toContain("NEXT_STRATEGY");
  });

  it("returns null when no tags present", () => {
    const result = parseReflectionFromResponse("Just a normal response with no reflection.");
    expect(result).toBeNull();
  });

  it("returns null for empty tags", () => {
    const result = parseReflectionFromResponse("<reflection></reflection>");
    expect(result).toBeNull();
  });

  it("returns null for whitespace-only tags", () => {
    const result = parseReflectionFromResponse("<reflection>   \n  </reflection>");
    expect(result).toBeNull();
  });

  it("handles multiline content correctly", () => {
    const content = "Line 1\nLine 2\nLine 3";
    const text = `<reflection>${content}</reflection>`;
    const result = parseReflectionFromResponse(text);
    expect(result).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// buildReflectionBlock
// ---------------------------------------------------------------------------

describe("buildReflectionBlock", () => {
  it("returns undefined for empty array", () => {
    expect(buildReflectionBlock([])).toBeUndefined();
  });

  it("returns undefined when all reflections are resolved", () => {
    const reflections: Reflection[] = [
      makeReflection({ resolved: true }),
      makeReflection({ resolved: true }),
    ];
    expect(buildReflectionBlock(reflections)).toBeUndefined();
  });

  it("builds a block for unresolved reflections", () => {
    const reflections: Reflection[] = [
      makeReflection({
        trigger: "soft_limit",
        turnCount: 5,
        content: "Tried editing foo.ts, build failed.",
        resolved: false,
      }),
    ];

    const block = buildReflectionBlock(reflections)!;
    expect(block).toContain("EPISODIC MEMORY");
    expect(block).toContain("Do NOT repeat approaches");
    expect(block).toContain("Reflection 1");
    expect(block).toContain("turn 5");
    expect(block).toContain("soft_limit");
    expect(block).toContain("Tried editing foo.ts");
    expect(block).toContain("END EPISODIC MEMORY");
  });

  it("only includes unresolved reflections", () => {
    const reflections: Reflection[] = [
      makeReflection({ id: "resolved", content: "Old issue", resolved: true }),
      makeReflection({ id: "unresolved", content: "Active issue", resolved: false }),
    ];

    const block = buildReflectionBlock(reflections)!;
    expect(block).not.toContain("Old issue");
    expect(block).toContain("Active issue");
  });

  it("includes phase information when present", () => {
    const reflections: Reflection[] = [
      makeReflection({ phase: "execute", content: "Something broke", resolved: false }),
    ];

    const block = buildReflectionBlock(reflections)!;
    expect(block).toContain("execute phase");
  });

  it("respects the 2000 char cap", () => {
    // Create reflections with long content
    const longContent = "A".repeat(1500);
    const reflections: Reflection[] = [
      makeReflection({ content: longContent, resolved: false }),
      makeReflection({ content: longContent, resolved: false }),
    ];

    const block = buildReflectionBlock(reflections)!;
    // Should include the first reflection but not the second (it would exceed the cap)
    expect(block).toContain("Reflection 1");
    expect(block).not.toContain("Reflection 2");
  });

  it("includes multiple reflections when within cap", () => {
    const reflections: Reflection[] = [
      makeReflection({ content: "Short issue 1", resolved: false }),
      makeReflection({ content: "Short issue 2", resolved: false }),
      makeReflection({ content: "Short issue 3", resolved: false }),
    ];

    const block = buildReflectionBlock(reflections)!;
    expect(block).toContain("Reflection 1");
    expect(block).toContain("Reflection 2");
    expect(block).toContain("Reflection 3");
  });
});
