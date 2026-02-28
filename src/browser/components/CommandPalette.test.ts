import { describe, expect, test } from "bun:test";
import { filterCommandsByPrefix } from "@/browser/utils/commandPaletteFiltering";
import { CommandIds, CommandIdMatchers } from "@/browser/utils/commandIds";
import { rankByPaletteQuery } from "@/browser/utils/commandPaletteRanking";

/**
 * Tests for command palette filtering logic
 * Property-based tests that verify behavior regardless of specific command data
 */

describe("CommandPalette filtering", () => {
  describe("property: default mode shows only ws:switch:* commands", () => {
    test("all results start with ws:switch:", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionSwitch("2") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.navToggleSidebar() },
      ];

      const result = filterCommandsByPrefix("", actions);

      expect(result.every((a) => CommandIdMatchers.isMinionSwitch(a.id))).toBe(true);
    });

    test("excludes all non-switching commands", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.minionRemove() },
        { id: CommandIds.navToggleSidebar() },
      ];

      const result = filterCommandsByPrefix("", actions);

      expect(result.some((a) => !CommandIdMatchers.isMinionSwitch(a.id))).toBe(false);
    });
  });

  describe("property: > mode shows all EXCEPT ws:switch:* commands", () => {
    test("no results start with ws:switch:", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.navToggleSidebar() },
        { id: CommandIds.chatClear() },
      ];

      const result = filterCommandsByPrefix(">", actions);

      expect(result.every((a) => !CommandIdMatchers.isMinionSwitch(a.id))).toBe(true);
    });

    test("includes all non-switching commands", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.minionRemove() },
        { id: CommandIds.navToggleSidebar() },
      ];

      const result = filterCommandsByPrefix(">", actions);

      // Should include minion mutations
      expect(result.some((a) => a.id === CommandIds.minionNew())).toBe(true);
      expect(result.some((a) => a.id === CommandIds.minionRemove())).toBe(true);
      // Should include navigation
      expect(result.some((a) => a.id === CommandIds.navToggleSidebar())).toBe(true);
      // Should NOT include switching
      expect(result.some((a) => a.id === CommandIds.minionSwitch("1"))).toBe(false);
    });
  });

  describe("property: modes partition the command space", () => {
    test("default + > modes cover all commands (no overlap, no gaps)", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionSwitch("2") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.minionRemove() },
        { id: CommandIds.navToggleSidebar() },
        { id: CommandIds.chatClear() },
      ];

      const defaultResult = filterCommandsByPrefix("", actions);
      const commandResult = filterCommandsByPrefix(">", actions);

      // No overlap - disjoint sets
      const defaultIds = new Set(defaultResult.map((a) => a.id));
      const commandIds = new Set(commandResult.map((a) => a.id));
      const intersection = [...defaultIds].filter((id) => commandIds.has(id));
      expect(intersection).toHaveLength(0);

      // No gaps - covers everything
      expect(defaultResult.length + commandResult.length).toBe(actions.length);
    });
  });

  describe("property: / prefix always returns empty", () => {
    test("returns empty array regardless of actions", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.navToggleSidebar() },
      ];

      expect(filterCommandsByPrefix("/", actions)).toHaveLength(0);
      expect(filterCommandsByPrefix("/help", actions)).toHaveLength(0);
      expect(filterCommandsByPrefix("/ ", actions)).toHaveLength(0);
    });
  });

  describe("property: query with > prefix applies to all non-switching", () => {
    test(">text shows same set as > (cmdk filters further)", () => {
      const actions = [
        { id: CommandIds.minionSwitch("1") },
        { id: CommandIds.minionNew() },
        { id: CommandIds.navToggleSidebar() },
      ];

      // Our filter doesn't care about text after >, just the prefix
      const resultEmpty = filterCommandsByPrefix(">", actions);
      const resultWithText = filterCommandsByPrefix(">abc", actions);

      expect(resultEmpty).toEqual(resultWithText);
    });
  });
});

describe("CommandPalette ranking", () => {
  test("no-prefix query ranks exact minion name above weaker match", () => {
    const minions = [
      { id: "ws:switch:my-app", title: "my-app", section: "Minions" },
      { id: "ws:switch:my-app-legacy", title: "my-app-legacy", section: "Minions" },
      { id: "ws:switch:some-project", title: "some-project", section: "Minions" },
    ];

    const result = rankByPaletteQuery({
      items: minions,
      query: "my-app",
      toSearchDoc: (minion) => ({ primaryText: minion.title }),
      tieBreak: (a, b) => a.title.localeCompare(b.title),
    });

    expect(result[0]?.title).toBe("my-app");
  });

  test(">output ranks Show Output above false positives", () => {
    const commands = [
      {
        id: "nav:output",
        title: "Show Output",
        section: "Navigation",
        keywords: ["output", "panel"],
      },
      { id: "ws:new", title: "New Minion", section: "Minions", keywords: ["create"] },
      { id: "layout:toggle", title: "Toggle Layout", section: "Layouts", keywords: [] },
    ];

    const result = rankByPaletteQuery({
      items: commands,
      query: "output",
      toSearchDoc: (command) => ({
        primaryText: command.title,
        secondaryText: command.keywords,
      }),
      tieBreak: (a, b) => a.title.localeCompare(b.title),
    });

    expect(result[0]?.title).toBe("Show Output");
    expect(result.some((command) => command.title === "Toggle Layout")).toBe(false);
  });

  test("minion with long metadata still ranks exact title first", () => {
    const minions = [
      {
        id: "ws:switch:my-app",
        title: "my-app",
        section: "Minions",
        keywords: ["my-app", "my-project", "/home/user/very/long/path/to/project/my-app"],
      },
      {
        id: "ws:switch:my-app-legacy",
        title: "my-app-legacy",
        section: "Minions",
        keywords: ["my-app-legacy", "other-project"],
      },
    ];

    const result = rankByPaletteQuery({
      items: minions,
      query: "my-app",
      toSearchDoc: (minion) => ({
        primaryText: minion.title,
        secondaryText: minion.keywords,
      }),
      tieBreak: (a, b) => a.title.localeCompare(b.title),
    });

    expect(result[0]?.title).toBe("my-app");
  });
});
