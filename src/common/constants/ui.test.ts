import { describe, expect, it } from "bun:test";

import { DEFAULT_STAGE_COLOR, resolveStageColor } from "./ui";

describe("resolveStageColor", () => {
  it("returns default for empty/undefined", () => {
    expect(resolveStageColor(undefined)).toBe(DEFAULT_STAGE_COLOR);
    expect(resolveStageColor(null)).toBe(DEFAULT_STAGE_COLOR);
    expect(resolveStageColor("")).toBe(DEFAULT_STAGE_COLOR);
    expect(resolveStageColor("   ")).toBe(DEFAULT_STAGE_COLOR);
  });

  it("resolves palette names (case-insensitive)", () => {
    expect(resolveStageColor("Blue")).toBe("#5a9bd4");
    expect(resolveStageColor("blue")).toBe("#5a9bd4");
  });

  it("normalizes hex colors", () => {
    expect(resolveStageColor("#ABC")).toBe("#aabbcc");
    expect(resolveStageColor("#AABBCC")).toBe("#aabbcc");
    expect(resolveStageColor("#AABBCCDD")).toBe("#aabbcc");
  });

  it("falls back to default for invalid values", () => {
    expect(resolveStageColor("not-a-color")).toBe(DEFAULT_STAGE_COLOR);
  });
});
