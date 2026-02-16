import { describe, test, expect, beforeAll } from "bun:test";
import { z } from "zod";
import type { Tool } from "ai";
import { validateTypes } from "./typeValidator";
import { generateLatticeTypes } from "./typeGenerator";

/**
 * Create a mock tool with the given schema.
 */
function createMockTool(schema: z.ZodType): Tool {
  return {
    description: "Mock tool",
    inputSchema: schema,
    execute: () => Promise.resolve({ success: true }),
  } as unknown as Tool;
}

describe("validateTypes", () => {
  let latticeTypes: string;

  // Generate types once for all tests
  beforeAll(async () => {
    const tools = {
      file_read: createMockTool(
        z.object({
          filePath: z.string(),
          offset: z.number().optional(),
          limit: z.number().optional(),
        })
      ),
      bash: createMockTool(
        z.object({
          script: z.string(),
          timeout_secs: z.number(),
          run_in_background: z.boolean(),
          display_name: z.string(),
        })
      ),
    };
    latticeTypes = await generateLatticeTypes(tools);
  });

  test("accepts valid code with correct property names", () => {
    const result = validateTypes(
      `
      const content =lattice.file_read({ filePath: "test.txt" });
      return content.success;
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("accepts code using optional properties", () => {
    const result = validateTypes(
      `
      lattice.file_read({ filePath: "test.txt", offset: 10, limit: 50 });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("catches wrong property name", () => {
    const result = validateTypes(
      `
      lattice.file_read({ path: "test.txt" });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    // Error should mention 'path' doesn't exist or 'filePath' is missing
    expect(
      result.errors.some((e) => e.message.includes("path") || e.message.includes("filePath"))
    ).toBe(true);
  });

  test("catches missing required property", () => {
    const result = validateTypes(
      `
      lattice.bash({ script: "ls" });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    // Should error on missing required props
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("catches wrong type for property", () => {
    const result = validateTypes(
      `
      lattice.file_read({ filePath: 123 });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("number") || e.message.includes("string"))
    ).toBe(true);
  });

  test("catches calling non-existent tool", () => {
    const result = validateTypes(
      `
      lattice.nonexistent_tool({ foo: "bar" });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("nonexistent_tool"))).toBe(true);
  });

  test("returns line numbers for type errors", () => {
    const result = validateTypes(
      `const x = 1;
const y = 2;
lattice.file_read({ path: "test.txt" });`,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    // Error should be on line 3 (the  lattice.file_read call)
    const errorWithLine = result.errors.find((e) => e.line !== undefined);
    expect(errorWithLine).toBeDefined();
    expect(errorWithLine!.line).toBe(3);
  });

  test("returns line 1 for error on first line", () => {
    const result = validateTypes(`lattice.file_read({ path: "test.txt" });`, latticeTypes);
    expect(result.valid).toBe(false);
    const errorWithLine = result.errors.find((e) => e.line !== undefined);
    expect(errorWithLine).toBeDefined();
    expect(errorWithLine!.line).toBe(1);
  });

  test("returns correct line for error on last line of multi-line code", () => {
    const result = validateTypes(
      `const a = 1;
const b = 2;
const c = 3;
const d = 4;
lattice.file_read({ path: "wrong" });`,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    const errorWithLine = result.errors.find((e) => e.line !== undefined);
    expect(errorWithLine).toBeDefined();
    expect(errorWithLine!.line).toBe(5);
  });

  test("returns column number for type errors", () => {
    // Column should point to the problematic property
    const result = validateTypes(`lattice.file_read({ path: "test.txt" });`, latticeTypes);
    expect(result.valid).toBe(false);
    const errorWithLine = result.errors.find((e) => e.column !== undefined);
    expect(errorWithLine).toBeDefined();
    expect(errorWithLine!.column).toBeGreaterThan(0);
  });

  test("allows dynamic property access (no strict checking on unknown keys)", () => {
    const result = validateTypes(
      `
      const result =lattice.file_read({ filePath: "test.txt" });
      const key = "content";
      console.log(result[key]);
    `,
      latticeTypes
    );
    // This should pass - we don't enforce strict property checking on results
    expect(result.valid).toBe(true);
  });

  test("allows console.log/warn/error", () => {
    const result = validateTypes(
      `
      console.log("hello");
      console.warn("warning");
      console.error("error");
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("allows dynamic properties on empty object literals", () => {
    // Claude frequently uses this pattern to collate parallel reads
    const result = validateTypes(
      `
      const results = {};
      results.file1 =lattice.file_read({ filePath: "a.txt" });
      results.file2 =lattice.file_read({ filePath: "b.txt" });
      return results;
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("still catches lattice tool typos", () => {
    // Must not filter errors for typos on the lattice namespace
    const result = validateTypes(
      `
      lattice.file_reade({ filePath: "test.txt" });
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("file_reade"))).toBe(true);
  });

  test("catches reads from empty object literals (typos)", () => {
    // Reads from {} should still error - only writes are allowed
    const result = validateTypes(
      `
      const results = {};
      results.file1 =lattice.file_read({ filePath: "a.txt" });
      return results.filee1;  // typo: should be file1
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("filee1"))).toBe(true);
  });

  test("catches empty object properties used in tool args", () => {
    // Using unset properties from {} in tool calls should error
    const result = validateTypes(
      `
      const config = {};
      lattice.file_read({ filePath: config.path });  // config.path doesn't exist
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("path"))).toBe(true);
  });

  test("catches empty object reads in expressions", () => {
    // Reading from {} in any expression context should error
    const result = validateTypes(
      `
      const obj = {};
      const x = obj.value + 1;  // obj.value doesn't exist
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("value"))).toBe(true);
  });

  test("catches empty object reads in conditionals", () => {
    const result = validateTypes(
      `
      const obj = {};
      if (obj.flag) { console.log("yes"); }  // obj.flag doesn't exist
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("flag"))).toBe(true);
  });

  test("allows multiple writes to empty object", () => {
    const result = validateTypes(
      `
      const data = {};
      data.a = 1;
      data.b = 2;
      data.c =lattice.file_read({ filePath: "test.txt" });
      data.d = "string";
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("catches compound assignment on empty object (+=)", () => {
    // Compound assignments read then write, so should error
    const result = validateTypes(
      `
      const obj = {};
      obj.count += 1;  // reads obj.count first
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("count"))).toBe(true);
  });

  test("accepts ES2021+ features (replaceAll, at, etc.)", () => {
    const result = validateTypes(
      `
      const str = "a-b-c".replaceAll("-", "_");
      const arr = [1, 2, 3];
      const last = arr.at(-1);
      const hasA = Object.hasOwn({ a: 1 }, "a");
      return { str, last, hasA };
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("allows discriminated union narrowing with negation (!result.success)", () => {
    // This is the idiomatic pattern for handling Result types
    const result = validateTypes(
      `
      const result =lattice.file_read({ filePath: "test.txt" });
      if (!result.success) {
        console.log(result.error);  // Should be allowed after narrowing
        return { error: result.error };
      }
      return { content: result.content };
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("allows discriminated union narrowing with === false", () => {
    const result = validateTypes(
      `
      const result =lattice.file_read({ filePath: "test.txt" });
      if (result.success === false) {
        console.log(result.error);
        return null;
      }
      return result.content;
    `,
      latticeTypes
    );
    expect(result.valid).toBe(true);
  });

  test("catches syntax error gracefully", () => {
    const result = validateTypes(
      `
      lattice.file_read({ filePath: "test.txt" // missing closing brace
    `,
      latticeTypes
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
