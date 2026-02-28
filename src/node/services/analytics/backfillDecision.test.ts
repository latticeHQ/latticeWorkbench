import { describe, expect, test } from "bun:test";
import { shouldRunInitialBackfill } from "./backfillDecision";

describe("shouldRunInitialBackfill", () => {
  test("returns true when session minions exist but watermark coverage is missing", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 1,
        watermarkCount: 0,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: true,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(true);

    expect(
      shouldRunInitialBackfill({
        eventCount: 0,
        watermarkCount: 0,
        sessionMinionCount: 1,
        hasSessionMinionMissingWatermark: true,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(true);
  });

  test("returns true when any session minion is missing a watermark row", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 10,
        watermarkCount: 1,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: true,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(true);
  });

  test("returns true when a watermark references a minion missing on disk", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 3,
        watermarkCount: 2,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: true,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(true);
  });

  test("returns true when events are missing but watermarks show prior assistant history", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 0,
        watermarkCount: 2,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: true,
      })
    ).toBe(true);
  });

  test("returns false for fully initialized zero-event histories", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 0,
        watermarkCount: 2,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(false);
  });

  test("returns false when events already exist and watermark coverage is complete", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 3,
        watermarkCount: 2,
        sessionMinionCount: 2,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: true,
      })
    ).toBe(false);
  });

  test("returns false when there are no session minions and the DB is empty", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 0,
        watermarkCount: 0,
        sessionMinionCount: 0,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(false);
  });

  test("returns true when there are no session minions but stale DB rows remain", () => {
    expect(
      shouldRunInitialBackfill({
        eventCount: 5,
        watermarkCount: 0,
        sessionMinionCount: 0,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: true,
      })
    ).toBe(true);

    expect(
      shouldRunInitialBackfill({
        eventCount: 0,
        watermarkCount: 2,
        sessionMinionCount: 0,
        hasSessionMinionMissingWatermark: false,
        hasWatermarkMissingSessionMinion: false,
        hasAnyWatermarkAtOrAboveZero: false,
      })
    ).toBe(true);
  });
});
