import { validateMinionName } from "./minionValidation";

describe("validateMinionName", () => {
  describe("valid names", () => {
    test("accepts lowercase letters", () => {
      expect(validateMinionName("main").valid).toBe(true);
      expect(validateMinionName("feature").valid).toBe(true);
    });

    test("accepts digits", () => {
      expect(validateMinionName("branch123").valid).toBe(true);
      expect(validateMinionName("123").valid).toBe(true);
    });

    test("accepts underscores", () => {
      expect(validateMinionName("my_branch").valid).toBe(true);
      expect(validateMinionName("feature_test_123").valid).toBe(true);
    });

    test("accepts hyphens", () => {
      expect(validateMinionName("my-branch").valid).toBe(true);
      expect(validateMinionName("feature-test-123").valid).toBe(true);
    });

    test("accepts combinations", () => {
      expect(validateMinionName("feature-branch_123").valid).toBe(true);
      expect(validateMinionName("a1-b2_c3").valid).toBe(true);
    });

    test("accepts single character", () => {
      expect(validateMinionName("a").valid).toBe(true);
      expect(validateMinionName("1").valid).toBe(true);
      expect(validateMinionName("_").valid).toBe(true);
      expect(validateMinionName("-").valid).toBe(true);
    });

    test("accepts 64 characters", () => {
      const name = "a".repeat(64);
      expect(validateMinionName(name).valid).toBe(true);
    });
  });

  describe("invalid names", () => {
    test("rejects empty string", () => {
      const result = validateMinionName("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    test("rejects names over 64 characters", () => {
      const name = "a".repeat(65);
      const result = validateMinionName(name);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("64 characters");
    });

    test("rejects uppercase letters", () => {
      const result = validateMinionName("MyBranch");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("lowercase");
    });

    test("rejects spaces", () => {
      const result = validateMinionName("my branch");
      expect(result.valid).toBe(false);
    });

    test("rejects special characters", () => {
      expect(validateMinionName("branch@123").valid).toBe(false);
      expect(validateMinionName("branch#123").valid).toBe(false);
      expect(validateMinionName("branch$123").valid).toBe(false);
      expect(validateMinionName("branch%123").valid).toBe(false);
      expect(validateMinionName("branch!123").valid).toBe(false);
      expect(validateMinionName("branch.123").valid).toBe(false);
      expect(validateMinionName("branch/123").valid).toBe(false);
      expect(validateMinionName("branch\\123").valid).toBe(false);
    });

    test("rejects names with slashes", () => {
      expect(validateMinionName("feature/branch").valid).toBe(false);
      expect(validateMinionName("path\\to\\branch").valid).toBe(false);
    });
  });
});
