import { describe, expect, it } from "bun:test";

import { DEFAULT_CREW_COLOR, resolveCrewColor } from "./ui";

describe("resolveCrewColor", () => {
  it("returns default for empty/undefined", () => {
    expect(resolveCrewColor(undefined)).toBe(DEFAULT_CREW_COLOR);
    expect(resolveCrewColor(null)).toBe(DEFAULT_CREW_COLOR);
    expect(resolveCrewColor("")).toBe(DEFAULT_CREW_COLOR);
    expect(resolveCrewColor("   ")).toBe(DEFAULT_CREW_COLOR);
  });

  it("resolves palette names (case-insensitive)", () => {
    expect(resolveCrewColor("Blue")).toBe("#5a9bd4");
    expect(resolveCrewColor("blue")).toBe("#5a9bd4");
  });

  it("normalizes hex colors", () => {
    expect(resolveCrewColor("#ABC")).toBe("#aabbcc");
    expect(resolveCrewColor("#AABBCC")).toBe("#aabbcc");
    expect(resolveCrewColor("#AABBCCDD")).toBe("#aabbcc");
  });

  it("falls back to default for invalid values", () => {
    expect(resolveCrewColor("not-a-color")).toBe(DEFAULT_CREW_COLOR);
  });
});
