/**
 * Tests for useGateway stub hook.
 *
 * The gateway feature has been removed. These tests verify the stub returns
 * the expected inert values.
 */

import { describe, expect, test } from "bun:test";
import { useGateway, migrateGatewayModel, isGatewayFormat, isProviderSupported } from "./useGatewayModels";

describe("useGateway stub", () => {
  test("returns inert gateway state", () => {
    const state = useGateway();
    expect(state.isActive).toBe(false);
    expect(state.isConfigured).toBe(false);
    expect(state.isEnabled).toBe(false);
    expect(state.modelUsesGateway("anthropic:claude-sonnet-4-5")).toBe(false);
    expect(state.canToggleModel("anthropic:claude-sonnet-4-5")).toBe(false);
    expect(state.isModelRoutingThroughGateway("anthropic:claude-sonnet-4-5")).toBe(false);
  });
});

describe("stub utility functions", () => {
  test("migrateGatewayModel returns input unchanged", () => {
    expect(migrateGatewayModel("anthropic:claude-sonnet-4-5")).toBe("anthropic:claude-sonnet-4-5");
  });

  test("isGatewayFormat always returns false", () => {
    expect(isGatewayFormat("lattice-gateway:anthropic/claude-sonnet-4-5")).toBe(false);
  });

  test("isProviderSupported always returns false", () => {
    expect(isProviderSupported("anthropic:claude-sonnet-4-5")).toBe(false);
  });
});
