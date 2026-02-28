import { describe, expect, test } from "bun:test";
import { parseLatticeDeepLink, resolveProjectPathFromProjectQuery } from "./deepLink";

describe("parseLatticeDeepLink", () => {
  test("parses lattice://chat/new", () => {
    const payload = parseLatticeDeepLink(
      "lattice://chat/new/?project=lattice&projectPath=%2Ftmp%2Frepo&projectId=proj_123&prompt=hello%20world&crewId=sec_456"
    );

    expect(payload).toEqual({
      type: "new_chat",
      project: "lattice",
      projectPath: "/tmp/repo",
      projectId: "proj_123",
      prompt: "hello world",
      crewId: "sec_456",
    });
  });

  test("returns null for invalid scheme", () => {
    expect(parseLatticeDeepLink("http://chat/new?prompt=hi")).toBeNull();
  });

  test("returns null for unknown route", () => {
    expect(parseLatticeDeepLink("lattice://chat/old?prompt=hi")).toBeNull();
  });

  test("resolves deep-link project query by final path segment", () => {
    const resolved = resolveProjectPathFromProjectQuery(
      ["/Users/mike/repos/lattice", "/Users/mike/repos/clattice"],
      "lattice"
    );

    expect(resolved).toBe("/Users/mike/repos/lattice");
  });

  test("falls back to substring match when no exact match exists", () => {
    // No exact segment match for "lattice" — both contain it as substring.
    // "clattice" (8 chars) is shorter than "my-lattice" (10 chars), so it wins.
    const resolved = resolveProjectPathFromProjectQuery(
      ["/Users/mike/repos/my-lattice", "/Users/mike/repos/clattice"],
      "lattice"
    );

    expect(resolved).toBe("/Users/mike/repos/clattice");
  });

  test("returns null when no project matches", () => {
    expect(resolveProjectPathFromProjectQuery(["/Users/mike/repos/foo"], "lattice")).toBeNull();
  });
});
