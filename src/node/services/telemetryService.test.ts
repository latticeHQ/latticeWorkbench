import { describe, expect, test } from "bun:test";

import { shouldEnableTelemetry, type TelemetryEnablementContext } from "./telemetryService";

function createContext(overrides: Partial<TelemetryEnablementContext>): TelemetryEnablementContext {
  return {
    env: overrides.env ?? {},
    isElectron: overrides.isElectron ?? false,
    isPackaged: overrides.isPackaged ?? null,
  };
}

describe("TelemetryService enablement", () => {
  test("disables telemetry when explicitly disabled", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { LATTICE_DISABLE_TELEMETRY: "1" },
        isElectron: true,
        isPackaged: true,
      })
    );

    expect(enabled).toBe(false);
  });

  test("disables telemetry in E2E runs", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { LATTICE_E2E: "1" },
        isElectron: true,
        isPackaged: true,
      })
    );

    expect(enabled).toBe(false);
  });

  test("disables telemetry in test environments", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { NODE_ENV: "test" },
        isElectron: true,
        isPackaged: true,
      })
    );

    expect(enabled).toBe(false);
  });

  test("disables telemetry in CI environments", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { CI: "true" },
        isElectron: true,
        isPackaged: true,
      })
    );

    expect(enabled).toBe(false);
  });

  test("telemetry is permanently disabled in unpackaged Electron", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: {},
        isElectron: true,
        isPackaged: false,
      })
    );

    expect(enabled).toBe(false);
  });

  test("telemetry is permanently disabled in packaged Electron", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: {},
        isElectron: true,
        isPackaged: true,
      })
    );

    expect(enabled).toBe(false);
  });

  test("telemetry is permanently disabled in NODE_ENV=development", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { NODE_ENV: "development" },
        isElectron: false,
      })
    );

    expect(enabled).toBe(false);
  });

  test("telemetry stays disabled even with opt-in env var", () => {
    // Telemetry is permanently disabled in this build
    const enabled = shouldEnableTelemetry(
      createContext({
        env: { LATTICE_ENABLE_TELEMETRY_IN_DEV: "1" },
        isElectron: true,
        isPackaged: false,
      })
    );

    expect(enabled).toBe(false);
  });

  test("dev opt-in does not bypass test env disable", () => {
    const enabled = shouldEnableTelemetry(
      createContext({
        env: {
          NODE_ENV: "test",
          LATTICE_ENABLE_TELEMETRY_IN_DEV: "1",
        },
        isElectron: false,
      })
    );

    expect(enabled).toBe(false);
  });
});
