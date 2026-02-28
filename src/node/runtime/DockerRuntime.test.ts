import { describe, expect, it } from "bun:test";
import { DockerRuntime, getContainerName } from "./DockerRuntime";

/**
 * DockerRuntime constructor tests (run with bun test)
 *
 * Note: Docker minion operation tests require Docker
 * and should be in tests/runtime/runtime.test.ts
 */
describe("DockerRuntime constructor", () => {
  it("should accept image name", () => {
    expect(() => {
      new DockerRuntime({ image: "ubuntu:22.04" });
    }).not.toThrow();
  });

  it("should accept registry image", () => {
    expect(() => {
      new DockerRuntime({ image: "ghcr.io/myorg/dev-image:latest" });
    }).not.toThrow();
  });

  it("should return image via getImage()", () => {
    const runtime = new DockerRuntime({ image: "node:20" });
    expect(runtime.getImage()).toBe("node:20");
  });

  it("should return /src for minion path", () => {
    const runtime = new DockerRuntime({ image: "ubuntu:22.04" });
    expect(runtime.getMinionPath("/any/project", "any-branch")).toBe("/src");
  });

  it("should accept containerName for existing minions", () => {
    // When recreating runtime for existing minion, containerName is passed in config
    const runtime = new DockerRuntime({
      image: "ubuntu:22.04",
      containerName: "lattice-myproject-my-feature",
    });
    expect(runtime.getImage()).toBe("ubuntu:22.04");
    // Runtime should be ready for exec operations without calling createMinion
  });
});

describe("getContainerName", () => {
  it("should generate container name from project and minion", () => {
    expect(getContainerName("/home/user/myproject", "feature-branch")).toBe(
      "lattice-myproject-feature-branch-a8d18a"
    );
  });

  it("should sanitize special characters", () => {
    expect(getContainerName("/home/user/my@project", "feature/branch")).toBe(
      "lattice-my-project-feature-branch-b354b4"
    );
  });

  it("should handle long names", () => {
    const longName = "a".repeat(100);
    const result = getContainerName("/project", longName);
    // Docker has 64 char limit, function uses 63 to be safe
    expect(result.length).toBeLessThanOrEqual(63);
  });
});
