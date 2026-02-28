import { describe, it, expect } from "@jest/globals";
import {
  partitionMinionsByAge,
  formatDaysThreshold,
  AGE_THRESHOLDS_DAYS,
  buildSortedMinionsByProject,
  partitionMinionsByCrew,
  sortCrewsByLinkedList,
} from "./minionFiltering";
import type { FrontendMinionMetadata } from "@/common/types/minion";
import type { ProjectConfig, CrewConfig } from "@/common/types/project";
import { DEFAULT_RUNTIME_CONFIG } from "@/common/constants/minion";

describe("partitionMinionsByAge", () => {
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  const createMinion = (id: string): FrontendMinionMetadata => ({
    id,
    name: `minion-${id}`,
    projectName: "test-project",
    projectPath: "/test/project",
    namedMinionPath: `/test/project/minion-${id}`,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
  });

  // Helper to get all "old" minions (all buckets combined)
  const getAllOld = (buckets: FrontendMinionMetadata[][]) => buckets.flat();

  it("should partition minions into recent and old based on 24-hour threshold", () => {
    const minions = [
      createMinion("recent1"),
      createMinion("old1"),
      createMinion("recent2"),
      createMinion("old2"),
    ];

    const minionRecency = {
      recent1: now - 1000, // 1 second ago
      old1: now - ONE_DAY_MS - 1000, // 24 hours and 1 second ago
      recent2: now - 12 * 60 * 60 * 1000, // 12 hours ago
      old2: now - 2 * ONE_DAY_MS, // 2 days ago
    };

    const { recent, buckets } = partitionMinionsByAge(minions, minionRecency);
    const old = getAllOld(buckets);

    expect(recent).toHaveLength(2);
    expect(recent.map((w) => w.id)).toEqual(expect.arrayContaining(["recent1", "recent2"]));

    expect(old).toHaveLength(2);
    expect(old.map((w) => w.id)).toEqual(expect.arrayContaining(["old1", "old2"]));
  });

  it("should treat minions with no recency timestamp as old", () => {
    const minions = [createMinion("no-activity"), createMinion("recent")];

    const minionRecency = {
      recent: now - 1000,
      // no-activity has no timestamp
    };

    const { recent, buckets } = partitionMinionsByAge(minions, minionRecency);
    const old = getAllOld(buckets);

    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("recent");

    expect(old).toHaveLength(1);
    expect(old[0].id).toBe("no-activity");
  });

  it("should handle empty minion list", () => {
    const { recent, buckets } = partitionMinionsByAge([], {});

    expect(recent).toHaveLength(0);
    expect(buckets).toHaveLength(AGE_THRESHOLDS_DAYS.length);
    expect(buckets.every((b) => b.length === 0)).toBe(true);
  });

  it("should handle minion at exactly 24 hours (should show as recent due to always-show-one rule)", () => {
    const minions = [createMinion("exactly-24h")];

    const minionRecency = {
      "exactly-24h": now - ONE_DAY_MS,
    };

    const { recent, buckets } = partitionMinionsByAge(minions, minionRecency);
    const old = getAllOld(buckets);

    // Even though it's exactly 24 hours old, it should show as recent (always show at least one)
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("exactly-24h");
    expect(old).toHaveLength(0);
  });

  it("should preserve minion order within partitions", () => {
    const minions = [
      createMinion("recent"),
      createMinion("old1"),
      createMinion("old2"),
      createMinion("old3"),
    ];

    const minionRecency = {
      recent: now - 1000,
      old1: now - 2 * ONE_DAY_MS,
      old2: now - 3 * ONE_DAY_MS,
      old3: now - 4 * ONE_DAY_MS,
    };

    const { buckets } = partitionMinionsByAge(minions, minionRecency);
    const old = getAllOld(buckets);

    expect(old.map((w) => w.id)).toEqual(["old1", "old2", "old3"]);
  });

  it("should always show at least one minion when all are old", () => {
    const minions = [createMinion("old1"), createMinion("old2"), createMinion("old3")];

    const minionRecency = {
      old1: now - 2 * ONE_DAY_MS,
      old2: now - 3 * ONE_DAY_MS,
      old3: now - 4 * ONE_DAY_MS,
    };

    const { recent, buckets } = partitionMinionsByAge(minions, minionRecency);
    const old = getAllOld(buckets);

    // Most recent should be moved to recent crew
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("old1");

    // Remaining should stay in old crew
    expect(old).toHaveLength(2);
    expect(old.map((w) => w.id)).toEqual(["old2", "old3"]);
  });

  it("should partition into correct age buckets", () => {
    const minions = [
      createMinion("recent"), // < 1 day
      createMinion("bucket0"), // 1-7 days
      createMinion("bucket1"), // 7-30 days
      createMinion("bucket2"), // > 30 days
    ];

    const minionRecency = {
      recent: now - 12 * 60 * 60 * 1000, // 12 hours
      bucket0: now - 3 * ONE_DAY_MS, // 3 days (1-7 day bucket)
      bucket1: now - 15 * ONE_DAY_MS, // 15 days (7-30 day bucket)
      bucket2: now - 60 * ONE_DAY_MS, // 60 days (>30 day bucket)
    };

    const { recent, buckets } = partitionMinionsByAge(minions, minionRecency);

    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe("recent");

    expect(buckets[0]).toHaveLength(1);
    expect(buckets[0][0].id).toBe("bucket0");

    expect(buckets[1]).toHaveLength(1);
    expect(buckets[1][0].id).toBe("bucket1");

    expect(buckets[2]).toHaveLength(1);
    expect(buckets[2][0].id).toBe("bucket2");
  });
});

