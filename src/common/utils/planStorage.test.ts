import { getPlanFilePath, getLegacyPlanFilePath } from "./planStorage";

describe("planStorage", () => {
  // Plan paths use tilde prefix for portability across local/remote runtimes
  const expectedLatticeHome = "~/.lattice";

  describe("getPlanFilePath", () => {
    it("should return path with project name and minion name", () => {
      const result = getPlanFilePath("fix-plan-a1b2", "lattice");
      expect(result).toBe(`${expectedLatticeHome}/plans/lattice/fix-plan-a1b2.md`);
    });

    it("should produce same path for same inputs", () => {
      const result1 = getPlanFilePath("fix-bug-x1y2", "myproject");
      const result2 = getPlanFilePath("fix-bug-x1y2", "myproject");
      expect(result1).toBe(result2);
    });

    it("should organize plans by project folder", () => {
      const result1 = getPlanFilePath("sidebar-a1b2", "lattice");
      const result2 = getPlanFilePath("auth-c3d4", "other-project");
      expect(result1).toBe(`${expectedLatticeHome}/plans/lattice/sidebar-a1b2.md`);
      expect(result2).toBe(`${expectedLatticeHome}/plans/other-project/auth-c3d4.md`);
    });

    it("should use custom latticeHome when provided (Docker uses /var/lattice)", () => {
      const result = getPlanFilePath("fix-plan-a1b2", "lattice", "/var/lattice");
      expect(result).toBe("/var/lattice/plans/lattice/fix-plan-a1b2.md");
    });

    it("should default to ~/.lattice when latticeHome not provided", () => {
      const withDefault = getPlanFilePath("minion", "project");
      const withExplicit = getPlanFilePath("minion", "project", "~/.lattice");
      expect(withDefault).toBe(withExplicit);
    });
  });

  describe("getLegacyPlanFilePath", () => {
    it("should return path with minion ID", () => {
      const result = getLegacyPlanFilePath("a1b2c3d4e5");
      expect(result).toBe(`${expectedLatticeHome}/plans/a1b2c3d4e5.md`);
    });

    it("should handle legacy format IDs", () => {
      const result = getLegacyPlanFilePath("lattice-main");
      expect(result).toBe(`${expectedLatticeHome}/plans/lattice-main.md`);
    });
  });
});