describe("formatDaysThreshold", () => {
  it("should format singular day correctly", () => {
    expect(formatDaysThreshold(1)).toBe("1 day");
  });

  it("should format plural days correctly", () => {
    expect(formatDaysThreshold(7)).toBe("7 days");
    expect(formatDaysThreshold(30)).toBe("30 days");
  });
});

describe("buildSortedMinionsByProject", () => {
  const createMinion = (
    id: string,
    projectPath: string,
    isInitializing?: boolean,
    parentMinionId?: string
  ): FrontendMinionMetadata => ({
    id,
    name: `minion-${id}`,
    projectName: projectPath.split("/").pop() ?? "unknown",
    projectPath,
    namedMinionPath: `${projectPath}/minion-${id}`,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
    isInitializing,
    parentMinionId,
  });

  it("should include minions from persisted config", () => {
    const projects = new Map<string, ProjectConfig>([
      ["/project/a", { minions: [{ path: "/a/ws1", id: "ws1" }] }],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["ws1", createMinion("ws1", "/project/a")],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(1);
    expect(result.get("/project/a")?.[0].id).toBe("ws1");
  });

  it("should include pending minions not yet in config", () => {
    const projects = new Map<string, ProjectConfig>([
      ["/project/a", { minions: [{ path: "/a/ws1", id: "ws1" }] }],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["ws1", createMinion("ws1", "/project/a")],
      ["pending1", createMinion("pending1", "/project/a", true)],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(2);
    expect(result.get("/project/a")?.map((w) => w.id)).toContain("ws1");
    expect(result.get("/project/a")?.map((w) => w.id)).toContain("pending1");
  });

  it("should handle multiple concurrent pending minions", () => {
    const projects = new Map<string, ProjectConfig>([["/project/a", { minions: [] }]]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["pending1", createMinion("pending1", "/project/a", true)],
      ["pending2", createMinion("pending2", "/project/a", true)],
      ["pending3", createMinion("pending3", "/project/a", true)],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(3);
  });

  it("should add pending minions for projects not yet in config", () => {
    const projects = new Map<string, ProjectConfig>();
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["pending1", createMinion("pending1", "/new/project", true)],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/new/project")).toHaveLength(1);
    expect(result.get("/new/project")?.[0].id).toBe("pending1");
  });

  it("should use stable tie-breakers when recency is equal", () => {
    const projects = new Map<string, ProjectConfig>([
      [
        "/project/a",
        {
          minions: [
            { path: "/a/ws1", id: "ws1" },
            { path: "/a/ws2", id: "ws2" },
            { path: "/a/ws3", id: "ws3" },
          ],
        },
      ],
    ]);

    const metadata = new Map<string, FrontendMinionMetadata>([
      [
        "ws1",
        {
          ...createMinion("ws1", "/project/a"),
          name: "beta",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
      [
        "ws2",
        {
          ...createMinion("ws2", "/project/a"),
          name: "alpha",
          createdAt: "2021-01-01T00:00:00.000Z",
        },
      ],
      [
        "ws3",
        {
          ...createMinion("ws3", "/project/a"),
          name: "aardvark",
          createdAt: "2020-01-01T00:00:00.000Z",
        },
      ],
    ]);

    // No recency timestamps → all ties
    const result = buildSortedMinionsByProject(projects, metadata, {});

    // Tie-break order: createdAt desc, then name asc, then id asc
    expect(result.get("/project/a")?.map((w) => w.id)).toEqual(["ws2", "ws3", "ws1"]);
  });

  it("should sort minions by recency (most recent first)", () => {
    const now = Date.now();
    const projects = new Map<string, ProjectConfig>([
      [
        "/project/a",
        {
          minions: [
            { path: "/a/ws1", id: "ws1" },
            { path: "/a/ws2", id: "ws2" },
            { path: "/a/ws3", id: "ws3" },
          ],
        },
      ],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["ws1", createMinion("ws1", "/project/a")],
      ["ws2", createMinion("ws2", "/project/a")],
      ["ws3", createMinion("ws3", "/project/a")],
    ]);
    const recency = {
      ws1: now - 3000, // oldest
      ws2: now - 1000, // newest
      ws3: now - 2000, // middle
    };

    const result = buildSortedMinionsByProject(projects, metadata, recency);

    expect(result.get("/project/a")?.map((w) => w.id)).toEqual(["ws2", "ws3", "ws1"]);
  });

  it("should flatten child minions directly under their parent", () => {
    const now = Date.now();
    const projects = new Map<string, ProjectConfig>([
      [
        "/project/a",
        {
          minions: [
            { path: "/a/root", id: "root" },
            { path: "/a/child1", id: "child1" },
            { path: "/a/child2", id: "child2" },
            { path: "/a/grand", id: "grand" },
          ],
        },
      ],
    ]);

    const metadata = new Map<string, FrontendMinionMetadata>([
      ["root", createMinion("root", "/project/a")],
      ["child1", createMinion("child1", "/project/a", undefined, "root")],
      ["child2", createMinion("child2", "/project/a", undefined, "root")],
      ["grand", createMinion("grand", "/project/a", undefined, "child1")],
    ]);

    // Child minions are more recent than the parent, but should still render below it.
    const recency = {
      child1: now - 1000,
      child2: now - 2000,
      grand: now - 3000,
      root: now - 4000,
    };

    const result = buildSortedMinionsByProject(projects, metadata, recency);
    expect(result.get("/project/a")?.map((w) => w.id)).toEqual([
      "root",
      "child1",
      "grand",
      "child2",
    ]);
  });

  it("should not duplicate minions that exist in both config and have creating status", () => {
    // Edge case: minion was saved to config but still reports isInitializing
    // (this shouldn't happen in practice but tests defensive coding)
    const projects = new Map<string, ProjectConfig>([
      ["/project/a", { minions: [{ path: "/a/ws1", id: "ws1" }] }],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["ws1", createMinion("ws1", "/project/a", true)],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(1);
    expect(result.get("/project/a")?.[0].id).toBe("ws1");
  });

  it("should skip minions with no id in config", () => {
    const projects = new Map<string, ProjectConfig>([
      ["/project/a", { minions: [{ path: "/a/legacy" }, { path: "/a/ws1", id: "ws1" }] }],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>([
      ["ws1", createMinion("ws1", "/project/a")],
    ]);

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(1);
    expect(result.get("/project/a")?.[0].id).toBe("ws1");
  });

  it("should skip config minions with no matching metadata", () => {
    const projects = new Map<string, ProjectConfig>([
      ["/project/a", { minions: [{ path: "/a/ws1", id: "ws1" }] }],
    ]);
    const metadata = new Map<string, FrontendMinionMetadata>(); // empty

    const result = buildSortedMinionsByProject(projects, metadata, {});

    expect(result.get("/project/a")).toHaveLength(0);
  });
});

describe("sortCrewsByLinkedList", () => {
  it("should sort sections by nextId linked list", () => {
    const sections: CrewConfig[] = [
      { id: "c", name: "C", nextId: null },
      { id: "a", name: "A", nextId: "b" },
      { id: "b", name: "B", nextId: "c" },
    ];

    const sorted = sortCrewsByLinkedList(sections);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("should handle empty array", () => {
    expect(sortCrewsByLinkedList([])).toEqual([]);
  });

  it("should handle single section", () => {
    const sections: CrewConfig[] = [{ id: "only", name: "Only", nextId: null }];
    const sorted = sortCrewsByLinkedList(sections);
    expect(sorted.map((s) => s.id)).toEqual(["only"]);
  });

  it("should handle reordered sections (C, A, B order)", () => {
    // After reorder to C->A->B, the pointers should be: C->A->B->null
    const sections: CrewConfig[] = [
      { id: "a", name: "A", nextId: "b" },
      { id: "b", name: "B", nextId: null },
      { id: "c", name: "C", nextId: "a" },
    ];

    const sorted = sortCrewsByLinkedList(sections);
    expect(sorted.map((s) => s.id)).toEqual(["c", "a", "b"]);
  });

  it("should append orphaned sections", () => {
    // Crew "orphan" is not in the linked list
    const sections: CrewConfig[] = [
      { id: "a", name: "A", nextId: "b" },
      { id: "b", name: "B", nextId: null },
      { id: "orphan", name: "Orphan", nextId: "nonexistent" },
    ];

    const sorted = sortCrewsByLinkedList(sections);
    expect(sorted.map((s) => s.id)).toEqual(["a", "b", "orphan"]);
  });
});

describe("partitionMinionsByCrew", () => {
  const createMinion = (
    id: string,
    crewId?: string,
    parentMinionId?: string
  ): FrontendMinionMetadata => ({
    id,
    name: `minion-${id}`,
    projectName: "test-project",
    projectPath: "/test/project",
    namedMinionPath: `/test/project/minion-${id}`,
    runtimeConfig: DEFAULT_RUNTIME_CONFIG,
    crewId,
    parentMinionId,
  });

  it("should partition minions by section", () => {
    const minions = [
      createMinion("ws1", "section-a"),
      createMinion("ws2", "section-b"),
      createMinion("ws3"), // unsectioned
    ];
    const sections: CrewConfig[] = [
      { id: "section-a", name: "A" },
      { id: "section-b", name: "B" },
    ];

    const result = partitionMinionsByCrew(minions, sections);

    expect(result.unsectioned.map((w: FrontendMinionMetadata) => w.id)).toEqual(["ws3"]);
    expect(
      result.byCrewId.get("section-a")?.map((w: FrontendMinionMetadata) => w.id)
    ).toEqual(["ws1"]);
    expect(
      result.byCrewId.get("section-b")?.map((w: FrontendMinionMetadata) => w.id)
    ).toEqual(["ws2"]);
  });

  it("should keep child minions directly after their parent within a section", () => {
    // Parent in crew-a, child also in crew-a
    // Input order from flattenMinionTree: parent, child (already correct)
    const minions = [
      createMinion("parent", "section-a"),
      createMinion("child", "section-a", "parent"),
    ];
    const sections: CrewConfig[] = [{ id: "section-a", name: "A" }];

    const result = partitionMinionsByCrew(minions, sections);

    // Child should be directly after parent
    expect(
      result.byCrewId.get("section-a")?.map((w: FrontendMinionMetadata) => w.id)
    ).toEqual(["parent", "child"]);
  });

  it("should keep child minions with parent even when child has no crewId (inherits parent section)", () => {
    // BUG REPRODUCTION: Parent in section-a, child has no crewId
    // Child should render under parent in crew-a, NOT in unsectioned
    const minions = [
      createMinion("parent", "section-a"),
      createMinion("child", undefined, "parent"), // child without crewId
    ];
    const sections: CrewConfig[] = [{ id: "section-a", name: "A" }];

    const result = partitionMinionsByCrew(minions, sections);

    // Child should inherit parent's crew placement
    expect(
      result.byCrewId.get("section-a")?.map((w: FrontendMinionMetadata) => w.id)
    ).toEqual(["parent", "child"]);
    // Unsectioned should be empty
    expect(result.unsectioned).toHaveLength(0);
  });

  it("should handle nested children inheriting section from root parent", () => {
    // Root in section-a, child1 and grandchild have no crewId
    const minions = [
      createMinion("root", "section-a"),
      createMinion("child1", undefined, "root"),
      createMinion("grandchild", undefined, "child1"),
    ];
    const sections: CrewConfig[] = [{ id: "section-a", name: "A" }];

    const result = partitionMinionsByCrew(minions, sections);

    // All should be in crew-a, in tree order
    expect(
      result.byCrewId.get("section-a")?.map((w: FrontendMinionMetadata) => w.id)
    ).toEqual(["root", "child1", "grandchild"]);
    expect(result.unsectioned).toHaveLength(0);
  });
});
